// r10's 3D body: the "utility droid v2" rig, rendered live with three.js.
// Geometry is ported from the v2 design; this module adds lighting, a fixed
// camera, and procedural animation driven by r10's states.
import * as THREE from 'three';

const M = {
  shell:  new THREE.MeshStandardMaterial({ name: 'shell',  color: '#eceae7', roughness: 0.42, metalness: 0.15 }),
  ink:    new THREE.MeshStandardMaterial({ name: 'ink',    color: '#201e1d', roughness: 0.55, metalness: 0.20 }),
  cyan:   new THREE.MeshStandardMaterial({ name: 'cyan',   color: '#0088b0', roughness: 0.35, metalness: 0.20 }),
  magenta:new THREE.MeshStandardMaterial({ name: 'magenta',color: '#d6006c', roughness: 0.35, metalness: 0.20 }),
  chrome: new THREE.MeshStandardMaterial({ name: 'chrome', color: '#b8b6b2', roughness: 0.28, metalness: 0.38 }),
  glass:  new THREE.MeshStandardMaterial({ name: 'glass',  color: '#12181c', roughness: 0.12, metalness: 0.30 }),
  rubber: new THREE.MeshStandardMaterial({ name: 'rubber', color: '#2e2b29', roughness: 0.9,  metalness: 0.0 }),
};
// Animated lights get their own materials so they can glow independently.
const glow = (name, color) => new THREE.MeshStandardMaterial({ name, color, emissive: color, emissiveIntensity: 1, roughness: 0.3, metalness: 0 });
const L = {
  iris:    glow('iris', '#19c3f0'),
  antenna: glow('antenna_tip', '#d6006c'),
  readout: glow('readout', '#0088b0'),
  service: glow('service_light', '#d6006c'),
  holo:    glow('holo_lens', '#0088b0'),
};

const add = (parent, name, geo, mat, pos, rot) => {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(m);
  return m;
};
// Joint: a pivot group at `p`, with a child frame offset back so parts use world coords.
const joint = (parent, name, p) => {
  const pivot = new THREE.Group(); pivot.name = name; pivot.position.set(p[0], p[1], p[2]); parent.add(pivot);
  const frame = new THREE.Group(); frame.name = name + '_frame'; frame.position.set(-p[0], -p[1], -p[2]); pivot.add(frame);
  return { pivot, frame };
};
const X90 = [0, 0, Math.PI / 2];
const R = 0.24, BOT = 0.30, TOP = 0.92, SHOULDER = 0.80, DOME_Y = TOP + 0.012;
const CZ = 0.175, C_PIN = 0.10, HINGE = 0.125;

function buildDroid() {
  const droid = new THREE.Group();
  droid.name = 'utility_droid';

  /* ================= BODY (tilts about the shoulder axis) ================= */
  const body = joint(droid, 'body_tilt_joint', [0, SHOULDER, 0]);
  const B = body.frame;

  add(B, 'body_barrel', new THREE.CylinderGeometry(R, R, TOP - BOT, 56, 1, true), M.shell, [0, (TOP + BOT) / 2, 0]);

  // Floor with a slot for the retracting centre leg
  const floorShape = new THREE.Shape();
  floorShape.absarc(0, 0, R - 0.002, 0, Math.PI * 2, false);
  const slot = new THREE.Path();
  slot.moveTo(-0.05, -0.225); slot.lineTo(0.05, -0.225); slot.lineTo(0.05, -0.12); slot.lineTo(-0.05, -0.12); slot.closePath();
  floorShape.holes.push(slot);
  const floorGeo = new THREE.ExtrudeGeometry(floorShape, { depth: 0.04, bevelEnabled: false, curveSegments: 48 });
  floorGeo.rotateX(-Math.PI / 2);
  add(B, 'body_floor_slotted', floorGeo, M.ink, [0, 0.29, 0]);

  [[0.875, 0.028], [0.615, 0.020], [0.360, 0.024]].forEach(([y, h], i) => {
    add(B, `body_band_${i + 1}`, new THREE.CylinderGeometry(R + 0.006, R + 0.006, h, 56), M.ink, [0, y, 0]);
  });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 16;
    add(B, `body_seam_${i + 1}`, new THREE.BoxGeometry(0.012, 0.50, 0.014), M.ink,
      [Math.sin(a) * (R - 0.002), 0.615, Math.cos(a) * (R - 0.002)], [0, a, 0]);
  }
  const facePanel = (name, mat, y, w, h, ang = 0, lift = 0) =>
    add(B, name, new THREE.BoxGeometry(w, h, 0.03), mat, [Math.sin(ang) * (R - 0.012 + lift), y, Math.cos(ang) * (R - 0.012 + lift)], [0, ang, 0]);
  facePanel('panel_data_main', M.ink, 0.760, 0.22, 0.13);
  facePanel('panel_readout', L.readout, 0.760, 0.17, 0.045, 0, 0.002);
  facePanel('panel_hatch_upper', M.ink, 0.500, 0.20, 0.16);
  facePanel('panel_hatch_grip', M.chrome, 0.500, 0.13, 0.018, 0, 0.002);
  facePanel('panel_vent', M.ink, 0.455, 0.16, 0.05, Math.PI * 0.62);
  facePanel('panel_service_light', L.service, 0.800, 0.045, 0.045, -Math.PI * 0.55);
  facePanel('panel_charge_port', M.chrome, 0.700, 0.07, 0.07, Math.PI);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI * 0.62;
    add(B, `vent_slat_${i + 1}`, new THREE.BoxGeometry(0.14, 0.008, 0.012), M.chrome,
      [Math.sin(a) * (R + 0.002), 0.435 + i * 0.014, Math.cos(a) * (R + 0.002)], [0, a, 0]);
  }

  // Shoulder bearing seats on the body
  [-1, 1].forEach((s) => {
    const tag = s < 0 ? 'left' : 'right';
    add(B, `shoulder_bearing_${tag}`, new THREE.TorusGeometry(0.07, 0.008, 12, 40).rotateY(Math.PI / 2), M.chrome, [s * 0.232, SHOULDER, 0]);
    add(B, `shoulder_hub_${tag}`, new THREE.CylinderGeometry(0.06, 0.06, 0.04, 32), M.ink, [s * 0.24, SHOULDER, 0], X90);
  });

  /* ---------- dome on a slewing bearing ---------- */
  add(B, 'dome_bearing_ring', new THREE.CylinderGeometry(R - 0.018, R - 0.018, 0.014, 56), M.chrome, [0, TOP + 0.005, 0]);
  add(B, 'dome_drive_gear', new THREE.CylinderGeometry(0.03, 0.03, 0.014, 20), M.ink, [0.17, TOP + 0.005, -0.12]);
  const dome = joint(B, 'dome_rotate_joint', [0, DOME_Y, 0]);
  const D = dome.frame;
  add(D, 'dome_shell', new THREE.SphereGeometry(R, 56, 28, 0, Math.PI * 2, 0, Math.PI / 2), M.shell, [0, DOME_Y, 0]);
  add(D, 'dome_lip', new THREE.CylinderGeometry(R + 0.008, R + 0.008, 0.03, 56), M.ink, [0, DOME_Y + 0.008, 0]);
  [[-0.42, M.cyan, 0.34], [0.62, M.ink, 0.30], [2.30, M.ink, 0.26], [3.60, M.cyan, 0.22], [4.85, M.magenta, 0.18]]
    .forEach(([a, mat, span], i) => {
      add(D, `dome_panel_${i + 1}`, new THREE.SphereGeometry(R + 0.004, 24, 14, a, span, Math.PI * 0.14, Math.PI * 0.30), mat, [0, DOME_Y, 0]);
    });
  add(D, 'dome_crown', new THREE.CylinderGeometry(0.075, 0.085, 0.02, 32), M.ink, [0, DOME_Y + R - 0.004, 0]);
  add(D, 'dome_antenna', new THREE.CylinderGeometry(0.006, 0.006, 0.14, 16), M.chrome, [0.05, DOME_Y + R + 0.06, -0.03]);
  add(D, 'dome_antenna_tip', new THREE.SphereGeometry(0.012, 20, 14), L.antenna, [0.05, DOME_Y + R + 0.13, -0.03]);
  const yUp = new THREE.Vector3(0, 1, 0);
  const domeMount = (name, geo, mat, azim, elev, lift = 0) => {
    const n = new THREE.Vector3(Math.sin(azim) * Math.cos(elev), Math.sin(elev), Math.cos(azim) * Math.cos(elev));
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.quaternion.setFromUnitVectors(yUp, n);
    m.position.copy(n).multiplyScalar(R - 0.01 + lift).add(new THREE.Vector3(0, DOME_Y, 0));
    D.add(m);
    return m;
  };
  domeMount('eye_housing', new THREE.CylinderGeometry(0.055, 0.058, 0.05, 32), M.ink, 0, 0.42, 0.012);
  domeMount('eye_bezel', new THREE.TorusGeometry(0.042, 0.009, 12, 28).rotateX(Math.PI / 2), M.chrome, 0, 0.42, 0.036);
  domeMount('eye_lens', new THREE.CylinderGeometry(0.036, 0.036, 0.016, 32), M.glass, 0, 0.42, 0.044);
  // Glowing iris in the lens; squashing it along its local Z is the blink.
  const iris = domeMount('eye_iris', new THREE.CylinderGeometry(0.018, 0.018, 0.004, 32), L.iris, 0, 0.42, 0.053);
  domeMount('projector_holo', new THREE.CylinderGeometry(0.022, 0.026, 0.03, 24), M.chrome, -1.15, 0.62, 0.006);
  domeMount('projector_lens', new THREE.CylinderGeometry(0.016, 0.016, 0.01, 24), L.holo, -1.15, 0.62, 0.024);
  domeMount('sensor_pod', new THREE.CylinderGeometry(0.018, 0.018, 0.05, 20), M.ink, 1.35, 0.55, 0.014);
  domeMount('sensor_lens', new THREE.SphereGeometry(0.016, 20, 14), M.glass, 1.35, 0.55, 0.040);
  domeMount('dome_port_a', new THREE.CylinderGeometry(0.026, 0.026, 0.012, 20), M.ink, 2.60, 0.30, 0.004);
  domeMount('dome_port_b', new THREE.CylinderGeometry(0.026, 0.026, 0.012, 20), M.ink, 4.10, 0.30, 0.004);

  /* ---------- centre leg: slides on rails through the floor slot ---------- */
  [-1, 1].forEach((s) => add(B, `center_rail_${s < 0 ? 'left' : 'right'}`, new THREE.CylinderGeometry(0.008, 0.008, 0.34, 12), M.chrome, [s * 0.07, 0.50, CZ]));
  add(B, 'center_actuator', new THREE.CylinderGeometry(0.014, 0.014, 0.26, 16), M.ink, [0, 0.54, CZ - 0.04]);
  const slide = new THREE.Group(); slide.name = 'center_leg_slide'; B.add(slide);
  add(slide, 'center_carriage', new THREE.BoxGeometry(0.13, 0.04, 0.1), M.chrome, [0, 0.36, CZ]);
  add(slide, 'center_leg', new THREE.BoxGeometry(0.085, 0.24, 0.085), M.shell, [0, 0.25, CZ]);
  add(slide, 'center_leg_trim', new THREE.BoxGeometry(0.089, 0.022, 0.089), M.ink, [0, 0.165, CZ]);
  add(slide, 'center_ankle', new THREE.BoxGeometry(0.075, 0.04, 0.08), M.ink, [0, 0.11, CZ]);
  add(slide, 'center_ankle_pin', new THREE.CylinderGeometry(0.013, 0.013, 0.11, 16), M.chrome, [0, C_PIN, CZ], X90);
  const cAnkle = joint(slide, 'center_ankle_joint', [0, C_PIN, CZ]);
  {
    const F = cAnkle.frame, fz = 0.185;
    [-1, 1].forEach((s) => add(F, `center_clevis_${s < 0 ? 'left' : 'right'}`, new THREE.BoxGeometry(0.01, 0.045, 0.05), M.chrome, [s * 0.047, 0.09, CZ]));
    add(F, 'center_foot_top', new THREE.BoxGeometry(0.115, 0.02, 0.235), M.ink, [0, 0.065, fz]);
    [-1, 1].forEach((s) => add(F, `center_foot_wall_${s < 0 ? 'left' : 'right'}`, new THREE.BoxGeometry(0.01, 0.04, 0.235), M.ink, [s * 0.0525, 0.035, fz]));
    [-1, 1].forEach((s) => add(F, `center_foot_wall_${s < 0 ? 'rear' : 'front'}`, new THREE.BoxGeometry(0.095, 0.04, 0.01), M.ink, [0, 0.035, fz + s * 0.1125]));
    add(F, 'center_caster_swivel', new THREE.CylinderGeometry(0.02, 0.02, 0.006, 20), M.chrome, [0, 0.052, fz]);
    add(F, 'center_caster_fork', new THREE.BoxGeometry(0.04, 0.02, 0.02), M.chrome, [0, 0.04, fz]);
    add(F, 'center_caster_wheel', new THREE.CylinderGeometry(0.025, 0.025, 0.028, 24), M.rubber, [0, 0.025, fz], X90);
  }

  /* ================= SIDE LEGS (fixed to ground, body pivots in them) ================= */
  [-1, 1].forEach((s) => {
    const tag = s < 0 ? 'left' : 'right';
    const lx = s * 0.305, FZ = 0.01;
    const leg = new THREE.Group(); leg.name = `leg_${tag}`; droid.add(leg);

    add(leg, `shoulder_housing_${tag}`, new THREE.CylinderGeometry(0.085, 0.085, 0.03, 32), M.ink, [s * 0.26, SHOULDER, 0], X90);
    add(leg, `shoulder_cap_${tag}`, new THREE.CylinderGeometry(0.05, 0.05, 0.02, 24), M.chrome, [s * 0.353, SHOULDER, 0], X90);
    add(leg, `shoulder_gearmotor_${tag}`, new THREE.BoxGeometry(0.03, 0.09, 0.08), M.ink, [s * 0.357, 0.69, 0]);
    add(leg, `leg_upper_${tag}`, new THREE.BoxGeometry(0.075, 0.34, 0.155), M.shell, [lx, 0.660, 0]);
    add(leg, `leg_upper_trim_${tag}`, new THREE.BoxGeometry(0.079, 0.03, 0.159), M.ink, [lx, 0.510, 0]);
    add(leg, `leg_lower_${tag}`, new THREE.BoxGeometry(0.10, 0.34, 0.115), M.shell, [lx, 0.330, 0]);
    add(leg, `leg_power_conduit_${tag}`, new THREE.CylinderGeometry(0.018, 0.018, 0.30, 16), M.chrome, [lx, 0.320, 0.075]);
    add(leg, `ankle_${tag}`, new THREE.BoxGeometry(0.11, 0.05, 0.13), M.ink, [lx, 0.135, 0]);
    add(leg, `ankle_pin_${tag}`, new THREE.CylinderGeometry(0.016, 0.016, 0.145, 16), M.chrome, [lx, HINGE, 0], X90);

    const ankle = joint(leg, `ankle_joint_${tag}`, [lx, HINGE, 0]);
    const F = ankle.frame;
    [-1, 1].forEach((k) => add(F, `ankle_clevis_${tag}_${k < 0 ? 'in' : 'out'}`, new THREE.BoxGeometry(0.012, 0.05, 0.06), M.chrome, [lx + k * 0.062, 0.115, 0]));
    add(F, `foot_top_${tag}`, new THREE.BoxGeometry(0.155, 0.02, 0.325), M.ink, [lx, 0.085, FZ]);
    add(F, `foot_plate_${tag}`, new THREE.BoxGeometry(0.12, 0.006, 0.24), M.chrome, [lx, 0.098, FZ]);
    [-1, 1].forEach((k) => add(F, `foot_wall_${tag}_${k < 0 ? 'a' : 'b'}`, new THREE.BoxGeometry(0.012, 0.06, 0.325), M.ink, [lx + k * 0.0715, 0.045, FZ]));
    [-1, 1].forEach((k) => add(F, `foot_wall_${tag}_${k < 0 ? 'rear' : 'front'}`, new THREE.BoxGeometry(0.131, 0.06, 0.012), M.ink, [lx, 0.045, FZ + k * 0.1565]));
    // drivetrain: hub motor + tyre, fore/aft casters
    add(F, `drive_wheel_${tag}`, new THREE.CylinderGeometry(0.036, 0.036, 0.045, 32), M.rubber, [lx + s * 0.02, 0.036, FZ], X90);
    add(F, `drive_hub_${tag}`, new THREE.CylinderGeometry(0.02, 0.02, 0.047, 20), M.chrome, [lx + s * 0.02, 0.036, FZ], X90);
    add(F, `drive_motor_${tag}`, new THREE.CylinderGeometry(0.022, 0.022, 0.05, 20), M.chrome, [lx - s * 0.03, 0.036, FZ], X90);
    add(F, `battery_${tag}`, new THREE.BoxGeometry(0.11, 0.03, 0.07), M.cyan, [lx, 0.055, FZ - 0.08]);
    [-1, 1].forEach((k) => {
      const z = FZ + k * 0.125, w = k < 0 ? 'rear' : 'front';
      add(F, `caster_fork_${tag}_${w}`, new THREE.BoxGeometry(0.03, 0.03, 0.03), M.chrome, [lx, 0.045, z]);
      add(F, `caster_wheel_${tag}_${w}`, new THREE.CylinderGeometry(0.016, 0.016, 0.02, 20), M.rubber, [lx, 0.016, z], X90);
    });
  });

  return { droid, body, dome, slide, cAnkle, iris };
}

/* ================= STANCE KINEMATICS ================= */
const TILT = THREE.MathUtils.degToRad(15), RETRACT = 0.20;
const y0 = C_PIN - SHOULDER;
// t: 0 = two-leg (upright), 1 = three-leg. `extraTilt` layers a nod on top.
function pose(rig, t, extraTilt) {
  let theta = 0, off;
  if (t < 0.4) off = RETRACT * (1 - t / 0.4);            // lower the centre leg to the ground
  else {                                                 // tilt body; leg tracks the floor
    theta = TILT * (t - 0.4) / 0.6;
    off = (y0 - CZ * Math.sin(theta)) / Math.cos(theta) - y0;
  }
  rig.body.pivot.rotation.x = -theta + extraTilt;
  rig.slide.position.y = off;
  rig.cAnkle.pivot.rotation.x = theta - extraTilt;
}

/* ================= STAGE + ANIMATION ================= */
export function createDroid(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  // If the GPU drops the context (sleep/wake, driver reset), pause rendering
  // until three.js restores it instead of throwing every frame.
  let contextLost = false;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost = true; });
  canvas.addEventListener('webglcontextrestored', () => { contextLost = false; });

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8580, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1.5, 2.5, 2.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xcfe8ff, 1.1);
  rim.position.set(-2, 1.2, -1.5);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(26, canvas.clientWidth / canvas.clientHeight, 0.1, 20);
  camera.position.set(1.15, 1.35, 3.3);
  camera.lookAt(0, 0.56, 0);

  const rig = buildDroid();
  // Face slightly toward the camera so the eye reads, but keep the 3/4 view.
  rig.droid.rotation.y = 0.22;
  scene.add(rig.droid);

  // The dome's resting heading: looking at the viewer.
  const FACE = Math.atan2(camera.position.x, camera.position.z) - rig.droid.rotation.y;

  let state = 'idle';
  let stance = 1, stanceTarget = 1;
  let domeYaw = FACE;
  let glowLevel = 1;
  let lastFrame = 0;
  let pokeUntil = 0, curiousUntil = 0, happyUntil = 0;
  let nextBlink = performance.now() + 3000, blinkStart = -1;
  const t0 = performance.now();

  const irisColor = new THREE.Color();
  const IRIS = {
    idle: '#19c3f0', talking: '#19c3f0', curious: '#19c3f0', happy: '#19c3f0',
    thinking: '#d6006c', looking: '#e8fbff', sleeping: '#19c3f0',
    alert: '#ffa21a',
  };

  const lerp = THREE.MathUtils.lerp;
  const damp = (cur, target, k, dt) => lerp(cur, target, 1 - Math.exp(-k * dt));
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  function frame(now) {
    requestAnimationFrame(frame);
    // Throttle: ~30fps awake, ~8fps asleep. It's a desktop pet, not a game.
    const minGap = state === 'sleeping' ? 120 : 32;
    if (contextLost || now - lastFrame < minGap) return;
    const dt = Math.min((now - (lastFrame || now)) / 1000, 0.1);
    lastFrame = now;
    const t = (now - t0) / 1000;

    // --- stance: nap upright on two legs, work on three ---
    stanceTarget = state === 'sleeping' ? 0 : 1;
    if (stance !== stanceTarget) {
      stance += Math.sign(stanceTarget - stance) * dt * 0.9;
      if (Math.abs(stanceTarget - stance) < 0.02) stance = stanceTarget;
    }

    // --- dome heading ---
    let yawTarget = FACE + Math.sin(t * 0.35) * 0.55 + Math.sin(t * 0.9) * 0.12; // idle look-around
    if (state === 'looking' || state === 'talking' || state === 'alert' || now < curiousUntil) yawTarget = FACE;
    if (state === 'sleeping') yawTarget = FACE - 0.35;
    if (state === 'thinking') {
      domeYaw += dt * 4.2; // full spins while computing
    } else {
      domeYaw = FACE + damp(wrap(domeYaw - FACE), wrap(yawTarget - FACE), 4, dt);
    }
    if (now < pokeUntil) domeYaw += Math.sin((pokeUntil - now) / 340 * Math.PI * 4) * 0.25;
    if (now < happyUntil) domeYaw = FACE + Math.sin(t * 18) * 0.35;
    rig.dome.pivot.rotation.y = domeYaw;

    // --- body nod / lean ---
    let nod = 0;
    if (state === 'talking') nod = Math.sin(t * 12) * 0.035;
    if (state === 'looking') nod = 0.07 + Math.sin(t * 7) * 0.015;
    if (state === 'sleeping') nod = 0.05 + Math.sin(t * 1.4) * 0.012;
    pose(rig, stance, nod);

    // --- whole-droid motion: bob, hop, tilt ---
    let y = 0, roll = 0;
    if (state === 'idle') y = Math.sin(t * 1.96) * 0.008;
    if (now < happyUntil) y = Math.abs(Math.sin(t * 9)) * 0.06;
    if (now < curiousUntil) roll = Math.sin((curiousUntil - now) / 1400 * Math.PI) * 0.1;
    if (state === 'alert') roll = Math.sin(t * 14) * 0.03; // agitated wobble
    if (now < pokeUntil) roll = Math.sin((pokeUntil - now) / 340 * Math.PI * 2) * 0.07;
    rig.droid.position.y = y;
    rig.droid.rotation.z = roll;

    // --- lights ---
    glowLevel = damp(glowLevel, state === 'sleeping' ? 0.06 : 1, 3, dt);
    const fast = state === 'thinking';
    irisColor.set(IRIS[state] || IRIS.idle);
    L.iris.color.copy(irisColor);
    L.iris.emissive.copy(irisColor);
    let irisI = 1.1;
    if (state === 'thinking') irisI = 0.7 + 0.6 * Math.abs(Math.sin(t * 4.5));
    if (state === 'alert') irisI = 0.6 + 1.6 * Math.abs(Math.sin(t * 6));
    if (state === 'looking') irisI = 2.2;
    if (state === 'talking') irisI = 1 + 0.35 * Math.random();
    L.iris.emissiveIntensity = irisI * glowLevel;
    L.antenna.emissiveIntensity = (0.4 + 0.8 * (0.5 + 0.5 * Math.sin(t * (fast ? 12 : 2.6)))) * glowLevel;
    L.readout.emissiveIntensity = (0.5 + 0.5 * (Math.sin(t * (fast ? 20 : 3.5)) > 0 ? 1 : 0.45)) * glowLevel;
    L.service.emissiveIntensity = (Math.sin(t * 1.7 + 1) > 0.6 ? 1.2 : 0.25) * glowLevel;
    L.holo.emissiveIntensity = (state === 'looking' ? 1.6 : 0.5) * glowLevel;

    // --- blink (squash the iris) ---
    let lid = 1;
    if (state === 'sleeping') lid = 0.08;
    else {
      if (blinkStart < 0 && now > nextBlink) blinkStart = now;
      if (blinkStart >= 0) {
        const p = (now - blinkStart) / 160;
        lid = p >= 1 ? 1 : Math.abs(1 - 2 * p);
        if (p >= 1) { blinkStart = -1; nextBlink = now + 3500 + Math.random() * 3500; }
      }
    }
    rig.iris.scale.set(1, 1, Math.max(lid, 0.08));

    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  return {
    setState(s) { state = s; },
    poke() { pokeUntil = performance.now() + 340; },
    curious(ms = 1400) { curiousUntil = performance.now() + ms; },
    happy(ms = 1100) { happyUntil = performance.now() + ms; },
  };
}
