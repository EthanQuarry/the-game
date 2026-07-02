import * as THREE from "three";
import * as VOXELIZE from "@voxelize/core";

// ── Item registry ─────────────────────────────────────────────────────────────
// Every item type lives here. `makeData` returns fresh mutable item state.
// `makeMesh` returns a Three.js Object3D used for ground entities and slot previews.

export const ITEM_DEFS = {
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

const groundItems = [];

const _up = new THREE.Vector3(0, 1, 0);
const _gravity = -0.016;

export function spawnGroundItem(id, data, position, tossDir = null) {
  const def = ITEM_DEFS[id];
  if (!def) return;

  const root = new THREE.Group();
  root.userData.isGroundItem = true;
  root.userData.itemId = id;
  root.userData.itemData = data ?? def.makeData();

  const innerMesh = def.makeMesh();
  innerMesh.scale.setScalar(0.5);
  // Lay flat on the ground — rotate so the gun's Z-axis points up
  innerMesh.rotation.x = Math.PI / 2;
  root.add(innerMesh);

  root.position.copy(position); // caller places y directly on the surface

  const entry = {
    mesh: root,
    innerMesh,
    id,
    data: root.userData.itemData,
    spinOffset: Math.random() * Math.PI * 2,
    pickupAnim: null,
    settled: !tossDir,
    tossVel: tossDir
      ? new THREE.Vector3(tossDir.x * 0.18, 0.22, tossDir.z * 0.18)
      : new THREE.Vector3(),
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
    if (item.id === "pistol") label = `${item.data.ammo}/${item.data.maxAmmo}`;
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

    // ── Toss physics ──────────────────────────────────────────────────────
    if (!entry.settled) {
      entry.tossVel.y += _gravity;
      mesh.position.add(entry.tossVel);
      if (mesh.position.y <= entry.groundY) {
        mesh.position.y = entry.groundY;
        entry.tossVel.set(0, 0, 0);
        entry.settled = true;
      }
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
      // ── Idle bob + spin ───────────────────────────────────────────────
      mesh.position.y = entry.groundY; // stay flat on the ground
      innerMesh.rotation.z = _time * 0.6 + entry.spinOffset; // slow spin around up-axis (Z after X-tilt)
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

  const groundPos = playerPosition.clone();
  groundPos.y -= 0.5;

  const mesh = spawnGroundItem(item.id, { ...item.data }, groundPos, dropDir);
  if (mesh) scene.add(mesh);

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

export { groundItems };
