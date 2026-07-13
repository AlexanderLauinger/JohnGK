import express from 'express';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import rateLimit from 'express-rate-limit';
import * as db from './db.js';
import * as R from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

app.use(express.json({ limit: '2mb' }));

// ---- Rate limiting (per IP) ----
// Set TRUST_PROXY=1 when running behind a reverse proxy (nginx/Caddy/Fly/Railway)
// so limits apply to the real client IP, not the proxy's.
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
const limiter = (limit, windowMs = 60_000) =>
  rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false });
app.use('/api', limiter(300));            // general API: 300 req/min
app.use('/api/tts', limiter(40));         // TTS synth is the priciest call
app.post('/api/games', limiter(15));      // game creation: 15/min stops spam

// ---- REST: game CRUD ----
// No public listing: games are only reachable by id (link) — the home page
// shows just the games whose edit keys live in your browser.
app.post('/api/games', (req, res) => res.json(db.createGame(req.body?.data)));
app.get('/api/games/:id', (req, res) => {
  const g = db.getGame(req.params.id);
  if (!g) return res.status(404).json({ error: 'not found' });
  res.json(g);
});
app.put('/api/games/:id', (req, res) => {
  const result = db.updateGame(req.params.id, req.body, req.get('x-edit-key'));
  if (result === 'forbidden') return res.status(403).json({ error: 'You do not have edit access to this game.' });
  if (!result) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});
app.delete('/api/games/:id', (req, res) => {
  const result = db.deleteGame(req.params.id, req.get('x-edit-key'));
  if (result === 'forbidden') return res.status(403).json({ error: 'You do not have edit access to this game.' });
  res.json({ ok: true });
});
// ---- Neural TTS (free Microsoft Edge voices, no API key) ----
// The host page falls back to browser Web Speech if this endpoint fails.
let ttsEngine = null;
const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, rej) => setTimeout(() => rej(new Error('tts timeout')), ms))
]);

app.get('/api/tts', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 600).trim();
  if (!text) return res.status(400).json({ error: 'no text' });
  try {
    if (!ttsEngine) {
      const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
      const engine = new MsEdgeTTS();
      // Hard timeout: a hung connection to the TTS service must fail fast so
      // the host page can fall back to browser speech instead of freezing.
      await withTimeout(engine.setMetadata(
        process.env.TTS_VOICE || 'en-US-AriaNeural',
        OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3
      ), 4000);
      ttsEngine = engine;
    }
    const result = await withTimeout(ttsEngine.toStream(text), 4000);
    const stream = result.audioStream || result;
    res.setHeader('Content-Type', 'audio/mpeg');
    // If audio stalls mid-stream, end the response so the client isn't stuck.
    const stall = setTimeout(() => { ttsEngine = null; res.end(); }, 15000);
    stream.on('error', () => { clearTimeout(stall); ttsEngine = null; res.end(); });
    stream.on('end', () => clearTimeout(stall));
    stream.pipe(res);
  } catch (e) {
    ttsEngine = null; // reset so the next request retries a fresh connection
    if (!res.headersSent) res.status(502).json({ error: 'tts unavailable' });
    else res.end();
  }
});

app.get('/api/lan-ip', (req, res) => {
  const nets = os.networkInterfaces();
  let ip = null;
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) { ip = n.address; break; }
    }
    if (ip) break;
  }
  res.json({ ip, port: PORT });
});

// ---- Static (built client) ----
const dist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(dist));
app.get(/^\/(?!api|socket\.io).*/, (req, res) => {
  res.sendFile(path.join(dist, 'index.html'), (err) => {
    if (err) res.status(200).send('John G.K. server running. Build the client first (npm run build) or use the Vite dev server.');
  });
});

// ---- Sockets ----
function sync(room) {
  const pub = R.publicState(room);
  io.to(`room:${room.code}`).emit('state', pub);
  const hs = R.hostState(room);
  for (const sid of room.hostSockets) io.to(sid).emit('state', hs);
}

io.on('connection', (socket) => {
  let joined = { code: null, playerId: null, isHost: false };

  socket.on('host:create', ({ gameId }, cb) => {
    const room = R.createRoom(gameId, socket.id);
    if (!room) return cb?.({ error: 'Game not found' });
    joined = { code: room.code, playerId: null, isHost: true };
    socket.join(`room:${room.code}`);
    cb?.({ code: room.code, hostKey: room.hostKey });
    sync(room);
  });

  // Used both to reclaim after a refresh and to join as a phone remote.
  // Requires the room's host key so players can't grab host powers.
  socket.on('host:reclaim', ({ code, key }, cb) => {
    const room = R.getRoom(code);
    if (!room || room.phase === 'over') return cb?.({ error: 'Room not found' });
    if (key !== room.hostKey) return cb?.({ error: 'Invalid host key' });
    room.hostSockets.add(socket.id);
    joined = { code: room.code, playerId: null, isHost: true };
    socket.join(`room:${room.code}`);
    cb?.({ ok: true, hostKey: room.hostKey });
    sync(room);
  });

  socket.on('player:join', ({ code, name, playerId }, cb) => {
    const room = R.getRoom(code);
    if (!room) return cb?.({ error: 'Room not found. Check the code.' });
    if (room.phase === 'over' && !room.players.has(playerId)) {
      return cb?.({ error: 'That game has already finished.' });
    }
    const player = R.addPlayer(room, { name, playerId });
    if (!player) return cb?.({ error: 'Room is full.' });
    player.socketId = socket.id;
    joined = { code: room.code, playerId: player.id, isHost: false };
    socket.join(`room:${room.code}`);
    cb?.({ ok: true, playerId: player.id, name: player.name, color: player.color, code: room.code });
    sync(room);
  });

  const withRoom = (fn, hostOnly = true) => (payload, cb) => {
    const room = R.getRoom(joined.code);
    if (!room) return cb?.({ error: 'No room' });
    if (hostOnly && !room.hostSockets.has(socket.id)) return cb?.({ error: 'Not host' });
    fn(room, payload || {}, cb);
    sync(room);
    cb?.({ ok: true });
  };

  // Host controls
  socket.on('host:start', withRoom((room) => { room.phase = 'board'; }));
  socket.on('host:selectClue', withRoom((room, { c, i }) => R.selectClue(room, c, i)));
  socket.on('host:arm', withRoom((room) => R.armBuzzers(room)));
  socket.on('host:judge', withRoom((room, { correct }) => {
    const result = R.judge(room, !!correct);
    if (result) io.to(`room:${room.code}`).emit('judged', result);
  }));
  socket.on('host:reveal', withRoom((room) => R.revealClue(room)));
  socket.on('host:closeClue', withRoom((room) => R.finishClue(room)));
  socket.on('host:nextRound', withRoom((room) => R.nextRound(room)));
  socket.on('host:startFinal', withRoom((room) => R.startFinal(room)));
  socket.on('host:showFinalClue', withRoom((room) => R.showFinalClue(room)));
  socket.on('host:startFinalReveal', withRoom((room) => R.startFinalReveal(room)));
  socket.on('host:judgeFinal', withRoom((room, { playerId, correct }) => R.judgeFinal(room, playerId, !!correct)));
  socket.on('host:finalNext', withRoom((room) => {
    room.final.showAnswer = false;
    if (room.final.revealIndex + 1 < (room.final.order?.length || 0)) room.final.revealIndex += 1;
    else R.endGame(room);
  }));
  socket.on('host:showFinalAnswer', withRoom((room) => { room.final.showAnswer = true; }));
  socket.on('host:adjustScore', withRoom((room, { playerId, delta }) => {
    const p = room.players.get(playerId);
    if (p) p.score += Math.round(delta) || 0;
  }));
  socket.on('host:setControl', withRoom((room, { playerId }) => {
    if (room.players.has(playerId)) room.controlPlayerId = playerId;
  }));
  socket.on('host:kick', withRoom((room, { playerId }) => {
    const p = room.players.get(playerId);
    if (p?.socketId) io.to(p.socketId).emit('kicked');
    room.players.delete(playerId);
  }));
  socket.on('host:end', withRoom((room) => R.endGame(room)));
  socket.on('host:restart', withRoom((room) => R.restartRoom(room)));

  // Player actions
  socket.on('player:buzz', (payload, cb) => {
    const room = R.getRoom(joined.code);
    if (!room || !joined.playerId) return;
    const result = R.buzz(room, joined.playerId);
    cb?.(result);
    if (result.ok || result.early) sync(room);
  });
  socket.on('player:wager', ({ amount }, cb) => {
    const room = R.getRoom(joined.code);
    if (!room || !joined.playerId) return;
    let ok;
    if (room.phase === 'final_wager') ok = R.finalWager(room, joined.playerId, amount);
    else ok = R.setWager(room, joined.playerId, amount);
    cb?.({ ok });
    sync(room);
  });
  socket.on('player:finalAnswer', ({ text }, cb) => {
    const room = R.getRoom(joined.code);
    if (!room || !joined.playerId) return;
    cb?.({ ok: R.finalAnswer(room, joined.playerId, text) });
    sync(room);
  });

  socket.on('disconnect', () => {
    const room = R.getRoom(joined.code);
    if (!room) return;
    if (joined.playerId) {
      R.handleDisconnect(room, joined.playerId);
      sync(room);
    }
    // Host disconnect: keep room alive 10 min for reclaim (only when the
    // LAST host device drops — a remote leaving doesn't close anything).
    if (joined.isHost) {
      room.hostSockets.delete(socket.id);
      if (room.hostSockets.size === 0) {
        setTimeout(() => {
          const r = R.getRoom(joined.code);
          if (r && r.hostSockets.size === 0) R.closeRoom(joined.code);
        }, 10 * 60 * 1000);
      }
    }
  });
});

setInterval(() => R.sweepRooms(), 10 * 60 * 1000);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`John G.K. server on http://localhost:${PORT}`));
