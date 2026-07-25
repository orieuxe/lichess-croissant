import { type StudyRef } from '../lichess.ts';
import { fetchFiche, fetchRounds, fetchClosedRounds, type FicheTournoi, type RoundResult } from '../ffe.ts';
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
import type { Category } from '../cadence.ts';
import type { RatingKind } from '../fide.ts';

export interface ParsedChapterTitle {
  color: 'B' | 'N';
  opponentName: string;
  opponentElo: string | null;
}

export function parseManualChapterTitle(chapterName: string): ParsedChapterTitle | null {
  const m = chapterName.match(/^(B|N)\s+(?:vs\.?|bs|contre)\s+(.+?)\s*(\d{3,4})?\s*$/i);
  if (!m) return null;
  return {
    color: m[1].toUpperCase() as 'B' | 'N',
    opponentName: m[2].trim(),
    opponentElo: m[3] ?? null,
  };
}

export function parseRoundNumbers(input: string): number[] {
  const trimmed = input.trim();
  if (!/^[\d\s,]+$/.test(trimmed)) return [];
  return trimmed.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !Number.isNaN(n));
}

export function parseExcludedIndices(input: string): Set<number> {
  return new Set(
    input.split(',').map(s => parseInt(s.trim(), 10) - 1).filter(n => !Number.isNaN(n)),
  );
}

export function chapterDateHint(game: string): Date | null {
  const raw = getTag(game, 'UTCDate') ?? getTag(game, 'Date');
  if (!raw || raw.includes('?')) return null;
  const d = new Date(raw.replace(/\./g, '-'));
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface MatchResult {
  fiche: FicheTournoi;
  ffeUrl: string;
  rounds: RoundResult[];
  ownElo: string;
  includedIndices: number[];
  ratingKind: RatingKind;
  category: Category | null;
}

function describeMatch(o: OurSideMatch): string {
  const date = (o.game.date || '').slice(0, 10);
  return `${o.game.competition_title} — ${o.ourSide === 'White' ? 'B' : 'N'} vs ${o.opponentName} (${o.opponentElo ?? '?'}) — ${o.game.result} — ${date} (r${o.game.round_number})`;
}

// mode manuel: pas de fiche FFE, pas de grandroque — deviner le nom depuis
// le ChapterName ou demander le FIDE id à la main.
async function runManualMode(
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

// Filters profile games to those belonging to one or more story-events.
// For tournament type: matches by tournament_id. For competition type:
// matches by competition_title (inexact — the same title appears across
// multiple seasons/divisions, but the user picked a specific one from the
// list which includes year, so in practice this is correct).
// Single tournament selected: chapters are in the same order as the
// filtered grandroque matches — positional pairing, no name lookup needed.
function positionalMatch(
  games: string[],
  filtered: ProfileGame[],
  ourName: string,
): { rounds: RoundResult[]; includedIndices: number[] } {
  const rounds: RoundResult[] = [];
  const includedIndices: number[] = [];
  const sorted = [...filtered].sort((a, b) => a.round_number - b.round_number);
  for (let i = 0; i < Math.min(games.length, sorted.length); i++) {
    const pg = sorted[i];
    const o = ourSideOf(pg, ourName);
    const color: 'B' | 'N' = o.ourSide === 'White' ? 'B' : 'N';
    if (o.opponentFideId) {
      const oppSide = color === 'B' ? 'Black' : 'White';
      games[i] = setTag(games[i], `${oppSide}FideId`, String(o.opponentFideId));
    }
    rounds.push({
      round: pg.round_number,
      color,
      result: resultRelativeToUs(pg.result, o.ourSide),
      opponentName: o.opponentName,
      opponentElo: o.opponentElo !== null ? String(o.opponentElo) : null,
      // pas de event: ici — single-tournament, l'Event partagé (study name) suffit
    });
    includedIndices.push(i);
  }
  return { rounds, includedIndices };
}

// Multiple tournaments: name-based matching with manual fallback.
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
    const hint = parseChapterHint(chapterName);
    const hintName = hint.opponentName ?? extractOpponentFromTitle(chapterName) ?? (chapterName.includes(' ') ? chapterName : '');
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
    const o = ourSideOf(pg, ourName);
    const color: 'B' | 'N' = o.ourSide === 'White' ? 'B' : 'N';
    if (o.opponentFideId) {
      const oppSide = color === 'B' ? 'Black' : 'White';
      games[i] = setTag(games[i], `${oppSide}FideId`, String(o.opponentFideId));
    }
    rounds.push({
      round: pg.round_number,
      color,
      result: resultRelativeToUs(pg.result, o.ourSide),
      opponentName: o.opponentName,
      opponentElo: o.opponentElo !== null ? String(o.opponentElo) : null,
      event: pg.competition_title,
    });
    includedIndices.push(i);
  }
  return { rounds, includedIndices, games };
}

// Manual pick from the filtered grandroque/FFE pool. When hintName is known,
// shows only the games that match that opponent. When hintName is empty (title
// couldn't be parsed at all), shows ALL remaining unmatched games as a last
// resort — sorted by date desc, most recent first.
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

// Group profile games by competition_title + first year (so multi-season
// competitions like "Interclubs" get separate entries for 2025 and 2026),
// show full names with counts, let the user pick. Returns a set of compound
// keys for filtering.
async function pickCompetitions(
  allGames: ProfileGame[],
  ask: (q: string) => Promise<string>,
): Promise<Set<string> | null> {
  const groups = new Map<string, { count: number; firstDate: string; lastDate: string }>();
  for (const g of allGames) {
    if (!g.date) continue;
    const y = g.date.slice(0, 4);
    const key = `${g.competition_title}|${y}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      if (g.date > existing.lastDate) existing.lastDate = g.date;
      if (g.date < existing.firstDate) existing.firstDate = g.date;
    } else {
      groups.set(key, { count: 1, firstDate: g.date, lastDate: g.date });
    }
  }
  const entries = [...groups.entries()]
    .map(([key, info]) => {
      const title = key.slice(0, key.lastIndexOf('|'));
      return { key, title, count: info.count, lastDate: info.lastDate, label: title };
    })
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  const PAGE = 10;
  const keys = new Set<string>();
  let offset = 0;
  while (true) {
    const slice = entries.slice(offset, offset + PAGE);
    console.log(`\nCompétitions (${offset + 1}-${Math.min(offset + PAGE, entries.length)}/${entries.length}) :`);
    slice.forEach((e, i) =>
      console.log(`  ${i + 1}. ${e.label} — ${e.count} parties — ${e.lastDate.slice(0, 10)}`));
    const hasMore = offset + PAGE < entries.length;
    const prompt = hasMore
      ? 'Numéro(s) (virgule, "+" = voir plus, vide = annuler) : '
      : 'Numéro(s) (virgule, vide = annuler) : ';
    const pick = (await ask(prompt)).trim();
    if (pick === '+') { offset += PAGE; continue; }
    if (!pick) return null;
    for (const n of pick.split(',').map(s => parseInt(s.trim(), 10) - 1)) {
      const entry = entries[offset + n];
      if (entry) keys.add(entry.key);
    }
    return keys.size ? keys : null;
  }
}

// The main entry point: picks the mode (FIDE/grandroque vs. manual),
// resolves the round/opponent data, and returns a MatchResult ready for
// enrichment.
export async function matchRound(
  study: StudyRef,
  initialFilename: string,
  initialGames: string[],
  ourFideId: string,
  ourName: string,
  ffeMatchName: string,
  ask: (q: string) => Promise<string>,
): Promise<{ match: MatchResult | null; filename: string; games: string[] }> {
  const filename = initialFilename;
  let games = initialGames;

  while (true) {
    const answer = (await ask('Partie FIDE officielle ? [O/n] ')).trim().toLowerCase();
    if (answer === 'n') {
      // mode manuel inchangé
      const { rounds, category, ratingKind } = await runManualMode(games, ask);
      const fiche: FicheTournoi = {
        title: study.name, startDate: '', endDate: '', numRounds: games.length, cadenceText: '', resultsLinks: {},
      };
      const includedIndices = games.map((_, i) => i);
      return { match: { fiche, ffeUrl: '', rounds, ownElo: '', includedIndices, ratingKind, category }, filename, games };
    }
    // vide ou 'o'/'oui' → flow grandroque
    if (answer !== '' && answer !== 'o' && answer !== 'oui') continue;

    // flow grandroque — fetch (réseau), puis matching (local)
    let slug: string | null;
    let allGames: ProfileGame[];
    try {
      slug = await fetchPlayerSlug(ourFideId);
    } catch {
      console.warn('Grandroque indisponible (slug).');
      const fallback = await askFfeLink(ask, games, ffeMatchName);
      if (fallback) return fallback;
      continue;
    }
    if (!slug) {
      console.warn('Joueur introuvable sur grandroque.');
      const fallback = await askFfeLink(ask, games, ffeMatchName);
      if (fallback) return fallback;
      continue;
    }

    try {
      allGames = await fetchProfileGames(slug);
    } catch {
      console.warn('Grandroque indisponible (games).');
      const fallback = await askFfeLink(ask, games, ffeMatchName);
      if (fallback) return fallback;
      continue;
    }
    if (allGames.length === 0) {
      console.warn('Aucune partie sur grandroque.');
      continue;
    }

    const selectedKeys = await pickCompetitions(allGames, ask);
    if (!selectedKeys) continue;

    const filtered = allGames.filter(g => g.date && selectedKeys.has(`${g.competition_title}|${g.date.slice(0, 4)}`));
    if (filtered.length === 0) {
      console.warn('Aucune partie trouvée pour les compétitions sélectionnées.');
      continue;
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
      continue;
    }

    const cadence = filtered[0].cadence;
    const category: Category = cadence === 'classical' ? 'classique' : 'non-classique';
    const ratingKind: RatingKind = cadence === 'classical' ? 'standardElo' : cadence === 'rapid' ? 'rapidElo' : 'blitzElo';

    const fiche: FicheTournoi = {
      title: study.name, startDate: '', endDate: '', numRounds: includedIndices.length, cadenceText: '', resultsLinks: {},
    };
    return { match: { fiche, ffeUrl: '', rounds, ownElo: '', includedIndices, ratingKind, category }, filename, games };
  }
}

// Fallback: ask for a FFE link and run the classic FFE scraper flow.
async function askFfeLink(
  ask: (q: string) => Promise<string>,
  games: string[],
  ffeMatchName: string,
): Promise<{ match: MatchResult; filename: string; games: string[] } | null> {
  const ffeUrlAnswer = await ask('Lien fiche FFE ou id du tournoi : ');
  if (!ffeUrlAnswer.trim()) return null;
  const raw = ffeUrlAnswer.trim();
  const ffeUrl = /^\d+$/.test(raw)
    ? `https://www.echecs.asso.fr/FicheTournoi.aspx?Ref=${raw}`
    : raw;

  const fiche = await fetchFiche(ffeUrl);
  let ownElo: string;
  let rounds: RoundResult[];
  if (fiche.resultsLinks.Ga) {
    ({ ownElo, rounds } = await fetchRounds(fiche.resultsLinks.Ga, ffeMatchName));
  } else if (fiche.resultsLinks.Pairing && fiche.resultsLinks.Berger) {
    ({ ownElo, rounds } = await fetchClosedRounds(fiche.resultsLinks.Pairing, fiche.resultsLinks.Berger, ffeMatchName));
  } else {
    console.warn('Format FFE non supporté.');
    return null;
  }

  const includedIndices = games.map((_, i) => i);
  if (includedIndices.length !== fiche.numRounds) {
    console.warn(`ALERTE: ${includedIndices.length} parties vs ${fiche.numRounds} rondes FFE.`);
    return null;
  }

  return { match: { fiche, ffeUrl, rounds, ownElo, includedIndices, ratingKind: 'standardElo', category: null }, filename: '', games };
}
