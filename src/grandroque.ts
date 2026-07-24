const API = 'https://api.grandroque.fr/api/v1';

export interface PlayerMatch {
  id: string;
  team_match_id: string;
  board_number: number;
  white_player_name: string;
  white_player_elo: number | null;
  black_player_name: string;
  black_player_elo: number | null;
  result: string;
  created_at: string;
  competition_title: string;
  white_team_name: string;
  black_team_name: string;
}

export async function fetchPlayerMatches(playerName: string): Promise<PlayerMatch[]> {
  const res = await fetch(`${API}/competitions/player-matches?player_name=${encodeURIComponent(playerName)}`);
  if (!res.ok) return [];
  return res.json();
}

export interface MatchHint {
  color: 'White' | 'Black' | null;
  opponentName: string | null;
  opponentElo: number | null;
  date: Date | null;
}

function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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

export interface OurSideMatch {
  match: PlayerMatch;
  ourSide: 'White' | 'Black';
  opponentName: string;
  opponentElo: number | null;
}

export function ourSideOf(pm: PlayerMatch, ourName: string): OurSideMatch {
  const ourIsWhite = normalizeName(pm.white_player_name) === normalizeName(ourName);
  return ourIsWhite
    ? { match: pm, ourSide: 'White', opponentName: pm.black_player_name, opponentElo: pm.black_player_elo }
    : { match: pm, ourSide: 'Black', opponentName: pm.white_player_name, opponentElo: pm.white_player_elo };
}

function scoreMatch(m: OurSideMatch, hint: MatchHint): number {
  let score = 0;
  if (hint.color) score += hint.color === m.ourSide ? 3 : -5;
  if (hint.opponentName) score += nameOverlapScore(hint.opponentName, m.opponentName) * 2;
  if (hint.opponentElo && m.opponentElo && Math.abs(hint.opponentElo - m.opponentElo) <= 5) score += 3;
  if (hint.date) {
    const created = new Date(m.match.created_at);
    const days = Math.abs((created.getTime() - hint.date.getTime()) / 86400000);
    if (days <= 1) score += 4;
    else if (days <= 7) score += 2;
    else if (days <= 30) score += 1;
  }
  return score;
}

// ponytail: picks a match only when scoring is unambiguous (positive top
// score, no tie) — anything murkier goes to the caller's manual picker
// rather than risk silently tagging the wrong game.
export function bestMatch(
  candidates: PlayerMatch[],
  ourName: string,
  hint: MatchHint,
): OurSideMatch | null {
  const scored = candidates
    .map(pm => ourSideOf(pm, ourName))
    .map(m => ({ m, score: scoreMatch(m, hint) }))
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0 || scored[0].score <= 0) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0].m;
}

// Best-effort parse of a chapter title like "B vs Muthaiah AL 2442".
export function parseChapterHint(title: string): Omit<MatchHint, 'date'> {
  const m = title.match(/^([BN])\s+vs\.?\s*(.*?)\s*(\d{3,4})?$/i);
  if (!m) return { color: null, opponentName: null, opponentElo: null };
  return {
    color: m[1].toUpperCase() === 'B' ? 'White' : 'Black',
    opponentName: m[2]?.trim() || null,
    opponentElo: m[3] ? parseInt(m[3], 10) : null,
  };
}
