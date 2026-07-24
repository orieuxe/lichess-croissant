# Plan — lichess-croissant

## Fait (phase 1)

- Download study lichess (compte `timoruu` uniquement), suggestion via manifest `studyId → filename`
- Scraping FFE : fiche (dates/rondes/cadence/titre) + grille américaine (rondes/adversaires/elo), lien résultats découvert dynamiquement depuis la fiche (plus de `Action=Ga` en dur)
- Tournoi fermé/round-robin (que `Grille Berger`, pas de `Ga`) → alerte claire, skip enrichissement rondes, pas de parser Berger (pas de besoin réel encore)
- Exclusion manuelle de chapitres (ex: partie d'un autre joueur dans la study) si nb parties > nb rondes FFE, avec preview coups
- Cadence classée auto par seuil (≥60min = classique), table `cadence-map.json` en fallback si texte illisible
- Noms adversaire + soi-même reformatés "Nom, Prénom" via `lichess.org/api/fide/player`, demande l'ID FIDE si pas de match clair
- Tags posés : Round, Event (choix titre FFE / nom study / libre), White/Black, WhiteElo/BlackElo (adversaire + soi), Result (dérivé +/=/- FFE), TimeControl (texte cadence brut)
- UTCDate/UTCTime/ChapterName supprimés
- Push des tags vers lichess (`POST /api/study/{id}/{chapterId}/tags`)
- Merge : un fichier classique + un fichier non-classique (rapide+blitz), écrasés/renommés à chaque run, dédupliqué par `Site`
- `Date` du PGN jamais touché (celui posé par le retransmetteur en direct, fiable — FFE ne publie pas de calendrier ronde par ronde exploitable, confirmé sur Saint-Quentin 9 rondes/7 jours)
- Manifest écrit seulement en fin de flow réussi (pas juste après download)
- ESLint (single quotes + règles TS), `npm run lint`/`format`

## Limitation connue

Renommer le titre d'un chapitre existant ("B/N vs Nom, Prénom elo") : **pas possible via l'API publique lichess**, seuls les tags PGN sont modifiables, le titre n'est dérivé du PGN qu'à l'import initial. Feature request déposée : https://github.com/lichess-org/api/issues/660. À faire à la main sur lichess en attendant, ou si l'issue avance.

## Reste (phase 2, hors scope actuel)

- Sync auto vers en-croissant `.db3` (sqlite), 2 bases (classique / non-classique), schéma à inspecter

## Qui lance quoi

Toi lances `npm start` dans `/home/orieuxe/lichess-croissant` (input interactif, pas pilotable depuis mes outils).
