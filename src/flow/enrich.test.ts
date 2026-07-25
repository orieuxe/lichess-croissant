import assert from 'node:assert/strict';
import { enrichGames } from './enrich.ts';
import { getTag } from '../pgn.ts';
import type { FicheTournoi, RoundResult } from '../ffe.ts';
import type { ResolvedFideName } from '../fide.ts';

const game = (extra = '') =>
  `[Event "?"]\n[White "?"]\n[Black "?"]\n[Result "*"]${extra}\n\n1. e4 e5 *`;

const our: ResolvedFideName = { name: 'Orieux, Etienne', fideId: '45185743', blitzElo: 2118 };

const ficheManual: FicheTournoi = {
  title: 'Rapide pizza', startDate: '', endDate: '', numRounds: 1, cadenceText: '', resultsLinks: {},
};

const noCallbackNeeded = {
  askResult: async () => { throw new Error('should not ask for a result'); },
  askFideId: async () => { throw new Error('should not ask for a FIDE id'); },
  askOpponentFideId: async () => { throw new Error('should not ask for an opponent'); },
  resolveFideName: async () => { throw new Error('should not search by name'); },
  resolveFideById: async () => { throw new Error('should not fetch by id'); },
};

// Regression: our own Elo used to be silently dropped whenever ourEloValue
// (FFE-sourced) was empty — mode manuel always hits this, since there's no
// FFE fiche at all there. Must fall back to our[ratingKind].
{
  const rounds: RoundResult[] = [{ round: 1, color: 'B', result: null, opponentName: 'Samuel DUBUISSON', opponentElo: null }];
  const askResult = async () => '+' as const;
  const resolveFideName = async () => ({ name: 'Dubuisson, Samuel', blitzElo: 1900 }) satisfies ResolvedFideName;

  const [result] = await enrichGames(
    {
      games: [game()],
      includedIndices: [0],
      rounds,
      fiche: ficheManual,
      ffeUrl: '',
      eventValue: 'Rapide pizza',
      our,
      ratingKind: 'blitzElo',
      ourEloValue: '',
    },
    { ...noCallbackNeeded, askResult, resolveFideName },
  );

  assert.equal(getTag(result, 'WhiteElo'), '2118', 'own Elo falls back to our[ratingKind]');
  assert.equal(getTag(result, 'BlackElo'), '1900', 'opponent Elo falls back to opponent[ratingKind]');
  assert.equal(getTag(result, 'Result'), '1-0', 'manual result [1] gagné as White -> 1-0');
  assert.equal(getTag(result, 'White'), 'Orieux, Etienne');
  assert.equal(getTag(result, 'Black'), 'Dubuisson, Samuel');
  assert.equal(getTag(result, 'EventURL'), null, 'no EventURL tag when ffeUrl is blank (mode manuel)');
  assert.equal(getTag(result, 'TimeControl'), null, 'no TimeControl tag when cadenceText is blank');
}

// Already-tagged FideId (previous run, or typed by hand on lichess) skips
// name search / prompting entirely.
{
  const rounds: RoundResult[] = [{ round: 1, color: 'N', result: '=', opponentName: 'Someone Else', opponentElo: null }];
  const resolveFideById = async (id: string) => {
    assert.equal(id, '527060055');
    return { name: 'Gomes, Jean-Pierre', standardElo: 1618 } satisfies ResolvedFideName;
  };

  const [result] = await enrichGames(
    {
      games: [game('\n[WhiteFideId "527060055"]')],
      includedIndices: [0],
      rounds,
      fiche: ficheManual,
      ffeUrl: '',
      eventValue: 'x',
      our,
      ratingKind: 'standardElo',
      ourEloValue: '',
    },
    { ...noCallbackNeeded, resolveFideById },
  );

  assert.equal(getTag(result, 'White'), 'Gomes, Jean-Pierre', 'resolved via the existing WhiteFideId tag, not by name');
  assert.equal(getTag(result, 'WhiteElo'), '1618');
  assert.equal(getTag(result, 'Result'), '1/2-1/2', 'FFE result "=" -> draw regardless of color');
}

// FFE data already gives a decisive result — askResult must not fire.
{
  const rounds: RoundResult[] = [{ round: 1, color: 'B', result: '+', opponentName: 'X', opponentElo: '1500' }];
  const resolveFideName = async () => ({ name: 'X, Y' }) satisfies ResolvedFideName;

  const [result] = await enrichGames(
    {
      games: [game()],
      includedIndices: [0],
      rounds,
      fiche: { ...ficheManual, cadenceText: '15+10' },
      ffeUrl: 'https://www.echecs.asso.fr/FicheTournoi.aspx?Ref=1',
      eventValue: 'x',
      our,
      ratingKind: 'standardElo',
      ourEloValue: '2240',
    },
    { ...noCallbackNeeded, resolveFideName },
  );

  assert.equal(getTag(result, 'Result'), '1-0');
  assert.equal(getTag(result, 'EventURL'), 'https://www.echecs.asso.fr/FicheTournoi.aspx?Ref=1');
  assert.equal(getTag(result, 'TimeControl'), '15+10');
  assert.equal(getTag(result, 'WhiteElo'), '2240', 'FFE-sourced ourEloValue takes priority over the FIDE fallback');
}

// r.color null (round couldn't be resolved to a color at all) — the whole
// identity/result block is skipped, only the generic tags get set.
{
  const rounds: RoundResult[] = [{ round: 1, color: null, result: null, opponentName: null, opponentElo: null }];
  const [result] = await enrichGames(
    {
      games: [game()],
      includedIndices: [0],
      rounds,
      fiche: ficheManual,
      ffeUrl: '',
      eventValue: 'x',
      our,
      ratingKind: 'standardElo',
      ourEloValue: '',
    },
    noCallbackNeeded,
  );
  assert.equal(getTag(result, 'Round'), '1');
  assert.equal(getTag(result, 'Result'), '*', 'untouched — no color, nothing to derive a result from');
  assert.equal(getTag(result, 'White'), '?', 'untouched — no callback allowed to fire');
}

console.log('enrich.test.ts OK');
