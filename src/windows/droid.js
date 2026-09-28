const droid = document.getElementById('droid');
const bubble = document.getElementById('bubble');

// The 3D model is loaded last (see bottom), after every input/IPC handler is
// registered, so a WebGL failure can never leave the droid unclickable. Until
// then — or for good, if WebGL is unavailable — state changes go to a no-op.
const NO_MODEL = { setState() {}, poke() {}, curious() {}, happy() {} };
let model = NO_MODEL;
let flat = false; // true when showing the non-WebGL fallback droid

// ---- droidspeak: r10 talks in astromech chirps on the desktop, not English ----
const CHIRPS = [
  'bdeep-boop.', 'vwoorp?', 'bleep bloop.', 'wheee-oo.', 'brzt… brzt.',
  'doo-weep!', 'chk-chk-chirr.', 'bee-doo.', 'whirr-click.', 'boop?',
];
const GREETINGS = ['bdeep! r10 online.', 'wheee-oo! systems nominal.', 'boop-beep. ready.'];
const WAKE = ['…brzt? awake.', 'vwoorp— online.', 'bdeep. rebooting sensors.'];
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

let baseState = 'idle';
let bubbleTimer = null;
let alertUntil = 0;      // while a system alert is showing, ordinary bubbles wait their turn
let idleTimer = null;    // idle -> sleep
let chatterTimer = null; // periodic idle droidspeak

function showBubble(text, opts = {}) {
  if (!text) return;
  // A visible system alert outranks chatter and reply chirps; drop those until it expires.
  if (!opts.alert && Date.now() < alertUntil) return;
  const ms = opts.ms || 6000;
  alertUntil = opts.alert ? Date.now() + ms : 0;
  const trimmed = text.trim().slice(0, 140);
  bubble.textContent = trimmed + (text.trim().length > 140 ? '…' : '');
  bubble.classList.toggle('droidspeak', !!opts.droidspeak);
  bubble.classList.toggle('alert', !!opts.alert);
  bubble.classList.remove('hidden');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), ms);
}

function chirp() {
  showBubble(rand(CHIRPS), { droidspeak: true, ms: 3200 });
}

// ---- state application (base state + transient reaction classes) ----
function applyState() {
  const transient = droid.classList.contains('poke') ? ' poke' : '';
  droid.className = 'droid ' + baseState + transient + (flat ? ' flat' : '');
  model.setState(baseState);
  if (baseState === 'happy') model.happy();
}

function setState(state) {
  baseState = state;
  applyState();
  if (state === 'idle') {
    scheduleSleep();
    scheduleChatter();
  } else {
    // r10 is busy or reacting — don't nod off or chatter over it.
    clearTimeout(idleTimer);
    clearTimeout(chatterTimer);
  }
}

// ---- idle -> sleep, with wake ----
function scheduleSleep() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (baseState === 'idle') {
      baseState = 'sleeping';
      applyState();
      clearTimeout(chatterTimer);
    }
  }, 80000); // ~80s of calm before a nap
}

function wake(announce) {
  const wasAsleep = baseState === 'sleeping';
  if (wasAsleep) {
    setState('idle');
    if (announce) showBubble(rand(WAKE), { droidspeak: true, ms: 2600 });
  } else if (baseState === 'idle') {
    scheduleSleep(); // reset the nap countdown on any interaction
  }
}

function scheduleChatter() {
  clearTimeout(chatterTimer);
  const next = 55000 + Math.random() * 45000; // 55–100s between idle quips
  chatterTimer = setTimeout(() => {
    if (baseState === 'idle') {
      chirp();
      scheduleChatter();
    }
  }, next);
}

// ---- reactions ----
function poke() {
  droid.classList.add('poke');
  model.poke();
  setTimeout(() => droid.classList.remove('poke'), 340);
}

// ---- IPC from main ----
window.r10.onState((state) => {
  setState(state);
  if (state === 'thinking') showBubble('brzt… computing.', { droidspeak: true });
  if (state === 'looking') showBubble('vwoorp— scanning screen.', { droidspeak: true });
});

// Main sends a short droidspeak acknowledgement text on reply completion.
window.r10.onBubble((text) => showBubble(text, { droidspeak: true }));

// System monitor alert: a warning warble plus the plain-English readout, held
// longer than normal chatter so it isn't missed.
window.r10.onAlert((text) => showBubble('bwee-oo-oo! ' + text, { droidspeak: true, alert: true, ms: 14000 }));

// ---- hover: perk up (and wake if napping) ----
droid.addEventListener('mouseenter', () => {
  wake(true);
  if (baseState === 'idle') {
    model.curious(1400);
  }
});

// ---- click vs drag ----
let dragging = false;
let lastX = 0;
let lastY = 0;
let moved = 0;

droid.addEventListener('mousedown', (e) => {
  dragging = true;
  moved = 0;
  lastX = e.screenX;
  lastY = e.screenY;
  wake(false);
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - lastX;
  const dy = e.screenY - lastY;
  lastX = e.screenX;
  lastY = e.screenY;
  moved += Math.abs(dx) + Math.abs(dy);
  if (dx || dy) window.r10.drag(dx, dy);
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  if (moved < 5) { // treat as a click
    poke();
    window.r10.toggleChat();
  }
});

// ---- boot: greet, then settle into the idle loop ----
setState('idle');
setTimeout(() => {
  model.curious(1500);
  showBubble(rand(GREETINGS), { droidspeak: true, ms: 3500 });
}, 900);

// ---- 3D body: load it now that the droid is fully interactive ----
try {
  const { createDroid } = await import('./droid-model.js');
  model = createDroid(document.getElementById('stage'));
  model.setState(baseState);
} catch (err) {
  console.warn('r10: 3D droid unavailable, using flat fallback:', err);
  flat = true;
  applyState();
}
