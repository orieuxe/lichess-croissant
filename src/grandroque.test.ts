import assert from 'node:assert/strict';
import { bestMatch, topCandidates, parseChapterHint, ourSideOf, resultRelativeToUs, toGrandroqueName } from './grandroque.ts';

assert.equal(toGrandroqueName('Orieux, Etienne'), 'ORIEUX Etienne');
assert.equal(toGrandroqueName('Kham-Nguyen, Mathys'), 'KHAM-NGUYEN Mathys');
assert.equal(toGrandroqueName('NoComma'), 'NOCOMMA', 'no comma at all -> just uppercase, best effort');

const ourName = 'ORIEUX Etienne';

assert.deepEqual(parseChapterHint('B vs Muthaiah AL 2442'), {
  color: 'White',
  opponentName: 'Muthaiah AL',
  opponentElo: 2442,
});
assert.deepEqual(parseChapterHint('N vs Bailet, Pierre'), {
  color: 'Black',
  opponentName: 'Bailet, Pierre',
  opponentElo: null,
});
assert.deepEqual(parseChapterHint('Chapter 3'), {
  color: null,
  opponentName: null,
  opponentElo: null,
});

const candidates = [
  {
    id: '1',
    team_match_id: 't1',
    board_number: 1,
    white_player_name: 'ORIEUX Etienne',
    white_player_elo: 2272,
    white_fide_id: 45185743,
    black_player_name: 'HAREUX Hubert',
    black_player_elo: 2168,
    black_fide_id: 1234567,
    result: '1/2-1/2',
    created_at: '2026-06-08T16:04:45Z',
    competition_title: 'Coupe de France',
    white_team_name: 'Lille Universite Club N1',
    black_team_name: 'La Diagonale de Nomain N3',
  },
  {
    id: '2',
    team_match_id: 't2',
    board_number: 2,
    white_player_name: 'DANIEL Antoine',
    white_player_elo: 1938,
    white_fide_id: 7654321,
    black_player_name: 'ORIEUX Etienne',
    black_player_elo: 2272,
    black_fide_id: 45185743,
    result: '0-1',
    created_at: '2026-06-07T12:33:45Z',
    competition_title: 'Coupe de France',
    white_team_name: 'Luc Edn - Lille N2',
    black_team_name: 'Boulogne sur Mer N1',
  },
];

const own = ourSideOf(candidates[0], ourName);
assert.equal(own.ourSide, 'White');
assert.equal(own.opponentName, 'HAREUX Hubert');
assert.equal(own.opponentElo, 2168);
assert.equal(own.opponentFideId, 1234567);

// unambiguous: color + name + elo all point at candidate 1
const clear = bestMatch(candidates, ourName, {
  color: 'White',
  opponentName: 'Hareux Hubert',
  opponentElo: 2168,
  date: null,
});
assert.equal(clear?.match.id, '1');

// no hints at all -> every candidate scores 0 -> no match
const noHints = bestMatch(candidates, ourName, {
  color: null,
  opponentName: null,
  opponentElo: null,
  date: null,
});
assert.equal(noHints, null);

// color hint alone is enough to disambiguate when only one candidate has it
const colorOnly = bestMatch(candidates, ourName, {
  color: 'Black',
  opponentName: null,
  opponentElo: null,
  date: null,
});
assert.equal(colorOnly?.match.id, '2');

// ambiguous (both candidates plausible, no clean winner) -> caller gets a
// ranked list instead of a guess.
const ambiguous = bestMatch(candidates, ourName, { color: null, opponentName: null, opponentElo: null, date: null });
assert.equal(ambiguous, null);
const ranked = topCandidates(candidates, ourName, { color: null, opponentName: null, opponentElo: null, date: null });
assert.equal(ranked.length, 2, 'no threshold — both come back for the human to pick from');

assert.equal(resultRelativeToUs('1-0', 'White'), '+');
assert.equal(resultRelativeToUs('1-0', 'Black'), '-');
assert.equal(resultRelativeToUs('0-1', 'White'), '-');
assert.equal(resultRelativeToUs('0-1', 'Black'), '+');
assert.equal(resultRelativeToUs('1/2-1/2', 'White'), '=');
assert.equal(resultRelativeToUs('1/2-1/2', 'Black'), '=');
assert.equal(resultRelativeToUs('*', 'White'), null, 'unrecognized/ongoing -> null');

console.log('grandroque.test.ts OK');
