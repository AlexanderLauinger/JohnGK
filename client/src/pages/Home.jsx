import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import Logo from '../Logo.jsx';

export default function Home() {
  const nav = useNavigate();
  const [games, setGames] = useState([]);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.listGames().then(setGames).catch(() => setError('Server not reachable — is it running?'));
  }, []);

  const createGame = async () => {
    const g = await api.createGame();
    nav(`/builder/${g.id}`);
  };

  const remove = async (id) => {
    if (!confirm('Delete this game permanently?')) return;
    try {
      await api.deleteGame(id);
      setGames(games.filter(g => g.id !== id));
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <div className="page page-narrow">
      <div className="center mb hero">
        <div style={{ marginBottom: 14 }}><Logo size={52} /></div>
        <h1 className="hero-title">John <span className="gold">G.K.</span></h1>
        <div className="hero-pill">What is &ldquo;General Knowledge&rdquo;?</div>
        <p className="hero-sub">A game show style party game creator</p>
      </div>

      <div className="card stack mb">
        <h3>Join a game</h3>
        <div className="row">
          <input
            className="input" placeholder="Room code (e.g. QK7P)" maxLength={4}
            value={joinCode}
            onChange={e => setJoinCode(e.target.value.toUpperCase())}
            style={{ textTransform: 'uppercase', letterSpacing: 4, fontWeight: 700, fontSize: 20, textAlign: 'center' }}
            onKeyDown={e => e.key === 'Enter' && joinCode.length === 4 && nav(`/play/${joinCode}`)}
          />
          <button className="btn btn-gold" disabled={joinCode.length !== 4} onClick={() => nav(`/play/${joinCode}`)}>
            Join
          </button>
        </div>
      </div>

      <div className="card stack">
        <div className="row spread">
          <h3>Your games</h3>
          <button className="btn btn-primary" onClick={createGame}>+ New game</button>
        </div>
        {error && <p style={{ color: 'var(--red)' }}>{error}</p>}
        {games.length === 0 && !error && <p className="muted">Create your first game to get started!</p>}
        {games.map(g => (
          <div key={g.id} className="game-list-item">
            <div>
              <strong>{g.title}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                edited {new Date(g.updated_at).toLocaleDateString()}
              </div>
            </div>
            <div className="row">
              <button className="btn btn-sm btn-ghost" onClick={() => nav(`/builder/${g.id}`)}>Edit</button>
              <button className="btn btn-sm btn-green" onClick={() => nav(`/host/${g.id}`)}>Host</button>
              <button className="btn btn-sm btn-red" onClick={() => remove(g.id)}>✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
