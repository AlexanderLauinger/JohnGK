import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { getSocket } from '../socket.js';
import { api } from '../api.js';
import { sfx } from '../sounds.js';
import { unlockTTS, speakClue } from '../tts.js';

// Only render media over http(s) — blocks javascript:/data: URLs a game
// author could otherwise smuggle into a shared screen.
function safeMedia(media) {
  if (!media?.url || !/^https?:\/\//i.test(media.url)) return null;
  return media;
}

// Tolerates values saved by older versions (plain room-code strings) and
// any other junk in storage — never throws.
function safeParse(raw) {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

export default function Host() {
  const { gameId } = useParams();
  const nav = useNavigate();
  const [state, setState] = useState(null);
  const [code, setCode] = useState(null);
  const [hostKey, setHostKey] = useState(null);
  const [lanIp, setLanIp] = useState(null);
  const [error, setError] = useState('');
  const prevRef = useRef(null);

  useEffect(() => {
    const socket = getSocket();
    const onState = (s) => setState(s);
    socket.on('state', onState);

    const saved = safeParse(sessionStorage.getItem(`host:${gameId}`));
    const create = () => socket.emit('host:create', { gameId }, (res) => {
      if (res.error) return setError(res.error);
      setCode(res.code);
      setHostKey(res.hostKey);
      sessionStorage.setItem(`host:${gameId}`, JSON.stringify({ code: res.code, key: res.hostKey }));
    });
    if (saved?.code) {
      socket.emit('host:reclaim', { code: saved.code, key: saved.key }, (res) => {
        if (res?.ok) { setCode(saved.code); setHostKey(saved.key); } else create();
      });
    } else create();

    const onReconnect = () => {
      const s = safeParse(sessionStorage.getItem(`host:${gameId}`));
      if (s?.code) socket.emit('host:reclaim', { code: s.code, key: s.key }, () => {});
    };
    socket.on('connect', onReconnect);
    api.lanIp().then(setLanIp).catch(() => {});
    return () => { socket.off('state', onState); socket.off('connect', onReconnect); };
  }, [gameId]);

  // Sound triggers on state transitions
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;
    if (!prev || !state) return;
    const ps = prev.clue?.state, cs = state.clue?.state;
    if (!prev.clue && state.clue) state.clue.dailyDouble ? sfx.dailyDouble() : sfx.select();
    if (ps !== 'armed' && cs === 'armed') sfx.armed();
    if (ps !== 'answering' && cs === 'answering') sfx.buzz();
    if (prev.phase !== 'final_clue' && state.phase === 'final_clue') sfx.final();
  }, [state]);

  useEffect(() => {
    const socket = getSocket();
    const onJudged = (r) => (r.correct ? sfx.correct() : sfx.wrong());
    socket.on('judged', onJudged);
    return () => socket.off('judged', onJudged);
  }, []);

  // Safari blocks speech synthesis until it's triggered from a user gesture,
  // so unlock it on the host's first click/tap (e.g. "Start Game" or a tile).
  useEffect(() => {
    const unlock = () => { unlockTTS(); window.removeEventListener('pointerdown', unlock); };
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  const emit = (event, payload) => getSocket().emit(event, payload || {});

  if (error) return <div className="page center"><div className="card">{error} <button className="btn mt" onClick={() => nav('/')}>Home</button></div></div>;
  if (!state) return <div className="page center muted">Setting up room…</div>;

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      {state.phase === 'lobby' && <Lobby state={state} code={code} hostKey={hostKey} lanIp={lanIp} emit={emit} />}
      {(state.phase === 'board' || state.phase === 'clue') && (
        <BoardPhase state={state} emit={emit} code={code} />
      )}
      {state.phase.startsWith('final') && <FinalPhase state={state} emit={emit} />}
      {state.phase === 'over' && <GameOver state={state} nav={nav} emit={emit} gameId={gameId} />}
    </div>
  );
}

function Lobby({ state, code, hostKey, lanIp, emit }) {
  const [showRemote, setShowRemote] = useState(false);
  // Only swap in the LAN IP when hosting from localhost (dev on your own
  // machine). When deployed, the public origin is what phones can reach.
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const base = useMemo(() => (
    isLocalhost && lanIp?.ip
      ? `http://${lanIp.ip}:${window.location.port || lanIp.port}`
      : window.location.origin
  ), [lanIp, isLocalhost]);
  const joinUrl = `${base}/play/${code}`;
  const remoteUrl = `${base}/remote/${code}#${hostKey}`;

  return (
    <div className="center stack" style={{ alignItems: 'center', gap: 24 }}>
      <h1 className="brand" style={{ fontSize: 44 }}>{state.title}</h1>
      <div className="card row wrap" style={{ gap: 40, justifyContent: 'center' }}>
        <div className="stack center" style={{ alignItems: 'center' }}>
          <span className="muted">Scan to join</span>
          <div style={{ background: '#fff', padding: 14, borderRadius: 12 }}>
            <QRCodeSVG value={joinUrl} size={190} />
          </div>
          <span className="muted" style={{ fontSize: 12 }}>{joinUrl}</span>
        </div>
        <div className="stack center" style={{ alignItems: 'center', justifyContent: 'center' }}>
          <span className="muted">Room code</span>
          <div className="display" style={{ fontSize: 88, fontWeight: 900, letterSpacing: 14, color: 'var(--gold)' }}>
            {code}
          </div>
          <span className="muted">Players open the site on their phone → Join</span>
        </div>
      </div>

      <div className="scores">
        {state.players.length === 0 && <span className="muted">Waiting for players…</span>}
        {state.players.map(p => (
          <div key={p.id} className={`score-chip ${p.connected ? '' : 'dc'}`} style={{ '--chip': p.color }}>
            <div className="name">{p.name}</div>
            <div className="pts">Ready</div>
          </div>
        ))}
      </div>

      <button className="btn btn-gold btn-lg" disabled={state.players.length === 0} onClick={() => emit('host:start')}>
        Start Game ▸
      </button>

      <div className="stack center" style={{ alignItems: 'center', gap: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowRemote(v => !v)}>
          {showRemote ? 'Hide host remote' : 'Control from your phone…'}
        </button>
        {showRemote && (
          <div className="card stack center" style={{ alignItems: 'center', padding: 16 }}>
            <p className="muted" style={{ fontSize: 13, maxWidth: 280 }}>
              Scan with <strong>your</strong> phone — this link shows answers and
              game controls. Hide it before sharing your screen.
            </p>
            <div style={{ background: '#fff', padding: 10, borderRadius: 6 }}>
              <QRCodeSVG value={remoteUrl} size={130} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Scoreboard({ state, emit, editable }) {
  return (
    <div className="scores">
      {state.players.map(p => (
        <div key={p.id}
          className={`score-chip ${p.connected ? '' : 'dc'} ${state.controlPlayerId === p.id ? 'control' : ''} ${state.clue?.activeBuzzer === p.id ? 'buzzed' : ''}`}
          style={{ '--chip': p.color }}>
          <div className="name">{p.name}</div>
          <div className={`pts ${p.score < 0 ? 'neg' : ''}`}>${p.score.toLocaleString()}</div>
          {editable && (
            <div className="row" style={{ justifyContent: 'center', gap: 4, marginTop: 4 }}>
              <button className="btn btn-sm btn-ghost" onClick={() => emit('host:adjustScore', { playerId: p.id, delta: -100 })}>−</button>
              <button className="btn btn-sm btn-ghost" onClick={() => emit('host:adjustScore', { playerId: p.id, delta: 100 })}>+</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function BoardPhase({ state, emit, code }) {
  const board = state.board;
  const useFinal = state.settings.useFinal !== false;
  const lastRound = board.roundIndex + 1 >= board.totalRounds;
  const finishBtn = useFinal
    ? { label: 'Final Wager ▸', action: () => emit('host:startFinal') }
    : { label: 'Finish game ▸', action: () => emit('host:end') };
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row spread wrap">
        <div className="row">
          <span className="badge">{board.roundName}</span>
          <span className="muted" style={{ fontSize: 13 }}>Room {code}</span>
        </div>
        <div className="row">
          {state.boardDone && !lastRound && (
            <button className="btn btn-gold" onClick={() => emit('host:nextRound')}>Next round ▸</button>
          )}
          {state.boardDone && lastRound && (
            <button className="btn btn-gold" onClick={finishBtn.action}>{finishBtn.label}</button>
          )}
          {!state.boardDone && (
            <>
              {!lastRound
                ? <button className="btn btn-ghost btn-sm" onClick={() => emit('host:nextRound')}>Skip to next round</button>
                : <button className="btn btn-ghost btn-sm" onClick={finishBtn.action}>{useFinal ? 'Skip to Final Wager' : 'End game'}</button>}
            </>
          )}
        </div>
      </div>

      <div className="board" style={{ '--cols': board.categories.length }}>
        {board.categories.map((cat, c) => (
          <div key={`c${c}`} className="cat">{cat.name || `Category ${c + 1}`}</div>
        ))}
        {Array.from({ length: 5 }, (_, i) =>
          board.categories.map((cat, c) => {
            const cell = cat.clues[i];
            const dead = cell.used || cell.empty;
            return dead
              ? <div key={`${c}-${i}`} className="tile used" />
              : (
                <button key={`${c}-${i}`} className="tile" onClick={() => emit('host:selectClue', { c, i })}>
                  ${cell.value}
                </button>
              );
          })
        )}
      </div>

      <Scoreboard state={state} emit={emit} editable />
      {state.clue && (
        <ClueOverlay
          key={`${board.roundIndex}-${state.clue.category}-${state.clue.value}`}
          state={state} emit={emit}
        />
      )}
    </div>
  );
}

function Timer({ seconds, running, onDone }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (!running) { setLeft(seconds); return; }
    setLeft(seconds);
    const start = Date.now();
    const t = setInterval(() => {
      const rem = seconds - (Date.now() - start) / 1000;
      setLeft(Math.max(0, rem));
      if (rem <= 0) { clearInterval(t); sfx.timeUp(); onDone?.(); }
    }, 100);
    return () => clearInterval(t);
  }, [running, seconds]);
  if (!running) return null;
  return (
    <div className="timer-bar">
      <div className="timer-fill" style={{ width: `${(left / seconds) * 100}%` }} />
    </div>
  );
}

// Drives the buzzer-opening mode while a clue is in the 'reading' state.
// Returns { text, hideText, timedSecs, skip } — arming is emitted automatically.
function useClueReveal(clue, mode, emit) {
  const q = clue.question || '';
  const reading = clue.state === 'reading';
  const dd = clue.dailyDouble;
  const [chars, setChars] = useState(mode === 'typewriter' ? 0 : Number.MAX_SAFE_INTEGER);
  const [ttsDone, setTtsDone] = useState(mode !== 'tts');
  const armedRef = useRef(false);

  const arm = () => {
    if (armedRef.current || dd) return;
    armedRef.current = true;
    emit('host:arm');
  };

  // Typewriter: reveal characters, then open buzzers.
  useEffect(() => {
    if (mode !== 'typewriter' || !reading || !q) return;
    if (chars >= q.length) { arm(); return; }
    const t = setTimeout(() => setChars(c => c + 1), 42);
    return () => clearTimeout(t);
  }, [mode, reading, q, chars]);

  // TTS: read aloud with the clue hidden, then show it and open buzzers.
  useEffect(() => {
    if (mode !== 'tts' || !reading || !q || ttsDone) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setTtsDone(true);
      arm();
    };
    const cancelSpeech = speakClue(q, finish);
    // Safety net: open buzzers even if speech silently fails.
    const fallback = setTimeout(finish, 6000 + q.length * 140);
    return () => { clearTimeout(fallback); cancelSpeech(); };
  }, [mode, reading, q, ttsDone]);

  const skip = () => {
    setChars(Number.MAX_SAFE_INTEGER);
    setTtsDone(true);
    window.speechSynthesis?.cancel();
    arm();
  };

  return {
    text: mode === 'typewriter' && reading ? q.slice(0, chars) : q,
    hideText: mode === 'tts' && reading && !ttsDone,
    timedSecs: mode === 'timed' && !dd ? Math.max(3, Math.round(2 + q.length * 0.05)) : null,
    reading,
    arm,
    skip
  };
}

function ClueOverlay({ state, emit }) {
  const clue = state.clue;
  const media = safeMedia(clue.media);
  const mode = state.settings.buzzMode || 'typewriter';
  const buzzedPlayer = state.players.find(p => p.id === clue.activeBuzzer);
  const answerSecs = clue.timeLimit || state.settings.answerSeconds || 7;
  const reveal = useClueReveal(clue, mode, emit);

  return (
    <div className="clue-overlay">
      <div className="clue-cat">{clue.category || 'Category'}</div>
      {clue.dailyDouble && clue.state === 'dd_wager' ? (
        <>
          <div className="dd-splash">Double Down!</div>
          <p className="mt" style={{ fontSize: 20 }}>
            <strong style={{ color: buzzedPlayer?.color }}>
              {state.players.find(p => p.id === state.controlPlayerId)?.name || 'Player in control'}
            </strong>{' '}
            is entering a wager on their phone…
          </p>
        </>
      ) : (
        <>
          <div className="clue-value">
            {clue.dailyDouble ? <span className="gold">DOUBLE DOWN — wager ${clue.wager?.toLocaleString()}</span> : `$${clue.value}`}
          </div>
          {media?.type === 'image' && <img className="clue-media" src={media.url} alt="" />}
          {media?.type === 'audio' && <audio className="clue-media" src={media.url} controls autoPlay />}
          {media?.type === 'video' && <video className="clue-media" src={media.url} controls autoPlay />}
          {reveal.hideText
            ? <div className="clue-text muted" style={{ opacity: .6 }}>Listen…</div>
            : <div className="clue-text">{reveal.text || '(empty clue)'}</div>}
          {clue.state === 'reading' && !clue.dailyDouble && reveal.timedSecs && (
            <>
              <p className="muted mt" style={{ fontSize: 14 }}>Buzzers open in…</p>
              <Timer seconds={reveal.timedSecs} running onDone={reveal.arm} />
            </>
          )}
          {clue.state === 'revealed' && <div className="clue-answer">✓ {clue.answer || '(no answer set)'}</div>}

          {clue.state === 'answering' && buzzedPlayer && (
            <div className="buzzed-banner" style={{ color: buzzedPlayer.color }}>
              {buzzedPlayer.name}
            </div>
          )}
          <Timer seconds={answerSecs} running={clue.state === 'answering'} />
        </>
      )}

      {/* Host controls */}
      <div className="row wrap mt" style={{ justifyContent: 'center', gap: 10, marginTop: 40 }}>
        {clue.state === 'reading' && !clue.dailyDouble && (
          mode === 'manual' ? (
            <button className="btn btn-green btn-lg" onClick={() => emit('host:arm')}>
              Open buzzers
            </button>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={reveal.skip}>Open buzzers now</button>
          )
        )}
        {clue.state === 'reading' && clue.dailyDouble && (
          <>
            <button className="btn btn-green btn-lg" onClick={() => emit('host:judge', { correct: true })}>✓ Correct</button>
            <button className="btn btn-red btn-lg" onClick={() => emit('host:judge', { correct: false })}>✗ Wrong</button>
          </>
        )}
        {clue.state === 'armed' && (
          <>
            <span className="badge badge-gold">Buzzers open</span>
            <button className="btn btn-ghost" onClick={() => emit('host:reveal')}>No takers — reveal</button>
          </>
        )}
        {clue.state === 'answering' && (
          <>
            <button className="btn btn-green btn-lg" onClick={() => emit('host:judge', { correct: true })}>✓ Correct</button>
            <button className="btn btn-red btn-lg" onClick={() => emit('host:judge', { correct: false })}>✗ Wrong</button>
          </>
        )}
        {clue.state === 'revealed' && (
          <button className="btn btn-gold btn-lg" onClick={() => emit('host:closeClue')}>Back to board ▸</button>
        )}
        {(clue.state === 'reading' || clue.state === 'armed') && (
          <button className="btn btn-ghost btn-sm" onClick={() => emit('host:reveal')}>Reveal answer</button>
        )}
      </div>
      {/* No answer preview here: the host screen is shared with players. */}
    </div>
  );
}

function FinalPhase({ state, emit }) {
  const f = state.final;
  const eligible = state.players.filter(p => p.score > 0);
  return (
    <div className="center stack" style={{ alignItems: 'center', gap: 22 }}>
      <span className="badge">Final Wager</span>
      <h1 className="display" style={{ fontSize: 40, textTransform: 'uppercase' }}>{f.category || 'Final Wager'}</h1>

      {state.phase === 'final_wager' && (
        <>
          <p className="muted">Players with a positive score place wagers on their phones.</p>
          <div className="scores">
            {eligible.map(p => (
              <div key={p.id} className="score-chip" style={{ '--chip': p.color }}>
                <div className="name">{p.name}</div>
                <div className="pts">{f.wagered.includes(p.id) ? '✓ wagered' : '…'}</div>
              </div>
            ))}
            {eligible.length === 0 && <p className="muted">No players are eligible (score must be above $0).</p>}
          </div>
          <button className="btn btn-gold btn-lg" onClick={() => emit('host:showFinalClue')}
            disabled={eligible.length > 0 && f.wagered.length === 0}>
            Reveal clue ▸
          </button>
        </>
      )}

      {state.phase === 'final_clue' && (
        <>
          {f.media?.type === 'image' && <img className="clue-media" src={f.media.url} alt="" />}
          <div className="clue-text" style={{ fontSize: 'clamp(22px,3vw,40px)' }}>{f.question}</div>
          <Timer seconds={state.settings.finalSeconds || 45} running onDone={() => {}} />
          <div className="scores">
            {f.wagered.map(pid => {
              const p = state.players.find(x => x.id === pid);
              return p && (
                <div key={pid} className="score-chip" style={{ '--chip': p.color }}>
                  <div className="name">{p.name}</div>
                  <div className="pts">{f.answered.includes(pid) ? '✓ answered' : 'writing…'}</div>
                </div>
              );
            })}
          </div>
          <button className="btn btn-gold btn-lg" onClick={() => emit('host:startFinalReveal')}>Time! Reveal answers ▸</button>
        </>
      )}

      {state.phase === 'final_reveal' && <FinalReveal state={state} emit={emit} />}
    </div>
  );
}

function FinalReveal({ state, emit }) {
  const f = state.final;
  const current = f.order[f.revealIndex];
  const p = state.players.find(x => x.id === current);
  const entry = f.reveal?.[f.revealIndex];
  const judged = current in (f.judged || {});
  if (!p) return <button className="btn btn-gold" onClick={() => emit('host:finalNext')}>Continue ▸</button>;

  return (
    <div className="card stack center" style={{ minWidth: 'min(560px, 90vw)', alignItems: 'center' }}>
      <div className="muted">Player {f.revealIndex + 1} of {f.order.length}</div>
      <h2 style={{ color: p.color }}>{p.name}</h2>
      <div className="clue-answer" style={{ marginTop: 4 }}>“{entry?.answer ?? '…'}”</div>
      {state.final.correctAnswer && (
        <p className="muted">Correct response: <strong className="gold">{state.final.correctAnswer}</strong></p>
      )}
      {!judged ? (
        <div className="row">
          <button className="btn btn-green btn-lg" onClick={() => { emit('host:judgeFinal', { playerId: current, correct: true }); sfx.correct(); }}>✓ Correct</button>
          <button className="btn btn-red btn-lg" onClick={() => { emit('host:judgeFinal', { playerId: current, correct: false }); sfx.wrong(); }}>✗ Wrong</button>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 22, fontWeight: 800 }}>
            Wager: <span className="gold">${(entry?.wager ?? 0).toLocaleString()}</span>
            {' → '}
            <span style={{ color: f.judged[current] ? 'var(--green)' : 'var(--red)' }}>
              {f.judged[current] ? '+' : '−'}${(entry?.wager ?? 0).toLocaleString()}
            </span>
          </div>
          <div className="pts" style={{ fontFamily: 'Archivo', fontSize: 28, fontWeight: 900, color: 'var(--gold)' }}>
            New total: ${p.score.toLocaleString()}
          </div>
          <button className="btn btn-gold btn-lg" onClick={() => emit('host:finalNext')}>
            {f.revealIndex + 1 < f.order.length ? 'Next player ▸' : 'Final results ▸'}
          </button>
        </>
      )}
    </div>
  );
}

function GameOver({ state, nav, emit, gameId }) {
  const goHome = () => {
    sessionStorage.removeItem(`host:${gameId}`);
    nav('/');
  };
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const top3 = ranked.slice(0, 3);
  const heights = [180, 130, 95];
  const order = top3.length === 3 ? [top3[1], top3[0], top3[2]] : top3;

  return (
    <div className="center stack" style={{ alignItems: 'center' }}>
      <h1 className="brand" style={{ fontSize: 42 }}>{ranked[0]?.name} wins</h1>
      <div className="podium">
        {order.map((p) => {
          const place = ranked.indexOf(p);
          return (
            <div key={p.id} className="col">
              <strong style={{ color: p.color }}>{p.name}</strong>
              <span className="gold" style={{ fontWeight: 800 }}>${p.score.toLocaleString()}</span>
              <div className="bar" style={{ height: heights[place], '--chip': p.color }}>{place + 1}</div>
            </div>
          );
        })}
      </div>
      <div className="scores mt">
        {ranked.slice(3).map(p => (
          <div key={p.id} className="score-chip" style={{ '--chip': p.color }}>
            <div className="name">{p.name}</div>
            <div className={`pts ${p.score < 0 ? 'neg' : ''}`}>${p.score.toLocaleString()}</div>
          </div>
        ))}
      </div>
      <div className="row mt">
        <button className="btn btn-gold btn-lg" onClick={() => emit('host:restart')}>Play again (same players) ▸</button>
        <button className="btn btn-primary btn-lg" onClick={goHome}>Back to home</button>
      </div>
    </div>
  );
}
