import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import {
  listStudies,
  downloadStudy,
  loadManifest,
  saveManifest,
  studiesNotDownloaded,
  extractChapterId,
  updateChapterTags,
  loadIgnored,
  ignoreStudy,
} from './lichess.ts';
import { fetchFiche, fetchRounds } from './ffe.ts';
import { classifyCadence, type Category } from './cadence.ts';
import {
  splitGames,
  setTag,
  getTag,
  removeTag,
  previewMoves,
  resultFromFfe,
} from './pgn.ts';
import { mergeCategory } from './merge.ts';
import { resolveFideName, getFidePlayer, type ResolvedFideName } from './fide.ts';

const LICHESS_USERNAME = 'timoruu';
const FIDE_ID = process.env.FIDE_ID;

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
  if (!FIDE_ID) throw new Error('FIDE_ID not set (check .env)');
  const ownPlayer = await getFidePlayer(FIDE_ID);
  if (!ownPlayer) throw new Error(`FIDE id ${FIDE_ID} not found`);
  const our: ResolvedFideName = { name: ownPlayer.name, title: ownPlayer.title };
  // FFE displays names as "SURNAME Firstname", no comma — our.name is "Surname, Firstname"
  const ffeMatchName = ownPlayer.name.replace(',', '');

  const manifest = loadManifest();
  const studies = await listStudies(LICHESS_USERNAME);

  let study: { id: string; name: string } | undefined;
  while (!study) {
    const suggestions = studiesNotDownloaded(studies, manifest, loadIgnored());

    console.log(`\nStudies pas encore téléchargées (${suggestions.length}) :`);
    suggestions.forEach((s, i) => console.log(`  ${i + 1}. ${s.name}`));

    const choice = await ask(
      '\nNuméro à télécharger, "i<numéro>" pour ignorer définitivement (vide = quitter) : ',
    );
    if (!choice.trim()) {
      rl.close();
      return;
    }

    const ignoreMatch = choice.trim().match(/^i(\d+)$/i);
    if (ignoreMatch) {
      const toIgnore = suggestions[parseInt(ignoreMatch[1], 10) - 1];
      if (!toIgnore) throw new Error('choix invalide');
      ignoreStudy(toIgnore.id);
      console.log(`Ignorée : ${toIgnore.name}`);
      continue;
    }

    study = suggestions[parseInt(choice, 10) - 1];
    if (!study) throw new Error('choix invalide');
  }

  const filename = await downloadStudy(study.id);
  console.log(`Téléchargé : downloaded/${filename}`);

  const games = splitGames(readFileSync(`downloaded/${filename}`, 'utf8'));

  let match: {
    fiche: Awaited<ReturnType<typeof fetchFiche>>;
    ffeUrl: string;
    rounds: Awaited<ReturnType<typeof fetchRounds>>['rounds'];
    ownElo: string;
    includedIndices: number[];
  } | null = null;

  while (true) {
    const ffeUrlAnswer = await ask('Lien fiche FFE (vide = skip) : ');
    if (!ffeUrlAnswer.trim()) break;
    const ffeUrl = ffeUrlAnswer.trim();

    const fiche = await fetchFiche(ffeUrl);

    if (!fiche.resultsLinks.Ga) {
      console.warn(
        `ALERTE: pas de "Grille Américaine" pour ce tournoi (probablement fermé/round-robin, formats dispo: ${Object.keys(fiche.resultsLinks).join(', ')}) — enrichissement rondes/adversaires non supporté.`,
      );
      continue;
    }

    const { ownElo, rounds } = await fetchRounds(
      fiche.resultsLinks.Ga,
      ffeMatchName,
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

    match = { fiche, ffeUrl, rounds, ownElo, includedIndices };
    break;
  }

  if (match) {
    const { fiche, ffeUrl, rounds, ownElo, includedIndices } = match;
    const ourEloValue = ownElo.replace(/\s*F$/, '');
    const opponentNameCache = new Map<string, ResolvedFideName>();

    const eventAnswer = await ask(
      `Event (vide = titre FFE "${fiche.title}", "s" = nom study "${study.name}", ou texte libre) : `,
    );
    const eventValue
      = eventAnswer.trim() === ''
        ? fiche.title
        : eventAnswer.trim().toLowerCase() === 's'
          ? study.name
          : eventAnswer.trim();

    for (const [roundIdx, gameIdx] of includedIndices.entries()) {
      const r = rounds[roundIdx];
      let g = games[gameIdx];
      g = setTag(g, 'Round', String(r.round));
      g = setTag(g, 'Event', eventValue);
      g = setTag(g, 'EventURL', ffeUrl);
      g = removeTag(g, 'UTCDate');
      g = removeTag(g, 'UTCTime');
      g = removeTag(g, 'ChapterName');
      if (r.color && r.opponentName) {
        const ourSide = r.color === 'B' ? 'White' : 'Black';
        const oppSide = r.color === 'B' ? 'Black' : 'White';
        if (r.result) {
          const result = resultFromFfe(r.result, ourSide);
          const currentResult = getTag(g, 'Result');
          if (!currentResult || currentResult === '*') g = setTag(g, 'Result', result);
        }
        if (!opponentNameCache.has(r.opponentName)) {
          opponentNameCache.set(r.opponentName, await resolveFideName(r.opponentName, askFideId));
        }
        const opponent = opponentNameCache.get(r.opponentName)!;
        if (!getTag(g, oppSide)) g = setTag(g, oppSide, opponent.name);
        if (opponent.title && !getTag(g, `${oppSide}Title`))
          g = setTag(g, `${oppSide}Title`, opponent.title);
        if (r.opponentElo && !getTag(g, `${oppSide}Elo`))
          g = setTag(g, `${oppSide}Elo`, r.opponentElo.replace(/\s*F$/, ''));
        if (!getTag(g, ourSide)) g = setTag(g, ourSide, our.name);
        if (our.title && !getTag(g, `${ourSide}Title`))
          g = setTag(g, `${ourSide}Title`, our.title);
        if (!getTag(g, `${ourSide}Elo`))
          g = setTag(g, `${ourSide}Elo`, ourEloValue);
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

    console.log('\nMise à jour des chapitres sur lichess...');
    for (const gameIdx of includedIndices) {
      const g = games[gameIdx];
      const chapterId = extractChapterId(g);
      if (!chapterId) {
        console.warn(`  chapitre introuvable pour la partie ${gameIdx + 1}, skip`);
        continue;
      }
      // ponytail: lichess's chapter-tags endpoint only accepts a fixed tag
      // whitelist (see lila's StudyPgnTags.scala) — UTCDate/UTCTime/
      // ChapterName/EventURL aren't in it and 400 if sent, even to delete.
      const tags: Record<string, string> = {};
      for (const tag of [
        'Round',
        'Event',
        'Result',
        'White',
        'Black',
        'WhiteElo',
        'BlackElo',
        'WhiteTitle',
        'BlackTitle',
        'TimeControl',
      ]) {
        const value = getTag(g, tag);
        if (value) tags[tag] = value;
      }
      // EventURL isn't a tag lichess accepts — use Event for the FFE link directly.
      tags.Event = ffeUrl;
      try {
        await updateChapterTags(study.id, chapterId, tags);
        console.log(`  ${chapterId} mis à jour`);
      }
      catch (err) {
        console.warn(`  ${chapterId} échec: ${(err as Error).message}`);
      }
    }
    console.log(
      '(le titre du chapitre lui-même — "B/N vs Nom, Prénom elo" — ne peut pas être renommé via l\'API publique lichess, à faire à la main si besoin)',
    );
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
