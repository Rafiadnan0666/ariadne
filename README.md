# Ariadne Browser

A desktop browser built with Electron, React, and TypeScript that integrates local-first AI directly into the browsing experience. The browser layer is fully functional on its own; the AI layer adds cross-tab context retrieval and a browser automation agent.

---

## Version 0.3.0-test — Current Capabilities

### Browser Layer (Stable)

| Component | Implementation |
|-----------|----------------|
| Tab management | Horizontal tab strip with drag-reorder, pin, mute, duplicate, middle-click close, reopen closed tabs |
| Address bar | URL entry, search detection, suggestions from history and bookmarks |
| Navigation | Back, forward, reload, stop, home, view source (Ctrl+U) |
| Downloads | Progress, pause/resume/cancel, open file/folder, retry, filter by status |
| Bookmarks | Bar with nested folders; manager with add/edit/delete/move, HTML import/export |
| History | Searchable, grouped by date, time-range filters, clear browsing data dialog |
| Settings | 7 sections: General, Appearance, Search, Privacy, Security, Shortcuts, AI, About |
| New tab page | Search box, top sites from history, recently closed tabs |
| Find, zoom, print | Ctrl+F, Ctrl+/-, Ctrl+0, F11, Ctrl+P |
| Private windows | Separate `session.partition` (ephemeral, storage cleared on close) |
| Global shortcuts | 30+ actions registered via application menu |
| Status bar | Loading state, zoom level, security indicators |
| Session persistence | SQLite history (1000 entries), survives restart |

### AI Layer (Working, With Documented Gaps)

| Feature | Status | Detail |
|---------|--------|--------|
| Provider adapters | 5 implemented | OpenAI, Anthropic, 9Router, LM Studio, Custom (OpenAI-compatible) |
| Credential storage | OS keychain (keytar) | Keys never touch renderer; rotated on 429/401/403 |
| Multi-key per provider | Implemented | Unlimited keys per provider; round-robin with backoff |
| Auto-fallback | Implemented | Key rotation → exponential backoff (1s–10s) → next provider; conversation context preserved |
| Model slot routing | 5 slots | fastBrowsing, research, reasoning, coding, verification; assigned per-model in UI |
| Streaming chat sidebar | Working | Stop button, citations for cross-tab context |
| Cross-tab intelligence | BM25 pipeline, 27 tests pass | Extracts pages → chunks → indexes → answers with citations |
| Agent runtime | 10 tools, E2E verified | navigate, click, type, extract, search, scroll, find, highlight, screenshot, wait. Tested against local Ollama qwen3.5:4b. Approval UI is a basic modal; no persistent agent state across sessions. |
| Page extraction | Injected script | Works on static pages; fails on heavy SPAs, Wikipedia, infinite scroll, closed Shadow DOM. Async IIFE rewrite applied; `executeJavaScript` still throws on complex pages. |
| Model discovery | Working | "Discover Models" calls `/v1/models`; "Add provider + key" auto-assigns first model to empty slots |

### Security Features

| Feature | Implementation | Status |
|---------|----------------|--------|
| Safe Browsing | Local list only | Placeholder — no Google SB v4 integration |
| HTTPS-Only | `webRequest.onBeforeRequest` upgrade | Working |
| Insecure warnings | HTTP warning banner (configurable for private IPs) | Working |
| DNS-over-HTTPS | Chromium switches (Google DoH) at startup | Working |
| Password breach check | HIBP k-anonymity (SHA-1 prefix) | Working |
| Ad/tracker blocker | declarativeNetRequest + EasyList | **Inactive on custom partitions** (Electron 45 limitation) |
| Security headers | CSP, X-Frame-Options via `onHeadersReceived` | Working |
| Certificate manager | Opens `chrome://settings/certificates` | Working |
| Renderer sandbox | `sandbox: true`, `contextIsolation: true` | Enforced |
| IPC validation | Sender checks on all sensitive handlers | Enforced |

### Performance

- Tab discarding at 1.5 GB budget (configurable), lazy restore on activation
- Memory stats in status bar (RSS/heap), updated every 10 seconds
- Bounded context cache, extraction timeouts, lazy module loading

### Packaging

- Windows NSIS installer: `Ariadne Browser Setup 0.3.0.exe`
- GitHub Actions release on tag push (`v*`), prerelease flag for `-test` tags

---

## Known Limitations

### Architecture — Single Webview
- One `webview` per window; tabs swapped via `src` attribute change
- No true tab isolation — renderer crash kills all tabs in the window
- Single DevTools instance for the webview
- Shared `webContents` across tabs

### Adblocker on Custom Partitions
- `declarativeNetRequest` does not attach to non-default partitions in Electron 45
- Rules load but cannot apply to normal or private windows
- Upstream Electron issue; no workaround in our codebase

### AI Agent — Prototype
- Tools execute individually; approval is a blocking modal (no domain allowlist, no bulk approval)
- No persistent agent state — restart resets everything
- Step limit (`maxSteps: 12`) prevents runaway loops but no cost tracking
- No vision support — tools operate on DOM/text only
- Cross-tab context not auto-injected into agent; manual extraction required first

### Page Extraction — Brittle
- Fails on: closed Shadow DOM, virtualized React/Vue lists, strict CSP, infinite scroll (viewport only)
- No PDF/DOC extraction — HTML only
- Async IIFE helps but `executeJavaScript` still throws on some heavy pages

### Provider Gaps
- Anthropic: non-streaming endpoint, faked chunks
- 9Router: requires API key; no keyless tier
- Custom: assumes OpenAI-compatible `/v1/chat/completions`; breaks on Ollama native `/api/chat`
- No automatic capability detection (context window, vision, tools)

### Settings & Platform
- `electron-store` in `%APPDATA%/ariadne-browser/`; no migration path for schema changes
- AI config separate (`ai-providers.json`)
- Developed and tested on Windows 11 only; macOS/Linux untested
- No `electron-updater` integration — manual reinstall for updates

---

## Verification

### Unit Tests
```
npm test
```
27 tests covering the cross-tab intelligence pipeline (chunking, ranking, dedupe, QA, embedding store, extraction, manager, provider adapter). Runs in Node via `--test` flag on compiled output.

### Stress Test
```
node stress-test.js
```
61 assertions across 12 categories: memory/tab management, AI provider fallback, agent runtime, cross-tab intelligence, security, private window isolation, settings persistence, page extraction, concurrent operations, edge case handling, performance safeguards, test coverage. Builds, launches, and verifies the running application.

### E2E Agent Test (Real Model)
```
ARIADNE_E2E_DIR=./docs/e2e-agent ARIADNE_USER_DATA=/tmp/ariadne-e2e npx electron .
```
Drives the real UI with a local Ollama model (`qwen3.5:4b` at `http://localhost:11434/v1`):

| Scenario | Result | Notes |
|----------|--------|-------|
| Provider setup (custom/Ollama) | Pass | Auto-assigns model to fastBrowsing/research slots |
| navigate-and-read (example.com) | Partial | Navigation works; extraction fails on tab registration |
| interact-with-form (local test page) | Partial | Navigation + extract called; extraction script throws |
| search-and-extract (Wikipedia) | Partial | Navigation + extract called; extraction fails on complex page |

Auto-approval via `ARIADNE_AUTO_APPROVE=1`. Screenshots saved to `docs/e2e-agent/`.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  MAIN PROCESS (TRUSTED)                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────────┐  │
│  │ Providers   │ │ Agent Tools │ │ Credentials (keytar)        │  │
│  │ - Multi-key │ │ - Navigate  │ │ - Never touches renderer    │  │
│  │ - Fallback  │ │ - Click     │ │ - OS keychain (Win/Mac/Linux)│  │
│  │ - Rotation  │ │ - Extract   │ │                             │  │
│  └─────────────┘ └─────────────┘ └─────────────────────────────┘  │
└────────────────────────────┬──────────────────────────────────────┘
                             │ Validated IPC (sender checks)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  RENDERER (SANDBOXED, CONTEXT-ISOLATED)                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────────┐  │
│  │ React UI    │ │ Webview     │ │ Zero AI logic               │  │
│  │ - Tabs      │ │ (Chromium)  │ │ Zero API keys               │  │
│  │ - Sidebar   │ │             │ │                             │  │
│  └─────────────┘ └─────────────┘ └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**Why this separation matters:**
- Renderer compromise cannot extract API keys (keys never leave main process)
- Cross-tab context stays local unless explicitly sent via "Ask AI"
- BM25 retrieval is deterministic, offline-capable, no cloud latency
- Sandbox and context isolation enforced — no `nodeIntegration`, no `require` in renderer

---

## Project Structure

```
src/
├── main/                      # Electron main process
│   ├── index.ts               # App entry, IPC handlers, window management
│   ├── tabs.ts                # Tab state + SQLite history
│   ├── profile.ts             # Isolated profile support (ARIADNE_USER_DATA)
│   ├── capture.ts             # Automated screenshot/demo capture
│   ├── security.ts            # Safe Browsing, HTTPS-Only, Adblock, Breach check
│   ├── e2e-agent.ts           # E2E harness (drives real UI with real model)
│   ├── ai/                    # AI system
│   │   ├── index.ts           # AISystem facade
│   │   ├── registry.ts        # ProviderRegistry: multi-key, fallback, retry
│   │   ├── credentials.ts     # keytar secure storage
│   │   ├── provider.ts        # ProviderAdapter + BaseProvider
│   │   ├── types.ts           # Shared AI types
│   │   ├── agent-tools.ts     # 10 browser automation tools + approval
│   │   ├── providers/         # 5 provider implementations
│   │   └── context/           # Cross-tab intelligence (BM25, extraction, QA)
├── preload.ts                 # contextBridge IPC surface
├── shared/                    # Shared utilities
└── renderer/                  # React UI
    ├── main.tsx               # App shell, state, webview
    ├── styles.css             # Dark theme, all components styled
    └── components/            # TabStrip, AddressBar, SettingsPage, ChatSidebar, etc.
```

---

## Quick Start

```bash
# Install dependencies
npm install

# Build main + renderer
npm run build:electron
npm run build:renderer

# Run unit tests (27 context pipeline tests)
npm test

# Launch browser
npm start
```

### AI Setup

1. Open Settings → AI (or press Ctrl+Shift+A)
2. Add a provider:
   - **LM Studio** (local, no key): start LM Studio server, add provider with base URL `http://localhost:1234/v1`
   - **OpenAI**: add provider, set API key(s) via secure prompt
   - **Anthropic**: add provider, set API key(s)
   - **9Router**: add provider, set API key(s)
   - **Custom**: any OpenAI-compatible endpoint (Ollama, vLLM, TGI, LocalAI, etc.)
3. Assign models to task slots (fastBrowsing, research, reasoning, coding, verification)
4. Use the AI sidebar to chat with current page or cross-tab context

### Local Ollama (Tested Configuration)

```bash
# Start Ollama
ollama serve

# Pull model
ollama pull qwen3.5:4b

# Run E2E harness
ARIADNE_E2E_DIR=./docs/e2e-agent ARIADNE_USER_DATA=/tmp/ariadne-e2e npx electron .
```

---

## AI Providers

| Provider | Type | Base URL | API Key | Notes |
|----------|------|----------|---------|-------|
| OpenAI | `openai` | `https://api.openai.com/v1` | Required | GPT-4o, GPT-4o-mini, etc. |
| Anthropic | `anthropic` | `https://api.anthropic.com/v1` | Required | Claude 3.5 Sonnet, Haiku, Opus |
| 9Router | `9router` | `https://api.9router.com/v1` | Required | Multi-model router |
| LM Studio | `lmstudio` | `http://localhost:1234/v1` | Optional | Local models via LM Studio server |
| Custom | `custom` | Any OpenAI-compatible | Optional | Ollama, vLLM, TGI, LocalAI |

**Multi-key behavior:** Each provider stores multiple keys in the OS keychain. On 429/401/403 the registry rotates to the next key with exponential backoff (1s, 2s, 4s, 8s, 10s cap). If all keys exhaust, it falls back to the next enabled provider while preserving the conversation context.

---

## Scripts

```json
{
  "build:electron": "tsc --project tsconfig.main.json && tsc --project tsconfig.preload.json && node scripts/copy-assets.js",
  "build:renderer": "vite build",
  "build": "npm run build:electron && npm run build:renderer",
  "start": "electron .",
  "test": "tsc --project tsconfig.tests.json && node --test dist-tests/tests/pipeline.test.js",
  "lint": "eslint src --ext .ts,.tsx"
}
```

---

## Target Environment

- Windows 11, 16 GB RAM
- Optimized for limited SSD (bounded caches, no idle polling)
- Minimal dependencies

---

## License

MIT

---

## Evaluation Guidance

**Consider using if:**
- You need a local-first browser with integrated AI sidebar and cross-tab context retrieval
- You accept single-webview architecture and Windows-only support
- You want API keys stored in OS keychain, never exposed to renderer

**Avoid if:**
- You require true tab isolation (per-tab processes)
- You need adblocking on private windows (Electron limitation)
- You need production-grade agent with persistent state, vision, or bulk approval
- You need macOS/Linux support

**Contributions welcome** on: per-tab WebContentsView, declarativeNetRequest on custom partitions, agent vision/state, extraction robustness for heavy pages.