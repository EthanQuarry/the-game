import * as VOXELIZE from "@voxelize/core";
import "@voxelize/core/dist/styles.css";
import * as THREE from "three";

import "./style.css";

const canvas = document.getElementById("canvas");

const world = new VOXELIZE.World({
  textureUnitDimension: 16,
});

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  3000
);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance",
  canvas,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;


window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const network = new VOXELIZE.Network();
network.register(world);

const inputs = new VOXELIZE.Inputs();
inputs.setNamespace("menu");

const rigidControls = new VOXELIZE.RigidControls(
  camera,
  renderer.domElement,
  world,
  {
    initialPosition: [0, 80, 0],
  }
);
rigidControls.connect(inputs, "in-game");
network.register(rigidControls);

const perspectives = new VOXELIZE.Perspective(rigidControls, world);
perspectives.connect(inputs, "in-game");

const shadows = new VOXELIZE.Shadows(world);
const lightShined = new VOXELIZE.LightShined(world);

function createCharacter() {
  const character = new VOXELIZE.Character();
  world.add(character);
  lightShined.add(character);
  shadows.add(character);
  return character;
}

const mainCharacter = createCharacter();
rigidControls.attachCharacter(mainCharacter);

// ── NPC system ────────────────────────────────────────────────────────────────
// Set to true to enable LLM-driven NPCs (requires Rust server on port 4001
// with AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION set).
// See README.md for setup instructions.
const NPC_LLM_ENABLED = false;

const NPC_API = "http://localhost:4001";

// Generate a stable random player ID for this session
const playerId = Math.random().toString(36).slice(2, 10);
const playerName = "Player" + playerId.slice(0, 4);

// ── A* pathfinding ────────────────────────────────────────────────────────────

function astar(startX, startZ, goalX, goalZ) {
  const MAX_DIST = 30;
  if (Math.abs(goalX - startX) + Math.abs(goalZ - startZ) > MAX_DIST * 2) return [];

  const key = (x, z) => `${x},${z}`;
  const open = new Map();
  const closed = new Set();
  const cameFrom = new Map();
  const gScore = new Map();
  const fScore = new Map();

  const sx = Math.round(startX), sz = Math.round(startZ);
  const gx = Math.round(goalX),  gz = Math.round(goalZ);

  const h = (x, z) => Math.abs(x - gx) + Math.abs(z - gz);

  gScore.set(key(sx, sz), 0);
  fScore.set(key(sx, sz), h(sx, sz));
  open.set(key(sx, sz), { x: sx, z: sz });

  let iters = 0;
  while (open.size > 0 && iters++ < 800) {
    // Pick lowest fScore from open
    let best = null, bestF = Infinity;
    for (const [k, node] of open) {
      const f = fScore.get(k) ?? Infinity;
      if (f < bestF) { bestF = f; best = { k, node }; }
    }
    if (!best) break;

    const { k: currKey, node: curr } = best;
    if (curr.x === gx && curr.z === gz) {
      // Reconstruct path
      const path = [];
      let c = currKey;
      while (cameFrom.has(c)) {
        const [cx, cz] = c.split(",").map(Number);
        path.unshift([cx, cz]);
        c = cameFrom.get(c);
      }
      return path;
    }

    open.delete(currKey);
    closed.add(currKey);

    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = curr.x + dx, nz = curr.z + dz;
      const nk = key(nx, nz);
      if (closed.has(nk)) continue;
      if (Math.abs(nx - sx) + Math.abs(nz - sz) > MAX_DIST) continue;

      // Obstacle check: solid block at foot or head height
      const blocked = world.isInitialized && (
        world.getVoxelAt(nx, 13, nz) !== 0 ||
        world.getVoxelAt(nx, 14, nz) !== 0
      );
      if (blocked) continue;

      const tentG = (gScore.get(currKey) ?? Infinity) + 1;
      if (tentG < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, currKey);
        gScore.set(nk, tentG);
        fScore.set(nk, tentG + h(nx, nz));
        open.set(nk, { x: nx, z: nz });
      }
    }
  }
  return []; // no path
}

// ── NPC state ─────────────────────────────────────────────────────────────────

const npcs = new Map(); // npc_id → { character, waypoints, path, targetPos, speechBubble, bubbleTimeout }

const THOMAS_WAYPOINTS = {
  market:  [12, 13, 12],
  well:    [28, 13, 12],
  shelter: [12, 13, 28],
  road:    [8,  13, 8],
};

function createNpc(id, name, spawnPos) {
  const character = createCharacter();
  character.username = name;

  // Position NPC at spawn
  character.set(spawnPos, [0, 0, 1]);
  character.update();

  // Speech bubble DOM element
  const bubble = document.createElement("div");
  bubble.className = "speech-bubble hidden";
  bubble.innerHTML = `<div class="npc-name">${name}</div><div class="bubble-text"></div>`;
  document.body.appendChild(bubble);

  npcs.set(id, {
    character,
    id,
    name,
    pos: new THREE.Vector3(...spawnPos),
    targetPos: new THREE.Vector3(...spawnPos),
    path: [],
    pathIndex: 0,
    speechBubble: bubble,
    bubbleTimeout: null,
    lastSpeech: null,
    actionType: "patrol",
  });
  return npcs.get(id);
}

// Create Thomas
createNpc("thomas", "Thomas", [12, 13, 12]);

// ── NPC movement & animation ──────────────────────────────────────────────────

const NPC_WALK_SPEED = 0.06; // blocks per frame

function updateNpcMovement(npcState, dt) {
  const { character, path, pos, targetPos } = npcState;

  if (path.length > 0 && npcState.pathIndex < path.length) {
    const [wx, wz] = path[npcState.pathIndex];
    const wy = 13;
    const dx = wx - pos.x;
    const dz = wz - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 0.15) {
      npcState.pathIndex++;
    } else {
      const step = Math.min(NPC_WALK_SPEED, dist);
      pos.x += (dx / dist) * step;
      pos.z += (dz / dist) * step;
      pos.y = wy;
      character.set([pos.x, pos.y, pos.z], [dx / dist, 0, dz / dist]);
    }
  } else {
    // Idle: face a neutral direction
    character.set([pos.x, pos.y, pos.z], [0, 0, 1]);
  }

  character.update();
}

// ── Speech bubbles ─────────────────────────────────────────────────────────────

function showSpeechBubble(npcState, text) {
  const { speechBubble } = npcState;
  speechBubble.querySelector(".bubble-text").textContent = text;
  speechBubble.classList.remove("hidden", "fading");

  clearTimeout(npcState.bubbleTimeout);
  npcState.bubbleTimeout = setTimeout(() => {
    speechBubble.classList.add("fading");
    setTimeout(() => speechBubble.classList.add("hidden"), 600);
  }, 6000);
}

function updateBubblePosition(npcState) {
  const { speechBubble, pos } = npcState;
  if (speechBubble.classList.contains("hidden")) return;

  const worldPos = new THREE.Vector3(pos.x, pos.y + 2.2, pos.z);
  worldPos.project(camera);

  if (worldPos.z > 1) { // behind camera
    speechBubble.style.display = "none";
    return;
  }
  speechBubble.style.display = "";
  const sx = ( worldPos.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-worldPos.y * 0.5 + 0.5) * window.innerHeight;
  speechBubble.style.left = sx + "px";
  speechBubble.style.top  = sy + "px";
}

// ── NPC state broadcast (SSE) ─────────────────────────────────────────────────

let npcEventSource = null;

function connectNpcEvents() {
  if (npcEventSource) npcEventSource.close();
  npcEventSource = new EventSource(`${NPC_API}/npc-events`);

  npcEventSource.onmessage = (e) => {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }

    const npcState = npcs.get(data.npc_id);
    if (!npcState) return;

    npcState.actionType = data.action_type;

    // Handle movement
    if (data.action_type === "move_to_waypoint" && data.waypoint) {
      const wp = THOMAS_WAYPOINTS[data.waypoint];
      if (wp) {
        const [tx, , tz] = wp;
        const newPath = astar(npcState.pos.x, npcState.pos.z, tx, tz);
        if (newPath.length > 0) {
          npcState.path = newPath;
          npcState.pathIndex = 0;
        }
      }
    } else if (data.action_type === "move_toward" && data.speech_target) {
      // Move toward a specific player
      const targetPlayer = getPlayerPos(data.speech_target);
      if (targetPlayer) {
        const newPath = astar(npcState.pos.x, npcState.pos.z, targetPlayer[0], targetPlayer[2]);
        if (newPath.length > 0) {
          npcState.path = newPath;
          npcState.pathIndex = 0;
        }
      }
    } else if (data.action_type === "move_away") {
      // Stop current path, handled by idle
      npcState.path = [];
      npcState.pathIndex = 0;
    } else if (data.action_type === "idle" || data.action_type === "patrol") {
      // On patrol: cycle through waypoints client-side if no specific move command
      if (data.action_type === "patrol" && npcState.path.length === 0) {
        const wps = Object.values(THOMAS_WAYPOINTS);
        const idx = Math.floor(Math.random() * wps.length);
        const [tx, , tz] = wps[idx];
        const newPath = astar(npcState.pos.x, npcState.pos.z, tx, tz);
        if (newPath.length > 0) { npcState.path = newPath; npcState.pathIndex = 0; }
      }
    }

    // Handle speech
    if (data.action_type === "speak" && data.speech) {
      showSpeechBubble(npcState, data.speech);
      npcState.lastSpeech = data.speech;

      // If dialog is open for this NPC, update it
      if (activeNpcDialog === data.npc_id) {
        const dialogText = document.getElementById("dialog-text");
        dialogText.textContent = data.speech;
        dialogText.classList.remove("thinking");
      }
    }
  };

  npcEventSource.onerror = () => {
    // Reconnect after 3s
    setTimeout(connectNpcEvents, 3000);
  };
}

// Track player positions for move_toward
const playerPositions = new Map(); // player_id → [x, y, z]

function getPlayerPos(playerId) {
  if (playerId === playerId) {
    const p = rigidControls.position;
    return [p.x, p.y, p.z];
  }
  return playerPositions.get(playerId) || null;
}

// ── Player position reporting ─────────────────────────────────────────────────

let playerUpdateTimer = 0;

function reportPlayerPosition() {
  if (!NPC_LLM_ENABLED || !world.isInitialized) return;
  const p = rigidControls.position;
  fetch(`${NPC_API}/player-update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: playerId, name: playerName, pos: [p.x, p.y, p.z] }),
  }).catch(() => {});
}

window.addEventListener("beforeunload", () => {
  if (!NPC_LLM_ENABLED) return;
  fetch(`${NPC_API}/player-leave`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: playerId }),
  }).catch(() => {});
});

// ── Dialog (press E) ──────────────────────────────────────────────────────────

let activeNpcDialog = null; // npc_id currently in dialog
const dialogEl = document.getElementById("dialog");
const dialogName = document.getElementById("dialog-name");
const dialogText = document.getElementById("dialog-text");
const dialogInput = document.getElementById("dialog-input");

function openDialog(npcId) {
  const npcState = npcs.get(npcId);
  if (!npcState) return;
  activeNpcDialog = npcId;
  dialogName.textContent = npcState.name;
  dialogText.textContent = npcState.lastSpeech || "...";
  dialogText.classList.remove("thinking");
  dialogInput.value = "";
  dialogEl.classList.remove("hidden");
  // Release pointer lock so player can type
  document.exitPointerLock();
  rigidControls.isLocked = false;
  inputs.setNamespace("menu");
  setTimeout(() => dialogInput.focus(), 50);
}

function closeDialog() {
  activeNpcDialog = null;
  dialogEl.classList.add("hidden");
  dialogInput.value = "";
}

function sendDialogMessage() {
  const msg = dialogInput.value.trim();
  if (!msg || !activeNpcDialog) return;
  dialogInput.value = "";

  if (!NPC_LLM_ENABLED) {
    dialogText.textContent = "(LLM disabled — set NPC_LLM_ENABLED = true in main.js)";
    return;
  }

  dialogText.textContent = "...";
  dialogText.classList.add("thinking");

  fetch(`${NPC_API}/npc-message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      npc_id: activeNpcDialog,
      player_id: playerId,
      player_name: playerName,
      message: msg,
    }),
  }).catch(() => {
    dialogText.textContent = "(couldn't reach server)";
    dialogText.classList.remove("thinking");
  });
}

dialogInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); sendDialogMessage(); }
  if (e.key === "Escape") { closeDialog(); }
});

// E key: open dialog with nearest NPC if within range
inputs.bind("KeyE", () => {
  if (activeNpcDialog) { closeDialog(); return; }
  const playerPos = rigidControls.position;
  let nearest = null, nearestDist = Infinity;
  for (const [id, npcState] of npcs) {
    const dx = npcState.pos.x - playerPos.x;
    const dz = npcState.pos.z - playerPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 4 && dist < nearestDist) { nearest = id; nearestDist = dist; }
  }
  if (nearest) openDialog(nearest);
}, "in-game");

// Close dialog if player walks away
function checkDialogDistance() {
  if (!activeNpcDialog) return;
  const npcState = npcs.get(activeNpcDialog);
  if (!npcState) { closeDialog(); return; }
  const playerPos = rigidControls.position;
  const dx = npcState.pos.x - playerPos.x;
  const dz = npcState.pos.z - playerPos.z;
  if (Math.sqrt(dx * dx + dz * dz) > 6) closeDialog();
}

const debug = new VOXELIZE.Debug(document.body);
debug.registerDisplay("Position", rigidControls, "voxel");
debug.registerDisplay("Render radius", world, "renderRadius");
debug.registerDisplay("Chunks loaded", () => world.chunkPipeline?.loadedCount ?? world.chunks?.size ?? "?");
debug.registerDisplay("Chunks processing", () => world.chunkPipeline?.processingCount ?? "?");

inputs.bind("KeyG", rigidControls.toggleGhostMode, "in-game");
inputs.bind("KeyF", rigidControls.toggleFly, "in-game");
inputs.bind("KeyJ", debug.toggle, "*");

rigidControls.on("lock", () => inputs.setNamespace("in-game"));
rigidControls.on("unlock", () => inputs.setNamespace("menu"));

const overlay = document.getElementById("overlay");

canvas.addEventListener("click", () => {
  overlay.classList.add("hidden");
  rigidControls.isLocked = true;
  inputs.setNamespace("in-game");
  canvas.requestPointerLock();
});

// Escape key shows overlay and pauses
inputs.bind("Escape", () => {
  rigidControls.isLocked = false;
  inputs.setNamespace("menu");
  overlay.classList.remove("hidden");
  document.exitPointerLock();
}, "in-game", { occasion: "keydown" });

// ── Drag-to-look fallback (works without pointer lock) ────────────────────────
// Mirrors RigidControls.onMouseMove exactly: mutates rigidControls.euler and
// rigidControls.quaternion directly so the internal update loop picks it up.
const PI_2 = Math.PI / 2;
const euler = new THREE.Euler(0, 0, 0, "YXZ");
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;

canvas.addEventListener("mousedown", (e) => {
  if (!rigidControls.isLocked) return;
  // Only activate drag fallback when pointer lock is NOT active
  if (document.pointerLockElement === canvas) return;
  isDragging = true;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
});

document.addEventListener("mouseup", () => { isDragging = false; });

document.addEventListener("mousemove", (e) => {
  // If pointer lock is active, RigidControls handles it natively
  if (document.pointerLockElement === canvas) return;
  if (!isDragging || !rigidControls.isLocked) return;

  const dx = e.clientX - lastMouseX;
  const dy = e.clientY - lastMouseY;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;

  const sensitivity = 0.002;
  euler.setFromQuaternion(rigidControls.quaternion);
  euler.y -= dx * sensitivity;
  euler.x -= dy * sensitivity;
  euler.x = Math.max(PI_2 - Math.PI * 0.99, Math.min(PI_2 - Math.PI * 0.01, euler.x));
  rigidControls.quaternion.setFromEuler(euler);
});

const fpsEl = document.createElement("div");
fpsEl.id = "fps";
document.body.appendChild(fpsEl);

let frameCount = 0;
let lastFpsTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  if (world.isInitialized) {
    world.update(
      camera.getWorldPosition(new THREE.Vector3()),
      camera.getWorldDirection(new THREE.Vector3())
    );
    rigidControls.update();
    perspectives.update();
    lightShined.update();
    shadows.update();
    debug.update();

    // Update all NPCs
    for (const npcState of npcs.values()) {
      updateNpcMovement(npcState);
      updateBubblePosition(npcState);
    }
    checkDialogDistance();

    // Report player position to server every ~500ms
    playerUpdateTimer += 16;
    if (playerUpdateTimer >= 500) {
      playerUpdateTimer = 0;
      reportPlayerPosition();
    }
  }

  renderer.render(world, camera);

  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 500) {
    fpsEl.textContent = `${Math.round(frameCount * 1000 / (now - lastFpsTime))} fps`;
    frameCount = 0;
    lastFpsTime = now;
  }
}

async function start() {
  animate();

  await network.connect("http://localhost:4000");
  await network.join("tutorial");

  await world.initialize();
  world.renderRadius = 16;

  if (NPC_LLM_ENABLED) connectNpcEvents();

  // Float in place until chunk [0,0] is ready, then land on the road
  rigidControls.toggleGhostMode();
  world.addChunkInitListener([0, 0], () => {
    rigidControls.teleportToTop(8, 8);
    if (rigidControls.ghostMode) rigidControls.toggleGhostMode();
  });

  world.sky.setShadingPhases([
    {
      name: "daylight",
      color: {
        top: new THREE.Color("#1a6fd4"),
        middle: new THREE.Color("#5aaaf0"),
        bottom: new THREE.Color("#8dc8ff"),
      },
      skyOffset: 0,
      voidOffset: 0.5,
      start: 0.0,
    },
  ]);

  world.sky.paint("bottom", VOXELIZE.artFunctions.drawSun());
  world.sky.paint("top", VOXELIZE.artFunctions.drawStars());
  world.sky.paint("top", VOXELIZE.artFunctions.drawMoon());
  world.sky.paint("sides", VOXELIZE.artFunctions.drawStars());

  const allFaces = ["px", "nx", "py", "ny", "pz", "nz"];
  await world.applyBlockTexture("Dirt", allFaces, "/blocks/dirt.png");
  await world.applyBlockTexture("Stone", allFaces, "/blocks/stone.png");
  await world.applyBlockTexture(
    "Grass Block",
    ["px", "pz", "nx", "nz"],
    "/blocks/grass_side.png"
  );
  await world.applyBlockTexture("Grass Block", "py", "/blocks/grass_top.png");
  await world.applyBlockTexture("Grass Block", "ny", "/blocks/dirt.png");
  await world.applyBlockTexture("Brick", allFaces, "/blocks/brick.png");
  await world.applyBlockTexture("Glass", allFaces, "/blocks/glass.png");
  await world.applyBlockTexture("Wood", allFaces, "/blocks/wood.png");
  await world.applyBlockTexture("Dark Stone", allFaces, "/blocks/dark_stone.png");
  await world.applyBlockTexture("Cobblestone", allFaces, "/blocks/cobblestone.png");
}

start();
