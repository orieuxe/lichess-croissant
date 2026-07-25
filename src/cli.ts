import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import {
  listStudies,
  downloadStudy,
  loadManifest,
  saveManifest,
  loadIgnored,
} from './lichess.ts';
import { classifyCadence, type Category } from './cadence.ts';
import { splitGames, getTag, previewMoves, desiredChapterTitle } from './pgn.ts';
import { mergeCategory } from './merge.ts';
import { resolveFideName, getFidePlayer, resolveFideById, normalizeUnmatchedName, type ResolvedFideName } from './fide.ts';
import { pickStudy } from './flow/study-select.ts';
import { matchRound } from './flow/match-round.ts';
import { enrichGames } from './flow/enrich.ts';
import { pushChapters } from './flow/push-lichess.ts';
import { commitGameData, pushGithub } from './git.ts';

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

// mode manuel: pas de nom connu du tout (chapitre pas parsable) — on demande
// direct l'ID FIDE, ou à défaut le nom en clair. Jamais de placeholder "?".
async function askOpponentFideId(): Promise<ResolvedFideName> {
  while (true) {
    const id = (await ask('ID FIDE de l\'adversaire (vide si inconnu) : ')).trim();
    if (id) {
      const resolved = await resolveFideById(id);
      if (resolved) return resolved;
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

async function main() {
  if (!FIDE_ID) throw new Error('FIDE_ID not set (check .env)');
  const ownPlayer = await getFidePlayer(FIDE_ID);
  if (!ownPlayer) throw new Error(`FIDE id ${FIDE_ID} not found`);
  const our: ResolvedFideName = {
    name: ownPlayer.name,
    title: ownPlayer.title,
    fideId: String(ownPlayer.id),
    standardElo: ownPlayer.standard,
    rapidElo: ownPlayer.rapid,
    blitzElo: ownPlayer.blitz,
  };
  // FFE displays names as "SURNAME Firstname", no comma — our.name is "Surname, Firstname"
  const ffeMatchName = ownPlayer.name.replace(',', '');

  const manifest = loadManifest();
  const studies = await listStudies(LICHESS_USERNAME);

  const study = await pickStudy(studies, manifest, loadIgnored(), ask);
  if (!study) {
    rl.close();
    return;
  }

  console.log(`Study lichess : https://lichess.org/study/${study.id}`);

  const downloadedFilename = await downloadStudy(study.id);
  console.log(`Téléchargé : downloaded/${downloadedFilename}`);
  const downloadedGames = splitGames(readFileSync(`downloaded/${downloadedFilename}`, 'utf8'));

  const { match, filename, games } = await matchRound(study, downloadedFilename, downloadedGames, ffeMatchName, ask);

  if (match) {
    const { fiche, ffeUrl, rounds, ownElo, includedIndices, ratingKind, category: manualCategory } = match;
    const ourEloValue = ownElo.replace(/\s*F$/, '');

    const eventAnswer = await ask(
      ffeUrl
        ? `Event (vide = nom study "${study.name}", "f" = titre FFE "${fiche.title}", ou texte libre) : `
        : `Event (vide = "${fiche.title}", ou texte libre) : `,
    );
    const eventValue
      = eventAnswer.trim() === ''
        ? (ffeUrl ? study.name : fiche.title)
        : ffeUrl && eventAnswer.trim().toLowerCase() === 'f'
          ? fiche.title
          : eventAnswer.trim();

    const enrichedGames = await enrichGames(
      { games, includedIndices, rounds, fiche, ffeUrl, eventValue, our, ratingKind, ourEloValue },
      { askResult, askFideId, askOpponentFideId, resolveFideName, resolveFideById },
    );

    const category = manualCategory ?? await classifyCadence(fiche.cadenceText, askCategory);
    console.log(`\nCadence "${fiche.cadenceText}" -> ${category}`);

    console.log('\nRécap avant sauvegarde :');
    for (const gameIdx of includedIndices) {
      const g = enrichedGames[gameIdx];
      console.log(
        `  ${getTag(g, 'Round')} - ${desiredChapterTitle(g, our.name)} (${getTag(g, 'Result')})`,
      );
      console.log(`    ${previewMoves(g, 24)}`);
    }
    const confirm = await ask('\nSauvegarder (pgn + merge + manifest + commit local) ? [O/n] ');
    if (confirm.trim().toLowerCase().startsWith('n')) {
      console.log('Annulé, rien de sauvegardé.');
      console.log(`Study lichess : https://lichess.org/study/${study.id}`);
      rl.close();
      return;
    }

    writeFileSync(`downloaded/${filename}`, enrichedGames.join('\n\n\n') + '\n');
    const merged = mergeCategory(category, includedIndices.map(i => enrichedGames[i]));
    console.log(`Fusionné dans ${merged}`);

    // ponytail: manifest only written once the flow reaches a deliberate
    // end (merged) — not right after download — so an aborted/crashed run
    // never leaves a study wrongly marked as done.
    manifest[study.id] = filename;
    saveManifest(manifest);
    const committed = commitGameData(filename, study.name);

    const push = await ask(
      '\nPush maintenant (lichess + github) ? (n = tout reste local, modifie le pgn puis push toi-même) [O/n] ',
    );
    if (push.trim().toLowerCase().startsWith('n')) {
      console.log('Rien poussé — pense à push toi-même (lichess + github) après tes modifs.');
    } else {
      await pushChapters(study.id, enrichedGames, includedIndices, ffeUrl, our.name);
      if (committed) pushGithub();
    }
  } else {
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
