import * as VOXELIZE from "@voxelize/core";
import "@voxelize/core/dist/styles.css";
import * as THREE from "three";
import "./style.css";

// ── Renderer & Camera ─────────────────────────────────────────────────────────

const canvas = document.getElementById("canvas");

const world = new VOXELIZE.World({ textureUnitDimension: 16 });

const camera = new THREE.PerspectiveCamera(
  90,
  window.innerWidth / window.innerHeight,
  0.1,
  5000
);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Network (register world + controls — critical for chunk loading) ──────────

const network = new VOXELIZE.Network();
network.register(world);

// ── Inputs & Controls ────────────────────────────────────────────────────────

const inputs = new VOXELIZE.Inputs();
inputs.setNamespace("menu");

const controls = new VOXELIZE.RigidControls(camera, renderer.domElement, world, {
  initialPosition: [0, 80, 0],
  flyForce: 400,
});
controls.connect(inputs, "in-game");

// Register controls with network so server tracks player position for chunks
network.register(controls);

const perspective = new VOXELIZE.Perspective(controls, world);
perspective.connect(inputs, "in-game");

// ── Peers (multiplayer characters) ───────────────────────────────────────────

const shadows    = new VOXELIZE.Shadows(world);
const lightShined = new VOXELIZE.LightShined(world);

function makeCharacter() {
  const c = new VOXELIZE.Character();
  world.add(c);
  lightShined.add(c);
  shadows.add(c);
  return c;
}

const mainCharacter = makeCharacter();
controls.attachCharacter(mainCharacter);

class GamePeers extends VOXELIZE.Peers {
  constructor(object) { super(object); }
  createPeer = () => makeCharacter();
  onPeerUpdate = (peer, data) => peer.set(data.position, data.direction);
  packInfo = () => {
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const { x: dx, y: dy, z: dz } = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(controls.object.getWorldQuaternion(q)).normalize();
    const { x: px, y: py, z: pz } = controls.object.getWorldPosition(p);
    return {
      id: this.ownID,
      username: this.ownUsername,
      metadata: { position: [px, py, pz], direction: [dx, dy, dz] },
    };
  };
}

const peers = new GamePeers(controls.object);
world.add(peers);
network.register(peers);

// ── Transparent sort (fixes glass rendering) ─────────────────────────────────
renderer.setTransparentSort(VOXELIZE.TRANSPARENT_SORT(controls.object));

// ── NPC system ────────────────────────────────────────────────────────────────

const NPC_LLM_ENABLED = true;
const NPC_API = "http://localhost:4001";
const playerId   = Math.random().toString(36).slice(2, 10);
const playerName = "Player" + playerId.slice(0, 4);

// A* pathfinder (flat terrain, ground at y=13)
function astar(sx, sz, gx, gz) {
  const MAX = 30;
  if (Math.abs(gx - sx) + Math.abs(gz - sz) > MAX * 2) return [];
  const key = (x, z) => `${x},${z}`;
  const open = new Map(), closed = new Set();
  const cameFrom = new Map(), gScore = new Map(), fScore = new Map();
  const h = (x, z) => Math.abs(x - gx) + Math.abs(z - gz);
  sx = Math.round(sx); sz = Math.round(sz); gx = Math.round(gx); gz = Math.round(gz);
  gScore.set(key(sx, sz), 0);
  fScore.set(key(sx, sz), h(sx, sz));
  open.set(key(sx, sz), { x: sx, z: sz });
  let iters = 0;
  while (open.size > 0 && iters++ < 800) {
    let best = null, bestF = Infinity;
    for (const [k, node] of open) { const f = fScore.get(k) ?? Infinity; if (f < bestF) { bestF = f; best = { k, node }; } }
    if (!best) break;
    const { k: ck, node: curr } = best;
    if (curr.x === gx && curr.z === gz) {
      const path = []; let c = ck;
      while (cameFrom.has(c)) { const [cx, cz] = c.split(",").map(Number); path.unshift([cx, cz]); c = cameFrom.get(c); }
      return path;
    }
    open.delete(ck); closed.add(ck);
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = curr.x + dx, nz = curr.z + dz, nk = key(nx, nz);
      if (closed.has(nk)) continue;
      if (Math.abs(nx - sx) + Math.abs(nz - sz) > MAX) continue;
      // Blocked if any solid block exists at ground level or above in this column
      const blocked = !world.isInitialized || world.getMaxHeightAt(nx, nz) > 12;
      if (blocked) continue;
      const tg = (gScore.get(ck) ?? Infinity) + 1;
      if (tg < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, ck); gScore.set(nk, tg); fScore.set(nk, tg + h(nx, nz));
        open.set(nk, { x: nx, z: nz });
      }
    }
  }
  return [];
}

const THOMAS_WAYPOINTS = {
  tent:    [12, 14.5, 12],
  market:  [20, 14.5, 4],
  well:    [28, 14.5, 12],
  shelter: [4,  14.5, 20],
  road:    [8,  14.5, 8],
};

const npcs = new Map();

function createNpc(id, name, spawnPos) {
  const character = makeCharacter();
  character.username = name;
  character.set(spawnPos, [0, 0, 1]);
  character.update();

  const bubble = document.createElement("div");
  bubble.className = "speech-bubble hidden";
  bubble.innerHTML = `<div class="npc-name">${name}</div><div class="bubble-text"></div>`;
  document.body.appendChild(bubble);

  npcs.set(id, {
    character, id, name,
    pos: new THREE.Vector3(...spawnPos),
    path: [], pathIndex: 0,
    speechBubble: bubble, bubbleTimeout: null, lastSpeech: null,
    actionType: "patrol",
  });
  return npcs.get(id);
}

createNpc("thomas", "Thomas", [12, 14.5, 12]);

const NPC_SPEED = 0.025;

function updateNpcMovement(npc) {
  const { character, path, pos } = npc;
  if (path.length > 0 && npc.pathIndex < path.length) {
    const [wx, wz] = path[npc.pathIndex];
    const dx = wx - pos.x, dz = wz - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.15) {
      npc.pathIndex++;
    } else {
      const step = Math.min(NPC_SPEED, dist);
      pos.x += (dx / dist) * step; pos.z += (dz / dist) * step; pos.y = 14.5;
      character.set([pos.x, pos.y, pos.z], [dx / dist, 0, dz / dist]);
    }
  } else {
    // Idle — face forward, wait for LLM to give next movement
    character.set([pos.x, pos.y, pos.z], [0, 0, 1]);
  }
  character.update();
}

function showSpeechBubble(npc, text) {
  const { speechBubble } = npc;
  speechBubble.querySelector(".bubble-text").textContent = text;
  speechBubble.classList.remove("hidden", "fading");
  clearTimeout(npc.bubbleTimeout);
  npc.bubbleTimeout = setTimeout(() => {
    speechBubble.classList.add("fading");
    setTimeout(() => speechBubble.classList.add("hidden"), 600);
  }, 6000);
}

function updateBubblePosition(npc) {
  const { speechBubble, pos } = npc;
  if (speechBubble.classList.contains("hidden")) return;
  const wp = new THREE.Vector3(pos.x, pos.y + 2.2, pos.z).project(camera);
  if (wp.z > 1) { speechBubble.style.display = "none"; return; }
  speechBubble.style.display = "";
  speechBubble.style.left = ((wp.x * 0.5 + 0.5) * window.innerWidth) + "px";
  speechBubble.style.top  = ((-wp.y * 0.5 + 0.5) * window.innerHeight) + "px";
}

// SSE for LLM NPC events
function connectNpcEvents() {
  const es = new EventSource(`${NPC_API}/npc-events`);
  es.onmessage = (e) => {
    let data; try { data = JSON.parse(e.data); } catch { return; }
    const npc = npcs.get(data.npc_id);
    if (!npc) return;
    npc.actionType = data.action_type;
    if (data.action_type === "move_to_waypoint" && data.waypoint) {
      const wp = THOMAS_WAYPOINTS[data.waypoint];
      if (wp) { const p = astar(npc.pos.x, npc.pos.z, wp[0], wp[2]); if (p.length) { npc.path = p; npc.pathIndex = 0; } }
    } else if (data.action_type === "speak" && data.speech) {
      showSpeechBubble(npc, data.speech); npc.lastSpeech = data.speech;
      if (activeNpcDialog === data.npc_id) {
        dialogText.textContent = data.speech; dialogText.classList.remove("thinking");
      }
    }
  };
  es.onerror = () => setTimeout(connectNpcEvents, 3000);
}

let playerUpdateTimer = 0;
function reportPlayerPos() {
  if (!NPC_LLM_ENABLED || !world.isInitialized) return;
  const p = controls.position;
  fetch(`${NPC_API}/player-update`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: playerId, name: playerName, pos: [p.x, p.y, p.z] }) }).catch(() => {});
}
window.addEventListener("beforeunload", () => {
  if (NPC_LLM_ENABLED) fetch(`${NPC_API}/player-leave`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: playerId }) }).catch(() => {});
});

// ── Dialog box ────────────────────────────────────────────────────────────────

let activeNpcDialog = null;
const dialogEl    = document.getElementById("dialog");
const dialogName  = document.getElementById("dialog-name");
const dialogText  = document.getElementById("dialog-text");
const dialogInput = document.getElementById("dialog-input");

function openDialog(npcId) {
  const npc = npcs.get(npcId); if (!npc) return;
  activeNpcDialog = npcId;
  dialogName.textContent = npc.name;
  dialogText.textContent = npc.lastSpeech || "...";
  dialogText.classList.remove("thinking");
  dialogInput.value = "";
  dialogEl.classList.remove("hidden");
  document.exitPointerLock(); controls.isLocked = false; inputs.setNamespace("menu");
  setTimeout(() => dialogInput.focus(), 50);
}

function closeDialog() {
  activeNpcDialog = null; dialogEl.classList.add("hidden"); dialogInput.value = "";
}

function sendDialogMessage() {
  const msg = dialogInput.value.trim(); if (!msg || !activeNpcDialog) return;
  dialogInput.value = "";
  if (!NPC_LLM_ENABLED) { dialogText.textContent = "(LLM disabled — set NPC_LLM_ENABLED = true)"; return; }
  dialogText.textContent = "..."; dialogText.classList.add("thinking");
  fetch(`${NPC_API}/npc-message`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ npc_id: activeNpcDialog, player_id: playerId, player_name: playerName, message: msg }) })
    .catch(() => { dialogText.textContent = "(server unreachable)"; dialogText.classList.remove("thinking"); });
}

dialogInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); sendDialogMessage(); }
  if (e.key === "Escape") closeDialog();
});

inputs.bind("KeyE", () => {
  if (activeNpcDialog) { closeDialog(); return; }
  const pp = controls.position; let nearest = null, nearestDist = Infinity;
  for (const [id, npc] of npcs) {
    const d = Math.sqrt((npc.pos.x-pp.x)**2 + (npc.pos.z-pp.z)**2);
    if (d < 4 && d < nearestDist) { nearest = id; nearestDist = d; }
  }
  if (nearest) openDialog(nearest);
}, "in-game");

function checkDialogDistance() {
  if (!activeNpcDialog) return;
  const npc = npcs.get(activeNpcDialog); if (!npc) { closeDialog(); return; }
  const pp = controls.position;
  if (Math.sqrt((npc.pos.x-pp.x)**2 + (npc.pos.z-pp.z)**2) > 6) closeDialog();
}

// ── Debug panel ───────────────────────────────────────────────────────────────

const debug = new VOXELIZE.Debug(document.body);
debug.registerDisplay("Position",        controls, "voxel");
debug.registerDisplay("Chunks loaded",   () => world.chunks?.loaded?.size   ?? "?");
debug.registerDisplay("Chunks requested",() => world.chunks?.requested?.size ?? "?");
debug.registerDisplay("Render radius",   world, "renderRadius");

// ── Key bindings ──────────────────────────────────────────────────────────────

inputs.bind("KeyG", controls.toggleGhostMode, "in-game");
inputs.bind("KeyF", controls.toggleFly,       "in-game");
inputs.bind("KeyJ", debug.toggle,             "*");

controls.on("lock",   () => inputs.setNamespace("in-game"));
controls.on("unlock", () => inputs.setNamespace("menu"));

// ── Overlay & pointer lock ────────────────────────────────────────────────────

const overlay = document.getElementById("overlay");

canvas.addEventListener("click", () => {
  overlay.classList.add("hidden");
  controls.isLocked = true;
  inputs.setNamespace("in-game");
  canvas.requestPointerLock();
});

inputs.bind("Escape", () => {
  controls.isLocked = false; inputs.setNamespace("menu");
  overlay.classList.remove("hidden"); document.exitPointerLock();
}, "in-game", { occasion: "keydown" });

// Drag-to-look fallback for Linux/Brave/Firefox (no pointer lock needed)
const PI_2 = Math.PI / 2;
const dragEuler = new THREE.Euler(0, 0, 0, "YXZ");
let isDragging = false, lastMX = 0, lastMY = 0;

canvas.addEventListener("mousedown", (e) => {
  if (!controls.isLocked || document.pointerLockElement === canvas) return;
  isDragging = true; lastMX = e.clientX; lastMY = e.clientY;
});
document.addEventListener("mouseup", () => { isDragging = false; });
document.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement === canvas || !isDragging || !controls.isLocked) return;
  const dx = e.clientX - lastMX, dy = e.clientY - lastMY;
  lastMX = e.clientX; lastMY = e.clientY;
  dragEuler.setFromQuaternion(controls.quaternion);
  dragEuler.y -= dx * 0.002; dragEuler.x -= dy * 0.002;
  dragEuler.x = Math.max(PI_2 - Math.PI * 0.99, Math.min(PI_2 - Math.PI * 0.01, dragEuler.x));
  controls.quaternion.setFromEuler(dragEuler);
});

// ── FPS counter ───────────────────────────────────────────────────────────────

const fpsEl = document.createElement("div");
fpsEl.id = "fps"; document.body.appendChild(fpsEl);
let frames = 0, lastFpsTime = performance.now();

// ── Animate loop ──────────────────────────────────────────────────────────────

function animate() {
  requestAnimationFrame(animate);

  if (world.isInitialized) {
    // Use controls.object.position (official demo pattern)
    world.update(controls.object.position, camera.getWorldDirection(new THREE.Vector3()));
    controls.update();
    perspective.update();
    lightShined.update();
    shadows.update();
    peers.update();
    debug.update();

    for (const npc of npcs.values()) {
      updateNpcMovement(npc);
      updateBubblePosition(npc);
    }
    checkDialogDistance();

    playerUpdateTimer += 16;
    if (playerUpdateTimer >= 500) { playerUpdateTimer = 0; reportPlayerPos(); }
  }

  renderer.render(world, camera);

  frames++;
  const now = performance.now();
  if (now - lastFpsTime >= 500) {
    fpsEl.textContent = `${Math.round(frames * 1000 / (now - lastFpsTime))} fps`;
    frames = 0; lastFpsTime = now;
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
  animate();

  await network.connect("http://localhost:4000");
  await network.join("tutorial");
  await world.initialize();

  world.renderRadius = 8;

  if (NPC_LLM_ENABLED) connectNpcEvents();

  // Spawn: ghost mode until chunk [0,0] loads, then land on road
  controls.toggleGhostMode();
  world.addChunkInitListener([0, 0], () => {
    controls.teleportToTop(8, 8);
    if (controls.ghostMode) controls.toggleGhostMode();
  });

  // Sky
  world.sky.setShadingPhases([
    {
      name: "sunrise",
      color: { top: new THREE.Color("#7694CF"), middle: new THREE.Color("#B0483A"), bottom: new THREE.Color("#F5C07A") },
      skyOffset: 0.05, voidOffset: 0.6, start: 0.2,
    },
    {
      name: "daylight",
      color: { top: new THREE.Color("#1a6fd4"), middle: new THREE.Color("#5aaaf0"), bottom: new THREE.Color("#8dc8ff") },
      skyOffset: 0, voidOffset: 0.05, start: 0.25,
    },
    {
      name: "sunset",
      color: { top: new THREE.Color("#A57A59"), middle: new THREE.Color("#FC5935"), bottom: new THREE.Color("#FFB347") },
      skyOffset: 0.05, voidOffset: 0.6, start: 0.7,
    },
    {
      name: "night",
      color: { top: new THREE.Color("#0a0a1a"), middle: new THREE.Color("#0d0d22"), bottom: new THREE.Color("#111122") },
      skyOffset: 0.1, voidOffset: 0.6, start: 0.75,
    },
  ]);

  world.sky.paint("bottom", VOXELIZE.artFunctions.drawSun());
  world.sky.paint("top",    VOXELIZE.artFunctions.drawStars());
  world.sky.paint("top",    VOXELIZE.artFunctions.drawMoon());
  world.sky.paint("sides",  VOXELIZE.artFunctions.drawStars());

  // Block textures
  const all = ["px", "nx", "py", "ny", "pz", "nz"];
  await world.applyBlockTexture("Dirt",        all,                           "/blocks/dirt.png");
  await world.applyBlockTexture("Stone",       all,                           "/blocks/stone.png");
  await world.applyBlockTexture("Grass Block", ["px","pz","nx","nz"],         "/blocks/grass_side.png");
  await world.applyBlockTexture("Grass Block", "py",                          "/blocks/grass_top.png");
  await world.applyBlockTexture("Grass Block", "ny",                          "/blocks/dirt.png");
  await world.applyBlockTexture("Brick",       all,                           "/blocks/brick.png");
  await world.applyBlockTexture("Glass",       all,                           "/blocks/glass.png");
  await world.applyBlockTexture("Wood",        all,                           "/blocks/wood.png");
  await world.applyBlockTexture("Dark Stone",  all,                           "/blocks/dark_stone.png");
  await world.applyBlockTexture("Cobblestone", all,                           "/blocks/cobblestone.png");
}

start();
