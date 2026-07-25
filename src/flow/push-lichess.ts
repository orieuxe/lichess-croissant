import { extractChapterId, updateChapterTags } from '../lichess.ts';
import { getTag, desiredChapterTitle } from '../pgn.ts';

// ponytail: lichess's chapter-tags endpoint only accepts a fixed tag
// whitelist (see lila's StudyPgnTags.scala) — UTCDate/UTCTime/ChapterName/
// EventURL aren't in it and 400 if sent, even to delete.
const PUSHABLE_TAGS = [
  'Round', 'Event', 'Result',
  'White', 'Black', 'WhiteElo', 'BlackElo', 'WhiteTitle', 'BlackTitle', 'WhiteFideId', 'BlackFideId',
  'TimeControl',
];

// Pushes the whitelisted tags of each included game to its lichess chapter.
// EventURL isn't a pushable tag, so the FFE link rides on Event instead
// (skipped entirely in mode manuel, where there's no link).
export async function pushChapters(
  studyId: string,
  games: string[],
  includedIndices: number[],
  ffeUrl: string,
  ourName: string,
): Promise<void> {
  console.log('\nMise à jour des chapitres sur lichess...');
  for (const gameIdx of includedIndices) {
    const g = games[gameIdx];
    const chapterId = extractChapterId(g);
    if (!chapterId) {
      console.warn(`  chapitre introuvable pour la partie ${gameIdx + 1}, skip`);
      continue;
    }

    const tags: Record<string, string> = {};
    for (const tag of PUSHABLE_TAGS) {
      const value = getTag(g, tag);
      if (value) tags[tag] = value;
    }
    if (ffeUrl) tags.Event = ffeUrl;

    const title = desiredChapterTitle(g, ourName);
    try {
      await updateChapterTags(studyId, chapterId, tags);
      console.log(`  ${chapterId} (${title}) mis à jour`);
    } catch (err) {
      console.warn(`  ${chapterId} (${title}) échec: ${(err as Error).message}`);
    }
  }
  console.log(
    '(le titre du chapitre lui-même — "B/N vs Nom, Prénom elo" — ne peut pas être renommé via l\'API publique lichess, à faire à la main si besoin)',
  );
}
