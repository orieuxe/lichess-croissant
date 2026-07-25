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

Mode vrac : `Round` n'est **pas** le vrai `round_number` grandroque — voir section dédiée.

## Mode vrac (parties d'équipe sans tournoi FFE individuel) — fait, scope réduit

### Contexte

Certaines studies mélangent des parties d'événements différents (ex `otb-games-2` :
Coupe de France, N4, Grand-Prix THF... dans les mêmes chapitres) — pas UN tournoi FFE
applicable à toute la study. Cas fréquent : Interclubs nationaux / Coupe de France, où
il n'y a pas de page FFE individuelle à fournir (pas de `FicheTournoi.aspx` pour un
match d'équipe donné).

**grandroque.fr** (`api.grandroque.fr`) a une vraie API REST/JSON publique (OpenAPI en
clair sur `/openapi.json`), et couvre les compétitions par équipe (Interclubs, Coupe
de France) de façon bien plus exploitable que FFE (`Equipes.aspx` est un formulaire
ASP.NET à postback). Ne couvre PAS les tournois individuels (Opens type
Saint-Quentin) — ceux-là restent sur le flow FFE existant, inchangé.

### Déclenchement

Au prompt "Lien fiche FFE ou id du tournoi (vide = mode manuel/vrac)" : si vide,
choix `[g]` grandroque / `[m]` manuel. `src/flow/match-round.ts` (`runVracMode`),
traitement chapitre par chapitre au lieu d'un batch sur toute la study.

### Endpoint utilisé

- `GET /api/v1/competitions/player-matches?player_name=ORIEUX Etienne` — un seul
  fetch par run, mis en cache pour tous les chapitres. Donne, en clair, bien plus
  que prévu au départ : `white_fide_id`/`black_fide_id`/`white_ffe_id`/`black_ffe_id`
  en plus du nom/elo/résultat/`competition_title`/noms d'équipe/`created_at`.
  **Conséquence : pas de recherche/matching FIDE nécessaire pour l'adversaire une
  fois la bonne partie identifiée** — `resolveFideById` direct sur le
  `black_fide_id`/`white_fide_id` fourni.

### Matching par partie (`src/grandroque.ts`)

1. Titre de chapitre (`ChapterName`, avant suppression) parsé best-effort
   (`parseChapterHint`) : couleur, nom adversaire, elo — convention `B/N vs Nom Elo`.
2. Date du chapitre (`Date`/`UTCDate`, avant suppression) capturée comme signal de
   proximité (`chapterDateHint`), comparée à `created_at` du candidat grandroque
   (pas besoin de résoudre round_number/date réels — voir limitation ci-dessous).
3. Score sur couleur / overlap nom adversaire / égalité elo (±5) / proximité date.
   Candidat net (score positif, pas d'égalité) → auto-appliqué (`bestMatch`).
4. Sinon → liste des candidats triés affichée (compétition, couleur/adversaire/elo,
   résultat, date, équipes), choix par numéro ou vide pour exclure ce chapitre
   (`topCandidates`, pas de seuil — l'humain juge).

### Tags posés en mode vrac

- `Event` = `competition_title` grandroque, **par partie** (`RoundResult.event`,
  overrides l'Event partagé du run dans `enrich.ts`) — une même study peut mélanger
  Coupe de France et Interclubs sans problème.
- `Round` = compteur local, incrémenté à chaque partie matchée pour cette
  compétition dans CE run (`1, 2, 3...` par `competition_title` rencontré) — **pas**
  le vrai `round_number` grandroque, voir Limitation connue.
- `White`/`Black`/`Elo`/`Result` : mêmes règles que le flow FFE (`enrich.ts` commun,
  aucune branche spécifique) — Elo direct du candidat matché, Result dérivé du score
  absolu grandroque (`resultRelativeToUs`) via le même encodage +/=/- que la FFE.
- `TimeControl` : non posé (catégorie de merge forcée `classique` par défaut à la
  place — voir Limitation connue).

### Limitation connue (découverte en implémentant, scope réduit vs plan initial)

Le plan initial visait `Round` = vrai `round_number` grandroque via
`/competitions/{competition_id}/rounds`, résolu depuis `competition_title` via
`/competitions`. **`competition_title` n'est pas unique** : "Coupe de France" à elle
seule a 250+ entrées distinctes dans `/competitions` (une par poule/saison
apparemment), sans aucun filtre serveur (`?title=` etc.) pour les départager —
retrouver le bon `competition_id` demanderait de scanner tous les candidats un par
un, pas praticable. Idem pour `cadence_preset`/`cadence_exact` (vivent sur l'objet
compétition, jamais résolu) : catégorie de merge forcée `classique` par défaut, les
compétitions par équipe FFE étant quasi toujours en cadence classique en pratique.

## Reste (phase 2, hors scope actuel)

- Sync auto vers en-croissant `.db3` (sqlite), 2 bases (classique / non-classique), schéma à inspecter

## Qui lance quoi

Toi lances `npm start` dans `/home/orieuxe/lichess-croissant` (input interactif, pas pilotable depuis mes outils).
