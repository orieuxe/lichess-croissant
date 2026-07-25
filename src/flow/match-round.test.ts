import assert from 'node:assert/strict';
import { parseManualChapterTitle, parseRoundNumbers, parseExcludedIndices, chapterDateHint, groupCompetitions, filterGamesByKeys, positionalMatch, buildRoundFromMatch } from './match-round.ts';
import type { ProfileGame } from '../grandroque.ts';

const game = (overrides: Partial<ProfileGame> = {}): ProfileGame => ({
  id: 'g1', date: '2026-01-01T00:00:00Z', competition_title: 'Test', competition_id: 'c1', tournament_id: null,
  board_number: 1, round_number: 1,
  white_player_name: 'ORIEUX Etienne', white_elo: 2272, white_fide_id: 45185743,
  black_player_name: 'OPPONENT Name', black_elo: 2000, black_fide_id: null,
  result: '1-0', cadence: 'classical', source_type: 'historical_match',
  ...overrides,
});

// --- groupCompetitions ---
{
  const groups = groupCompetitions([
    game({ competition_title: 'Tournoi A', competition_id: 'c1' }),
    game({ id: 'g2', competition_title: 'Tournoi A', competition_id: 'c1', round_number: 2 }),
    game({ id: 'g3', competition_title: 'Tournoi B', competition_id: 'c2', date: '2026-02-01T00:00:00Z' }),
  ]);
  assert.equal(groups.length, 2, 'two distinct competition ids -> two groups');
  // sorted by lastDate desc: Tournoi B (2026-02) first, Tournoi A (2026-01) second
  assert.equal(groups[0].title, 'Tournoi B');
  assert.equal(groups[1].title, 'Tournoi A');
  assert.equal(groups[1].count, 2);
}

// group by tournament_id (individual tournaments)
{
  const groups = groupCompetitions([
    game({ competition_title: 'Open', competition_id: null, tournament_id: 't1' }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, 't1');
}

// games with neither competition_id nor tournament_id are skipped
{
  const groups = groupCompetitions([
    game({ competition_id: null, tournament_id: null }),
    game({ id: 'g2', competition_id: 'c1' }),
  ]);
  assert.equal(groups.length, 1);
}

// null dates don't crash the sort
{
  groupCompetitions([
    game({ competition_id: 'c1', date: '' }),
    game({ id: 'g2', competition_id: 'c2', date: '2026-01-01T00:00:00Z' }),
  ]);
  // no throw -> pass
}

// --- filterGamesByKeys ---
{
  const games = [
    game({ competition_id: 'c1', competition_title: 'A' }),
    game({ id: 'g2', competition_id: 'c2', competition_title: 'B' }),
  ];
  const filtered = filterGamesByKeys(games, new Set(['c1']));
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].competition_title, 'A');
}

// --- positionalMatch ---
{
  const games = ['[ChapterName "B vs Opponent 2000"]\n\n1. e4 *'];
  const { rounds, includedIndices } = positionalMatch(games, [
    game({ round_number: 3 }),
  ], 'Etienne ORIEUX');
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].round, 3, 'uses real round_number from grandroque');
  assert.equal(rounds[0].color, 'B');
  assert.equal(rounds[0].opponentName, 'OPPONENT Name');
  assert.equal(includedIndices.length, 1);
}

// positionalMatch: fewer filtered games than chapters -> only matches up to min
{
  const games = ['', '', ''].map(() => '[ChapterName "x"]\n\n1. e4 *');
  const { rounds } = positionalMatch(games, [game()], 'Etienne ORIEUX');
  assert.equal(rounds.length, 1);
}

// positionalMatch: pre-tags opponent FideId on the game
{
  const pgnGames = ['[ChapterName "B vs Opponent"]\n\n1. e4 *'];
  positionalMatch(pgnGames, [game({ black_fide_id: 12345 })], 'Etienne ORIEUX');
  assert.ok(pgnGames[0].includes('[BlackFideId "12345"]'), 'opponent FideId pre-tagged on the PGN');
}

// --- buildRoundFromMatch ---
{
  const pg = game({ black_fide_id: 12345 });
  const { game: updated, round } = buildRoundFromMatch('[ChapterName "B vs Opponent"]\n\n1. e4 *', pg, 'Etienne ORIEUX');
  assert.equal(round.round, 1);
  assert.equal(round.color, 'B');
  assert.equal(round.result, '+', '1-0 as White -> +');
  assert.equal(round.event, undefined, 'no event arg -> undefined');
  assert.ok(updated.includes('[BlackFideId "12345"]'), 'FideId pre-tagged');
}
{
  const { round } = buildRoundFromMatch('[Event "x"]\n\n1. e4 *', game({ black_fide_id: null }), 'Etienne ORIEUX', 'Coupe de France');
  assert.equal(round.event, 'Coupe de France');
}
{
  const pg = game({ white_player_name: 'A', black_player_name: 'Etienne ORIEUX', white_elo: 2200, black_elo: 2272, result: '0-1' });
  const { round } = buildRoundFromMatch('[]\n\n1. e4 *', pg, 'Etienne ORIEUX');
  assert.equal(round.color, 'N');
  assert.equal(round.result, '+', '0-1 as Black -> + (we won)');
  assert.equal(round.opponentName, 'A');
}

console.log('match-round.test.ts OK');

assert.deepEqual(
  parseManualChapterTitle('B vs Dubuisson, Samuel 2173'),
  { color: 'B', opponentName: 'Dubuisson, Samuel', opponentElo: '2173' },
);
assert.deepEqual(
  parseManualChapterTitle('N vs Jean-Pierre Gomes'),
  { color: 'N', opponentName: 'Jean-Pierre Gomes', opponentElo: null },
  'no elo in the title is fine',
);
assert.equal(parseManualChapterTitle('some random chapter title'), null, 'no B/N vs convention => null');
assert.equal(parseManualChapterTitle(''), null);

assert.deepEqual(parseRoundNumbers('3'), [3]);
assert.deepEqual(parseRoundNumbers('3, 5'), [3, 5]);
assert.deepEqual(parseRoundNumbers(''), [], 'blank => no round numbers');
assert.deepEqual(
  parseRoundNumbers('laisse tel quel, ronde 3'),
  [],
  'free text isn\'t misread as round numbers, even with a digit inside',
);

assert.deepEqual(parseExcludedIndices('1, 3'), new Set([0, 2]), '1-based input -> 0-based indices');
assert.deepEqual(parseExcludedIndices(''), new Set());
assert.deepEqual(parseExcludedIndices('x, 2'), new Set([1]), 'garbage tokens dropped, valid ones kept');

const withUtcDate = '[Event "x"]\n[UTCDate "2026.06.08"]\n[Date "2026.06.08"]\n\n1. e4 *';
assert.equal(chapterDateHint(withUtcDate)?.toISOString().slice(0, 10), '2026-06-08');
const dateOnly = '[Event "x"]\n[Date "2026.06.07"]\n\n1. e4 *';
assert.equal(chapterDateHint(dateOnly)?.toISOString().slice(0, 10), '2026-06-07', 'falls back to Date when no UTCDate');
assert.equal(chapterDateHint('[Event "x"]\n[Date "????.??.??"]\n\n1. e4 *'), null, 'unknown date -> null');
assert.equal(chapterDateHint('[Event "x"]\n\n1. e4 *'), null, 'no date tag at all -> null');

console.log('match-round.test.ts OK');
