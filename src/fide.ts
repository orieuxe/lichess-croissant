export interface FideCandidate {
  name: string;
  federation: string;
  standard?: number;
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
export function matchFideName(ffeName: string, candidates: FideCandidate[]): string | null {
  const target = normalize(ffeName);
  const matches = candidates.filter(c => normalize(c.name) === target);
  return matches.length === 1 ? matches[0].name : null;
}

export async function fideFormattedName(ffeName: string): Promise<string> {
  try {
    const candidates = await searchFidePlayers(ffeName);
    return matchFideName(ffeName, candidates) ?? ffeName;
  }
  catch {
    return ffeName;
  }
}
