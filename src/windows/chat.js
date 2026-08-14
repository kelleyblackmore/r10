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
  '<div class="msg bot"><div class="bubble"><em>bdeep</em> — r10 online. ' +
  'Ask me anything, or tap the eye button to scan your screen.</div></div>';

// Single, persistent chunk listener. Each send() swaps the active handler in
// instead of registering a new IPC listener (which previously leaked and made
// old bubbles receive new responses' chunks).
let chunkHandler = null;
window.r10.onChunk((c) => { if (chunkHandler) chunkHandler(c); });

function scrollDown() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---- tiny, self-contained Markdown renderer ----
// The model returns Markdown; we render a safe subset (no external libraries, so
// it works offline / under CSP). Everything is HTML-escaped first, then only
// known tags are introduced. Fenced code blocks get a Copy button.
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderMarkdown(src) {
  const blocks = [];
  // Pull fenced code blocks out first so their contents aren't treated as markup.
  let text = (src || '').replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
    blocks.push(code.replace(/\n$/, ''));
    return '@@CODE' + (blocks.length - 1) + '@@';
  });
  text = escapeHtml(text);
  text = text.replace(/`([^`\n]+)`/g, (_m, c) => '<code>' + c + '</code>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, t, u) => '<a data-url="' + u + '">' + t + '</a>');

  const lines = text.split('\n');
  let html = '';
  let list = null; // 'ul' | 'ol'
  const closeList = () => { if (list) { html += '</' + list + '>'; list = null; } };
  for (const line of lines) {
    const code = line.match(/^@@CODE(\d+)@@$/);
    if (code) {
      closeList();
      html += '<pre class="code"><button class="copy" title="Copy code">Copy</button><code>' +
        escapeHtml(blocks[+code[1]]) + '</code></pre>';
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul) { if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; } html += '<li>' + ul[1] + '</li>'; continue; }
    if (ol) { if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; } html += '<li>' + ol[1] + '</li>'; continue; }
    closeList();
    if (line.trim() !== '') html += '<div>' + line + '</div>';
  }
  closeList();
  return html;
}

function copyText(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    return true;
  } catch {
    return false;
  }
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
  if (s.active === 'openai') {
    if (s.openai && s.openai.configured) {
      setLight('ready', 'API', 'Ready · using the API model "' + s.openai.model + '" at ' + (s.openai.url || 'the configured URL') + '.');
    } else {
      setLight('warn', 'API setup', 'API engine selected but not configured — open Settings and enter the API URL and model.');
    }
  } else if (s.active === 'ollama') {
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
    "I run on a built-in brain. The installed app ships with it, but this copy needs a small " +
    "one-time download (under 1 GB) before we can chat. It's saved on your Mac and reused every time after.";
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
      return { ok: false, error: 'My built-in brain could not load on this Mac. Open Settings and switch the engine to Ollama, or install Ollama.' };
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
    progressEl.label.textContent = (p.label || 'Model') + ' ready';
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
  history = [];
  turnNodes = [];
  trimMarker = null;
  progressEl = null;
  setupBanner = null;
  pendingImage = null;
  $('lookBtn').classList.remove('armed');
  inputEl.placeholder = 'Talk to r10…';
  messagesEl.innerHTML = GREETING_HTML;
  setStreamingUI(false); // restore Send button, hide Stop/Regenerate
  window.r10.saveHistory([]); // forget the persisted conversation
  refreshStatus(); // re-shows the download banner if the model still isn't ready
  inputEl.focus();
}
$('newChatBtn').addEventListener('click', newChat);

// ---- streaming UI (Send <-> Stop) + regenerate availability ----
const sendBtn = $('sendBtn');
const stopBtn = $('stopBtn');
const regenBtn = $('regenBtn');

function setStreamingUI(on) {
  streaming = on;
  sendBtn.classList.toggle('hidden', on);
  stopBtn.classList.toggle('hidden', !on);
  if (on) regenBtn.classList.add('hidden');
  else updateRegen();
}

// Regenerate is offered only when the last turn is a completed assistant reply.
function updateRegen() {
  const canRegen = !streaming && history.length > 0 && history[history.length - 1].role === 'assistant';
  regenBtn.classList.toggle('hidden', !canRegen);
}

function persistHistory() {
  try { window.r10.saveHistory(history); } catch { /* non-fatal */ }
}

// ---- sending ----
async function send() {
  const text = inputEl.value.trim();
  if (!text || streaming) return;
  inputEl.value = '';
  autoSize();
  await submit(text, pendingImage);
}

// Core send path, shared by the composer and by Regenerate. `image` is the
// optional armed screenshot (base64); regenerate passes null (screenshots aren't
// stored in history, so a regenerated reply is text-only).
async function submit(text, image) {
  const myGen = convGen;
  addMessage('user', text, { withImage: !!image });
  const userWrap = messagesEl.lastElementChild;
  setStreamingUI(true);

  // Make sure the engine + model are ready before we try to talk. If the
  // built-in model still needs downloading, this runs it (with progress) first.
  const prep = await prepareEngine();
  if (myGen !== convGen) return; // chat was reset during prep
  if (!prep.ok) {
    addMessage('bot', prep.error, { error: true });
    setStreamingUI(false);
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
  // Animated "typing" dots until the first token arrives.
  botBubble.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';

  let acc = '';
  let gotFirst = false;
  chunkHandler = (chunk) => {
    if (myGen !== convGen) return;
    if (!gotFirst) { gotFirst = true; botBubble.textContent = ''; } // drop typing dots
    acc += chunk;
    // Plain text while streaming (fast + safe); Markdown is rendered on completion.
    botBubble.textContent = acc;
    const caret = document.createElement('span');
    caret.className = 'cursor';
    caret.textContent = '▍';
    botBubble.appendChild(caret);
    scrollDown();
  };

  const res = await window.r10.send({ history: priorContext, message: text, image });
  if (myGen !== convGen) return; // chat was reset while waiting — drop the result
  chunkHandler = null;

  // clear armed look state
  pendingImage = null;
  $('lookBtn').classList.remove('armed');
  inputEl.placeholder = 'Talk to r10…';
  setStreamingUI(false);

  if (res.ok) {
    botBubble.innerHTML = renderMarkdown(res.text);
    history.push({ role: 'assistant', content: res.text });
    turnNodes.push(botWrap);
  } else if (res.aborted) {
    // Keep whatever streamed before Stop, and record it so the transcript,
    // context, and regenerate stay consistent.
    if (acc) {
      botBubble.innerHTML = renderMarkdown(acc);
      history.push({ role: 'assistant', content: acc });
      turnNodes.push(botWrap);
    } else {
      botWrap.remove();
    }
  } else {
    botWrap.remove();
    let msg = res.error || 'Something went wrong.';
    if (res.kind === 'offline') {
      msg += '<br/><a data-url="https://ollama.com/download">Get Ollama →</a>';
    }
    addMessage('bot', msg, { error: true, html: true });
    refreshStatus();
  }
  updateRegen();
  persistHistory();
}

// ---- stop / regenerate ----
stopBtn.addEventListener('click', () => {
  if (streaming) window.r10.stop();
});

async function regenerate() {
  if (streaming) return;
  if (!history.length || history[history.length - 1].role !== 'assistant') return;
  // Drop the last assistant reply (history + DOM)…
  history.pop();
  const botNode = turnNodes.pop();
  if (botNode) botNode.remove();
  // …then the user turn that produced it, and re-send that same prompt.
  const lastUser = history[history.length - 1];
  if (!lastUser || lastUser.role !== 'user') { updateRegen(); persistHistory(); return; }
  history.pop();
  const userNode = turnNodes.pop();
  if (userNode) userNode.remove();
  await submit(lastUser.content, null);
}
regenBtn.addEventListener('click', regenerate);

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
      `I can't look at your screen yet — that needs a vision model. With Ollama running, run:  <code>ollama pull ${m}</code>  then tap the eye button again. You can still chat with me normally without it.`,
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

// links in bubbles + copy-code buttons
messagesEl.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-url]');
  if (a) { window.r10.openExternal(a.dataset.url); return; }
  const copy = e.target.closest('button.copy');
  if (copy) {
    const code = copy.parentElement.querySelector('code');
    if (code && copyText(code.textContent)) {
      copy.textContent = 'Copied';
      copy.classList.add('copied');
      setTimeout(() => { copy.textContent = 'Copy'; copy.classList.remove('copied'); }, 1600);
    }
  }
});

// ---- settings ----
// Settings auto-save the moment a field changes, so they're never lost — even
// if you re-open the panel or click the gear again without hitting "Done".
const settingsEl = $('settings');

async function loadSettingsForm() {
  const s = await window.r10.getSettings();
  $('setEngine').value = s.engine || 'auto';
  $('setOpenaiUrl').value = s.openaiUrl || '';
  $('setOpenaiKey').value = s.openaiKey || '';
  $('setOpenaiModel').value = s.openaiModel || '';
  $('setOpenaiVision').value = s.openaiVisionModel || '';
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
      `Built-in engine: ${e.available ? 'ready' : 'unavailable'} · chat model ${e.chatReady ? 'downloaded' : 'not downloaded'} · vision ${e.vision ? (e.visionReady ? 'downloaded' : 'not downloaded') : 'via Ollama'}. ` +
      `Ollama: ${st.status.ollama.up ? 'running' : 'offline'}.`;
  }
  const models = await window.r10.listModels();
  $('modelHint').textContent = models.ok
    ? 'Ollama models: ' + (models.models.join(', ') || '(none)')
    : 'Ollama offline: ' + models.error;

  // API hint: confirm the endpoint is reachable and the key works.
  const hintEl = $('openaiHint');
  if (!$('setOpenaiUrl').value.trim() || !$('setOpenaiModel').value.trim()) {
    hintEl.textContent = 'Enter an API URL and model to use a hosted/work model (works on macOS & Windows).';
  } else {
    hintEl.textContent = 'Checking API…';
    const api = await window.r10.listApiModels();
    if (api.ok) {
      const has = api.models.includes($('setOpenaiModel').value.trim());
      hintEl.textContent =
        'API reachable — ' + api.models.length + ' model(s) available' +
        (api.models.length && !has ? ` (note: "${$('setOpenaiModel').value.trim()}" not in the list — it may still work)` : '') + '.';
    } else {
      hintEl.textContent = 'API check: ' + api.error;
    }
  }
}

async function persistSettings() {
  await window.r10.setSettings({
    engine: $('setEngine').value,
    openaiUrl: $('setOpenaiUrl').value.trim(),
    openaiKey: $('setOpenaiKey').value.trim(),
    openaiModel: $('setOpenaiModel').value.trim(),
    openaiVisionModel: $('setOpenaiVision').value.trim(),
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
const TEXT_FIELDS = ['setUrl', 'setChat', 'setVision', 'setOpenaiUrl', 'setOpenaiKey', 'setOpenaiModel', 'setOpenaiVision'];
$('setEngine').addEventListener('change', persistSettings);
TEXT_FIELDS.forEach((id) => $(id).addEventListener('change', persistSettings));
$('setPrompt').addEventListener('change', persistSettings);
[...TEXT_FIELDS, 'setPrompt'].forEach((id) => $(id).addEventListener('input', persistDebounced));

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

// Open Settings from the menu-bar (tray) item.
window.r10.onOpenSettings(() => {
  if (settingsEl.classList.contains('hidden')) openSettings();
});

// ---- restore a saved conversation on launch ----
// Rebuild the transcript from persisted history so r10 remembers the chat across
// restarts. Falls back to the greeting when there's nothing saved.
async function restoreHistory() {
  try {
    const saved = await window.r10.loadHistory();
    if (!Array.isArray(saved) || !saved.length) return;
    messagesEl.innerHTML = ''; // replace the greeting
    history = [];
    turnNodes = [];
    for (const turn of saved) {
      if (turn.role === 'user') {
        const b = addMessage('user', turn.content);
        history.push({ role: 'user', content: turn.content });
        turnNodes.push(b.parentElement);
      } else if (turn.role === 'assistant') {
        const b = addMessage('bot', '');
        b.innerHTML = renderMarkdown(turn.content);
        history.push({ role: 'assistant', content: turn.content });
        turnNodes.push(b.parentElement);
      }
    }
    updateRegen();
    scrollDown();
  } catch { /* start fresh on any restore error */ }
}
restoreHistory();

// Check on open, then only occasionally — and never while the window is hidden,
// since a downloaded model stays put and Ollama rarely toggles. Refresh on show.
refreshStatus();
setInterval(() => { if (!document.hidden) refreshStatus(); }, 45000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshStatus(); });
