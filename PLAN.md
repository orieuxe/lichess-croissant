# Plan — lichess-croissant

## Fait (phase 1)

- Download study lichess (compte `timoruu` uniquement), suggestion via manifest `studyId → filename`
- Studies à ignorer définitivement (`ignored.json`, prompt `i<numéro>`)
- Scraping FFE : fiche (dates/rondes/cadence/titre) + grille américaine (rondes/adversaires/elo), lien résultats découvert dynamiquement depuis la fiche (plus de `Action=Ga` en dur)
- Tournoi fermé/round-robin (que `Grille Berger`, pas de `Ga`) → alerte claire, skip enrichissement rondes, pas de parser Berger (pas de besoin réel encore)
- Sur mismatch nb parties / nb rondes FFE → reboucle sur le prompt lien FFE (au lieu de merger avec les mauvaises données)
- Exclusion manuelle de chapitres (ex: partie d'un autre joueur dans la study) si nb parties > nb rondes FFE, avec preview coups
- Cadence classée auto par seuil (≥60min = classique), table `cadence-map.json` en fallback si texte illisible
- Identité : `FIDE_ID` dans `.env`, fetché une fois au démarrage (`getFidePlayer`) → nom + titre + nom format FFE dérivé pour matcher la grille FFE, plus besoin de `FFE_PLAYER_NAME`
- Noms adversaire reformatés "Nom, Prénom" + titre FIDE via `lichess.org/api/fide/player`, demande l'ID FIDE si pas de match clair
- Tags posés : Round, Event (choix titre FFE / nom study / libre), EventURL (lien FFE, local uniquement), White/Black, WhiteElo/BlackElo (adversaire + soi), WhiteTitle/BlackTitle, WhiteFideId/BlackFideId (adversaire + soi, whitelist lichess), Result (dérivé +/=/- FFE), TimeControl (texte cadence brut)
- Mode manuel (`src/flow/match-round.ts`) : studies sans tournoi FFE du tout (parties
  amicales/blitz entre potes, pas de trace officielle nulle part) — lien FFE vide,
  choix `[m]`. Round = position dans la study, adversaire parsé du `ChapterName`
  (convention `B/N vs Nom Elo`) ou saisi à la main (ID FIDE ou nom), cadence
  demandée `[s/r/b]` (fixe aussi la catégorie de merge et le rating FIDE à utiliser)
- Mode vrac / grandroque (`src/grandroque.ts` + branche vrac de `match-round.ts`) :
  compétitions par équipe (Interclubs, Coupe de France) — lien FFE vide, choix `[g]`.
  Voir section dédiée ci-dessous, implémenté avec un scope réduit par rapport au
  plan initial (round_number non résolu, voir Limitation connue)
- UTCDate/UTCTime/ChapterName supprimés du PGN local
- Récap avant sauvegarde (titre round + adversaire + elo + résultat + coups) avec confirmation `[O/n]` — annule tout si refusé (rien écrit, rien pushé)
- Push des tags vers lichess (`POST /api/study/{id}/{chapterId}/tags`) — whitelist stricte côté lichess (voir Limitation connue), `Event` = lien FFE direct côté push (EventURL non supporté par l'API)
- Merge : un fichier classique + un fichier non-classique (rapide+blitz), écrasés/renommés à chaque run, dédupliqué par `Site`
- `Date` du PGN jamais touché (celui posé par le retransmetteur en direct, fiable — FFE ne publie pas de calendrier ronde par ronde exploitable, confirmé sur Saint-Quentin 9 rondes/7 jours)
- Manifest écrit seulement en fin de flow réussi (pas juste après download)
- ESLint (single quotes + règles TS), `npm run lint`/`format`

## Limitation connue

Renommer le titre d'un chapitre existant ("B/N vs Nom, Prénom elo") : **pas possible via l'API publique lichess**, seuls les tags PGN sont modifiables (whitelist stricte : White/Black/Elo/Title/Team/FideId, TimeControl, Date, Result, Termination, Site, Event, Round, Board, Annotator, GameId — voir `StudyPgnTags.scala` dans lila), le titre n'est dérivé du PGN qu'à l'import initial. `UTCDate`/`UTCTime`/`ChapterName`/`EventURL` hors whitelist → 400 systématique, même pour delete, donc jamais envoyés au push. Feature request déposée : https://github.com/lichess-org/api/issues/660. À faire à la main sur lichess en attendant, ou si l'issue avance.

Mode vrac : `Round` est le vrai `round_number` grandroque, `TimeControl` est la `cadence`
réelle — voir section dédiée. Utilise `/profiles/{slug}/games` ([f]), pas `player-matches`.

## Mode vrac (grandroque) — équipe et individuels sans fiche FFE

### Contexte

Certaines studies mélangent des parties d'événements différents (ex `otb-games-2` :
Coupe de France, N4, Grand-Prix THF... dans les mêmes chapitres) — pas UN tournoi FFE
applicable à toute la study. Cas fréquent : Interclubs nationaux / Coupe de France, où
il n'y a pas de page FFE individuelle à fournir.

**grandroque.fr** (`api.grandroque.fr`) a une vraie API REST/JSON publique (OpenAPI en
clair sur `/openapi.json`), et couvre les compétitions par équipe (Interclubs, Coupe
de France) **mais aussi les tournois individuels** (Opens type Saint-Quentin) — le
tout via un seul endpoint unifié. Ne remplace PAS le flow FFE pour les tournois avec
fiche (la grille FFE donne le round/opposant de façon déterministe, le matching
grandroque reste heuristique par nom d'adversaire).

### Déclenchement

Prompt upfront : `Tournoi solo FFE [f], compétition par équipe [e], parties non
officielles [m]`. `[e]` → `runVracMode` dans `src/flow/match-round.ts`, traitement
chapitre par chapitre.

### Endpoints utilisés

- `GET /api/v1/players/fide/{fide_id}` — slug du profil (ex `"etienne-orieux"`),
  résolu direct depuis le FIDE_ID connu, pas de recherche/ambiguïté.
- `GET /api/v1/profiles/{slug}/games?limit=100` — TOUTES les parties du joueur
  (compétitions par équipe ET tournois individuels) avec **tout** ce qui manquait
  à `player-matches` : `round_number`, `date` (réelle), `cadence` (classical/rapid/
  blitz), `white_fide_id`/`black_fide_id`, `competition_title`. Un ou deux appels
  paginés par `next_cursor` (200-300 parties max par joueur en pratique, quelques
  centaines de ms).

### Matching par partie (`src/grandroque.ts`)

1. Titre de chapitre parsé (`parseChapterHint`) : nom adversaire — convention
   `B/N vs Nom Elo`. Le nom adversaire est le seul champ utilisé pour le matching ;
   la couleur et l'elo ne sont plus scorés (le endpoint `/games` donne directement
   le round_number/date/cadence pour chaque match, plus besoin d'heuristique
   complexe).
2. `matchGame(hintName, candidates, ourName)` : overlap de tokens sur le nom
   adverse (un seul token suffit pour matcher). Si un seul candidat avec score
   positif → auto-appliqué. Si zéro ou plusieurs → `rankedGames` pour le picker
   manuel (trié par score, sans seuil).
3. Chapitre sans titre parsable → affiché et exclu (impossible de deviner
   l'adversaire sans hint).

### Tags posés en mode vrac

- `Round` = **vrai `round_number`** grandroque (plus de compteur local par compétition)
- `Event` = `competition_title` grandroque, **par partie** (`RoundResult.event`)
- `White`/`Black` = noms normalisés (`ourSideOf` → `resolveFideById` via le
  `white_fide_id`/`black_fide_id` direct dans le match, pas de recherche)
- `Elo`/`Title`/`FideId` : comme le reste du pipeline (`enrich.ts` commun), résolus
  via `resolveFideById`
- `Result` = dérivé du score absolu grandroque (`resultRelativeToUs`)
- `TimeControl` = `cadence` réelle (classical/rapid/blitz) — plus de `classique`
  en dur
- `Date` jamais touché (convention PGN inchangée)
- Catégorie de merge dérivée de `cadence` : classical → classique, rapid/blitz →
  non-classique

### Limitations

- Le matching repose uniquement sur le nom d'adversaire parsé du titre de chapitre
  (`ChapterName`, convention `B/N vs Nom Elo`). Sans nom parsable, la partie est
  exclue — l'utilisateur peut la corriger à la main (renommer le chapitre sur
  lichess puis relancer le téléchargement).
- `matchGame` refuse l'auto-match si deux candidats ont le même nom adverse (cas
  rare : même adversaire rencontré deux fois dans deux compétitions différentes
  le même jour) → picker manuel présenté.

## Reste (phase 2, hors scope actuel)

- Sync auto vers en-croissant `.db3` (sqlite), 2 bases (classique / non-classique), schéma à inspecter

## Qui lance quoi

Toi lances `npm start` dans `/home/orieuxe/lichess-croissant` (input interactif, pas pilotable depuis mes outils).
