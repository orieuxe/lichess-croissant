import assert from 'node:assert/strict';
import { matchFideName, resolveFideName } from './fide.ts';

const khamNguyenCandidates = [
  { name: 'Kham-Nguyen, Mathys', federation: 'FRA', standard: 2098 },
  { name: 'Noir, Mathys', federation: 'FRA', standard: 2118 },
  { name: 'Kham-Nguyen, Nathan', federation: 'FRA', standard: 1876 },
];
assert.equal(
  matchFideName('KHAM-NGUYEN Mathys', khamNguyenCandidates)?.name,
  'Kham-Nguyen, Mathys',
);

const pierreCandidates = [
  { name: 'Bailet, Pierre', federation: 'FRA', standard: 2410, title: 'GM' },
  { name: 'Laurent-Paoli, Pierre', federation: 'FRA', standard: 2536 },
  { name: 'Barbot, Pierre', federation: 'SLO', standard: 2474 },
];
const bailet = matchFideName('BAILET Pierre', pierreCandidates);
assert.equal(bailet?.name, 'Bailet, Pierre');
assert.equal(bailet?.title, 'GM');
assert.equal(matchFideName('Pierre Personne Inconnue', pierreCandidates), null, 'no exact match => null');
assert.equal(matchFideName('Pierre', pierreCandidates), null, 'ambiguous single token => null');

// live smoke test against the real lichess FIDE API
const own = await resolveFideName('ORIEUX Etienne', async () => {
  throw new Error('should not need to ask, exact match expected');
});
assert.equal(own.name, 'Orieux, Etienne');
assert.equal(own.title, undefined, 'no FIDE title yet');

const skipped = await resolveFideName('Nom Improbable Zzzqx Ffe Test', async () => '');
assert.equal(skipped.name, 'Nom Improbable Zzzqx Ffe Test', 'blank id answer keeps raw name');

const viaId = await resolveFideName('Nom Improbable Zzzqx Ffe Test', async () => '655830');
assert.equal(viaId.name, 'Bailet, Pierre', 'resolves via manually given FIDE id');
assert.equal(viaId.title, 'GM');

const badId = await resolveFideName('Nom Improbable Zzzqx Ffe Test', async () => '999999999999');
assert.equal(badId.name, 'Nom Improbable Zzzqx Ffe Test', 'unknown id falls back to raw name');

console.log('fide.test.ts OK');
