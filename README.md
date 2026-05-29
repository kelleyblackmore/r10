# r10 🤖

A cute, animated AI droid companion for your Mac desktop — a little R2-style astromech named **r10** that floats on your screen, chats in bubbles, and can take a look at what you're doing when you ask.

- **Floating animated droid** — white/red/black astromech, always-on-top, drag it anywhere. It bobs, blinks, and reacts (thinking / looking / talking).
- **Click to chat** — a clean chat window with streaming replies.
- **On-demand screen awareness** — tap 👁 and r10 captures your screen *once* and helps with what it sees. Nothing is watched in the background.
- **100% local AI** — runs entirely on your Mac. No cloud, no API keys, your screen never leaves the machine.

## AI engine: built-in + Ollama + API

r10 has **three** backends. Two run fully locally; the third talks to any hosted/OpenAI-compatible model server (great for work deployments). In `Auto` mode r10 picks between the two local ones automatically:

1. **Built-in (embedded)** — an in-process engine ([`node-llama-cpp`](https://github.com/withcatai/node-llama-cpp)) that runs a `.gguf` model directly inside r10. The macOS installer **ships with a compact ~1B chat model bundled inside the `.dmg`** (≈0.8 GB), so the built-in engine works the moment you install — **no first-run download**. (If you run from source in dev, the model is downloaded once to your user data folder instead and reused thereafter.)
2. **Ollama (preferred when running)** — if you have [Ollama](https://ollama.com) running, r10 uses it automatically for better/larger models and for **screen-watching** (vision). Local vision runs through Ollama (`ollama pull llava`).
3. **API (OpenAI-compatible)** — point r10 at the public OpenAI API or **your own/work model gateway** (anything exposing `/v1/chat/completions`: Azure OpenAI gateways, vLLM, LM Studio, llama.cpp server, internal corporate endpoints…). It's pure HTTP, so it needs **no native engine and works identically on macOS and Windows**. Screen-watching (👁) works too if the configured model accepts images. Set it in ⚙ Settings → **API**: URL, key, and model name.

Pick the engine explicitly in ⚙ Settings (Auto / Built-in only / Ollama only / API only).

> **Deploying at work / on Windows:** select **API (OpenAI-compatible) only**, set the **API URL** to your gateway (e.g. `https://your-gateway/v1`), paste your **API key/token**, and enter the **model** name. The embedded GGUF engine isn't needed in this mode — which is exactly why the Windows build relies on it.

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

> **Bundling the built-in model locally:** the `.dmg` ships the embedded chat model from `build/models/*.gguf` (via electron-builder `extraResources`). CI downloads it automatically; for a *local* `npm run dist` that includes the model, drop the GGUF there first:
> ```bash
> mkdir -p build/models
> curl -L -o build/models/Llama-3.2-1B-Instruct-Q4_K_M.gguf \
>   https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf
> ```
> If `build/models` is empty, the build still works — the app just falls back to the one-time first-run download.

> **First launch on an unsigned build:** because r10 isn't signed/notarized with an Apple Developer ID, Gatekeeper shows *"Apple could not verify 'r10' is free of malware…"*. This is expected for unsigned apps — not an actual malware finding. Two ways to open it:
>
> - **Terminal (quickest):** strip the quarantine flag, then open normally:
>   ```bash
>   xattr -dr com.apple.quarantine /Applications/r10.app
>   ```
> - **No terminal:** double-click r10 → **Done**, then **System Settings → Privacy & Security**, scroll to *"r10 was blocked…"* → **Open Anyway** → confirm with Touch ID/password. macOS remembers it afterward.
>
> (On macOS Sequoia and later, Apple removed the old right-click → **Open** shortcut — you must use one of the two methods above.)

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

## Build a Windows app (.exe installer)

The Windows build is intended to run against the **API (OpenAI-compatible)** engine — your work/hosted model gateway — so it doesn't need the native GGUF engine at all. Screen capture and chat are fully cross-platform.

```bash
npm install
npm run dist:win        # produces an NSIS installer in release/
```

This yields `release/r10 Setup <version>.exe` (x64). The installer lets the user pick the install location and cleans up app data on uninstall.

> **Build host:** electron-builder *can* cross-build a Windows installer from macOS, but native modules and Windows code signing make a real Windows machine — or a CI **`windows-latest`** runner running `npm ci && npm run dist:win` — the reliable path. The build is unsigned, so on first launch Windows SmartScreen shows a "Windows protected your PC" warning: click **More info → Run anyway** once.

> **Embedded engine on Windows:** not bundled by default — `npm install` on a non-Windows host won't fetch `@node-llama-cpp/win-x64`, and the API engine doesn't need it. If you *do* want the built-in GGUF engine on Windows, build on Windows (or `npm install --no-save --force @node-llama-cpp/win-x64` first) and select an engine other than API. Otherwise r10 reports the built-in engine as unavailable and you use **API** (or Ollama).

## Releases (automated builds)

A GitHub Actions workflow (`.github/workflows/build.yml`) builds the installers on GitHub's runners — no local toolchain needed:

- **macOS** runner → both `.dmg`s (arm64 + Intel x64)
- **Windows** runner → the `.exe` installer

**Cut a release** by pushing a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow builds all three installers and attaches them to a GitHub **Release** for that tag, so anyone can download them from the repo's Releases page. You can also trigger it manually from the **Actions → Build installers → Run workflow** button (that run uploads the installers as workflow *artifacts* but doesn't create a Release).

> Without signing secrets (below), builds are **unsigned**, so first launch shows the Gatekeeper / SmartScreen prompt described above.

### Signing & notarization (removes the macOS Gatekeeper warning)

The workflow signs and notarizes the macOS build automatically **once these repo secrets are set** (Settings → Secrets and variables → Actions → *New repository secret*). Until they're present, it falls back to an unsigned build — nothing breaks.

| Secret | What it is |
| --- | --- |
| `MAC_CERT_P12_BASE64` | Your **Developer ID Application** certificate exported as `.p12`, base64-encoded |
| `MAC_CERT_PASSWORD` | The password you set when exporting the `.p12` |
| `APPLE_ID` | Your Apple ID email (Developer Program account) |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password from [appleid.apple.com](https://appleid.apple.com) → Sign-In & Security → App-Specific Passwords |
| `APPLE_TEAM_ID` | Your 10-character Team ID (developer.apple.com → Membership) |

**Getting the certificate (one-time):**

1. In **Xcode → Settings → Accounts**, select your team → **Manage Certificates… → + → Developer ID Application**. (Or create it at developer.apple.com → Certificates.)
2. In **Keychain Access**, find *"Developer ID Application: …"*, right-click → **Export** → save as `cert.p12` with a password.
3. Base64-encode it for the secret:
   ```bash
   base64 -i cert.p12 | pbcopy   # now paste into the MAC_CERT_P12_BASE64 secret
   ```

With all five secrets set, the next tagged build produces a **signed + notarized** `.dmg` that opens with a normal double-click — no `xattr` or "Open Anyway" needed. (Windows signing is separate and not configured; the `.exe` stays unsigned.)

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

- **AI engine** — Auto (default) / Built-in only / Ollama only / API only
- **Built-in model downloads** — buttons to pre-fetch the embedded chat / vision models
- **API URL / key / model / vision model** — for the OpenAI-compatible engine (work/hosted gateway). The settings panel pings the endpoint to confirm it's reachable.
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
├── engine.js         → selects API / Ollama / embedded backend per request
├── llama.js          → embedded in-process engine via node-llama-cpp (.gguf models)
├── ollama.js         → streaming chat client for a local Ollama server
├── openai.js         → streaming client for any OpenAI-compatible API (work/hosted)
├── screen.js         → on-demand screenshot (macOS `screencapture`; desktopCapturer elsewhere)
└── settings.js       → JSON settings in userData
```

The renderer talks to the main process over a small, contextIsolated `preload.js` bridge — no Node access in the UI.

## Troubleshooting

- **Status shows "built-in · model not downloaded"** — only happens when the bundled model isn't present (e.g. running from source). Click the **Download now** prompt in the chat (or ⚙ Settings → *Download built-in chat model*). It downloads once and is reused on every launch. Installed `.dmg` builds ship the model, so they skip this entirely.
- **Screen-watching (👁) says vision unavailable** — vision runs through Ollama: `ollama pull llava`, then set engine to Auto.
- **API engine errors** — the status light shows the problem: *auth* means a bad/missing API key; *404* means the model name or URL is wrong; *offline* means the gateway is unreachable (check the URL and your VPN). The ⚙ Settings panel pings the endpoint and lists available models to confirm it's reachable.
- **"Model not installed" (Ollama)** — run the `ollama pull …` command r10 shows you.
- **👁 fails to capture** — grant Screen Recording permission (System Settings → Privacy & Security), then retry.
