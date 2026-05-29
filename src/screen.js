'use strict';

const { execFile } = require('child_process');
const { promises: fs } = require('fs');
const os = require('os');
const path = require('path');

// Capture the main display to a PNG using the macOS `screencapture` CLI,
// then return it as a base64 string (no data: prefix), suitable for Ollama.
// Requires Screen Recording permission (macOS will prompt on first use).
async function captureScreenBase64() {
  const tmp = path.join(os.tmpdir(), `r10-shot-${Date.now()}.png`);
  await new Promise((resolve, reject) => {
    // -x: no sound, -t png, -C: capture cursor off by default. Main display only.
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

module.exports = { captureScreenBase64 };
