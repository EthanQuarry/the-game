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

inputs.bind("KeyG", rigidControls.toggleGhostMode, "in-game");
inputs.bind("KeyF", rigidControls.toggleFly, "in-game");

rigidControls.on("lock", () => inputs.setNamespace("in-game"));
rigidControls.on("unlock", () => inputs.setNamespace("menu"));

const overlay = document.getElementById("overlay");
// Overlay is pointer-events:none so clicks pass through to the canvas.
// RigidControls' own canvas click handler requests pointer lock.
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === canvas) {
    overlay.classList.add("hidden");
  } else {
    overlay.classList.remove("hidden");
  }
});

function animate() {
  requestAnimationFrame(animate);

  if (world.isInitialized) {
    world.update(
      camera.getWorldPosition(new THREE.Vector3()),
      camera.getWorldDirection(new THREE.Vector3())
    );

    rigidControls.update();
  }

  renderer.render(world, camera);
}

async function start() {
  animate();

  await network.connect("http://localhost:4000");
  await network.join("tutorial");

  await world.initialize();

  world.addChunkInitListener([0, 0], () => {
    rigidControls.teleportToTop(0, 0);
  });

  world.sky.setShadingPhases([
    {
      name: "sunrise",
      color: {
        top: new THREE.Color("#7694CF"),
        middle: new THREE.Color("#B0483A"),
        bottom: new THREE.Color("#222"),
      },
      skyOffset: 0.05,
      voidOffset: 0.6,
      start: 0.2,
    },
    {
      name: "daylight",
      color: {
        top: new THREE.Color("#73A3FB"),
        middle: new THREE.Color("#B1CCFD"),
        bottom: new THREE.Color("#222"),
      },
      skyOffset: 0,
      voidOffset: 0.6,
      start: 0.25,
    },
    {
      name: "sunset",
      color: {
        top: new THREE.Color("#A57A59"),
        middle: new THREE.Color("#FC5935"),
        bottom: new THREE.Color("#222"),
      },
      skyOffset: 0.05,
      voidOffset: 0.6,
      start: 0.7,
    },
    {
      name: "night",
      color: {
        top: new THREE.Color("#000"),
        middle: new THREE.Color("#000"),
        bottom: new THREE.Color("#000"),
      },
      skyOffset: 0.1,
      voidOffset: 0.6,
      start: 0.75,
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
