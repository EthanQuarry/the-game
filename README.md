# the-game

A multiplayer voxel game built with [Voxelize](https://voxelize.io) — Rust backend, Three.js frontend.

## Prerequisites

### Rust (all platforms)
```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Node.js 18+
- **macOS:** `brew install node`
- **Linux (Ubuntu/Debian):** `sudo apt install nodejs npm`
- **Linux (Arch):** `sudo pacman -S nodejs npm`

### protoc
- **macOS:** `brew install protobuf`
- **Linux (Ubuntu/Debian):** `sudo apt install protobuf-compiler`
- **Linux (Arch):** `sudo pacman -S protobuf`

### cargo-watch (optional, for hot reload)
```sh
cargo install cargo-watch
```

## Setup

```sh
npm install --legacy-peer-deps
```

## Running

You need two terminals running simultaneously.

**Terminal 1 — backend (port 4000):**
```sh
npm run server
```

**Terminal 2 — frontend (port 5173):**
```sh
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

## Controls

| Key | Action |
|-----|--------|
| WASD | Move |
| Space | Jump |
| F | Toggle fly mode |
| G | Toggle ghost mode (no collision) |
| C | Cycle perspective (1st / 2nd / 3rd person) |
| E | Talk to nearby NPC |
| Mouse | Look around |

## LLM-Driven NPCs (disabled by default)

The game has an AI NPC system where each NPC's behaviour (movement, speech, memory) is decided by Claude via AWS Bedrock. It is **off by default** so the game runs without any AWS setup.

### To enable

**1. Set AWS credentials** (Bedrock must be enabled in your account):
```sh
export AWS_ACCESS_KEY_ID=your_key
export AWS_SECRET_ACCESS_KEY=your_secret
export AWS_REGION=us-east-1
```

**2. Enable the flag in `main.js`** (line ~74):
```js
const NPC_LLM_ENABLED = true;   // was false
```

**3. Run the NPC API server** (port 4001) alongside the game server:
```sh
npm run server   # starts both Voxelize on :4000 and the NPC API on :4001
```

**4. Open the game** — Thomas the merchant will patrol the city, react to players, and respond when you press E nearby.

### How it works

- The Rust server runs a background tick loop per NPC (every 2s when players are nearby, every 10s when alone)
- Each tick: all nearby player positions + queued player messages are sent to Claude Haiku on Bedrock
- Claude returns a JSON action: `speak`, `move_to_waypoint`, `move_toward`, `idle`, or `patrol`
- The result is broadcast to all connected clients via SSE — every player sees the same NPC state
- The NPC remembers facts about each player across ticks (capped at 10 facts per player)
- Prompt injection is mitigated: player messages are wrapped in `[PLAYER:id]` tags and the system prompt instructs the model to treat them as untrusted

## Project Structure

```
src/main.rs       # Rust server — world config, block registration, terrain generation
main.js           # JS client — rendering, controls, networking, textures
public/blocks/    # Block texture PNGs
index.html        # Entry point
```
