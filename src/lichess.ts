import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const API = 'https://lichess.org/api';
const DOWNLOADED_DIR = 'downloaded';
const MANIFEST_PATH = 'manifest.json';
const IGNORED_PATH = 'ignored.json';

export interface StudyRef {
  id: string;
  name: string;
}

function authHeaders(): Record<string, string> {
  const token = process.env.LICHESS_TOKEN;
  if (!token) { throw new Error('LICHESS_TOKEN not set (check .env)'); }
  return { Authorization: `Bearer ${token}` };
}

export async function listStudies(username: string): Promise<StudyRef[]> {
  const res = await fetch(`${API}/study/by/${username}`, {
    headers: authHeaders(),
  });
  if (!res.ok) { throw new Error(`lichess list studies failed: ${res.status}`); }
  const text = await res.text();
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .map(s => ({ id: s.id, name: s.name }));
}

export async function downloadStudy(studyId: string): Promise<string> {
  const res = await fetch(`${API}/study/${studyId}.pgn`, {
    headers: authHeaders(),
  });
  if (!res.ok) { throw new Error(`lichess download study failed: ${res.status}`); }
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = disposition.match(/filename=(.+)$/);
  const filename = match ? match[1].trim() : `${studyId}.pgn`;
  const pgn = await res.text();
  writeFileSync(`${DOWNLOADED_DIR}/${filename}`, pgn);
  return filename;
}

function extractStudyId(pgn: string): string | null {
  const m = pgn.match(/\[Site "https:\/\/lichess\.org\/study\/(\w+)/);
  return m ? m[1] : null;
}

export function extractChapterId(game: string): string | null {
  const m = game.match(
    /\[(?:Site|ChapterURL) "https:\/\/lichess\.org\/study\/\w+\/(\w+)/,
  );
  return m ? m[1] : null;
}

// Updates only the tags provided; existing tags not listed are left as-is.
// Pass an empty value ("") to delete a tag.
export async function updateChapterTags(
  studyId: string,
  chapterId: string,
  tags: Record<string, string>,
): Promise<void> {
  const pgn = Object.entries(tags)
    .map(([tag, value]) => `[${tag} "${value}"]`)
    .join('\n');
  const res = await fetch(`${API}/study/${studyId}/${chapterId}/tags`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ pgn }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`lichess update chapter tags failed: ${res.status} ${body}`);
  }
}

export function loadManifest(): Record<string, string> {
  if (!existsSync(MANIFEST_PATH)) {
    return bootstrapManifest();
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

export function saveManifest(manifest: Record<string, string>): void {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
}

function bootstrapManifest(): Record<string, string> {
  const manifest: Record<string, string> = {};
  for (const filename of readdirSync(DOWNLOADED_DIR)) {
    if (!filename.endsWith('.pgn')) { continue; }
    const pgn = readFileSync(`${DOWNLOADED_DIR}/${filename}`, 'utf8');
    const studyId = extractStudyId(pgn);
    if (studyId) { manifest[studyId] = filename; }
  }
  saveManifest(manifest);
  return manifest;
}

export function studiesNotDownloaded(
  studies: StudyRef[],
  manifest: Record<string, string>,
  ignored: string[] = [],
): StudyRef[] {
  const ignoredSet = new Set(ignored);
  return studies.filter(s => !(s.id in manifest) && !ignoredSet.has(s.id));
}

export function loadIgnored(): string[] {
  if (!existsSync(IGNORED_PATH)) { return []; }
  return JSON.parse(readFileSync(IGNORED_PATH, 'utf8'));
}

export function ignoreStudy(id: string): void {
  const ignored = loadIgnored();
  if (!ignored.includes(id)) { ignored.push(id); }
  writeFileSync(IGNORED_PATH, JSON.stringify(ignored, null, 2) + '\n');
}
