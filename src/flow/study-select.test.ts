import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'study-select-test-'));
process.chdir(dir);
const { pickStudy } = await import('./study-select.ts');
const { loadIgnored } = await import('../lichess.ts');

const studies = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
  { id: 'c', name: 'C' },
];

function scripted(answers: string[]) {
  let i = 0;
  return async () => answers[i++];
}

const picked = await pickStudy(studies, {}, [], scripted(['i2', '1']));
assert.deepEqual(picked, { id: 'a', name: 'A' }, 'ignores #2 (B) then picks #1 of what remains (A)');
assert.deepEqual(loadIgnored(), ['b'], 'ignore persisted to disk');

const quit = await pickStudy(studies, {}, [], scripted(['']));
assert.equal(quit, undefined, 'blank input quits');

await assert.rejects(
  () => pickStudy(studies, {}, [], scripted(['999'])),
  /choix invalide/,
  'out-of-range number throws',
);

console.log('study-select.test.ts OK');
