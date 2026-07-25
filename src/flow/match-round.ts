import { readFileSync } from 'node:fs';
import { downloadStudy, type StudyRef } from '../lichess.ts';
import { fetchFiche, fetchRounds, fetchClosedRounds, type FicheTournoi, type RoundResult } from '../ffe.ts';
import { splitGames, getTag, setTag, previewMoves } from '../pgn.ts';
import {
  fetchPlayerMatches,
  bestMatch,
  topCandidates,
  parseChapterHint,
  resultRelativeToUs,
  toGrandroqueName,
  type MatchHint,
} from '../grandroque.ts';
import type { Category } from '../cadence.ts';
import type { RatingKind } from '../fide.ts';

export interface ParsedChapterTitle {
  color: 'B' | 'N';
  opponentName: string;
  opponentElo: string | null;
}

// convention "B/N vs Nom, Prénom elo" tapée par le joueur lui-même (voir
// desiredChapterTitle dans cli.ts) — best-effort, rien de garanti.
export function parseManualChapterTitle(chapterName: string): ParsedChapterTitle | null {
  const m = chapterName.match(/^(B|N)\s+vs\s+(.+?)(?:\s+(\d{3,4}))?\s*$/i);
  if (!m) return null;
  return {
    color: m[1].toUpperCase() as 'B' | 'N',
    opponentName: m[2].trim(),
    opponentElo: m[3] ?? null,
  };
}

// Bye-round prompt: only treat the input as round numbers if the WHOLE
// string looks like one, so free text ("laisse tel quel") isn't misread as
// a number buried in a sentence.
export function parseRoundNumbers(input: string): number[] {
  const trimmed = input.trim();
  if (!/^[\d\s,]+$/.test(trimmed)) return [];
  return trimmed.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !Number.isNaN(n));
}

// Exclude-games prompt: lenient, 1-based numbers -> 0-based indices.
export function parseExcludedIndices(input: string): Set<number> {
  return new Set(
    input.split(',').map(s => parseInt(s.trim(), 10) - 1).filter(n => !Number.isNaN(n)),
  );
}

// Chapter Date/UTCDate (before it's stripped) as a proximity signal for
// grandroque matching — best-effort, missing/"?" dates are common.
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

// mode manuel: pas de fiche FFE donc pas de cadence texte à classifier — on
// demande direct le format, ce qui donne à la fois la catégorie de merge et
// quel rating FIDE (standard/rapide/blitz) piocher pour les Elo.
async function askCadenceKind(
  ask: (q: string) => Promise<string>,
): Promise<{ category: Category; ratingKind: RatingKind }> {
  while (true) {
    const answer = (await ask('Cadence — [s] standard/classique, [r] rapide, [b] blitz : '))
      .trim()
      .toLowerCase();
    if (answer === 's') return { category: 'classique', ratingKind: 'standardElo' };
    if (answer === 'r') return { category: 'non-classique', ratingKind: 'rapidElo' };
    if (answer === 'b') return { category: 'non-classique', ratingKind: 'blitzElo' };
  }
}

async function askMode(ask: (q: string) => Promise<string>): Promise<'ffe' | 'vrac' | 'manuel'> {
  while (true) {
    const answer = (await ask(
      'Tournoi solo FFE [f], compétition par équipe [e] (interclubs/coupe de France), parties non officielles [m] : ',
    )).trim().toLowerCase();
    if (answer.startsWith('f')) return 'ffe';
    if (answer.startsWith('e')) return 'vrac';
    if (answer.startsWith('m')) return 'manuel';
  }
}

// mode vrac (grandroque, PLAN.md) : pas de fiche FFE unique, chaque chapitre
// est matché indépendamment contre l'historique grandroque du joueur (un
// seul fetch, mis en cache pour tout le run). Round n'est pas le vrai
// round_number grandroque — resolvable seulement via /competitions/{id}/rounds,
// et competition_title n'est PAS unique (250+ "Coupe de France" distinctes,
// aucun filtre serveur) donc retrouver le bon competition_id coûterait un
// scan de tous les candidats. À la place : Round = compteur local, incrémenté
// à chaque partie matchée pour cette compétition dans CE run.
async function runVracMode(
  games: string[],
  grandroqueName: string,
  studyName: string,
  ask: (q: string) => Promise<string>,
): Promise<MatchResult | null> {
  const candidates = await fetchPlayerMatches(grandroqueName);
  if (candidates.length === 0) {
    console.warn(`ALERTE: aucune partie grandroque trouvée pour "${grandroqueName}".`);
    return null;
  }

  const rounds: RoundResult[] = [];
  const includedIndices: number[] = [];
  const roundCounters = new Map<string, number>();

  for (const [i, g] of games.entries()) {
    const chapterName = getTag(g, 'ChapterName') ?? '';
    const hint: MatchHint = { ...parseChapterHint(chapterName), date: chapterDateHint(g) };
    let matched = bestMatch(candidates, grandroqueName, hint);

    if (!matched) {
      const options = topCandidates(candidates, grandroqueName, hint);
      if (options.length === 0) {
        console.log(`Partie ${i + 1} (${chapterName || previewMoves(g, 10)}) — aucun candidat grandroque, chapitre exclu.`);
        continue;
      }
      console.log(`\nPartie ${i + 1} (${chapterName || previewMoves(g, 10)}) — plusieurs candidats grandroque :`);
      options.forEach((o, idx) => {
        const date = o.match.created_at.slice(0, 10);
        console.log(
          `  ${idx + 1}. ${o.match.competition_title} — ${o.ourSide === 'White' ? 'B' : 'N'} vs ${o.opponentName} (${o.opponentElo ?? '?'}) — ${o.match.result} — ${date} — ${o.match.white_team_name} vs ${o.match.black_team_name}`,
        );
      });
      const pick = await ask('Numéro (vide = exclure ce chapitre) : ');
      const idx = parseInt(pick.trim(), 10) - 1;
      if (!options[idx]) {
        console.log('Chapitre exclu.');
        continue;
      }
      matched = options[idx];
    }

    const eventTitle = matched.match.competition_title;
    const nextRound = (roundCounters.get(eventTitle) ?? 0) + 1;
    roundCounters.set(eventTitle, nextRound);

    const color: 'B' | 'N' = matched.ourSide === 'White' ? 'B' : 'N';
    if (matched.opponentFideId) {
      const oppSide = color === 'B' ? 'Black' : 'White';
      games[i] = setTag(games[i], `${oppSide}FideId`, String(matched.opponentFideId));
    }

    rounds.push({
      round: nextRound,
      color,
      result: resultRelativeToUs(matched.match.result, matched.ourSide),
      opponentName: matched.opponentName,
      opponentElo: matched.opponentElo !== null ? String(matched.opponentElo) : null,
      event: eventTitle,
    });
    includedIndices.push(i);
  }

  if (includedIndices.length === 0) {
    console.warn('ALERTE: aucune partie matchée en mode vrac.');
    return null;
  }

  const fiche: FicheTournoi = {
    title: studyName,
    startDate: '',
    endDate: '',
    numRounds: includedIndices.length,
    cadenceText: '',
    resultsLinks: {},
  };

  // ponytail: pas de cadence_preset côté player-matches (vivrait sur l'objet
  // compétition, qu'on ne résout pas) — interclubs/coupe de France sont
  // ~toujours classique en pratique, donc classique par défaut plutôt qu'un
  // appel API de plus pour un cas marginal.
  return { fiche, ffeUrl: '', rounds, ownElo: '', includedIndices, ratingKind: 'standardElo', category: 'classique' };
}

// The mode-select / FFE-link / mode-manuel / mode-vrac loop: resolve which
// rounds/opponents apply to this download, retrying on a bad link or a
// games/rounds-count mismatch, until a usable match is built.
export async function matchRound(
  study: StudyRef,
  initialFilename: string,
  initialGames: string[],
  ourFideName: string,
  ask: (q: string) => Promise<string>,
): Promise<{ match: MatchResult | null; filename: string; games: string[] }> {
  let filename = initialFilename;
  let games = initialGames;
  // FFE displays names as "SURNAME Firstname", no comma; grandroque wants
  // the same shape but is case-sensitive server-side (see toGrandroqueName).
  const ffeMatchName = ourFideName.replace(',', '');
  const grandroqueName = toGrandroqueName(ourFideName);

  while (true) {
    const mode = await askMode(ask);

    let fiche: FicheTournoi;
    let ffeUrl = '';
    let ownElo = '';
    let rounds: RoundResult[];
    let ratingKind: RatingKind = 'standardElo';
    let manualCategory: Category | null = null;

    if (mode === 'vrac') {
      const vracMatch = await runVracMode(games, grandroqueName, study.name, ask);
      if (!vracMatch) continue;
      return { match: vracMatch, filename, games };
    }

    if (mode === 'manuel') {
      // pas de confirmation supplémentaire ici — le "n" final à
      // "Sauvegarder ?" couvre déjà le cas "en fait j'annule tout".
      ({ category: manualCategory, ratingKind } = await askCadenceKind(ask));

      fiche = {
        title: study.name,
        startDate: '',
        endDate: '',
        numRounds: games.length,
        cadenceText: '',
        resultsLinks: {},
      };
      rounds = [];
      for (const [i, g] of games.entries()) {
        const chapterName = getTag(g, 'ChapterName') ?? '';
        const parsed = parseManualChapterTitle(chapterName);
        let color: 'B' | 'N';
        let opponentName: string | null = null;
        let opponentElo: string | null = null;
        if (parsed) {
          ({ color, opponentName, opponentElo } = parsed);
        } else {
          const colorAnswer = await ask(
            `Partie ${i + 1} (${chapterName || previewMoves(g, 10)}) — tu jouais Blanc ou Noir ? [b/n] `,
          );
          color = colorAnswer.trim().toLowerCase().startsWith('n') ? 'N' : 'B';
        }
        rounds.push({ round: i + 1, color, result: null, opponentName, opponentElo });
      }
    } else {
      const ffeUrlAnswer = await ask('Lien fiche FFE ou id du tournoi : ');
      if (!ffeUrlAnswer.trim()) continue;
      const raw = ffeUrlAnswer.trim();
      ffeUrl = /^\d+$/.test(raw)
        ? `https://www.echecs.asso.fr/FicheTournoi.aspx?Ref=${raw}`
        : raw;

      fiche = await fetchFiche(ffeUrl);

      if (fiche.resultsLinks.Ga) {
        ({ ownElo, rounds } = await fetchRounds(fiche.resultsLinks.Ga, ffeMatchName));
      } else if (fiche.resultsLinks.Pairing && fiche.resultsLinks.Berger) {
        // closed/round-robin tournament: no Grille Américaine, same data lives
        // across the Pairing (round-by-round) and Berger (name→Elo) pages.
        ({ ownElo, rounds } = await fetchClosedRounds(
          fiche.resultsLinks.Pairing,
          fiche.resultsLinks.Berger,
          ffeMatchName,
        ));
      } else {
        console.warn(
          `ALERTE: pas de "Grille Américaine" ni de "Pairing"+"Berger" pour ce tournoi (formats dispo: ${Object.keys(fiche.resultsLinks).join(', ')}) — enrichissement rondes/adversaires non supporté.`,
        );
        continue;
      }
    }

    const byeRounds = new Set<number>();
    while (games.length < fiche.numRounds - byeRounds.size) {
      const retry = await ask(
        `\n${games.length} parties téléchargées, ${fiche.numRounds - byeRounds.size} rondes attendues — ajoute les parties manquantes sur la study lichess puis Entrée pour réessayer, numéro(s) de ronde non jouée (bye/forfait, virgule) si c'est ça, ou texte quelconque pour abandonner ce lien : `,
      );
      const roundNumbers = parseRoundNumbers(retry);
      if (roundNumbers.length) {
        roundNumbers.forEach(n => byeRounds.add(n));
        continue;
      }
      if (retry.trim()) break;
      filename = await downloadStudy(study.id);
      games = splitGames(readFileSync(`downloaded/${filename}`, 'utf8'));
      console.log(`Retéléchargé : downloaded/${filename} (${games.length} parties)`);
    }
    if (byeRounds.size) {
      rounds = rounds.filter(r => !byeRounds.has(r.round));
      console.log(`Rondes ${[...byeRounds].join(', ')} exclues (bye/forfait déclaré).`);
    }
    const expectedRounds = fiche.numRounds - byeRounds.size;

    let includedIndices = games.map((_, i) => i);
    if (games.length > expectedRounds) {
      console.log(
        `\n${games.length} parties téléchargées, ${expectedRounds} rondes attendues — laquelle exclure ?`,
      );
      games.forEach((g, i) => {
        const chapter = getTag(g, 'ChapterName') ?? getTag(g, 'Event') ?? '?';
        console.log(`  ${i + 1}. ${chapter} — ${previewMoves(g, 12)}`);
      });
      const excludeAnswer = await ask('Numéros à exclure (virgule, vide = aucun) : ');
      const excluded = parseExcludedIndices(excludeAnswer);
      includedIndices = includedIndices.filter(i => !excluded.has(i));
    }

    if (includedIndices.length !== expectedRounds) {
      console.warn(
        `ALERTE: ${includedIndices.length} parties retenues vs ${expectedRounds} rondes attendues (mauvais lien ? mauvais tournoi ?).`,
      );
      continue;
    }

    const match: MatchResult = { fiche, ffeUrl, rounds, ownElo, includedIndices, ratingKind, category: manualCategory };
    return { match, filename, games };
  }
}
