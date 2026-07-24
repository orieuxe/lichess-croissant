export function splitGames(pgnText: string): string[] {
  return pgnText
    .split(/\n(?=\[Event )/)
    .map((g) => g.trim())
    .filter(Boolean);
}

export function getTag(game: string, tag: string): string | null {
  const m = game.match(new RegExp(`^\\[${tag} "(.*)"\\]$`, "m"));
  return m ? m[1] : null;
}

export function setTag(game: string, tag: string, value: string): string {
  const re = new RegExp(`^\\[${tag} ".*"\\]$`, "m");
  const line = `[${tag} "${value}"]`;
  if (re.test(game)) return game.replace(re, line);
  const headerEnd = game.indexOf("\n\n");
  const header = headerEnd === -1 ? game : game.slice(0, headerEnd);
  const rest = headerEnd === -1 ? "" : game.slice(headerEnd);
  return `${header}\n${line}${rest}`;
}
