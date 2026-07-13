const j = async (r) => {
  if (!r.ok) {
    let msg = `API error ${r.status}`;
    try { msg = (await r.json()).error || msg; } catch { /* keep default */ }
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return r.json();
};

// Edit keys for games created in this browser, kept in localStorage.
// Only the creator (or someone they share a key with) can modify a game.
function keys() {
  try { return JSON.parse(localStorage.getItem('gk:keys') || '{}'); } catch { return {}; }
}
export function editKeyFor(id) {
  return keys()[id] || '';
}
export function rememberEditKey(id, key) {
  if (!key) return;
  const k = keys();
  k[id] = key;
  localStorage.setItem('gk:keys', JSON.stringify(k));
}

export const api = {
  // "Your games" = the games whose edit keys are stored in this browser.
  listGames: async () => {
    const ids = Object.keys(keys());
    const results = await Promise.all(
      ids.map(id => fetch(`/api/games/${id}`).then(j).catch(() => null))
    );
    return results
      .filter(Boolean)
      .map(g => ({ id: g.id, title: g.title, updated_at: g.updatedAt || 0 }))
      .sort((a, b) => b.updated_at - a.updated_at);
  },
  createGame: async (data) => {
    const g = await fetch('/api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data })
    }).then(j);
    rememberEditKey(g.id, g.editKey);
    return g;
  },
  getGame: (id) => fetch(`/api/games/${id}`).then(j),
  saveGame: (id, data) => fetch(`/api/games/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-edit-key': editKeyFor(id) },
    body: JSON.stringify(data)
  }).then(j),
  deleteGame: (id) => fetch(`/api/games/${id}`, {
    method: 'DELETE',
    headers: { 'x-edit-key': editKeyFor(id) }
  }).then(j),
  lanIp: () => fetch('/api/lan-ip').then(j)
};
