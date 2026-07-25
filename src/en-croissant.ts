import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { splitGames, getTag } from './pgn.ts';

// Syncs every game from a merged PGN file into the en-croissant sqlite DB.
// Skips games whose Site URL already exists (idempotent — safe to call
// after every run). Returns the number of newly inserted games.
export function syncToDb(pgnPath: string, dbPath: string): number {
  const db = new DatabaseSync(dbPath);
  ensureSchema(db);

  const pgn = splitGames(readFileSync(pgnPath, 'utf8'));
  let inserted = 0;

  const insertSite = db.prepare('INSERT INTO Sites (Name) VALUES (?)');
  const selectSite = db.prepare('SELECT ID FROM Sites WHERE Name = ?');
  const resolveSite = (name: string): number | bigint => {
    const existing = selectSite.get(name) as { ID: number | bigint } | undefined;
    if (existing) return existing.ID;
    return insertSite.run(name).lastInsertRowid as number;
  };

  const insertEvent = db.prepare('INSERT INTO Events (Name) VALUES (?)');
  const selectEvent = db.prepare('SELECT ID FROM Events WHERE Name = ?');
  const getEventId = (name: string): number | bigint => {
    const existing = selectEvent.get(name) as { ID: number | bigint } | undefined;
    if (existing) return existing.ID;
    const r = insertEvent.run(name);
    return BigInt(r.lastInsertRowid as number);
  };

  const insertPlayer = db.prepare('INSERT INTO Players (Name, Elo) VALUES (?, ?)');
  const selectPlayer = db.prepare('SELECT ID FROM Players WHERE Name = ?');
  const getPlayerId = (name: string, elo: string | null): number | bigint => {
    const existing = selectPlayer.get(name) as { ID: number | bigint } | undefined;
    if (existing) return existing.ID;
    const r = insertPlayer.run(name, elo ? parseInt(elo, 10) || null : null);
    return BigInt(r.lastInsertRowid as number);
  };

  const insertGame = db.prepare(`
    INSERT INTO Games (EventID, SiteID, Date, Round, WhiteID, WhiteElo, BlackID, BlackElo, Result, TimeControl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const g of pgn) {
    const site = getTag(g, 'Site') ?? getTag(g, 'ChapterURL');
    if (!site) continue;
    const siteExists = selectSite.get(site);
    if (siteExists) continue;

    const eventName = getTag(g, 'Event') ?? '?';
    const eventId = getEventId(eventName);

    const whiteName = getTag(g, 'White') ?? '?';
    const blackName = getTag(g, 'Black') ?? '?';
    const whiteElo = getTag(g, 'WhiteElo');
    const blackElo = getTag(g, 'BlackElo');
    const whiteId = getPlayerId(whiteName, whiteElo);
    const blackId = getPlayerId(blackName, blackElo);

    const siteId = resolveSite(site);

    const round = getTag(g, 'Round') ?? '?';
    const date = getTag(g, 'Date') ?? getTag(g, 'UTCDate')?.replace(/\./g, '-') ?? null;

    insertGame.run(
      eventId,
      siteId,
      date || '????.??.??',
      round,
      whiteId,
      whiteElo ? parseInt(whiteElo, 10) || null : 0,
      blackId,
      blackElo ? parseInt(blackElo, 10) || null : 0,
      getTag(g, 'Result') || '*',
      getTag(g, 'TimeControl'),
    );
    inserted++;
  }

  // en-croissant caches counts in the Info table — update them
  if (inserted > 0) {
    db.prepare('UPDATE Info SET Value = (SELECT COUNT(*) FROM Games) WHERE Name = \'GameCount\'').run();
    db.prepare('UPDATE Info SET Value = (SELECT COUNT(*) FROM Players) WHERE Name = \'PlayerCount\'').run();
    db.prepare('UPDATE Info SET Value = (SELECT COUNT(*) FROM Events) WHERE Name = \'EventCount\'').run();
    db.prepare('UPDATE Info SET Value = (SELECT COUNT(*) FROM Sites) WHERE Name = \'SiteCount\'').run();
  }

  db.close();
  return inserted;
}

// Creates the en-croissant schema if the DB is brand new (non-classical DB).
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
  const version = db.prepare("SELECT Value FROM Info WHERE Name = 'Version'").get() as { Value: string } | undefined;
  if (!version) {
    db.prepare("INSERT INTO Info (Name, Value) VALUES ('Version', '1.0.0')").run();
    db.prepare("INSERT INTO Info (Name, Value) VALUES ('Title', 'Mes Parties (non classique)')").run();
    db.prepare("INSERT INTO Info (Name, Value) VALUES ('Description', '')").run();
    db.prepare("INSERT INTO Info (Name, Value) VALUES ('GameCount', '0')").run();
    db.prepare("INSERT INTO Info (Name, Value) VALUES ('PlayerCount', '0')").run();
    db.prepare("INSERT INTO Info (Name, Value) VALUES ('EventCount', '0')").run();
    db.prepare("INSERT INTO Info (Name, Value) VALUES ('SiteCount', '0')").run();
  }
}
