'use strict';

// Minimal streaming client for any OpenAI-compatible chat API.
// Works with the OpenAI API itself, Azure OpenAI (via a compatible gateway),
// vLLM, LM Studio, llama.cpp server, and most internal/corporate model
// gateways that expose `/v1/chat/completions` with Server-Sent Events.
//
// Designed to mirror ollama.js's chatStream() contract so engine.js can treat
// the three backends interchangeably.

class OpenAIError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'OpenAIError';
    this.kind = kind; // 'config' | 'auth' | 'model-missing' | 'offline' | 'http'
  }
}

function baseUrl(settings) {
  // Default to the public OpenAI endpoint; work deployments override this with
  // their own gateway URL (which should already include the version prefix).
  return (settings.openaiUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
}

function headers(settings) {
  const h = { 'Content-Type': 'application/json' };
  if (settings.openaiKey) h['Authorization'] = `Bearer ${settings.openaiKey}`;
  return h;
}

// Is there enough configuration to even attempt a request?
function configured(settings) {
  return !!(settings.openaiUrl && settings.openaiModel);
}

/**
 * Stream a chat completion from an OpenAI-compatible endpoint.
 * @param {object} opts
 * @param {object} opts.settings - app settings (openaiUrl, openaiKey, openaiModel, openaiVisionModel, systemPrompt)
 * @param {Array}  opts.history  - prior [{role, content}] turns
 * @param {string} opts.message  - the new user message
 * @param {string|null} opts.image - base64 PNG (no data: prefix) to attach, or null
 * @param {(chunk: string) => void} opts.onChunk - called with each token chunk
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<string>} full assistant text
 */
async function chatStream({ settings, history, message, image, onChunk, signal }) {
  if (!settings.openaiModel) {
    throw new OpenAIError(
      'No API model is set. Open ⚙ Settings → API and enter a model name.',
      'config'
    );
  }
  const model = image ? settings.openaiVisionModel || settings.openaiModel : settings.openaiModel;

  const messages = [];
  if (settings.systemPrompt) messages.push({ role: 'system', content: settings.systemPrompt });
  for (const turn of history) messages.push({ role: turn.role, content: turn.content });

  if (image) {
    // OpenAI multimodal format: content is an array of parts.
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: message },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${image}` } },
      ],
    });
  } else {
    messages.push({ role: 'user', content: message });
  }

  let res;
  try {
    res = await fetch(`${baseUrl(settings)}/chat/completions`, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({ model, messages, stream: true }),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new OpenAIError(
      `Could not reach the API at ${baseUrl(settings)}. Check the URL and your network/VPN.`,
      'offline'
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      throw new OpenAIError(
        'The API rejected the request (auth). Check your API key in ⚙ Settings.',
        'auth'
      );
    }
    if (res.status === 404) {
      throw new OpenAIError(
        `Model "${model}" or endpoint not found (404). Check the model name and API URL in ⚙ Settings.`,
        'model-missing'
      );
    }
    throw new OpenAIError(`API error ${res.status}: ${text.slice(0, 300)}`, 'http');
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
      if (!line || !line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return full;
      let obj;
      try {
        obj = JSON.parse(data);
      } catch {
        continue;
      }
      if (obj.error) {
        const msg = obj.error.message || String(obj.error);
        throw new OpenAIError(msg, 'http');
      }
      const choice = obj.choices && obj.choices[0];
      const piece = choice && choice.delta && choice.delta.content;
      if (piece) {
        full += piece;
        if (onChunk) onChunk(piece);
      }
    }
  }

  return full;
}

// Probe the endpoint by listing models (GET /models). Used by the settings
// panel to confirm the URL/key work and to show what's available.
async function listModels(settings) {
  let res;
  try {
    res = await fetch(`${baseUrl(settings)}/models`, { headers: headers(settings) });
  } catch {
    throw new OpenAIError(`Could not reach the API at ${baseUrl(settings)}.`, 'offline');
  }
  if (res.status === 401 || res.status === 403) {
    throw new OpenAIError('Auth rejected — check your API key.', 'auth');
  }
  if (!res.ok) throw new OpenAIError(`API returned ${res.status}`, 'http');
  const data = await res.json().catch(() => ({}));
  return (data.data || []).map((m) => m.id).filter(Boolean);
}

module.exports = { chatStream, listModels, configured, OpenAIError };
