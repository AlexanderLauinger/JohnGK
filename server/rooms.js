import { getGame } from './db.js';

const rooms = new Map(); // code -> room
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EARLY_BUZZ_PENALTY_MS = 300;

const COLORS = ['#4f9cff', '#ff5d73', '#38d39f', '#ffb830', '#b06cf5', '#ff8552', '#2fd4d4', '#f562b8'];

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

const DEFAULT_SETTINGS = { answerSeconds: 7, finalSeconds: 45, useDoubleJeopardy: true, useFinal: true, buzzMode: 'typewriter' };

export function roomSettings(room) {
  return { ...DEFAULT_SETTINGS, ...(room.game.settings || {}) };
}

export function effectiveRounds(room) {
  return roomSettings(room).useDoubleJeopardy === false ? 1 : room.game.rounds.length;
}

export function createRoom(gameId, hostSocketId) {
  const game = getGame(gameId);
  if (!game) return null;
  const code = makeCode();
  const room = {
    code,
    gameId,
    game,
    hostKey: Math.random().toString(36).slice(2, 12),
    hostSockets: new Set([hostSocketId]),
    createdAt: Date.now(),
    endedAt: null,
    players: new Map(), // playerId -> {id, name, color, score, connected, socketId, earlyUntil}
    phase: 'lobby',
    round: 0,
    used: [new Set(), new Set()], // "c-i" keys per round
    controlPlayerId: null,
    clue: null,
    final: { wagers: {}, answers: {}, judged: {}, revealIndex: -1, showAnswer: false }
  };
  rooms.set(code, room);
  return room;
}

export function getRoom(code) {
  return rooms.get((code || '').toUpperCase());
}

export function closeRoom(code) {
  rooms.delete(code);
}

export function addPlayer(room, { name, playerId }) {
  // Reconnect path
  if (playerId && room.players.has(playerId)) {
    const p = room.players.get(playerId);
    p.connected = true;
    if (name) p.name = name;
    return p;
  }
  if (room.players.size >= 12) return null;
  const id = playerId || Math.random().toString(36).slice(2, 10);
  const player = {
    id,
    name: (name || 'Player').slice(0, 20),
    color: COLORS[room.players.size % COLORS.length],
    score: 0,
    connected: true,
    socketId: null,
    earlyUntil: 0
  };
  room.players.set(id, player);
  return player;
}

// ---- Clue lifecycle ----

export function selectClue(room, c, i) {
  const round = room.game.rounds[room.round];
  const cat = round.categories[c];
  if (!cat) return false;
  const clue = cat.clues[i];
  if (!clue || room.used[room.round].has(`${c}-${i}`)) return false;
  room.phase = 'clue';
  room.clue = {
    c, i,
    category: cat.name,
    value: clue.value,
    question: clue.question,
    answer: clue.answer,
    media: clue.media || null,
    timeLimit: clue.timeLimit || null,
    dailyDouble: !!clue.dailyDouble,
    state: clue.dailyDouble ? 'dd_wager' : 'reading',
    wager: null,
    activeBuzzer: null,
    buzzes: [],
    lockedOut: new Set(),
    armedAt: 0
  };
  // Daily double defaults control to someone if unset
  if (clue.dailyDouble && !room.controlPlayerId) {
    const first = [...room.players.values()].find(p => p.connected);
    room.controlPlayerId = first ? first.id : null;
  }
  return true;
}

export function setWager(room, playerId, amount) {
  const clue = room.clue;
  if (!clue || clue.state !== 'dd_wager' || playerId !== room.controlPlayerId) return false;
  const p = room.players.get(playerId);
  if (!p) return false;
  const roundMax = 1000 * room.game.rounds[room.round].multiplier;
  const max = Math.max(p.score, roundMax);
  clue.wager = Math.min(Math.max(Math.round(amount) || 5, 5), max);
  clue.state = 'reading'; // host reads, then judges directly (only control player answers)
  clue.activeBuzzer = playerId;
  return true;
}

export function armBuzzers(room) {
  const clue = room.clue;
  if (!clue || clue.dailyDouble || (clue.state !== 'reading' && clue.state !== 'answering')) return false;
  clue.state = 'armed';
  clue.activeBuzzer = null;
  clue.armedAt = Date.now();
  return true;
}

export function buzz(room, playerId) {
  const clue = room.clue;
  const p = room.players.get(playerId);
  if (!clue || !p || clue.dailyDouble) return { ok: false };
  const now = Date.now();
  if (clue.state === 'reading') {
    // Early buzz: penalty lockout
    p.earlyUntil = now + EARLY_BUZZ_PENALTY_MS + 400; // penalty applies past arming
    return { ok: false, early: true };
  }
  if (clue.state !== 'armed') return { ok: false };
  if (clue.lockedOut.has(playerId)) return { ok: false, locked: true };
  if (now < p.earlyUntil) return { ok: false, early: true };
  clue.buzzes.push({ playerId, at: now, delta: now - clue.armedAt });
  clue.activeBuzzer = playerId;
  clue.state = 'answering';
  return { ok: true, delta: now - clue.armedAt };
}

export function judge(room, correct) {
  const clue = room.clue;
  if (!clue) return null;
  const playerId = clue.activeBuzzer;
  const p = playerId ? room.players.get(playerId) : null;
  const amount = clue.dailyDouble ? (clue.wager ?? clue.value) : clue.value;
  if (p) {
    p.score += correct ? amount : -amount;
  }
  if (correct) {
    if (p) room.controlPlayerId = p.id;
    finishClue(room);
    return { done: true, correct: true, playerId };
  }
  // wrong answer
  if (clue.dailyDouble) {
    clue.state = 'revealed';
    return { done: false, correct: false, playerId, revealed: true };
  }
  clue.lockedOut.add(playerId);
  clue.activeBuzzer = null;
  const eligible = [...room.players.values()].filter(x => x.connected && !clue.lockedOut.has(x.id));
  if (eligible.length === 0) {
    clue.state = 'revealed';
    return { done: false, correct: false, playerId, revealed: true };
  }
  clue.state = 'armed';
  clue.armedAt = Date.now();
  return { done: false, correct: false, playerId };
}

export function revealClue(room) {
  if (room.clue) room.clue.state = 'revealed';
}

export function finishClue(room) {
  if (!room.clue) return;
  room.used[room.round].add(`${room.clue.c}-${room.clue.i}`);
  room.clue = null;
  const round = room.game.rounds[room.round];
  const total = round.categories.reduce((n, cat) => n + cat.clues.filter(cl => cl.question || cl.answer).length, 0)
    || round.categories.length * 5;
  room.phase = 'board';
  if (room.used[room.round].size >= total) {
    // round exhausted — host still advances manually via nextRound/startFinal
    room.boardDone = true;
  }
}

export function nextRound(room) {
  if (room.round + 1 < effectiveRounds(room)) {
    room.round += 1;
    room.boardDone = false;
    room.phase = 'board';
    room.clue = null;
    return true;
  }
  return false;
}

// ---- Final Jeopardy ----

export function startFinal(room) {
  room.phase = 'final_wager';
  room.clue = null;
  room.final = { wagers: {}, answers: {}, judged: {}, revealIndex: -1, showAnswer: false };
}

export function finalWager(room, playerId, amount) {
  if (room.phase !== 'final_wager') return false;
  const p = room.players.get(playerId);
  if (!p || p.score <= 0) return false;
  room.final.wagers[playerId] = Math.min(Math.max(Math.round(amount) || 0, 0), p.score);
  return true;
}

export function showFinalClue(room) {
  room.phase = 'final_clue';
}

export function finalAnswer(room, playerId, text) {
  if (room.phase !== 'final_clue') return false;
  if (!(playerId in room.final.wagers)) return false;
  room.final.answers[playerId] = String(text || '').slice(0, 200);
  return true;
}

export function startFinalReveal(room) {
  room.phase = 'final_reveal';
  room.final.revealIndex = 0;
  room.final.order = Object.keys(room.final.wagers)
    .sort((a, b) => (room.players.get(a)?.score ?? 0) - (room.players.get(b)?.score ?? 0));
}

export function judgeFinal(room, playerId, correct) {
  const p = room.players.get(playerId);
  if (!p || !(playerId in room.final.wagers) || playerId in room.final.judged) return false;
  const w = room.final.wagers[playerId];
  p.score += correct ? w : -w;
  room.final.judged[playerId] = correct;
  return true;
}

export function endGame(room) {
  room.phase = 'over';
  room.endedAt = Date.now();
}

export function restartRoom(room) {
  room.phase = 'lobby';
  room.round = 0;
  room.used = room.game.rounds.map(() => new Set());
  room.controlPlayerId = null;
  room.clue = null;
  room.boardDone = false;
  room.endedAt = null;
  room.final = { wagers: {}, answers: {}, judged: {}, revealIndex: -1, showAnswer: false };
  for (const p of room.players.values()) p.score = 0;
}

// Auto-recover when a player disconnects mid-clue so the game never stalls.
export function handleDisconnect(room, playerId) {
  const p = room.players.get(playerId);
  if (p) p.connected = false;
  const clue = room.clue;
  if (!clue) return;
  if (!clue.dailyDouble && clue.state === 'answering' && clue.activeBuzzer === playerId) {
    // Treat like a pass: no score change, lock them out, reopen buzzers
    clue.lockedOut.add(playerId);
    clue.activeBuzzer = null;
    const eligible = [...room.players.values()].filter(x => x.connected && !clue.lockedOut.has(x.id));
    if (eligible.length > 0) {
      clue.state = 'armed';
      clue.armedAt = Date.now();
    } else {
      clue.state = 'revealed';
    }
  }
  if (clue.dailyDouble && (clue.state === 'dd_wager' || clue.state === 'reading') && room.controlPlayerId === playerId) {
    // Daily Double owner vanished: reveal so the host can move on (no score change)
    clue.state = 'revealed';
  }
}

// Purge finished/abandoned rooms so stale codes can't be rejoined.
export function sweepRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const endedStale = room.endedAt && now - room.endedAt > 30 * 60 * 1000;
    const ancient = now - room.createdAt > 12 * 60 * 60 * 1000;
    if (endedStale || ancient) rooms.delete(code);
  }
}

// ---- Serialization ----

function playersList(room) {
  return [...room.players.values()].map(p => ({
    id: p.id, name: p.name, color: p.color, score: p.score, connected: p.connected
  }));
}

function boardView(room) {
  const round = room.game.rounds[room.round];
  return {
    roundName: round.name,
    roundIndex: room.round,
    totalRounds: effectiveRounds(room),
    categories: round.categories.map((cat, c) => ({
      name: cat.name,
      clues: cat.clues.map((cl, i) => ({
        value: cl.value,
        used: room.used[room.round].has(`${c}-${i}`),
        empty: !cl.question && !cl.answer
      }))
    }))
  };
}

export function publicState(room) {
  const clue = room.clue;
  return {
    code: room.code,
    phase: room.phase,
    players: playersList(room),
    controlPlayerId: room.controlPlayerId,
    board: room.phase === 'lobby' ? null : boardView(room),
    boardDone: !!room.boardDone,
    settings: roomSettings(room),
    title: room.game.title,
    clue: clue ? {
      category: clue.category,
      value: clue.value,
      question: clue.state === 'dd_wager' ? null : clue.question,
      media: clue.state === 'dd_wager' ? null : clue.media,
      timeLimit: clue.timeLimit,
      dailyDouble: clue.dailyDouble,
      state: clue.state,
      wager: clue.wager,
      activeBuzzer: clue.activeBuzzer,
      lockedOut: [...clue.lockedOut],
      answer: clue.state === 'revealed' ? clue.answer : null
    } : null,
    final: (room.phase.startsWith('final') || room.phase === 'over') ? {
      category: room.game.final?.category || 'Final Wager',
      question: (room.phase === 'final_clue' || room.phase === 'final_reveal' || room.phase === 'over') ? room.game.final?.question : null,
      media: (room.phase === 'final_clue' || room.phase === 'final_reveal') ? room.game.final?.media : null,
      wagered: Object.keys(room.final.wagers),
      answered: Object.keys(room.final.answers),
      judged: room.final.judged,
      order: room.final.order || [],
      revealIndex: room.final.revealIndex,
      showAnswer: !!room.final.showAnswer,
      // wagers/answers only exposed during reveal, one at a time
      reveal: room.phase === 'final_reveal' && room.final.order ? room.final.order.map((pid, idx) => (
        idx <= room.final.revealIndex ? {
          playerId: pid,
          answer: room.final.answers[pid] ?? '(no answer)',
          wager: pid in room.final.judged ? room.final.wagers[pid] : null,
          correct: room.final.judged[pid] ?? null
        } : { playerId: pid }
      )) : null,
      correctAnswer: (room.phase === 'over' || (room.phase === 'final_reveal' && room.final.showAnswer)) ? room.game.final?.answer : null
    } : null
  };
}

export function hostState(room) {
  const s = publicState(room);
  if (room.clue) {
    s.clue.answer = room.clue.answer;
    s.clue.question = room.clue.question;
    s.clue.media = room.clue.media;
    s.clue.buzzes = room.clue.buzzes;
  }
  if (s.final) {
    s.final.correctAnswer = room.game.final?.answer;
    s.final.wagers = room.final.wagers;
    s.final.answers = room.final.answers;
  }
  return s;
}
