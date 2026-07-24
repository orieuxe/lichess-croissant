export function splitGames(pgnText: string): string[] {
  return pgnText
    .split(/\n(?=\[Event )/)
    .map(g => g.trim())
    .filter(Boolean);
}

export function getTag(game: string, tag: string): string | null {
  const m = game.match(new RegExp(`^\\[${tag} "(.*)"\\]$`, 'm'));
  return m ? m[1] : null;
}

export function setTag(game: string, tag: string, value: string): string {
  const re = new RegExp(`^\\[${tag} ".*"\\]$`, 'm');
  const line = `[${tag} "${value}"]`;
  if (re.test(game)) return game.replace(re, line);
  const headerEnd = game.indexOf('\n\n');
  const header = headerEnd === -1 ? game : game.slice(0, headerEnd);
  const rest = headerEnd === -1 ? '' : game.slice(headerEnd);
  return `${header}\n${line}${rest}`;
}

export function removeTag(game: string, tag: string): string {
  const re = new RegExp(`^\\[${tag} ".*"\\]\\n?`, 'm');
  return game.replace(re, '');
}

// ponytail: regex-based preview, not a real PGN move parser — good enough to
// let a human eyeball "which chapter is this" during exclusion prompts.
export function previewMoves(game: string, tokenCount = 14): string {
  const headerEnd = game.indexOf('\n\n');
  let moveText = headerEnd === -1 ? '' : game.slice(headerEnd + 2);
  moveText = moveText.replace(/\{[^}]*\}/g, '');
  let prev: string;
  do {
    prev = moveText;
    moveText = moveText.replace(/\([^()]*\)/g, '');
  } while (moveText !== prev);
  moveText = moveText.replace(/\s*(1-0|0-1|1\/2-1\/2|\*)\s*$/, '');
  return moveText.trim().split(/\s+/).slice(0, tokenCount).join(' ');
}
