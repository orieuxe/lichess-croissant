import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

// git add -A with a glob pathspec errors out if that glob matches nothing at
// all (e.g. only one of the two categories has ever been merged) — resolve
// the merged_*.pgn files ourselves so we only ever pass literal, existing paths.
function mergedFiles(): string[] {
  return readdirSync('.').filter(
    f => (f.startsWith('merged_classique_') || f.startsWith('merged_non-classique_')) && f.endsWith('.pgn'),
  );
}

// Auto-commit only the data files this run touched — never src/, so an
// in-progress code change on the branch can't get swept into a data commit.
// Local only — pushGithub is a separate, later step so a manual pgn tweak
// can slot in before anything external happens.
export function commitGameData(filename: string, studyName: string): boolean {
  try {
    execFileSync('git', [
      'add', '-A', '--',
      `downloaded/${filename}`, 'manifest.json',
      ...mergedFiles(),
    ]);
    execFileSync('git', ['commit', '-m', `feat: add ${studyName} games`]);
    console.log('Commit git créé (données seulement).');
    return true;
  } catch (err) {
    console.warn(`git commit sauté (${(err as Error).message.split('\n')[0]})`);
    return false;
  }
}

export function pushGithub(): void {
  try {
    execFileSync('git', ['push']);
    console.log('Poussé sur github.');
  } catch (err) {
    console.warn(`git push échoué (${(err as Error).message.split('\n')[0]})`);
  }
}
