import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'git-test-'));
execFileSync('git', ['init', '-q'], { cwd: dir });
execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
mkdirSync(join(dir, 'downloaded'));
writeFileSync(join(dir, 'downloaded', 'a.pgn'), '[Event "x"]\n\n1. e4 *\n');
writeFileSync(join(dir, 'manifest.json'), '{}\n');
writeFileSync(join(dir, 'merged_classique_2026-01-01.pgn'), '[Event "x"]\n\n1. e4 *\n');

process.chdir(dir);
const { commitGameData, pushGithub } = await import('./git.ts');

assert.equal(commitGameData('a.pgn', 'Test Study'), true, 'commits when there is something to commit');
const subject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: dir }).toString().trim();
assert.equal(subject, 'feat: add Test Study games');

assert.equal(commitGameData('a.pgn', 'Test Study'), false, 'nothing left to commit the second time');

assert.doesNotThrow(() => pushGithub(), 'no remote configured — warns, never throws');

console.log('git.test.ts OK');
