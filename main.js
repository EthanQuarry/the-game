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
      rigidControls.object.position,
      camera.getWorldDirection(new THREE.Vector3())
    );
    rigidControls.update();
    perspectives.update();
    lightShined.update();
    shadows.update();
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
