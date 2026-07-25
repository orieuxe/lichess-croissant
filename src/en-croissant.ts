import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Chess } from 'chess.js';
import { splitGames, getTag } from './pgn.ts';

// Encodes PGN movetext to en-croissant's binary format (one byte per move,
// each byte = index in the legal-move list at that position).
function encodeMoves(pgnGame: string): { moves: Uint8Array; plyCount: number } {
  const normalized = pgnGame.replace(/\r\n/g, '\n');
  const headerEnd = normalized.indexOf('\n\n');
  if (headerEnd === -1) { return { moves: new Uint8Array(0), plyCount: 0 }; }
  let raw = normalized.slice(headerEnd + 2)
    .replace(/\{[^}]*\}/g, '')
    .replace(/\d+\.\.\./g, '')
    .replace(/\b(1-0|0-1|1\/2-1\/2|\*)\s*$/g, '')
    .trim();
  let prev: string;
  do {
    prev = raw;
    raw = raw.replace(/\([^()]*\)/g, '');
  } while (raw !== prev);
  if (!raw) { return { moves: new Uint8Array(0), plyCount: 0 }; }

  const chess = new Chess();
  const bytes: number[] = [];
  const tokens = raw.split(/\s+/);
  for (const token of tokens) {
    if (/^\d+\./.test(token)) { continue; } // move number prefix
    try {
      const legal = chess.moves({ verbose: true });
      const move = legal.find(m => m.san === token);
      if (!move) { break; }
      bytes.push(legal.indexOf(move));
      chess.move(token);
    } catch {
      break;
    }
  }
  return { moves: new Uint8Array(bytes), plyCount: bytes.length };
}

export function syncToDb(pgnPath: string, dbPath: string): number {
  const db = new DatabaseSync(dbPath);
  ensureSchema(db);

  const pgn = splitGames(readFileSync(pgnPath, 'utf8'));
  let inserted = 0;

  const insertSite = db.prepare('INSERT INTO Sites (Name) VALUES (?)');
  const selectSite = db.prepare('SELECT ID FROM Sites WHERE Name = ?');
  const resolveSite = (name: string): number | bigint => {
    const existing = selectSite.get(name) as { ID: number | bigint } | undefined;
    if (existing) { return existing.ID; }
    return insertSite.run(name).lastInsertRowid as number;
  };

  const insertEvent = db.prepare('INSERT INTO Events (Name) VALUES (?)');
  const selectEvent = db.prepare('SELECT ID FROM Events WHERE Name = ?');
  const getEventId = (name: string): number | bigint => {
    const existing = selectEvent.get(name) as { ID: number | bigint } | undefined;
    if (existing) { return existing.ID; }
    const r = insertEvent.run(name);
    return BigInt(r.lastInsertRowid as number);
  };

  const insertPlayer = db.prepare('INSERT INTO Players (Name, Elo) VALUES (?, ?)');
  const selectPlayer = db.prepare('SELECT ID FROM Players WHERE Name = ?');
  const getPlayerId = (name: string, elo: string | null): number | bigint => {
    const existing = selectPlayer.get(name) as { ID: number | bigint } | undefined;
    if (existing) { return existing.ID; }
    const r = insertPlayer.run(name, elo ? parseInt(elo, 10) || null : null);
    return BigInt(r.lastInsertRowid as number);
  };

  const insertGame = db.prepare(`
    INSERT INTO Games (EventID, SiteID, Date, Round, WhiteID, WhiteElo, BlackID, BlackElo, Result, TimeControl, WhiteMaterial, BlackMaterial, ECO, PlyCount, Moves, PawnHome)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, '', ?, ?, 0)
  `);

  for (const g of pgn) {
    const site = getTag(g, 'Site') ?? getTag(g, 'ChapterURL');
    if (!site) { continue; }
    const siteExists = selectSite.get(site);
    if (siteExists) { continue; }

    const eventName = getTag(g, 'Event') ?? '?';
    const eventId = getEventId(eventName);

    const whiteName = getTag(g, 'White') ?? '?';
    const blackName = getTag(g, 'Black') ?? '?';
    const whiteElo = getTag(g, 'WhiteElo');
    const blackElo = getTag(g, 'BlackElo');
    const whiteId = getPlayerId(whiteName, whiteElo);
    const blackId = getPlayerId(blackName, blackElo);

    const siteId = resolveSite(site);

    const roundTag = getTag(g, 'Round') ?? '?';
    const roundVal = /^\d+$/.test(roundTag) ? parseInt(roundTag, 10) : roundTag;
    const date = getTag(g, 'Date') ?? getTag(g, 'UTCDate')?.replace(/\./g, '-') ?? null;

    const { moves, plyCount } = encodeMoves(g);

    insertGame.run(
      eventId,
      siteId,
      date || '????.??.??',
      roundVal,
      whiteId,
      whiteElo ? parseInt(whiteElo, 10) || null : 0,
      blackId,
      blackElo ? parseInt(blackElo, 10) || null : 0,
      getTag(g, 'Result') || '*',
      getTag(g, 'TimeControl'),
      plyCount,
      moves,
    );
    inserted++;
  }

  if (inserted > 0) {
    db.prepare('UPDATE Info SET Value = (SELECT COUNT(*) FROM Games) WHERE Name = \'GameCount\'').run();
    db.prepare('UPDATE Info SET Value = (SELECT COUNT(*) FROM Players) WHERE Name = \'PlayerCount\'').run();
    db.prepare('UPDATE Info SET Value = (SELECT COUNT(*) FROM Events) WHERE Name = \'EventCount\'').run();
    db.prepare('UPDATE Info SET Value = (SELECT COUNT(*) FROM Sites) WHERE Name = \'SiteCount\'').run();
  }

  db.close();
  return inserted;
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS Info (Name TEXT, Value TEXT);
    CREATE TABLE IF NOT EXISTS Events (ID INTEGER PRIMARY KEY AUTOINCREMENT, Name TEXT);
    CREATE TABLE IF NOT EXISTS Sites (ID INTEGER PRIMARY KEY AUTOINCREMENT, Name TEXT);
    CREATE TABLE IF NOT EXISTS Players (ID INTEGER PRIMARY KEY AUTOINCREMENT, Name TEXT, Elo INTEGER);
    CREATE TABLE IF NOT EXISTS Games (
      ID INTEGER PRIMARY KEY AUTOINCREMENT,
      EventID INTEGER, SiteID INTEGER, Date TEXT, UTCTime TEXT, Round TEXT,
      WhiteID INTEGER, WhiteElo INTEGER, BlackID INTEGER, BlackElo INTEGER,
      WhiteMaterial INTEGER, BlackMaterial INTEGER,
      Result TEXT, TimeControl TEXT, ECO TEXT, PlyCount INTEGER,
      FEN TEXT, Moves BLOB, PawnHome BLOB
    );
    CREATE INDEX IF NOT EXISTS games_date_idx ON Games(Date);
    CREATE INDEX IF NOT EXISTS games_white_idx ON Games(WhiteID);
    CREATE INDEX IF NOT EXISTS games_black_idx ON Games(BlackID);
    CREATE INDEX IF NOT EXISTS games_result_idx ON Games(Result);
  `);

  // Bootstrap the Info table if empty (fresh DB).
  const version = db.prepare('SELECT Value FROM Info WHERE Name = \'Version\'').get() as { Value: string } | undefined;
  if (!version) {
    db.prepare('INSERT INTO Info (Name, Value) VALUES (\'Version\', \'1.0.0\')').run();
    db.prepare('INSERT INTO Info (Name, Value) VALUES (\'Title\', \'Mes Parties (non classique)\')').run();
    db.prepare('INSERT INTO Info (Name, Value) VALUES (\'Description\', \'\')').run();
    db.prepare('INSERT INTO Info (Name, Value) VALUES (\'GameCount\', \'0\')').run();
    db.prepare('INSERT INTO Info (Name, Value) VALUES (\'PlayerCount\', \'0\')').run();
    db.prepare('INSERT INTO Info (Name, Value) VALUES (\'EventCount\', \'0\')').run();
    db.prepare('INSERT INTO Info (Name, Value) VALUES (\'SiteCount\', \'0\')').run();
  }
}
