import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';

export default function Builder() {
  const { id } = useParams();
  const nav = useNavigate();
  const [game, setGame] = useState(null);
  const [round, setRound] = useState(0); // 0, 1, or 'final'
  const [editing, setEditing] = useState(null); // {c, i} or 'final'
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState('');
  const saveTimer = useRef(null);

  useEffect(() => {
    api.getGame(id).then(setGame).catch(() => nav('/'));
  }, [id]);

  // Debounced autosave
  const scheduleSave = useCallback((g) => {
    setDirty(true);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.saveGame(id, g);
        setDirty(false);
        setSaveError('');
      } catch (e) {
        setSaveError(e.status === 403 ? 'Read-only: this game was created in another browser.' : 'Save failed — is the server running?');
      }
    }, 700);
  }, [id]);

  const update = (fn) => {
    setGame(prev => {
      const g = structuredClone(prev);
      fn(g);
      scheduleSave(g);
      return g;
    });
  };

  if (!game) return <div className="page center muted">Loading…</div>;

  const isFinal = round === 'final';
  const rd = isFinal ? null : game.rounds[round];
  const ddCount = rd ? rd.categories.reduce((n, c) => n + c.clues.filter(cl => cl.dailyDouble).length, 0) : 0;
  const ddMax = round === 0 ? 1 : 2;

  return (
    <div className="page">
      <div className="row spread wrap mb">
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={() => nav('/')}>← Back</button>
          <input
            className="input" style={{ width: 300, fontWeight: 700, fontSize: 18 }}
            value={game.title}
            onChange={e => update(g => { g.title = e.target.value; })}
            placeholder="Game title"
          />
        </div>
        <div className="row">
          <span className="muted" style={{ fontSize: 13 }}>
            {saveError
              ? <span style={{ color: 'var(--red)' }}>{saveError}</span>
              : <><span className={`save-dot ${dirty ? 'dirty' : ''}`} />{dirty ? 'Saving…' : 'Saved'}</>}
          </span>
          <button className="btn btn-green" onClick={() => nav(`/host/${id}`)}>Host this game ▸</button>
        </div>
      </div>

      <GameSettings game={game} update={update} onRoundDisabled={(r) => { if (round === r) setRound(0); }} />

      <div className="row spread wrap mb">
        <div className="tabs">
          {game.rounds.map((r, i) => (
            (i === 0 || game.settings.useDoubleJeopardy !== false) && (
              <button key={i} className={`tab ${round === i ? 'active' : ''}`} onClick={() => setRound(i)}>{r.name}</button>
            )
          ))}
          {game.settings.useFinal !== false && (
            <button className={`tab ${isFinal ? 'active' : ''}`} onClick={() => setRound('final')}>Final Wager</button>
          )}
        </div>
        {!isFinal && (
          <span className="badge">Double Downs: {ddCount}/{ddMax} recommended</span>
        )}
      </div>

      {isFinal ? (
        <div className="card stack" style={{ maxWidth: 640 }}>
          <h3 className="gold">Final Wager</h3>
          <label className="muted">Category</label>
          <input className="input" value={game.final.category}
            onChange={e => update(g => { g.final.category = e.target.value; })} placeholder="e.g. World Capitals" />
          <label className="muted">Clue</label>
          <textarea className="input" value={game.final.question}
            onChange={e => update(g => { g.final.question = e.target.value; })} placeholder="The clue read to all players" />
          <label className="muted">Correct response</label>
          <input className="input" value={game.final.answer}
            onChange={e => update(g => { g.final.answer = e.target.value; })} placeholder="What is …?" />
          <MediaField media={game.final.media} onChange={m => update(g => { g.final.media = m; })} />
        </div>
      ) : (
        <div className="builder-grid" style={{ '--cols': rd.categories.length }}>
          {rd.categories.map((cat, c) => (
            <input key={`cat-${c}`} className="builder-cat-input" value={cat.name}
              placeholder={`Category ${c + 1}`}
              onChange={e => update(g => { g.rounds[round].categories[c].name = e.target.value; })} />
          ))}
          {Array.from({ length: 5 }, (_, i) =>
            rd.categories.map((cat, c) => {
              const clue = cat.clues[i];
              const filled = clue.question || clue.answer;
              return (
                <button key={`${c}-${i}`}
                  className={`builder-tile ${filled ? 'filled' : ''} ${clue.dailyDouble ? 'dd-flag' : ''}`}
                  onClick={() => setEditing({ c, i })}>
                  ${clue.value}
                  {clue.dailyDouble && <span className="dd-mark">DD</span>}
                </button>
              );
            })
          )}
        </div>
      )}

      {editing && !isFinal && (
        <ClueEditor
          clue={rd.categories[editing.c].clues[editing.i]}
          category={rd.categories[editing.c].name || `Category ${editing.c + 1}`}
          onClose={() => setEditing(null)}
          onChange={(patch) => update(g => {
            Object.assign(g.rounds[round].categories[editing.c].clues[editing.i], patch);
          })}
        />
      )}
    </div>
  );
}

function GameSettings({ game, update, onRoundDisabled }) {
  const s = game.settings || {};
  return (
    <div className="card row wrap mb" style={{ padding: '14px 20px', gap: 24 }}>
      <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.useDoubleJeopardy !== false}
          onChange={e => {
            update(g => { g.settings.useDoubleJeopardy = e.target.checked; });
            if (!e.target.checked) onRoundDisabled(1);
          }} />
        <span style={{ fontWeight: 600 }}>Double Points round</span>
      </label>
      <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.useFinal !== false}
          onChange={e => {
            update(g => { g.settings.useFinal = e.target.checked; });
            if (!e.target.checked) onRoundDisabled('final');
          }} />
        <span style={{ fontWeight: 600 }}>Final Wager round</span>
      </label>
      <label className="row" style={{ gap: 8 }}>
        <span className="muted">Buzzers open</span>
        <select className="input" style={{ width: 210 }}
          value={s.buzzMode || 'typewriter'}
          onChange={e => update(g => { g.settings.buzzMode = e.target.value; })}>
          <option value="typewriter">After clue types out on screen</option>
          <option value="tts">After clue is read aloud (TTS)</option>
          <option value="timed">After a reading delay</option>
          <option value="manual">When host opens them</option>
        </select>
      </label>
      <label className="row" style={{ gap: 8 }}>
        <span className="muted">Answer time</span>
        <input className="input" type="number" min={3} max={120} style={{ width: 76 }}
          value={s.answerSeconds ?? 7}
          onChange={e => update(g => { g.settings.answerSeconds = Math.max(3, +e.target.value || 7); })} />
        <span className="muted">sec</span>
      </label>
      {s.useFinal !== false && (
        <label className="row" style={{ gap: 8 }}>
          <span className="muted">Final answer time</span>
          <input className="input" type="number" min={10} max={300} style={{ width: 76 }}
            value={s.finalSeconds ?? 45}
            onChange={e => update(g => { g.settings.finalSeconds = Math.max(10, +e.target.value || 45); })} />
          <span className="muted">sec</span>
        </label>
      )}
    </div>
  );
}

function ClueEditor({ clue, category, onClose, onChange }) {
  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="card modal stack">
        <div className="row spread">
          <h3>{category} — <span className="gold">${clue.value}</span></h3>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>Done</button>
        </div>
        <label className="muted">Clue (shown to players)</label>
        <textarea className="input" autoFocus value={clue.question}
          onChange={e => onChange({ question: e.target.value })}
          placeholder="This U.S. state is known as the Sunshine State" />
        <label className="muted">Correct response</label>
        <input className="input" value={clue.answer}
          onChange={e => onChange({ answer: e.target.value })}
          placeholder="What is Florida?" />
        <div className="row spread wrap">
          <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={clue.dailyDouble}
              onChange={e => onChange({ dailyDouble: e.target.checked })} />
            <span className="gold" style={{ fontWeight: 700 }}>Double Down (wager clue)</span>
          </label>
          <label className="row" style={{ gap: 8 }}>
            <span className="muted">Value $</span>
            <input className="input" type="number" step={100} style={{ width: 110 }}
              value={clue.value} onChange={e => onChange({ value: +e.target.value || 0 })} />
          </label>
          <label className="row" style={{ gap: 8 }}>
            <span className="muted">Time limit</span>
            <input className="input" type="number" min={3} max={120} style={{ width: 90 }}
              value={clue.timeLimit ?? ''} placeholder="default"
              onChange={e => onChange({ timeLimit: e.target.value ? Math.max(3, +e.target.value) : null })} />
            <span className="muted">sec</span>
          </label>
        </div>
        <MediaField media={clue.media} onChange={media => onChange({ media })} />
      </div>
    </div>
  );
}

function MediaField({ media, onChange }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <label className="muted">Media URL (optional — image, audio, or video)</label>
      <div className="row">
        <select className="input" style={{ width: 110 }} value={media?.type || 'image'}
          onChange={e => onChange(media?.url ? { ...media, type: e.target.value } : media)}>
          <option value="image">Image</option>
          <option value="audio">Audio</option>
          <option value="video">Video</option>
        </select>
        <input className="input" value={media?.url || ''}
          placeholder="https://…"
          onChange={e => onChange(e.target.value ? { type: media?.type || 'image', url: e.target.value } : null)} />
      </div>
      {media?.url && media.type === 'image' && (
        <img src={media.url} alt="" style={{ maxHeight: 120, borderRadius: 8, alignSelf: 'flex-start' }} />
      )}
    </div>
  );
}
