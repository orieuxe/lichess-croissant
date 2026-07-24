# Plan — suite phase 1

## Fixes en cours (suite aux questions)

1. **Cadence auto-classée par seuil**, pas juste table manuelle.
   Règle : temps de base ≥ 60 min (`1h`, `60'`, `1h30`, ...) → `classique` automatique.
   < 60 min → `non-classique` automatique.
   Table `cadence-map.json` gardée seulement comme fallback si le texte est
   illisible (format jamais vu) — dans ce cas on demande, comme avant.

2. **Dates de ronde** : pas touchées, `Date` reste celui du PGN lichess
   (posé par le retransmetteur en direct, généralement fiable). Confirmé
   nécessaire vu Saint-Quentin (9 rondes / 7 jours, pas 1 ronde = 1 jour,
   FFE ne publie pas de calendrier ronde par ronde exploitable).

3. **Lien résultats FFE découvert dynamiquement**, plus construit en dur
   sur `Action=Ga`. La fiche liste les formats dispos (`Ga`, `Berger`,
   `Fide`, ...) — on scrape le vrai lien.
   - Tournoi ouvert (Suisse) → `Grille Américaine` (`Ga`), déjà supporté.
   - Tournoi fermé/round-robin (ex Ref=72157) → seulement `Grille Berger`,
     format tableau différent, **pas encore de parser**. Pour l'instant :
     détecté → alerte claire, skip enrichissement rondes/adversaires
     (le `TimeControl` est quand même posé, ça n'a pas besoin des rondes).
     Parser Berger = travail futur si besoin réel se présente.

## Qui lance quoi

Toi lances `npm start` dans `/home/orieuxe/lichess-croissant` (input
interactif, je ne peux pas piloter un vrai stdin bidirectionnel). Objectif
confirmé : que tu puisses le faire seul, sans moi, une fois stable.

## Ordre d'exécution

1. Coder le seuil cadence (`src/cadence.ts`)
2. Coder la découverte de lien résultats + détection Berger (`src/ffe.ts`, `src/cli.ts`)
3. Mettre à jour les tests (`npm test`)
4. Commit + push
5. Toi : `npm start`, teste avec Saint-Quentin (Ref=69309) en vrai
