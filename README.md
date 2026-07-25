# lichess-croissant

CLI qui enrichit des studies lichess de parties OTB (tournois, interclubs,
parties amicales) avec les données FFE ou grandroque.fr — rondes, adversaires,
elo, titre FIDE, cadence — puis exporte un PGN propre et synchronise
optionnellement vers [en-croissant](https://encroissant.org).

## Fonctionnalités

- Télécharge une study lichess et détecte automatiquement si les parties sont
  officielles (FIDE) ou non
- **Mode FFE** : scrape la fiche tournoi FFE, récupère la grille américaine
  (adversaires, elo, résultats) et les applique à chaque chapitre
- **Mode grandroque** : interroge l'API publique de grandroque.fr (toutes les
  parties du joueur, compétitions par équipe ET tournois individuels), groupe
  par compétition, apparie automatiquement chaque chapitre au bon match
- **Mode manuel** : pour les parties sans trace officielle, parse le titre du
  chapitre ou demande l'ID FIDE de l'adversaire
- Pose les tags PGN manquants : `Round`, `White`/`Black`, `WhiteElo`/`BlackElo`,
  `WhiteTitle`/`BlackTitle`, `WhiteFideId`/`BlackFideId`, `Result`, `Event`,
  `TimeControl`
- Pousse les tags corrigés sur les chapitres lichess
- Fusionne dans deux PGN (classique / non-classique), dédupliqués
- Sync optionnelle vers en-croissant (sqlite), DB séparées classique/non-classique

## Setup

Node ≥ 24 (type-stripping natif, pas de build).

```bash
npm install
cp .env.example .env
```

`.env` :

```
LICHESS_TOKEN=lip_...     # token lichess (scopes study:read, study:write)
LICHESS_USERNAME=...      # nom d'utilisateur lichess
FIDE_ID=...                # identifiant FIDE du joueur
# optionnel :
ENCROISSANT_DB_DIR=...   # dossier des DBs en-croissant
```

## Usage

```bash
npm start
```

Tout est interactif (prompts stdin), pas d'arguments.

## Dev

```bash
npm test     # 13 fichiers de test auto-vérifiés
npm run lint # eslint
npm run format # eslint --fix
```

## Roadmap

Voir [`PLAN.md`](./PLAN.md).
