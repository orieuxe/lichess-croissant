import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { listStudies, downloadStudy, loadManifest, saveManifest, studiesNotDownloaded } from "./lichess.ts";
import { fetchFiche, fetchRounds } from "./ffe.ts";
import { classifyCadence, type Category } from "./cadence.ts";
import { splitGames, setTag, getTag } from "./pgn.ts";
import { mergeCategory } from "./merge.ts";

const LICHESS_USERNAME = "timoruu";
const FFE_PLAYER_NAME = process.env.FFE_PLAYER_NAME ?? "ORIEUX Etienne";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => rl.question(q);

async function askCategory(cadenceText: string): Promise<Category> {
  const answer = await ask(
    `Cadence FFE inconnue: "${cadenceText}"\nclassique ou non-classique ? [c/n] `,
  );
  return answer.trim().toLowerCase().startsWith("n") ? "non-classique" : "classique";
}

async function main() {
  const manifest = loadManifest();
  const studies = await listStudies(LICHESS_USERNAME);
  const suggestions = studiesNotDownloaded(studies, manifest);

  console.log(`\nStudies pas encore téléchargées (${suggestions.length}) :`);
  suggestions.forEach((s, i) => console.log(`  ${i + 1}. ${s.name}`));

  const choice = await ask("\nNuméro à télécharger (vide = quitter) : ");
  if (!choice.trim()) {
    rl.close();
    return;
  }
  const study = suggestions[parseInt(choice, 10) - 1];
  if (!study) throw new Error("choix invalide");

  const filename = await downloadStudy(study.id);
  manifest[study.id] = filename;
  saveManifest(manifest);
  console.log(`Téléchargé : downloaded/${filename}`);

  const ffeUrl = await ask("Lien fiche FFE (vide = skip) : ");
  let games = splitGames(readFileSync(`downloaded/${filename}`, "utf8"));

  if (ffeUrl.trim()) {
    const fiche = await fetchFiche(ffeUrl.trim());

    if (!fiche.resultsLinks.Ga) {
      console.warn(
        `ALERTE: pas de "Grille Américaine" pour ce tournoi (probablement fermé/round-robin, formats dispo: ${Object.keys(fiche.resultsLinks).join(", ")}) — enrichissement rondes/adversaires non supporté, skip.`,
      );
    } else {
      const { rounds } = await fetchRounds(fiche.resultsLinks.Ga, FFE_PLAYER_NAME);

      if (games.length !== fiche.numRounds) {
        console.warn(
          `ALERTE: ${games.length} parties téléchargées vs ${fiche.numRounds} rondes annoncées sur la FFE — enrichissement rondes/adversaires ignoré.`,
        );
      } else {
        games = games.map((game, i) => {
          const r = rounds[i];
          let g = setTag(game, "Round", String(r.round));
          if (r.color && r.opponentName) {
            const ourSide = r.color === "B" ? "White" : "Black";
            const oppSide = r.color === "B" ? "Black" : "White";
            // ponytail: FFE name kept as-is ("NOM Prénom"), not reformatted to "Nom, Prénom"
            if (!getTag(g, oppSide)) g = setTag(g, oppSide, r.opponentName);
            if (r.opponentElo && !getTag(g, `${oppSide}Elo`))
              g = setTag(g, `${oppSide}Elo`, r.opponentElo.replace(/\s*F$/, ""));
            if (!getTag(g, ourSide)) g = setTag(g, ourSide, FFE_PLAYER_NAME);
          }
          return g;
        });
      }
    }

    const category = await classifyCadence(fiche.cadenceText, askCategory);
    games = games.map((g) => setTag(g, "TimeControl", fiche.cadenceText));

    writeFileSync(`downloaded/${filename}`, games.join("\n\n\n") + "\n");
    const merged = mergeCategory(category, games);
    console.log(`Fusionné dans ${merged}`);
  } else {
    console.log("Pas de lien FFE, pas de merge (Round/adversaire/cadence manquants).");
  }

  rl.close();
}

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(1);
});
