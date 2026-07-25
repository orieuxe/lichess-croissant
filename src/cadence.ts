import type { RatingKind } from './fide.ts';

export type Category = 'classique' | 'non-classique';

const CADENCE_CATEGORY: Record<string, Category> = { classical: 'classique', rapid: 'non-classique', blitz: 'non-classique' };
const CADENCE_RATING: Record<string, RatingKind> = { classical: 'standardElo', rapid: 'rapidElo', blitz: 'blitzElo' };

export function cadenceToCategory(cadence: string): Category {
  return CADENCE_CATEGORY[cadence] ?? 'classique';
}

export function cadenceToRatingKind(cadence: string): RatingKind {
  return CADENCE_RATING[cadence] ?? 'standardElo';
}

export function parseBaseMinutes(cadenceText: string): number | null {
  const m = cadenceText.match(/(\d+)\s*h\s*(\d+)?|(\d+)\s*(?:'|mn|min)/i);
  if (!m) return null;
  if (m[1] !== undefined) return parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
  return parseInt(m[3], 10);
}

export async function classifyCadence(
  cadenceText: string,
  askCategory: (cadenceText: string) => Promise<Category>,
): Promise<Category> {
  const baseMinutes = parseBaseMinutes(cadenceText);
  if (baseMinutes !== null) return baseMinutes >= 60 ? 'classique' : 'non-classique';
  return askCategory(cadenceText);
}
