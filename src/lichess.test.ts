import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'lichess-test-'));
mkdirSync(join(dir, 'downloaded'));
writeFileSync(
  join(dir, 'downloaded', 'a.pgn'),
  '[Event "x"]\n[Site "https://lichess.org/study/abc123/chapXYZ"]\n\n1. e4 *\n',
);
writeFileSync(
  join(dir, 'downloaded', 'b.pgn'),
  '[Event "y"]\n[Site "https://lichess.org/notastudy"]\n\n1. d4 *\n',
);

process.chdir(dir);
const { loadManifest, studiesNotDownloaded } = await import('./lichess.ts');

const manifest = loadManifest();
assert.deepEqual(manifest, { abc123: 'a.pgn' });

const remaining = studiesNotDownloaded(
  [
    { id: 'abc123', name: 'Already have' },
    { id: 'def456', name: 'New one' },
  ],
  manifest,
);
assert.deepEqual(remaining, [{ id: 'def456', name: 'New one' }]);

console.log('lichess.test.ts OK');
