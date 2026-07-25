import { setTag, getTag, removeTag, resultFromFfe } from '../pgn.ts';
import type { FicheTournoi, RoundResult } from '../ffe.ts';
import type { ResolvedFideName, RatingKind } from '../fide.ts';

function tagIf(game: string, tag: string, value: string | number | undefined | null): string {
  return value != null && value !== '' && !getTag(game, tag) ? setTag(game, tag, String(value)) : game;
}

export interface EnrichParams {
  games: string[];
  includedIndices: number[];
  rounds: RoundResult[];
  fiche: FicheTournoi;
  ffeUrl: string;
  eventValue: string;
  our: ResolvedFideName;
  ratingKind: RatingKind;
  ourEloValue: string;
}

export interface EnrichCallbacks {
  askResult: (title: string) => Promise<'+' | '=' | '-'>;
  askFideId: (ffeName: string) => Promise<string>;
  askOpponentFideId: () => Promise<ResolvedFideName>;
  resolveFideName: (name: string, askFideId: (n: string) => Promise<string>) => Promise<ResolvedFideName>;
  resolveFideById: (id: string) => Promise<ResolvedFideName | null>;
}

// Tags every included game with Round/Event/Result/opponent+own identity+Elo,
// mutating nothing in place — returns a new games array with only the
// includedIndices entries touched. All FIDE/prompt side effects go through
// the injected callbacks, so this is testable without hitting the network
// or a real terminal.
export async function enrichGames(params: EnrichParams, cb: EnrichCallbacks): Promise<string[]> {
  const { games, includedIndices, rounds, fiche, ffeUrl, eventValue, our, ratingKind, ourEloValue } = params;
  const result = [...games];
  const opponentNameCache = new Map<string, ResolvedFideName>();

  for (const [roundIdx, gameIdx] of includedIndices.entries()) {
    const r = rounds[roundIdx];
    let g = result[gameIdx];
    g = setTag(g, 'Round', String(r.round));
    g = setTag(g, 'Event', r.event ?? eventValue);
    if (ffeUrl) { g = setTag(g, 'EventURL', ffeUrl); }
    g = removeTag(g, 'UTCDate');
    g = removeTag(g, 'UTCTime');
    g = removeTag(g, 'ChapterName');

    if (r.color) {
      const ourSide = r.color === 'B' ? 'White' : 'Black';
      const oppSide = r.color === 'B' ? 'Black' : 'White';

      // résoudre l'adversaire d'abord — le prompt résultat en a besoin
      let opponent: ResolvedFideName | null = null;
      const existingOppFideId = getTag(g, `${oppSide}FideId`);
      if (existingOppFideId) { opponent = await cb.resolveFideById(existingOppFideId); }
      if (!opponent) {
        if (r.opponentName) {
          if (!opponentNameCache.has(r.opponentName)) {
            opponentNameCache.set(r.opponentName, await cb.resolveFideName(r.opponentName, cb.askFideId));
          }
          opponent = opponentNameCache.get(r.opponentName)!;
        } else {
          opponent = await cb.askOpponentFideId();
        }
      }

      const currentResult = getTag(g, 'Result');
      if (r.result) {
        const ffeResult = resultFromFfe(r.result, ourSide);
        if (!currentResult || currentResult === '*') { g = setTag(g, 'Result', ffeResult); }
      } else if (!currentResult || currentResult === '*') {
        const manual = await cb.askResult(`${r.round} - ${r.color}/${opponent.name}`);
        g = setTag(g, 'Result', resultFromFfe(manual, ourSide));
      }

      // toujours écraser par le nom normalisé FIDE, même si lichess en a déjà un
      g = setTag(g, oppSide, opponent.name);
      g = tagIf(g, `${oppSide}Title`, opponent.title);
      g = tagIf(g, `${oppSide}FideId`, opponent.fideId);
      const oppRatingElo = opponent[ratingKind];
      const oppElo = r.opponentElo?.replace(/\s*F$/, '') || (oppRatingElo ? String(oppRatingElo) : '');
      g = tagIf(g, `${oppSide}Elo`, oppElo);

      g = setTag(g, ourSide, our.name);
      g = tagIf(g, `${ourSide}Title`, our.title);
      g = tagIf(g, `${ourSide}FideId`, our.fideId);
      const ourRatingElo = our[ratingKind];
      const ownEloTag = ourEloValue || (ourRatingElo ? String(ourRatingElo) : '');
      g = tagIf(g, `${ourSide}Elo`, ownEloTag);
    }

    if (fiche.cadenceText) { g = setTag(g, 'TimeControl', fiche.cadenceText); }
    result[gameIdx] = g;
  }

  return result;
}
