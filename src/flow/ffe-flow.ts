import { fetchFiche, fetchRounds, fetchClosedRounds, type RoundResult } from '../ffe.ts';
import type { MatchResult } from './match-round.ts';

// FFE fallback: ask for a link, scrape the classic FFE pages.
export async function askFfeLink(
  games: string[],
  ffeMatchName: string,
  ask: (q: string) => Promise<string>,
): Promise<MatchResult | null> {
  const ffeUrlAnswer = await ask('Lien fiche FFE ou id du tournoi : ');
  if (!ffeUrlAnswer.trim()) { return null; }
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

  return { fiche, ffeUrl, rounds, ownElo, includedIndices, ratingKind: 'standardElo', category: null };
}
