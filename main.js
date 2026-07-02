import * as VOXELIZE from "@voxelize/core";
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

const perspectives = new VOXELIZE.Perspective(rigidControls, world);
perspectives.connect(inputs, "in-game");

const shadows = new VOXELIZE.Shadows(world);
const lightShined = new VOXELIZE.LightShined(world);

// ── Character skins ───────────────────────────────────────────────────────────

// Helper: fill a rectangle on a canvas context
function px(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

// Skin painter — takes a character and a skin definition
function applySkin(character, skin) {
  const { head, body, leftArm, rightArm, leftLeg, rightLeg } = character;

  // Verify paint is working — force needsUpdate on all materials after painting
  const forceUpdate = (part) => {
    part.traverse(obj => {
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {
          m.needsUpdate = true;
          if (m.map) m.map.needsUpdate = true;
        });
      }
    });
  };

  // ── Head ─────────────────────────────────────────────────────────────────
  head.paint("all", (ctx, canvas) => {
    px(ctx, 0, 0, canvas.width, canvas.height, skin.skin);
  });
  head.paint("front", (ctx, canvas) => {
    const w = canvas.width, h = canvas.height;
    // Skin tone face
    px(ctx, 0, 0, w, h, skin.skin);
    // Eyes
    px(ctx, Math.floor(w * 0.25), Math.floor(h * 0.3), Math.floor(w * 0.18), Math.floor(h * 0.25), skin.eye);
    px(ctx, Math.floor(w * 0.57), Math.floor(h * 0.3), Math.floor(w * 0.18), Math.floor(h * 0.25), skin.eye);
    // Mouth
    px(ctx, Math.floor(w * 0.3), Math.floor(h * 0.7), Math.floor(w * 0.4), Math.floor(h * 0.15), skin.mouth);
    // Hair (top strip)
    px(ctx, 0, 0, w, Math.floor(h * 0.2), skin.hair);
  });
  head.paint("top", (ctx, canvas) => {
    px(ctx, 0, 0, canvas.width, canvas.height, skin.hair);
  });

  // ── Body ──────────────────────────────────────────────────────────────────
  // front/back canvas: 16w × widthSegments (but no heightSegments set = same)
  body.paint("all", (ctx, canvas) => {
    const w = canvas.width, h = canvas.height;
    // Base shirt/jacket colour
    px(ctx, 0, 0, w, h, skin.shirt);
    // Simple detail: collar area lighter at top
    px(ctx, Math.floor(w * 0.35), 0, Math.floor(w * 0.3), Math.floor(h * 0.2), skin.skin);
    // Pocket or logo if defined
    if (skin.logo) {
      px(ctx, Math.floor(w * 0.6), Math.floor(h * 0.3), Math.floor(w * 0.25), Math.floor(h * 0.25), skin.logo);
    }
  });
  body.paint("front", (ctx, canvas) => {
    const w = canvas.width, h = canvas.height;
    px(ctx, 0, 0, w, h, skin.shirt);
    // Collar
    px(ctx, Math.floor(w * 0.35), 0, Math.floor(w * 0.3), Math.floor(h * 0.2), skin.skin);
    // Button line
    px(ctx, Math.floor(w * 0.48), Math.floor(h * 0.2), 1, Math.floor(h * 0.8), skin.shirtDark);
  });

  // ── Arms ──────────────────────────────────────────────────────────────────
  // canvas: 8w × 16h
  leftArm.paint("all", (ctx, canvas) => {
    const w = canvas.width, h = canvas.height;
    px(ctx, 0, 0, w, h, skin.shirt);
    // Sleeve cuff at bottom
    px(ctx, 0, Math.floor(h * 0.8), w, Math.floor(h * 0.2), skin.shirtDark);
    // Hand at very bottom
    px(ctx, 0, Math.floor(h * 0.88), w, Math.floor(h * 0.12), skin.skin);
  });
  rightArm.paint("all", (ctx, canvas) => {
    const w = canvas.width, h = canvas.height;
    px(ctx, 0, 0, w, h, skin.shirt);
    px(ctx, 0, Math.floor(h * 0.8), w, Math.floor(h * 0.2), skin.shirtDark);
    px(ctx, 0, Math.floor(h * 0.88), w, Math.floor(h * 0.12), skin.skin);
  });

  // ── Legs ──────────────────────────────────────────────────────────────────
  // canvas: 3w × 3h (very small — just solid colours)
  leftLeg.paint("all", (ctx, canvas) => {
    px(ctx, 0, 0, canvas.width, canvas.height, skin.pants);
  });
  leftLeg.paint("bottom", (ctx, canvas) => {
    px(ctx, 0, 0, canvas.width, canvas.height, skin.shoe);
  });
  rightLeg.paint("all", (ctx, canvas) => {
    px(ctx, 0, 0, canvas.width, canvas.height, skin.pants);
  });
  rightLeg.paint("bottom", (ctx, canvas) => {
    px(ctx, 0, 0, canvas.width, canvas.height, skin.shoe);
  });

  // Force GPU texture upload on all parts
  forceUpdate(head);
  forceUpdate(body);
  forceUpdate(leftArm);
  forceUpdate(rightArm);
  forceUpdate(leftLeg);
  forceUpdate(rightLeg);
}

// Skin definitions — each is a colour palette
const SKINS = {
  // Thomas: YC founder type — warm skin, grey hoodie, dark jeans
  thomas: {
    skin:      "#c8956c",
    hair:      "#2c1a0e",
    eye:       "#1a1a2e",
    mouth:     "#8b4513",
    shirt:     "#4a4a4a",
    shirtDark: "#2a2a2a",
    pants:     "#1a237e",
    shoe:      "#1a1a1a",
    logo:      "#ff6600", // orange YC logo hint
  },
  // Player: light skin, blue shirt, grey jeans
  player: {
    skin:      "#fdbcb4",
    hair:      "#3d2b1f",
    eye:       "#1a3a5c",
    mouth:     "#c0706a",
    shirt:     "#1565c0",
    shirtDark: "#0d47a1",
    pants:     "#455a64",
    shoe:      "#212121",
    logo:      null,
  },
  // VC partner: pale skin, sharp black suit, white shirt
  vc: {
    skin:      "#ffe0c2",
    hair:      "#1a1a1a",
    eye:       "#0d0d0d",
    mouth:     "#c06060",
    shirt:     "#1a1a1a",
    shirtDark: "#0a0a0a",
    pants:     "#1a1a1a",
    shoe:      "#0a0a0a",
    logo:      "#ffffff", // white shirt visible under suit
  },
  // Homeless person: weathered darker skin, faded brown jacket, worn pants
  homeless: {
    skin:      "#8d5524",
    hair:      "#2c1810",
    eye:       "#2c1810",
    mouth:     "#5c3317",
    shirt:     "#6d4c41",
    shirtDark: "#4e342e",
    pants:     "#546e7a",
    shoe:      "#3e2723",
    logo:      null,
  },
};

// Characters that need skin applied after world init
const pendingSkins = [];

function createCharacter(skinName) {
  const skin = skinName && SKINS[skinName] ? SKINS[skinName] : null;

  // Pass colours into the Character constructor options — these are applied
  // inside createModel() before any external paint, so they always take effect.
  const DEPTH = 0.25; // slim front-to-back (default body width is 0.9)
  const options = skin ? {
    head: { color: skin.skin, faceColor: skin.skin, depth: DEPTH },
    body: { color: skin.shirt, depth: DEPTH },
    arms: { color: skin.shirt, depth: DEPTH },
    legs: { color: skin.pants, depth: DEPTH },
  } : {
    head: { depth: DEPTH },
    body: { depth: DEPTH },
    arms: { depth: DEPTH },
    legs: { depth: DEPTH },
  };

  const character = new VOXELIZE.Character(options);
  world.add(character);
  lightShined.add(character);
  shadows.add(character);

  if (skin) {
    pendingSkins.push({ character, skin });
  }
  return character;
}

function applyPendingSkins() {
  for (const { character, skin } of pendingSkins) {
    applySkin(character, skin);
  }
  pendingSkins.length = 0;
}

const mainCharacter = createCharacter("player");
rigidControls.attachCharacter(mainCharacter);

// NPC — Thomas, YC founder personality
const npc = createCharacter("thomas");
npc.username = "Thomas";

// Thomas patrols in front of the YC office plaza (chunk -2,0 south face ~x=-26, z=-4)
const NPC_SPAWN = new THREE.Vector3(-26, 0, -4);
const NPC_RADIUS = 6;
const NPC_SPEED = 0.015;
let npcAngle = 0;
let npcPos = NPC_SPAWN.clone();
let npcGroundY = null;

world.addChunkInitListener([0, 0], () => {
  npcGroundY = world.getVoxelByWorld(
    Math.floor(NPC_SPAWN.x),
    Math.floor(NPC_SPAWN.y + 80),
    Math.floor(NPC_SPAWN.z)
  );
  npcPos.set(NPC_SPAWN.x, NPC_SPAWN.y, NPC_SPAWN.z);
});

function updateNPC() {
  npcAngle += NPC_SPEED;
  const tx = NPC_SPAWN.x + Math.cos(npcAngle) * NPC_RADIUS;
  const tz = NPC_SPAWN.z + Math.sin(npcAngle) * NPC_RADIUS;

  // keep on ground via world height query
  let ty = npcPos.y;
  if (world.isInitialized) {
    const col = world.getMaxHeightAt(tx, tz);
    if (col !== null && col !== undefined) ty = col + npc.eyeHeight;
  }

  const dx = tx - npcPos.x;
  const dz = tz - npcPos.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  npcPos.set(tx, ty, tz);
  npc.set([tx, ty, tz], [dx / len, 0, dz / len]);
  npc.update();
}

inputs.bind("KeyG", rigidControls.toggleGhostMode, "in-game");
inputs.bind("KeyF", rigidControls.toggleFly, "in-game");

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
    updateNPC();
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
  world.renderRadius = 32;

  // Apply character skins now that WebGL is up and materials have been compiled
  applyPendingSkins();

  // Float in place until chunk [0,0] is ready, then land on the road
  rigidControls.toggleGhostMode();
  // Spawn on the main road intersection (chunk 0,0 centre)
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

  // SF district blocks — reuse existing textures
  await world.applyBlockTexture("Water",           allFaces, "/blocks/glass.png");
  await world.applyBlockTexture("Sand",            allFaces, "/blocks/dirt.png");
  // Bridge road deck — wood planks
  await world.applyBlockTexture("Plank",           allFaces, "/blocks/wood.png");
  // YC building — orange/brick facade
  await world.applyBlockTexture("Orange Concrete", allFaces, "/blocks/brick.png");
  // YC interior — use cobblestone (clean grey grid, no "?" look)
  await world.applyBlockTexture("White Concrete",  allFaces, "/blocks/cobblestone.png");
  // VC tower steel — dark stone
  await world.applyBlockTexture("Steel",           allFaces, "/blocks/dark_stone.png");
  // Encampment tent — stone (neutral grey)
  await world.applyBlockTexture("Tent Canvas",     allFaces, "/blocks/stone.png");
  // Cardboard — dirt (flat brown)
  await world.applyBlockTexture("Cardboard",       allFaces, "/blocks/dirt.png");
}

start();
