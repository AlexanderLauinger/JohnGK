import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Builder from './pages/Builder.jsx';
import Host from './pages/Host.jsx';
import Play from './pages/Play.jsx';
import Remote from './pages/Remote.jsx';
import './index.css';

// If anything throws during a game, show a recoverable screen instead of a
// frozen page. Reloading rejoins the room (host reclaims, players rejoin).
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('John G.K. crashed:', error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page page-narrow center" style={{ paddingTop: 80 }}>
        <div className="card stack" style={{ alignItems: 'center' }}>
          <h2>Something went wrong</h2>
          <p className="muted" style={{ fontSize: 13 }}>{String(this.state.error?.message || this.state.error)}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload and rejoin
          </button>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/builder/:id" element={<Builder />} />
          <Route path="/host/:gameId" element={<Host />} />
          <Route path="/play" element={<Play />} />
          <Route path="/play/:code" element={<Play />} />
          <Route path="/remote/:code" element={<Remote />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
