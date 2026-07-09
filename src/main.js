import * as VOXELIZE from "@voxelize/core";
import "@voxelize/core/dist/styles.css";
import * as THREE from "three";
import "./style.css";
import {
  initHotbar, initPickupTooltip,
  updateInventory, tryPickup, tryDrop,
  addItem, refreshHotbar, getSlot, setFocusedSlot, getFocusedSlot,
  spawnGroundItem, groundItems, ITEM_DEFS,
} from "./inventory.js";
import {
  playPistolShot, playShotgunShot, playEmptyClick, playReload, playDistantShot,
  startAmbience, updateAtmosphere, playFootstep,
} from "./audio.js";

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
  airJumps: 1,
  alwaysSprint: true,      // Apex-style: always running at sprint speed when moving
  sprintFactor: 1.6,       // 60% faster than base
  maxSpeed: 8,
});
controls.connect(inputs, "in-game");

// C = crouch; Shift = slide only (neutralise Shift's built-in crouch side-effect)
inputs.bind("KeyC",      () => { controls.movements.down = true;  }, "in-game", { occasion: "keydown", identifier: "crouch-down"    });
inputs.bind("KeyC",      () => { controls.movements.down = false; }, "in-game", { occasion: "keyup",   identifier: "crouch-up"      });
inputs.bind("ShiftLeft", () => { controls.movements.down = false; }, "in-game", { occasion: "keydown", identifier: "shift-no-crouch" });

network.register(controls);

const perspective = new VOXELIZE.Perspective(controls, world, {
  maxDistance: 6,   // how far back 3rd-person camera sits
  lerpFactor: 0.12, // smooth transition
});
// Don't call perspective.connect — it binds KeyC (now crouch) and adds "second" state.
// We manually bind V to toggle between first ↔ third only.
inputs.bind("KeyV", () => {
  // Toggle between first and third only, skip "second"
  perspective.state = perspective.state === "first" ? "third" : "first";
  const isFirst = perspective.state === "first";
  // Show/hide gun and hand based on perspective
  if (currentWeaponKey) gunGroups[currentWeaponKey].visible = isFirst;
  fpHand.visible = isFirst && !currentWeaponKey;
  // Re-request pointer lock so mouse look keeps working
  if (!document.pointerLockElement) {
    canvas.requestPointerLock();
  }
}, "in-game", { identifier: "perspective-toggle" });

// ── Peers (multiplayer characters) ───────────────────────────────────────────

const shadows    = new VOXELIZE.Shadows(world);
const lightShined = new VOXELIZE.LightShined(world);

// ── Character skins ───────────────────────────────────────────────────────────

const S = 0.9; // CHARACTER_SCALE

// Slim proportions: narrower body/depth, taller legs, same arms
const SLIM_BODY = {
  width: 0.52 * S,
  depth: 0.28 * S,
  widthSegments: 16,
  heightSegments: 16,
};
const SLIM_ARMS = {
  width:  0.2  * S,
  height: 0.55 * S,
  depth:  0.2  * S,
  widthSegments: 8,
  heightSegments: 16,
  depthSegments: 8,
  shoulderGap:  0.03 * S,
  shoulderDrop: 0.22 * S,
};
const SLIM_LEGS = {
  width:  0.22 * S,
  height: 0.34 * S,
  depth:  0.22 * S,
  widthSegments: 6,
  heightSegments: 6,
  depthSegments: 6,
  betweenLegsGap: 0.12 * S,
};

const SKINS = {
  player: {
    opts: {
      head: { color: "#f5cba7", faceColor: "#f5cba7" },
      body: { ...SLIM_BODY, color: "#1565c0" },
      arms: { ...SLIM_ARMS, color: "#1565c0" },
      legs: { ...SLIM_LEGS, color: "#455a64" },
    },
    paint(c) {
      // Face detail
      c.head.paint("front", (ctx, cv) => {
        const w = cv.width, h = cv.height;
        ctx.fillStyle = "#f5cba7"; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#3d2b1f"; ctx.fillRect(0, 0, w, Math.ceil(h * 0.22)); // hair
        ctx.fillStyle = "#1a3a5c";
        ctx.fillRect(Math.floor(w*0.2), Math.floor(h*0.32), Math.floor(w*0.2), Math.floor(h*0.22)); // left eye
        ctx.fillRect(Math.floor(w*0.6), Math.floor(h*0.32), Math.floor(w*0.2), Math.floor(h*0.22)); // right eye
        ctx.fillStyle = "#c06060";
        ctx.fillRect(Math.floor(w*0.3), Math.floor(h*0.72), Math.floor(w*0.4), Math.floor(h*0.12)); // mouth
      });
      c.head.paint("top", (ctx, cv) => { ctx.fillStyle = "#3d2b1f"; ctx.fillRect(0,0,cv.width,cv.height); });
      // Shirt stripe detail on body front
      c.body.paint("front", (ctx, cv) => {
        const w = cv.width, h = cv.height;
        ctx.fillStyle = "#1565c0"; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#0d47a1";
        ctx.fillRect(Math.floor(w*0.45), 0, 2, h); // button line
        ctx.fillStyle = "#f5cba7";
        ctx.fillRect(Math.floor(w*0.35), 0, Math.floor(w*0.3), Math.floor(h*0.18)); // collar skin
      });
    },
  },
  thomas: {
    opts: {
      head: { color: "#c8956c", faceColor: "#c8956c" },
      body: { ...SLIM_BODY, color: "#3a3a3a" },
      arms: { ...SLIM_ARMS, color: "#3a3a3a" },
      legs: { ...SLIM_LEGS, color: "#1a237e" },
    },
    paint(c) {
      c.head.paint("front", (ctx, cv) => {
        const w = cv.width, h = cv.height;
        ctx.fillStyle = "#c8956c"; ctx.fillRect(0, 0, w, h);
        // Dark hair top
        ctx.fillStyle = "#2c1a0e"; ctx.fillRect(0, 0, w, Math.ceil(h * 0.25));
        // Stubble on lower face
        ctx.fillStyle = "#8b5e3c";
        ctx.fillRect(Math.floor(w*0.15), Math.floor(h*0.68), Math.floor(w*0.7), Math.floor(h*0.2));
        // Eyes
        ctx.fillStyle = "#1a1a2e";
        ctx.fillRect(Math.floor(w*0.2), Math.floor(h*0.32), Math.floor(w*0.18), Math.floor(h*0.2));
        ctx.fillRect(Math.floor(w*0.62), Math.floor(h*0.32), Math.floor(w*0.18), Math.floor(h*0.2));
      });
      c.head.paint("top", (ctx, cv) => { ctx.fillStyle = "#2c1a0e"; ctx.fillRect(0,0,cv.width,cv.height); });
      // Hoodie front — dark grey with kangaroo pocket
      c.body.paint("front", (ctx, cv) => {
        const w = cv.width, h = cv.height;
        ctx.fillStyle = "#3a3a3a"; ctx.fillRect(0, 0, w, h);
        // Pocket rectangle lower half
        ctx.fillStyle = "#2a2a2a";
        ctx.fillRect(Math.floor(w*0.2), Math.floor(h*0.55), Math.floor(w*0.6), Math.floor(h*0.38));
        // Hood collar at top
        ctx.fillStyle = "#c8956c";
        ctx.fillRect(Math.floor(w*0.38), 0, Math.floor(w*0.24), Math.floor(h*0.2));
        // Zipper line
        ctx.fillStyle = "#555";
        ctx.fillRect(Math.floor(w*0.48), Math.floor(h*0.18), 1, Math.floor(h*0.37));
      });
      // Orange YC logo on back
      c.body.paint("back", (ctx, cv) => {
        const w = cv.width, h = cv.height;
        ctx.fillStyle = "#3a3a3a"; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#ff6600";
        // "YC" pixel block
        ctx.fillRect(Math.floor(w*0.3), Math.floor(h*0.25), Math.floor(w*0.4), Math.floor(h*0.45));
        ctx.fillStyle = "#3a3a3a";
        ctx.fillRect(Math.floor(w*0.38), Math.floor(h*0.32), Math.floor(w*0.24), Math.floor(h*0.18)); // cut-out
      });
      // Arm cuffs
      c.leftArm.paint("all",  (ctx, cv) => { ctx.fillStyle = "#3a3a3a"; ctx.fillRect(0,0,cv.width,cv.height); });
      c.rightArm.paint("all", (ctx, cv) => { ctx.fillStyle = "#3a3a3a"; ctx.fillRect(0,0,cv.width,cv.height); });
      c.leftArm.paint("bottom",  (ctx, cv) => { ctx.fillStyle = "#c8956c"; ctx.fillRect(0,0,cv.width,cv.height); });
      c.rightArm.paint("bottom", (ctx, cv) => { ctx.fillStyle = "#c8956c"; ctx.fillRect(0,0,cv.width,cv.height); });
      // Jeans with knee highlight
      c.leftLeg.paint("all",  (ctx, cv) => { ctx.fillStyle = "#1a237e"; ctx.fillRect(0,0,cv.width,cv.height); });
      c.rightLeg.paint("all", (ctx, cv) => { ctx.fillStyle = "#1a237e"; ctx.fillRect(0,0,cv.width,cv.height); });
      c.leftLeg.paint("bottom",  (ctx, cv) => { ctx.fillStyle = "#111"; ctx.fillRect(0,0,cv.width,cv.height); }); // shoe
      c.rightLeg.paint("bottom", (ctx, cv) => { ctx.fillStyle = "#111"; ctx.fillRect(0,0,cv.width,cv.height); });
    },
  },
  // Marcus — cold, calculating, dark skin, black jacket
  marcus: {
    opts: {
      head: { color: "#3d1a08", faceColor: "#3d1a08" },
      body: { ...SLIM_BODY, color: "#1a1a1a" },
      arms: { ...SLIM_ARMS, color: "#1a1a1a" },
      legs: { ...SLIM_LEGS, color: "#111111" },
    },
    paint(c) {
      c.head.paint("front", (ctx, cv) => {
        const w = cv.width, h = cv.height;
        ctx.fillStyle = "#3d1a08"; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#1a0a02"; ctx.fillRect(0, 0, w, Math.ceil(h * 0.2)); // close-cropped hair
        ctx.fillStyle = "#0d0d0d";
        ctx.fillRect(Math.floor(w*0.18), Math.floor(h*0.32), Math.floor(w*0.2), Math.floor(h*0.2));
        ctx.fillRect(Math.floor(w*0.62), Math.floor(h*0.32), Math.floor(w*0.2), Math.floor(h*0.2));
        // Flat expression
        ctx.fillStyle = "#2a0e04";
        ctx.fillRect(Math.floor(w*0.32), Math.floor(h*0.72), Math.floor(w*0.36), Math.floor(h*0.08));
      });
      c.head.paint("top", (ctx, cv) => { ctx.fillStyle = "#1a0a02"; ctx.fillRect(0,0,cv.width,cv.height); });
      c.body.paint("front", (ctx, cv) => {
        const w = cv.width, h = cv.height;
        ctx.fillStyle = "#1a1a1a"; ctx.fillRect(0, 0, w, h);
        // Jacket lapels
        ctx.fillStyle = "#2a2a2a";
        ctx.fillRect(Math.floor(w*0.3), 0, Math.floor(w*0.18), Math.floor(h*0.5));
        ctx.fillRect(Math.floor(w*0.52), 0, Math.floor(w*0.18), Math.floor(h*0.5));
        // White shirt underneath
        ctx.fillStyle = "#ddd";
        ctx.fillRect(Math.floor(w*0.42), Math.floor(h*0.05), Math.floor(w*0.16), Math.floor(h*0.4));
      });
    },
  },

  // Diane — tired mid-50s, olive skin, apron colours
  diane: {
    opts: {
      head: { color: "#c8956c", faceColor: "#c8956c" },
      body: { ...SLIM_BODY, color: "#4a3728" },
      arms: { ...SLIM_ARMS, color: "#4a3728" },
      legs: { ...SLIM_LEGS, color: "#2e2010" },
    },
    paint(c) {
      c.head.paint("front", (ctx, cv) => {
        const w = cv.width, h = cv.height;
        ctx.fillStyle = "#c8956c"; ctx.fillRect(0, 0, w, h);
        // Greying hair
        ctx.fillStyle = "#6b5a4e"; ctx.fillRect(0, 0, w, Math.ceil(h * 0.28));
        ctx.fillStyle = "#888"; // grey streaks
        ctx.fillRect(Math.floor(w*0.2), 0, 2, Math.ceil(h*0.28));
        ctx.fillRect(Math.floor(w*0.7), 0, 2, Math.ceil(h*0.28));
        ctx.fillStyle = "#5a3020";
        ctx.fillRect(Math.floor(w*0.2), Math.floor(h*0.32), Math.floor(w*0.18), Math.floor(h*0.18));
        ctx.fillRect(Math.floor(w*0.62), Math.floor(h*0.32), Math.floor(w*0.18), Math.floor(h*0.18));
        // Tired lines under eyes
        ctx.fillStyle = "#a06040";
        ctx.fillRect(Math.floor(w*0.18), Math.floor(h*0.5), Math.floor(w*0.22), 1);
        ctx.fillRect(Math.floor(w*0.6), Math.floor(h*0.5), Math.floor(w*0.22), 1);
        ctx.fillStyle = "#8b4513";
        ctx.fillRect(Math.floor(w*0.28), Math.floor(h*0.7), Math.floor(w*0.44), Math.floor(h*0.1));
      });
      c.head.paint("top", (ctx, cv) => { ctx.fillStyle = "#6b5a4e"; ctx.fillRect(0,0,cv.width,cv.height); });
      c.body.paint("front", (ctx, cv) => {
        const w = cv.width, h = cv.height;
        ctx.fillStyle = "#4a3728"; ctx.fillRect(0, 0, w, h);
        // Apron straps over shirt
        ctx.fillStyle = "#8b6914";
        ctx.fillRect(Math.floor(w*0.3), 0, Math.floor(w*0.12), h);
        ctx.fillRect(Math.floor(w*0.58), 0, Math.floor(w*0.12), h);
      });
    },
  },

  // Chad — VC bro, Patagonia vest over white shirt, beige chinos
  chad: {
    opts: {
      head: { color: "#f0c899", faceColor: "#f0c899" },
      body: { ...SLIM_BODY, color: "#5b8a5b" }, // Patagonia vest green
      arms: { ...SLIM_ARMS, color: "#ffffff" }, // white shirt sleeves
      legs: { ...SLIM_LEGS, color: "#d4b896" }, // beige chinos
    },
    paint(c) {
      c.head.paint("front", (ctx, cv) => {
        const w = cv.width, h = cv.height;
        ctx.fillStyle = "#f0c899"; ctx.fillRect(0, 0, w, h);
        // Perfectly styled brown hair
        ctx.fillStyle = "#8b5e3c"; ctx.fillRect(0, 0, w, Math.ceil(h * 0.24));
        // Clean shave, wide smile
        ctx.fillStyle = "#c8956c";
        ctx.fillRect(Math.floor(w*0.22), Math.floor(h*0.32), Math.floor(w*0.16), Math.floor(h*0.18));
        ctx.fillRect(Math.floor(w*0.62), Math.floor(h*0.32), Math.floor(w*0.16), Math.floor(h*0.18));
        // Big confident smile
        ctx.fillStyle = "#fff";
        ctx.fillRect(Math.floor(w*0.25), Math.floor(h*0.68), Math.floor(w*0.5), Math.floor(h*0.1));
        ctx.fillStyle = "#c8956c";
        ctx.fillRect(Math.floor(w*0.25), Math.floor(h*0.66), Math.floor(w*0.5), Math.floor(h*0.04));
      });
      c.head.paint("top", (ctx, cv) => { ctx.fillStyle = "#8b5e3c"; ctx.fillRect(0,0,cv.width,cv.height); });
      // Patagonia vest (green) over white shirt — vest has no sleeves so body only
      c.body.paint("front", (ctx, cv) => {
        const w = cv.width, h = cv.height;
        ctx.fillStyle = "#5b8a5b"; ctx.fillRect(0, 0, w, h); // vest
        // White shirt collar peeking out
        ctx.fillStyle = "#fff";
        ctx.fillRect(Math.floor(w*0.36), 0, Math.floor(w*0.28), Math.floor(h*0.22));
        // Vest zip line
        ctx.fillStyle = "#4a7a4a";
        ctx.fillRect(Math.floor(w*0.48), 0, 1, h);
      });
    },
  },

  homeless: {
    opts: {
      head: { color: "#8d5524", faceColor: "#8d5524" },
      body: { ...SLIM_BODY, color: "#6d4c41" },
      arms: { ...SLIM_ARMS, color: "#6d4c41" },
      legs: { ...SLIM_LEGS, color: "#546e7a" },
    },
    paint(c) {
      c.head.paint("front", (ctx, cv) => {
        const w = cv.width, h = cv.height;
        ctx.fillStyle = "#8d5524"; ctx.fillRect(0, 0, w, h);
        // Messy dark hair
        ctx.fillStyle = "#2c1810"; ctx.fillRect(0, 0, w, Math.ceil(h * 0.3));
        ctx.fillRect(0, 0, Math.ceil(w*0.12), Math.ceil(h*0.5)); // side hair
        ctx.fillRect(w - Math.ceil(w*0.12), 0, Math.ceil(w*0.12), Math.ceil(h*0.5));
        // Tired eyes
        ctx.fillStyle = "#2c1810";
        ctx.fillRect(Math.floor(w*0.18), Math.floor(h*0.33), Math.floor(w*0.2), Math.floor(h*0.18));
        ctx.fillRect(Math.floor(w*0.62), Math.floor(h*0.33), Math.floor(w*0.2), Math.floor(h*0.18));
        // Beard scruff
        ctx.fillStyle = "#5c3317";
        ctx.fillRect(Math.floor(w*0.1), Math.floor(h*0.6), Math.floor(w*0.8), Math.floor(h*0.28));
      });
      c.body.paint("front", (ctx, cv) => {
        const w = cv.width, h = cv.height;
        ctx.fillStyle = "#6d4c41"; ctx.fillRect(0, 0, w, h);
        // Worn jacket wrinkle lines
        ctx.fillStyle = "#4e342e";
        ctx.fillRect(Math.floor(w*0.45), Math.floor(h*0.1), 1, Math.floor(h*0.8));
        ctx.fillRect(Math.floor(w*0.2), Math.floor(h*0.4), Math.floor(w*0.25), 1);
        ctx.fillRect(Math.floor(w*0.55), Math.floor(h*0.55), Math.floor(w*0.25), 1);
      });
    },
  },
};

function paintSkin(c, skin) {
  if (skin && skin.paint) {
    skin.paint(c);
    // Force texture uploads
    [c.head, c.body, c.leftArm, c.rightArm, c.leftLeg, c.rightLeg].forEach(part => {
      part.traverse(o => {
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
            m.needsUpdate = true;
            if (m.map) m.map.needsUpdate = true;
          });
        }
      });
    });
  }
}

// Characters queued for skin painting after world.initialize()
const skinQueue = [];

function makeCharacter(skinName) {
  const skin = SKINS[skinName];
  const opts = skin ? skin.opts : {};
  const c = new VOXELIZE.Character(opts);
  world.add(c);
  lightShined.add(c);
  shadows.add(c);
  if (skin) {
    if (world.isInitialized) {
      // World already ready — paint immediately
      paintSkin(c, skin);
      c.visible = true;
    } else {
      // Queue for after world.initialize()
      c.visible = false;
      skinQueue.push({ c, skin });
    }
  }
  return c;
}

const PLAYER_SKINS = ["player", "thomas", "marcus", "diane", "chad", "homeless"];
function randomSkin() { return PLAYER_SKINS[Math.floor(Math.random() * PLAYER_SKINS.length)]; }

const mainCharacter = makeCharacter(randomSkin());
controls.attachCharacter(mainCharacter);

class GamePeers extends VOXELIZE.Peers {
  constructor(object) { super(object); }
  createPeer = () => makeCharacter(randomSkin());
  onPeerUpdate = (peer, rawData, { username } = {}) => {
    const data = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
    peer.set(data.position, data.direction);
    if (username && peer.username !== username) peer.username = username;
  };
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

// ── Voxelize Events (custom client↔server messaging) ─────────────────────────
const events = new VOXELIZE.Events();
network.register(events);

// ── NPC system ────────────────────────────────────────────────────────────────

const NPC_LLM_ENABLED = true;
// Auto-detect server so it works locally (http) and on deployed domains (https)
const _host = window.location.hostname;
const _https = window.location.protocol === 'https:';
const VOXELIZE_SERVER = _https ? window.location.origin : `http://${_host}:4000`;
const NPC_API         = _https ? `${window.location.origin}/npc` : `http://${_host}:4001`;

// ── NPC Trust / Reputation ────────────────────────────────────────────────────

const npcTrust = { thomas: 30, marcus: 30, diane: 30, ray: 30, chad: 50 };

function modifyTrust(npcId, delta) {
  npcTrust[npcId] = Math.max(0, Math.min(100, (npcTrust[npcId] || 30) + delta));
}

// ─────────────────────────────────────────────────────────────────────────────

const playerId = Math.random().toString(36).slice(2, 10);
const RANDOM_NAMES = ["Ghost","Viper","Rook","Cipher","Shade","Wraith","Drifter","Nomad","Patch","Static","Flint","Sable","Echo","Sparrow","Jinx"];
function randomName() { return RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)] + Math.floor(Math.random() * 99 + 1); }
let playerName = randomName();

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
      // Blocked if a building/wall exists above the road/ground layer (roads top at y=13)
      const blocked = !world.isInitialized || world.getMaxHeightAt(nx, nz) > 13;
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

const npcs = new Map();

// ── Atmosphere state ──────────────────────────────────────────────────────────
let lastCombatTime = 0;           // performance.now() of last shot/hit — drives vignette
let _footstepTimer = 0;           // accumulates dt between steps
const FOOTSTEP_INTERVAL = 0.48;   // seconds between steps at full sprint speed

// Per-NPC accent colors for radar blips + dialog portraits
const NPC_COLORS = {
  thomas: { bg: "#d4820a", text: "#fff" },   // amber
  marcus: { bg: "#b71c1c", text: "#fff" },   // deep red
  diane:  { bg: "#00796b", text: "#fff" },   // teal
  ray:    { bg: "#f9a825", text: "#000" },   // yellow
  chad:   { bg: "#e65100", text: "#fff" },   // orange
};

function createNpc(id, name, spawnPos, skinName) {
  const character = makeCharacter(skinName || "homeless");
  character.username = name;
  character.set(spawnPos, [0, 0, 1]);
  character.update();

  const bubble = document.createElement("div");
  bubble.className = "speech-bubble hidden";
  bubble.innerHTML = `<div class="npc-name">${name}</div><div class="bubble-text"></div>`;
  document.body.appendChild(bubble);

  // HP bar — same style as peer hp bars
  const hpBar = document.createElement("div");
  hpBar.className = "npc-hpbar";
  hpBar.innerHTML = `<div class="npc-hpbar-name">${name}</div><div class="npc-hpbar-track"><div class="phb-fill" style="width:100%"></div></div>`;
  document.body.appendChild(hpBar);

  npcs.set(id, {
    character, id, name,
    pos: new THREE.Vector3(...spawnPos),
    mode: 'idle',
    target: null,
    wanderTimer: 0,
    speechBubble: bubble, bubbleTimeout: null, lastSpeech: null,
    // item awareness
    heldItem: null,
    heldItemMesh: null,
    lastContextSent: 0,
    // health
    hp: 100, maxHp: 100,
    dead: false,
    hpBar,
    hpBarTimeout: null,
  });
  return npcs.get(id);
}

createNpc("thomas", "Thomas",  [ 6, 14.42, -16.5], "thomas");
{ const t = npcs.get("thomas"); if (t) { t.character.set(t.pos.toArray(), [0, 0, -1]); t.character.update(); } }
createNpc("marcus", "Marcus",  [-22, 14.42,   8], "marcus");
createNpc("diane",  "Diane",   [20,  14.42,  -8], "diane");
createNpc("chad",   "Chad",    [10,  14.42,  16], "chad");
createNpc("ray",    "Ray",     [-8,  14.42,  -8], "homeless");

// NPC waypoint tables (must match Rust npc/defs.rs coords)
const NPC_WAYPOINTS = {
  thomas: {
    tent:    [ 6, 14.42, -16.5], road: [0, 14.42, -8],
    market:  [16, 14.42,  -8], shelter: [-8, 14.42, -8],
    alley:   [ 3, 14.42, -14],
  },
  marcus: {
    stairwell: [-22, 14.42, 8], corner: [-10, 14.42, 0], road: [0, 14.42, 0],
  },
  diane: {
    bodega: [20, 14.42, -8], doorway: [20, 14.42, -12], road: [0, 14.42, -8],
  },
  ray: {
    shop: [-8, 14.42, -8], doorway: [-8, 14.42, -12], alley: [-4, 14.42, -16],
  },
  chad: {
    bench: [10, 14.42, 16], corner: [0, 14.42, 16], road: [0, 14.42, 0], cafe: [16, 14.42, 16],
  },
};

// Home positions for auto-retreat
const NPC_HOME = {
  thomas: { x:  3,  z: -14 },
  marcus: { x: -22, z:   8 },
  diane:  { x:  20, z:  -8 },
  ray:    { x:  -8, z:  -8 },
  chad:   { x:  10, z:  16 },
};

const NPC_SPEED   = 0.025;
const NPC_WOUNDED_SPEED_MULT = 0.6; // 60% speed when wounded
// Eye height above ground for NPCs with slim proportions (legs+body+neckGap+head/2 * S=0.9)
const NPC_EYE_Y = 1.42;

function npcGroundY(x, z) {
  if (!world.isInitialized) return 13 + NPC_EYE_Y;
  const h = world.getMaxHeightAt(x, z);
  // Clamp to at least y=12 (grass surface) so NPCs don't fall into water
  const groundH = Math.max(h !== null && h !== undefined ? h : 13, 12);
  return groundH + NPC_EYE_Y;
}
const TENT_POS = { x: 3, z: -14 };
const TENT_WANDER_RADIUS = 12;  // wanders within this many blocks of tent
const FOLLOW_STOP_DIST   = 3;   // stops this many blocks from player
const RETREAT_DIST       = 28;  // auto-retreats if further than this from tent

function distTo(a, bx, bz) {
  return Math.sqrt((a.x - bx) ** 2 + (a.z - bz) ** 2);
}

function updateNpcMovement(npc) {
  const { character, pos } = npc;
  const pp = controls.position;

  // During dialog — stay still and keep facing the player
  if (activeNpcDialog === npc.id) {
    const fdx = pp.x - pos.x, fdz = pp.z - pos.z;
    const flen = Math.sqrt(fdx * fdx + fdz * fdz) || 1;
    character.set([pos.x, pos.y, pos.z], [fdx / flen, 0, fdz / flen]);
    character.update();
    return;
  }

  // ── Wanted: nearby NPCs flee when player has wanted level ───────────────
  if (wantedLevel > 0 && distTo(pos, pp.x, pp.z) < 20) {
    const fleeHome = NPC_HOME[npc.id] || TENT_POS;
    npc.mode = 'retreating';
    if (!npc.target) npc.target = { x: fleeHome.x, z: fleeHome.z };
  }

    // ── Auto-retreat if too far from home ───────────────────────────────────
  const home = NPC_HOME[npc.id] || TENT_POS;
  if (npc.mode !== 'retreating') {
    if (distTo(pos, home.x, home.z) > RETREAT_DIST) {
      npc.mode = 'retreating';
      npc.target = { x: home.x, z: home.z };
    }
  }

  // ── Compute movement based on mode ──────────────────────────────────────
  let tx = null, tz = null;

  if (npc.mode === 'following') {
    const playerDist = distTo(pos, pp.x, pp.z);
    if (playerDist > FOLLOW_STOP_DIST) {
      // Walk toward player but stop FOLLOW_STOP_DIST away
      const angle = Math.atan2(pos.z - pp.z, pos.x - pp.x);
      tx = pp.x + Math.cos(angle) * FOLLOW_STOP_DIST;
      tz = pp.z + Math.sin(angle) * FOLLOW_STOP_DIST;
    } else {
      // Close enough — face the player
      const fdx = pp.x - pos.x, fdz = pp.z - pos.z;
      const flen = Math.sqrt(fdx * fdx + fdz * fdz) || 1;
      character.set([pos.x, pos.y, pos.z], [fdx / flen, 0, fdz / flen]);
      character.update();
      return;
    }
    // If too far from home, switch to retreating
    if (distTo(pos, home.x, home.z) > RETREAT_DIST) {
      npc.mode = 'retreating';
      npc.target = { x: home.x, z: home.z };
    }

  } else if (npc.mode === 'retreating') {
    if (npc.target) { tx = npc.target.x; tz = npc.target.z; }
    // Arrived
    if (npc.target && distTo(pos, npc.target.x, npc.target.z) < 2) {
      npc.mode = 'idle';
      npc.target = null;
    }

  } else {
    // idle — stand still indefinitely until LLM or dialog sets a new mode
  }

  // ── Walk toward target ───────────────────────────────────────────────────
  if (tx !== null) {
    const dx = tx - pos.x, dz = tz - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.3) {
      // Reached target — go idle briefly
      if (npc.mode !== 'following') {
        npc.target = null;
        if (npc.mode === 'wandering') npc.wanderTimer = 60 + Math.floor(Math.random() * 120);
      }
      character.set([pos.x, pos.y, pos.z], [0, 0, 1]);
    } else {
      const woundedMult = (npc.hp / npc.maxHp) < 0.5 ? NPC_WOUNDED_SPEED_MULT : 1.0;
      const speed = (npc.mode === 'following' ? NPC_SPEED * 1.4 : NPC_SPEED) * woundedMult;
      const step = Math.min(speed, dist);
      pos.x += (dx / dist) * step;
      pos.z += (dz / dist) * step;
      pos.y = npcGroundY(pos.x, pos.z);
      character.set([pos.x, pos.y, pos.z], [dx / dist, 0, dz / dist]);
    }
  } else {
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
  const wp = new THREE.Vector3(pos.x, pos.y + 0.5, pos.z).project(camera);
  if (wp.z > 1) { speechBubble.style.display = "none"; return; }
  speechBubble.style.display = "";
  speechBubble.style.left = ((wp.x * 0.5 + 0.5) * window.innerWidth) + "px";
  speechBubble.style.top  = ((-wp.y * 0.5 + 0.5) * window.innerHeight) + "px";
}

// ── NPC health ────────────────────────────────────────────────────────────────

const NPC_RESPAWN_TIME = 12000; // ms before NPC respawns

function updateNpcHpBar(npc) {
  if (!npc.hpBar) return;
  const pct = Math.max(0, npc.hp / npc.maxHp);
  const fill = npc.hpBar.querySelector('.phb-fill');
  if (fill) {
    fill.style.width = `${pct * 100}%`;
    fill.style.background = pct > 0.5 ? '#2ecc71' : pct > 0.25 ? '#f39c12' : '#e74c3c';
  }
  npc.hpBar.classList.remove('hidden');
  npc.hpBar.style.display = (!npc.dead && npc.hp < npc.maxHp && controls.isLocked) ? 'block' : 'none';
}

function damageNpc(npcId, dmg, hitPoint, isHeadshot = false) {
  const npc = npcs.get(npcId);
  if (!npc || npc.dead) return;

  // Trust penalty: shooting an NPC costs -40 trust with that NPC; all others lose -10 (reputation)
  modifyTrust(npcId, -40);
  for (const [otherId] of npcs) {
    if (otherId !== npcId) modifyTrust(otherId, -10);
  }

  npc.hp = Math.max(0, npc.hp - dmg);
  updateNpcHpBar(npc);

  // Floating damage number
  if (hitPoint) {
    spawnDamageNumber(hitPoint.clone(), dmg, isHeadshot);
  }

  showKillfeedEntry(isHeadshot ? `HEADSHOT ${npc.name} -${dmg}hp` : `Hit ${npc.name} -${dmg}hp`);

  if (npc.hp <= 0) {
    // NPC dies
    npc.dead = true;
    npc.hpBar.classList.add('hidden');
    npcDetachItemMesh(npc);
    npc.heldItem = null;
    showKillfeedEntry(`${npc.name} killed`);
    const coinCount = 2 + Math.floor(Math.random() * 4);
    showKillfeedEntry("+" + coinCount + " coins");
    playerCoins += coinCount; updateWallet();
    showSpeechBubble(npc, '*dies*');
    flashHitMarker('kill');

    // Death fall animation: rotate character X 90deg over 500ms, then fade
    const FALL_MS = 500;
    const FADE_MS = 400;
    const fallStart = performance.now();
    const charGroup = npc.character;

    const stepFall = () => {
      const t = Math.min((performance.now() - fallStart) / FALL_MS, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      charGroup.rotation.x = (Math.PI / 2) * ease;
      if (t < 1) {
        requestAnimationFrame(stepFall);
      } else {
        const fadeStart = performance.now();
        const stepFade = () => {
          const ft = Math.min((performance.now() - fadeStart) / FADE_MS, 1);
          charGroup.traverse((o) => {
            if (o.material) {
              (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
                m.transparent = true;
                m.opacity = 1 - ft;
              });
            }
          });
          if (ft < 1) {
            requestAnimationFrame(stepFade);
          } else {
            charGroup.visible = false;
            charGroup.traverse((o) => {
              if (o.material) {
                (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
                  m.opacity = 1;
                });
              }
            });
          }
        };
        requestAnimationFrame(stepFade);
      }
    };
    requestAnimationFrame(stepFall);

    // Respawn after delay: reset rotation + visibility
    setTimeout(() => {
      npc.hp = npc.maxHp;
      npc.dead = false;
      charGroup.rotation.x = 0;
      charGroup.visible = true;
      const home = NPC_HOME[npcId];
      if (home) npc.pos.set(home.x, npc.pos.y, home.z);
      updateNpcHpBar(npc);
    }, NPC_RESPAWN_TIME);
  } else {
    // React — flee and say something; trigger wanted level for shooting an NPC
    triggerWanted();
    npc.mode = 'retreating';
    const home = NPC_HOME[npcId];
    if (home) npc.target = { x: home.x, z: home.z };
    showSpeechBubble(npc, ['Ow!', 'What the—', 'Hey!', 'You shot me!'][Math.floor(Math.random()*4)]);
    // Wounded limp speech — triggers when crossing below 50% for the first time
    if (npc.hp < npc.maxHp * 0.5 && (npc.hp + dmg) >= npc.maxHp * 0.5) {
      showSpeechBubble(npc, ["I'm... hit bad", "Can't run much more...", "You'll pay for this..."][Math.floor(Math.random()*3)]);
    }
  }
}

// SSE for LLM NPC events
// ── NPC item interaction functions ────────────────────────────────────────────

function npcDetachItemMesh(npc) {
  if (npc.heldItemMesh) {
    npc.heldItemMesh.parent?.remove(npc.heldItemMesh);
    npc.heldItemMesh = null;
  }
}

function npcAttachItemMesh(npc, itemId) {
  npcDetachItemMesh(npc);
  const def = ITEM_DEFS[itemId];
  if (!def?.makeMesh) return;
  const mesh = def.makeMesh();
  mesh.scale.setScalar(0.55);

  const armGroup = npc.character.rightArmGroup;
  if (armGroup) {
    // Arm group pivot is at the shoulder. Arm hangs down along -Y.
    // Put gun at the hand end (bottom of arm, ~-armHeight) and forward a bit.
    const armH = (npc.character.options?.arms?.height ?? 0.55 * 0.9);
    mesh.position.set(0, -armH - 0.05, -0.1);
    mesh.rotation.set(0, 0, 0); // gun barrel already faces -Z = forward
    armGroup.add(mesh);
    npc.heldItemMesh = mesh;
  } else {
    // Fallback: attach at right-hand world offset from character root
    mesh.position.set(0.3, 0.7, -0.2);
    mesh.rotation.set(0, 0, 0);
    npc.character.add(mesh);
    npc.heldItemMesh = mesh;
  }
}

function npcPickUpItem(npc) {
  // Find nearest settled ground item within 5 blocks
  let nearest = null, nearestDist = 5;
  for (const item of groundItems) {
    if (!item.settled) continue;
    const dx = item.mesh.position.x - npc.pos.x;
    const dz = item.mesh.position.z - npc.pos.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist < nearestDist) { nearestDist = dist; nearest = item; }
  }
  if (!nearest) return;

  world.remove(nearest.mesh);
  groundItems.splice(groundItems.indexOf(nearest), 1);

  const itemData = nearest.mesh.userData?.itemData ?? {};
  npc.heldItem = { id: nearest.id, data: { ...itemData } };
  npcAttachItemMesh(npc, nearest.id);
  showSpeechBubble(npc, `*picks up ${nearest.id.replace('_',' ')}*`);
}

function npcDropItem(npc) {
  if (!npc.heldItem) return;
  const dropPos = new THREE.Vector3(
    npc.pos.x + (Math.random() - 0.5) * 2,
    npc.pos.y - NPC_EYE_Y + 0.5,
    npc.pos.z + (Math.random() - 0.5) * 2
  );
  const root = spawnGroundItem(npc.heldItem.id, { ...npc.heldItem.data }, dropPos);
  if (root) world.add(root);
  npc.heldItem = null;
  npcDetachItemMesh(npc);
}

function npcHolster(npc) {
  npcDetachItemMesh(npc);
  // Item stays in heldItem.data — just hidden visually
}

function getTargetPos(targetPlayerId) {
  if (!targetPlayerId || targetPlayerId === playerId)
    return controls.object.position.clone();
  for (const [pid, peer] of (peers?.peerMap ?? new Map()))
    if (pid === targetPlayerId) return peer.position?.clone() ?? null;
  return controls.object.position.clone();
}

function npcShootAt(npc, targetPlayerId) {
  if (!npc.heldItem) return;
  const weaponId = npc.heldItem.id;
  if (weaponId !== "pistol" && weaponId !== "shotgun") return;
  if ((npc.heldItem.data?.ammo ?? 0) <= 0) {
    showSpeechBubble(npc, "*click* out of ammo");
    return;
  }
  if (npc.shootSeqRunning) return;
  npc.shootSeqRunning = true;

  const isShotgun = weaponId === "shotgun";
  const aimMs     = isShotgun ? 650 : 400;
  const recoverMs = 280;
  const gunMesh   = npc.heldItemMesh;
  const armGroup  = npc.character.rightArmGroup;
  const TARGET_ARM_X = -Math.PI * 0.38;

  npc.mode = "idle";

  // ── 1. Aim: raise arm ──────────────────────────────────────────────────────
  const aimStart = performance.now();
  function stepAim() {
    const t = Math.min((performance.now() - aimStart) / aimMs, 1);
    const e = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    if (armGroup) armGroup.rotation.x = TARGET_ARM_X * e;
    if (gunMesh)  gunMesh.rotation.x  = -0.25 * e;
    if (t < 1) requestAnimationFrame(stepAim);
    else fireBullet();
  }

  // ── 2. Fire ────────────────────────────────────────────────────────────────
  function fireBullet() {
    npc.heldItem.data.ammo--;
    const origin = npc.pos.clone();
    origin.y += NPC_EYE_Y * 0.85;
    const targetPos = getTargetPos(targetPlayerId);

    // Muzzle flash
    if (gunMesh) {
      const flash = new THREE.Mesh(
        new THREE.SphereGeometry(isShotgun ? 0.09 : 0.06, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0xffcc33, transparent: true, opacity: 1,
          blending: THREE.AdditiveBlending, depthWrite: false })
      );
      flash.position.z = isShotgun ? -0.55 : -0.38;
      gunMesh.add(flash);
      setTimeout(() => gunMesh?.remove(flash), 65);
    }

    // Arm kick back then recover
    if (armGroup) armGroup.rotation.x -= isShotgun ? 0.45 : 0.22;
    const kickStart = performance.now();
    const kickAmt = isShotgun ? 0.45 : 0.22;
    function stepKick() {
      const t = Math.min((performance.now() - kickStart) / 160, 1);
      if (armGroup) armGroup.rotation.x = (TARGET_ARM_X - kickAmt) + kickAmt * t;
      if (t < 1) requestAnimationFrame(stepKick);
    }
    stepKick();

    // Tracers
    if (targetPos) {
      const dir     = targetPos.clone().sub(origin).normalize();
      const pellets = isShotgun ? 6 : 1;
      const spread  = isShotgun ? 0.08 : 0;
      for (let i = 0; i < pellets; i++) {
        const d = dir.clone().add(new THREE.Vector3(
          (Math.random()-0.5)*spread,
          (Math.random()-0.5)*spread,
          (Math.random()-0.5)*spread
        )).normalize();
        spawnTracer(origin.clone(), origin.clone().addScaledVector(d, 40),
          isShotgun ? 0xff7700 : 0xff3300);
      }
      spawnHitSparks(targetPos.toArray(), [0, 1, 0]);

      const dist = origin.distanceTo(targetPos);
      if (dist < 35 && (!targetPlayerId || targetPlayerId === playerId)) {
        const damage = isShotgun ? 15 : 22;
        localHp = Math.max(0, localHp - damage);
        renderLocalHealthBar(); flashDamage?.();
        if (typeof recoilTarget !== "undefined")
          recoilTarget -= isShotgun ? 0.03 : 0.015;
        if (localHp <= 0) triggerDeath?.();
      }
    }
    setTimeout(lowerArm, 200);
  }

  // ── 3. Lower arm ───────────────────────────────────────────────────────────
  function lowerArm() {
    const lowerStart = performance.now();
    const startX = armGroup?.rotation.x ?? 0;
    function stepLower() {
      const t = Math.min((performance.now() - lowerStart) / recoverMs, 1);
      if (armGroup) armGroup.rotation.x = startX * (1 - t);
      if (gunMesh)  gunMesh.rotation.x  = gunMesh.rotation.x * (1 - t);
      if (t < 1) {
        requestAnimationFrame(stepLower);
      } else {
        if (armGroup) armGroup.rotation.x = 0;
        if (gunMesh)  gunMesh.rotation.x  = 0;
        npc.shootSeqRunning = false;
        npc.mode = "wandering";
      }
    }
    stepLower();
  }

  requestAnimationFrame(stepAim);

}

function sendNpcContext(npc) {
  if (!NPC_LLM_ENABLED || !world.isInitialized) return;
  const now = performance.now();
  if (now - npc.lastContextSent < 2000) return;
  npc.lastContextSent = now;

  const nearby = groundItems
    .filter(item => item.settled)
    .map(item => {
      const dx = item.mesh.position.x - npc.pos.x;
      const dz = item.mesh.position.z - npc.pos.z;
      return { id: item.id, dist: Math.round(Math.sqrt(dx*dx + dz*dz) * 10) / 10 };
    })
    .filter(i => i.dist < 15)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5);

  fetch(`${NPC_API}/npc-context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      npc_id: npc.id,
      nearby_items: nearby,
      held_item: npc.heldItem?.id ?? null,
      player_trust: npcTrust[npc.id] ?? 30,
    }),
  }).catch(e => console.error("[npc-context] fetch failed:", e));
}

let _npcEventSource = null;

function connectNpcEvents() {
  if (_npcEventSource) { _npcEventSource.close(); _npcEventSource = null; }
  const es = new EventSource(`${NPC_API}/npc-events`);
  _npcEventSource = es;
  es.onmessage = (e) => {
    let data; try { data = JSON.parse(e.data); } catch { return; }
    const npc = npcs.get(data.npc_id);
    if (!npc) return;

    // Movement modes
    const home = NPC_HOME[npc.id] || TENT_POS;
    if (data.action_type === "move_toward") {
      npc.mode = 'following';
    } else if (data.action_type === "move_away") {
      npc.mode = 'retreating';
      npc.target = { x: home.x, z: home.z };
    } else if (data.action_type === "move_to_waypoint" && data.waypoint) {
      const wpTable = NPC_WAYPOINTS[npc.id] || {};
      const wp = wpTable[data.waypoint];
      if (wp) { npc.mode = 'retreating'; npc.target = { x: wp[0], z: wp[2] }; }
      else { npc.mode = 'retreating'; npc.target = { x: home.x, z: home.z }; }
    } else if (data.action_type === "idle") {
      npc.mode = 'idle';
    }

    // Item actions
    if (data.action_type === "pick_up_item") {
      npcPickUpItem(npc);
    } else if (data.action_type === "shoot_player") {
      npcShootAt(npc, data.speech_target || playerId);
    } else if (data.action_type === "drop_item") {
      npcDropItem(npc);
    } else if (data.action_type === "holster") {
      npcHolster(npc);
    }

    // Handle speech — face nearest player when speaking
    if (data.speech) {
      showSpeechBubble(npc, data.speech); npc.lastSpeech = data.speech;
      if (activeNpcDialog === data.npc_id) {
        dialogText.textContent = data.speech; dialogText.classList.remove("thinking");
      }
      // Track first conversation and clues for objective flow
      onNpcConversation();
      const _clueWords = ['stolen', 'missing', 'took', 'clue', 'evidence', 'saw', 'secret', 'hiding', 'found', 'heard'];
      if (_clueWords.some(w => data.speech.toLowerCase().includes(w))) onClueFound();
      // Speak via ElevenLabs TTS
      speakNpcResponse(data.npc_id, data.speech);
      // Mystery clue detection
      detectMysteryClues(data.npc_id, data.speech);
      // Ray confess: drop clue_drive at his position
      if (data.npc_id === 'ray') {
        const rs = data.speech.toLowerCase();
        if (rs.includes("take it") || rs.includes("don't want it") || rs.includes("dont want it") || rs.includes("here, take") || rs.includes("here — take") || rs.includes("i don") && rs.includes("want")) {
          const rayNpc = npcs.get('ray');
          if (rayNpc) {
            const drivePos = new THREE.Vector3(rayNpc.pos.x + 0.5, rayNpc.pos.y - NPC_EYE_Y + 0.5, rayNpc.pos.z + 0.5);
            const driveRoot = spawnGroundItem('clue_drive', ITEM_DEFS.clue_drive.makeData(), drivePos);
            if (driveRoot) world.add(driveRoot);
          }
        }
      }
      const pp = controls.position;
      const fdx = pp.x - npc.pos.x, fdz = pp.z - npc.pos.z;
      const flen = Math.sqrt(fdx * fdx + fdz * fdz) || 1;
      npc.character.set([npc.pos.x, npc.pos.y, npc.pos.z], [fdx / flen, 0, fdz / flen]);
      npc.character.update();
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

// ── Objective HUD ─────────────────────────────────────────────────────────────

const objectiveEl = document.createElement("div");
objectiveEl.id = "objective";
document.body.appendChild(objectiveEl);

function setObjective(text) {
  objectiveEl.textContent = text;
  objectiveEl.style.display = text ? 'block' : 'none';
}

setObjective("Talk to someone. Find out what happened.");

// ── Wanted system ─────────────────────────────────────────────────────────────

let wantedLevel = 0, wantedTimer = null;

const wantedEl = document.createElement("div");
wantedEl.id = "wanted";
wantedEl.textContent = "★ WANTED";
document.body.appendChild(wantedEl);

function showWanted() { wantedEl.style.display = 'block'; }
function hideWanted() { wantedEl.style.display = 'none'; }

function triggerWanted() {
  wantedLevel = 1;
  clearTimeout(wantedTimer);
  showWanted();
  wantedTimer = setTimeout(() => { wantedLevel = 0; hideWanted(); }, 60000);
}

// ── Clue / objective flow tracking ───────────────────────────────────────────

let clueCount = 0;
let firstConversationDone = false;

function onNpcConversation() {
  if (!firstConversationDone) {
    firstConversationDone = true;
    setObjective("Something was stolen. Find out more.");
  }
}

function onClueFound() {
  clueCount++;
  if (clueCount === 2) {
    setObjective("You're getting closer. Keep asking questions.");
  } else if (clueCount >= 4) {
    setObjective(""); // mystery complete — hide objective
  }
}

// ── Player wallet ─────────────────────────────────────────────────────────────

let playerCoins = 10; // start with 10 coins

// ── Mystery Journal ────────────────────────────────────────────────────────────
const MYSTERY_CLUES = [
  {
    id: 'clue_chad',
    title: 'A Missing Prototype',
    body: 'Chad Worthington III says something valuable was taken from near the YC pop-up three nights ago. He thinks Ray fenced it.',
    npc: 'chad',
  },
  {
    id: 'clue_diane',
    title: 'Diane Saw Thomas',
    body: 'Diane saw Thomas stumbling toward the north bench late that night. She only told you after you bought something.',
    npc: 'diane',
  },
  {
    id: 'clue_marcus',
    title: "Marcus's Errand",
    body: 'Marcus admitted Thomas ran a pickup for him that night. He called it a "favour." He did not say what was taken.',
    npc: 'marcus',
  },
  {
    id: 'clue_thomas',
    title: 'Thomas Talks',
    body: "Thomas broke down. He grabbed a bag off a bench for Marcus and gave it straight to Ray to pawn. He says he didn't know what was inside.",
    npc: 'thomas',
  },
];

const JOURNAL_KEY = 'sfSim_journal_v1';
let journalClues = new Set(JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]'));

function journalHasClue(id) { return journalClues.has(id); }

function journalAddClue(id) {
  if (journalClues.has(id)) return false;
  journalClues.add(id);
  localStorage.setItem(JOURNAL_KEY, JSON.stringify([...journalClues]));
  renderJournal();
  showClueToast(id);
  return true;
}

function detectMysteryClues(npcId, speech) {
  const s = speech.toLowerCase();
  if (npcId === 'chad' && !journalHasClue('clue_chad')) {
    if (s.includes('prototype') || s.includes('stolen') || s.includes('missing') || s.includes('pawn') || s.includes('pitch deck') || s.includes('drive')) {
      journalAddClue('clue_chad');
    }
  }
  if (npcId === 'diane' && !journalHasClue('clue_diane')) {
    if (s.includes('thomas') && (s.includes('bench') || s.includes('night') || s.includes('stumbl') || s.includes('north'))) {
      journalAddClue('clue_diane');
    }
  }
  if (npcId === 'marcus' && !journalHasClue('clue_marcus')) {
    if (s.includes('favour') || s.includes('favor') || s.includes('pickup') || s.includes('picked up') || (s.includes('thomas') && s.includes('night'))) {
      journalAddClue('clue_marcus');
    }
  }
  if (npcId === 'thomas' && !journalHasClue('clue_thomas')) {
    if (s.includes('ray') && (s.includes('pawn') || s.includes('gave') || s.includes('bag'))) {
      journalAddClue('clue_thomas');
    }
  }
}

function checkCaseSolvedPickup() {
  for (let i = 0; i < 9; i++) {
    const s = getSlot(i);
    if (s && s.id === 'clue_drive') { triggerCaseSolved(); return; }
  }
}

// ── Case Solved ────────────────────────────────────────────────────────────────
let caseSolved = false;

function triggerCaseSolved() {
  if (caseSolved) return;
  caseSolved = true;
  localStorage.setItem('sfSim_caseSolved', '1');

  const el = document.createElement('div');
  el.id = 'case-solved';
  el.innerHTML = [
    '<div id="cs-box">',
    '  <div id="cs-label">CASE CLOSED</div>',
    '  <div id="cs-title">The Prototype Drive</div>',
    '  <div id="cs-narrative">',
    "    Marcus sent Thomas to grab Chad's bag.<br>",
    '    Thomas handed it to Ray without asking questions.<br>',
    '    Ray sat on it, terrified of what Marcus might do.<br>',
    '    <br>',
    '    You found it.',
    '  </div>',
    '  <div id="cs-sub">Press <kbd>F</kbd> to continue</div>',
    '</div>',
  ].join('');
  document.body.appendChild(el);
  document.exitPointerLock();

  const dismiss = (e) => {
    if (e.code === 'KeyF') {
      el.classList.add('cs-fade');
      setTimeout(() => el.remove(), 800);
      window.removeEventListener('keydown', dismiss);
      canvas.requestPointerLock();
    }
  };
  setTimeout(() => window.addEventListener('keydown', dismiss), 400);
}

const walletEl = document.createElement("div");
walletEl.id = "wallet";
walletEl.textContent = `💰 ${playerCoins}`;
document.body.appendChild(walletEl);

// ── Journal DOM setup ──────────────────────────────────────────────────────────
const journalBtnEl = document.createElement('div');
journalBtnEl.id = 'journal-btn';
journalBtnEl.textContent = 'J';
document.body.appendChild(journalBtnEl);

const journalEl = document.createElement('div');
journalEl.id = 'journal';
journalEl.innerHTML = [
  '<div id="journal-header">',
  '  <span id="journal-title">CASE FILE</span>',
  '  <button id="journal-close">&#x2715;</button>',
  '</div>',
  '<div id="journal-clues"></div>',
  '<div id="journal-footer">Talk to NPCs to uncover the truth.</div>',
].join('');
document.body.appendChild(journalEl);

let journalOpen = false;

function openJournal() {
  if (activeNpcDialog) closeDialog();
  journalOpen = true;
  renderJournal();
  journalEl.classList.add('open');
  journalBtnEl.classList.add('active');
}

function closeJournal() {
  journalOpen = false;
  journalEl.classList.remove('open');
  journalBtnEl.classList.remove('active');
}

document.getElementById('journal-close').addEventListener('click', closeJournal);

function renderJournal() {
  const container = document.getElementById('journal-clues');
  if (!container) return;
  const found = journalClues.size;
  container.innerHTML = '';
  MYSTERY_CLUES.forEach(clue => {
    const isFound = journalClues.has(clue.id);
    const div = document.createElement('div');
    div.className = 'journal-clue' + (isFound ? ' found' : ' locked');
    div.innerHTML = isFound
      ? `<div class="jc-title">${clue.title}</div><div class="jc-body">${clue.body}</div><div class="jc-npc">— ${clue.npc.charAt(0).toUpperCase() + clue.npc.slice(1)}</div>`
      : '<div class="jc-title locked-title">???</div><div class="jc-body locked-body">Speak to the right people.</div>';
    container.appendChild(div);
  });
  const footer = document.getElementById('journal-footer');
  if (footer) {
    const total = MYSTERY_CLUES.length;
    footer.textContent = found >= total
      ? `All ${total} clues found. Find what Ray has.`
      : `${found} / ${total} clues found.`;
  }
}

function showClueToast(clueId) {
  const clue = MYSTERY_CLUES.find(c => c.id === clueId);
  if (!clue) return;
  const toast = document.createElement('div');
  toast.className = 'clue-toast';
  toast.innerHTML = `<span class="ct-label">NEW CLUE</span> ${clue.title}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('ct-fade'), 2800);
  setTimeout(() => toast.remove(), 3600);
}

// Render on load to restore any saved clues
renderJournal();

function updateWallet() {
  walletEl.textContent = `💰 ${playerCoins}`;
  if (giveBtn) giveBtn.disabled = playerCoins <= 0;
  if (giveAmountSel) {
    Array.from(giveAmountSel.options).forEach(o => {
      o.disabled = parseInt(o.value) > playerCoins;
    });
  }
}

// ── Shop system ───────────────────────────────────────────────────────────────

const SHOPS = {
  ray: {
    name: "Ray's Pawnshop",
    items: [
      { id: 'pistol', label: 'Pistol', price: 5, sells: true },
      { id: 'ammo_9mm', label: 'Ammo (12 rounds)', price: 2 },
      { id: 'shotgun', label: 'Shotgun', price: 8 },
    ]
  },
  diane: {
    name: "Diane's Bodega",
    items: [
      { id: 'granola_bar', label: 'Granola Bar (+20hp)', price: 1 },
      { id: 'water', label: 'Water (+10hp)', price: 1 },
    ]
  }
};

let activeShopNpcId = null;

const shopEl = document.createElement("div");
shopEl.id = "shop";
shopEl.classList.add("hidden");
document.body.appendChild(shopEl);

function openShop(npcId) {
  const shopDef = SHOPS[npcId];
  if (!shopDef) return;
  activeShopNpcId = npcId;

  const npc = npcs.get(npcId);
  if (npc) {
    const pp = controls.position;
    const dx = pp.x - npc.pos.x, dz = pp.z - npc.pos.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    npc.character.set([npc.pos.x, npc.pos.y, npc.pos.z], [dx / len, 0, dz / len]);
    npc.character.update();
  }

  const itemsHtml = shopDef.items.map(item => `
    <div class="shop-item">
      <span class="shop-item-label">${item.label}</span>
      <span class="shop-item-price">\u{1F4B0} ${item.price}</span>
      <button class="shop-buy-btn" data-id="${item.id}" data-price="${item.price}">Buy</button>
    </div>
  `).join("");

  shopEl.innerHTML = `
    <div class="shop-header">
      <span class="shop-name">${shopDef.name}</span>
      <button id="shop-close">\u2715</button>
    </div>
    <div class="shop-items">${itemsHtml}</div>
  `;

  document.getElementById("shop-close").addEventListener("click", closeShop);
  shopEl.querySelectorAll(".shop-buy-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const itemId = btn.dataset.id;
      const price = parseInt(btn.dataset.price);
      if (playerCoins < price) { showKillfeedEntry("Not enough coins"); return; }
      playerCoins -= price;
      updateWallet();
      addItem(itemId, 1, null);
      refreshHotbar();
      syncWeaponToSlot(getFocusedSlot());
      showKillfeedEntry("Bought " + (ITEM_DEFS[itemId]?.name ?? itemId));
    });
  });

  shopEl.classList.remove("hidden");
  document.exitPointerLock();
  controls.isLocked = false;
  inputs.setNamespace("menu");
}

function closeShop() {
  activeShopNpcId = null;
  shopEl.classList.add("hidden");
}

// ── Dialog box ────────────────────────────────────────────────────────────────

let activeNpcDialog = null;
const dialogEl    = document.getElementById("dialog");
const dialogName  = document.getElementById("dialog-name");
const dialogText  = document.getElementById("dialog-text");
const dialogInput = document.getElementById("dialog-input");
const dialogTrustEl  = document.getElementById("dialog-trust");
const giveBtn        = document.getElementById("give-coin-btn");
const giveAmountSel  = document.getElementById("give-coin-amount");
document.getElementById("dialog-close").addEventListener("click", closeDialog);

function setDialogPortrait(npcId) {
  const portrait = document.getElementById("dialog-portrait");
  if (!portrait) return;
  const npc = npcs.get(npcId);
  if (!npc) return;
  const col = NPC_COLORS[npcId] || { bg: "#333", text: "#fff" };
  portrait.style.backgroundColor = col.bg;
  portrait.style.color = col.text;
  portrait.textContent = npc.name.charAt(0).toUpperCase();
}

function openDialog(npcId) {
  const npc = npcs.get(npcId); if (!npc) return;
  activeNpcDialog = npcId;

  // Face the player immediately
  const pp = controls.position;
  const dx = pp.x - npc.pos.x, dz = pp.z - npc.pos.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  npc.character.set([npc.pos.x, npc.pos.y, npc.pos.z], [dx / len, 0, dz / len]);
  npc.character.update();

  dialogName.textContent = npc.name;
  setDialogPortrait(npcId);
  // Trust indicator dots
  if (dialogTrustEl) {
    const trust = npcTrust[npcId] || 30;
    const color = trust <= 33 ? '#e74c3c' : trust <= 66 ? '#f1c40f' : '#2ecc71';
    dialogTrustEl.innerHTML = '<span class="trust-dot" style="background:' + color + '"></span>'
      + '<span class="trust-dot" style="background:' + color + '"></span>'
      + '<span class="trust-dot" style="background:' + color + '"></span>';
  }
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

giveBtn.addEventListener("click", () => {
  if (!activeNpcDialog || playerCoins <= 0) return;
  const amount = Math.min(parseInt(giveAmountSel.value) || 1, playerCoins);
  playerCoins -= amount;
  modifyTrust(activeNpcDialog, amount * 5);
  updateWallet();
  fetch(`${NPC_API}/npc-message`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      npc_id: activeNpcDialog,
      player_id: playerId,
      player_name: playerName,
      message: `[GIVES YOU ${amount} COIN${amount > 1 ? 'S' : ''}] (player now has ${playerCoins} coins remaining)`,
    }),
  }).catch(() => {});
  dialogText.textContent = "..."; dialogText.classList.add("thinking");
});

inputs.bind("KeyE", () => {
  if (activeNpcDialog) { closeDialog(); return; }
  if (activeShopNpcId) { closeShop(); return; }
  // Try inventory pickup first
  const camPos = controls.object.getWorldPosition(new THREE.Vector3());
  const pickedUp = tryPickup(world, camPos);
  if (pickedUp) { syncWeaponToSlot(getFocusedSlot()); checkCaseSolvedPickup(); return; }
  // Otherwise open shop (for ray/diane) or dialog for other NPCs
  const pp = controls.position; let nearest = null, nearestDist = Infinity;
  for (const [id, npc] of npcs) {
    const d = Math.sqrt((npc.pos.x-pp.x)**2 + (npc.pos.z-pp.z)**2);
    if (d < 4 && d < nearestDist) { nearest = id; nearestDist = d; }
  }
  if (nearest) {
    if (SHOPS[nearest]) openShop(nearest);
    else openDialog(nearest);
  }
}, "in-game");

// Q — drop focused hotbar item
inputs.bind("KeyQ", () => {
  const dir = new THREE.Vector3();
  controls.object.getWorldDirection(dir);
  const eyePos = controls.object.getWorldPosition(new THREE.Vector3());
  tryDrop(world, eyePos, dir);
  syncWeaponToSlot(getFocusedSlot());
}, "in-game");

function checkDialogDistance() {
  if (!activeNpcDialog) return;
  const npc = npcs.get(activeNpcDialog); if (!npc) { closeDialog(); return; }
  const pp = controls.position;
  if (Math.sqrt((npc.pos.x-pp.x)**2 + (npc.pos.z-pp.z)**2) > 6) closeDialog();
}

// ── Proximity voice chat (OpenAI Realtime via server proxy) ──────────────────
const VOICE_RANGE = 4; // units — triggers when this close to an NPC

// ── Voice system: Web Speech API (STT) + ElevenLabs (TTS) ────────────────────
// No OpenAI needed. Browser transcribes speech → /npc-message → SSE speech
// text → /npc-tts → ElevenLabs MP3 → Web Audio playback.

let voiceNpcId = null;
let voiceRecog = null;   // SpeechRecognition instance
let voiceAudioCtx = null;

// Listening indicator — small red dot near crosshair
const voiceIndicator = document.createElement("div");
voiceIndicator.id = "voice-indicator";
Object.assign(voiceIndicator.style, {
  position: "fixed", top: "50%", left: "50%",
  transform: "translate(24px, 20px)",
  width: "10px", height: "10px", borderRadius: "50%",
  background: "#ff4444", boxShadow: "0 0 6px #ff4444",
  pointerEvents: "none", zIndex: "30", display: "none",
});
document.body.appendChild(voiceIndicator);

// Speak NPC response text via ElevenLabs
let _currentTtsSource = null; // stop previous TTS if a new one arrives

async function speakNpcResponse(npcId, text) {
  if (!text || !text.trim()) return;
  // Stop any currently playing TTS
  if (_currentTtsSource) { try { _currentTtsSource.stop(); } catch (_) {} _currentTtsSource = null; }
  try {
    const resp = await fetch(`${NPC_API}/npc-tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ npc_id: npcId, text: text.trim() }),
    });
    if (!resp.ok) return;
    const arrayBuf = await resp.arrayBuffer();
    if (!voiceAudioCtx) voiceAudioCtx = new AudioContext();
    if (voiceAudioCtx.state === "suspended") voiceAudioCtx.resume();
    const decoded = await voiceAudioCtx.decodeAudioData(arrayBuf);
    const src = voiceAudioCtx.createBufferSource();
    src.buffer = decoded;
    src.connect(voiceAudioCtx.destination);
    src.onended = () => { if (_currentTtsSource === src) _currentTtsSource = null; };
    _currentTtsSource = src;
    src.start();
  } catch (_) {}
}

function startVoice(npcId) {
  if (voiceNpcId === npcId && voiceRecog) return;
  stopVoice();

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return; // browser doesn't support it

  voiceNpcId = npcId;
  voiceRecog = new SR();
  voiceRecog.continuous = true;
  voiceRecog.interimResults = false;
  voiceRecog.lang = "en-US";

  voiceRecog.onstart = () => { voiceIndicator.style.display = "block"; };
  voiceRecog.onend   = () => {
    // Restart if still in range
    if (voiceNpcId === npcId) {
      try { voiceRecog.start(); } catch (_) {}
    }
  };

  voiceRecog.onresult = (e) => {
    const transcript = e.results[e.results.length - 1][0].transcript.trim();
    if (!transcript) return;
    // Send to NPC brain via existing message endpoint
    fetch(`${NPC_API}/npc-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ npc_id: npcId, player_id: playerId, player_name: playerName, message: transcript }),
    }).catch(() => {});
  };

  voiceRecog.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") stopVoice();
  };

  try { voiceRecog.start(); } catch (_) { voiceNpcId = null; }
}

function stopVoice() {
  voiceIndicator.style.display = "none";
  voiceNpcId = null;
  if (voiceRecog) { try { voiceRecog.stop(); } catch (_) {} voiceRecog = null; }
}

function checkVoiceProximity() {
  const pp = controls.position;
  let closestId = null, closestDist = Infinity;
  for (const [id, npc] of npcs) {
    const d = Math.sqrt((npc.pos.x - pp.x) ** 2 + (npc.pos.z - pp.z) ** 2);
    if (d < VOICE_RANGE && d < closestDist) { closestId = id; closestDist = d; }
  }
  if (closestId && closestId !== voiceNpcId) startVoice(closestId);
  else if (!closestId && voiceNpcId) stopVoice();
}

// ── Health / PvP system ───────────────────────────────────────────────────────

const MAX_HP = 100;
let localHp = MAX_HP;
let localDead = false;
const peerHp = new Map(); // peerId → { hp, maxHp, barEl }

// Local health bar
const healthHudEl = document.createElement("div");
healthHudEl.id = "health-hud";
document.body.appendChild(healthHudEl);

function renderLocalHealthBar() {
  const pct = Math.max(0, localHp / MAX_HP);
  const color = pct > 0.5 ? "#4caf50" : pct > 0.25 ? "#ff9800" : "#f44336";
  healthHudEl.innerHTML = `<div class="hb-label">♥ ${localHp}</div><div class="hb-track"><div class="hb-fill" style="width:${pct*100}%;background:${color}"></div></div>`;
}
renderLocalHealthBar();

function healPlayer(amount) {
  localHp = Math.min(MAX_HP, localHp + amount);
  renderLocalHealthBar();
  showKillfeedEntry("+" + amount + "hp");
}

// Kill feed
const killfeedEl = document.createElement("div");
killfeedEl.id = "killfeed";
document.body.appendChild(killfeedEl);

function showKillfeedEntry(text) {
  const el = document.createElement("div");
  el.className = "kf-entry";
  el.textContent = text;
  killfeedEl.prepend(el);
  setTimeout(() => el.classList.add("kf-fade"), 2500);
  setTimeout(() => el.remove(), 3200);
}

function spawnDamageNumber(worldPos, dmg, isHeadshot) {
  // Project 3-D point to screen
  const sc = worldPos.clone().project(camera);
  if (sc.z > 1) return; // behind camera
  const x = (sc.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-sc.y * 0.5 + 0.5) * window.innerHeight;
  const el = document.createElement("div");
  el.className = "dmg-number" + (isHeadshot ? " headshot" : "");
  el.textContent = isHeadshot ? `${dmg} HEADSHOT` : `-${dmg}`;
  el.style.left = x + "px";
  el.style.top = y + "px";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

// Floating HP bar above peer
function makePeerHpBar() {
  const bar = document.createElement("div");
  bar.className = "peer-hpbar";
  bar.innerHTML = `<div class="phb-fill"></div>`;
  bar.style.display = "none";
  document.body.appendChild(bar);
  return bar;
}

function updatePeerHpBarDOM(entry) {
  if (!entry.barEl) return;
  const pct = Math.max(0, entry.hp / entry.maxHp);
  const fill = entry.barEl.querySelector(".phb-fill");
  if (fill) {
    fill.style.width = `${pct * 100}%`;
    fill.style.background = pct > 0.5 ? "#4caf50" : pct > 0.25 ? "#ff9800" : "#f44336";
  }
  entry.barEl.style.display = (entry.hp <= 0 || entry.hp >= entry.maxHp) ? "none" : "block";
}

function updatePeerHpBarPosition(peerId) {
  const entry = peerHp.get(peerId);
  if (!entry || entry.hp >= entry.maxHp || entry.hp <= 0) return;
  const character = peers.map.get(peerId);
  if (!character) return;
  const worldPos = new THREE.Vector3();
  character.getWorldPosition(worldPos);
  // root is at eye height; head top is (totalHeight - eyeHeight) above root
  const eyeH = character.eyeHeight ?? 1.09;
  const totalH = character.totalHeight ?? 1.31;
  worldPos.y += (totalH - eyeH) + 0.25;
  worldPos.project(camera);
  if (worldPos.z > 1) { entry.barEl.style.display = "none"; return; }
  entry.barEl.style.display = "block";
  entry.barEl.style.left = ((worldPos.x * 0.5 + 0.5) * window.innerWidth) + "px";
  entry.barEl.style.top  = ((-worldPos.y * 0.5 + 0.5) * window.innerHeight) + "px";
}

// Hit marker
const hitMarkerEl = document.createElement("div");
hitMarkerEl.id = "hit-marker";
document.body.appendChild(hitMarkerEl);
let hitMarkerTimeout = null;
// variant: 'normal' | 'headshot' | 'kill'
function flashHitMarker(variant = "normal") {
  hitMarkerEl.classList.remove("active", "hm-headshot", "hm-kill");
  void hitMarkerEl.offsetWidth; // force reflow

  if (variant === "kill") {
    hitMarkerEl.textContent = "\u{1F480}";
    hitMarkerEl.classList.add("hm-kill", "active");
    clearTimeout(hitMarkerTimeout);
    hitMarkerTimeout = setTimeout(() => {
      hitMarkerEl.classList.remove("active", "hm-kill");
      hitMarkerEl.textContent = "";
    }, 800);
  } else if (variant === "headshot") {
    hitMarkerEl.classList.add("hm-headshot", "active");
    clearTimeout(hitMarkerTimeout);
    try {
      const ctx = voiceAudioCtx || (voiceAudioCtx = new AudioContext());
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(1200, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.06);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.09);
    } catch (_) {}
    hitMarkerTimeout = setTimeout(
      () => hitMarkerEl.classList.remove("active", "hm-headshot"),
      200,
    );
  } else {
    hitMarkerEl.classList.add("active");
    clearTimeout(hitMarkerTimeout);
    hitMarkerTimeout = setTimeout(() => hitMarkerEl.classList.remove("active"), 120);
  }
}

// Damage flash
const dmgFlashEl = document.createElement("div");
dmgFlashEl.id = "damage-flash";
document.body.appendChild(dmgFlashEl);

function flashDamage() {
  lastCombatTime = performance.now();
  dmgFlashEl.classList.add("active");
  setTimeout(() => dmgFlashEl.classList.remove("active"), 220);
}

// Death / respawn screen
const deathScreenEl = document.createElement("div");
deathScreenEl.id = "death-screen";
deathScreenEl.innerHTML = `<div class="ds-box"><h2>YOU DIED</h2><p>Respawning in 3s...</p></div>`;
deathScreenEl.style.display = "none";
document.body.appendChild(deathScreenEl);

function triggerDeath() {
  if (localDead) return;
  localDead = true;
  controls.isLocked = false;
  document.exitPointerLock();
  deathScreenEl.style.display = "flex";
  setTimeout(() => {
    deathScreenEl.style.display = "none";
    localDead = false;
    localHp = MAX_HP;
    renderLocalHealthBar();
    const _respawnPositions = [[-15,0], [15,0], [0,-15], [0,15], [-8,-8], [8,8]];
    const _respawnPos = _respawnPositions[Math.floor(Math.random() * _respawnPositions.length)];
    controls.teleportToTop(_respawnPos[0], _respawnPos[1]);
    events.emit("player-respawn", {});
    setTimeout(() => { controls.isLocked = true; canvas.requestPointerLock(); inputs.setNamespace("in-game"); }, 100);
  }, 3000);
}

// Server → client health events
events.on("health-update", (raw) => {
  const d = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (d.player_id === peers.ownID) {
    const prev = localHp;
    localHp = d.hp;
    renderLocalHealthBar();
    if (d.hp < prev) flashDamage();
    if (d.hp <= 0) triggerDeath();
  } else {
    let entry = peerHp.get(d.player_id);
    if (!entry) {
      entry = { hp: d.max_hp, maxHp: d.max_hp, barEl: makePeerHpBar() };
      peerHp.set(d.player_id, entry);
    }
    const prev = entry.hp;
    entry.hp = d.hp;
    entry.maxHp = d.max_hp;
    updatePeerHpBarDOM(entry);
    if (d.killed) {
      const char = peers.map.get(d.player_id);
      const name = char?.username || d.player_id.slice(0, 6);
      showKillfeedEntry(`${name} was killed`);
    }
  }
});

events.on("player-respawned", (raw) => {
  const d = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (d.player_id === peers.ownID) return;
  const entry = peerHp.get(d.player_id);
  if (entry) { entry.hp = d.hp; entry.maxHp = d.max_hp; updatePeerHpBarDOM(entry); }
});

// Hear other players shoot
events.on("player-shot", (raw) => {
  const d = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (d.shooter_id === peers.ownID) return; // don't double-play our own shot
  const listenerPos = controls.object.position.toArray();
  playDistantShot(listenerPos, d.position, d.weapon);
});

// Clean up HP bar when a peer disconnects
peers.onPeerLeave = (id, _character) => {
  const entry = peerHp.get(id);
  if (entry?.barEl) entry.barEl.remove();
  peerHp.delete(id);
};

// ── Gun system ────────────────────────────────────────────────────────────────

const WEAPONS = {
  pistol: {
    name: "Pistol",
    range: 64, spread: 0, pellets: 1,
    fireRate: 350, recoil: 0.012,
    tracerColor: 0xffee88,
    reloadTime: 1200,
  },
  shotgun: {
    name: "Shotgun",
    range: 24, spread: 0.09, pellets: 6,
    fireRate: 900, recoil: 0.038,
    tracerColor: 0xff8844,
    reloadTime: 2000,
  },
};
const PUNCH_RANGE  = 2.5;
const PUNCH_DAMAGE = 15;
const weaponOrder = ["pistol", "shotgun"];
let currentWeaponKey = null; // null = no weapon equipped
let currentWeapon = null;
let lastFireTime = 0;
let isReloading = false;
let reloadTimeout = null;

// ── HUD refs ─────────────────────────────────────────────────────────────────
const crosshairEl  = document.getElementById("crosshair");
const weaponNameEl = document.getElementById("weapon-name");
const weaponHudEl  = document.getElementById("weapon-hud");
const weaponAmmoEl = document.getElementById("weapon-ammo");

function showGunHUD(show) {
  crosshairEl.style.display  = show ? "block" : "none";
  weaponHudEl.style.display  = show ? "block" : "none";
}

function updateAmmoHUD() {
  if (!currentWeaponKey) { weaponAmmoEl.textContent = ""; return; }
  let ammo = 0, maxAmmo = 0;
  for (let i = 0; i < 9; i++) {
    const s = getSlot(i);
    if (s && s.id === currentWeaponKey) { ammo = s.data.ammo; maxAmmo = s.data.maxAmmo; break; }
  }
  if (isReloading) {
    weaponAmmoEl.textContent = "RELOADING...";
    weaponAmmoEl.className = "reloading";
  } else {
    weaponAmmoEl.textContent = `${ammo} / ${maxAmmo}`;
    weaponAmmoEl.className = ammo === 0 ? "empty" : "";
  }
}

// ── View-model gun meshes ─────────────────────────────────────────────────────

function makeMat(color) {
  return new THREE.MeshBasicMaterial({ color });
}

function makeGunMesh(key) {
  const g = new THREE.Group();

  if (key === "pistol") {
    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.11, 0.18), makeMat(0x333333));
    body.position.set(0, 0, 0);
    g.add(body);
    // Barrel
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.22), makeMat(0x222222));
    barrel.position.set(0, 0.04, -0.18);
    g.add(barrel);
    // Grip (dark rubberised handle)
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.13, 0.07), makeMat(0x2a2218));
    grip.position.set(0, -0.12, 0.04);
    grip.rotation.x = 0.2;
    g.add(grip);
    // Trigger guard
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.08), makeMat(0x222222));
    guard.position.set(0, -0.04, -0.02);
    g.add(guard);
    // Hand / fingers — skin tone wrapping the grip
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.10, 0.09), makeMat(0xf5cba7));
    hand.position.set(0, -0.17, 0.04);
    hand.rotation.x = 0.2;
    g.add(hand);
  } else {
    // Shotgun — longer, blockier
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.40), makeMat(0x5c3d1e));
    body.position.set(0, 0, -0.08);
    g.add(body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.36), makeMat(0x2a2a2a));
    barrel.position.set(0, 0.06, -0.18);
    g.add(barrel);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.18), makeMat(0x3e2009));
    stock.position.set(0, -0.02, 0.20);
    stock.rotation.x = -0.1;
    g.add(stock);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.14), makeMat(0x1a1a1a));
    pump.position.set(0, 0.03, 0.04);
    g.add(pump);
    // Hand gripping the stock
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.09, 0.12), makeMat(0xf5cba7));
    hand.position.set(0, -0.06, 0.20);
    hand.rotation.x = -0.1;
    g.add(hand);
  }

  // Muzzle point at barrel tip
  const muzzle = new THREE.Object3D();
  muzzle.name = "muzzle";
  muzzle.position.set(0, key === "pistol" ? 0.04 : 0.06, key === "pistol" ? -0.30 : -0.38);
  g.add(muzzle);

  return g;
}

// ── Detailed first-person hand ────────────────────────────────────────────────
function makeDetailedHand() {
  const group = new THREE.Group();
  // Match player skin tone from SKINS.player
  const skinColor = new THREE.Color(SKINS.player.opts.head.color);
  const nailColor = skinColor.clone().lerp(new THREE.Color("#fff"), 0.35);
  const knuckleColor = skinColor.clone().lerp(new THREE.Color("#000"), 0.12);
  const skin = new THREE.MeshBasicMaterial({ color: skinColor });
  const nail = new THREE.MeshBasicMaterial({ color: nailColor });
  const knuckle = new THREE.MeshBasicMaterial({ color: knuckleColor });

  const b = (w, h, d, mat = skin) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

  // Palm — slightly tapered, thick
  const palm = b(0.11, 0.07, 0.13);
  palm.position.set(0, 0, 0);
  group.add(palm);

  // Wrist / lower arm stub
  const wrist = b(0.10, 0.065, 0.09);
  wrist.position.set(0, 0, 0.11);
  group.add(wrist);

  // 4 fingers (index, middle, ring, pinky)
  const fingerDefs = [
    { x: -0.042, segments: [0.025, 0.022, 0.018], len: [0.052, 0.042, 0.032] },
    { x: -0.014, segments: [0.026, 0.023, 0.019], len: [0.060, 0.048, 0.036] },
    { x:  0.014, segments: [0.025, 0.022, 0.018], len: [0.056, 0.044, 0.034] },
    { x:  0.042, segments: [0.020, 0.017, 0.014], len: [0.040, 0.032, 0.024] },
  ];

  for (const fd of fingerDefs) {
    let zOff = -0.065; // forward from palm
    for (let seg = 0; seg < 3; seg++) {
      const w = fd.segments[seg];
      const l = fd.len[seg];
      // Main segment
      const seg3 = b(w, 0.055, l);
      seg3.position.set(fd.x, 0, zOff - l / 2);
      group.add(seg3);
      // Knuckle bump between segments
      if (seg < 2) {
        const kn = new THREE.Mesh(new THREE.SphereGeometry(w * 0.58, 6, 4), knuckle);
        kn.scale.set(1, 0.75, 0.75);
        kn.position.set(fd.x, 0.008, zOff);
        group.add(kn);
      }
      // Nail on tip segment
      if (seg === 2) {
        const nl = b(w * 0.7, 0.012, l * 0.55, nail);
        nl.position.set(fd.x, 0.032, zOff - l * 0.4);
        group.add(nl);
      }
      zOff -= l;
    }
  }

  // Thumb — angled outward
  const thumbGroup = new THREE.Group();
  thumbGroup.position.set(-0.07, -0.005, -0.02);
  thumbGroup.rotation.z = -0.4;
  thumbGroup.rotation.y = 0.3;
  const t1 = b(0.024, 0.048, 0.048); t1.position.z = -0.024; thumbGroup.add(t1);
  const t2 = b(0.022, 0.044, 0.038); t2.position.z = -0.067; thumbGroup.add(t2);
  const tn = b(0.016, 0.010, 0.022, nail); tn.position.set(0, 0.026, -0.063); thumbGroup.add(tn);
  group.add(thumbGroup);

  // Overall orientation: hand faces forward, slight downward angle
  group.rotation.x = 0.25;
  group.rotation.y = 0.08;

  return group;
}

// First-person hand (attached to camera, shown when no weapon)
const fpHand = makeDetailedHand();
fpHand.position.set(0.18, -0.28, -0.38);
fpHand.userData.baseY = -0.28;
fpHand.visible = false;
camera.add(fpHand);

const gunGroups = {};
const muzzleFlashes = {};

for (const key of weaponOrder) {
  const mesh = makeGunMesh(key);
  mesh.position.set(0.26, -0.22, -0.42);
  mesh.userData.baseY = -0.22; // store so dip animation always restores correctly
  mesh.visible = false; // hidden until picked up
  camera.add(mesh);
  gunGroups[key] = mesh;

  // Muzzle flash sprite (no texture — just an additive glowing sprite)
  const flashMat = new THREE.SpriteMaterial({
    color: 0xffcc44, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flash = new THREE.Sprite(flashMat);
  flash.scale.set(0.35, 0.35, 1);
  flash.visible = false;
  const muzzlePt = mesh.getObjectByName("muzzle");
  muzzlePt.add(flash);
  muzzleFlashes[key] = flash;
}

// ── Active effects ────────────────────────────────────────────────────────────
// Each entry: { update(dt) → bool (false = remove) }
const activeEffects = [];

// ── Recoil state ──────────────────────────────────────────────────────────────
let recoilOffset = 0;    // current camera.rotation.x offset applied
let recoilTarget = 0;   // target offset (kicks to negative on fire, returns to 0)

function applyRecoil(amount) {
  recoilTarget -= amount; // negative x = look up in Three.js
}

// ── Muzzle flash ──────────────────────────────────────────────────────────────
function spawnMuzzleFlash() {
  const flash = muzzleFlashes[currentWeaponKey];
  flash.visible = true;
  flash.material.rotation = Math.random() * Math.PI * 2;
  flash.material.opacity = 1;
  setTimeout(() => { flash.visible = false; }, 60);
}

// ── Bullet tracer ─────────────────────────────────────────────────────────────
function spawnTracer(from, to, color) {
  const mat = new THREE.LineBasicMaterial({
    color, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
    linewidth: 2,
  });
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, mat);
  world.add(line);

  let elapsed = 0;
  const DURATION = 0.18; // seconds
  activeEffects.push({
    update(dt) {
      elapsed += dt;
      mat.opacity = Math.max(0, 0.9 * (1 - elapsed / DURATION));
      if (elapsed >= DURATION) {
        world.remove(line);
        geo.dispose();
        mat.dispose();
        return false;
      }
      return true;
    },
  });
}

// ── Hit sparks ────────────────────────────────────────────────────────────────
function spawnHitSparks(point, normal) {
  const COUNT = 14;
  const positions = new Float32Array(COUNT * 3);
  const velocities = [];

  const nx = normal ? normal[0] : 0;
  const ny = normal ? normal[1] : 1;
  const nz = normal ? normal[2] : 0;

  for (let i = 0; i < COUNT; i++) {
    positions[i*3]   = point[0];
    positions[i*3+1] = point[1];
    positions[i*3+2] = point[2];
    velocities.push(new THREE.Vector3(
      nx * 0.05 + (Math.random()-0.5) * 0.18,
      ny * 0.05 + Math.random() * 0.14,
      nz * 0.05 + (Math.random()-0.5) * 0.18,
    ));
  }

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  geo.setAttribute("position", posAttr);

  const mat = new THREE.PointsMaterial({
    size: 0.07, color: 0xffdd44,
    blending: THREE.AdditiveBlending, depthWrite: false,
    transparent: true, opacity: 1,
  });
  const sparks = new THREE.Points(geo, mat);
  world.add(sparks);

  let age = 0;
  const LIFETIME = 0.5; // seconds
  activeEffects.push({
    update(dt) {
      age += dt;
      for (let i = 0; i < COUNT; i++) {
        const v = velocities[i];
        positions[i*3]   += v.x * dt;
        positions[i*3+1] += v.y * dt;
        positions[i*3+2] += v.z * dt;
        v.y -= 4 * dt; // gravity
      }
      posAttr.needsUpdate = true;
      mat.opacity = Math.max(0, 1 - age / LIFETIME);
      if (age >= LIFETIME) {
        world.remove(sparks);
        geo.dispose();
        mat.dispose();
        return false;
      }
      return true;
    },
  });
}

// ── Crosshair fire flash ──────────────────────────────────────────────────────
function flashCrosshair() {
  crosshairEl.classList.add("firing");
  setTimeout(() => crosshairEl.classList.remove("firing"), 80);
}

// ── Weapon switch ─────────────────────────────────────────────────────────────
function equipWeapon(key) {
  if (!WEAPONS[key]) return;
  // Only equip if player actually has this weapon in their hotbar
  let hasIt = false;
  for (let i = 0; i < 9; i++) { const s = getSlot(i); if (s && s.id === key) { hasIt = true; break; } }
  if (!hasIt) return;

  if (currentWeaponKey) {
    gunGroups[currentWeaponKey].visible = false;
    // Cancel any in-progress reload for the old weapon
    if (isReloading) {
      clearTimeout(reloadTimeout);
      reloadTimeout = null;
      isReloading = false;
      const oldMesh = gunGroups[currentWeaponKey];
      if (oldMesh) { oldMesh.rotation.x = 0; oldMesh.position.y = oldMesh.userData.baseY ?? -0.22; }
    }
  }
  currentWeaponKey = key;
  currentWeapon = WEAPONS[key];
  gunGroups[key].visible = perspective.state === "first";
  fpHand.visible = false; // hide bare hand when weapon equipped
  weaponNameEl.textContent = currentWeapon.name;
  updateAmmoHUD();

  const mesh = gunGroups[key];
  const baseY = mesh.userData.baseY ?? -0.22;
  mesh.position.y = baseY - 0.12;
  setTimeout(() => { mesh.position.y = baseY; }, 80);
}

// Called by hotbar focus change to auto-equip/unequip based on what's in the slot
function syncWeaponToSlot(slotIndex) {
  const s = getSlot(slotIndex);
  const key = s && WEAPONS[s.id] ? s.id : null;
  if (key) {
    equipWeapon(key);
  } else {
    // Unequip — hide current gun, show bare hand
    if (currentWeaponKey) {
      if (isReloading) {
        clearTimeout(reloadTimeout);
        reloadTimeout = null;
        isReloading = false;
        const m = gunGroups[currentWeaponKey];
        if (m) { m.rotation.x = 0; m.position.y = m.userData.baseY ?? -0.22; }
      }
      gunGroups[currentWeaponKey].visible = false;
      currentWeaponKey = null;
      currentWeapon = null;
      weaponNameEl.textContent = "";
      weaponAmmoEl.textContent = "";
    }
    fpHand.visible = perspective.state === "first";
  }
}

function cycleWeapon(dir) {
  const idx = weaponOrder.indexOf(currentWeaponKey);
  const next = weaponOrder[(idx + dir + weaponOrder.length) % weaponOrder.length];
  equipWeapon(next);
}

// ── Fire ─────────────────────────────────────────────────────────────────────

const _ray = new THREE.Ray();
const _hitBox = new THREE.Box3();
const _peerWorldPos = new THREE.Vector3();

function fireRay(dir) {
  const origin = new THREE.Vector3();
  camera.getWorldPosition(origin);

  // Tracer origin = gun muzzle world position (visual only)
  const muzzleOrigin = origin.clone();
  if (currentWeaponKey && gunGroups[currentWeaponKey]) {
    const muzzlePt = gunGroups[currentWeaponKey].getObjectByName("muzzle");
    if (muzzlePt) muzzlePt.getWorldPosition(muzzleOrigin);
  }

  // Check peers and NPCs — closest hit wins
  _ray.set(origin, dir);
  let closestPeerDist = currentWeapon.range;
  let hitPeerId = null;
  let hitPeerPoint = null;
  let hitNpcId = null;
  let hitNpcPoint = null;

  // ── Remote players ────────────────────────────────────────────────────────
  peers.map.forEach((character, peerId) => {
    character.getWorldPosition(_peerWorldPos);
    const eyeH  = character.eyeHeight  ?? 1.09;
    const totalH = character.totalHeight ?? 1.31;
    const halfW = 0.4;
    _hitBox.set(
      new THREE.Vector3(_peerWorldPos.x - halfW, _peerWorldPos.y - eyeH,            _peerWorldPos.z - halfW),
      new THREE.Vector3(_peerWorldPos.x + halfW, _peerWorldPos.y + (totalH - eyeH), _peerWorldPos.z + halfW),
    );
    const intersect = new THREE.Vector3();
    const peerHit = _ray.intersectBox(_hitBox, intersect);
    if (!peerHit && !_hitBox.containsPoint(origin)) return;
    const dist = peerHit ? origin.distanceTo(intersect) : 0;
    if (dist < closestPeerDist) {
      closestPeerDist = dist;
      hitPeerId = peerId;
      hitNpcId  = null;
      hitPeerPoint = peerHit ? intersect.clone() : _peerWorldPos.clone();
      hitNpcPoint  = null;
    }
  });

  // ── NPCs — AABB hit test ─────────────────────────────────────────────────
  npcs.forEach((npc, npcId) => {
    if (npc.dead) return;
    const footY = npc.pos.y - NPC_EYE_Y;
    const totalH = npc.character.totalHeight ?? 1.31;
    const halfW = 0.65;
    const npcBox = new THREE.Box3(
      new THREE.Vector3(npc.pos.x - halfW, footY - 0.2,          npc.pos.z - halfW),
      new THREE.Vector3(npc.pos.x + halfW, footY + totalH + 0.2, npc.pos.z + halfW),
    );
    const intersect = new THREE.Vector3();
    // intersectBox returns null when origin is inside box — handle both cases
    const hit = _ray.intersectBox(npcBox, intersect);
    if (!hit && !npcBox.containsPoint(origin)) return;
    const t = hit ? origin.distanceTo(intersect) : 0;

    if (t < closestPeerDist) {
      closestPeerDist = t;
      hitNpcId    = npcId;
      hitPeerId   = null;
      hitNpcPoint = hit ? intersect.clone() : new THREE.Vector3(npc.pos.x, npc.pos.y, npc.pos.z);
      hitPeerPoint = null;
    }
  });

  // Voxel raycast
  const voxHit = world.raycastVoxels(
    origin.toArray(), dir.toArray(),
    currentWeapon.range,
    { ignoreFluids: true, ignorePassables: true }
  );
  const voxDist = voxHit ? origin.distanceTo(new THREE.Vector3(...voxHit.point)) : currentWeapon.range;

  // Player hit — only if closer than voxel wall
  if (hitPeerId && closestPeerDist < voxDist) {
    const dmg = currentWeaponKey === "shotgun" ? 15 : 25;
    events.emit("player-hit", { target_id: hitPeerId, damage: dmg });
    spawnHitSparks(hitPeerPoint.toArray(), [0, 1, 0]);
    spawnTracer(muzzleOrigin.clone(), hitPeerPoint, 0xff3333);
    flashHitMarker();
    const targetChar = peers.map.get(hitPeerId);
    const targetName = targetChar?.username || hitPeerId.slice(0, 6);
    showKillfeedEntry(`Hit ${targetName} -${dmg}hp`);
    return;
  }

  // NPC hit
  if (hitNpcId && closestPeerDist < voxDist) {
    const npc = npcs.get(hitNpcId);
    const footY = npc.pos.y - NPC_EYE_Y;
    const totalH = npc.character.totalHeight ?? 1.31;
    const headThreshold = footY + totalH * (2 / 3);
    const isHeadshot = hitNpcPoint && hitNpcPoint.y >= headThreshold;
    const baseDmg = currentWeaponKey === "shotgun" ? 15 : 25;
    const dmg = isHeadshot ? baseDmg * 2 : baseDmg;
    damageNpc(hitNpcId, dmg, hitNpcPoint, isHeadshot);
    spawnHitSparks(hitNpcPoint.toArray(), [0, 1, 0]);
    spawnTracer(muzzleOrigin.clone(), hitNpcPoint, isHeadshot ? 0xff0000 : 0xff3333);
    flashHitMarker(isHeadshot ? "headshot" : "normal");
    if (isHeadshot) showKillfeedEntry(`HEADSHOT ${npc.name}`);
    return;
  }

  // Voxel hit
  const endPt = voxHit
    ? new THREE.Vector3(...voxHit.point)
    : origin.clone().addScaledVector(dir, currentWeapon.range);
  spawnTracer(muzzleOrigin.clone(), endPt, currentWeapon.tracerColor);
  if (voxHit) {
    spawnHitSparks(voxHit.point, voxHit.normal);
  }
}

// ── Gun fire / reload animations ──────────────────────────────────────────────
function playFireAnimation(key) {
  const mesh = gunGroups[key];
  if (!mesh) return;
  const baseY = mesh.userData.baseY ?? -0.22;
  const baseZ = mesh.userData.baseZ ?? 0;
  if (key === "pistol") {
    // Sharp upward kick then settle back
    mesh.rotation.x = -0.18;
    setTimeout(() => { mesh.rotation.x = 0; }, 90);
  } else {
    // Shotgun pump — slide back then forward
    mesh.position.z = baseZ + 0.06;
    setTimeout(() => { mesh.position.z = baseZ; }, 220);
    mesh.rotation.x = -0.12;
    setTimeout(() => { mesh.rotation.x = 0; }, 180);
  }
}

function startReload() {
  if (!currentWeaponKey || isReloading) return;
  // Check if already full
  for (let i = 0; i < 9; i++) {
    const s = getSlot(i);
    if (s && s.id === currentWeaponKey) {
      if (s.data.ammo === s.data.maxAmmo) return;
      break;
    }
  }
  isReloading = true;
  updateAmmoHUD();
  playReload();

  // Animate gun down during reload then back up
  const mesh = gunGroups[currentWeaponKey];
  const baseY = mesh ? (mesh.userData.baseY ?? -0.22) : -0.22;
  if (mesh) {
    mesh.position.y = baseY - 0.14;
    mesh.rotation.x = 0.25;
  }

  const key = currentWeaponKey;
  reloadTimeout = setTimeout(() => {
    isReloading = false;
    reloadTimeout = null;
    // Restore ammo on the slot
    for (let i = 0; i < 9; i++) {
      const s = getSlot(i);
      if (s && s.id === key) { s.data.ammo = s.data.maxAmmo; break; }
    }
    refreshHotbar();
    updateAmmoHUD();
    // Animate gun back up
    if (mesh && currentWeaponKey === key) {
      mesh.position.y = baseY;
      mesh.rotation.x = 0;
    }
  }, currentWeapon.reloadTime);
}

function fireWeapon() {
  if (!currentWeapon || isReloading) return;
  const now = performance.now();
  if (now - lastFireTime < currentWeapon.fireRate) return;

  // Ammo check — find a hotbar slot matching the current weapon
  let ammoSlot = null;
  for (let i = 0; i < 9; i++) {
    const s = getSlot(i);
    if (s && s.id === currentWeaponKey && s.data.ammo > 0) { ammoSlot = s; break; }
  }
  if (!ammoSlot) {
    playEmptyClick();
    startReload();
    return;
  }

  lastFireTime = now;
  lastCombatTime = performance.now();
  ammoSlot.data.ammo -= 1;
  refreshHotbar();
  updateAmmoHUD();

  // Play shot sound
  if (currentWeaponKey === "shotgun") playShotgunShot();
  else playPistolShot();

  // Broadcast shot position so other clients can hear it
  const _shotPos = controls.object.position;
  events.emit("player-shot", {
    shooter_id: peers.ownID,
    position: [_shotPos.x, _shotPos.y, _shotPos.z],
    weapon: currentWeaponKey,
  });

  // Sample aim direction from controls object (has full yaw+pitch)
  const base = controls.getDirection();

  playFireAnimation(currentWeaponKey);
  spawnMuzzleFlash();
  applyRecoil(currentWeapon.recoil);
  flashCrosshair();

  // Movement spread penalty
  const { front, back, left, right } = controls.movements;
  const isMoving = front || back || left || right;
  const movePenalty = isMoving ? 0.04 : 0;

  if (currentWeapon.pellets === 1) {
    const s = currentWeapon.spread + movePenalty;
    const dir = s > 0
      ? base.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * s,
          (Math.random() - 0.5) * s,
          (Math.random() - 0.5) * s,
        )).normalize()
      : base;
    fireRay(dir);
  } else {
    for (let i = 0; i < currentWeapon.pellets; i++) {
      const s = currentWeapon.spread + movePenalty;
      fireRay(
        base
          .clone()
          .add(
            new THREE.Vector3(
              (Math.random() - 0.5) * s,
              (Math.random() - 0.5) * s,
              (Math.random() - 0.5) * s,
            ),
          )
          .normalize(),
      );
    }
  }
}

let isPunching = false;
function punchHand() {
  if (isPunching) return;
  isPunching = true;
  const baseY = fpHand.userData.baseY ?? -0.28;
  const baseZ = -0.38;
  fpHand.position.z = baseZ - 0.18;
  fpHand.position.y = baseY + 0.04;
  fpHand.rotation.x = -0.15;

  // Melee raycast — fires at peak extension (80 ms in)
  setTimeout(() => {
    const origin = new THREE.Vector3();
    camera.getWorldPosition(origin);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const punchRay = new THREE.Ray(origin, dir);

    let hitNpcId = null;
    let hitNpcPoint = null;
    let closestDist = PUNCH_RANGE;

    npcs.forEach((npc, npcId) => {
      if (npc.dead) return;
      const footY = npc.pos.y - NPC_EYE_Y;
      const totalH = npc.character.totalHeight ?? 1.31;
      const npcBox = new THREE.Box3(
        new THREE.Vector3(npc.pos.x - 0.65, footY - 0.2, npc.pos.z - 0.65),
        new THREE.Vector3(npc.pos.x + 0.65, footY + totalH + 0.2, npc.pos.z + 0.65),
      );
      const intersect = new THREE.Vector3();
      const hit = punchRay.intersectBox(npcBox, intersect);
      if (!hit && !npcBox.containsPoint(origin)) return;
      const dist = hit ? origin.distanceTo(intersect) : 0;
      if (dist < closestDist) {
        closestDist = dist;
        hitNpcId = npcId;
        hitNpcPoint = hit ? intersect.clone() : new THREE.Vector3(npc.pos.x, npc.pos.y, npc.pos.z);
      }
    });

    if (hitNpcId) {
      const npc = npcs.get(hitNpcId);
      const footY = npc.pos.y - NPC_EYE_Y;
      const totalH = npc.character.totalHeight ?? 1.31;
      const headThreshold = footY + totalH * 0.65;
      const isHeadshot = hitNpcPoint && hitNpcPoint.y >= headThreshold;
      const dmg = isHeadshot ? PUNCH_DAMAGE * 2 : PUNCH_DAMAGE;
      damageNpc(hitNpcId, dmg, hitNpcPoint, isHeadshot);
      spawnHitSparks(hitNpcPoint.toArray(), [0, 1, 0]);
      flashHitMarker(isHeadshot ? "headshot" : "normal");
    }
  }, 80);

  setTimeout(() => {
    fpHand.position.z = baseZ;
    fpHand.position.y = baseY;
    fpHand.rotation.x = 0;
    isPunching = false;
  }, 160);
}

inputs.click("left", () => {
  if (!controls.isLocked || activeNpcDialog || localDead) return;
  if (currentWeaponKey) {
    fireWeapon();
  } else {
    punchHand();
  }
}, "in-game");

inputs.bind("KeyR", () => {
  if (!controls.isLocked || activeNpcDialog || localDead) return;
  startReload();
}, "in-game", { identifier: "reload" });

inputs.scroll(
  () => cycleWeapon(-1),
  () => cycleWeapon(1),
  "in-game"
);

// Number keys 1-9 select hotbar slot and auto-equip whatever's in it
for (let i = 1; i <= 9; i++) {
  const slotIdx = i - 1;
  inputs.bind(`Digit${i}`, () => {
    setFocusedSlot(slotIdx);
    syncWeaponToSlot(slotIdx);
  }, "in-game");
}

// ── Slide system (Sojourn-style) ──────────────────────────────────────────────

const SLIDE_DURATION   = 650;   // ms slide lasts
const SLIDE_IMPULSE    = 14;    // forward boost on slide start
const SLIDE_FOV_BOOST  = 15;    // extra FOV degrees during slide
const BASE_FOV         = camera.fov;

let isSliding       = false;
let slideTimer      = 0;
let slideCamRoll    = 0;   // camera Z-roll tilt during slide

function startSlide() {
  if (isSliding) return;
  // Must be on the ground
  if (controls.body.resting[1] !== -1) return;
  isSliding  = true;
  slideTimer = SLIDE_DURATION;

  // Build slide direction from held WASD keys, rotated by player yaw
  const { front, back, left, right } = controls.movements;
  let mx = 0, mz = 0;
  if (front) mz =  1;
  if (back)  mz = -1;
  if (left)  mx = -1;
  if (right) mx =  1;
  // Fall back to camera forward if no keys held
  if (mx === 0 && mz === 0) mz = 1;

  // Rotate input by heading (the yaw the physics engine uses)
  const h = controls.state.heading;
  const cos = Math.cos(h), sin = Math.sin(h);
  const wx = mx * cos - mz * sin;
  const wz = mx * sin + mz * cos;

  const len = Math.sqrt(wx * wx + wz * wz) || 1;
  controls.body.applyImpulse([
    (wx / len) * SLIDE_IMPULSE,
    0,
    (wz / len) * SLIDE_IMPULSE,
  ]);

  // Kill vertical friction so we glide
  controls.body.friction = 0.01;
}

function updateSlide(dt) {
  if (!isSliding) {
    // Smoothly return FOV and roll to normal
    if (camera.fov !== BASE_FOV) {
      camera.fov += (BASE_FOV - camera.fov) * 0.18;
      if (Math.abs(camera.fov - BASE_FOV) < 0.1) camera.fov = BASE_FOV;
      camera.updateProjectionMatrix();
    }
    if (Math.abs(slideCamRoll) > 0.001) {
      slideCamRoll *= 0.82;
      camera.rotation.z = slideCamRoll;
    } else if (slideCamRoll !== 0) {
      slideCamRoll = 0;
      camera.rotation.z = 0;
    }
    return;
  }

  slideTimer -= dt;

  // Cancel slide if airborne or timer expired
  if (slideTimer <= 0 || controls.body.resting[1] !== -1 && slideTimer < SLIDE_DURATION - 80) {
    isSliding = false;
    controls.body.friction = 0.6; // restore normal friction
    return;
  }

  // Progress 0→1 over slide duration
  const t = 1 - slideTimer / SLIDE_DURATION;

  // FOV zoom out during first half, return during second half
  const fovCurve = t < 0.5 ? t * 2 : (1 - t) * 2;
  camera.fov = BASE_FOV + SLIDE_FOV_BOOST * fovCurve;
  camera.updateProjectionMatrix();

  // Camera tilt: roll slightly in slide direction, ease back
  const targetRoll = -0.12 * (1 - t);
  slideCamRoll += (targetRoll - slideCamRoll) * 0.25;
  camera.rotation.z = slideCamRoll;

  // Camera dips slightly (crouch feel) — pitch down a tiny bit at slide peak
  const dip = Math.sin(t * Math.PI) * 0.04;
  camera.position.y = -dip;
}

// Shift to slide (when on ground + moving); Shift mid-air = nothing (airJumps handles it)
inputs.bind("ShiftLeft", () => {
  if (controls.isLocked && !isSliding && controls.body.resting[1] === -1) {
    startSlide();
  }
}, "in-game", { occasion: "keydown", identifier: "slide" });

// ── Key bindings ──────────────────────────────────────────────────────────────

inputs.bind("KeyG", controls.toggleGhostMode, "in-game");

// ── J key: toggle journal ──────────────────────────────────────────────────────
inputs.bind('KeyJ', () => { if (journalOpen) closeJournal(); else openJournal(); }, 'in-game', { identifier: 'journal-toggle' });
inputs.bind('KeyJ', () => { if (journalOpen) closeJournal(); else openJournal(); }, 'menu', { identifier: 'journal-toggle-menu' });

// ── H key: toggle hitbox visualiser ──────────────────────────────────────────
let hitboxVis = false;
const hitboxHelpers = [];

function refreshHitboxHelpers() {
  hitboxHelpers.forEach(h => world.remove(h));
  hitboxHelpers.length = 0;
  if (!hitboxVis) return;

  const wireMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });

  // NPC hitboxes — green
  npcs.forEach(npc => {
    const totalH = npc.character.totalHeight ?? 1.31;
    const footY  = npc.pos.y - NPC_EYE_Y;
    const geo = new THREE.BoxGeometry(0.9, totalH, 0.9);
    const mesh = new THREE.Mesh(geo, wireMat);
    mesh.position.set(npc.pos.x, footY + totalH / 2, npc.pos.z);
    world.add(mesh);
    hitboxHelpers.push(mesh);
  });

  // Peer hitboxes — yellow
  const peerMat = new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true });
  peers.map.forEach(character => {
    const p = new THREE.Vector3();
    character.getWorldPosition(p);
    const eyeH  = character.eyeHeight  ?? 1.09;
    const totalH = character.totalHeight ?? 1.31;
    const geo = new THREE.BoxGeometry(0.8, totalH, 0.8);
    const mesh = new THREE.Mesh(geo, peerMat);
    mesh.position.set(p.x, p.y - eyeH + totalH / 2, p.z);
    world.add(mesh);
    hitboxHelpers.push(mesh);
  });
}

inputs.bind("KeyH", () => {
  hitboxVis = !hitboxVis;
  refreshHitboxHelpers();
}, "in-game");

controls.on("lock", () => {
  inputs.setNamespace("in-game");
  showGunHUD(true);
});
controls.on("unlock", () => {
  inputs.setNamespace("menu");
  showGunHUD(false);
});

// ── Overlay & pointer lock ────────────────────────────────────────────────────

const overlay = document.getElementById("overlay");

// Typewriter animation for overlay title/subtitle/button
function typeText(element, text, speed = 60) {
  if (!element) return;
  element.textContent = "";
  let i = 0;
  function tick() { element.textContent += text[i]; i++; if (i < text.length) setTimeout(tick, speed); }
  tick();
}
const _titleEl    = document.getElementById("title-text");
const _subtitleEl = document.getElementById("subtitle-text");
const _playEl     = document.getElementById("play-button");
typeText(_titleEl, "SF Simulator", 60);
setTimeout(() => typeText(_subtitleEl, "A San-Francisco adventure", 30), 500);
setTimeout(() => typeText(_playEl, "Click to play", 30), 1000);

canvas.addEventListener("click", () => {
  if (!welcomeScreen.classList.contains("hidden")) return; // welcome screen still up
  if (!overlay.classList.contains("hidden")) {
    overlay.classList.add("hidden");
    controls.isLocked = true;
    inputs.setNamespace("in-game");
    canvas.requestPointerLock();
    startAmbience(); // requires user gesture
  }
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

// Vignette overlay
const vignetteEl = document.createElement("div");
vignetteEl.id = "vignette";
document.body.appendChild(vignetteEl);

// NPC radar container
const npcRadarEl = document.createElement("div");
npcRadarEl.id = "npc-radar";
document.body.appendChild(npcRadarEl);

// Per-NPC radar blips (one per NPC, parented to npcRadarEl)
const npcBlips = new Map(); // npcId -> div element
for (const [id] of npcs) {
  const blip = document.createElement("div");
  blip.className = "npc-blip";
  blip.style.display = "none";
  const col = NPC_COLORS[id];
  if (col) {
    blip.style.backgroundColor = col.bg;
    blip.style.color = col.bg; // used by currentColor in ::after ring
  }
  npcRadarEl.appendChild(blip);
  npcBlips.set(id, blip);
}

// ── Animate loop ──────────────────────────────────────────────────────────────

let _lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const _now = performance.now();
  const _dt = Math.min((_now - _lastTime) / 1000, 0.1);
  _lastTime = _now;

  if (world.isInitialized) {
    // Use controls.object.position (official demo pattern)
    world.update(controls.object.position, camera.getWorldDirection(new THREE.Vector3()));
    controls.update();
    perspective.update();

    // Drive water ripple shader
    const waterMat = world.getBlockFaceMaterial?.("Water", "top");
    if (waterMat?.uniforms?.uTime) waterMat.uniforms.uTime.value = performance.now() / 1000;


    lightShined.update();
    shadows.update();
    peers.update();
    // Update floating HP bars above peers
    peerHp.forEach((entry, peerId) => updatePeerHpBarPosition(peerId));

    for (const npc of npcs.values()) {
      if (!npc.dead) updateNpcMovement(npc);
      updateBubblePosition(npc);
      // NPC HP bar — position update, visibility set by updateNpcHpBar
      if (npc.hpBar && !npc.dead && npc.hp < npc.maxHp && controls.isLocked) {
        const wp = npc.pos.clone();
        wp.y += (npc.character.totalHeight ?? 1.31) - NPC_EYE_Y + 0.4;
        wp.project(camera);
        if (wp.z > 1) {
          npc.hpBar.style.display = 'none';
        } else {
          npc.hpBar.style.display = 'block';
          npc.hpBar.style.left = ((wp.x * 0.5 + 0.5) * window.innerWidth) + 'px';
          npc.hpBar.style.top  = ((-wp.y * 0.5 + 0.5) * window.innerHeight) + 'px';
        }
      } else if (npc.hpBar) {
        npc.hpBar.style.display = 'none';
      }
      // Auto-pickup: if NPC walks within 1.5 blocks of a ground item and has no held item, pick it up
      if (!npc.heldItem) {
        for (let i = groundItems.length - 1; i >= 0; i--) {
          const item = groundItems[i];
          if (!item.settled) continue;
          const dx = item.mesh.position.x - npc.pos.x;
          const dz = item.mesh.position.z - npc.pos.z;
          if (Math.sqrt(dx*dx + dz*dz) < 1.5) {
            world.remove(item.mesh);
            groundItems.splice(i, 1);
            npc.heldItem = { id: item.id, data: { ...(item.mesh.userData?.itemData ?? {}) } };
            npcAttachItemMesh(npc, item.id);
            showSpeechBubble(npc, `*picks up ${item.id.replace(/_/g,' ')}*`);
            // Tell server NPC now holds this item
            if (NPC_LLM_ENABLED) fetch(`${NPC_API}/npc-message`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ npc_id: npc.id, player_id: 'system', player_name: 'system',
                message: `[SYSTEM] You just picked up a ${item.id.replace(/_/g,' ')}. It is now in your hands.` }),
            }).catch(() => {});
            break;
          }
        }
      }
    }
    checkDialogDistance();
    checkVoiceProximity();

    playerUpdateTimer += 16;
    if (playerUpdateTimer >= 500) { playerUpdateTimer = 0; reportPlayerPos(); }

    // Send ground item context to server for item-aware NPCs
    const thomas = npcs.get("thomas");
    if (thomas) sendNpcContext(thomas);

    // Recoil decay
    // Recoil: spring camera.rotation.x toward recoilTarget, then decay target back to 0
    if (Math.abs(recoilTarget - recoilOffset) > 0.0001 || Math.abs(recoilOffset) > 0.0001) {
      const prev = recoilOffset;
      recoilOffset += (recoilTarget - recoilOffset) * 0.35; // spring toward target
      recoilTarget *= 0.80;                                  // target decays to 0
      camera.rotation.x += recoilOffset - prev;             // apply delta only
      if (Math.abs(recoilTarget) < 0.0001 && Math.abs(recoilOffset) < 0.0001) {
        recoilTarget = 0; recoilOffset = 0;
      }
    }

    // Slide update
    updateSlide(_dt * 1000); // updateSlide expects ms

    // Active effects (tracers, sparks) — pass dt in seconds
    for (let i = activeEffects.length - 1; i >= 0; i--) {
      if (!activeEffects[i].update(_dt)) activeEffects.splice(i, 1);
    }

    // Atmosphere: ambient sound, drone, footsteps, vignette
    updateAtmosphere(_dt, controls.position, npcs, currentWeaponKey, lastCombatTime);

    // Footsteps
    if (controls.isLocked && !localDead) {
      const vel = controls.body?.velocity;
      const moving = vel && (Math.abs(vel.x) > 0.5 || Math.abs(vel.z) > 0.5);
      if (moving) {
        _footstepTimer += _dt;
        if (_footstepTimer > 0.45) {
          _footstepTimer = 0;
          playFootstep('road');
        }
      } else {
        _footstepTimer = 0;
      }
    }

    // Vignette: red tint during combat
    if (vignetteEl) {
      const combatActive = (performance.now() - lastCombatTime) < 3000;
      vignetteEl.classList.toggle('combat', combatActive);
    }

    // Inventory ground items + pickup tooltip
    updateInventory(world, controls.position, _dt);

    // Hitbox visualiser — refresh each frame so boxes track moving NPCs/peers
    if (hitboxVis) refreshHitboxHelpers();

    // Gun visibility: only in first-person, only if equipped
    if (currentWeaponKey) gunGroups[currentWeaponKey].visible = perspective.state === "first";
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

let _gameStarted = false;
async function start() {
  if (_gameStarted) return;
  _gameStarted = true;
  animate();

  // Init hotbar UI
  const hotbar = initHotbar(document.body);
  initPickupTooltip();
  hotbar.onFocusChange((_prev, next) => {
    if (next) syncWeaponToSlot(next.col);
  });

  await network.connect(VOXELIZE_SERVER);
  await network.join("tutorial");
  await world.initialize();

  // Paint skins now that WebGL context is active — reveal each character after textures are ready
  for (const { c, skin } of skinQueue) { paintSkin(c, skin); c.visible = true; }
  skinQueue.length = 0;

  // Show all NPC health bars from the start
  for (const npc of npcs.values()) updateNpcHpBar(npc);

  world.renderRadius = 8;

  if (NPC_LLM_ENABLED) connectNpcEvents();

  // Spawn: ghost mode until chunk [0,0] loads, then land on road
  controls.toggleGhostMode();
  world.addChunkInitListener([0, 0], () => {
    controls.teleportToTop(0, 0);
    if (controls.ghostMode) controls.toggleGhostMode();
    fpHand.visible = true; // show bare hand on spawn (no weapon yet)

    // Spawn weapons on the ground — player must walk up and press E
    [
      ["pistol",   new THREE.Vector3( 2, 13.15,  2)],
      ["shotgun",  new THREE.Vector3( 4, 13.15,  2)],
      ["ammo_9mm", new THREE.Vector3( 3, 13.15,  3)],
    ].forEach(([id, pos]) => {
      const m = spawnGroundItem(id, null, pos);
      if (m) world.add(m);
    });
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
      color: { top: new THREE.Color("#0d1220"), middle: new THREE.Color("#111828"), bottom: new THREE.Color("#1a2035") },
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
  await world.applyBlockTexture("Water",           all, "/blocks/water.png");
  await world.applyBlockTexture("Sand",            all, "/blocks/dirt.png");
  await world.applyBlockTexture("Plank",           all, "/blocks/plank.png");
  await world.applyBlockTexture("Orange Concrete", all, "/blocks/orange_concrete.png");
  await world.applyBlockTexture("White Concrete",  all, "/blocks/white_concrete.png");
  await world.applyBlockTexture("Steel",           all, "/blocks/steel.png");
  await world.applyBlockTexture("Tent Canvas",     all, "/blocks/tent_canvas.png");
  await world.applyBlockTexture("Cardboard",       all, "/blocks/cardboard.png");
  await world.applyBlockTexture("Lamp",            all, "/blocks/glass.png");
  await world.applyBlockTexture("Leaf",            all, "/blocks/grass_top.png");

  // Water ripple shader
  try {
    world.customizeMaterialShaders("Water", "top", {
      vertexShader: `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 pos = position;
          pos.y += sin(pos.x * 5.0 + uTime * 2.5) * 0.04
                 + cos(pos.z * 4.0 + uTime * 1.8) * 0.03;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        uniform sampler2D map;
        void main() {
          vec2 uv = vUv;
          uv.x += sin(uv.y * 8.0 + uTime * 2.0) * 0.015;
          uv.y += cos(uv.x * 6.0 + uTime * 1.5) * 0.015;
          vec4 col = texture2D(map, uv);
          col.rgb *= vec3(0.6, 0.85, 1.1); // blue tint
          col.a = 0.82;
          gl_FragColor = col;
        }
      `,
      uniforms: { uTime: { value: 0 } },
    });
  } catch(e) { /* customizeMaterialShaders may not be available */ }
}

// ── Welcome screen ────────────────────────────────────────────────────────────

const welcomeScreen = document.getElementById("welcome-screen");
const welcomeNameEl = document.getElementById("welcome-name");
const welcomeEnterBtn = document.getElementById("welcome-enter");
const welcomeErrorEl = document.getElementById("welcome-error");

function submitWelcome() {
  const name = welcomeNameEl.value.trim();
  if (!name) { welcomeErrorEl.textContent = "Pick a name first."; return; }
  if (name.length < 2) { welcomeErrorEl.textContent = "At least 2 characters."; return; }

  playerName = name;
  mainCharacter.username = name;
  peers.ownUsername = name;

  welcomeScreen.classList.add("hidden");
  overlay.classList.remove("hidden");
  start();
}

welcomeEnterBtn.addEventListener("click", submitWelcome);
welcomeNameEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitWelcome();
});

// Dev: auto-fill name and go straight to overlay
mainCharacter.username = playerName;
peers.ownUsername = playerName;
start();
