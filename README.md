# John G.K.

*What is "General Knowledge"?* — a game show style party game creator.

Build quiz boards in your browser, host on a big screen, and players join with their phones as buzzers over websockets.

## Features

- **Game builder** — two rounds (Round One / Double Points) with 5 categories × 5 clues each, editable values, autosave to SQLite, media (image/audio/video URLs) in clues, and a Final Wager round.
- **Phone buzzers** — players scan a QR code or enter a 4-letter room code. Buzzes are server-timestamped so the first press always wins.
- **Buzzer fairness** — buzzing before buzzers open earns a short penalty lockout; a wrong answer locks you out of that clue while everyone else can buzz back in.
- **Buzzer opening modes** — per game: clue types out on screen (default), clue read aloud by neural TTS, a timed reading delay, or manual host control.
- **Double Downs** — flag any clue as a wager clue; the player in control wagers from their phone ("all in" supported).
- **Final Wager** — players wager privately from their phones, type answers under a countdown, and the host reveals lowest-score-first, judging each.
- **Host phone remote** — scan a private QR to control the whole game from your phone, with answers visible only to you. The shared screen stays clean.
- **Board control** — last correct answer picks next and gets Double Downs (gold ring on the scoreboard).
- **Timers, sounds, animations** — answer countdowns, buzz/correct/wrong sounds (Web Audio — no files), podium finale.
- **Reconnect-safe** — players who drop or refresh rejoin with their score intact; hosts reclaim their room after a refresh; a disconnected answerer can't stall the game.
- **Edit keys** — only the browser that created a game (or anyone given its key) can modify or delete it.

## Quick start

```bash
npm install          # installs concurrently (root helper)
npm run setup        # installs server + client deps
npm run dev          # dev mode: server :3001 + client :5173 (hot reload)
```

Open http://localhost:5173 — build a game, then click **Host**. Requires Node 22.5+ (uses Node's built-in SQLite).

### Production (single port)

```bash
npm start            # builds the client, serves everything on :3001
```

## Phones joining

Phones must reach your machine. On the same Wi-Fi, the lobby QR code automatically points at your LAN IP. If your firewall blocks it, allow Node on the port. For remote players, run a tunnel (e.g. `npx localtunnel --port 3001` or ngrok) and share that URL.

> Note: in dev mode (`npm run dev`) phones should use port **5173** (the Vite server proxies websockets to the backend).

## How a game flows

1. **Host** a game → lobby shows QR + room code → players join → Start. Optionally scan the private host-remote QR with your own phone.
2. Host picks a tile → clue appears full-screen and (by default) types itself out; buzzers open automatically.
3. First buzz wins; host judges ✓/✗. Wrong answers lock that player out and re-open buzzers.
4. Double Down: the player in control wagers on their phone, answers aloud, host judges.
5. After the rounds → **Final Wager**: wagers → clue + timer → written answers → reveal.
6. Podium and bragging rights. "Play again" restarts with the same players.

## Text-to-speech

The "read aloud" buzzer mode uses free Microsoft Edge neural voices via your own server (no API key). Set `TTS_VOICE` to change the voice (e.g. `en-US-GuyNeural`, `en-GB-SoniaNeural`). If the service is unreachable, it falls back to the browser's built-in speech, then to a plain timed reveal.

## Deployment notes

- Serve over **HTTPS** in production (put Node behind Caddy/nginx or use a platform like Fly.io/Railway that terminates TLS). Phone browsers restrict some features on plain HTTP.
- Set `PORT` as needed; the SQLite file lives at `server/buzzboard.db` — mount a persistent volume for it.
- Game editing is protected by per-game edit keys; hosting/game state is protected by per-room host keys. There are no accounts — anyone can create games and rooms, so consider adding a rate limiter (e.g. `express-rate-limit`) if you expect strangers.

## Stack

Node + Express + Socket.IO + SQLite (node:sqlite) · React 18 + Vite · one hand-rolled stylesheet.

## Project layout

```
server/   index.js (HTTP + sockets + TTS)  rooms.js (game state machine)  db.js (SQLite)
client/   src/pages/{Home,Builder,Host,Play,Remote}.jsx  src/{sounds,tts,socket,api}.js  src/index.css
```
