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
import { syncToDb } from './en-croissant.ts';
import { resolveFideName, getFidePlayer, resolveFideById, normalizeUnmatchedName, type ResolvedFideName } from './fide.ts';
import { pickStudy } from './flow/study-select.ts';
import { matchRound } from './flow/match-round.ts';
import { enrichGames } from './flow/enrich.ts';
import { pushChapters } from './flow/push-lichess.ts';

const LICHESS_USERNAME = process.env.LICHESS_USERNAME;
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

async function askOpponentFideId(): Promise<ResolvedFideName> {
  while (true) {
    const id = (await ask('ID FIDE de l\'adversaire (vide si inconnu) : ')).trim();
    if (id) {
      const resolved = await resolveFideById(id);
      if (resolved) { return resolved; }
      console.warn(`ID FIDE ${id} introuvable, réessaie.`);
      continue;
    }
    const name = (await ask('Nom de l\'adversaire (obligatoire) : ')).trim();
    if (name) { return { name: normalizeUnmatchedName(name) }; }
  }
}

async function askResult(title: string): Promise<'+' | '=' | '-'> {
  while (true) {
    const answer = await ask(
      `Résultat pour ${title} — [1] gagné, [0] perdu, [/] nul : `,
    );
    const choice = answer.trim();
    if (choice === '1') { return '+'; }
    if (choice === '0') { return '-'; }
    if (choice === '/') { return '='; }
  }
}

async function main() {
  if (!LICHESS_USERNAME) { throw new Error('LICHESS_USERNAME not set (check .env)'); }
  if (!FIDE_ID) { throw new Error('FIDE_ID not set (check .env)'); }

  const fideIdAnswer = await ask(
    `ID FIDE du joueur (vide = toi, ${FIDE_ID}) : `,
  );
  const playerFideId = fideIdAnswer.trim() || FIDE_ID;
  const isOtherPlayer = playerFideId !== FIDE_ID;

  const ownPlayer = await getFidePlayer(playerFideId);
  if (!ownPlayer) { throw new Error(`FIDE id ${playerFideId} not found`); }
  const our: ResolvedFideName = {
    name: ownPlayer.name,
    title: ownPlayer.title,
    fideId: String(ownPlayer.id),
    standardElo: ownPlayer.standard,
    rapidElo: ownPlayer.rapid,
    blitzElo: ownPlayer.blitz,
  };
  // FFE displays names as "SURNAME Firstname", no comma — our.name is "Surname, Firstname"
  const ffeMatchName = our.name.replace(',', '');

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

  const { match, filename, games } = await matchRound(study, downloadedFilename, downloadedGames, playerFideId, our.name, ffeMatchName, ask);

  if (match) {
    const { fiche, ffeUrl, rounds, ownElo, includedIndices, ratingKind, category: manualCategory } = match;
    const ourEloValue = ownElo.replace(/\s*F$/, '');

    const eventByRound = new Map<string, string>();
    const uniqueEvents = [...new Set(rounds.map(r => r.event).filter((e): e is string => !!e))];
    let sharedEvent = study.name;
    if (ffeUrl) {
      const answer = (await ask(
        `Event (vide = nom study "${study.name}", "f" = titre FFE "${fiche.title}", ou texte libre) : `,
      )).trim();
      sharedEvent = answer === '' ? study.name : answer.toLowerCase() === 'f' ? fiche.title : answer;
    } else if (uniqueEvents.length > 0) {
      for (const ev of uniqueEvents) {
        const answer = (await ask(
          `Event pour "${ev}" (vide = "${ev}", "s" = "${study.name}", ou texte libre) : `,
        )).trim();
        eventByRound.set(ev, answer === '' ? ev : answer.toLowerCase() === 's' ? study.name : answer);
      }
    }

    if (eventByRound.size > 0) {
      for (const r of rounds) {
        if (r.event) { r.event = eventByRound.get(r.event!) ?? r.event; }
      }
    }

    const enrichedGames = await enrichGames(
      { games, includedIndices, rounds, fiche, ffeUrl, eventValue: sharedEvent, our, ratingKind, ourEloValue },
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
    const confirm = await ask(
      isOtherPlayer
        ? '\nSauvegarder le PGN (pas de merge, autre joueur) ? [O/n] '
        : '\nSauvegarder (pgn + merge + manifest + commit local) ? [O/n] ',
    );
    if (confirm.trim().toLowerCase().startsWith('n')) {
      console.log('Annulé, rien de sauvegardé.');
      console.log(`Study lichess : https://lichess.org/study/${study.id}`);
      rl.close();
      return;
    }

    writeFileSync(`downloaded/${filename}`, enrichedGames.join('\n\n\n') + '\n');

    if (isOtherPlayer) {
      console.log('PGN sauvegardé (pas de merge — autre joueur, pas de manifest — relancer si besoin).');
    } else {
      const merged = mergeCategory(category, includedIndices.map(i => enrichedGames[i]));
      console.log(`Fusionné dans ${merged}`);

      // synchro vers en-croissant (2 DBs, classique / non-classique)
      const enCroissantDir = process.env.ENCROISSANT_DB_DIR;
      if (enCroissantDir) {
        const dbName = category === 'classique' ? 'Mes Parties.db3' : 'Mes Parties (non classique).db3';
        const dbPath = `${enCroissantDir}/${dbName}`;
        try {
          const count = syncToDb(merged, dbPath);
          if (count > 0) { console.log(`${count} partie(s) ajoutée(s) à ${dbName}.`); }
        } catch (err) {
          console.warn(`Sync en-croissant échouée: ${(err as Error).message}`);
        }
      }

      manifest[study.id] = filename;
      saveManifest(manifest);
    }

    const push = await ask(
      '\nPush les tags sur lichess ? [O/n] ',
    );
    if (push.trim().toLowerCase().startsWith('n')) {
      console.log('Rien poussé.');
    } else {
      await pushChapters(study.id, enrichedGames, includedIndices, ffeUrl, our.name);
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
