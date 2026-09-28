'use strict';

// System health monitor: samples disk, memory, and CPU on whatever machine r10
// is running on and raises an alert when something starts to fill up. Every
// reading comes from the local OS — nothing is sent anywhere.

const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');

const SAMPLE_MS = 30000;
const REARM_MARGIN = 5;  // a metric must drop this many points below its threshold before it can alert again
const WORSEN_STEP = 5;   // while still over, re-alert only if it climbs this many more points
const CPU_SUSTAIN = 10;  // CPU must stay over threshold this many samples in a row (~5 min) — brief spikes are normal

const GB = 1024 ** 3;

function diskStats() {
  // The volume holding the user's home folder: the data volume on macOS (APFS
  // reports the shared container's space), C: on Windows.
  const s = fs.statfsSync(os.homedir());
  const total = s.blocks * s.bsize;
  const free = s.bavail * s.bsize;
  return { pct: total ? ((total - free) / total) * 100 : 0, freeGB: free / GB, totalGB: total / GB };
}

function sysctl(name) {
  return new Promise((resolve, reject) => {
    execFile('sysctl', ['-n', name], { timeout: 3000 }, (err, out) => (err ? reject(err) : resolve(out.trim())));
  });
}

async function memStats() {
  const total = os.totalmem();
  let pct;
  if (process.platform === 'darwin') {
    // os.freemem() on macOS ignores reclaimable cache and reads ~99% "used" on a
    // healthy Mac. memorystatus_level is the kernel's own "% memory available"
    // figure behind the Memory Pressure graph in Activity Monitor.
    try {
      const level = Number(await sysctl('kern.memorystatus_level'));
      if (Number.isFinite(level)) pct = 100 - level;
    } catch { /* fall through */ }
  } else if (process.platform === 'linux') {
    try {
      const m = /MemAvailable:\s+(\d+) kB/.exec(fs.readFileSync('/proc/meminfo', 'utf8'));
      if (m) pct = (1 - (Number(m[1]) * 1024) / total) * 100;
    } catch { /* fall through */ }
  }
  if (pct === undefined) pct = (1 - os.freemem() / total) * 100;
  return { pct, totalGB: total / GB };
}

// CPU busy % since the previous sample, across all cores (os.loadavg() is always
// 0 on Windows, so measure it directly).
let lastCpu = null;
function cpuStats() {
  const now = os.cpus().reduce(
    (acc, c) => {
      const t = c.times;
      acc.idle += t.idle;
      acc.total += t.user + t.nice + t.sys + t.idle + t.irq;
      return acc;
    },
    { idle: 0, total: 0 },
  );
  const prev = lastCpu;
  lastCpu = now;
  if (!prev || now.total === prev.total) return { pct: 0 };
  return { pct: (1 - (now.idle - prev.idle) / (now.total - prev.total)) * 100 };
}

async function sample() {
  const out = { at: Date.now(), cpu: cpuStats() };
  try { out.disk = diskStats(); } catch { out.disk = null; }
  try { out.mem = await memStats(); } catch { out.mem = null; }
  return out;
}

function summary(s) {
  const parts = [];
  if (s.disk) parts.push(`disk ${Math.round(s.disk.pct)}%`);
  if (s.mem) parts.push(`mem ${Math.round(s.mem.pct)}%`);
  parts.push(`cpu ${Math.round(s.cpu.pct)}%`);
  return parts.join(' · ');
}

// ---- alerting ----
// Each metric alerts once when it crosses its threshold, again only if it keeps
// getting worse, and re-arms once it has clearly recovered — so r10 flags real
// trouble without nagging every 30 seconds.

const alertState = { disk: {}, mem: {}, cpu: {} };

// Forget alert history — used when monitoring (or one metric) is switched off,
// so a metric that recovered in the meantime alerts normally once it's back on.
function resetAlerts(key) {
  for (const k of key ? [key] : Object.keys(alertState)) alertState[k] = {};
}

function check(key, value, threshold, sustain, message, onAlert) {
  if (!threshold) return resetAlerts(key);
  const st = alertState[key];
  if (value == null) return;
  if (value >= threshold) {
    st.streak = (st.streak || 0) + 1;
    if (st.streak < sustain) return;
    if (!st.alerted || value >= st.level + WORSEN_STEP) {
      st.alerted = true;
      st.level = value;
      onAlert({ metric: key, value: Math.round(value), text: message() });
    }
  } else {
    st.streak = 0;
    if (st.alerted && value < threshold - REARM_MARGIN) st.alerted = false;
  }
}

function evaluate(s, cfg, onAlert) {
  check('disk', s.disk && s.disk.pct, cfg.diskPct, 1,
    () => `disk ${Math.round(s.disk.pct)}% full — ${s.disk.freeGB.toFixed(1)} GB left`, onAlert);
  check('mem', s.mem && s.mem.pct, cfg.memPct, 2,
    () => `memory ${Math.round(s.mem.pct)}% used — close some apps`, onAlert);
  check('cpu', s.cpu.pct, cfg.cpuPct, CPU_SUSTAIN,
    () => `cpu pinned at ${Math.round(s.cpu.pct)}% for 5+ min`, onAlert);
}

// ---- lifecycle ----

let timer = null;
let firstTimer = null;
let latest = null;
let generation = 0; // bumps on every (re)start so an in-flight tick from an old config is dropped

// cfg: { enabled, diskPct, memPct, cpuPct } (0 disables a metric).
// onSample(stats) fires every tick; onAlert({ metric, value, text }) on a new alert.
function start(cfg, { onSample, onAlert }) {
  clearTimers();
  const gen = ++generation;
  if (!cfg.enabled) {
    latest = null;
    resetAlerts();
    return;
  }
  const tick = async () => {
    const s = await sample();
    if (gen !== generation) return;
    latest = s;
    evaluate(latest, cfg, onAlert);
    onSample(latest);
  };
  if (!latest) cpuStats(); // prime the CPU baseline so the first real sample has a delta
  firstTimer = setTimeout(tick, 2000);
  timer = setInterval(tick, SAMPLE_MS);
}

function clearTimers() {
  clearTimeout(firstTimer);
  clearInterval(timer);
  firstTimer = timer = null;
}

module.exports = { start, summary, latest: () => latest };
