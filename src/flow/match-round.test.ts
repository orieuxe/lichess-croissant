import assert from 'node:assert/strict';
import { parseManualChapterTitle, parseRoundNumbers, parseExcludedIndices } from './match-round.ts';

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

console.log('match-round.test.ts OK');
