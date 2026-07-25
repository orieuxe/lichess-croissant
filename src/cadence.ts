import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { RatingKind } from './fide.ts';

const CADENCE_MAP_PATH = 'cadence-map.json';

export type Category = 'classique' | 'non-classique';

const CADENCE_CATEGORY: Record<string, Category> = { classical: 'classique', rapid: 'non-classique', blitz: 'non-classique' };
const CADENCE_RATING: Record<string, RatingKind> = { classical: 'standardElo', rapid: 'rapidElo', blitz: 'blitzElo' };

export function cadenceToCategory(cadence: string): Category {
  return CADENCE_CATEGORY[cadence] ?? 'classique';
}

export function cadenceToRatingKind(cadence: string): RatingKind {
  return CADENCE_RATING[cadence] ?? 'standardElo';
}

export function loadCadenceMap(): Record<string, Category> {
  if (!existsSync(CADENCE_MAP_PATH)) { return {}; }
  return JSON.parse(readFileSync(CADENCE_MAP_PATH, 'utf8'));
}

export function saveCadenceMap(map: Record<string, Category>): void {
  writeFileSync(CADENCE_MAP_PATH, JSON.stringify(map, null, 2) + '\n');
}

// ponytail: only reads the base time (before increment/moves-to-go), FIDE-style
// classique/rapide/blitz split by base time isn't attempted — user only wants
// a classique vs non-classique cut at 60 min.
export function parseBaseMinutes(cadenceText: string): number | null {
  const m = cadenceText.match(/(\d+)\s*h\s*(\d+)?|(\d+)\s*(?:'|mn|min)/i);
  if (!m) { return null; }
  if (m[1] !== undefined) { return parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0); }
  return parseInt(m[3], 10);
}

export async function classifyCadence(
  cadenceText: string,
  askCategory: (cadenceText: string) => Promise<Category>,
): Promise<Category> {
  const map = loadCadenceMap();
  if (cadenceText in map) { return map[cadenceText]; }

  const baseMinutes = parseBaseMinutes(cadenceText);
  if (baseMinutes !== null) { return baseMinutes >= 60 ? 'classique' : 'non-classique'; }

  const category = await askCategory(cadenceText);
  map[cadenceText] = category;
  saveCadenceMap(map);
  return category;
}
