// Injecté sur app.eva.gg au plus tôt (monde MAIN, document_start). Depuis que le
// token d'accès EVA n'est plus dans un cookie/storage mais en mémoire, on le
// capte à la volée : on hooke fetch/XHR et on stocke le dernier « Bearer <jwt> »
// envoyé, dans localStorage sous __eva_bearer, que l'extension relira ensuite.
(function () {
  const KEY = "__eva_bearer";
  function stash(auth) {
    try {
      if (auth && /^Bearer\s+/i.test(auth)) localStorage.setItem(KEY, auth.replace(/^Bearer\s+/i, ""));
    } catch (e) {}
  }
  function fromHeaders(h) {
    try {
      if (!h) return;
      if (typeof h.get === "function") stash(h.get("authorization") || h.get("Authorization"));
      else if (Array.isArray(h)) {
        const e = h.find((x) => String(x[0]).toLowerCase() === "authorization");
        if (e) stash(e[1]);
      } else {
        stash(h.authorization || h.Authorization);
      }
    } catch (e) {}
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      fromHeaders(init && init.headers);
      if (input && typeof input === "object" && input.headers) fromHeaders(input.headers);
    } catch (e) {}
    return origFetch.apply(this, arguments);
  };

  const origSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try {
      if (String(k).toLowerCase() === "authorization") stash(v);
    } catch (e) {}
    return origSet.apply(this, arguments);
  };
})();
