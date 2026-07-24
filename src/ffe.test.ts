import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fetchFiche, fetchRounds } from "./ffe.ts";

const fiche = readFileSync(new URL("./fixtures/ffe_fiche.html", import.meta.url), "utf8");
const resultats = readFileSync(new URL("./fixtures/ffe_resultats.html", import.meta.url), "utf8");

globalThis.fetch = (async (url: string) =>
  new Response(url.includes("FicheTournoi") ? fiche : resultats)) as typeof fetch;

const info = await fetchFiche("https://x/FicheTournoi.aspx?Ref=69309");
assert.equal(info.numRounds, 9);
assert.equal(info.cadenceText, "1h30/40 - 30' + [30\"]");
assert.equal(info.startDate, "samedi 04 juillet 2026");

const { ownElo, rounds } = await fetchRounds("https://x/Resultats.aspx", "ORIEUX Etienne");
assert.equal(ownElo, "2240 F");
assert.equal(rounds.length, 9);
assert.equal(rounds[0].result, "=");
assert.equal(rounds[0].color, "B");
assert.equal(rounds[4].result, "+");
assert.equal(rounds[4].color, "B");
assert.equal(rounds[7].result, "+");
assert.equal(rounds[7].color, "N");
for (const r of rounds) {
  assert.ok(r.opponentName, `round ${r.round} missing opponent name`);
  assert.ok(r.opponentElo, `round ${r.round} missing opponent elo`);
}

console.log("ffe.test.ts OK", rounds);
