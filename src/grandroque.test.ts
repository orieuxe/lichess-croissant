import assert from 'node:assert/strict';
import { matchGame, rankedGames, parseChapterHint, ourSideOf, resultRelativeToUs, fetchPlayerSlug, type ProfileGame } from './grandroque.ts';

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

const candidates: ProfileGame[] = [
  {
    id: '1', date: '2026-06-08T00:00:00Z', competition_title: 'Interclubs', competition_id: null, tournament_id: null,
    board_number: 1, round_number: 3,
    white_player_name: 'ORIEUX Etienne', white_elo: 2272, white_fide_id: 45185743,
    black_player_name: 'HAREUX Hubert', black_elo: 2168, black_fide_id: 1234567,
    result: '1/2-1/2', cadence: 'classical', source_type: 'competition_board_result',
  },
  {
    id: '2', date: '2026-06-07T00:00:00Z', competition_title: 'Coupe de France', competition_id: null, tournament_id: null,
    board_number: 2, round_number: 1,
    white_player_name: 'DANIEL Antoine', white_elo: 1938, white_fide_id: 7654321,
    black_player_name: 'ORIEUX Etienne', black_elo: 2272, black_fide_id: 45185743,
    result: '0-1', cadence: 'classical', source_type: 'competition_board_result',
  },
  {
    id: '3', date: '2026-06-06T00:00:00Z', competition_title: 'Interclubs Rapide', competition_id: null, tournament_id: null,
    board_number: 1, round_number: 1,
    white_player_name: 'ORIEUX Etienne', white_elo: 2272, white_fide_id: 45185743,
    black_player_name: 'HAREUX Hubert', black_elo: 2168, black_fide_id: 1234567,
    result: '1-0', cadence: 'rapid', source_type: 'competition_board_result',
  },
];

const ourName = 'Etienne ORIEUX';

const own = ourSideOf(candidates[0], ourName);
assert.equal(own.ourSide, 'White');
assert.equal(own.opponentName, 'HAREUX Hubert');
assert.equal(own.opponentElo, 2168);
assert.equal(own.opponentFideId, 1234567);

// unambiguous: only one candidate with "Hareux" -> auto-match
const clear = matchGame('Hareux Hubert', [candidates[0], candidates[1]], ourName);
assert.equal(clear?.id, '1', 'unique name match -> auto');
// candidates 0 and 2 both have HAREUX Hubert -> ambiguous tie
const tie = matchGame('Hareux Hubert', [candidates[0], candidates[2]], ourName);
assert.equal(tie, null, 'two candidates with same opponent name -> no auto');
const none = matchGame('Personne Inconnue', [candidates[0]], ourName);
assert.equal(none, null);

const ranked = rankedGames('Hareux Hubert', [candidates[0], candidates[2]], ourName);
assert.equal(ranked.length, 2, 'both candidates with Hareux appear ranked (equal score)');

assert.equal(resultRelativeToUs('1-0', 'White'), '+');
assert.equal(resultRelativeToUs('1-0', 'Black'), '-');
assert.equal(resultRelativeToUs('0-1', 'White'), '-');
assert.equal(resultRelativeToUs('0-1', 'Black'), '+');
assert.equal(resultRelativeToUs('1/2-1/2', 'White'), '=');
assert.equal(resultRelativeToUs('*', 'White'), null);

// live smoke test for slug resolution (no mock — real API call, player exists)
const slug = await fetchPlayerSlug('45185743');
assert.equal(slug, 'etienne-orieux');

console.log('grandroque.test.ts OK');
