const API = 'https://api.grandroque.fr/api/v1';

export interface ProfileGame {
  id: string;
  date: string;
  competition_title: string;
  competition_id: string | null;
  tournament_id: string | null;
  board_number: number;
  round_number: number;
  white_player_name: string;
  white_elo: number | null;
  white_fide_id: number | null;
  white_fide_title?: string | null;
  black_player_name: string;
  black_elo: number | null;
  black_fide_id: number | null;
  black_fide_title?: string | null;
  result: string;
  cadence: 'classical' | 'rapid' | 'blitz';
  source_type: string;
}

export interface OurSideMatch {
  game: ProfileGame;
  ourSide: 'White' | 'Black';
  opponentName: string;
  opponentElo: number | null;
  opponentFideId: number | null;
}

// Resolves the profile slug from a FIDE id — avoids name-search ambiguity.
export async function fetchPlayerSlug(fideId: string): Promise<string | null> {
  try {
    const res = await fetch(`${API}/players/fide/${encodeURIComponent(fideId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.slug ?? null;
  } catch {
    return null;
  }
}

// All games (team competitions AND individual tournaments), paginated.
export async function fetchProfileGames(slug: string): Promise<ProfileGame[]> {
  const all: ProfileGame[] = [];
  let cursor: string | undefined;
  while (true) {
    const params = new URLSearchParams({ limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const res = await fetch(`${API}/profiles/${encodeURIComponent(slug)}/games?${params}`);
    if (!res.ok) break;
    const page = await res.json();
    all.push(...(page.items ?? []));
    if (!page.has_more || !page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return all;
}

function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

function nameOverlapScore(a: string, b: string): number {
  const ta = new Set(normalizeName(a).split(' '));
  const tb = new Set(normalizeName(b).split(' '));
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common;
}

// The match that has the best opponent-name overlap with the hint — but only
// when unambiguous (positive score, no tie). Returns null when the caller
// should present a numbered picker or give up.
export function matchGame(hintName: string, candidates: ProfileGame[], ourName: string): ProfileGame | null {
  const scored = candidates
    .map(g => ({ g, score: nameOverlapScore(hintName, opponentNameOf(g, ourName)) }))
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0 || scored[0].score <= 0) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0].g;
}

// Ranked candidates when matchGame can't decide — best first, no threshold.
export function rankedGames(hintName: string, candidates: ProfileGame[], ourName: string): ProfileGame[] {
  return candidates
    .map(g => ({ g, score: nameOverlapScore(hintName, opponentNameOf(g, ourName)) }))
    .sort((a, b) => b.score - a.score)
    .filter(s => s.score > 0)
    .map(s => s.g);
}

function opponentNameOf(g: ProfileGame, ourName: string): string {
  return normalizeName(g.white_player_name) === normalizeName(ourName)
    ? g.black_player_name
    : g.white_player_name;
}

export function ourSideOf(pg: ProfileGame, ourName: string): OurSideMatch {
  const ourIsWhite = normalizeName(pg.white_player_name) === normalizeName(ourName);
  return ourIsWhite
    ? {
        game: pg,
        ourSide: 'White',
        opponentName: pg.black_player_name,
        opponentElo: pg.black_elo,
        opponentFideId: pg.black_fide_id,
      }
    : {
        game: pg,
        ourSide: 'Black',
        opponentName: pg.white_player_name,
        opponentElo: pg.white_elo,
        opponentFideId: pg.white_fide_id,
      };
}

// PGN-style absolute result ("1-0"/"0-1"/"1/2-1/2") -> relative to us, same
// tri-state convention as the FFE flow ('+'/'='/'-').
export function resultRelativeToUs(absoluteResult: string, ourSide: 'White' | 'Black'): '+' | '=' | '-' | null {
  if (absoluteResult === '1/2-1/2') return '=';
  if (absoluteResult === '1-0') return ourSide === 'White' ? '+' : '-';
  if (absoluteResult === '0-1') return ourSide === 'White' ? '-' : '+';
  return null;
}

// Best-effort parse of a chapter title like "B vs Muthaiah AL 2442".
export function parseChapterHint(title: string): { color: 'White' | 'Black' | null; opponentName: string | null; opponentElo: number | null } {
  const m = title.match(/^([BN])\s+vs\.?\s*(.*?)\s*(\d{3,4})?$/i);
  if (!m) return { color: null, opponentName: null, opponentElo: null };
  return {
    color: m[1].toUpperCase() === 'B' ? 'White' : 'Black',
    opponentName: m[2]?.trim() || null,
    opponentElo: m[3] ? parseInt(m[3], 10) : null,
  };
}
