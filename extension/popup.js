const $ = (id) => document.getElementById(id);

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(resp);
    });
  });
}

function showStatus(text, cls) {
  const el = $("status");
  el.textContent = "Statut : " + text;
  el.className = "status" + (cls ? " " + cls : "");
}

async function refresh() {
  const { syncPlayers } = await chrome.storage.local.get("syncPlayers");
  $("syncPlayers").checked = !!syncPlayers;
  const r = await send({ type: "getStatus" });
  if (r?.lastStatus) {
    const when = r.lastRun ? new Date(r.lastRun).toLocaleString("fr-FR") : "";
    showStatus(`${r.lastStatus}${when ? " — " + when : ""}`, r.lastOk ? "ok" : "err");
  }
}

$("syncPlayers").addEventListener("change", (e) => {
  chrome.storage.local.set({ syncPlayers: e.target.checked });
});

$("connect").addEventListener("click", async () => {
  showStatus("Ouverture de l'autorisation Google…");
  const r = await send({ type: "connectGoogle", calendarName: "EVA" });
  showStatus(r?.ok ? "Google connecté, agenda EVA prêt." : "Échec : " + (r?.error || "inconnu"), r?.ok ? "ok" : "err");
});

$("sync").addEventListener("click", async () => {
  showStatus("Synchronisation…");
  const r = await send({ type: "syncNow" });
  showStatus(r?.ok ? r.summary || "OK" : "Échec : " + (r?.reason || r?.error || "inconnu"), r?.ok ? "ok" : "err");
});

refresh();
