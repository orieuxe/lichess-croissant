import { getTag, previewMoves } from '../pgn.ts';
import type { RoundResult } from '../ffe.ts';
import type { Category } from '../cadence.ts';
import type { RatingKind } from '../fide.ts';

export interface ParsedChapterTitle {
  color: 'B' | 'N';
  opponentName: string;
  opponentElo: string | null;
}

// convention "B/N vs Nom, Prénom elo" tapée par le joueur lui-même
export function parseManualChapterTitle(chapterName: string): ParsedChapterTitle | null {
  const m = chapterName.match(/^(B|N)\s+(?:vs\.?|bs|contre)\s+(.+?)\s*(\d{3,4})?\s*$/i);
  if (!m) return null;
  return {
    color: m[1].toUpperCase() as 'B' | 'N',
    opponentName: m[2].trim(),
    opponentElo: m[3] ?? null,
  };
}

// mode manuel: pas de fiche FFE, pas de grandroque — deviner le nom depuis
// le ChapterName ou demander le FIDE id à la main.
export async function runManualMode(
  games: string[],
  ask: (q: string) => Promise<string>,
): Promise<{ rounds: RoundResult[]; category: Category; ratingKind: RatingKind }> {
  while (true) {
    const cadence = await ask('Cadence — [s] standard/classique, [r] rapide, [b] blitz : ');
    const c = cadence.trim().toLowerCase();
    let category: Category;
    let ratingKind: RatingKind;
    if (c === 's') {
      category = 'classique';
      ratingKind = 'standardElo';
    } else if (c === 'r') {
      category = 'non-classique';
      ratingKind = 'rapidElo';
    } else if (c === 'b') {
      category = 'non-classique';
      ratingKind = 'blitzElo';
    } else {
      continue;
    }

    const rounds: RoundResult[] = [];
    for (const [i, g] of games.entries()) {
      const chapterName = getTag(g, 'ChapterName') ?? '';
      const parsed = parseManualChapterTitle(chapterName);
      if (parsed) {
        rounds.push({ round: i + 1, color: parsed.color, result: null, opponentName: parsed.opponentName, opponentElo: parsed.opponentElo });
      } else {
        const colorAnswer = await ask(
          `Partie ${i + 1} (${chapterName || previewMoves(g, 10)}) — tu jouais Blanc ou Noir ? [b/n] `,
        );
        const color = colorAnswer.trim().toLowerCase().startsWith('n') ? 'N' : 'B';
        rounds.push({ round: i + 1, color, result: null, opponentName: null, opponentElo: null });
      }
    }
    return { rounds, category, ratingKind };
  }
}
