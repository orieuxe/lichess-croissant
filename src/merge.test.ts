import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'merge-test-'));
process.chdir(dir);
const { mergeCategory } = await import('./merge.ts');

const gameA
  = '[Event "A"]\n[Site "https://lichess.org/study/x/1"]\n[Date "2025.01.01"]\n\n1. e4 *';
const gameB
  = '[Event "B"]\n[Site "https://lichess.org/study/x/2"]\n[Date "2025.03.15"]\n\n1. d4 *';

const file1 = mergeCategory('classique', [gameA, gameB]);
assert.equal(file1, 'merged_classique_2025-03-15.pgn');
assert.ok(existsSync(file1));

// second run: re-adds gameA (dup, should be deduped by Site tag) + a newer gameC
const gameC
  = '[Event "C"]\n[Site "https://lichess.org/study/x/3"]\n[Date "2025.06.01"]\n\n1. c4 *';
const file2 = mergeCategory('classique', [gameA, gameC]);
assert.equal(file2, 'merged_classique_2025-06-01.pgn');
assert.ok(!existsSync(file1), 'old merged file should be removed');

const content = readFileSync(file2, 'utf8');
assert.equal(
  (content.match(/\[Event /g) ?? []).length,
  3,
  'should have 3 unique games, not 4',
);

console.log('merge.test.ts OK');
