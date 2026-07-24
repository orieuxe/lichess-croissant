import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchFiche, fetchRounds } from './ffe.ts';

const fiche = readFileSync(
  new URL('./fixtures/ffe_fiche.html', import.meta.url),
  'utf8',
);
const ficheClosed = readFileSync(
  new URL('./fixtures/ffe_fiche_closed.html', import.meta.url),
  'utf8',
);
const resultats = readFileSync(
  new URL('./fixtures/ffe_resultats.html', import.meta.url),
  'utf8',
);

globalThis.fetch = (async (url: string) =>
  new Response(
    url.includes('Ref=72157')
      ? ficheClosed
      : url.includes('FicheTournoi')
        ? fiche
        : resultats,
  )) as typeof fetch;

const info = await fetchFiche(
  'https://www.echecs.asso.fr/FicheTournoi.aspx?Ref=69309',
);
assert.equal(info.title, '7e Mémorial Aloyzas Kveinys - Master (+1900)');
assert.equal(info.numRounds, 9);
assert.equal(info.cadenceText, '1h30/40 - 30\' + [30"]');
assert.equal(info.startDate, 'samedi 04 juillet 2026');
assert.ok(info.resultsLinks.Ga, 'expected a Grille Américaine link');
assert.equal(
  info.resultsLinks.Ga,
  'https://www.echecs.asso.fr/Resultats.aspx?URL=Tournois/Id/69309/69309&Action=Ga',
);

const closedInfo = await fetchFiche(
  'https://www.echecs.asso.fr/FicheTournoi.aspx?Ref=72157',
);
assert.equal(
  closedInfo.title,
  'Festival de Tournois Classiques d\'Eté 2026 de Lille - Fermé A',
);
assert.equal(closedInfo.numRounds, 5);
assert.equal(closedInfo.cadenceText, '60\' + [30\'\']');
assert.equal(
  closedInfo.resultsLinks.Ga,
  undefined,
  'closed/round-robin tournament has no Ga link',
);
assert.ok(
  closedInfo.resultsLinks.Berger,
  'expected a Grille Berger link instead',
);

const { ownElo, rounds } = await fetchRounds(
  'https://x/Resultats.aspx',
  'ORIEUX Etienne',
);
assert.equal(ownElo, '2240 F');
assert.equal(rounds.length, 9);
assert.equal(rounds[0].result, '=');
assert.equal(rounds[0].color, 'B');
assert.equal(rounds[4].result, '+');
assert.equal(rounds[4].color, 'B');
assert.equal(rounds[7].result, '+');
assert.equal(rounds[7].color, 'N');
for (const r of rounds) {
  assert.ok(r.opponentName, `round ${r.round} missing opponent name`);
  assert.ok(r.opponentElo, `round ${r.round} missing opponent elo`);
}

console.log('ffe.test.ts OK', rounds);
