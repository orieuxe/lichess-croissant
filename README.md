# lichess-croissant

CLI qui télécharge tes studies lichess (parties OTB retransmises en club/tournoi),
les recoupe avec les données FFE (rondes, adversaires, elo, cadence), et maintient
deux PGN fusionnés à jour (classique / rapide+blitz) — plus un push des tags
corrigés directement sur les chapitres lichess.

## Ce que ça fait

1. Liste tes studies lichess pas encore téléchargées (compte configuré, voir `.env`)
2. Télécharge la study choisie
3. Demande le lien de la fiche FFE du tournoi (`FicheTournoi.aspx?Ref=...`) et scrape
   dates, nombre de rondes, cadence, grille américaine (adversaires/elo/résultats)
4. Complète chaque partie : `Round`, `White`/`Black` (+ Elo, + titre FIDE via
   `lichess.org/api/fide/player`), `Result`, `Event`, `TimeControl`
5. Récap avant sauvegarde, confirmation `[O/n]`
6. Fusionne dans `merged_classique_<date>.pgn` / `merged_non-classique_<date>.pgn`
   (dédupliqué, un seul fichier vivant par catégorie, renommé à chaque run)
7. Pousse les tags corrigés sur les chapitres lichess (`POST /api/study/.../tags`)

Cadence ≥ 60 min de base = classique, sinon rapide/blitz (fusionnés ensemble).
Studies dont tu ne veux jamais t'occuper : `i<numéro>` au prompt pour les ignorer
définitivement.

## Setup

Node ≥ 24 (utilise le type-stripping natif, pas de build step — les fichiers `.ts`
tournent directement).

```bash
npm install
cp .env.example .env   # puis remplis les valeurs
```

`.env` :

```
LICHESS_TOKEN=...   # token lichess avec les scopes study:read, study:write
FIDE_ID=...          # ton id FIDE (lichess.org/api/fide/player?q=Nom+Prénom pour le trouver)
```

## Usage

```bash
npm start
```

Tout est interactif (prompts stdin) — pas de flags.

## Dev

```bash
npm test     # suite de self-checks, un par module (src/*.test.ts)
npm run lint # eslint
npm run format # eslint --fix
```

## État du projet / roadmap

Voir [`PLAN.md`](./PLAN.md) — ce qui est fait, les limitations connues (ex :
impossible de renommer le titre d'un chapitre lichess via l'API publique), et le
travail en cours (mode "vrac" pour les parties d'interclub/coupe sans tournoi FFE
individuel, via l'API grandroque.fr).
