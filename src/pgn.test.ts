import assert from 'node:assert/strict';
import { splitGames, getTag, setTag, removeTag, previewMoves } from './pgn.ts';

const sample = `[Event "A"]
[Date "2025.01.01"]

1. e4 e5 1-0


[Event "B"]
[Date "2025.01.02"]

1. d4 d5 0-1
`;

const games = splitGames(sample);
assert.equal(games.length, 2);
assert.equal(getTag(games[0], 'Event'), 'A');
assert.equal(getTag(games[1], 'Date'), '2025.01.02');
assert.equal(getTag(games[0], 'Round'), null);

const withRound = setTag(games[0], 'Round', '3');
assert.equal(getTag(withRound, 'Round'), '3');
const reReplaced = setTag(withRound, 'Round', '4');
assert.equal(getTag(reReplaced, 'Round'), '4');
assert.equal((reReplaced.match(/\[Round /g) ?? []).length, 1);

const withUtc = `[Event "A"]\n[UTCDate "2025.01.01"]\n[UTCTime "12:00:00"]\n[Date "2025.01.01"]\n\n1. e4 *`;
const withoutUtc = removeTag(removeTag(withUtc, 'UTCDate'), 'UTCTime');
assert.equal(getTag(withoutUtc, 'UTCDate'), null);
assert.equal(getTag(withoutUtc, 'UTCTime'), null);
assert.equal(getTag(withoutUtc, 'Date'), '2025.01.01');
assert.equal(removeTag(withUtc, 'NotPresent'), withUtc);

const annotated = `[Event "C"]

1. e4 { [%eval 0.2] } e5 (1... c5 2. Nf3) 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 1-0`;
assert.equal(previewMoves(annotated, 8), '1. e4 e5 2. Nf3 Nc6 3. Bb5');

console.log('pgn.test.ts OK');
