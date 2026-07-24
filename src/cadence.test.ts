import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.chdir(mkdtempSync(join(tmpdir(), 'cadence-test-')));
const { parseBaseMinutes, classifyCadence } = await import('./cadence.ts');

assert.equal(parseBaseMinutes('1h30/40 - 30\' + [30"]'), 90);
assert.equal(parseBaseMinutes("60' + [30'']"), 60);
assert.equal(parseBaseMinutes('1h'), 60);
assert.equal(parseBaseMinutes('25\' + 10"'), 25);
assert.equal(parseBaseMinutes('garbage'), null);

assert.equal(
  await classifyCadence('1h30/40 - 30\' + [30"]', async () => 'non-classique'),
  'classique',
);
assert.equal(
  await classifyCadence('25\' + 10"', async () => 'classique'),
  'non-classique',
);

let asked = false;
const cat = await classifyCadence('format bizarre', async () => {
  asked = true;
  return 'classique';
});
assert.equal(asked, true);
assert.equal(cat, 'classique');
assert.equal(
  await classifyCadence('format bizarre', async () => 'non-classique'),
  'classique',
);

console.log('cadence.test.ts OK');
