'use strict';

const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const settings = require('./settings');
const ollama = require('./ollama');
const openai = require('./openai');
const engine = require('./engine');
const llama = require('./llama');
const { captureScreenBase64 } = require('./screen');

let droidWin = null;
let chatWin = null;
let activeAbort = null;

const DROID_W = 160;
const DROID_H = 190;
const CHAT_W = 380;
const CHAT_H = 520;

function createDroidWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  droidWin = new BrowserWindow({
    width: DROID_W,
    height: DROID_H,
    x: workArea.x + workArea.width - DROID_W - 24,
    y: workArea.y + workArea.height - DROID_H - 24,
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

function toggleChat() {
  if (!chatWin) return;
  if (chatWin.isVisible()) {
    chatWin.hide();
  } else {
    positionChatNearDroid();
    chatWin.show();
    chatWin.focus();
  }
}

// ---- IPC ----

ipcMain.on('droid:toggle-chat', () => toggleChat());

ipcMain.on('droid:drag', (_e, { dx, dy }) => {
  if (!droidWin) return;
  const b = droidWin.getBounds();
  droidWin.setBounds({ x: b.x + Math.round(dx), y: b.y + Math.round(dy), width: b.width, height: b.height });
  if (chatWin && chatWin.isVisible()) positionChatNearDroid();
});

ipcMain.on('chat:hide', () => chatWin && chatWin.hide());

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
    setDroidState('talking');
    droidBubble(full);
    setTimeout(() => setDroidState('idle'), 4500);
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
});

app.on('window-all-closed', () => {
  // Keep running even if chat hidden; only quit explicitly.
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
