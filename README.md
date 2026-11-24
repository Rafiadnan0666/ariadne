# Ariadne Browser

An AI-native desktop browser built with Electron, React, and TypeScript. Browser first, AI second.

## Features

### Core Browser (Milestone 1 — Chrome Parity)
- **Multi-tab browsing** — create, close, switch, duplicate, pin, mute, reorder (drag-and-drop), reopen closed (Ctrl+Shift+T)
- **Navigation** — back, forward, reload, stop, home, view source (Ctrl+U)
- **Address bar** — URL entry + search detection, search-as-you-type suggestions from history/bookmarks/open tabs
- **Downloads panel** — progress, pause/resume/cancel, open file/folder, retry, clear, filtering
- **Bookmarks** — bar with nested folders, manager with add/edit/delete/move, HTML import/export
- **History** — searchable, date-grouped, time-range filters, clear browsing data dialog
- **Settings** — 7 sections: General, Appearance (theme/accent/density), Search engines, Privacy, Shortcuts, AI, About
- **New Tab Page** — search, top sites (from history), recently closed tabs
- **Find in page** — match count, next/prev navigation (Ctrl+F)
- **Per-tab zoom** — Ctrl+/-, Ctrl+0, zoom indicator in status bar
- **Fullscreen** (F11), **Print** (Ctrl+P)
- **Private window** — separate session partition
- **Global shortcuts** — 30+ registered (see Settings → Shortcuts)
- **Persistent sessions** — cookies/localStorage survive restart (`partition="persist:ariadne"`)
- **SQLite history** — 1000-entry local database

### AI System (Milestone 2-4)
- **Provider abstraction** — OpenAI-compatible, Anthropic, 9Router, LM Studio (local), Custom
- **Secure credentials** — OS keychain via `keytar`, never exposed to renderer
- **Model slot routing** — 5 task slots: fastBrowsing, research, reasoning, coding, verification
- **Streaming chat** — token-by-token in sidebar with stop button
- **Usage tracking** — tokens, cost estimation, persistence

### Cross-Tab Intelligence (Milestone 5)
- **Page extraction** — DOM-based readable content + headings/links/tables
- **Embedding store** — JSON + cosine similarity vector retrieval
- **Session context manager** — bounded caches (50 items, 1200 chunks, 300k chars), dedup, compression
- **BM25 retrieval** — ranked chunks with source URL/tab tracking
- **Q&A pipeline** — preview → confirm → cited answers with `[S1]` markers
- **Privacy** — private tabs excluded, exclusions UI-ready, aliases stripped

### Security
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox` renderer
- Minimal preload API surface via `contextBridge`
- `windowOpenHandler` restricts navigation to http/https/file/about
- CSP-ready, no `eval` in renderer

## Quick Start

```bash
# Install dependencies
npm install

# Build main + renderer
npm run build:electron
npm run build:renderer

# Run tests (27 context pipeline tests)
npm test

# Launch browser
npm start
```

### AI Setup (Optional)
The browser works without AI configured. To enable:

1. Open Settings → AI or click the 🤖 button in the address bar
2. Add a provider:
   - **LM Studio** (local, no API key): Start LM Studio server, add provider with base URL `http://localhost:1234/v1`
   - **OpenAI**: Add provider, set API key via secure prompt
   - **Anthropic**: Add provider, set API key
   - **9Router**: Add provider, set API key
   - **Custom**: Any OpenAI-compatible endpoint
3. Assign models to task slots (fastBrowsing, research, reasoning, coding, verification)
4. Use the AI sidebar (Ctrl+Shift+A) to chat with current page or cross-tab context

## Project Structure

```
src/
├── main/                    # Electron main process
│   ├── index.ts             # App entry, IPC handlers, window management
│   ├── tabs.ts              # Tab state + SQLite history
│   └── ai/                  # AI system
│       ├── index.ts         # AISystem facade
│       ├── registry.ts      # ProviderRegistry lifecycle, routing, fallback
│       ├── credentials.ts   # keytar secure storage
│       ├── provider.ts      # ProviderAdapter interface
│       ├── providers/       # 5 provider implementations
│       │   ├── openai.ts
│       │   ├── anthropic.ts
│       │   ├── ninerouter.ts
│       │   ├── lmstudio.ts
│       │   └── custom.ts
│       └── context/         # Cross-tab intelligence
│           ├── PageExtractor.ts
│           ├── extraction-script.js   # Injected into webContents
│           ├── EmbeddingStore.ts
│           ├── SessionContext.ts
│           ├── chunking.ts
│           ├── dedupe.ts
│           ├── extraction.ts
│           ├── manager.ts
│           ├── ranking.ts
│           ├── qa.ts
│           ├── types.ts
│           └── provider-adapter.ts
├── preload.ts               # contextBridge IPC surface
└── renderer/                # React UI
    ├── main.tsx             # App shell, state, webview
    ├── styles.css           # Dark theme, animations
    └── components/
        ├── TabStrip.tsx     # Tabs with DnD, pin/mute, search
        ├── AddressBar.tsx   # URL/search with suggestions
        ├── DownloadsPanel.tsx
        ├── BookmarksBar.tsx
        ├── HistoryPage.tsx
        ├── SettingsPage.tsx
        ├── NewTabPage.tsx
        └── ai/
            └── ChatSidebar.tsx
```

## Scripts

```json
{
  "build:electron": "tsc -p tsconfig.main.json && node scripts/copy-assets.js",
  "build:renderer": "vite build",
  "build": "npm run build:electron && npm run build:renderer",
  "start": "electron .",
  "test": "tsc -p tsconfig.tests.json && node --test dist-tests/tests/pipeline.test.js",
  "lint": "eslint src --ext .ts,.tsx"
}
```

## Architecture

- **Single webview per window**, tabs swapped via `setActiveTab` IPC
- **Partition `persist:ariadne`** for session persistence
- **Private windows** use unique partition `ariadne-private-${timestamp}`
- **AI runs in main process only** — renderer never sees API keys
- **Extraction script** injected via `executeJavaScript` into webContents

## Configuration

Settings stored via `electron-store`:
- `settings` — UI prefs, search engines, shortcuts
- `bookmarks` — nested folder structure
- `downloads` — download history

AI config in `ai-providers.json` (provider configs, model slots, usage).

## Development

```bash
# Watch mode for renderer
npm run dev:renderer   # vite dev server

# Watch mode for main (requires restart)
npm run dev:electron   # tsc -w

# Run with DevTools open (default)
npm start
```

## Target Environment

- Windows 11, 16 GB RAM, RX 6550M GPU
- Optimized for limited SSD (bounded caches, no idle polling)
- No unnecessary packages — minimal deps

## License

MIT