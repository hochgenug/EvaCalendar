// Service worker — orchestration de la sync EVA → Google Calendar.
import { isActive, toCalendarEvent, bookingFingerprint } from "./eva.js";
import { evaTabSync } from "./evatab.js";
import { getGoogleToken } from "./auth.js";
import { GOOGLE_CLIENT_ID } from "./config.js";
import { ensureEvaCalendar, calendarExists, insertEvent, updateEvent, deleteEvent } from "./gcal.js";

const SYNC_ALARM = "evaSync";
const SYNC_PERIOD_MIN = 180; // ~3 h
const ICON = "icons/icon128.png";

// ---- utilitaires état / statut ----

async function setStatus(text, ok) {
  await chrome.storage.local.set({
    lastStatus: text,
    lastRun: new Date().toISOString(),
    lastOk: !!ok,
  });
}

function notify(id, title, message) {
  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: ICON,
    title,
    message,
    priority: 2,
  });
}

// Jeton Google mis en cache (~1 h). Réutilisé tant qu'il est valide ; sinon
// renouvellement silencieux, et — seulement si autorisé (geste utilisateur) —
// fenêtre d'autorisation interactive en dernier recours.
async function ensureGoogleToken(allowInteractive) {
  const { googleToken } = await chrome.storage.local.get("googleToken");
  if (googleToken && googleToken.expiresAt > Date.now() + 60000) return googleToken.token;
  try {
    const t = await getGoogleToken({ interactive: false });
    await chrome.storage.local.set({ googleToken: t });
    return t.token;
  } catch (e) {
    if (!allowInteractive) throw e;
    const t = await getGoogleToken({ interactive: true });
    await chrome.storage.local.set({ googleToken: t });
    return t.token;
  }
}

// Seuil "passé vs futur" en heure murale (marge de 6 h pour absorber les
// écarts de fuseau) : un start stocké < ce seuil = session déjà eue.
function pastCutoff() {
  return new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 19);
}

// ---- sync principale ----

async function runEvaSync({ interactiveGoogle = false } = {}) {
  const cfg = await chrome.storage.local.get([
    "calendarId",
    "state",
    "defaultDurationMin",
    "fallbackTz",
    "syncPlayers",
  ]);

  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.startsWith("REMPLACE")) {
    await setStatus("Extension non configurée (Google Client ID manquant dans config.js)", false);
    return { ok: false, reason: "unconfigured" };
  }

  // 1. Données EVA via un onglet furtif app.eva.gg. Depuis le passage à Google
  //    OIDC, le token EVA vit en mémoire de l'app : capture.js capte le Bearer,
  //    on récupère bookings (+ joueurs si option) dans la page, puis on referme.
  const eva = await evaTabSync(!!cfg.syncPlayers);
  if (!eva.ok) {
    if (eva.error === "no_bearer" || String(eva.error || "").startsWith("unauth")) {
      notify("eva-reconnect", "EVA — reconnexion requise", "Connecte-toi sur app.eva.gg pour reprendre la synchro.");
      await setStatus("Session EVA absente/expirée — reconnecte-toi sur app.eva.gg", false);
      return { ok: false, reason: "eva_auth", error: eva.error };
    }
    await setStatus("Erreur EVA : " + (eva.error || "inconnue"), false);
    return { ok: false, reason: "eva_error", error: eva.error };
  }
  const bookings = eva.bookings || [];
  const truncated = !!eva.truncated;
  const pmap = eva.players || {};

  // 2. Jeton Google (cache → silencieux → interactif si geste utilisateur)
  let gtoken;
  try {
    gtoken = await ensureGoogleToken(interactiveGoogle);
  } catch (e) {
    if (!interactiveGoogle) {
      notify("eva-google", "EVA — autorisation Google requise", "Ouvre la popup de l'extension et clique « Connecter Google ».");
    }
    await setStatus("Autorisation Google requise (ouvre la popup) : " + e.message, false);
    return { ok: false, reason: "google_auth", error: e.message };
  }

  // 3. Agenda cible (recréé s'il a été supprimé côté Google → id périmé)
  let calendarId = cfg.calendarId;
  try {
    if (calendarId && !(await calendarExists(gtoken, calendarId))) calendarId = null;
    if (!calendarId) {
      calendarId = await ensureEvaCalendar(gtoken, "EVA");
      await chrome.storage.local.set({ calendarId });
    }
  } catch (e) {
    await setStatus("Erreur agenda Google : " + e.message, false);
    return { ok: false, reason: "calendar_error", error: e.message };
  }

  // 4. Diff & synchro
  const state = cfg.state || {}; // bookingId -> { eventId, fp, start, participants }
  const active = bookings.filter(isActive);
  const seen = new Set();
  let added = 0,
    updated = 0,
    removed = 0;
  const errors = [];
  const addedLabels = [];

  for (const b of active) {
    const bid = String(b.id);
    // liste des joueurs : si l'option est active, résultat frais sinon dernière
    // connue (évite le churn) ; sinon aucune liste.
    b.participants = cfg.syncPlayers ? pmap[bid] ?? state[bid]?.participants ?? null : null;
    const ev = toCalendarEvent(b, cfg.defaultDurationMin || 60, cfg.fallbackTz || "Europe/Paris");
    if (!ev) {
      // Horaire illisible : ne pas marquer "vu" (sinon on masquerait un vrai
      // changement), mais le garde-fou anti-suppression plus bas évite un wipe.
      errors.push(`${bid}: horaire illisible`);
      continue;
    }
    seen.add(bid);
    const fp = bookingFingerprint(ev);
    try {
      const prev = state[bid];
      if (!prev) {
        const eventId = await insertEvent(gtoken, calendarId, ev);
        state[bid] = { eventId, fp, start: ev.start.dateTime, participants: b.participants };
        added++;
        addedLabels.push(`${ev.summary} (${ev.start.dateTime.replace("T", " ")})`);
      } else if (prev.fp !== fp) {
        try {
          await updateEvent(gtoken, calendarId, prev.eventId, ev);
        } catch (e) {
          if (e.status === 404 || e.status === 410) {
            // Événement supprimé à la main côté Google → on le recrée.
            const eventId = await insertEvent(gtoken, calendarId, ev);
            state[bid] = { eventId, fp, start: ev.start.dateTime, participants: b.participants };
            updated++;
            await chrome.storage.local.set({ state });
            continue;
          }
          throw e;
        }
        state[bid] = { eventId: prev.eventId, fp, start: ev.start.dateTime, participants: b.participants };
        updated++;
      }
      // checkpoint incrémental (borne les doublons si le SW est tué en cours)
      await chrome.storage.local.set({ state });
    } catch (e) {
      errors.push(`${bid}: ${e.message}`);
    }
  }

  // 5. Réconciliation des entrées absentes de la liste "à venir".
  //    - session passée (déjà eue) → on retire juste de l'état, on GARDE l'événement (historique).
  //    - session future disparue → annulation → on supprime l'événement.
  //    Deux garde-fous : on s'abstient si la liste était tronquée, et si un nombre
  //    anormalement élevé d'entrées disparaît d'un coup (réponse EVA vide/partielle).
  if (!truncated) {
    const toReconcile = Object.keys(state).filter((bid) => !seen.has(bid));
    const cap = Math.max(3, Math.ceil(Object.keys(state).length / 2));
    const futureGone = toReconcile.filter((bid) => (state[bid].start || "") >= pastCutoff());
    if (futureGone.length > cap) {
      notify(
        "eva-massdel",
        "EVA — suppression suspecte évitée",
        `${futureGone.length} séances à venir ont disparu d'un coup. Synchro d'annulation ignorée par sécurité — vérifie tes réservations sur app.eva.gg.`
      );
      console.warn("eva_sync: suppression massive évitée:", futureGone.length);
    } else {
      for (const bid of toReconcile) {
        try {
          if ((state[bid].start || "") >= pastCutoff()) {
            await deleteEvent(gtoken, calendarId, state[bid].eventId); // future disparue = annulée
            removed++;
          }
          // (passée ou annulée) on nettoie l'état ; l'événement passé reste au calendrier
          delete state[bid];
          await chrome.storage.local.set({ state });
        } catch (e) {
          errors.push(`suppr ${bid}: ${e.message}`);
        }
      }
    }
  }

  await chrome.storage.local.set({ state });

  if (added) {
    notify(
      "eva-added",
      "EVA — nouvelles séances",
      addedLabels.slice(0, 5).join("\n") + (addedLabels.length > 5 ? `\n… (+${addedLabels.length - 5})` : "")
    );
  }
  const summary =
    `${active.length} à venir · +${added} ~${updated} -${removed}` + (errors.length ? ` · ${errors.length} err` : "");
  await setStatus(summary, errors.length === 0);
  if (errors.length) console.warn("eva_sync errors:", errors);
  return { ok: errors.length === 0, summary, added, updated, removed, errors };
}

// ---- planification ----

async function ensureAlarm() {
  const existing = await chrome.alarms.get(SYNC_ALARM);
  if (!existing) chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MIN });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  runEvaSync();
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  runEvaSync(); // rattrapage au démarrage du navigateur
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) return runEvaSync(); // renvoie la promesse (garde le SW vivant)
});

// ---- messages depuis la popup ----

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "syncNow") {
        // Déclenché par l'utilisateur depuis la popup → l'interactif est permis.
        sendResponse(await runEvaSync({ interactiveGoogle: true }));
      } else if (msg.type === "connectGoogle") {
        // Force une nouvelle autorisation (ignore le cache, qui pourrait avoir
        // un ancien scope), met le jeton en cache, puis crée l'agenda.
        const t = await getGoogleToken({ interactive: true });
        await chrome.storage.local.set({ googleToken: t });
        const calendarId = await ensureEvaCalendar(t.token, msg.calendarName || "EVA");
        await chrome.storage.local.set({ calendarId });
        sendResponse({ ok: true, calendarId });
      } else if (msg.type === "getStatus") {
        const s = await chrome.storage.local.get(["lastStatus", "lastRun", "lastOk", "calendarId"]);
        sendResponse({ ok: true, ...s });
      } else {
        sendResponse({ ok: false, error: "message inconnu" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // réponse asynchrone
});
