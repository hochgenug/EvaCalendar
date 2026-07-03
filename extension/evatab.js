// Toutes les requêtes EVA se font dans un onglet app.eva.gg ouvert en
// arrière-plan : c'est le seul contexte où (1) le Bearer capté par capture.js est
// disponible, (2) l'Origin est bon (CORS), (3) grecaptcha peut générer un jeton
// pour listParticipants. On ouvre l'onglet, on injecte la récupération, on ferme.

const SITEKEY = "6LeyQ7oZAAAAAGEyUpwCPE5r0wnlCnkqCGDEQ6zJ";

// Exécuté DANS la page app.eva.gg (monde MAIN). Autonome : aucune variable externe.
async function inPage(bearerKey, wantPlayers, sitekey) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const R = { ok: false };

  // Attendre que capture.js ait stocké un Bearer (l'app fait un fetch authentifié au boot).
  let token = null;
  const dl = Date.now() + 10000;
  while (!token && Date.now() < dl) {
    try {
      token = localStorage.getItem(bearerKey);
    } catch (e) {}
    if (!token) await sleep(250);
  }
  if (!token) {
    R.error = "no_bearer";
    return R;
  }

  const gql = async (query, variables, extraHeaders) => {
    const resp = await fetch("https://api.eva.gg/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, ...(extraHeaders || {}) },
      body: JSON.stringify({ query, variables }),
    });
    const body = await resp.json();
    if (body.errors && body.errors.length) {
      const codes = body.errors.map((e) => e && e.extensions && e.extensions.code);
      const err = new Error(body.errors[0].message);
      err.unauth = codes.indexOf("UNAUTHENTICATED") !== -1;
      throw err;
    }
    return body.data;
  };

  // Réservations à venir (paginées).
  const BOOKINGS =
    "query getBookingOrderList($page: PageRequestInput, $filters: ListBookingOrdersFiltersInput!){ listBookingOrders(page:$page, filters:$filters){ nodes{ id items{ booking{ id terrainId status seatCount timezone hasEnded bookingGroupUnitId slot{ id localDatetime endLocalDatetime convocationLocalDatetime duration } game{ name } location{ id name } } } } totalCount } }";
  const bookings = [];
  let page = 1;
  try {
    for (;;) {
      const d = await gql(BOOKINGS, { page: { page, limit: 50 }, filters: { bookingPassed: false } });
      const p = d.listBookingOrders;
      const nodes = p.nodes || [];
      for (const n of nodes) for (const it of n.items || []) if (it.booking) bookings.push(it.booking);
      const total = p.totalCount || 0;
      if (!nodes.length || page * 50 >= total) break;
      if (page >= 5) {
        R.truncated = true;
        break;
      }
      page += 1;
    }
  } catch (e) {
    R.error = (e.unauth ? "unauth:" : "bookings:") + e.message;
    return R;
  }
  R.bookings = bookings;

  // Liste des joueurs (option) — listParticipants exige un jeton reCAPTCHA.
  if (wantPlayers) {
    const grc = () =>
      window.grecaptcha && window.grecaptcha.enterprise ? window.grecaptcha.enterprise : window.grecaptcha;
    const gdl = Date.now() + 12000;
    while ((!grc() || !grc().execute) && Date.now() < gdl) await sleep(200);
    const players = {};
    if (grc() && grc().execute) {
      await new Promise((r) => grc().ready(r));
      const PQ =
        "query listParticipants($slotId: String!, $terrainId: Int!){ listParticipants(slotId:$slotId, terrainId:$terrainId){ user{ displayName } isAnonymous } }";
      for (const b of bookings) {
        if (!b.slot || !b.slot.id || b.terrainId == null) continue;
        try {
          const tk = await grc().execute(sitekey, { action: "get_game_session" });
          const d = await gql(PQ, { slotId: b.slot.id, terrainId: b.terrainId }, { "x-recaptcha-token": tk });
          const list = (d && d.listParticipants) || [];
          players[String(b.id)] = list
            .map((p) => (p.isAnonymous ? "Joueur anonyme" : (p.user && p.user.displayName) || "?"))
            .sort((a, c) => a.localeCompare(c));
        } catch (e) {
          players[String(b.id)] = null;
        }
      }
    } else {
      R.playersError = "grecaptcha indisponible";
    }
    R.players = players;
  }

  R.ok = true;
  return R;
}

function waitTabComplete(tabId, timeoutMs) {
  return new Promise(async (resolve) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const t = await chrome.tabs.get(tabId);
        if (t.status === "complete") return resolve();
      } catch (e) {
        return resolve();
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    resolve();
  });
}

// Ouvre l'onglet furtif, récupère bookings (+ joueurs si demandé), referme.
// Renvoie { ok, bookings, players?, truncated?, error? }.
export async function evaTabSync(wantPlayers) {
  const tab = await chrome.tabs.create({ url: "https://app.eva.gg/fr-FR/account/bookings", active: false });
  try {
    await waitTabComplete(tab.id, 15000);
    await new Promise((r) => setTimeout(r, 1500)); // laisser l'app faire son premier fetch (capture du Bearer)
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: inPage,
      args: ["__eva_bearer", !!wantPlayers, SITEKEY],
    });
    return (res && res[0] && res[0].result) || { ok: false, error: "no_result" };
  } finally {
    try {
      await chrome.tabs.remove(tab.id);
    } catch (e) {
      /* onglet déjà fermé */
    }
  }
}
