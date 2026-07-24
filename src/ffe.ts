import * as cheerio from 'cheerio';

export interface FicheTournoi {
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
  const dates = $('#ctl00_ContentPlaceHolderMain_LabelDates').text().trim();
  const [startDate, endDate] = dates.split(' - ').map((s) => s.trim());
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

  return { startDate, endDate, numRounds, cadenceText, resultsLinks };
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
    .map((el) => $(el).text().trim())
    .filter((t) => /^R\s*\d+$/.test(t)).length;

  const byRank = new Map<string, { name: string; elo: string }>();
  const rows: { rank: string; name: string; cells: string[] }[] = [];

  $('tr.papi_small_f, tr.papi_small_c').each((_, tr) => {
    const cells = $(tr)
      .children('td')
      .toArray()
      .map((td) => $(td).text().replace(/ /g, ' ').trim());
    const nameEl = $(tr).find('> td > div.papi_joueur_box > b').first();
    if (!nameEl.length || cells.length < 7 + numRounds) return;

    const rank = cells[0];
    const name = nameEl.text().trim();
    const elo = cells[3];
    byRank.set(rank, { name, elo });
    rows.push({ rank, name, cells });
  });

  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const own = rows.find((r) => normalize(r.name) === normalize(playerFullName));
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
