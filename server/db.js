import { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Set DB_PATH to a persistent volume in production (e.g. /data/buzzboard.db).
const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'buzzboard.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`);

export function defaultGame(title = 'Untitled Game') {
  const makeRound = (mult) => ({
    categories: Array.from({ length: 5 }, () => ({
      name: '',
      clues: Array.from({ length: 5 }, (_, i) => ({
        value: (i + 1) * 200 * mult,
        question: '',
        answer: '',
        dailyDouble: false,
        media: null
      }))
    }))
  });
  return {
    title,
    settings: { answerSeconds: 7, finalSeconds: 45, useDoubleJeopardy: true, useFinal: true, buzzMode: 'typewriter' },
    rounds: [
      { name: 'Round One', multiplier: 1, ...makeRound(1) },
      { name: 'Double Points', multiplier: 2, ...makeRound(2) }
    ],
    final: { category: '', question: '', answer: '', media: null }
  };
}

// Migration: per-game edit keys so only the creator can modify/delete.
const cols = db.prepare('PRAGMA table_info(games)').all();
if (!cols.some(c => c.name === 'edit_key')) {
  db.exec('ALTER TABLE games ADD COLUMN edit_key TEXT');
}

// Rename rounds saved under older, trademarked names.
const LEGACY_ROUND_NAMES = { 'Jeopardy': 'Round One', 'Double Jeopardy': 'Double Points' };
function migrate(game) {
  for (const r of game.rounds || []) {
    if (LEGACY_ROUND_NAMES[r.name]) r.name = LEGACY_ROUND_NAMES[r.name];
  }
  return game;
}

export function createGame(data) {
  const id = nanoid(10);
  const editKey = nanoid(21);
  const now = Date.now();
  const game = data || defaultGame();
  db.prepare('INSERT INTO games (id, title, data, created_at, updated_at, edit_key) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, game.title, JSON.stringify(game), now, now, editKey);
  return { id, editKey, ...game };
}

export function getGame(id) {
  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
  if (!row) return null;
  return { id: row.id, ...migrate(JSON.parse(row.data)) };
}

// Legacy rows (edit_key NULL, created before keys existed) stay editable.
function authorized(id, key) {
  const row = db.prepare('SELECT edit_key FROM games WHERE id = ?').get(id);
  if (!row) return false;
  return row.edit_key == null || row.edit_key === key;
}

export function updateGame(id, data, key) {
  if (!authorized(id, key)) return 'forbidden';
  const res = db.prepare('UPDATE games SET title = ?, data = ?, updated_at = ? WHERE id = ?')
    .run(data.title || 'Untitled Game', JSON.stringify(data), Date.now(), id);
  return res.changes > 0;
}

export function deleteGame(id, key) {
  if (!authorized(id, key)) return 'forbidden';
  return db.prepare('DELETE FROM games WHERE id = ?').run(id).changes > 0;
}

export function listGames() {
  return db.prepare('SELECT id, title, updated_at FROM games ORDER BY updated_at DESC LIMIT 100').all();
}
