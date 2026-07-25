import assert from 'node:assert/strict';

process.env.LICHESS_TOKEN = 'test-token';

const calls: { url: string; body: string }[] = [];
globalThis.fetch = (async (url: string, init: RequestInit) => {
  calls.push({ url, body: (init.body as URLSearchParams).toString() });
  return new Response('{}', { status: 200 });
}) as typeof fetch;

const { pushChapters } = await import('./push-lichess.ts');

const game1 = [
  '[Event "Rapide pizza"]',
  '[Site "https://lichess.org/study/studyABC/chap111"]',
  '[Round "1"]',
  '[Result "1-0"]',
  '[White "Orieux, Etienne"]',
  '[Black "Dubuisson, Samuel"]',
  '[BlackElo "1900"]',
  '[UTCDate "2026.01.01"]',
  '[ChapterName "B vs Dubuisson 1900"]',
  '',
  '1. e4 e5 1-0',
].join('\n');

const noChapterIdGame = '[Event "x"]\n\n1. e4 *';

await pushChapters(
  'studyABC',
  [game1, noChapterIdGame],
  [0, 1],
  'https://www.echecs.asso.fr/FicheTournoi.aspx?Ref=1',
  'Orieux, Etienne',
);

assert.equal(calls.length, 1, 'only the game with a resolvable chapter id gets pushed');
assert.equal(calls[0].url, 'https://lichess.org/api/study/studyABC/chap111/tags');
const pushedPgn = new URLSearchParams(calls[0].body).get('pgn')!;
assert.ok(pushedPgn.includes('[Round "1"]'));
assert.ok(
  pushedPgn.includes('[Event "https://www.echecs.asso.fr/FicheTournoi.aspx?Ref=1"]'),
  'Event carries the FFE link, not the original Event tag',
);
assert.ok(!pushedPgn.includes('UTCDate'), 'UTCDate never pushed, not in the whitelist');
assert.ok(!pushedPgn.includes('ChapterName'), 'ChapterName never pushed, not in the whitelist');

// mode manuel: no ffeUrl -> Event tag stays whatever was already set.
calls.length = 0;
await pushChapters('studyABC', [game1], [0], '', 'Orieux, Etienne');
const manualPushedPgn = new URLSearchParams(calls[0].body).get('pgn')!;
assert.ok(manualPushedPgn.includes('[Event "Rapide pizza"]'), 'no ffeUrl -> original Event kept');

console.log('push-lichess.test.ts OK');
