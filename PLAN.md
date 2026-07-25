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
- Choix du joueur : prompt ID FIDE au démarrage (Enter = soi, `.env`)
- Mode grandroque (`src/grandroque.ts` + `src/flow/match-round.ts`) : couvre tournois
  individuels ET compétitions par équipe (tout ce qui est officiel FIDE, sans fiche
  FFE à fournir). Voir section dédiée ci-dessous.
- Mode manuel (parties non officielles) : inchangé
- Flow FFE classique (avec lien fiche) : inchangé, utilisé en fallback si grandroque
  down

## Limitation connue

Renommer le titre d'un chapitre existant ("B/N vs Nom, Prénom elo") : **pas possible via l'API publique lichess**, seuls les tags PGN sont modifiables (whitelist stricte : White/Black/Elo/Title/Team/FideId, TimeControl, Date, Result, Termination, Site, Event, Round, Board, Annotator, GameId — voir `StudyPgnTags.scala` dans lila), le titre n'est dérivé du PGN qu'à l'import initial. `UTCDate`/`UTCTime`/`ChapterName`/`EventURL` hors whitelist → 400 systématique, même pour delete, donc jamais envoyés au push. Feature request déposée : https://github.com/lichess-org/api/issues/660. À faire à la main sur lichess en attendant, ou si l'issue avance.

## Mode grandroque (parties officielles sans fiche FFE)

### Contexte

Certaines studies n'ont pas de fiche FFE unique (mélange d'événements, ou compétitions
par équipe sans page individuelle). **grandroque.fr** a une API REST/JSON publique qui
couvre à la fois les tournois individuels ET les compétitions par équipe, via deux
endpoints :

- `GET /api/v1/players/fide/{fide_id}` → `slug` du joueur
- `GET /api/v1/profiles/{slug}/games?limit=100` → toutes les parties (paginated),
  avec `round_number`, `date`, `cadence`, `competition_title`, `white_fide_id`/
  `black_fide_id`, etc.
- `GET /api/v1/profiles/{slug}/story-events` → liste des tournois/compétitions
  auxquels le joueur a participé, avec clé (tournament_id ou competition_title),
  nombre de parties, date — utilisé comme picker.

### Déclenchement

Prompt : `Partie FIDE officielle ? [o/n]`. `o` → flow grandroque, `n` → mode manuel.

### Flow

1. `fetchPlayerSlug(fideId)` → slug.
2. `pickEvents(slug)` → l'utilisateur choisit 1+ événements dans `story-events`.
3. `fetchProfileGames(slug)` → toutes les parties, filtrées aux événements
   sélectionnés (`filterGamesByEvents`).
4. **1 seul événement** → `positionalMatch` : les chapitres sont dans l'ordre,
   chaque chapitre N = le N-ième match du sous-ensemble filtré. Aucune recherche
   par nom.
5. **Plusieurs événements** → `nameBasedMatch` : chaque chapitre est matché par
   overlap de nom adverse (`matchGame`). Si ambigu, picker manuel (`rankedGames`).
6. Si grandroque down : fallback automatique vers le flow FFE classique (demande
   le lien).
7. Si FFE ajouté en plus (pour les parties absentes de grandroque) : les
   `RoundResult` FFE sont convertis en `ProfileGame` synthétiques via
   `ffeRoundToProfileGame` et ajoutés au pool de matching, sans doublon.

### Tags posés

- `Round` = `round_number` réel (grandroque) ou `round` FFE
- `Event` = `competition_title` grandroque, **par partie** (`RoundResult.event`)
- Elo/FideId/Title/Result : pipeline `enrich.ts` commun, FideId résolu direct
  depuis les champs `white_fide_id`/`black_fide_id` de l'API
- `TimeControl` = `cadence` réelle (classical/rapid/blitz)
- Catégorie de merge dérivée de `cadence`

## Reste (phase 2, hors scope actuel)

- Sync auto vers en-croissant `.db3` (sqlite), 2 bases (classique / non-classique), schéma à inspecter

## Qui lance quoi

Toi lances `npm start` dans `/home/orieuxe/lichess-croissant` (input interactif, pas pilotable depuis mes outils).
