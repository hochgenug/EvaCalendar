// OAuth Google via chrome.identity.launchWebAuthFlow (flow implicite).
// Nécessite un client OAuth "Web application" dans Google Cloud, avec l'URI de
// redirection https://<extension-id>.chromiumapp.org/ (voir la popup / README).

// Scope complet : nécessaire pour créer/lister l'agenda dédié « EVA »
// (calendar.events seul ne permet pas la création de calendrier).
import { GOOGLE_CLIENT_ID } from "./config.js";

const SCOPES = "https://www.googleapis.com/auth/calendar";

// interactive:true → ouvre la fenêtre de consentement Google (1re fois).
// interactive:false → renouvellement silencieux (échoue si une UI serait requise).
export async function getGoogleToken({ interactive }) {
  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.startsWith("REMPLACE")) {
    throw new Error("Google Client ID non configuré dans config.js");
  }
  const clientId = GOOGLE_CLIENT_ID;
  const redirectUri = chrome.identity.getRedirectURL(); // https://<id>.chromiumapp.org/
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.search = new URLSearchParams({
    client_id: clientId,
    response_type: "token",
    redirect_uri: redirectUri,
    scope: SCOPES,
    prompt: interactive ? "consent" : "none",
  }).toString();

  const opts = { url: auth.toString(), interactive };
  if (!interactive) {
    // Laisse la page effectuer la redirection OAuth (prompt=none) avant d'abandonner,
    // sinon le renouvellement silencieux échoue systématiquement.
    opts.abortOnLoadForNonInteractive = false;
    opts.timeoutMsForNonInteractive = 5000;
  }

  const redirect = await chrome.identity.launchWebAuthFlow(opts);
  const params = new URLSearchParams(new URL(redirect).hash.slice(1));
  const token = params.get("access_token");
  if (!token) {
    const err = params.get("error");
    throw new Error(err ? `Google OAuth: ${err}` : "Pas d'access_token dans la redirection Google");
  }
  const expiresIn = parseInt(params.get("expires_in") || "3600", 10);
  return { token, expiresAt: Date.now() + expiresIn * 1000 };
}
