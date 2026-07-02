# the-game

A multiplayer voxel game built with [Voxelize](https://voxelize.io) — Rust backend, Three.js frontend.

## Prerequisites

- [Rust](https://rustup.rs) (1.7+) — install via `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- [Node.js](https://nodejs.org) (18+)
- [protoc](https://grpc.io/docs/protoc-installation/) — `brew install protobuf`
- [cargo-watch](https://crates.io/crates/cargo-watch) (optional, for hot reload) — `cargo install cargo-watch`

## Setup

```sh
# Install frontend dependencies
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
| Mouse | Look around |

## Project Structure

```
src/main.rs       # Rust server — world config, block registration, terrain generation
main.js           # JS client — rendering, controls, networking, textures
public/blocks/    # Block texture PNGs
index.html        # Entry point
```
