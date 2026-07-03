# EvaSessions

Extension de navigateur (Chrome / Brave) qui synchronise automatiquement tes sessions VR réservées sur [app.eva.gg](https://app.eva.gg/fr-FR/account/bookings) dans un agenda **Google Calendar** dédié.

➡️ **Installation, configuration et publication : [extension/README.md](extension/README.md)**

---

## Ce que ça fait

- Recopie tes réservations EVA à venir dans un agenda Google « EVA » (créé automatiquement au premier lancement).
- Maintient l'agenda à jour : **ajoute** les nouvelles séances, **met à jour** les reprogrammations, **supprime** les annulations. Les séances déjà passées sont conservées (historique).
- Chaque événement affiche : la **salle**, un **lien** vers la page EVA du jour (pour retrouver le créneau et ses détails), et un **rappel** (notification) le jour même à 12 h.
- Option **« Afficher la liste des joueurs »** : ajoute sous le lien la liste des joueurs inscrits sur le créneau.
- Fonctionne toute seule : relance au démarrage du navigateur puis toutes les ~3 h.

---

## Le défi technique

EVA n'expose pas d'API publique, et **son login est protégé par un reCAPTCHA v3** (une protection anti-robot invisible). Impossible donc de se connecter par un script : même un vrai navigateur automatisé se fait refuser (testé et confirmé). Toute solution qui essaierait de « se logger toute seule » en arrière-plan est condamnée d'avance.

**L'idée qui débloque tout :** ne pas se connecter du tout. Une extension de navigateur peut réutiliser la **session que toi, humain, tu as déjà ouverte** sur EVA. Concrètement, quand tu te connectes sur app.eva.gg, le site pose un cookie de session `refresh_token`. L'extension lit ce cookie et l'échange contre un jeton d'accès — et cet échange, lui, **n'est pas protégé par reCAPTCHA**. On contourne le mur sans jamais le franchir de force.

Quand ce cookie expire (~15 jours), l'extension te le signale par une notification ; tu te reconnectes une fois sur le site, et elle repart automatiquement. C'est la seule intervention manuelle récurrente.

---

## Comment ça marche (flux de données)

```
       [ toi, connecté sur app.eva.gg ]  → pose le cookie refresh_token (httpOnly)
                     │
   service worker (background.js), toutes les ~3 h ou au démarrage
                     │
  1. chrome.cookies.get ──────────────► lit le cookie refresh_token
  2. mutation refreshToken ───────────► jeton d'accès court (sans reCAPTCHA)
  3. getBookingOrderList ─────────────► liste des séances à venir
  4. diff vs chrome.storage ──────────► quoi créer / mettre à jour / supprimer
  5. Google Calendar API ─────────────► insert / update / delete des événements
 (option) onglet furtif + reCAPTCHA ──► liste des joueurs (listParticipants)
```

### Les points délicats résolus

- **Lire un cookie httpOnly.** Le cookie `refresh_token` est `httpOnly` : illisible par le JavaScript d'une page. L'extension le lit via l'API privilégiée `chrome.cookies`, réservée aux extensions.
- **Franchir le contrôle CORS d'EVA.** L'API `api.eva.gg` n'accepte que les requêtes portant l'en-tête `Origin: https://app.eva.gg`, que `fetch` interdit de fixer manuellement. Une règle `declarativeNetRequest` réécrit cet en-tête (et injecte le cookie) **uniquement sur les requêtes de l'extension** — jamais sur tes onglets EVA, pour ne pas perturber ta navigation.
- **Écrire dans Google Calendar.** L'extension fait son propre OAuth Google (`chrome.identity.launchWebAuthFlow`) et met le jeton en cache (~1 h) pour éviter des ré-authentifications inutiles.
- **Ne rien dupliquer.** Chaque séance est identifiée et « empreintée » (date, salle, description…) dans `chrome.storage`. Une synchro ne recrée jamais ce qui existe déjà et ne met à jour que ce qui a réellement changé.
- **Liste des joueurs (option).** La requête `listParticipants` est, elle, protégée par reCAPTCHA. Pour l'utiliser, l'extension ouvre furtivement un onglet EVA en arrière-plan le temps de générer un jeton, puis le referme. C'est pourquoi cette fonctionnalité est optionnelle et désactivée par défaut.

### Garde-fous

- Un agenda supprimé côté Google est détecté et recréé automatiquement.
- Une disparition massive et anormale de séances (réponse EVA dégradée) n'entraîne **pas** de suppression en masse : l'extension s'abstient et te notifie.
- Un événement supprimé à la main dans Google est recréé si la séance existe toujours.
- Une panne réseau ponctuelle ne fait pas « clignoter » les données : la dernière liste connue est réutilisée.

---

## Choix de conception

- **Tout côté navigateur, aucun serveur.** Rien à héberger ni à maintenir en ligne. La contrepartie : la synchro ne tourne que **lorsque le navigateur est ouvert** (ce qui suffit largement si tu l'ouvres à peu près chaque jour).
- **Prête à partager.** L'identifiant de l'extension est figé (clé du manifest) et l'identifiant client OAuth est embarqué : tes utilisateurs n'ont rien à configurer, ils installent et cliquent « Connecter Google ».

---

## Structure

```
extension/
├── manifest.json      # MV3 : permissions, service worker, action, "key" (ID fixe)
├── config.js          # GOOGLE_CLIENT_ID partagé (à renseigner par le mainteneur)
├── background.js      # orchestration : sync, dédup, alarms, notifications
├── eva.js             # API EVA (refreshToken, getBookingOrderList, construction des événements)
├── gcal.js            # Google Calendar REST (insert / update / delete)
├── net.js             # règle declarativeNetRequest (Origin + Cookie)
├── participants.js    # option liste joueurs (onglet furtif + reCAPTCHA + listParticipants)
├── auth.js            # OAuth Google (chrome.identity.launchWebAuthFlow)
├── popup.html / popup.js  # interface : Connecter Google, sync manuelle, option joueurs, statut
├── icons/
└── README.md          # installation (utilisateur) + configuration / publication (mainteneur)
```

---

## Limites connues

- La synchro ne tourne que **navigateur ouvert** (relance au démarrage + toutes les ~3 h).
- Reconnexion à EVA nécessaire ~tous les **15 jours** (sur notification).
- Sous Brave, le renouvellement silencieux du jeton Google est capricieux : il peut arriver que l'extension redemande « Connecter Google ».
- L'option « liste des joueurs » ouvre un onglet EVA en arrière-plan à chaque synchro (nécessaire pour le reCAPTCHA).
