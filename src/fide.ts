export interface FideCandidate {
  id: number;
  name: string;
  federation: string;
  standard?: number;
  title?: string;
}

export interface ResolvedFideName {
  name: string;
  title?: string;
  fideId?: string;
}

export async function searchFidePlayers(query: string): Promise<FideCandidate[]> {
  const res = await fetch(`https://lichess.org/api/fide/player?q=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  return res.json();
}

function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

// ponytail: exact token-set match only (surname+firstname must match exactly,
// order/comma/accents ignored) — ambiguous or missing matches return null,
// caller falls back to the raw FFE name rather than guess.
export function matchFideName(ffeName: string, candidates: FideCandidate[]): FideCandidate | null {
  const target = normalize(ffeName);
  const matches = candidates.filter(c => normalize(c.name) === target);
  return matches.length === 1 ? matches[0] : null;
}

export async function getFidePlayer(id: string): Promise<FideCandidate | null> {
  const res = await fetch(`https://lichess.org/api/fide/player/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  return res.json();
}

// ponytail: on no/ambiguous match, ask for a FIDE id instead of silently
// keeping the raw FFE name — askFideId returns '' to skip and keep it as-is.
export async function resolveFideName(
  ffeName: string,
  askFideId: (ffeName: string) => Promise<string>,
): Promise<ResolvedFideName> {
  try {
    const candidates = await searchFidePlayers(ffeName);
    const matched = matchFideName(ffeName, candidates);
    if (matched) return { name: matched.name, title: matched.title, fideId: String(matched.id) };
  }
  catch {
    // network hiccup: fall through to asking for a manual FIDE id
  }

  const id = (await askFideId(ffeName)).trim();
  if (!id) return { name: ffeName };

  try {
    const player = await getFidePlayer(id);
    return player ? { name: player.name, title: player.title, fideId: String(player.id) } : { name: ffeName };
  }
  catch {
    return { name: ffeName };
  }
}
