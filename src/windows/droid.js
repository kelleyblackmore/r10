'use strict';

const droid = document.getElementById('droid');
const bubble = document.getElementById('bubble');

let bubbleTimer = null;
function showBubble(text) {
  if (!text) return;
  const trimmed = text.trim().slice(0, 140);
  bubble.textContent = trimmed + (text.trim().length > 140 ? '…' : '');
  bubble.classList.remove('hidden');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), 6000);
}

window.r10.onState((state) => {
  droid.className = 'droid ' + state;
  if (state === 'thinking') showBubble('thinking…');
  if (state === 'looking') showBubble('looking at your screen…');
});

window.r10.onBubble((text) => showBubble(text));

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
  if (moved < 5) window.r10.toggleChat(); // treat as a click
});
