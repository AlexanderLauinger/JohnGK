import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getSocket } from '../socket.js';

// Phone-sized host remote: full control of the game plus host-only info
// (answers, buzz order). Authorized via the host key in the URL hash.
export default function Remote() {
  const { code } = useParams();
  const key = window.location.hash.slice(1);
  const [state, setState] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const socket = getSocket();
    const onState = (s) => setState(s);
    socket.on('state', onState);
    const join = () => socket.emit('host:reclaim', { code, key }, (res) => {
      if (res?.error) setError(res.error);
    });
    join();
    socket.on('connect', join);
    return () => { socket.off('state', onState); socket.off('connect', join); };
  }, [code, key]);

  const emit = (event, payload) => getSocket().emit(event, payload || {});

  if (error) {
    return (
      <div className="play-shell"><div className="play-main">
        <div className="card center">{error}</div>
      </div></div>
    );
  }
  if (!state) return <div className="play-shell"><div className="play-main muted">Connecting…</div></div>;

  return (
    <div className="play-shell" style={{ gap: 10 }}>
      <div className="row spread">
        <span className="badge badge-gold">Host remote</span>
        <span className="muted" style={{ fontSize: 13 }}>Room {state.code}</span>
      </div>

      {state.phase === 'lobby' && (
        <div className="play-main">
          <p className="muted">{state.players.length} player{state.players.length === 1 ? '' : 's'} joined</p>
          <RemoteScores state={state} emit={emit} />
          <button className="btn btn-gold btn-lg" disabled={state.players.length === 0}
            onClick={() => emit('host:start')}>Start Game ▸</button>
        </div>
      )}

      {state.phase === 'board' && <RemoteBoard state={state} emit={emit} />}
      {state.phase === 'clue' && <RemoteClue state={state} emit={emit} />}
      {state.phase.startsWith('final') && <RemoteFinal state={state} emit={emit} />}

      {state.phase === 'over' && (
        <div className="play-main">
          <h2>Game over</h2>
          <RemoteScores state={state} emit={emit} />
          <button className="btn btn-gold" onClick={() => emit('host:restart')}>Play again ▸</button>
        </div>
      )}
    </div>
  );
}

function RemoteScores({ state, emit }) {
  return (
    <div className="stack" style={{ width: '100%', gap: 6 }}>
      {state.players.map(p => (
        <div key={p.id} className="row spread" style={{
          padding: '7px 12px', borderRadius: 6, border: '1px solid var(--border)',
          borderLeft: `3px solid ${p.color}`, opacity: p.connected ? 1 : .45
        }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            {p.name}
            {state.controlPlayerId === p.id && <span className="gold"> ●</span>}
          </span>
          <span className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm btn-ghost" onClick={() => emit('host:adjustScore', { playerId: p.id, delta: -100 })}>−</button>
            <strong style={{ minWidth: 60, textAlign: 'right', color: p.score < 0 ? 'var(--red)' : 'var(--text)' }}>
              ${p.score.toLocaleString()}
            </strong>
            <button className="btn btn-sm btn-ghost" onClick={() => emit('host:adjustScore', { playerId: p.id, delta: 100 })}>+</button>
          </span>
        </div>
      ))}
    </div>
  );
}

function RemoteBoard({ state, emit }) {
  const board = state.board;
  const useFinal = state.settings.useFinal !== false;
  const lastRound = board.roundIndex + 1 >= board.totalRounds;
  return (
    <div className="stack" style={{ flex: 1, gap: 14 }}>
      <div className="row spread">
        <span className="badge">{board.roundName}</span>
        {state.boardDone && (
          lastRound
            ? (useFinal
              ? <button className="btn btn-gold btn-sm" onClick={() => emit('host:startFinal')}>Final Wager ▸</button>
              : <button className="btn btn-gold btn-sm" onClick={() => emit('host:end')}>Finish game ▸</button>)
            : <button className="btn btn-gold btn-sm" onClick={() => emit('host:nextRound')}>Next round ▸</button>
        )}
      </div>
      <div className="board" style={{ '--cols': board.categories.length, gap: 3 }}>
        {board.categories.map((cat, c) => (
          <div key={`c${c}`} className="cat" style={{ minHeight: 40, fontSize: 9, padding: '4px 2px' }}>
            {cat.name || `Cat ${c + 1}`}
          </div>
        ))}
        {Array.from({ length: 5 }, (_, i) =>
          board.categories.map((cat, c) => {
            const cell = cat.clues[i];
            const dead = cell.used || cell.empty;
            return dead
              ? <div key={`${c}-${i}`} className="tile used" style={{ minHeight: 40 }} />
              : (
                <button key={`${c}-${i}`} className="tile" style={{ minHeight: 40, fontSize: 13 }}
                  onClick={() => emit('host:selectClue', { c, i })}>
                  {cell.value}
                </button>
              );
          })
        )}
      </div>
      <RemoteScores state={state} emit={emit} />
    </div>
  );
}

function RemoteClue({ state, emit }) {
  const clue = state.clue;
  if (!clue) return null;
  const buzzed = state.players.find(p => p.id === clue.activeBuzzer);
  const control = state.players.find(p => p.id === state.controlPlayerId);
  const mode = state.settings.buzzMode || 'typewriter';

  return (
    <div className="stack" style={{ flex: 1, gap: 12 }}>
      <div className="card stack" style={{ gap: 8, padding: 16 }}>
        <div className="row spread">
          <span className="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>{clue.category}</span>
          <strong className="gold">
            {clue.dailyDouble ? `DD $${(clue.wager ?? 0).toLocaleString()}` : `$${clue.value}`}
          </strong>
        </div>
        <p style={{ fontSize: 15, fontWeight: 600 }}>{clue.question || '…'}</p>
        <p style={{ fontSize: 14 }}>
          <span className="muted">Answer: </span>
          <strong className="gold">{clue.answer || '(not set)'}</strong>
        </p>
      </div>

      <div className="stack center" style={{ gap: 10, alignItems: 'center' }}>
        {clue.state === 'dd_wager' && (
          <p className="muted">Waiting for {control?.name || 'player'} to wager…</p>
        )}
        {clue.state === 'reading' && clue.dailyDouble && (
          <JudgeButtons emit={emit} who={control?.name} />
        )}
        {clue.state === 'reading' && !clue.dailyDouble && (
          <button className="btn btn-green btn-lg" onClick={() => emit('host:arm')}>
            {mode === 'manual' ? 'Open buzzers' : 'Open buzzers now'}
          </button>
        )}
        {clue.state === 'armed' && (
          <>
            <span className="badge badge-gold">Buzzers open</span>
            <button className="btn btn-ghost" onClick={() => emit('host:reveal')}>No takers — reveal</button>
          </>
        )}
        {clue.state === 'answering' && buzzed && (
          <JudgeButtons emit={emit} who={buzzed.name} color={buzzed.color} />
        )}
        {clue.state === 'revealed' && (
          <button className="btn btn-gold btn-lg" onClick={() => emit('host:closeClue')}>Back to board ▸</button>
        )}
        {clue.state !== 'revealed' && (
          <button className="btn btn-ghost btn-sm" onClick={() => emit('host:reveal')}>Reveal answer to room</button>
        )}
      </div>
    </div>
  );
}

function JudgeButtons({ emit, who, color }) {
  return (
    <>
      {who && <p style={{ fontWeight: 700, color: color || 'var(--text)' }}>{who} is answering</p>}
      <div className="row" style={{ width: '100%' }}>
        <button className="btn btn-green btn-lg" style={{ flex: 1 }}
          onClick={() => emit('host:judge', { correct: true })}>✓ Correct</button>
        <button className="btn btn-red btn-lg" style={{ flex: 1 }}
          onClick={() => emit('host:judge', { correct: false })}>✗ Wrong</button>
      </div>
    </>
  );
}

function RemoteFinal({ state, emit }) {
  const f = state.final;
  if (!f) return null;

  return (
    <div className="stack" style={{ flex: 1, gap: 12 }}>
      <div className="card stack" style={{ gap: 8, padding: 16 }}>
        <span className="badge">Final Wager — {f.category}</span>
        {f.question && <p style={{ fontSize: 15, fontWeight: 600 }}>{f.question}</p>}
        <p style={{ fontSize: 14 }}>
          <span className="muted">Answer: </span>
          <strong className="gold">{f.correctAnswer || '(not set)'}</strong>
        </p>
      </div>

      {state.phase === 'final_wager' && (
        <div className="stack center" style={{ alignItems: 'center' }}>
          <p className="muted">{f.wagered.length} wager{f.wagered.length === 1 ? '' : 's'} in</p>
          <button className="btn btn-gold btn-lg" onClick={() => emit('host:showFinalClue')}>Reveal clue ▸</button>
        </div>
      )}

      {state.phase === 'final_clue' && (
        <div className="stack center" style={{ alignItems: 'center' }}>
          <p className="muted">{f.answered.length}/{f.wagered.length} answered</p>
          <button className="btn btn-gold btn-lg" onClick={() => emit('host:startFinalReveal')}>Time! Reveal answers ▸</button>
        </div>
      )}

      {state.phase === 'final_reveal' && <RemoteFinalReveal state={state} emit={emit} />}
    </div>
  );
}

function RemoteFinalReveal({ state, emit }) {
  const f = state.final;
  const current = f.order?.[f.revealIndex];
  const p = state.players.find(x => x.id === current);
  const judged = current in (f.judged || {});
  if (!p) return <button className="btn btn-gold" onClick={() => emit('host:finalNext')}>Continue ▸</button>;

  return (
    <div className="stack center" style={{ alignItems: 'center', gap: 12 }}>
      <p className="muted">Player {f.revealIndex + 1} of {f.order.length}</p>
      <strong style={{ color: p.color, fontSize: 18 }}>{p.name}</strong>
      <p style={{ fontSize: 16 }}>“{f.answers?.[current] ?? '(no answer)'}”</p>
      <p className="muted" style={{ fontSize: 13 }}>Wagered ${(f.wagers?.[current] ?? 0).toLocaleString()}</p>
      {!judged ? (
        <div className="row" style={{ width: '100%' }}>
          <button className="btn btn-green btn-lg" style={{ flex: 1 }}
            onClick={() => emit('host:judgeFinal', { playerId: current, correct: true })}>✓ Correct</button>
          <button className="btn btn-red btn-lg" style={{ flex: 1 }}
            onClick={() => emit('host:judgeFinal', { playerId: current, correct: false })}>✗ Wrong</button>
        </div>
      ) : (
        <button className="btn btn-gold btn-lg" onClick={() => emit('host:finalNext')}>
          {f.revealIndex + 1 < f.order.length ? 'Next player ▸' : 'Final results ▸'}
        </button>
      )}
    </div>
  );
}
