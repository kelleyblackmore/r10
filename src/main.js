'use strict';

const { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const settings = require('./settings');
const ollama = require('./ollama');
const openai = require('./openai');
const engine = require('./engine');
const llama = require('./llama');
const { captureScreenBase64 } = require('./screen');

let droidWin = null;
let chatWin = null;
let tray = null;
let activeAbort = null;

const DROID_W = 160;
const DROID_H = 190;
const CHAT_W = 380;
const CHAT_H = 520;

// ---- persisted window/chat state (droid position + conversation history) ----
// Survives restarts so r10 stays where you left it and remembers the chat.
function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return {};
  }
}
function saveState(patch) {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ ...loadState(), ...patch }, null, 2));
  } catch {
    /* best-effort; a failed write just means we fall back to defaults next launch */
  }
}
// Is this saved droid rectangle still visible on some display? (Guards against a
// saved position from a monitor that's no longer connected.)
function isOnScreen(pos) {
  return screen.getAllDisplays().some((d) => {
    const b = d.bounds;
    return pos.x + DROID_W - 20 > b.x && pos.x + 20 < b.x + b.width &&
      pos.y + DROID_H - 20 > b.y && pos.y + 20 < b.y + b.height;
  });
}

function createDroidWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  // Restore the last position if it's still on a connected display; else default
  // to the bottom-right corner.
  const def = {
    x: workArea.x + workArea.width - DROID_W - 24,
    y: workArea.y + workArea.height - DROID_H - 24,
  };
  const saved = loadState().droid;
  const pos = (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && isOnScreen(saved)) ? saved : def;
  droidWin = new BrowserWindow({
    width: DROID_W,
    height: DROID_H,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false, // we drive movement ourselves for click-vs-drag
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  droidWin.setAlwaysOnTop(true, 'floating');
  droidWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  droidWin.loadFile(path.join(__dirname, 'windows', 'droid.html'));
  droidWin.on('closed', () => {
    droidWin = null;
  });
}

function createChatWindow() {
  chatWin = new BrowserWindow({
    width: CHAT_W,
    height: CHAT_H,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    minWidth: 320,
    minHeight: 380,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  chatWin.setAlwaysOnTop(true, 'floating');
  chatWin.loadFile(path.join(__dirname, 'windows', 'chat.html'));
  chatWin.on('close', (e) => {
    // Hide instead of destroy so chat history persists across opens.
    if (!app.isQuitting) {
      e.preventDefault();
      chatWin.hide();
      refreshTray();
    }
  });
}

function positionChatNearDroid() {
  if (!chatWin || !droidWin) return;
  const d = droidWin.getBounds();
  const { workArea } = screen.getDisplayMatching(d);
  let x = d.x + d.width / 2 - CHAT_W / 2;
  let y = d.y - CHAT_H - 8;
  // Clamp into the work area; if no room above, place below.
  if (y < workArea.y) y = d.y + d.height + 8;
  x = Math.max(workArea.x + 8, Math.min(x, workArea.x + workArea.width - CHAT_W - 8));
  y = Math.max(workArea.y + 8, Math.min(y, workArea.y + workArea.height - CHAT_H - 8));
  chatWin.setBounds({ x: Math.round(x), y: Math.round(y), width: CHAT_W, height: CHAT_H });
}

function showChat() {
  if (!chatWin) return;
  positionChatNearDroid();
  chatWin.show();
  chatWin.focus();
  refreshTray();
}
function hideChat() {
  if (chatWin) chatWin.hide();
  refreshTray();
}
function toggleChat() {
  if (!chatWin) return;
  if (chatWin.isVisible()) hideChat();
  else showChat();
}

// ---- menu-bar (tray) item ----
// Gives r10 a persistent macOS menu-bar presence: show/hide chat, jump to
// settings, quit — controllable even when the droid is hidden or off-screen.
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
  tray = new Tray(icon);
  tray.setToolTip('r10');
  tray.on('click', () => toggleChat());
  refreshTray();
}
function refreshTray() {
  if (!tray) return;
  const visible = !!(chatWin && chatWin.isVisible());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? 'Hide chat' : 'Show chat', click: () => toggleChat() },
    { label: 'Settings…', click: () => { showChat(); sendChat('chat:open-settings'); } },
    { type: 'separator' },
    { label: 'Quit r10', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

// ---- IPC ----

ipcMain.on('droid:toggle-chat', () => toggleChat());

let posSaveTimer = null;
ipcMain.on('droid:drag', (_e, { dx, dy }) => {
  if (!droidWin) return;
  const b = droidWin.getBounds();
  droidWin.setBounds({ x: b.x + Math.round(dx), y: b.y + Math.round(dy), width: b.width, height: b.height });
  if (chatWin && chatWin.isVisible()) positionChatNearDroid();
  // Persist the new position (debounced) so it's remembered across restarts.
  clearTimeout(posSaveTimer);
  posSaveTimer = setTimeout(() => {
    if (droidWin && !droidWin.isDestroyed()) {
      const nb = droidWin.getBounds();
      saveState({ droid: { x: nb.x, y: nb.y } });
    }
  }, 500);
});

ipcMain.on('chat:hide', () => hideChat());

// Conversation persistence: the renderer saves the running history here after
// each turn and loads it on launch, so chats survive an app restart.
ipcMain.handle('history:load', () => loadState().history || []);
ipcMain.on('history:save', (_e, history) => {
  saveState({ history: Array.isArray(history) ? history.slice(-100) : [] });
});

ipcMain.on('app:quit', () => {
  app.isQuitting = true;
  app.quit();
});

ipcMain.handle('settings:get', () => settings.load());
ipcMain.handle('settings:set', (_e, partial) => settings.save(partial));
ipcMain.handle('ollama:models', async () => {
  try {
    return { ok: true, models: await ollama.listModels(settings.load()) };
  } catch (err) {
    return { ok: false, error: err.message, kind: err.kind };
  }
});
ipcMain.handle('openai:models', async () => {
  try {
    return { ok: true, models: await openai.listModels(settings.load()) };
  } catch (err) {
    return { ok: false, error: err.message, kind: err.kind };
  }
});
ipcMain.handle('engine:status', async () => {
  try {
    return { ok: true, status: await engine.status(settings.load()) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

function sendChat(channel, payload) {
  if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send(channel, payload);
}

ipcMain.handle('model:ensure', async (_e, { vision }) => {
  try {
    await llama.ensureModel(settings.load(), !!vision, (p) => sendChat('model:progress', p));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('screen:capture', async () => {
  try {
    return { ok: true, image: await captureScreenBase64() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

function setDroidState(state) {
  if (droidWin && !droidWin.isDestroyed()) droidWin.webContents.send('droid:state', state);
}
function droidBubble(text) {
  if (droidWin && !droidWin.isDestroyed()) droidWin.webContents.send('droid:bubble', text);
}

// Short astromech acknowledgements shown in the desktop bubble when r10 finishes
// a reply (the real answer is in the chat window). Droid character, not English.
const DONE_CHIRPS = ['bdeep! done.', 'wheee-oo.', 'boop— sent.', 'chk. computed.', 'vwoorp!'];
const LOOK_CHIRPS = ['bdeep— scan complete.', 'wheee. i see it.', 'chk-chk. analyzed.'];
function pickChirp(fromImage) {
  const pool = fromImage ? LOOK_CHIRPS : DONE_CHIRPS;
  return pool[Math.floor(Math.random() * pool.length)];
}

ipcMain.handle('chat:send', async (e, { history, message, image }) => {
  const sender = e.sender;
  if (activeAbort) activeAbort.abort();
  activeAbort = new AbortController();
  setDroidState(image ? 'looking' : 'thinking');

  try {
    const result = await engine.chatStream({
      settings: settings.load(),
      history: history || [],
      message,
      image: image || null,
      signal: activeAbort.signal,
      onChunk: (chunk) => {
        if (!sender.isDestroyed()) sender.send('chat:chunk', chunk);
      },
      onProgress: (p) => {
        if (!sender.isDestroyed()) sender.send('model:progress', p);
      },
    });
    const full = result.text;
    // The full, human-language answer belongs in the chat window. On the desktop,
    // r10 stays in character: a quick "talking" beat, a happy wiggle, and a short
    // astromech chirp instead of parroting the reply text.
    setDroidState('talking');
    setTimeout(() => {
      setDroidState('happy');
      droidBubble(pickChirp(image));
      setTimeout(() => setDroidState('idle'), 2200);
    }, 1200);
    return { ok: true, text: full, backend: result.backend };
  } catch (err) {
    setDroidState('idle');
    if (err.name === 'AbortError') return { ok: false, aborted: true };
    return { ok: false, error: err.message, kind: err.kind };
  } finally {
    activeAbort = null;
  }
});

ipcMain.on('chat:stop', () => {
  if (activeAbort) activeAbort.abort();
});

ipcMain.on('open-external', (_e, url) => shell.openExternal(url));

// ---- lifecycle ----

if (app.dock) app.dock.hide(); // menu-bar / accessory style, no dock icon

app.whenReady().then(() => {
  createDroidWindow();
  createChatWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // Keep running even if chat hidden; only quit explicitly.
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
