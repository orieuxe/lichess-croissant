import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
import { fetchFiche, fetchRounds, fetchClosedRounds, type FicheTournoi, type RoundResult } from './ffe.ts';
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
import { resolveFideName, getFidePlayer, normalizeUnmatchedName, type ResolvedFideName } from './fide.ts';

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

type RatingKind = 'standardElo' | 'rapidElo' | 'blitzElo';

// mode manuel: pas de fiche FFE donc pas de cadence texte à classifier — on
// demande direct le format, ce qui donne à la fois la catégorie de merge et
// quel rating FIDE (standard/rapide/blitz) piocher pour les Elo.
async function askCadenceKind(): Promise<{ category: Category; ratingKind: RatingKind }> {
  while (true) {
    const answer = (await ask('Cadence — [s] standard/classique, [r] rapide, [b] blitz : '))
      .trim()
      .toLowerCase();
    if (answer === 's') return { category: 'classique', ratingKind: 'standardElo' };
    if (answer === 'r') return { category: 'non-classique', ratingKind: 'rapidElo' };
    if (answer === 'b') return { category: 'non-classique', ratingKind: 'blitzElo' };
  }
}

// mode manuel: pas de nom connu du tout (chapitre pas parsable) — on demande
// direct l'ID FIDE, ou à défaut le nom en clair. Jamais de placeholder "?".
async function askOpponentFideId(): Promise<ResolvedFideName> {
  while (true) {
    const id = (await ask('ID FIDE de l\'adversaire (vide si inconnu) : ')).trim();
    if (id) {
      const player = await getFidePlayer(id);
      if (player) return { name: player.name, title: player.title, fideId: String(player.id), elo: player.standard };
      console.warn(`ID FIDE ${id} introuvable, réessaie.`);
      continue;
    }
    const name = (await ask('Nom de l\'adversaire (obligatoire) : ')).trim();
    if (name) return { name: normalizeUnmatchedName(name) };
  }
}

// FFE round-robin pairing pages show "X - X" until the organizer enters the
// result by hand, even for games already finished/relayed on lichess — so
// fetchClosedRounds returns result: null and Result stays unset/"*". On
// force un choix — jamais de "*" qui traîne.
async function askResult(title: string): Promise<'+' | '=' | '-'> {
  while (true) {
    const answer = await ask(
      `Résultat FFE pas encore publié pour ${title} — [1] gagné, [0] perdu, [/] nul : `,
    );
    const choice = answer.trim();
    if (choice === '1') return '+';
    if (choice === '0') return '-';
    if (choice === '/') return '=';
  }
}

// "B/N vs Nom, Prénom elo" — the chapter title convention, used both in the
// recap and next to the lichess push log (can't be pushed, see PLAN.md).
function desiredChapterTitle(g: string, ourName: string): string {
  const ourSide = getTag(g, 'White') === ourName ? 'White' : 'Black';
  const oppSide = ourSide === 'White' ? 'Black' : 'White';
  const letter = ourSide === 'White' ? 'B' : 'N';
  const oppName = getTag(g, oppSide) ?? '?';
  const oppElo = getTag(g, `${oppSide}Elo`) ?? '?';
  return `${letter} vs ${oppName} ${oppElo}`;
}

// Auto-commit only the data files this run touched — never src/, so an
// in-progress code change on the branch can't get swept into a data commit.
// Push is a separate step (asked after) so a manual pgn tweak can happen
// between commit and push without racing the auto-push.
async function commitGameData(filename: string, studyName: string) {
  try {
    execFileSync('git', [
      'add', '-A', '--',
      `downloaded/${filename}`, 'manifest.json',
      'merged_classique_*.pgn', 'merged_non-classique_*.pgn',
    ]);
    execFileSync('git', ['commit', '-m', `feat: add ${studyName} games`]);
    console.log('Commit git créé (données seulement).');
  }
  catch (err) {
    console.warn(`git commit sauté (${(err as Error).message.split('\n')[0]})`);
    return;
  }

  const push = await ask(
    'Push github maintenant (n = commit local seulement, tu push toi-même après avoir modifié le pgn si besoin) ? [O/n] ',
  );
  if (push.trim().toLowerCase().startsWith('n')) {
    console.log('Pas de push — pense à le faire toi-même après tes modifs.');
    return;
  }
  try {
    execFileSync('git', ['push']);
    console.log('Poussé sur github.');
  }
  catch (err) {
    console.warn(`git push échoué (${(err as Error).message.split('\n')[0]})`);
  }
}

async function main() {
  if (!FIDE_ID) throw new Error('FIDE_ID not set (check .env)');
  const ownPlayer = await getFidePlayer(FIDE_ID);
  if (!ownPlayer) throw new Error(`FIDE id ${FIDE_ID} not found`);
  const our: ResolvedFideName = {
    name: ownPlayer.name,
    title: ownPlayer.title,
    fideId: String(ownPlayer.id),
    elo: ownPlayer.standard,
  };
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

  console.log(`Study lichess : https://lichess.org/study/${study.id}`);

  let filename = await downloadStudy(study.id);
  console.log(`Téléchargé : downloaded/${filename}`);

  let games = splitGames(readFileSync(`downloaded/${filename}`, 'utf8'));

  let match: {
    fiche: FicheTournoi;
    ffeUrl: string;
    rounds: RoundResult[];
    ownElo: string;
    includedIndices: number[];
  } | null = null;
  let ratingKind: RatingKind = 'standardElo';
  let manualCategory: Category | null = null;

  while (true) {
    const ffeUrlAnswer = await ask('Lien fiche FFE ou id du tournoi (vide = mode manuel/skip) : ');

    let fiche: FicheTournoi;
    let ffeUrl = '';
    let ownElo = '';
    let rounds: RoundResult[];

    if (!ffeUrlAnswer.trim()) {
      const manual = await ask(
        'Pas de lien FFE — mode manuel (parties non officielles, sans fiche FFE) ? [O/n] ',
      );
      if (manual.trim().toLowerCase().startsWith('n')) break;

      ({ category: manualCategory, ratingKind } = await askCadenceKind());

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
        // convention "B/N vs Nom, Prénom elo" tapée par le joueur lui-même
        // (voir desiredChapterTitle) — best-effort, rien de garanti.
        const m = chapterName.match(/^(B|N)\s+vs\s+(.+?)(?:\s+(\d{3,4}))?\s*$/i);
        let color: 'B' | 'N';
        let opponentName: string | null = null;
        let opponentElo: string | null = null;
        if (m) {
          color = m[1].toUpperCase() as 'B' | 'N';
          opponentName = m[2].trim();
          opponentElo = m[3] ?? null;
        }
        else {
          const colorAnswer = await ask(
            `Partie ${i + 1} (${chapterName || previewMoves(g, 10)}) — tu jouais Blanc ou Noir ? [b/n] `,
          );
          color = colorAnswer.trim().toLowerCase().startsWith('n') ? 'N' : 'B';
        }
        rounds.push({ round: i + 1, color, result: null, opponentName, opponentElo });
      }
    }
    else {
      const raw = ffeUrlAnswer.trim();
      ffeUrl = /^\d+$/.test(raw)
        ? `https://www.echecs.asso.fr/FicheTournoi.aspx?Ref=${raw}`
        : raw;

      fiche = await fetchFiche(ffeUrl);

      if (fiche.resultsLinks.Ga) {
        ({ ownElo, rounds } = await fetchRounds(fiche.resultsLinks.Ga, ffeMatchName));
      }
      else if (fiche.resultsLinks.Pairing && fiche.resultsLinks.Berger) {
        // closed/round-robin tournament: no Grille Américaine, same data lives
        // across the Pairing (round-by-round) and Berger (name→Elo) pages.
        ({ ownElo, rounds } = await fetchClosedRounds(
          fiche.resultsLinks.Pairing,
          fiche.resultsLinks.Berger,
          ffeMatchName,
        ));
      }
      else {
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
      const roundNumbers = retry.trim().match(/^[\d\s,]+$/)
        ? retry.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !Number.isNaN(n))
        : [];
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

    if (includedIndices.length !== expectedRounds) {
      console.warn(
        `ALERTE: ${includedIndices.length} parties retenues vs ${expectedRounds} rondes attendues (mauvais lien ? mauvais tournoi ?).`,
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
      if (ffeUrl) g = setTag(g, 'EventURL', ffeUrl);
      g = removeTag(g, 'UTCDate');
      g = removeTag(g, 'UTCTime');
      g = removeTag(g, 'ChapterName');
      if (r.color) {
        const ourSide = r.color === 'B' ? 'White' : 'Black';
        const oppSide = r.color === 'B' ? 'Black' : 'White';
        const currentResult = getTag(g, 'Result');
        if (r.result) {
          const result = resultFromFfe(r.result, ourSide);
          if (!currentResult || currentResult === '*') g = setTag(g, 'Result', result);
        }
        else if (!currentResult || currentResult === '*') {
          const manual = await askResult(`${r.round} - ${r.color}/${r.opponentName ?? '?'}`);
          g = setTag(g, 'Result', resultFromFfe(manual, ourSide));
        }
        let opponent: ResolvedFideName;
        if (r.opponentName) {
          if (!opponentNameCache.has(r.opponentName)) {
            opponentNameCache.set(r.opponentName, await resolveFideName(r.opponentName, askFideId));
          }
          opponent = opponentNameCache.get(r.opponentName)!;
        }
        else {
          opponent = await askOpponentFideId();
        }
        // toujours écraser par le nom normalisé FIDE, même si lichess en a déjà un
        g = setTag(g, oppSide, opponent.name);
        if (opponent.title && !getTag(g, `${oppSide}Title`))
          g = setTag(g, `${oppSide}Title`, opponent.title);
        if (opponent.fideId && !getTag(g, `${oppSide}FideId`))
          g = setTag(g, `${oppSide}FideId`, opponent.fideId);
        const oppRatingElo = opponent[ratingKind];
        const oppElo = r.opponentElo?.replace(/\s*F$/, '') || (oppRatingElo ? String(oppRatingElo) : '');
        if (oppElo && !getTag(g, `${oppSide}Elo`))
          g = setTag(g, `${oppSide}Elo`, oppElo);
        g = setTag(g, ourSide, our.name);
        if (our.title && !getTag(g, `${ourSide}Title`))
          g = setTag(g, `${ourSide}Title`, our.title);
        if (our.fideId && !getTag(g, `${ourSide}FideId`))
          g = setTag(g, `${ourSide}FideId`, our.fideId);
        const ourRatingElo = our[ratingKind];
        const ownEloTag = ourEloValue || (ourRatingElo ? String(ourRatingElo) : '');
        if (ownEloTag && !getTag(g, `${ourSide}Elo`))
          g = setTag(g, `${ourSide}Elo`, ownEloTag);
      }
      if (fiche.cadenceText) g = setTag(g, 'TimeControl', fiche.cadenceText);
      games[gameIdx] = g;
    }

    const category = manualCategory ?? await classifyCadence(fiche.cadenceText, askCategory);
    console.log(`\nCadence "${fiche.cadenceText}" -> ${category}`);

    console.log('\nRécap avant sauvegarde :');
    for (const gameIdx of includedIndices) {
      const g = games[gameIdx];
      console.log(
        `  ${getTag(g, 'Round')} - ${desiredChapterTitle(g, our.name)} (${getTag(g, 'Result')})`,
      );
      console.log(`    ${previewMoves(g, 24)}`);
    }
    const confirm = await ask('\nSauvegarder (merge + manifest + push lichess + commit github) ? [O/n] ');
    if (confirm.trim().toLowerCase().startsWith('n')) {
      console.log('Annulé, rien de sauvegardé.');
      console.log(`Study lichess : https://lichess.org/study/${study.id}`);
      rl.close();
      return;
    }

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
        'WhiteFideId',
        'BlackFideId',
        'TimeControl',
      ]) {
        const value = getTag(g, tag);
        if (value) tags[tag] = value;
      }
      // EventURL isn't a tag lichess accepts — use Event for the FFE link directly
      // (skip in mode manuel, il n'y a pas de lien).
      if (ffeUrl) tags.Event = ffeUrl;
      const title = desiredChapterTitle(g, our.name);
      try {
        await updateChapterTags(study.id, chapterId, tags);
        console.log(`  ${chapterId} (${title}) mis à jour`);
      }
      catch (err) {
        console.warn(`  ${chapterId} (${title}) échec: ${(err as Error).message}`);
      }
    }
    console.log(
      '(le titre du chapitre lui-même — "B/N vs Nom, Prénom elo" — ne peut pas être renommé via l\'API publique lichess, à faire à la main si besoin)',
    );

    // ponytail: manifest only written once the flow reaches a deliberate
    // end (merged) — not right after download — so an aborted/crashed run
    // never leaves a study wrongly marked as done.
    manifest[study.id] = filename;
    saveManifest(manifest);
    await commitGameData(filename, study.name);
  }
  else {
    console.log(
      'Pas de lien FFE, rien de sauvegardé — study pas marquée comme téléchargée, remets le lien FFE au prochain lancement.',
    );
  }

  console.log(`Study lichess : https://lichess.org/study/${study.id}`);
  rl.close();
}

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(1);
});
