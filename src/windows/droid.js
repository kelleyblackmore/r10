'use strict';

const droid = document.getElementById('droid');
const bubble = document.getElementById('bubble');

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
let idleTimer = null;    // idle -> sleep
let chatterTimer = null; // periodic idle droidspeak

function showBubble(text, opts = {}) {
  if (!text) return;
  const trimmed = text.trim().slice(0, 140);
  bubble.textContent = trimmed + (text.trim().length > 140 ? '…' : '');
  bubble.classList.toggle('droidspeak', !!opts.droidspeak);
  bubble.classList.remove('hidden');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), opts.ms || 6000);
}

function chirp() {
  showBubble(rand(CHIRPS), { droidspeak: true, ms: 3200 });
}

// ---- state application (base state + transient reaction classes) ----
function applyState() {
  const transient = droid.classList.contains('poke') ? ' poke' : '';
  droid.className = 'droid ' + baseState + transient;
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

// ---- hover: perk up (and wake if napping) ----
droid.addEventListener('mouseenter', () => {
  wake(true);
  if (baseState === 'idle') {
    droid.classList.add('curious');
    setTimeout(() => droid.classList.remove('curious'), 1400);
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
  droid.classList.add('curious');
  setTimeout(() => droid.classList.remove('curious'), 1500);
  showBubble(rand(GREETINGS), { droidspeak: true, ms: 3500 });
}, 900);
