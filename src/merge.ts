import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { splitGames, getTag } from './pgn.ts';
import type { Category } from './cadence.ts';

function gameKey(game: string): string {
  return getTag(game, 'Site') ?? getTag(game, 'ChapterURL') ?? game;
}

function lastGameDate(games: string[]): string {
  const dates = games
    .map(g => getTag(g, 'Date'))
    .filter((d): d is string => !!d && !d.includes('?'))
    .map(d => d.replace(/\./g, '-'));
  return dates.sort().at(-1) ?? new Date().toISOString().slice(0, 10);
}

function existingMergedFile(category: Category): string | null {
  const prefix = `merged_${category}_`;
  const found = readdirSync('.').find(
    f => f.startsWith(prefix) && f.endsWith('.pgn'),
  );
  return found ?? null;
}

export function mergeCategory(category: Category, newGames: string[]): string {
  const existingFile = existingMergedFile(category);
  const existingGames = existingFile
    ? splitGames(readFileSync(existingFile, 'utf8'))
    : [];

  const seen = new Map<string, string>();
  for (const g of [...existingGames, ...newGames]) { seen.set(gameKey(g), g); }
  const allGames = [...seen.values()];

  const date = lastGameDate(allGames);
  const newFile = `merged_${category}_${date}.pgn`;

  writeFileSync(newFile, allGames.join('\n\n\n') + '\n');
  if (existingFile && existingFile !== newFile) { unlinkSync(existingFile); }
  return newFile;
}
