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
  listGames: () => fetch('/api/games').then(j),
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
