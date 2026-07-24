import assert from "node:assert/strict";
import { splitGames, getTag, setTag } from "./pgn.ts";

const sample = `[Event "A"]
[Date "2025.01.01"]

1. e4 e5 1-0


[Event "B"]
[Date "2025.01.02"]

1. d4 d5 0-1
`;

const games = splitGames(sample);
assert.equal(games.length, 2);
assert.equal(getTag(games[0], "Event"), "A");
assert.equal(getTag(games[1], "Date"), "2025.01.02");
assert.equal(getTag(games[0], "Round"), null);

const withRound = setTag(games[0], "Round", "3");
assert.equal(getTag(withRound, "Round"), "3");
const reReplaced = setTag(withRound, "Round", "4");
assert.equal(getTag(reReplaced, "Round"), "4");
assert.equal((reReplaced.match(/\[Round /g) ?? []).length, 1);

console.log("pgn.test.ts OK");
