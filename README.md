# lichess-croissant

CLI qui télécharge tes studies lichess (parties OTB retransmises en club/tournoi),
les recoupe avec les données FFE ou grandroque.fr (rondes, adversaires, elo, cadence),
et maintient deux PGN fusionnés à jour (classique / rapide+blitz) — plus un push des
tags corrigés directement sur les chapitres lichess.

## Ce que ça fait

1. Liste tes studies lichess pas encore téléchargées
2. Télécharge la study choisie, affiche le lien lichess
3. Demande l'ID FIDE du joueur (Enter = toi, `.env`) — pour traiter la study
   de quelqu'un d'autre aussi
4. **Trois modes au choix :**
   - **Partie FIDE officielle `[O]`** → récupère toutes les parties du joueur
     sur grandroque.fr, les groupe par compétition (nom complet + date), tu
     choisis lesquelles inclure. Si 1 seule compétition : matching positionnel
     (chapitre N = match N). Si plusieurs : matching par nom d'adversaire
     (parsé du titre de chapitre). Si grandroque down : fallback automatique
     vers le lien FFE classique.
   - **Partie non officielle `[n]`** → mode manuel : cadence demandée, noms
     adversaires parsés du titre de chapitre ou saisis à la main (ID FIDE).
5. Complète chaque partie : `Round`, `White`/`Black` (+ Elo, + titre FIDE via
   `lichess.org/api/fide/player`), `WhiteFideId`/`BlackFideId`, `Result`, `Event`,
   `TimeControl`
6. Récap avant sauvegarde, confirmation `[O/n]`
7. Fusionne dans `merged_classique_<date>.pgn` / `merged_non-classique_<date>.pgn`
   (dédupliqué par `Site`, un seul fichier vivant par catégorie, renommé à chaque
   run). Pas de merge si autre joueur.
8. Pousse les tags corrigés sur les chapitres lichess (`POST /api/study/.../tags`)
9. Commit git auto (données seulement), push github optionnel

Cadence ≥ 60 min de base = classique, sinon rapide/blitz (fusionnés ensemble).
En mode grandroque : la cadence vient directement de l'API (classical/rapid/blitz).
Studies à ignorer définitivement : `i<numéro>` au premier prompt.

Pour un autre joueur que toi : le PGN est sauvegardé mais pas mergé, pas de manifest.

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

Voir [`PLAN.md`](./PLAN.md) — ce qui est fait, les limitations connues, et ce qui
reste. Les trois modes (FFE, grandroque, manuel) sont implémentés et testés.
Prochaine étape : sync vers la base en-croissant (sqlite).
