export interface FideCandidate {
  id: number;
  name: string;
  federation: string;
  standard?: number;
  rapid?: number;
  blitz?: number;
  title?: string;
}

export interface ResolvedFideName {
  name: string;
  title?: string;
  fideId?: string;
  standardElo?: number;
  rapidElo?: number;
  blitzElo?: number;
}

export type RatingKind = 'standardElo' | 'rapidElo' | 'blitzElo';

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

export async function resolveFideById(id: string): Promise<ResolvedFideName | null> {
  try {
    const player = await getFidePlayer(id);
    if (!player) return null;
    return {
      name: player.name,
      title: player.title,
      fideId: String(player.id),
      standardElo: player.standard,
      rapidElo: player.rapid,
      blitzElo: player.blitz,
    };
  } catch {
    return null;
  }
}

function titleCase(s: string): string {
  return s.replace(/[\p{L}]+/gu, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

// No FIDE match at all — still reshape to "Surname, Firstname" on a best
// effort basis: a comma already settles the order; otherwise an all-caps
// token marks the surname (FFE convention "SURNAME Firstname"); with no case
// signal either, assume the last token is the surname (plain "Firstname
// Lastname"). Can't be certain, but beats leaving the raw chapter-title order.
export function normalizeUnmatchedName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes(',')) {
    const [surname, ...rest] = trimmed.split(',');
    return `${titleCase(surname.trim())}, ${titleCase(rest.join(',').trim())}`;
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return trimmed;
  const isUpper = (t: string) => t === t.toUpperCase() && t !== t.toLowerCase();
  const upperIdx = tokens.findIndex(isUpper);
  const surnameIdx = upperIdx !== -1 ? upperIdx : tokens.length - 1;
  const surname = tokens[surnameIdx];
  const firstname = tokens.filter((_, i) => i !== surnameIdx).join(' ');
  return `${titleCase(surname)}, ${titleCase(firstname)}`;
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
    if (matched) {
      return {
        name: matched.name,
        title: matched.title,
        fideId: String(matched.id),
        standardElo: matched.standard,
        rapidElo: matched.rapid,
        blitzElo: matched.blitz,
      };
    }
  } catch {
    // network hiccup: fall through to asking for a manual FIDE id
  }

  const id = (await askFideId(ffeName)).trim();
  if (!id) return { name: normalizeUnmatchedName(ffeName) };

  return (await resolveFideById(id)) ?? { name: normalizeUnmatchedName(ffeName) };
}
