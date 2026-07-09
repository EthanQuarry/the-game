import * as THREE from "three";
import * as VOXELIZE from "@voxelize/core";

// ── Item registry ─────────────────────────────────────────────────────────────
// Every item type lives here. `makeData` returns fresh mutable item state.
// `makeMesh` returns a Three.js Object3D used for ground entities and slot previews.

export const ITEM_DEFS = {
  granola_bar: {
    name: "Granola Bar",
    maxStack: 10,
    makeData: () => ({}),
    makeMesh: () => {
      const g = new THREE.Group();
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.04, 0.08),
        new THREE.MeshLambertMaterial({ color: 0xc8a060 })
      );
      g.add(bar);
      return g;
    },
    use: (healFn) => healFn(20),
  },
  water: {
    name: "Water",
    maxStack: 10,
    makeData: () => ({}),
    makeMesh: () => {
      const g = new THREE.Group();
      const bottle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.14, 8),
        new THREE.MeshLambertMaterial({ color: 0x88ccff, transparent: true, opacity: 0.8 })
      );
      g.add(bottle);
      return g;
    },
    use: (healFn) => healFn(10),
  },
  pistol: {
    name: "Pistol",
    maxStack: 1,
    makeData: () => ({ ammo: 12, maxAmmo: 12 }),
    makeMesh: () => {
      const g = new THREE.Group();
      // Barrel
      const barrel = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.06, 0.28),
        new THREE.MeshLambertMaterial({ color: 0x222222 })
      );
      barrel.position.set(0, 0.02, 0.06);
      // Grip
      const grip = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.16, 0.08),
        new THREE.MeshLambertMaterial({ color: 0x333333 })
      );
      grip.position.set(0, -0.08, -0.06);
      // Slide
      const slide = new THREE.Mesh(
        new THREE.BoxGeometry(0.065, 0.07, 0.22),
        new THREE.MeshLambertMaterial({ color: 0x444444 })
      );
      slide.position.set(0, 0.055, 0.04);
      g.add(barrel, grip, slide);
      return g;
    },
  },
  shotgun: {
    name: "Shotgun",
    maxStack: 1,
    makeData: () => ({ ammo: 6, maxAmmo: 6 }),
    makeMesh: () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, 0.42),
        new THREE.MeshLambertMaterial({ color: 0x5c3d1e })
      );
      const barrel = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, 0.38),
        new THREE.MeshLambertMaterial({ color: 0x2a2a2a })
      );
      barrel.position.set(0, 0.055, -0.02);
      const stock = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.10, 0.16),
        new THREE.MeshLambertMaterial({ color: 0x3e2009 })
      );
      stock.position.set(0, -0.01, 0.24);
      g.add(body, barrel, stock);
      return g;
    },
  },
  ammo_9mm: {
    name: "9mm Ammo",
    maxStack: 99,
    makeData: () => ({}),
    makeMesh: () => {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8),
        new THREE.MeshLambertMaterial({ color: 0xd4a017 })
      );
      return mesh;
    },
  },
  clue_drive: {
    name: "Prototype Drive",
    maxStack: 1,
    makeData: () => ({ id: 'clue_drive' }),
    makeMesh: () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.06, 0.32),
        new THREE.MeshLambertMaterial({ color: 0xffd700 })
      );
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(0.10, 0.05, 0.10),
        new THREE.MeshLambertMaterial({ color: 0xaaaaaa })
      );
      cap.position.z = -0.18;
      g.add(body, cap);
      return g;
    },
  },
};

// ── Inventory (9-slot hotbar) ─────────────────────────────────────────────────
// Each slot: null  |  { id: string, count: number, data: object }

const SLOT_COUNT = 9;
const slots = new Array(SLOT_COUNT).fill(null);

export function getSlot(i) { return slots[i]; }
export function setSlot(i, item) { slots[i] = item; }

export function firstEmptySlot() {
  return slots.findIndex(s => s === null);
}

// Try to add an item — returns true if picked up, false if inventory full.
// Stackable items merge into existing stacks first.
export function addItem(id, count = 1, data = null) {
  const def = ITEM_DEFS[id];
  if (!def) return false;

  let remaining = count;

  if (def.maxStack > 1) {
    for (let i = 0; i < SLOT_COUNT && remaining > 0; i++) {
      const s = slots[i];
      if (s && s.id === id && s.count < def.maxStack) {
        const space = def.maxStack - s.count;
        const take = Math.min(space, remaining);
        s.count += take;
        remaining -= take;
      }
    }
  }

  while (remaining > 0) {
    const empty = firstEmptySlot();
    if (empty === -1) return false;
    const take = Math.min(def.maxStack, remaining);
    slots[empty] = { id, count: take, data: data ?? def.makeData() };
    remaining -= take;
  }
  return true;
}

// Remove the item in slot i entirely, return it.
export function removeSlot(i) {
  const item = slots[i];
  slots[i] = null;
  return item;
}

// ── Ground items ──────────────────────────────────────────────────────────────
// Each ground item: { mesh, id, data, bobOffset, pickupAnim, tossVel, settled }

export const groundItems = [];

// Spawn a ground item. If dropAnim is true, plays a throw arc from `position`
// (which should be camera/hand position) to a target ground point.
export function spawnGroundItem(id, data, position, dropAnim = false) {
  const def = ITEM_DEFS[id];
  if (!def) return;

  const root = new THREE.Group();
  root.userData.isGroundItem = true;
  root.userData.itemId = id;
  root.userData.itemData = data ?? def.makeData();

  const innerMesh = def.makeMesh();
  innerMesh.scale.setScalar(0.9);
  innerMesh.position.y = 0.12;
  root.add(innerMesh);

  root.position.copy(position);
  root.scale.setScalar(dropAnim ? 0.01 : 1); // start tiny if animating in

  const entry = {
    mesh: root,
    innerMesh,
    id,
    data: root.userData.itemData,
    pickupAnim: null,
    dropAnim: dropAnim ? { startTime: null, startPos: position.clone(), duration: 0.4 } : null,
    settled: !dropAnim,
    groundY: position.y,
  };

  groundItems.push(entry);
  return root;
}

// ── Hotbar UI ────────────────────────────────────────────────────────────────

let hotbar = null;
let focusedSlot = 0;

export function initHotbar(containerEl) {
  hotbar = new VOXELIZE.ItemSlots({
    horizontalCount: SLOT_COUNT,
    verticalCount: 1,
    slotWidth: 52,
    slotHeight: 52,
    slotGap: 4,
    wrapperStyles: {
      position: "fixed",
      bottom: "20px",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: "50",
    },
    slotStyles: {
      background: "rgba(0,0,0,0.55)",
      border: "2px solid rgba(255,255,255,0.2)",
      borderRadius: "6px",
    },
    slotFocusClass: "item-slots-slot-focus",
    slotSubscriptStyles: {
      position: "absolute",
      bottom: "3px",
      right: "5px",
      fontSize: "10px",
      color: "#fff",
      fontFamily: "monospace",
    },
  });

  if (containerEl) containerEl.appendChild(hotbar.wrapper);
  hotbar.activate();
  hotbar.setFocused(0, 0);

  hotbar.onFocusChange((prev, next) => {
    if (next) focusedSlot = next.col;
  });

  refreshHotbar();
  return hotbar;
}

export function getFocusedSlot() { return focusedSlot; }

export function refreshHotbar() {
  if (!hotbar) return;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const item = slots[i];
    if (!item) {
      hotbar.setObject(0, i, null);
      hotbar.setSubscript(0, i, "");
      continue;
    }
    const def = ITEM_DEFS[item.id];
    const previewMesh = def.makeMesh();
    previewMesh.scale.setScalar(def.maxStack === 1 ? 2.5 : 1.8);
    hotbar.setObject(0, i, previewMesh);

    let label = item.count > 1 ? `×${item.count}` : "";
    if (item.data && item.data.maxAmmo != null) label = `${item.data.ammo}/${item.data.maxAmmo}`;
    hotbar.setSubscript(0, i, label);
  }
}

// ── Pickup tooltip ────────────────────────────────────────────────────────────

let tooltipEl = null;

export function initPickupTooltip() {
  tooltipEl = document.createElement("div");
  tooltipEl.id = "pickup-tooltip";
  Object.assign(tooltipEl.style, {
    position: "fixed",
    bottom: "90px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(0,0,0,0.65)",
    color: "#fff",
    fontFamily: "monospace",
    fontSize: "13px",
    padding: "4px 12px",
    borderRadius: "4px",
    pointerEvents: "none",
    zIndex: "60",
    display: "none",
  });
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

// ── Main update (call every frame) ───────────────────────────────────────────

const _playerPos = new THREE.Vector3();
const PICKUP_RANGE = 2.2;

let _nearestGroundItem = null;
let _time = 0;

export function updateInventory(scene, playerPosition, dt) {
  _time += dt;
  _nearestGroundItem = null;
  let nearestDist = Infinity;

  for (let i = groundItems.length - 1; i >= 0; i--) {
    const entry = groundItems[i];
    const { mesh, innerMesh } = entry;

    // ── Drop arc animation ────────────────────────────────────────────────
    if (entry.dropAnim) {
      if (entry.dropAnim.startTime === null) entry.dropAnim.startTime = _time;
      const t = Math.min(1, (_time - entry.dropAnim.startTime) / entry.dropAnim.duration);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease-in-out quad
      // Lerp X/Z straight to target
      mesh.position.x = entry.dropAnim.startPos.x + (entry.dropAnim.targetPos.x - entry.dropAnim.startPos.x) * ease;
      mesh.position.z = entry.dropAnim.startPos.z + (entry.dropAnim.targetPos.z - entry.dropAnim.startPos.z) * ease;
      // Arc Y: parabola peaking halfway
      const arcHeight = 0.8;
      const baseY = entry.dropAnim.startPos.y + (entry.dropAnim.targetPos.y - entry.dropAnim.startPos.y) * ease;
      mesh.position.y = baseY + arcHeight * Math.sin(t * Math.PI);
      // Scale in from tiny
      mesh.scale.setScalar(0.1 + 0.9 * ease);
      // Spin during flight
      innerMesh.rotation.y = t * Math.PI * 3;

      if (t >= 1) {
        const target = entry.dropAnim.targetPos;
        entry.dropAnim = null;
        entry.settled = true;
        mesh.position.set(target.x, entry.groundY, target.z);
        mesh.scale.setScalar(1);
        innerMesh.rotation.y = 0;
      }
      continue; // skip pickup detection while animating
    }

    // ── Pickup animation ──────────────────────────────────────────────────
    if (entry.pickupAnim) {
      const { target, startTime, duration } = entry.pickupAnim;
      const t = Math.min(1, (_time - startTime) / duration);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
      mesh.position.lerp(target, ease * 0.18);
      mesh.scale.setScalar(1 - ease * 0.95);
      if (t >= 1) {
        scene.remove(mesh);
        groundItems.splice(i, 1);
        continue;
      }
    } else if (entry.settled) {
      mesh.position.y = entry.groundY; // pinned to ground
    }

    // ── Nearest item detection ────────────────────────────────────────────
    if (entry.settled && !entry.pickupAnim) {
      const dist = mesh.position.distanceTo(playerPosition);
      if (dist < PICKUP_RANGE && dist < nearestDist) {
        nearestDist = dist;
        _nearestGroundItem = entry;
      }
    }
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────
  if (tooltipEl) {
    if (_nearestGroundItem) {
      const def = ITEM_DEFS[_nearestGroundItem.id];
      tooltipEl.textContent = `[E]  Pick up ${def.name}`;
      tooltipEl.style.display = "block";
    } else {
      tooltipEl.style.display = "none";
    }
  }
}

// ── Pickup action (call on E key) ─────────────────────────────────────────────

export function tryPickup(scene, cameraWorldPos) {
  if (!_nearestGroundItem) return false;
  const entry = _nearestGroundItem;
  const def = ITEM_DEFS[entry.id];

  if (entry.id === "ammo_9mm") {
    // Top up any pistol in inventory first
    let reloaded = false;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const s = slots[i];
      if (s && s.id === "pistol" && s.data.ammo < s.data.maxAmmo) {
        s.data.ammo = s.data.maxAmmo;
        reloaded = true;
        break;
      }
    }
    if (!reloaded) {
      const got = addItem(entry.id, 12, {});
      if (!got) return false;
    }
  } else {
    const got = addItem(entry.id, 1, entry.data ? { ...entry.data } : def.makeData());
    if (!got) return false;
  }

  // Fly-to-camera pickup animation
  entry.pickupAnim = {
    target: cameraWorldPos.clone(),
    startTime: _time,
    duration: 0.22,
  };

  refreshHotbar();
  return true;
}

// ── Drop action (call on Q key) ───────────────────────────────────────────────

export function tryDrop(scene, playerPosition, dropDir) {
  const item = slots[focusedSlot];
  if (!item) return;

  // Target spot: 1.5 blocks in front, on the ground
  const targetPos = playerPosition.clone();
  targetPos.x += dropDir.x * 1.5;
  targetPos.z += dropDir.z * 1.5;
  const floorY = scene.getMaxHeightAt
    ? (scene.getMaxHeightAt(targetPos.x, targetPos.z) ?? Math.floor(playerPosition.y - 1))
    : Math.floor(playerPosition.y - 1);
  targetPos.y = floorY;

  const mesh = spawnGroundItem(item.id, { ...item.data }, targetPos, true);
  if (!mesh) return;

  // Arc starts at eye/hand position
  mesh.position.copy(playerPosition);

  const entry = groundItems[groundItems.length - 1];
  entry.dropAnim.startPos = playerPosition.clone();
  entry.dropAnim.targetPos = targetPos.clone();
  entry.groundY = floorY;

  scene.add(mesh);

  removeSlot(focusedSlot);
  refreshHotbar();
}

// ── Scroll hotbar (call on wheel) ─────────────────────────────────────────────

export function scrollHotbar(delta) {
  if (!hotbar) return;
  focusedSlot = (focusedSlot + (delta > 0 ? 1 : -1) + SLOT_COUNT) % SLOT_COUNT;
  hotbar.setFocused(0, focusedSlot);
}

export function setFocusedSlot(i) {
  if (!hotbar || i < 0 || i >= SLOT_COUNT) return;
  focusedSlot = i;
  hotbar.setFocused(0, focusedSlot);
}

// groundItems already exported above
