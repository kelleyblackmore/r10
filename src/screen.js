'use strict';

const { execFile } = require('child_process');
const { promises: fs } = require('fs');
const os = require('os');
const path = require('path');

// Capture the main display to a PNG and return it as a base64 string (no data:
// prefix), suitable for Ollama or an OpenAI-compatible vision model.
//
// macOS uses the native `screencapture` CLI (clean Screen Recording permission
// prompt on first use). Other platforms (Windows/Linux) use Electron's built-in
// desktopCapturer, which is cross-platform and needs no external tool.

async function captureMac() {
  const tmp = path.join(os.tmpdir(), `r10-shot-${Date.now()}.png`);
  await new Promise((resolve, reject) => {
    // -x: no sound, -t png. Main display only.
    execFile('screencapture', ['-x', '-t', 'png', tmp], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  try {
    const buf = await fs.readFile(tmp);
    return buf.toString('base64');
  } finally {
    fs.unlink(tmp).catch(() => {});
  }
}

async function captureElectron() {
  // Lazy-require so this module stays loadable outside an Electron main process.
  const { desktopCapturer, screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.size;
  const scale = display.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
  });
  if (!sources.length) throw new Error('No screen source available to capture.');
  // Prefer the primary display by id when possible; fall back to the first.
  const primaryId = String(display.id);
  const src = sources.find((s) => s.display_id === primaryId) || sources[0];
  const png = src.thumbnail.toPNG();
  if (!png || !png.length) throw new Error('Screen capture returned an empty image.');
  return png.toString('base64');
}

async function captureScreenBase64() {
  if (process.platform === 'darwin') return captureMac();
  return captureElectron();
}

module.exports = { captureScreenBase64 };
