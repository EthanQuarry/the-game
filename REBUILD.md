# the-game — Rebuild Guide

This document captures everything built so far and exactly how to rebuild it on
top of the official Voxelize example client (not the stripped-down tutorial).
The tutorial had a chunk-loading bug we couldn't fix; the official demo works.

---

## What we built

### World

Flat voxel world. Terrain layers (bottom to top):
- Stone × 10 (y = 0–9)
- Dirt × 2 (y = 10–11)
- Grass Block × 1 (y = 12)
- Ground level for buildings = y = 13

### Custom blocks

| Name | ID | Notes |
|---|---|---|
| Dirt | 1 | default |
| Stone | 2 | default |
| Grass Block | 3 | default |
| Brick | 4 | red-brown brick pattern |
| Glass | 5 | `is_transparent(true)` |
| Wood | 6 | warm wood plank |
| Dark Stone | 7 | dark grey stone |
| Cobblestone | 8 | grey cobble |

All textures are 16×16 PNGs in `public/blocks/`. They were generated with Python
(no external deps) — see the generation script at the bottom of this file.

### City layout

Each chunk = 16×16 voxels. Chunk `[cx, cz]` has world origin `(cx*16, cz*16)`.

```
Chunk [0,0]   — road intersection (E-W and N-S stone strips, 4 wide each)
Chunk [1,0]   — dark stone office block (10×6, 8 tall) + E-W road continuation
Chunk [-1,0]  — brick office block (10×6, 8 tall) + E-W road continuation
Chunk [0,1]   — glass skyscraper (8×8, 16 tall, dark stone columns, floor bands, spire)
Chunk [0,-1]  — two small brick shops (5×5, 4 tall, door cutout, glass windows)
Chunks [±1,±1] — corner streetlights (dark stone pole + arm)
```

Road design (in `CityStage`):
- E-W road: `fill(bx, g-1, bz+6, bx+15, g, bz+9, stone)` — covers grass layer
- N-S road: `fill(bx+6, g-1, bz, bx+9, g, bz+15, stone)`
- Continued into [1,0], [-1,0], [0,1], [0,-1] chunks

**Key lesson learned:** chunk coordinates use `chunk.min` (`Vec3(cx*16, 0, cz*16)`)
as the world-space origin. Always offset building coordinates from `bx`/`bz`.
Never use chunk-local coords (0–15) directly with `set_voxel`.

### World config

```rust
WorldConfig::new()
    .min_chunk([-128, -128])
    .max_chunk([128, 128])
    .preload(true)
    .preload_radius(18)   // preloads 18-chunk radius before accepting connections
    .time_per_day(24000)
    .default_time(12000.0) // midday
    .build()
```

`preload_radius(18)` is important — without it neighbour chunks aren't ready
when a chunk is first meshed and face-culling produces missing terrain faces.

### NPC system (Thomas the merchant)

Thomas is a voxel character who patrols waypoints. He has two modes:

**Simple mode (default, no AWS):**
Client-side only. Thomas walks between hardcoded waypoints using A* pathfinding.
Press E within 4 blocks to open a dialog box (shows "(LLM disabled)" message).

**LLM mode (opt-in, requires AWS Bedrock):**
The Rust server runs a second HTTP server on port 4001. Every 2s (when players
are nearby) or 10s (when alone), it calls Claude Haiku on AWS Bedrock with:
- Thomas's personality prompt
- His current position, emotion, memory
- Nearby player positions and queued messages

Claude returns JSON: `{ thought, action, emotion, memory_updates }`.
Actions: `speak`, `move_to_waypoint`, `move_toward`, `move_away`, `idle`, `patrol`.
Results broadcast to all clients via SSE at `GET /npc-events`.

Thomas's waypoints: `market (12,13,12)`, `well (28,13,12)`,
`shelter (12,13,28)`, `road (8,13,8)`.

To enable: set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` env
vars before starting the server. Set `NPC_LLM_ENABLED = true` in `main.js`.

---

## Client features built

### Controls
- WASD move, Space jump, F fly, G noclip, C perspective cycle, E talk to NPC
- Click to lock pointer (pointer lock requested; drag-to-look fallback for Linux/Brave/Firefox)
- Escape to pause

### UI
- Click-to-play overlay with control hints
- FPS counter (top right)
- Debug panel (press J): position, render radius, chunk counts
- NPC speech bubbles (projected from 3D world position to screen)
- NPC dialog box (press E, type message, Enter to send)

### Sky
Single "daylight" phase — pure blue sky, no day/night cycle currently.
```js
{ top: "#1a6fd4", middle: "#5aaaf0", bottom: "#8dc8ff", voidOffset: 0.5, start: 0.0 }
```

### Spawn
Ghost mode on until chunk [0,0] loads, then `teleportToTop(8, 8)` lands on road.

### Things that didn't work / known issues
- Tutorial's chunk loader only loaded ~4–6 chunks total regardless of renderRadius
- This is why we're rebuilding on the official example — it uses `Peers` +
  `network.register(controls)` which correctly syncs player position to server
  so the server loads chunks around where the player actually is

---

## How to rebuild

### 1. Clone the official example

```sh
# From the Patch directory
git clone https://github.com/voxelize/voxelize.git voxelize-source
cd voxelize-source
pnpm install
pnpm run proto
pnpm run build
```

Copy the client example as a starting point:
```sh
cp -r examples/client ../the-game-v2
cd ../the-game-v2
npm install --legacy-peer-deps
```

### 2. Server — copy from current src/main.rs

The Rust server is self-contained. Copy the `src/main.rs` and `Cargo.toml`
from the old project. The NPC system, block definitions, CityStage, and world
config all stay the same.

Key `Cargo.toml` deps to keep:
```toml
voxelize = "1.0.0"
actix-web = "4.5.1"
specs = { version = "0.20.0", features = ["specs-derive", "serde"] }
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "rustls-tls"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
hmac = "0.12"
sha2 = "0.10"
hex = "0.4"
chrono = { version = "0.4", features = ["serde"] }
async-stream = "0.3"
```

### 3. Client — adapt the official example

The official demo (`examples/client/src/main.ts`) is TypeScript but works
identically to our JS. Key things to port from our code:

**Keep from official demo (do NOT replace):**
- `network.register(world).register(peers).register(controls)` — this is what
  fixes chunk loading. Controls must be registered so server tracks player pos.
- `world.update(controls.object.position, camera.getWorldDirection(...))` — use
  `controls.object.position`, not `camera.getWorldPosition()`
- `world.addChunkInitListener([0,0], () => controls.teleportToTop(0, 0))`
- The `Peers` class setup
- `renderer.setTransparentSort(VOXELIZE.TRANSPARENT_SORT(controls.object))`

**Add from our code:**
- Block texture loading (all 9 textures, `textureUnitDimension: 16`)
- Sky phases (single daylight phase)
- NPC system (Thomas + A* + speech bubbles + dialog box)
- FPS counter
- Overlay UI + drag-to-look fallback
- Escape key pause

### 4. Assets

Copy `public/blocks/` directory verbatim — all 9 PNG textures at 16×16.

---

## Texture generation script

Run this Python script (no deps) to regenerate all block textures at 16×16:

```python
import struct, zlib, os, random

def make_png(pixels, size=16):
    def chunk(name, data):
        c = name + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    raw = b''
    for y in range(size):
        raw += b'\x00'
        for x in range(size):
            r,g,b = pixels[y*size+x]
            raw += bytes([int(r),int(g),int(b)])
    return sig + ihdr + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')

def clamp(v): return max(0, min(255, int(v)))
S = 16
random.seed(1);  dirt      = [(clamp(134+random.randint(-12,12)), clamp(96+random.randint(-8,8)),  clamp(67+random.randint(-8,8)))  for _ in range(S*S)]
random.seed(2);  stone     = [(clamp(128+random.randint(-15,15)),)*3 for _ in range(S*S)]
random.seed(3);  gtop      = [(clamp(92+random.randint(-10,10)),  clamp(148+random.randint(-10,10)),clamp(54+random.randint(-8,8)))  for _ in range(S*S)]
random.seed(4);  gside     = [(clamp(92+random.randint(-10,10)), clamp(148+random.randint(-10,10)), clamp(54+random.randint(-8,8))) if i//S < 3 else (clamp(134+random.randint(-12,12)), clamp(96+random.randint(-8,8)), clamp(67+random.randint(-8,8))) for i in range(S*S)]

def bricks(br,bg,bb):
    random.seed(123); result = []
    for y in range(16):
        for x in range(16):
            mh = (y%4==0); offset = 8 if (y//4)%2==0 else 0; mv = ((x+offset)%8==0)
            if mh or mv: result.append((180,175,170))
            else:
                v=random.randint(-15,15); result.append((clamp(br+v),clamp(bg+v//2),clamp(bb+v//3)))
    return result

def cobble():
    random.seed(42); result = []
    for y in range(16):
        for x in range(16):
            mh=(y%4==0); offset=8 if (y//4)%2==0 else 0; mv=((x+offset)%8==0)
            if mh or mv: result.append((150,148,145))
            else: v=random.randint(-15,15); result.append((clamp(118+v),clamp(112+v),clamp(108+v)))
    return result

random.seed(999); dark_stone = [(clamp(55+random.randint(-12,12)),)*3 for _ in range(S*S)]
random.seed(77);  wood       = [(clamp(175+random.randint(-10,10)),clamp(115+random.randint(-5,5)),clamp(55+random.randint(-8,8))) for _ in range(S*S)]
glass = [(180,210,230) if x==0 or x==15 or y==0 or y==15 else (210,235,248) if (x<4 and y<8) or (x>=8 and y<8) else (195,228,245) for y in range(16) for x in range(16)]

out = 'public/blocks'
for name, px in [('dirt.png',dirt),('stone.png',stone),('grass_top.png',gtop),
                  ('grass_side.png',gside),('brick.png',bricks(165,85,65)),
                  ('cobblestone.png',cobble()),('dark_stone.png',dark_stone),
                  ('wood.png',wood),('glass.png',glass)]:
    open(os.path.join(out,name),'wb').write(make_png(px))
    print('wrote', name)
```

---

## What NOT to do (lessons learned)

- Do not set `world.renderRadius` before `world.initialize()` — it throws
- Do not add Three.js `AmbientLight`/`DirectionalLight` — Voxelize's chunk shader
  ignores them; it uses its own sunlight system
- Do not put `min_chunk`/`max_chunk` bounds equal to renderRadius — the world
  edge becomes visible. Use `-128`/`128` or omit for infinite
- Do not use chunk-local coordinates (0–15) in `set_voxel` — always use world
  coordinates offset from `chunk.min` (`bx`, `bz`)
- Do not skip `network.register(controls)` — without it the server never gets
  player position updates and only loads chunks near spawn
- Do not call `world.update(camera.getWorldPosition(...), ...)` — use
  `controls.object.position` as the first argument
- `textureUnitDimension` must match texture PNG size (we use 16 for 16×16 PNGs)
