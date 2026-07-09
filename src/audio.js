// ── Synthesized gun audio — R6-style ─────────────────────────────────────────

let _ctx = null;

function ctx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === "suspended") _ctx.resume();
  return _ctx;
}

// Waveshaper distortion curve — clips the signal hard for that "crack"
function makeDistortionCurve(amount) {
  const n = 256, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

// White noise buffer source
function noiseSource(c, duration) {
  const len = Math.ceil(c.sampleRate * duration);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  return src;
}

// Master compressor to glue layers together
function masterChain(c) {
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -6;
  comp.knee.value = 0;
  comp.ratio.value = 20;
  comp.attack.value = 0.0001;
  comp.release.value = 0.08;
  comp.connect(c.destination);
  return comp;
}

// ── Pistol ────────────────────────────────────────────────────────────────────
// Glock-style: sharp pop, punchy mid, fast decay
export function playPistolShot() {
  const c = ctx();
  const now = c.currentTime;
  const out = masterChain(c);

  // Layer 1: initial transient crack — high freq noise, very short
  {
    const src = noiseSource(c, 0.003);
    const filt = c.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = 8000;
    filt.Q.value = 0.5;
    const g = c.createGain();
    g.gain.setValueAtTime(6.0, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.003);
    src.connect(filt); filt.connect(g); g.connect(out);
    src.start(now); src.stop(now + 0.003);
  }

  // Layer 2: mid crack — bandpass noise + distortion
  {
    const src = noiseSource(c, 0.06);
    const filt = c.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = 2200;
    filt.Q.value = 1.2;
    const dist = c.createWaveShaper();
    dist.curve = makeDistortionCurve(180);
    const g = c.createGain();
    g.gain.setValueAtTime(2.5, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    src.connect(filt); filt.connect(dist); dist.connect(g); g.connect(out);
    src.start(now); src.stop(now + 0.07);
  }

  // Layer 3: body thump — swept sine, falls from 200→40 Hz
  {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.08);
    const g = c.createGain();
    g.gain.setValueAtTime(1.8, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(g); g.connect(out);
    osc.start(now); osc.stop(now + 0.1);
  }

  // Layer 4: low rumble noise
  {
    const src = noiseSource(c, 0.12);
    const filt = c.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 300;
    const g = c.createGain();
    g.gain.setValueAtTime(1.0, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    src.connect(filt); filt.connect(g); g.connect(out);
    src.start(now); src.stop(now + 0.12);
  }

  // Layer 5: mechanical slide click at ~85ms
  {
    const src = noiseSource(c, 0.018);
    const filt = c.createBiquadFilter();
    filt.type = "highpass";
    filt.frequency.value = 5000;
    const g = c.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.setValueAtTime(0.7, now + 0.085);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    src.connect(filt); filt.connect(g); g.connect(out);
    src.start(now + 0.085); src.stop(now + 0.1);
  }
}

// ── Shotgun ───────────────────────────────────────────────────────────────────
// SPAS-style: massive boom, wide spread, longer decay
export function playShotgunShot() {
  const c = ctx();
  const now = c.currentTime;
  const out = masterChain(c);

  // Layer 1: initial blast — broadband noise, full frequency
  {
    const src = noiseSource(c, 0.005);
    const g = c.createGain();
    g.gain.setValueAtTime(8.0, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.005);
    const dist = c.createWaveShaper();
    dist.curve = makeDistortionCurve(400);
    src.connect(dist); dist.connect(g); g.connect(out);
    src.start(now); src.stop(now + 0.005);
  }

  // Layer 2: wide crack — filtered noise
  {
    const src = noiseSource(c, 0.15);
    const filt = c.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = 1600;
    filt.Q.value = 0.6;
    const dist = c.createWaveShaper();
    dist.curve = makeDistortionCurve(220);
    const g = c.createGain();
    g.gain.setValueAtTime(3.5, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    src.connect(filt); filt.connect(dist); dist.connect(g); g.connect(out);
    src.start(now); src.stop(now + 0.18);
  }

  // Layer 3: deep bass thump — sweeps 180→25 Hz
  {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(22, now + 0.22);
    const g = c.createGain();
    g.gain.setValueAtTime(3.5, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(g); g.connect(out);
    osc.start(now); osc.stop(now + 0.25);
  }

  // Layer 4: sub bass rumble noise
  {
    const src = noiseSource(c, 0.28);
    const filt = c.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 180;
    const g = c.createGain();
    g.gain.setValueAtTime(2.2, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    src.connect(filt); filt.connect(g); g.connect(out);
    src.start(now); src.stop(now + 0.28);
  }

  // Layer 5: pump action at ~220ms
  {
    const src = noiseSource(c, 0.05);
    const filt = c.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = 900;
    filt.Q.value = 2;
    const g = c.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.setValueAtTime(1.2, now + 0.22);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.27);
    src.connect(filt); filt.connect(g); g.connect(out);
    src.start(now + 0.22); src.stop(now + 0.28);
  }
}

// ── Empty click ───────────────────────────────────────────────────────────────
export function playEmptyClick() {
  const c = ctx();
  const now = c.currentTime;

  const src = noiseSource(c, 0.022);
  const filt = c.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = 6500;
  filt.Q.value = 3;
  const g = c.createGain();
  g.gain.setValueAtTime(0.5, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.022);
  src.connect(filt); filt.connect(g); g.connect(c.destination);
  src.start(now); src.stop(now + 0.022);
}

// ── Reload ────────────────────────────────────────────────────────────────────
export function playReload() {
  const c = ctx();

  const click = (when, freq, dur, vol) => {
    const now = c.currentTime + when;
    const src = noiseSource(c, dur);
    const filt = c.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = freq;
    filt.Q.value = 2.5;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(filt); filt.connect(g); g.connect(c.destination);
    src.start(now); src.stop(now + dur);
  };

  click(0,    1200, 0.04, 0.4);  // mag release click
  click(0.04, 400,  0.06, 0.35); // mag out thud
  click(0.28, 1400, 0.035, 0.5); // mag in click
  click(0.32, 500,  0.05, 0.4);  // mag seat thud
  click(0.48, 3000, 0.025, 0.6); // slide rack
  click(0.52, 800,  0.04, 0.45); // slide close
}

// ── Distant shot (3D positional) ──────────────────────────────────────────────
export function playDistantShot(listenerPos, shooterPos, weaponKey) {
  const c = ctx();
  const now = c.currentTime;

  const dx = shooterPos[0] - listenerPos[0];
  const dy = shooterPos[1] - listenerPos[1];
  const dz = shooterPos[2] - listenerPos[2];
  const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
  if (dist > 100) return;

  const vol = Math.max(0, 1 - dist / 80) * 0.8;
  const dur = weaponKey === "shotgun" ? 0.22 : 0.14;
  const cutoff = weaponKey === "shotgun" ? 1200 : 2000;

  const src = noiseSource(c, dur);
  const filt = c.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = cutoff * (1 - dist / 120); // high freqs fall off with distance

  const panner = c.createPanner();
  panner.panningModel = "HRTF";
  panner.distanceModel = "inverse";
  panner.refDistance = 2;
  panner.maxDistance = 100;
  panner.rolloffFactor = 1.5;
  panner.positionX.value = dx;
  panner.positionY.value = dy;
  panner.positionZ.value = dz;

  const thumpOsc = c.createOscillator();
  thumpOsc.type = "sine";
  thumpOsc.frequency.setValueAtTime(weaponKey === "shotgun" ? 90 : 120, now);
  thumpOsc.frequency.exponentialRampToValueAtTime(20, now + dur);
  const thumpG = c.createGain();
  thumpG.gain.setValueAtTime(vol * 1.5, now);
  thumpG.gain.exponentialRampToValueAtTime(0.001, now + dur);

  const g = c.createGain();
  g.gain.setValueAtTime(vol, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + dur);

  src.connect(filt); filt.connect(panner); panner.connect(g); g.connect(c.destination);
  thumpOsc.connect(thumpG); thumpG.connect(panner);
  src.start(now); src.stop(now + dur);
  thumpOsc.start(now); thumpOsc.stop(now + dur);
}

// ── Atmosphere & Immersion ─────────────────────────────────────────────────────

// ── 1. City ambient soundscape ─────────────────────────────────────────────────
// Uses Web Audio oscillators + filtered noise — zero external files.

let _ambCtx = null;
let _ambStarted = false;
let _droneNode = null;      // tension drone oscillator
let _droneGain = null;      // gain node for drone (so we can fade it)
let _droneTarget = 0;       // target gain value (0 or 0.18)

function ambCtx() {
  if (!_ambCtx) {
    _ambCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_ambCtx.state === "suspended") _ambCtx.resume();
  }
  return _ambCtx;
}

export function startAmbience() {
  if (_ambStarted) return;
  _ambStarted = true;
  const c = ambCtx();

  // Master limiter — keeps ambience from clipping over gun sounds
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 3;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  limiter.connect(c.destination);

  // ── Traffic hum: low-pass filtered noise, slow AM modulation ──────────────
  (function trafficHum() {
    function buildHumCycle() {
      const now = c.currentTime;
      const dur = 12 + Math.random() * 8; // 12-20s per cycle

      // Broadband noise source
      const len = Math.ceil(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource();
      src.buffer = buf;

      // Low-pass: 180 Hz simulates tyres + engine mass
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 180;
      lp.Q.value = 0.8;

      // Gentle high-pass to cut sub rumble
      const hp = c.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 60;

      // AM swell — ramp up, sustain, ramp down
      const g = c.createGain();
      const peak = 0.04 + Math.random() * 0.03;
      g.gain.setValueAtTime(0.005, now);
      g.gain.linearRampToValueAtTime(peak, now + dur * 0.25);
      g.gain.setValueAtTime(peak, now + dur * 0.7);
      g.gain.linearRampToValueAtTime(0.005, now + dur);

      src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(limiter);
      src.start(now); src.stop(now + dur);
      src.onended = buildHumCycle; // chain next cycle immediately
    }
    buildHumCycle();
  })();

  // ── Wind: bandpass noise swept slowly ─────────────────────────────────────
  (function wind() {
    function buildWindCycle() {
      const now = c.currentTime;
      const dur = 6 + Math.random() * 10;

      const len = Math.ceil(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource();
      src.buffer = buf;

      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      // Sweep centre frequency: 300-800 Hz over the cycle
      const f0 = 300 + Math.random() * 200;
      const f1 = f0 + 200 + Math.random() * 300;
      bp.frequency.setValueAtTime(f0, now);
      bp.frequency.linearRampToValueAtTime(f1, now + dur * 0.6);
      bp.frequency.linearRampToValueAtTime(f0 + 50, now + dur);
      bp.Q.value = 2.5;

      const g = c.createGain();
      const peak = 0.015 + Math.random() * 0.015;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(peak, now + dur * 0.3);
      g.gain.linearRampToValueAtTime(0, now + dur);

      src.connect(bp); bp.connect(g); g.connect(limiter);
      src.start(now); src.stop(now + dur);
      src.onended = () => setTimeout(buildWindCycle, 500 + Math.random() * 3000);
    }
    buildWindCycle();
  })();

  // ── Distant dog bark: occasional short noise burst, mid-band ──────────────
  (function dogBarks() {
    function scheduleNextBark() {
      // One bark every 18-55 seconds
      const delay = (18 + Math.random() * 37) * 1000;
      setTimeout(() => {
        const now = c.currentTime;
        // Each bark = 3 rapid bursts of shaped noise (rough/woof cadence)
        for (let b = 0; b < 3; b++) {
          const t = now + b * 0.18;
          const blen = Math.ceil(c.sampleRate * 0.14);
          const bbuf = c.createBuffer(1, blen, c.sampleRate);
          const bd = bbuf.getChannelData(0);
          for (let i = 0; i < blen; i++) bd[i] = Math.random() * 2 - 1;
          const bsrc = c.createBufferSource();
          bsrc.buffer = bbuf;

          const bp = c.createBiquadFilter();
          bp.type = "bandpass";
          bp.frequency.value = 900 + Math.random() * 400;
          bp.Q.value = 1.5;

          // Pitch sweep: barks start high and fall
          bp.frequency.setValueAtTime(bp.frequency.value, t);
          bp.frequency.exponentialRampToValueAtTime(bp.frequency.value * 0.55, t + 0.13);

          const bg = c.createGain();
          bg.gain.setValueAtTime(0.07, t);
          bg.gain.exponentialRampToValueAtTime(0.001, t + 0.13);

          bsrc.connect(bp); bp.connect(bg); bg.connect(limiter);
          bsrc.start(t); bsrc.stop(t + 0.15);
        }
        scheduleNextBark();
      }, delay);
    }
    scheduleNextBark();
  })();

  // ── 3. Tension drone setup — persistent low oscillator, gain starts 0 ─────
  const droneOsc = c.createOscillator();
  droneOsc.type = "sawtooth";
  droneOsc.frequency.value = 55; // A1 — ominous sub

  // Second detuned oscillator for beating
  const droneOsc2 = c.createOscillator();
  droneOsc2.type = "sine";
  droneOsc2.frequency.value = 57.5; // slightly off → 2.5 Hz beat frequency

  // Low-pass so it stays sub/rumble
  const droneLp = c.createBiquadFilter();
  droneLp.type = "lowpass";
  droneLp.frequency.value = 220;
  droneLp.Q.value = 0.7;

  const droneG = c.createGain();
  droneG.gain.value = 0; // start silent
  _droneNode = droneOsc;
  _droneGain = droneG;

  droneOsc.connect(droneLp);
  droneOsc2.connect(droneLp);
  droneLp.connect(droneG);
  droneG.connect(limiter);
  droneOsc.start();
  droneOsc2.start();
}

// Called every frame from main.js animate() — smoothly ramps drone
export function setDroneTarget(active) {
  _droneTarget = active ? 0.18 : 0;
}

// Per-frame smooth gain interpolation for drone (call from animate)
export function updateDroneGain() {
  if (!_droneGain) return;
  const c = ambCtx();
  const now = c.currentTime;
  const cur = _droneGain.gain.value;
  const delta = _droneTarget - cur;
  if (Math.abs(delta) > 0.0005) {
    // Lerp at 1.5 units/sec
    _droneGain.gain.setTargetAtTime(_droneTarget, now, 0.6);
  }
}

// ── 2. Footstep sounds ────────────────────────────────────────────────────────
// surface: 'road' (default) | 'grass'
// Road: sharp high-mid click + short noise burst (concrete heel strike)
// Grass: soft low thud + muffled noise (earth + grass compression)

export function playFootstep(surface = 'road') {
  const c = ambCtx();
  const now = c.currentTime;

  if (surface === 'grass') {
    // Soft thud: low noise burst + muffled impact
    const len = Math.ceil(c.sampleRate * 0.06);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;

    const lp = c.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 400; lp.Q.value = 0.5;

    const g = c.createGain();
    g.gain.setValueAtTime(0.25, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

    src.connect(lp); lp.connect(g); g.connect(c.destination);
    src.start(now); src.stop(now + 0.06);

  } else {
    // Road: transient click + quick noise burst
    // Click — bandpass at 3500 Hz (heel on concrete)
    {
      const len = Math.ceil(c.sampleRate * 0.025);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource();
      src.buffer = buf;

      const bp = c.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 3500; bp.Q.value = 3;

      const g = c.createGain();
      g.gain.setValueAtTime(0.32, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.022);

      src.connect(bp); bp.connect(g); g.connect(c.destination);
      src.start(now); src.stop(now + 0.025);
    }
    // Body — low thud at ~200 Hz (weight transfer)
    {
      const osc = c.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(210, now);
      osc.frequency.exponentialRampToValueAtTime(60, now + 0.04);
      const g = c.createGain();
      g.gain.setValueAtTime(0.18, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
      osc.connect(g); g.connect(c.destination);
      osc.start(now); osc.stop(now + 0.05);
    }
  }
}

// ── Per-frame atmosphere orchestrator (called from main.js animate) ───────────
// controls: VOXELIZE.RigidControls
// npcs: Map<id, NpcObj>
// currentWeaponKey: string|null
// lastCombatTime: number — performance.now() of last shot/damage

export function updateAtmosphere(dt, playerPos, npcs, currentWeaponKey, lastCombatTime) {
  if (!_ambStarted) return;

  // 3. Drone: active if Marcus is within 20 units OR a weapon is drawn
  let droneActive = !!currentWeaponKey;
  if (!droneActive) {
    const marcus = npcs.get("marcus");
    if (marcus && !marcus.dead) {
      const dx = marcus.pos.x - playerPos.x;
      const dz = marcus.pos.z - playerPos.z;
      droneActive = (dx*dx + dz*dz) < 400; // 20 units radius
    }
  }
  setDroneTarget(droneActive);
  updateDroneGain();
}
