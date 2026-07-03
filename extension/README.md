# EVA → Google Calendar (extension navigateur)

Extension Chrome/Brave qui synchronise automatiquement tes sessions VR réservées sur [app.eva.gg](https://app.eva.gg/fr-FR/account/bookings) dans un agenda Google dédié « EVA ». Tout tourne dans le navigateur — pas de serveur.

## Ce qu'elle fait

- Recopie tes réservations EVA à venir dans un agenda Google « EVA » (créé automatiquement).
- Ajoute les nouvelles séances, met à jour les reprogrammations, supprime les annulations. Les séances passées restent (historique).
- Chaque événement affiche la salle, un lien vers la page EVA du jour, et un rappel (notification) le jour même à 12 h.
- Option « Afficher la liste des joueurs » (voir plus bas) : ajoute la liste des joueurs inscrits sous le lien.
- Se relance au démarrage du navigateur puis toutes les ~3 h. Ne tourne que **navigateur ouvert**.

## Pourquoi une extension

Le login d'EVA est protégé par un reCAPTCHA v3 qui bloque toute connexion automatisée. Une extension, elle, réutilise le cookie de session (`refresh_token`) posé par ta connexion humaine et l'échange sans reCAPTCHA. Quand ce cookie expire (~15 j), l'extension te notifie ; tu te reconnectes une fois sur app.eva.gg et elle repart.

---

## Installation (utilisateur)

> Prérequis : le mainteneur a déjà renseigné le Client ID (voir plus bas) et distribué l'extension.

1. Charge l'extension : `brave://extensions` (ou `chrome://extensions`) → active le **Mode développeur** → **« Charger l'extension non empaquetée »** → sélectionne le dossier `extension/`. (Brave est plus tolérant que Chrome pour ce mode.)
2. Connecte-toi une fois sur [app.eva.gg](https://app.eva.gg) (pour créer le cookie de session).
3. Clique l'icône de l'extension → **« Connecter Google »** → autorise l'accès à ton agenda.
   - En mode Test, Google affiche « application non vérifiée » → **« Paramètres avancés » → « Accéder à … »**. Normal.
4. **« Synchroniser maintenant »** → tes séances apparaissent dans l'agenda « EVA ».

Ensuite, rien à faire : ça tourne tout seul. Tous les ~15 j, une notification te demande de te reconnecter à EVA.

## Option : liste des joueurs

Dans la popup, la case **« Afficher la liste des joueurs »** ajoute, sous le lien de chaque séance, la liste des joueurs inscrits sur le créneau.

Cette liste (`listParticipants`) est protégée par un reCAPTCHA côté EVA. Pour générer le jeton, l'extension **ouvre brièvement un onglet app.eva.gg en arrière-plan à chaque synchro**, puis le referme. L'option est donc **désactivée par défaut** : active-la seulement si ce petit va-et-vient d'onglet ne te dérange pas. Sans elle, la description se limite à la salle + le lien.

---

## Configuration (mainteneur, une seule fois avant distribution)

L'ID de l'extension est figé par la clé du manifest : `mhgmkgplfkhcdndpcdnobiohmopmpkkb`.
L'URI de redirection OAuth correspondante (fixe pour tout le monde) est donc :

```
https://mhgmkgplfkhcdndpcdnobiohmopmpkkb.chromiumapp.org/
```

Étapes :

1. **Google Cloud Console** ([console.cloud.google.com](https://console.cloud.google.com)) :
   - Projet → **API et services → Bibliothèque** → active **Google Calendar API**.
   - **Google Auth Platform** → **Branding** (nom + e-mail) ; **Audience** : type *Externe*, état *Test*.
   - **Clients → Créer un client OAuth** → type **Application Web** → dans *URI de redirection autorisés*, colle exactement l'URI ci-dessus → Créer.
   - Copie le **Client ID**.
2. **`extension/config.js`** : remplace `REMPLACE_PAR_TON_CLIENT_ID...` par ton Client ID.
3. **Autoriser les utilisateurs** (mode Test) : dans **Audience → Utilisateurs de test**, ajoute l'adresse Google de chaque personne (max 100). Sans ça, « Connecter Google » leur sera refusé.
4. Distribue l'extension (voir ci-dessous).

> La clé privée de l'extension est dans `eva_ext_key.pem` à la racine du repo (ignorée par git). Conserve-la : elle est nécessaire pour garder le même ID si tu publies un jour sur le Chrome Web Store.

---

## Distribution

### Option A — Zip à charger en mode développeur (le plus simple)
Zippe le dossier `extension/` et partage-le. Chaque personne le charge via `brave://extensions` (mode développeur). Idéal pour un cercle restreint, surtout sous Brave (Chrome ré-affiche un avertissement au démarrage). Aucune revue, aucun compte.

### Option B — Chrome Web Store « non répertorié »
Compte développeur ([~5 $ une fois](https://chromewebstore.google.com/)), upload du zip, visibilité *Non répertorié* → installable par lien seulement (1 clic, pas d'avertissement de mode dev). Revue Google (quelques jours).

### Option C — Chrome Web Store public
Comme B mais visibilité publique. **Attention** : combiné à la publication de l'app OAuth (pour dépasser 100 utilisateurs), Google exige une **vérification OAuth**. Le scope `calendar` est « restreint » → vérification lourde (potentiel audit de sécurité tiers, coûteux). Pour alléger, on peut basculer le scope sur `calendar.app.created` (accès limité aux agendas créés par l'app) — demande-le si tu vises ce cas.

---

## Dépannage

- **« Cookie EVA absent » / « session expirée »** : reconnecte-toi sur app.eva.gg.
- **« Autorisation Google requise »** : ouvre la popup → « Connecter Google ».
- **« Extension non configurée »** : le Client ID n'est pas renseigné dans `config.js` (côté mainteneur).
- **Logs** : `brave://extensions` → l'extension → « Inspecter les vues : service worker » → console.
- **Repartir de zéro** : dans cette console, `chrome.storage.local.clear()`.

## Sécurité / vie privée

- Le cookie `refresh_token` n'est jamais stocké sur disque : lu à la volée à chaque synchro.
- La règle `declarativeNetRequest` ne s'applique qu'aux requêtes de l'extension (`initiatorDomains`) : elle ne touche pas tes onglets EVA.
- Le Client ID OAuth n'est pas un secret (public par nature côté client). Aucune donnée n'est envoyée ailleurs que vers `api.eva.gg` et `googleapis.com`.
