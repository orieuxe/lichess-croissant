import assert from 'node:assert/strict';
import { matchFideName, fideFormattedName } from './fide.ts';

const khamNguyenCandidates = [
  { name: 'Kham-Nguyen, Mathys', federation: 'FRA', standard: 2098 },
  { name: 'Noir, Mathys', federation: 'FRA', standard: 2118 },
  { name: 'Kham-Nguyen, Nathan', federation: 'FRA', standard: 1876 },
];
assert.equal(matchFideName('KHAM-NGUYEN Mathys', khamNguyenCandidates), 'Kham-Nguyen, Mathys');

const pierreCandidates = [
  { name: 'Bailet, Pierre', federation: 'FRA', standard: 2410 },
  { name: 'Laurent-Paoli, Pierre', federation: 'FRA', standard: 2536 },
  { name: 'Barbot, Pierre', federation: 'SLO', standard: 2474 },
];
assert.equal(matchFideName('BAILET Pierre', pierreCandidates), 'Bailet, Pierre');
assert.equal(matchFideName('Pierre Personne Inconnue', pierreCandidates), null, 'no exact match => null');
assert.equal(matchFideName('Pierre', pierreCandidates), null, 'ambiguous single token => null');

// live smoke test against the real lichess FIDE API
const own = await fideFormattedName('ORIEUX Etienne');
assert.equal(own, 'Orieux, Etienne');

const noMatch = await fideFormattedName('Nom Improbable Zzzqx Ffe Test');
assert.equal(noMatch, 'Nom Improbable Zzzqx Ffe Test', 'falls back to raw name when nothing matches');

console.log('fide.test.ts OK');
