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
- Tags posés : Round, Event (choix titre FFE / nom study / libre), EventURL (lien FFE, local uniquement), White/Black, WhiteElo/BlackElo (adversaire + soi), WhiteTitle/BlackTitle, Result (dérivé +/=/- FFE), TimeControl (texte cadence brut)
- UTCDate/UTCTime/ChapterName supprimés du PGN local
- Récap avant sauvegarde (titre round + adversaire + elo + résultat + coups) avec confirmation `[O/n]` — annule tout si refusé (rien écrit, rien pushé)
- Push des tags vers lichess (`POST /api/study/{id}/{chapterId}/tags`) — whitelist stricte côté lichess (voir Limitation connue), `Event` = lien FFE direct côté push (EventURL non supporté par l'API)
- Merge : un fichier classique + un fichier non-classique (rapide+blitz), écrasés/renommés à chaque run, dédupliqué par `Site`
- `Date` du PGN jamais touché (celui posé par le retransmetteur en direct, fiable — FFE ne publie pas de calendrier ronde par ronde exploitable, confirmé sur Saint-Quentin 9 rondes/7 jours)
- Manifest écrit seulement en fin de flow réussi (pas juste après download)
- ESLint (single quotes + règles TS), `npm run lint`/`format`

## Limitation connue

Renommer le titre d'un chapitre existant ("B/N vs Nom, Prénom elo") : **pas possible via l'API publique lichess**, seuls les tags PGN sont modifiables (whitelist stricte : White/Black/Elo/Title/Team/FideId, TimeControl, Date, Result, Termination, Site, Event, Round, Board, Annotator, GameId — voir `StudyPgnTags.scala` dans lila), le titre n'est dérivé du PGN qu'à l'import initial. `UTCDate`/`UTCTime`/`ChapterName`/`EventURL` hors whitelist → 400 systématique, même pour delete, donc jamais envoyés au push. Feature request déposée : https://github.com/lichess-org/api/issues/660. À faire à la main sur lichess en attendant, ou si l'issue avance.

## En cours — mode "vrac" (parties d'équipe sans tournoi FFE individuel)

### Contexte

Certaines studies mélangent des parties d'événements différents (ex `otb-games-2` :
Coupe de France, N4, Grand-Prix THF... dans les mêmes chapitres) — pas UN tournoi FFE
applicable à toute la study. Cas fréquent : Interclubs nationaux / Coupe de France, où
il n'y a pas de page FFE individuelle à fournir (pas de `FicheTournoi.aspx` pour un
match d'équipe donné).

Découverte en cours de route : **grandroque.fr** (`api.grandroque.fr`) a une vraie API
REST/JSON publique (OpenAPI en clair sur `/openapi.json`), et couvre les compétitions
par équipe (Interclubs, Coupe de France) de façon bien plus exploitable que FFE
(`Equipes.aspx` est un formulaire ASP.NET à postback — pas exploitable simplement).
Ne couvre PAS les tournois individuels (Opens type Saint-Quentin) — ceux-là restent
sur le flow FFE existant, inchangé.

### Endpoints grandroque utiles (publics, sans auth)

- `GET /api/v1/competitions/players/search?q=<nom>` — trouve le nom exact tel
  qu'enregistré (ex "Orieux" → `"ORIEUX Etienne"`)
- `GET /api/v1/competitions/player-matches?player_name=ORIEUX Etienne` — TOUTES les
  parties par équipe du joueur, toutes compétitions confondues : adversaire
  (nom/elo/ffe_id/fide_id), couleur, résultat, `competition_title`, noms d'équipes,
  `team_match_id`. Pas de `round_number` ni `date` fiable dedans (`match_date` vu à
  `null` sur les exemples testés).
- `GET /api/v1/competitions/{competition_id}/rounds` — toutes les rondes d'une
  compétition, avec `round_number`, `date` (réelle, ex `2025-10-12T00:00:00Z`) et
  `board_results` par match. Donne round_number+date fiables, mais il faut connaître
  le `competition_id` (pas fourni directement par `player-matches`).
- `GET /api/v1/competitions` — liste toutes les compétitions (id, title, saison...) —
  sert à résoudre `competition_title` (texte) → `competition_id` (uuid) pour aller
  chercher les rondes.

### Déclenchement

Au prompt "Lien fiche FFE (vide = skip)" existant : si vide **et** que la study
contient des chapitres qui ne collent à aucun tournoi unique (au minimum : proposer
le mode vrac en fallback quand le lien FFE est laissé vide, plutôt que juste
abandonner l'enrichissement comme aujourd'hui) → **mode vrac**, traitement chapitre
par chapitre au lieu d'un batch sur toute la study.

### Matching par partie

1. Avant suppression, capturer le titre de chapitre existant (`ChapterName`) — le
   joueur le tape souvent lui-même en `B/N vs (Nom) (Elo)`, parsé en best-effort
   (couleur, nom si présent, elo si présent — aucun de ces trois n'est garanti).
2. Capturer aussi la date du chapitre (`Date`/`UTCDate` avant suppression) — date à
   laquelle la partie a été rentrée sur lichess, sert de signal de proximité.
3. Scorer les candidats de `player-matches` (mis en cache pour toute la session, un
   seul fetch) sur : couleur (si connue), similarité nom adversaire (réutiliser la
   logique de matching tokens de `fide.ts`), egalité elo adversaire (si connu),
   proximité de date (nécessite d'avoir résolu round_number+date via
   `/competitions/{id}/rounds` pour les candidats plausibles — résolution
   `competition_title → competition_id` une fois par compétition rencontrée, cache).
4. Un seul candidat net après scoring → auto-appliqué, pas de prompt.
5. Sinon → liste filtrée/triée affichée (compétition, adversaire, date, résultat),
   choix par numéro, ou skip (le chapitre reste tel quel, pas dans le merge).

### Tags posés en mode vrac

- `Round` = `round_number` grandroque (même mécanisme Interclubs et Coupe de France,
  pas de tentative de mapper vers des noms de phase genre "32e Finale" — pas fiable
  à déduire, `round_number` brut suffit)
- `Event` = `competition_title` grandroque (`Interclubs`, `Coupe de France`, ...)
- White/Black/Elo/Title/Result : mêmes règles que le flow FFE existant (ne remplace
  pas ce qui est déjà présent)
- `TimeControl` : `cadence_preset`/`cadence_exact` de la compétition grandroque
  (ex `"classical"`) — format à voir à l'implémentation, probablement moins riche
  que le texte FFE donc heuristique cadence (`parseBaseMinutes`) à adapter ou
  contourner (mapping direct `classical/rapid/blitz` → `classique/non-classique`,
  plus simple que de re-parser un texte)

### Pas encore tranché (détails d'implém, à régler en codant)

- Format exact de l'appel groupé round_number+date par candidat (une résolution
  `/rounds` par compétition rencontrée, mise en cache par `competition_id` pour
  la durée du run)
- Seuil de confiance exact pour "un seul candidat net" (nom exact + date proche
  suffit, ou faut aussi l'elo/couleur ?)

## Reste (phase 2, hors scope actuel)

- Sync auto vers en-croissant `.db3` (sqlite), 2 bases (classique / non-classique), schéma à inspecter

## Qui lance quoi

Toi lances `npm start` dans `/home/orieuxe/lichess-croissant` (input interactif, pas pilotable depuis mes outils).
