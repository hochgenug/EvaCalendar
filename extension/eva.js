// Helpers EVA purs (pas d'accès réseau ici). Depuis que l'auth EVA est passée à
// « Sign in with Google » (OIDC), le token d'accès n'est plus dans un cookie ni
// dans le storage : il vit en mémoire de l'app. Les requêtes EVA se font donc
// dans un onglet app.eva.gg (voir evatab.js) ; ce module ne garde que la
// transformation booking -> événement Google Calendar.

// Sessions actives = ni terminées ni annulées.
export function isActive(booking) {
  return !booking.hasEnded && !String(booking.status || "").toUpperCase().includes("CANCEL");
}

// Normalise un datetime ISO EVA en heure murale locale "YYYY-MM-DDTHH:MM:SS"
// (on retire un éventuel offset/Z/millisecondes : la date/heure affichée est
// l'heure locale de la salle, qu'on associe à booking.timezone côté Google).
export function normalizeLocal(iso) {
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  if (!m) return null;
  return `${m[1]}T${m[2]}`;
}

function addMinutesISO(localIso, minutes) {
  const d = new Date(localIso + "Z"); // parse en UTC pour éviter le décalage local machine
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString().slice(0, 19); // "YYYY-MM-DDTHH:MM:SS"
}

// Lien vers la page "calendrier de réservation" EVA du jour de la séance
// (même salle, même date), où l'on retrouve le créneau et « Voir les détails ».
function bookingUrl(booking) {
  const locId = booking.location?.id;
  const date = normalizeLocal(booking.slot?.localDatetime)?.slice(0, 10); // YYYY-MM-DD
  if (!locId || !date) return null;
  const seatCount = booking.seatCount || 1;
  return `https://app.eva.gg/fr-FR/booking/calendar?locationId=${locId}&seatCount=${seatCount}&currentDate=${date}`;
}

export function toCalendarEvent(booking, defaultDurationMin, fallbackTz) {
  const slot = booking.slot || {};
  const start = normalizeLocal(slot.localDatetime);
  if (!start) return null;
  let end = slot.endLocalDatetime ? normalizeLocal(slot.endLocalDatetime) : null;
  if (!end) {
    const dur = slot.duration || defaultDurationMin || 60;
    end = addMinutesISO(start, dur);
  }
  const tz = booking.timezone || fallbackTz || "Europe/Paris";
  const game = booking.game?.name || "Session";
  const loc = booking.location?.name || "?";
  const descLines = [`Salle : EVA ${loc}`];
  const url = bookingUrl(booking);
  if (url) descLines.push("", `Voir le créneau sur EVA : ${url}`);
  const players = Array.isArray(booking.participants) ? booking.participants : null;
  if (players && players.length) {
    descLines.push("", "Joueurs présents :");
    for (const n of players) descLines.push(`• ${n}`);
  }

  // Rappel (notification) le jour même à 12h00, heure locale de la séance.
  const noon = `${start.slice(0, 10)}T12:00:00`;
  const minutesBefore = Math.max(0, Math.round((new Date(start + "Z") - new Date(noon + "Z")) / 60000));

  return {
    summary: `EVA — ${game}`,
    location: `EVA ${loc}`,
    description: descLines.join("\n"),
    start: { dateTime: start, timeZone: tz },
    end: { dateTime: end, timeZone: tz },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: minutesBefore }] },
  };
}

// Signature de l'état stocké : détecte tout changement matériel pour mettre à jour.
export function bookingFingerprint(ev) {
  return [
    ev.start.dateTime,
    ev.start.timeZone,
    ev.end.dateTime,
    ev.summary,
    ev.location,
    ev.description,
    JSON.stringify(ev.reminders),
  ].join("|");
}
