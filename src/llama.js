'use strict';

// In-process AI engine backed by node-llama-cpp (embeds llama.cpp, runs GGUF
// models with no external server). node-llama-cpp v3 is ESM-only, so we load it
// via dynamic import from this CommonJS module. Everything degrades gracefully:
// if the native module can't load, isAvailable() returns false and the app
// keeps working through Ollama.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

let _mod = null; // the imported node-llama-cpp module
let _llama = null; // getLlama() instance
let _available = false;
let _visionSupported = false;
let _initPromise = null;
const _models = new Map(); // path -> loaded model

function modelDir() {
  const dir = path.join(app.getPath('userData'), 'models');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function init() {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    try {
      _mod = await import('node-llama-cpp');
      _llama = await _mod.getLlama();
      _available = true;
      // Vision needs llama.cpp multimodal (mmproj) support in this build.
      _visionSupported = typeof _mod.LlamaContext !== 'undefined' && typeof _llama.loadModel === 'function'
        && typeof _mod.resolveModelFile === 'function' && _supportsMtmd();
    } catch (err) {
      _available = false;
      _visionSupported = false;
    }
  })();
  return _initPromise;
}

// Best-effort detection of multimodal support in the installed binding.
function _supportsMtmd() {
  try {
    // node-llama-cpp exposes vision via the chat-session image input when the
    // model is loaded with an mmproj. We expose vision only when the API exists.
    return typeof _mod.LlamaChatSession !== 'undefined';
  } catch {
    return false;
  }
}

// kick off init in the background
init();

function isAvailable() {
  return _available;
}

function supportsVision() {
  // Conservatively disabled until verified against the installed binding.
  // Vision (screen-watching) is handled by Ollama in the meantime.
  return false;
}

function modelPathFor(settings, vision) {
  const cfg = vision ? settings.embedded.vision : settings.embedded.chat;
  return path.join(modelDir(), cfg.file);
}

// Once we've seen the chat model on disk we cache it: a downloaded model never
// disappears mid-session, so there's no need to keep stat-ing the filesystem.
let _chatReadyCache = false;

function isModelReady(settings, vision) {
  try {
    if (!vision && _chatReadyCache) return true;
    const ok = fs.existsSync(modelPathFor(settings, vision));
    if (!vision && ok) _chatReadyCache = true;
    return ok;
  } catch {
    return false;
  }
}

async function _download({ url, dir, fileName, label, onProgress }) {
  const downloader = await _mod.createModelDownloader({
    modelUri: url,
    dirPath: dir,
    fileName,
    onProgress: ({ totalSize, downloadedSize }) => {
      if (onProgress) onProgress({ phase: 'Downloading', label, total: totalSize, downloaded: downloadedSize });
    },
  });
  await downloader.download();
}

async function ensureModel(settings, vision, onProgress) {
  await init();
  if (!_available) throw new Error('Built-in engine is unavailable (node-llama-cpp failed to load).');
  const cfg = vision ? settings.embedded.vision : settings.embedded.chat;
  const target = modelPathFor(settings, vision);
  let didDownload = false;
  if (!fs.existsSync(target)) {
    await _download({ url: cfg.url, dir: modelDir(), fileName: cfg.file, label: cfg.file, onProgress });
    didDownload = true;
  }
  if (vision && cfg.mmprojUrl) {
    const mmproj = path.join(modelDir(), cfg.mmprojFile);
    if (!fs.existsSync(mmproj)) {
      await _download({ url: cfg.mmprojUrl, dir: modelDir(), fileName: cfg.mmprojFile, label: cfg.mmprojFile, onProgress });
      didDownload = true;
    }
  }
  if (!vision) _chatReadyCache = true;
  // Only surface a "ready" progress event when we actually downloaded something.
  // Otherwise every ordinary prompt would flash a "model ready" bubble.
  if (didDownload && onProgress) onProgress({ phase: 'Ready', label: cfg.file, done: true });
  return target;
}

async function _getModel(settings, vision, onProgress) {
  const target = await ensureModel(settings, vision, onProgress);
  if (_models.has(target)) return _models.get(target);
  const model = await _llama.loadModel({ modelPath: target });
  _models.set(target, model);
  return model;
}

function _toChatHistory(systemPrompt, history) {
  const items = [];
  if (systemPrompt) items.push({ type: 'system', text: systemPrompt });
  for (const turn of history) {
    if (turn.role === 'assistant') items.push({ type: 'model', response: [turn.content] });
    else items.push({ type: 'user', text: turn.content });
  }
  return items;
}

async function chatStream({ settings, history, message, image, onChunk, onProgress, signal }) {
  await init();
  if (!_available) throw new Error('Built-in engine is unavailable (node-llama-cpp failed to load).');
  if (image && !supportsVision()) {
    const err = new Error('Built-in vision is not available — screen-watching needs Ollama (`ollama pull llava`). Switch engine to Auto.');
    err.kind = 'config';
    throw err;
  }

  const model = await _getModel(settings, false, onProgress);
  const context = await model.createContext();
  try {
    const session = new _mod.LlamaChatSession({
      contextSequence: context.getSequence(),
    });
    session.setChatHistory(_toChatHistory(settings.systemPrompt, history));
    let full = '';
    const text = await session.prompt(message, {
      signal,
      onTextChunk: (chunk) => {
        full += chunk;
        if (onChunk) onChunk(chunk);
      },
    });
    return text || full;
  } finally {
    await context.dispose().catch(() => {});
  }
}

module.exports = { isAvailable, supportsVision, isModelReady, ensureModel, chatStream, init };
