import { studiesNotDownloaded, ignoreStudy, type StudyRef } from '../lichess.ts';

// Loops the "pick a study" prompt: lists what's left, lets the user ignore
// one ("i<n>") or pick one by number, blank quits (returns undefined).
export async function pickStudy(
  studies: StudyRef[],
  manifest: Record<string, string>,
  ignored: string[],
  ask: (q: string) => Promise<string>,
): Promise<StudyRef | undefined> {
  while (true) {
    const suggestions = studiesNotDownloaded(studies, manifest, ignored);

    console.log(`\nStudies pas encore téléchargées (${suggestions.length}) :`);
    suggestions.forEach((s, i) => console.log(`  ${i + 1}. ${s.name}`));

    const choice = await ask(
      '\nNuméro à télécharger, "i<numéro>" pour ignorer définitivement (vide = quitter) : ',
    );
    if (!choice.trim()) return undefined;

    const ignoreMatch = choice.trim().match(/^i(\d+)$/i);
    if (ignoreMatch) {
      const toIgnore = suggestions[parseInt(ignoreMatch[1], 10) - 1];
      if (!toIgnore) throw new Error('choix invalide');
      ignoreStudy(toIgnore.id);
      ignored.push(toIgnore.id);
      console.log(`Ignorée : ${toIgnore.name}`);
      continue;
    }

    const study = suggestions[parseInt(choice, 10) - 1];
    if (!study) throw new Error('choix invalide');
    return study;
  }
}
