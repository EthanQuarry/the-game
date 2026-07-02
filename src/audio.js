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
