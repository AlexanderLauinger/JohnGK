import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getSocket } from '../socket.js';
import { sfx } from '../sounds.js';
import Logo from '../Logo.jsx';

function safeParse(raw) {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

export default function Play() {
  const { code: urlCode } = useParams();
  const [code, setCode] = useState(urlCode || '');
  const [name, setName] = useState(localStorage.getItem('bb:name') || '');
  const [me, setMe] = useState(null); // {playerId, color, code}
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const shellRef = useRef(null);
  const joinedRef = useRef(false);

  useEffect(() => {
    const socket = getSocket();
    const onState = (s) => setState(s);
    const onKicked = () => { setMe(null); setState(null); setError('You were removed by the host.'); };
    socket.on('state', onState);
    socket.on('kicked', onKicked);
    // Auto-rejoin only when we were already in THIS game and the socket dropped —
    // never on first load (that pulled phones into finished games from a prior session).
    const onReconnect = () => {
      if (!joinedRef.current) return;
      const saved = safeParse(localStorage.getItem('bb:session'));
      if (saved) {
        socket.emit('player:join', saved, (res) => { if (res?.ok) setMe(res); });
      }
    };
    socket.on('connect', onReconnect);
    return () => { socket.off('state', onState); socket.off('kicked', onKicked); socket.off('connect', onReconnect); };
  }, []);

  const join = () => {
    setError('');
    const saved = safeParse(localStorage.getItem('bb:session'));
    const payload = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      playerId: saved?.code === code.trim().toUpperCase() ? saved.playerId : undefined
    };
    getSocket().emit('player:join', payload, (res) => {
      if (res.error) return setError(res.error);
      setMe(res);
      joinedRef.current = true;
      localStorage.setItem('bb:name', name.trim());
      localStorage.setItem('bb:session', JSON.stringify({ code: payload.code, name: payload.name, playerId: res.playerId }));
    });
  };

  if (!me || !state) {
    return (
      <div className="play-shell">
        <div className="play-main">
          <Logo size={64} />
          <h1 className="brand" style={{ fontSize: 34 }}>John <span className="gold">G.K.</span></h1>
          <div className="card stack" style={{ width: 'min(360px, 92vw)' }}>
            <input className="input" placeholder="Room code" maxLength={4}
              value={code} onChange={e => setCode(e.target.value.toUpperCase())}
              style={{ textAlign: 'center', letterSpacing: 6, fontWeight: 800, fontSize: 22, textTransform: 'uppercase' }} />
            <input className="input" placeholder="Your name or team name" maxLength={20}
              value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && join()} />
            {error && <p style={{ color: 'var(--red)', fontSize: 14 }}>{error}</p>}
            <button className="btn btn-gold btn-lg" disabled={code.length !== 4 || !name.trim()} onClick={join}>
              Join game
            </button>
          </div>
        </div>
      </div>
    );
  }

  const myPlayer = state.players.find(p => p.id === me.playerId);
  const clue = state.clue;
  const iAmControl = state.controlPlayerId === me.playerId;
  const iBuzzed = clue?.activeBuzzer === me.playerId;
  const iAmLocked = clue?.lockedOut?.includes(me.playerId);

  const doBuzz = () => {
    getSocket().emit('player:buzz', {}, (res) => {
      if (res?.early) {
        setFlash('early');
        sfx.wrong();
        if (navigator.vibrate) navigator.vibrate(150);
        setTimeout(() => setFlash(''), 500);
      } else if (res?.ok) {
        sfx.buzz();
        if (navigator.vibrate) navigator.vibrate([40, 30, 80]);
      }
    });
  };

  return (
    <div ref={shellRef} className={`play-shell ${flash === 'early' ? 'flash-early' : ''}`}>
      <div className="row spread">
        <strong style={{ color: myPlayer?.color }}>{myPlayer?.name}</strong>
        <span className={`my-score ${myPlayer?.score < 0 ? 'neg' : ''}`} style={{ fontSize: 26 }}>
          ${myPlayer?.score?.toLocaleString() ?? 0}
        </span>
      </div>

      <div className="play-main">
        {state.phase === 'lobby' && (
          <>
            <h2>You're in</h2>
            <p className="muted">Waiting for the host to start…</p>
          </>
        )}

        {state.phase === 'board' && (
          <>
            <h2 className="muted" style={{ fontWeight: 600 }}>{state.board?.roundName}</h2>
            {iAmControl
              ? <p className="gold" style={{ fontWeight: 700 }}>You have control of the board</p>
              : <p className="muted">Watch the board — get ready to buzz.</p>}
          </>
        )}

        {state.phase === 'clue' && clue && (
          <PlayClue
            clue={clue} state={state} me={me}
            iAmControl={iAmControl} iBuzzed={iBuzzed} iAmLocked={iAmLocked}
            myPlayer={myPlayer} doBuzz={doBuzz}
          />
        )}

        {state.phase === 'final_wager' && <FinalWager state={state} me={me} myPlayer={myPlayer} />}
        {state.phase === 'final_clue' && <FinalAnswer state={state} me={me} />}
        {state.phase === 'final_reveal' && <p className="muted">Look up at the big screen…</p>}
        {state.phase === 'over' && <PlayerResults state={state} me={me} />}
      </div>
    </div>
  );
}

function PlayClue({ clue, state, me, iAmControl, iBuzzed, iAmLocked, myPlayer, doBuzz }) {
  if (clue.dailyDouble) {
    if (clue.state === 'dd_wager') {
      return iAmControl
        ? <DDWager myPlayer={myPlayer} state={state} />
        : (
          <>
            <div className="dd-splash" style={{ fontSize: 34 }}>Double Down!</div>
            <p className="muted">
              {state.players.find(p => p.id === state.controlPlayerId)?.name} is wagering…
            </p>
          </>
        );
    }
    return iAmControl
      ? (
        <>
          <div className="badge">Double Down — ${clue.wager?.toLocaleString()}</div>
          <p style={{ fontSize: 18, fontWeight: 600, maxWidth: 320 }}>{clue.question}</p>
          <p className="muted">Answer out loud — the host will judge.</p>
        </>
      )
      : <p className="muted">Double Down in progress…</p>;
  }

  const buzzed = clue.state === 'answering';
  const buzzer = state.players.find(p => p.id === clue.activeBuzzer);

  return (
    <>
      <p className="status-line">
        {clue.state === 'reading' && <span className="muted">Wait for it… (early buzz = penalty)</span>}
        {clue.state === 'armed' && !iAmLocked && <span style={{ color: 'var(--green)', fontWeight: 800 }}>BUZZERS OPEN!</span>}
        {clue.state === 'armed' && iAmLocked && <span style={{ color: 'var(--red)' }}>Locked out of this clue</span>}
        {buzzed && iBuzzed && <span className="gold" style={{ fontWeight: 800 }}>You buzzed first — answer!</span>}
        {buzzed && !iBuzzed && <span className="muted">{buzzer?.name} buzzed in</span>}
        {clue.state === 'revealed' && <span className="muted">Answer: {clue.answer}</span>}
      </p>
      <button
        className={`buzzer ${clue.state === 'armed' && !iAmLocked ? 'armed' : ''}`}
        disabled={iAmLocked || clue.state === 'revealed' || (buzzed && !iBuzzed)}
        onPointerDown={doBuzz}
      >
        {iBuzzed ? 'BUZZED' : 'BUZZ'}
      </button>
      <p className="muted" style={{ fontSize: 13 }}>
        {clue.category} — ${clue.value}
      </p>
    </>
  );
}

function DDWager({ myPlayer, state }) {
  const roundMax = 1000 * ((state.board?.roundIndex ?? 0) + 1);
  const max = Math.max(myPlayer?.score ?? 0, roundMax);
  const [amount, setAmount] = useState(Math.min(1000, max));
  const [sent, setSent] = useState(false);
  const send = () => {
    getSocket().emit('player:wager', { amount }, (res) => { if (res?.ok) setSent(true); });
  };
  if (sent) return <p className="gold" style={{ fontWeight: 700 }}>Wager locked in.</p>;
  return (
    <div className="card stack center" style={{ width: 'min(340px, 92vw)', alignItems: 'center' }}>
      <div className="dd-splash" style={{ fontSize: 30 }}>Double Down!</div>
      <p className="muted">Wager between $5 and ${max.toLocaleString()}</p>
      <div className="my-score">${amount.toLocaleString()}</div>
      <input type="range" min={5} max={max} step={5} value={amount}
        style={{ width: '100%' }} onChange={e => setAmount(+e.target.value)} />
      <div className="row">
        {[100, 500, 1000].filter(v => v <= max).map(v => (
          <button key={v} className="btn btn-sm btn-ghost" onClick={() => setAmount(v)}>${v}</button>
        ))}
        <button className="btn btn-sm btn-ghost" onClick={() => setAmount(max)}>All in</button>
      </div>
      <button className="btn btn-gold btn-lg" onClick={send}>Lock it in</button>
    </div>
  );
}

function FinalWager({ state, me, myPlayer }) {
  const [amount, setAmount] = useState(0);
  const sent = state.final?.wagered?.includes(me.playerId);
  const eligible = (myPlayer?.score ?? 0) > 0;
  if (!eligible) return <p className="muted">You need a positive score to play the final round. Enjoy the show!</p>;
  if (sent) return <p className="gold" style={{ fontWeight: 700 }}>Wager placed. Waiting for the clue…</p>;
  const max = myPlayer.score;
  return (
    <div className="card stack center" style={{ width: 'min(340px, 92vw)', alignItems: 'center' }}>
      <span className="badge">Final Wager</span>
      <h3>{state.final?.category}</h3>
      <p className="muted">Wager up to ${max.toLocaleString()}</p>
      <div className="my-score">${amount.toLocaleString()}</div>
      <input type="range" min={0} max={max} step={5} value={amount}
        style={{ width: '100%' }} onChange={e => setAmount(+e.target.value)} />
      <button className="btn btn-sm btn-ghost" onClick={() => setAmount(max)}>All in</button>
      <button className="btn btn-gold btn-lg"
        onClick={() => getSocket().emit('player:wager', { amount }, () => {})}>
        Lock in wager
      </button>
    </div>
  );
}

function FinalAnswer({ state, me }) {
  const [text, setText] = useState('');
  const wagered = state.final?.wagered?.includes(me.playerId);
  const answered = state.final?.answered?.includes(me.playerId);
  if (!wagered) return <p className="muted">Sit tight — others are answering.</p>;
  if (answered) return <p className="gold" style={{ fontWeight: 700 }}>Answer submitted.</p>;
  return (
    <div className="card stack" style={{ width: 'min(360px, 92vw)' }}>
      <span className="badge">Final Wager</span>
      <p style={{ fontWeight: 600 }}>{state.final?.question}</p>
      <textarea className="input" autoFocus placeholder="What is …?"
        value={text} onChange={e => setText(e.target.value)} />
      <button className="btn btn-gold btn-lg" disabled={!text.trim()}
        onClick={() => getSocket().emit('player:finalAnswer', { text }, () => {})}>
        Submit answer
      </button>
    </div>
  );
}

function PlayerResults({ state, me }) {
  const leave = () => {
    localStorage.removeItem('bb:session');
    window.location.href = '/play';
  };
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const myRank = ranked.findIndex(p => p.id === me.playerId) + 1;
  return (
    <>
      <h2>{myRank === 1 ? 'You won' : `You finished #${myRank}`}</h2>
      <div className="stack" style={{ width: 'min(320px, 90vw)' }}>
        {ranked.map((p, i) => (
          <div key={p.id} className="row spread" style={{
            padding: '8px 14px', borderRadius: 6,
            border: '1px solid var(--border)',
            background: p.id === me.playerId ? 'rgba(227,178,60,.08)' : 'transparent'
          }}>
            <span><span className="muted">#{i + 1}</span> <strong style={{ color: p.color }}>{p.name}</strong></span>
            <strong className="gold">${p.score.toLocaleString()}</strong>
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 13 }}>If the host starts a rematch, stay on this screen.</p>
      <button className="btn btn-ghost" onClick={leave}>Leave game</button>
    </>
  );
}
