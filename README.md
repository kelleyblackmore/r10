# r10 🤖

A cute, animated AI droid companion for your Mac desktop — a little R2-style astromech named **r10** that floats on your screen, chats in bubbles, and can take a look at what you're doing when you ask.

- **Floating animated droid** — white/red/black astromech, always-on-top, drag it anywhere. It bobs, blinks, and reacts (thinking / looking / talking).
- **Click to chat** — a clean chat window with streaming replies.
- **On-demand screen awareness** — tap 👁 and r10 captures your screen *once* and helps with what it sees. Nothing is watched in the background.
- **100% local AI** — runs entirely on your Mac. No cloud, no API keys, your screen never leaves the machine.

## AI engine: built-in + Ollama

r10 has **two** local backends and picks automatically (`Auto` mode):

1. **Built-in (embedded)** — an in-process engine ([`node-llama-cpp`](https://github.com/withcatai/node-llama-cpp)) that runs a `.gguf` model directly inside r10. Works out of the box: the first time you open the chat, r10 shows a one-time **"Download now"** prompt for a balanced ~8B chat model (~5 GB, with a progress bar). The model is saved to disk and **reused on every launch** — it is *not* re-downloaded each time you start the app, and r10 won't try to chat until it's ready.
2. **Ollama (preferred when running)** — if you have [Ollama](https://ollama.com) running, r10 uses it automatically for better/larger models and for **screen-watching** (vision). Vision currently runs through Ollama (`ollama pull llava`).

Pick the engine explicitly in ⚙ Settings (Auto / Built-in only / Ollama only).

### Optional: Ollama for best quality + screen-watching

```bash
brew install ollama          # or download from ollama.com/download
ollama serve                 # or just open the Ollama app
ollama pull llama3.2         # chat
ollama pull llava            # screen-watching (vision)
```

---

## Run r10

```bash
npm install
npm start
```

A little droid appears in the bottom-right of your screen.

- **Click** the droid → open / close the chat window.
- **Drag** the droid → move it anywhere.
- **👁 button** in chat → r10 captures your screen and answers about it.
- **✕ button** in the chat title bar → quit r10.

> First time you use 👁, macOS asks for **Screen Recording** permission
> (System Settings → Privacy & Security → Screen Recording). Grant it and re-tap 👁.

## Build a double-click app (.dmg)

```bash
npm run dist
```

The installer lands in `release/` (e.g. `r10-0.1.0-arm64.dmg`). Open the `.dmg`, drag **r10** to Applications, then launch it from there.

> **First launch on an unsigned build:** macOS Gatekeeper will warn that the app is from an unidentified developer (it isn't notarized with an Apple Developer ID). Right-click **r10.app → Open → Open**, just once, and macOS remembers it afterward.

Build for both Apple Silicon and Intel with `npm run dist` (default), or a single arch with `npx electron-builder --mac dmg --arm64` (Apple Silicon) / `--x64` (Intel). You get one `.dmg` per architecture:

- `r10-<version>-arm64.dmg` — Apple Silicon (Metal-accelerated built-in engine)
- `r10-<version>.dmg` — Intel (x64 built-in engine)

> **Building the Intel `.dmg` from an Apple Silicon Mac:** `npm install` only fetches the engine's native binary for *your* CPU, so a cross-arch build would otherwise ship the wrong binary and the built-in engine would fail on Intel. Pull the x64 engine binary first:
> ```bash
> npm install --no-save --force @node-llama-cpp/mac-x64
> npx electron-builder --mac dmg --x64
> ```
> (Do the reverse — `@node-llama-cpp/mac-arm64-metal` — when building the arm64 `.dmg` from an Intel Mac.)

> **Universal (single fat) `.dmg`:** not used here — `@electron/universal`'s ASAR merge currently chokes on the engine's unpacked native binaries ("pattern is too long"). Two per-arch `.dmg`s avoid that and keep each download smaller.

## Start / stop / uninstall

| Action | How |
| --- | --- |
| **Start** | Launch r10 from Applications (or `npm start` in dev) |
| **Stop** | Click the droid → ✕ in the chat title bar, or quit from the app |
| **Uninstall** | Drag **r10.app** from Applications to the Trash |
| **Remove settings** | Delete `~/Library/Application Support/r10/` |

r10 runs as a menu-bar-style accessory app (no Dock icon) so it stays out of your way.

## Configuration

Open chat → ⚙ Settings:

- **AI engine** — Auto (default) / Built-in only / Ollama only
- **Built-in model downloads** — buttons to pre-fetch the embedded chat / vision models
- **Ollama URL** — default `http://127.0.0.1:11434`
- **Ollama chat / vision model** — defaults `llama3.2` / `llama3.2-vision`
- **Persona** — the system prompt that gives r10 its personality

Settings **auto-save the moment you change a field** (no Save step needed — closing or re-opening the panel never reverts them).

Settings + downloaded models are saved under `~/Library/Application Support/r10/`
(models live in `…/r10/models/`).

## How it works

```
Electron main process (src/main.js)
├── Droid window      → transparent, always-on-top, custom drag (src/windows/droid.*)
├── Chat window       → streaming chat UI + settings + download progress (src/windows/chat.*)
├── engine.js         → auto-selects Ollama (if running) vs the embedded engine
├── llama.js          → embedded in-process engine via node-llama-cpp (.gguf models)
├── ollama.js         → streaming chat client for a local Ollama server
├── screen.js         → on-demand screenshot via macOS `screencapture`
└── settings.js       → JSON settings in userData
```

The renderer talks to the main process over a small, contextIsolated `preload.js` bridge — no Node access in the UI.

## Troubleshooting

- **Status shows "built-in · model not downloaded"** — click the **Download now** prompt in the chat (or ⚙ Settings → *Download built-in chat model*). It downloads once and is reused on every launch.
- **Screen-watching (👁) says vision unavailable** — vision runs through Ollama: `ollama pull llava`, then set engine to Auto.
- **"Model not installed" (Ollama)** — run the `ollama pull …` command r10 shows you.
- **👁 fails to capture** — grant Screen Recording permission (System Settings → Privacy & Security), then retry.
