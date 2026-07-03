// Module Google Calendar — appels REST v3. Le jeton OAuth est fourni par auth.js.

const CAL_BASE = "https://www.googleapis.com/calendar/v3";

async function gapi(token, method, path, body) {
  const resp = await fetch(`${CAL_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (resp.status === 204) return null; // delete
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data?.error?.message || `HTTP ${resp.status}`;
    const err = new Error(`Google Calendar: ${msg}`);
    err.status = resp.status;
    throw err;
  }
  return data;
}

// Liste les agendas accessibles en écriture. Renvoie [{id, summary, primary}].
export async function listCalendars(token) {
  const data = await gapi(token, "GET", "/users/me/calendarList");
  return (data.items || [])
    .filter((c) => c.accessRole === "owner" || c.accessRole === "writer")
    .map((c) => ({ id: c.id, summary: c.summary, primary: !!c.primary }));
}

// Crée un agenda et le renvoie ({id, summary}).
export async function createCalendar(token, summary) {
  const data = await gapi(token, "POST", "/calendars", { summary });
  return { id: data.id, summary: data.summary };
}

// Vrai si l'agenda existe encore côté Google (sinon 404 → il a été supprimé).
export async function calendarExists(token, calendarId) {
  try {
    await gapi(token, "GET", `/calendars/${encodeURIComponent(calendarId)}`);
    return true;
  } catch (e) {
    if (e.status === 404) return false;
    throw e;
  }
}

// Trouve l'agenda "EVA" par nom, ou le crée. Renvoie son id.
export async function ensureEvaCalendar(token, name = "EVA") {
  const cals = await listCalendars(token);
  const found = cals.find((c) => c.summary === name);
  if (found) return found.id;
  const created = await createCalendar(token, name);
  return created.id;
}

export async function insertEvent(token, calendarId, event) {
  const data = await gapi(token, "POST", `/calendars/${encodeURIComponent(calendarId)}/events`, event);
  return data.id; // googleEventId
}

export async function updateEvent(token, calendarId, eventId, event) {
  await gapi(
    token,
    "PUT",
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    event
  );
}

// Supprime un événement ; ignore le 404/410 (déjà supprimé côté Google).
export async function deleteEvent(token, calendarId, eventId) {
  try {
    await gapi(
      token,
      "DELETE",
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
    );
  } catch (e) {
    if (e.status !== 404 && e.status !== 410) throw e;
  }
}
