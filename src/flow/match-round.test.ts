import assert from 'node:assert/strict';
import { parseManualChapterTitle, parseRoundNumbers, parseExcludedIndices, chapterDateHint } from './match-round.ts';

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
