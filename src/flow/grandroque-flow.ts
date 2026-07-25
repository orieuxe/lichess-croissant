import { getTag, setTag, previewMoves } from '../pgn.ts';
import {
  fetchPlayerSlug,
  fetchProfileGames,
  matchGame,
  rankedGames,
  parseChapterHint,
  extractOpponentFromTitle,
  resultRelativeToUs,
  ourSideOf,
  type ProfileGame,
  type OurSideMatch,
} from '../grandroque.ts';
import { type FicheTournoi, type RoundResult } from '../ffe.ts';
import type { Category } from '../cadence.ts';
import type { RatingKind } from '../fide.ts';
import type { MatchResult } from './match-round.ts';

export { type CompetitionGroup } from './match-round.ts';

export function describeMatch(o: OurSideMatch): string {
  const date = (o.game.date || '').slice(0, 10);
  return `${o.game.competition_title} — ${o.ourSide === 'White' ? 'B' : 'N'} vs ${o.opponentName} (${o.opponentElo ?? '?'}) — ${o.game.result} — ${date} (r${o.game.round_number})`;
}

export function resolveHintName(chapterName: string): string {
  const hint = parseChapterHint(chapterName);
  return hint.opponentName ?? extractOpponentFromTitle(chapterName) ?? (chapterName.includes(' ') ? chapterName : '');
}

export function buildRoundFromMatch(
  game: string,
  pg: ProfileGame,
  ourName: string,
  event?: string,
): { game: string; round: RoundResult } {
  const o = ourSideOf(pg, ourName);
  const color: 'B' | 'N' = o.ourSide === 'White' ? 'B' : 'N';
  if (o.opponentFideId) {
    const oppSide = color === 'B' ? 'Black' : 'White';
    game = setTag(game, `${oppSide}FideId`, String(o.opponentFideId));
  }
  return {
    game,
    round: {
      round: pg.round_number,
      color,
      result: resultRelativeToUs(pg.result, o.ourSide),
      opponentName: o.opponentName,
      opponentElo: o.opponentElo !== null ? String(o.opponentElo) : null,
      event,
    },
  };
}

export function positionalMatch(
  games: string[],
  filtered: ProfileGame[],
  ourName: string,
): { rounds: RoundResult[]; includedIndices: number[] } {
  const rounds: RoundResult[] = [];
  const includedIndices: number[] = [];
  const sorted = [...filtered].sort((a, b) => a.round_number - b.round_number);
  for (let i = 0; i < Math.min(games.length, sorted.length); i++) {
    const { game, round } = buildRoundFromMatch(games[i], sorted[i], ourName);
    games[i] = game;
    rounds.push(round);
    includedIndices.push(i);
  }
  return { rounds, includedIndices };
}

async function nameBasedMatch(
  games: string[],
  filtered: ProfileGame[],
  ourName: string,
  ask: (q: string) => Promise<string>,
): Promise<{ rounds: RoundResult[]; includedIndices: number[]; games: string[] }> {
  const rounds: RoundResult[] = [];
  const includedIndices: number[] = [];
  const usedIds = new Set<string>();

  for (const [i, g] of games.entries()) {
    const chapterName = getTag(g, 'ChapterName') ?? '';
    const hintName = resolveHintName(chapterName);
    const available = filtered.filter(c => !usedIds.has(c.id));
    let pg: ProfileGame | null = hintName ? matchGame(hintName, available, ourName) : null;

    if (pg) {
      const o = ourSideOf(pg, ourName);
      console.log(`Partie ${i + 1} (${chapterName || previewMoves(g, 10)}) — auto : ${describeMatch(o)}`);
    } else {
      pg = await manualPick(i, g, chapterName, hintName, filtered, usedIds, ourName, ask);
      if (!pg) continue;
    }

    usedIds.add(pg.id);
    const { game: updated, round } = buildRoundFromMatch(games[i], pg, ourName, pg.competition_title);
    games[i] = updated;
    rounds.push(round);
    includedIndices.push(i);
  }
  return { rounds, includedIndices, games };
}

async function manualPick(
  i: number,
  g: string,
  chapterName: string,
  hintName: string,
  candidates: ProfileGame[],
  usedIds: Set<string>,
  ourName: string,
  ask: (q: string) => Promise<string>,
): Promise<ProfileGame | null> {
  const available = candidates.filter(c => !usedIds.has(c.id));
  const options = hintName
    ? rankedGames(hintName, available, ourName)
    : available.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (options.length === 0 && hintName) {
    console.log(`Partie ${i + 1} (${chapterName || previewMoves(g, 10)}) — "${hintName}" introuvable dans les événements sélectionnés, chapitre exclu.`);
    return null;
  }
  if (options.length === 0) {
    console.log(`Partie ${i + 1} (${chapterName || previewMoves(g, 10)}) — aucun candidat, chapitre exclu.`);
    return null;
  }
  console.log(`\nPartie ${i + 1} (${chapterName || previewMoves(g, 10)}) — choisis :`);
  options.forEach((pg, idx) => {
    const o = ourSideOf(pg, ourName);
    console.log(`  ${idx + 1}. ${describeMatch(o)}`);
  });
  const pick = await ask('Numéro (vide = exclure ce chapitre) : ');
  const idx = parseInt(pick.trim(), 10) - 1;
  if (!options[idx]) {
    console.log('Chapitre exclu.');
    return null;
  }
  return options[idx];
}

export function groupCompetitions(allGames: ProfileGame[]): { id: string; title: string; count: number; lastDate: string }[] {
  const groups = new Map<string, { title: string; count: number; lastDate: string }>();
  for (const g of allGames) {
    const id = g.competition_id ?? g.tournament_id ?? '';
    if (!id) continue;
    const existing = groups.get(id);
    if (existing) {
      existing.count++;
      if (g.date && g.date > (existing.lastDate || '')) existing.lastDate = g.date;
    } else {
      groups.set(id, { title: g.competition_title, count: 1, lastDate: g.date || '' });
    }
  }
  return [...groups.entries()]
    .map(([id, info]) => ({ id, ...info }))
    .sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));
}

export function filterGamesByKeys(games: ProfileGame[], keys: Set<string>): ProfileGame[] {
  return games.filter(g => keys.has(g.competition_id ?? g.tournament_id ?? ''));
}

async function pickCompetitions(
  groups: { id: string; title: string; count: number; lastDate: string }[],
  ask: (q: string) => Promise<string>,
): Promise<Set<string> | null> {
  const PAGE = 10;
  const keys = new Set<string>();
  let offset = 0;
  while (true) {
    const slice = groups.slice(offset, offset + PAGE);
    console.log(`\nCompétitions (${offset + 1}-${Math.min(offset + PAGE, groups.length)}/${groups.length}) :`);
    slice.forEach((e, i) =>
      console.log(`  ${i + 1}. ${e.title} — ${e.count} parties — ${e.lastDate.slice(0, 10)}`));
    const hasMore = offset + PAGE < groups.length;
    const prompt = hasMore
      ? 'Numéro(s) (virgule, "+" = voir plus, vide = annuler) : '
      : 'Numéro(s) (virgule, vide = annuler) : ';
    const pick = (await ask(prompt)).trim();
    if (pick === '+') {
      offset += PAGE;
      continue;
    }
    if (!pick) return null;
    for (const n of pick.split(',').map(s => parseInt(s.trim(), 10) - 1)) {
      const entry = groups[offset + n];
      if (entry) keys.add(entry.id);
    }
    return keys.size ? keys : null;
  }
}

// Full grandroque flow: fetch → pick competitions → filter → match.
export async function runGrandroqueFlow(
  games: string[],
  ourFideId: string,
  ourName: string,
  studyName: string,
  ask: (q: string) => Promise<string>,
  ffeFallback: (games: string[], ask: (q: string) => Promise<string>) => Promise<MatchResult | null>,
): Promise<{ match: MatchResult | null; games: string[] }> {
  let slug: string | null;
  try {
    slug = await fetchPlayerSlug(ourFideId);
  } catch {
    console.warn('Grandroque indisponible (slug).');
    return { match: await ffeFallback(games, ask), games };
  }
  if (!slug) {
    console.warn('Joueur introuvable sur grandroque.');
    return { match: await ffeFallback(games, ask), games };
  }

  let allGames: ProfileGame[];
  try {
    allGames = await fetchProfileGames(slug);
  } catch {
    console.warn('Grandroque indisponible (games).');
    return { match: await ffeFallback(games, ask), games };
  }
  if (allGames.length === 0) {
    console.warn('Aucune partie sur grandroque.');
    return { match: null, games };
  }

  const competitionGroups = groupCompetitions(allGames);
  const selectedKeys = await pickCompetitions(competitionGroups, ask);
  if (!selectedKeys) return { match: null, games };

  const filtered = filterGamesByKeys(allGames, selectedKeys);
  if (filtered.length === 0) {
    console.warn('Aucune partie trouvée pour les compétitions sélectionnées.');
    return { match: null, games };
  }

  let rounds: RoundResult[];
  let includedIndices: number[];
  if (selectedKeys.size === 1) {
    ({ rounds, includedIndices } = positionalMatch(games, filtered, ourName));
  } else {
    ({ rounds, includedIndices, games } = await nameBasedMatch(games, filtered, ourName, ask));
  }

  if (includedIndices.length === 0) {
    console.warn('ALERTE: aucune partie matchée.');
    return { match: null, games };
  }

  const cadence = filtered[0].cadence;
  const category: Category = cadence === 'classical' ? 'classique' : 'non-classique';
  const ratingKind: RatingKind = cadence === 'classical' ? 'standardElo' : cadence === 'rapid' ? 'rapidElo' : 'blitzElo';

  const fiche: FicheTournoi = {
    title: studyName, startDate: '', endDate: '', numRounds: includedIndices.length, cadenceText: '', resultsLinks: {},
  };
  return { match: { fiche, ffeUrl: '', rounds, ownElo: '', includedIndices, ratingKind, category }, games };
}
