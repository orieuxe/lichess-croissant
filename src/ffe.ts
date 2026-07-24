import * as cheerio from 'cheerio';

export interface FicheTournoi {
  title: string;
  startDate: string;
  endDate: string;
  numRounds: number;
  cadenceText: string;
  resultsLinks: Record<string, string>;
}

export interface RoundResult {
  round: number;
  color: 'N' | 'B' | null;
  result: '+' | '=' | '-' | null;
  opponentName: string | null;
  opponentElo: string | null;
}

const UA = { 'User-Agent': 'Mozilla/5.0' };

export async function fetchFiche(url: string): Promise<FicheTournoi> {
  const html = await (await fetch(url, { headers: UA })).text();
  const $ = cheerio.load(html);
  const title = $('#ctl00_ContentPlaceHolderMain_LabelNom').text().trim();
  const dates = $('#ctl00_ContentPlaceHolderMain_LabelDates').text().trim();
  const [startDate, endDate] = dates.split(' - ').map(s => s.trim());
  const numRounds = parseInt(
    $('#ctl00_ContentPlaceHolderMain_LabelNbrRondes').text().trim(),
    10,
  );
  const cadenceText = $('#ctl00_ContentPlaceHolderMain_LabelCadence')
    .text()
    .trim();

  const resultsLinks: Record<string, string> = {};
  $('a[href*="Resultats.aspx"]').each((_, a) => {
    const href = $(a).attr('href');
    if (!href) return;
    const absolute = new URL(href.replace(/&amp;/g, '&'), url).href;
    const action = new URL(absolute).searchParams.get('Action');
    if (action) resultsLinks[action] = absolute;
  });

  return { title, startDate, endDate, numRounds, cadenceText, resultsLinks };
}

export interface PlayerRounds {
  ownElo: string;
  rounds: RoundResult[];
}

export async function fetchRounds(
  url: string,
  playerFullName: string,
): Promise<PlayerRounds> {
  const html = await (await fetch(url, { headers: UA })).text();
  const $ = cheerio.load(html);

  const numRounds = $('td.papi_r')
    .toArray()
    .map(el => $(el).text().trim())
    .filter(t => /^R\s*\d+$/.test(t)).length;

  const byRank = new Map<string, { name: string; elo: string }>();
  const rows: { rank: string; name: string; cells: string[] }[] = [];

  $('tr.papi_small_f, tr.papi_small_c').each((_, tr) => {
    const cells = $(tr)
      .children('td')
      .toArray()
      .map(td => $(td).text().replace(/\u00A0/g, ' ').trim());
    const nameEl = $(tr).find('> td > div.papi_joueur_box > b').first();
    if (!nameEl.length || cells.length < 7 + numRounds) return;

    const rank = cells[0];
    const name = nameEl.text().trim();
    const elo = cells[3];
    byRank.set(rank, { name, elo });
    rows.push({ rank, name, cells });
  });

  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const own = rows.find(r => normalize(r.name) === normalize(playerFullName));
  if (!own) {
    throw new Error(`player "${playerFullName}" not found in FFE results`);
  }

  const roundCells = own.cells.slice(7, 7 + numRounds);
  const rounds = roundCells.map((raw, i) => {
    const m = raw.match(/^([+=-])?\s*(\d+)?\s*([NB])?$/);
    if (!m || !m[2]) {
      return {
        round: i + 1,
        color: null,
        result: null,
        opponentName: null,
        opponentElo: null,
      };
    }
    const [, result, oppRank, color] = m;
    const opp = byRank.get(oppRank);
    return {
      round: i + 1,
      color: (color as 'N' | 'B') ?? null,
      result: (result as '+' | '=' | '-') ?? null,
      opponentName: opp?.name ?? null,
      opponentElo: opp?.elo ?? null,
    };
  });

  return { ownElo: own.cells[3], rounds };
}

// ponytail: titles ("f", "g", "m"...) show up as a lowercase word glued onto
// the name on these pages instead of their own column — dropping any
// all-lowercase token strips them without a title whitelist to maintain.
function normalizeLooseName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\s+/)
    .filter(tok => !/^[a-z]+$/.test(tok))
    .join(' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

function parseClosedResult(raw: string, wasWhite: boolean): '+' | '=' | '-' | null {
  const m = raw.match(/^(X|\d|½)\s*-\s*(X|\d|½)$/);
  if (!m || m[1] === 'X') return null;
  const [whiteScore, blackScore] = [m[1], m[2]];
  const ourScore = wasWhite ? whiteScore : blackScore;
  if (ourScore === '½') return '=';
  const oppScore = wasWhite ? blackScore : whiteScore;
  return ourScore > oppScore ? '+' : '-';
}

// Closed/round-robin tournaments have no "Grille Américaine" — same round
// data lives across two simpler pages instead: Action=Pairing (round-by-round
// White/Black pairs + result) and Action=Berger (player list with Elo, used
// here only for the name→Elo lookup, not the cross-table itself).
export async function fetchClosedRounds(
  pairingUrl: string,
  bergerUrl: string,
  playerFullName: string,
): Promise<PlayerRounds> {
  const bergerHtml = await (await fetch(bergerUrl, { headers: UA })).text();
  const $berger = cheerio.load(bergerHtml);
  const eloByName = new Map<string, string>();
  $berger('tr.papi_liste_c').each((_, tr) => {
    const cells = $berger(tr).children('td').toArray();
    if (cells.length < 4) return;
    const name = $berger(cells[1]).text().trim();
    const elo = $berger(cells[3]).text().replace(/ /g, ' ').trim();
    if (name && elo) eloByName.set(normalizeLooseName(name), elo);
  });

  const pairingHtml = await (await fetch(pairingUrl, { headers: UA })).text();
  const $pairing = cheerio.load(pairingHtml);
  const target = normalizeLooseName(playerFullName);

  const rounds: RoundResult[] = [];
  let currentRound = 0;
  $pairing('tr.papi_liste_t, tr.papi_liste_c').each((_, tr) => {
    const el = $pairing(tr);
    if (el.hasClass('papi_liste_t')) {
      const m = el.text().match(/RONDE\s+(\d+)/i);
      if (m) currentRound = parseInt(m[1], 10);
      return;
    }
    const cells = el.children('td').toArray();
    if (cells.length !== 3 || !currentRound) return;
    const whiteName = $pairing(cells[0]).text().trim();
    const resultText = $pairing(cells[1]).text().replace(/ /g, ' ').trim();
    const blackName = $pairing(cells[2]).text().trim();

    const isWhite = normalizeLooseName(whiteName) === target;
    const isBlack = normalizeLooseName(blackName) === target;
    if (!isWhite && !isBlack) return;

    const opponentName = isWhite ? blackName : whiteName;
    rounds.push({
      round: currentRound,
      color: isWhite ? 'B' : 'N',
      result: parseClosedResult(resultText, isWhite),
      opponentName,
      opponentElo: eloByName.get(normalizeLooseName(opponentName)) ?? null,
    });
  });

  rounds.sort((a, b) => a.round - b.round);
  return { ownElo: eloByName.get(target) ?? '', rounds };
}
