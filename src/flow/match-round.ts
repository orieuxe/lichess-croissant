import { type StudyRef } from '../lichess.ts';
import { type FicheTournoi, type RoundResult } from '../ffe.ts';
import { getTag } from '../pgn.ts';
import type { Category } from '../cadence.ts';
import type { RatingKind } from '../fide.ts';
import { runGrandroqueFlow } from './grandroque-flow.ts';
import { runManualMode } from './manual-flow.ts';
import { askFfeLink } from './ffe-flow.ts';

export interface MatchResult {
  fiche: FicheTournoi;
  ffeUrl: string;
  rounds: RoundResult[];
  ownElo: string;
  includedIndices: number[];
  ratingKind: RatingKind;
  category: Category | null;
}

export interface CompetitionGroup {
  id: string;
  title: string;
  count: number;
  lastDate: string;
}

export function parseRoundNumbers(input: string): number[] {
  const trimmed = input.trim();
  if (!/^[\d\s,]+$/.test(trimmed)) { return []; }
  return trimmed.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !Number.isNaN(n));
}

export function parseExcludedIndices(input: string): Set<number> {
  return new Set(
    input.split(',').map(s => parseInt(s.trim(), 10) - 1).filter(n => !Number.isNaN(n)),
  );
}

export function chapterDateHint(game: string): Date | null {
  const raw = getTag(game, 'UTCDate') ?? getTag(game, 'Date');
  if (!raw || raw.includes('?')) { return null; }
  const d = new Date(raw.replace(/\./g, '-'));
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function matchRound(
  study: StudyRef,
  initialFilename: string,
  initialGames: string[],
  ourFideId: string,
  ourName: string,
  ffeMatchName: string,
  ask: (q: string) => Promise<string>,
): Promise<{ match: MatchResult | null; filename: string; games: string[] }> {
  const games = initialGames;

  while (true) {
    const answer = (await ask('Partie FIDE officielle ? [O/n] ')).trim().toLowerCase();
    if (answer === 'n') {
      const { rounds, category, ratingKind } = await runManualMode(games, ask);
      const fiche: FicheTournoi = {
        title: study.name, startDate: '', endDate: '', numRounds: games.length, cadenceText: '', resultsLinks: {},
      };
      return { match: { fiche, ffeUrl: '', rounds, ownElo: '', includedIndices: games.map((_, i) => i), ratingKind, category }, filename: initialFilename, games };
    }
    if (answer !== '' && answer !== 'o' && answer !== 'oui') { continue; }

    const ffeFallback = (g: string[], a: (q: string) => Promise<string>) =>
      askFfeLink(g, ffeMatchName, a);

    const { match, games: updated } = await runGrandroqueFlow(games, ourFideId, ourName, study.name, ask, ffeFallback);
    if (match) { return { match, filename: initialFilename, games: updated }; }
    continue;
  }
}
