'use strict';

// Chooses between a running Ollama server and the in-process embedded engine.
// In 'auto' mode it prefers Ollama when it's running and has the needed model,
// otherwise it falls back to the embedded node-llama-cpp engine.

const ollama = require('./ollama');
const llama = require('./llama');

async function ollamaStatus(settings) {
  try {
    const models = await ollama.listModels(settings);
    return { up: true, models };
  } catch {
    return { up: false, models: [] };
  }
}

function hasModel(models, name) {
  if (!name) return false;
  const base = name.split(':')[0];
  return models.some((m) => m === name || m.split(':')[0] === base);
}

// Decide which backend handles this request.
// Returns { backend: 'ollama'|'embedded', reason } or { error }.
async function pick(settings, hasImage) {
  const mode = settings.engine || 'auto';

  if (mode === 'ollama') {
    return { backend: 'ollama' };
  }
  if (mode === 'embedded') {
    if (hasImage && !llama.supportsVision()) {
      return { error: 'Embedded vision is unavailable in this build. Switch engine to Auto/Ollama and `ollama pull llava` to use screen-watching.' };
    }
    return { backend: 'embedded' };
  }

  // auto
  const status = await ollamaStatus(settings);
  if (hasImage) {
    if (status.up && hasModel(status.models, settings.visionModel)) return { backend: 'ollama' };
    if (llama.supportsVision()) return { backend: 'embedded' };
    if (status.up) {
      return { error: `Ollama is running but has no vision model. Run:  ollama pull ${settings.visionModel}` };
    }
    return { backend: 'embedded' }; // will surface a clear message if vision truly unavailable
  }
  if (status.up && hasModel(status.models, settings.chatModel)) return { backend: 'ollama' };
  return { backend: 'embedded' };
}

async function chatStream(opts) {
  const { settings, image } = opts;
  const choice = await pick(settings, !!image);
  if (choice.error) {
    const err = new Error(choice.error);
    err.kind = 'config';
    throw err;
  }
  if (choice.backend === 'ollama') {
    return { backend: 'ollama', text: await ollama.chatStream(opts) };
  }
  return { backend: 'embedded', text: await llama.chatStream(opts) };
}

// Report current engine status for the UI.
async function status(settings) {
  const mode = settings.engine || 'auto';
  const os = await ollamaStatus(settings);
  const embedded = {
    available: llama.isAvailable(),
    vision: llama.supportsVision(),
    chatReady: llama.isModelReady(settings, false),
    visionReady: llama.isModelReady(settings, true),
  };
  let active;
  if (mode === 'ollama') active = 'ollama';
  else if (mode === 'embedded') active = 'embedded';
  else active = os.up && hasModel(os.models, settings.chatModel) ? 'ollama' : 'embedded';
  // Can r10 actually look at the screen right now? (Ollama vision model present, or embedded vision.)
  const visionAvailable = (os.up && hasModel(os.models, settings.visionModel)) || llama.supportsVision();
  return { mode, active, ollama: os, embedded, visionAvailable, visionModel: settings.visionModel };
}

module.exports = { chatStream, status, pick };
