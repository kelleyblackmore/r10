'use strict';

const $ = (id) => document.getElementById(id);
const messagesEl = $('messages');
const inputEl = $('input');
const statusEl = $('status');

let history = []; // [{role, content}]
let turnNodes = []; // DOM wrappers aligned 1:1 with `history` entries (for the trim marker)
let pendingImage = null; // base64 when "look" is armed
let streaming = false;
let convGen = 0; // bumped on "New chat"; in-flight sends from an older gen are discarded

// Rough character budget for what we replay to the model each turn (~4 chars/token,
// so ~16k chars ≈ ~4k tokens), leaving the rest of the window for the reply. The
// full transcript stays on screen; only what we *send* is trimmed.
const MAX_CONTEXT_CHARS = 16000;

const GREETING_HTML =
  '<div class="msg bot"><div class="bubble">Beep boop! I\'m r10. Ask me anything, ' +
  'or tap 👁 and I\'ll take a look at your screen.</div></div>';

// Single, persistent chunk listener. Each send() swaps the active handler in
// instead of registering a new IPC listener (which previously leaked and made
// old bubbles receive new responses' chunks).
let chunkHandler = null;
window.r10.onChunk((c) => { if (chunkHandler) chunkHandler(c); });

function scrollDown() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMessage(role, text, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role + (opts.withImage ? ' with-image' : '') + (opts.error ? ' error' : '');
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (opts.error && opts.html) {
    bubble.innerHTML = text;
  } else {
    bubble.textContent = text;
  }
  wrap.appendChild(bubble);
  messagesEl.appendChild(wrap);
  scrollDown();
  return bubble;
}

// Top-bar status light. green = ready to chat, amber = needs setup/downloading,
// red = error. The dot + short label both reflect the state.
function setLight(state, label, title) {
  statusEl.className = 'status ' + state;
  statusEl.textContent = '● ' + label;
  statusEl.title = title;
}

async function refreshStatus() {
  if (downloading) {
    setLight('busy', 'downloading…', 'Downloading the built-in model — this happens only once.');
    return;
  }
  const res = await window.r10.engineStatus();
  if (!res.ok) {
    setLight('err', 'error', res.error || 'Engine error');
    return;
  }
  const s = res.status;
  if (s.active === 'ollama') {
    setLight('ready', 'Ollama', 'Ready · using Ollama (' + (s.ollama.models.join(', ') || 'no models') + ')');
  } else if (!s.embedded.available) {
    setLight('err', 'built-in', 'Built-in engine could not load on this Mac. Open Settings and switch to Ollama.');
  } else if (!s.embedded.chatReady) {
    setLight('warn', 'setup', 'Built-in model not downloaded yet — use the "Download now" button.');
  } else {
    setLight('ready', 'built-in', 'Ready · built-in engine, model downloaded and cached.');
  }
  updateSetupBanner(s);
  return s;
}

// ---- one-time model setup ----
// When the active engine is the built-in one and its model isn't downloaded
// yet, surface a clear call-to-action *before* the user chats, rather than
// kicking off a multi-GB download mid-message.
let downloading = false;
let setupBanner = null;

function updateSetupBanner(s) {
  const needs = s && s.active === 'embedded' && s.embedded.available && !s.embedded.chatReady;
  if (needs && !downloading) showSetupBanner();
  else if (!needs) clearSetupBanner();
}

function showSetupBanner() {
  if (setupBanner || downloading) return;
  const wrap = document.createElement('div');
  wrap.className = 'msg bot';
  const b = document.createElement('div');
  b.className = 'bubble setup';
  b.textContent =
    "I run on a built-in brain that needs a one-time download (about 5 GB) before we can chat. " +
    "It's saved on your Mac and reused every time after — you only do this once.";
  const btn = document.createElement('button');
  btn.className = 'primary';
  btn.textContent = 'Download now';
  btn.addEventListener('click', () => startDownload(false));
  b.appendChild(document.createElement('br'));
  b.appendChild(btn);
  wrap.appendChild(b);
  messagesEl.appendChild(wrap);
  scrollDown();
  setupBanner = wrap;
}

function clearSetupBanner() {
  if (setupBanner) { setupBanner.remove(); setupBanner = null; }
}

async function startDownload(vision) {
  if (downloading) return { ok: false, error: 'A download is already in progress.' };
  downloading = true;
  clearSetupBanner();
  refreshStatus(); // flip the light to "downloading…" right away
  const res = await window.r10.ensureModel(!!vision);
  downloading = false;
  if (!res.ok) addMessage('bot', 'Download failed: ' + res.error, { error: true });
  await refreshStatus();
  return res;
}

// Guarantee the chosen engine is usable before we send a message.
async function prepareEngine() {
  const res = await window.r10.engineStatus();
  if (!res.ok) return { ok: true }; // let chat:send surface the real error
  const s = res.status;
  if (s.active === 'embedded') {
    if (!s.embedded.available) {
      return { ok: false, error: 'My built-in brain could not load on this Mac. Open Settings (⚙) and switch the engine to Ollama, or install Ollama.' };
    }
    if (!s.embedded.chatReady) {
      const dl = await startDownload(false);
      if (!dl.ok) return { ok: false, error: dl.error || 'My model is not ready yet.' };
    }
  }
  return { ok: true };
}

// ---- model download progress ----
let progressEl = null;
function showProgress(p) {
  if (!progressEl) {
    const wrap = document.createElement('div');
    wrap.className = 'msg bot';
    const b = document.createElement('div');
    b.className = 'bubble progress';
    b.innerHTML = '<div class="plabel"></div><div class="pbar"><div class="pfill"></div></div>';
    wrap.appendChild(b);
    messagesEl.appendChild(wrap);
    progressEl = { wrap, label: b.querySelector('.plabel'), fill: b.querySelector('.pfill') };
  }
  const pct = p.total ? Math.round((p.downloaded / p.total) * 100) : (p.percent || 0);
  const mb = (n) => (n / 1024 / 1024).toFixed(0);
  progressEl.label.textContent =
    (p.phase || 'Downloading') + ' ' + (p.label || '') +
    (p.total ? ` — ${mb(p.downloaded)} / ${mb(p.total)} MB (${pct}%)` : ` — ${pct}%`);
  progressEl.fill.style.width = pct + '%';
  scrollDown();
  if (p.done) {
    progressEl.label.textContent = (p.label || 'Model') + ' ready ✓';
    setTimeout(() => { if (progressEl) { progressEl.wrap.remove(); progressEl = null; } }, 2500);
  }
}
window.r10.onProgress(showProgress);

// ---- context window (auto-trim) ----
// `history` holds the whole conversation, with the just-added user turn last.
// We replay only the most recent turns that fit MAX_CONTEXT_CHARS, and show a
// marker in the transcript at the boundary so dropped turns are visible, not silent.
let trimMarker = null;

function buildContextWindow() {
  let total = 0;
  let startIdx = history.length - 1; // always keep the current (last) turn
  for (let i = history.length - 1; i >= 0; i--) {
    total += (history[i].content || '').length;
    if (total > MAX_CONTEXT_CHARS && i < history.length - 1) break;
    startIdx = i;
  }
  positionTrimMarker(startIdx);
  // Prior turns sent to the backend = kept turns minus the current user message
  // (which is passed separately as `message`).
  return history.slice(startIdx, history.length - 1);
}

function positionTrimMarker(startIdx) {
  if (startIdx <= 0 || !turnNodes[startIdx]) {
    if (trimMarker && trimMarker.parentElement) trimMarker.remove();
    return;
  }
  if (!trimMarker) {
    trimMarker = document.createElement('div');
    trimMarker.className = 'trim-marker';
    trimMarker.textContent = '⋯ earlier messages are out of r10’s memory ⋯';
  }
  const anchor = turnNodes[startIdx];
  if (trimMarker.parentElement !== messagesEl || trimMarker.nextSibling !== anchor) {
    messagesEl.insertBefore(trimMarker, anchor);
  }
}

// ---- new chat (reset) ----
function newChat() {
  convGen += 1; // any in-flight send from the old gen will discard its result
  window.r10.stop(); // abort a streaming reply in the main process
  chunkHandler = null;
  streaming = false;
  history = [];
  turnNodes = [];
  trimMarker = null;
  progressEl = null;
  setupBanner = null;
  pendingImage = null;
  $('lookBtn').classList.remove('armed');
  inputEl.placeholder = 'Talk to r10…';
  messagesEl.innerHTML = GREETING_HTML;
  refreshStatus(); // re-shows the download banner if the model still isn't ready
  inputEl.focus();
}
$('newChatBtn').addEventListener('click', newChat);

// ---- sending ----
async function send() {
  const text = inputEl.value.trim();
  if (!text || streaming) return;
  inputEl.value = '';
  autoSize();

  const myGen = convGen;
  const image = pendingImage;
  addMessage('user', text, { withImage: !!image });
  const userWrap = messagesEl.lastElementChild;
  streaming = true;

  // Make sure the engine + model are ready before we try to talk. If the
  // built-in model still needs downloading, this runs it (with progress) first.
  const prep = await prepareEngine();
  if (myGen !== convGen) return; // chat was reset during prep
  if (!prep.ok) {
    addMessage('bot', prep.error, { error: true });
    streaming = false;
    pendingImage = null;
    $('lookBtn').classList.remove('armed');
    inputEl.placeholder = 'Talk to r10…';
    return;
  }

  history.push({ role: 'user', content: text });
  turnNodes.push(userWrap);

  const priorContext = buildContextWindow();

  const botBubble = addMessage('bot', '');
  const botWrap = botBubble.parentElement;
  const caret = document.createElement('span');
  caret.className = 'cursor';
  caret.textContent = '▍';
  botBubble.appendChild(caret);

  let acc = '';
  chunkHandler = (chunk) => {
    if (myGen !== convGen) return;
    acc += chunk;
    botBubble.textContent = acc;
    scrollDown();
  };

  const res = await window.r10.send({ history: priorContext, message: text, image });
  if (myGen !== convGen) return; // chat was reset while waiting — drop the result
  chunkHandler = null;

  // clear armed look state
  pendingImage = null;
  $('lookBtn').classList.remove('armed');
  inputEl.placeholder = 'Talk to r10…';
  streaming = false;

  if (res.ok) {
    botBubble.textContent = res.text;
    history.push({ role: 'assistant', content: res.text });
    turnNodes.push(botWrap);
  } else if (res.aborted) {
    botBubble.textContent = acc || '(stopped)';
  } else {
    botWrap.remove();
    let msg = res.error || 'Something went wrong.';
    if (res.kind === 'offline') {
      msg += '<br/><a data-url="https://ollama.com/download">Get Ollama →</a>';
    }
    addMessage('bot', msg, { error: true, html: true });
    refreshStatus();
  }
}

// ---- look button ----
$('lookBtn').addEventListener('click', async () => {
  const btn = $('lookBtn');
  if (pendingImage) {
    pendingImage = null;
    btn.classList.remove('armed');
    inputEl.placeholder = 'Talk to r10…';
    return;
  }
  // Check up front whether screen-watching is possible, so we don't arm an image
  // only to fail after the user types a message.
  const st = await window.r10.engineStatus();
  if (st.ok && !st.status.visionAvailable) {
    const m = st.status.visionModel || 'llava';
    addMessage(
      'bot',
      `I can't look at your screen yet — that needs a vision model. With Ollama running, run:  <code>ollama pull ${m}</code>  then tap 👁 again. You can still chat with me normally without it.`,
      { error: true, html: true },
    );
    return;
  }
  btn.classList.add('armed');
  const res = await window.r10.capture();
  if (res.ok) {
    pendingImage = res.image;
    if (!inputEl.value.trim()) inputEl.placeholder = 'Ask about what r10 sees…';
    inputEl.focus();
  } else {
    btn.classList.remove('armed');
    addMessage('bot', 'I could not capture the screen. Grant Screen Recording permission in System Settings → Privacy & Security.', { error: true });
  }
});

// ---- input behavior ----
function autoSize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
}
inputEl.addEventListener('input', autoSize);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
$('sendBtn').addEventListener('click', send);
$('hideBtn').addEventListener('click', () => window.r10.hideChat());
$('quitBtn').addEventListener('click', () => window.r10.quit());

// links in error bubbles
messagesEl.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-url]');
  if (a) window.r10.openExternal(a.dataset.url);
});

// ---- settings ----
// Settings auto-save the moment a field changes, so they're never lost — even
// if you re-open the panel or click the gear again without hitting "Done".
const settingsEl = $('settings');

async function loadSettingsForm() {
  const s = await window.r10.getSettings();
  $('setEngine').value = s.engine || 'auto';
  $('setUrl').value = s.ollamaUrl;
  $('setChat').value = s.chatModel;
  $('setVision').value = s.visionModel;
  $('setPrompt').value = s.systemPrompt;
  refreshSettingsHints();
}

async function refreshSettingsHints() {
  const st = await window.r10.engineStatus();
  if (st.ok) {
    const e = st.status.embedded;
    $('engineHint').textContent =
      `Built-in engine: ${e.available ? 'ready' : 'unavailable'} · chat model ${e.chatReady ? 'downloaded ✓' : 'not downloaded'} · vision ${e.vision ? (e.visionReady ? 'downloaded' : 'not downloaded') : 'via Ollama'}. ` +
      `Ollama: ${st.status.ollama.up ? 'running' : 'offline'}.`;
  }
  const models = await window.r10.listModels();
  $('modelHint').textContent = models.ok
    ? 'Ollama models: ' + (models.models.join(', ') || '(none)')
    : 'Ollama offline: ' + models.error;
}

async function persistSettings() {
  await window.r10.setSettings({
    engine: $('setEngine').value,
    ollamaUrl: $('setUrl').value.trim(),
    chatModel: $('setChat').value.trim(),
    visionModel: $('setVision').value.trim(),
    systemPrompt: $('setPrompt').value,
  });
  refreshStatus();
  refreshSettingsHints();
}

let saveTimer = null;
function persistDebounced() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistSettings, 400);
}

// Selects/blur-style changes save immediately; free-text saves as you type (debounced).
$('setEngine').addEventListener('change', persistSettings);
['setUrl', 'setChat', 'setVision'].forEach((id) => $(id).addEventListener('change', persistSettings));
$('setPrompt').addEventListener('change', persistSettings);
['setUrl', 'setChat', 'setVision', 'setPrompt'].forEach((id) => $(id).addEventListener('input', persistDebounced));

function openSettings() {
  loadSettingsForm();
  settingsEl.classList.remove('hidden');
}
function closeSettings() {
  clearTimeout(saveTimer);
  persistSettings(); // flush any pending edit
  settingsEl.classList.add('hidden');
}

// Gear toggles the panel; opening reloads from disk, closing flushes — neither reverts.
$('settingsBtn').addEventListener('click', () => {
  if (settingsEl.classList.contains('hidden')) openSettings();
  else closeSettings();
});
$('saveSettings').addEventListener('click', closeSettings);
$('dlChat').addEventListener('click', () => {
  settingsEl.classList.add('hidden');
  startDownload(false);
});

// Check on open, then only occasionally — and never while the window is hidden,
// since a downloaded model stays put and Ollama rarely toggles. Refresh on show.
refreshStatus();
setInterval(() => { if (!document.hidden) refreshStatus(); }, 45000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshStatus(); });
