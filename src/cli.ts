import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import {
  listStudies,
  downloadStudy,
  loadManifest,
  saveManifest,
  studiesNotDownloaded,
} from './lichess.ts';
import { fetchFiche, fetchRounds } from './ffe.ts';
import { classifyCadence, type Category } from './cadence.ts';
import { splitGames, setTag, getTag, previewMoves } from './pgn.ts';
import { mergeCategory } from './merge.ts';
import { resolveFideName } from './fide.ts';

const LICHESS_USERNAME = 'timoruu';
const FFE_PLAYER_NAME = process.env.FFE_PLAYER_NAME ?? 'ORIEUX Etienne';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => rl.question(q);

async function askCategory(cadenceText: string): Promise<Category> {
  const answer = await ask(
    `Cadence FFE inconnue: "${cadenceText}"\nclassique ou non-classique ? [c/n] `,
  );
  return answer.trim().toLowerCase().startsWith('n')
    ? 'non-classique'
    : 'classique';
}

async function askFideId(ffeName: string): Promise<string> {
  return ask(
    `Pas de correspondance FIDE claire pour "${ffeName}" — ID FIDE (vide = garder tel quel) : `,
  );
}

async function main() {
  const manifest = loadManifest();
  const studies = await listStudies(LICHESS_USERNAME);
  const suggestions = studiesNotDownloaded(studies, manifest);

  console.log(`\nStudies pas encore téléchargées (${suggestions.length}) :`);
  suggestions.forEach((s, i) => console.log(`  ${i + 1}. ${s.name}`));

  const choice = await ask('\nNuméro à télécharger (vide = quitter) : ');
  if (!choice.trim()) {
    rl.close();
    return;
  }
  const study = suggestions[parseInt(choice, 10) - 1];
  if (!study) throw new Error('choix invalide');

  const filename = await downloadStudy(study.id);
  console.log(`Téléchargé : downloaded/${filename}`);

  const games = splitGames(readFileSync(`downloaded/${filename}`, 'utf8'));

  let match: {
    fiche: Awaited<ReturnType<typeof fetchFiche>>;
    rounds: Awaited<ReturnType<typeof fetchRounds>>['rounds'];
    includedIndices: number[];
  } | null = null;

  while (true) {
    const ffeUrl = await ask('Lien fiche FFE (vide = skip) : ');
    if (!ffeUrl.trim()) break;

    const fiche = await fetchFiche(ffeUrl.trim());

    if (!fiche.resultsLinks.Ga) {
      console.warn(
        `ALERTE: pas de "Grille Américaine" pour ce tournoi (probablement fermé/round-robin, formats dispo: ${Object.keys(fiche.resultsLinks).join(', ')}) — enrichissement rondes/adversaires non supporté.`,
      );
      continue;
    }

    const { rounds } = await fetchRounds(
      fiche.resultsLinks.Ga,
      FFE_PLAYER_NAME,
    );

    let includedIndices = games.map((_, i) => i);
    if (games.length > fiche.numRounds) {
      console.log(
        `\n${games.length} parties téléchargées, ${fiche.numRounds} rondes annoncées — laquelle exclure ?`,
      );
      games.forEach((g, i) => {
        const chapter = getTag(g, 'ChapterName') ?? getTag(g, 'Event') ?? '?';
        console.log(`  ${i + 1}. ${chapter} — ${previewMoves(g, 12)}`);
      });
      const excludeAnswer = await ask(
        'Numéros à exclure (virgule, vide = aucun) : ',
      );
      const excluded = new Set(
        excludeAnswer
          .split(',')
          .map(s => parseInt(s.trim(), 10) - 1)
          .filter(n => !Number.isNaN(n)),
      );
      includedIndices = includedIndices.filter(i => !excluded.has(i));
    }

    if (includedIndices.length !== fiche.numRounds) {
      console.warn(
        `ALERTE: ${includedIndices.length} parties retenues vs ${fiche.numRounds} rondes annoncées sur la FFE (mauvais lien ? mauvais tournoi ?).`,
      );
      continue;
    }

    match = { fiche, rounds, includedIndices };
    break;
  }

  if (match) {
    const { fiche, rounds, includedIndices } = match;
    const ourName = await resolveFideName(FFE_PLAYER_NAME, askFideId);
    const opponentNameCache = new Map<string, string>();

    for (const [roundIdx, gameIdx] of includedIndices.entries()) {
      const r = rounds[roundIdx];
      let g = games[gameIdx];
      g = setTag(g, 'Round', String(r.round));
      if (r.color && r.opponentName) {
        const ourSide = r.color === 'B' ? 'White' : 'Black';
        const oppSide = r.color === 'B' ? 'Black' : 'White';
        if (!opponentNameCache.has(r.opponentName)) {
          opponentNameCache.set(r.opponentName, await resolveFideName(r.opponentName, askFideId));
        }
        const opponentName = opponentNameCache.get(r.opponentName)!;
        if (!getTag(g, oppSide)) g = setTag(g, oppSide, opponentName);
        if (r.opponentElo && !getTag(g, `${oppSide}Elo`))
          g = setTag(g, `${oppSide}Elo`, r.opponentElo.replace(/\s*F$/, ''));
        if (!getTag(g, ourSide)) g = setTag(g, ourSide, ourName);
      }
      g = setTag(g, 'TimeControl', fiche.cadenceText);
      games[gameIdx] = g;
    }

    const category = await classifyCadence(fiche.cadenceText, askCategory);

    writeFileSync(`downloaded/${filename}`, games.join('\n\n\n') + '\n');
    const merged = mergeCategory(
      category,
      includedIndices.map(i => games[i]),
    );
    console.log(`Fusionné dans ${merged}`);
  }
  else {
    console.log(
      'Pas de lien FFE, pas de merge (Round/adversaire/cadence manquants).',
    );
  }

  // ponytail: manifest only written once the flow reaches a deliberate
  // end (merged, or explicitly skipped) — not right after download — so an
  // aborted/crashed run never leaves a study wrongly marked as done.
  manifest[study.id] = filename;
  saveManifest(manifest);

  rl.close();
}

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(1);
});
