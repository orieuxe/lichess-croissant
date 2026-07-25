import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dbPath = join(tmpdir(), `enc-test-${Date.now()}.db3`);
const pgnPath = join(tmpdir(), `enc-test-${Date.now()}.pgn`);

const pgn = [
  '[Event "Test Event"]',
  '[Site "https://lichess.org/study/abc123/chap001"]',
  '[Date "2026.01.01"]',
  '[Round "1"]',
  '[White "Orieux, Etienne"]',
  '[WhiteElo "2240"]',
  '[Black "Doe, John"]',
  '[BlackElo "2000"]',
  '[Result "1-0"]',
  '[TimeControl "90+30"]',
  '',
  '1. e4 e5 2. Nf3 *',
  '',
  '',
  '[Event "Test Event"]',
  '[Site "https://lichess.org/study/abc123/chap002"]',
  '[Date "2026.01.02"]',
  '[Round "2"]',
  '[White "Doe, John"]',
  '[WhiteElo "2000"]',
  '[Black "Orieux, Etienne"]',
  '[BlackElo "2240"]',
  '[Result "0-1"]',
  '[TimeControl "90+30"]',
  '',
  '1. d4 d5 2. c4 *',
].join('\n');
writeFileSync(pgnPath, pgn);

const { syncToDb } = await import('./en-croissant.ts');

const n = syncToDb(pgnPath, dbPath);
assert.equal(n, 2, 'both games inserted into fresh DB');

const n2 = syncToDb(pgnPath, dbPath);
assert.equal(n2, 0, 'second run inserts nothing — already synced');

// verify data
const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(dbPath);
assert.equal((db.prepare('SELECT COUNT(*) as c FROM Games').get() as { c: number }).c, 2);
assert.equal((db.prepare('SELECT COUNT(*) as c FROM Players').get() as { c: number }).c, 2);
assert.equal((db.prepare('SELECT COUNT(*) as c FROM Events').get() as { c: number }).c, 1);
db.close();

unlinkSync(dbPath);
unlinkSync(pgnPath);

console.log('en-croissant.test.ts OK');
