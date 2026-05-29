'use strict';

const { app } = require('electron');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // Backend selection: 'auto' prefers a running Ollama, else uses the embedded engine.
  engine: 'auto', // 'auto' | 'embedded' | 'ollama' | 'openai'

  // Ollama (used when running / when engine='ollama')
  ollamaUrl: 'http://127.0.0.1:11434',
  chatModel: 'llama3.2',
  visionModel: 'llama3.2-vision',

  // OpenAI-compatible API (used when engine='openai'). Point this at the public
  // OpenAI API or any compatible gateway (work model server, vLLM, LM Studio…).
  // This backend is pure HTTP, so it works identically on macOS and Windows.
  openaiUrl: 'https://api.openai.com/v1',
  openaiKey: '',
  openaiModel: '', // e.g. 'gpt-4o-mini' or your work model id
  openaiVisionModel: '', // optional; falls back to openaiModel for screen-watching

  // Embedded engine (node-llama-cpp) — balanced ~7-8B GGUF models, auto-downloaded on first use.
  embedded: {
    chat: {
      file: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
      url: 'https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
    },
    vision: {
      file: 'llava-v1.6-mistral-7b.Q4_K_M.gguf',
      url: 'https://huggingface.co/cjpais/llava-1.6-mistral-7b-gguf/resolve/main/llava-v1.6-mistral-7b.Q4_K_M.gguf',
      mmprojFile: 'mmproj-llava-v1.6-mistral-7b-f16.gguf',
      mmprojUrl: 'https://huggingface.co/cjpais/llava-1.6-mistral-7b-gguf/resolve/main/mmproj-model-f16.gguf',
    },
  },

  systemPrompt:
    "You are r10, a cheerful little astromech-style droid companion living on the user's Mac desktop. " +
    'You are curious, warm, and concise. Keep replies short and friendly (a few sentences). ' +
    'You can be given a screenshot of the user\'s screen when they ask you to look; describe and help with what you see. ' +
    'Occasionally show a tiny bit of droid personality, but never overdo it and never use emoji spam.',
};

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load() {
  try {
    const raw = fs.readFileSync(file(), 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(partial) {
  const merged = { ...load(), ...partial };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(merged, null, 2));
  return merged;
}

module.exports = { load, save, DEFAULTS };
