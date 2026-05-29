'use strict';

// Minimal streaming client for a local Ollama server.
// Docs: https://github.com/ollama/ollama/blob/main/docs/api.md

class OllamaError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'OllamaError';
    this.kind = kind; // 'offline' | 'model-missing' | 'http' | 'unknown'
  }
}

function baseUrl(settings) {
  return (settings.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
}

async function listModels(settings) {
  let res;
  try {
    res = await fetch(`${baseUrl(settings)}/api/tags`);
  } catch (err) {
    throw new OllamaError(
      'Could not reach Ollama. Is it installed and running? Try `ollama serve`.',
      'offline'
    );
  }
  if (!res.ok) throw new OllamaError(`Ollama returned ${res.status}`, 'http');
  const data = await res.json();
  return (data.models || []).map((m) => m.name);
}

/**
 * Stream a chat completion from Ollama.
 * @param {object} opts
 * @param {object} opts.settings - app settings (ollamaUrl, chatModel, visionModel, systemPrompt)
 * @param {Array} opts.history - prior [{role, content}] turns
 * @param {string} opts.message - the new user message
 * @param {string|null} opts.image - base64 PNG (no data: prefix) to attach, or null
 * @param {(chunk: string) => void} opts.onChunk - called with each token chunk
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<string>} full assistant text
 */
async function chatStream({ settings, history, message, image, onChunk, signal }) {
  const model = image ? settings.visionModel : settings.chatModel;
  const messages = [];
  if (settings.systemPrompt) {
    messages.push({ role: 'system', content: settings.systemPrompt });
  }
  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.content });
  }
  const userMsg = { role: 'user', content: message };
  if (image) userMsg.images = [image];
  messages.push(userMsg);

  let res;
  try {
    res = await fetch(`${baseUrl(settings)}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new OllamaError(
      'Could not reach Ollama. Is it installed and running? Try `ollama serve`.',
      'offline'
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 404 || /not found|no such model/i.test(text)) {
      throw new OllamaError(
        `Model "${model}" is not installed. Run:  ollama pull ${model}`,
        'model-missing'
      );
    }
    throw new OllamaError(`Ollama error ${res.status}: ${text}`, 'http');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj.error) {
        if (/not found|no such model/i.test(obj.error)) {
          throw new OllamaError(
            `Model "${model}" is not installed. Run:  ollama pull ${model}`,
            'model-missing'
          );
        }
        throw new OllamaError(obj.error, 'http');
      }
      const piece = obj.message && obj.message.content ? obj.message.content : '';
      if (piece) {
        full += piece;
        if (onChunk) onChunk(piece);
      }
    }
  }

  return full;
}

module.exports = { chatStream, listModels, OllamaError };
