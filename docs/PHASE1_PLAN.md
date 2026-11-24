# Phase 1: Browser Foundation Implementation Plan

**Goal:** Build a working tabbed browser with SQLite storage that can navigate real websites.

## Architecture (Electron)

```
ariadne/
├── src/
│   ├── main.ts          # Electron main process (tab management, storage)
│   ├── preload.ts       # Security boundary
│   └── renderer/        # Browser UI (SPA)
│       ├── App.tsx      # Shell: tabs, address bar, navigation
│       ├── components/
│       │   ├── TabRow.tsx
│       │   ├── TabContent.tsx
│       │   ├── AddressBar.tsx
│       │   └── ...
│       └── utils/
│           ├── WebViewManager.ts
│           └── localStorage.ts
├── tauri.conf.json      # Electron-specific config
├── package.json
└── data/
    └── *.db             # SQLite databases
```

## Tasks

### 1. Setup & Boilerplate
- ✅ Environment check (Node, Rust - for later Electron integration, etc.)
- ✅ Install Electron (`npm install --save-dev electron`)
- ✅ Create project structure
- ✅ Create `main.ts` with basic window

### 2. Main Process - Tab Management
- Tab registry (stores: id, url, title, history, cookies, lastAccessed)
- Message handlers for tab CRUD operations
- WebView creation context per tab
- Event emission for tab state changes

### 3. Tab Infrastructure
- BrowserView API for multiple webviews
- Tab switching logic
- Tab ordering
- Close tab handling
- New tab creation

### 4. Navigation
- Address bar URL handling (http/https detection + search)
- Back/forward history per tab
- Navigation to external URLs
- Reload action
- Stop action

### 5. Storage Engine (SQLite)
- `schema.sql` - table definitions
- `history.ts` - navigation history
- `bookmarks.ts` - bookmark CRUD
- `downloads.ts` - download tracking
- `session.ts` - cookie persistence

### 6. Browser UI (React + TypeScript)
- Tab strip (drag to reorder if cheap, else static)
- Address bar (URL entry, search detection)
- Navigation controls (back, forward, reload, stop, home)
- Tab thumbnails (optional)

### 7. Security Boundaries
- Secure preload script
- Context isolation
- Built-in menu (view download history, bookmarks)
- HTTPS enforcement
    
### 8. Testing Checklist

#### Navigation Tests
- [ ] Open `https://example.com`
- [ ] Type search query in address bar + Enter → search engine
- [ ] Navigate to external URL
- [ ] Click back button → previous page
- [ ] Click forward button → next page
- [ ] Reload page
- [ ] Navigate to site blocking iframe embedding (X-Frame-Options)
- [ ] Form submission

#### Tab Tests  
- [ ] Open 3+ tabs with different URLs
- [ ] Switch between tabs
- [ ] Close single tab
- [ ] Close current tab → open new tab
- [ ] New tab shows home page
- [ ] Search query from new tab

#### Session Tests
- [ ] Login to a website
- [ ] Close app
- [ ] Reopen → login persists
- [ ] Private browser mode → no session persistence

#### Feature Tests
- [ ] Download file → save to Downloads folder
- [ ] Bookmark page → appears in bookmarks menu
- [ ] View history → see navigation trail

#### Performance Tests
- [ ] Measure idle memory with 1 tab open
- [ ] Measure idle memory with 5 tabs open
- [ ] Measure idle memory with 10 tabs open
- [ ] Measure startup time (cold start)

## Tech Stack

**Frontend:** React + TypeScript (strict mode)
**Styling:** Tailwind CSS
**Build:** Vite
**Backend:** Electron (Node.js Main Process)
**Storage:** SQLite (better cross-platform persistence than localStorage)
**Browser Engine:** Chromium (Electron embeds)

## File Structure Detail

### `package.json`
```json
{
  "name": "ariadne-browser",
  "version": "1.0.0",
  "main": "dist/main.js",
  "scripts": {
    "dev": "vite build --watch & electron .",
    "build": "tsc && vite build",
    "start": "electron ."
  },
  "dependencies": {
    "sqlite3": "^5.1.6"
  },
  "devDependencies": {
    "electron": "^32.0.0",
    "@types/node": "^22.10.1",
    "@types/react": "^19.0.1",
    "@types/react-dom": "^19.0.2",
    "@typescript-eslint/eslint-plugin": "^8.18.2",
    "@typescript-eslint/parser": "^8.18.2",
    "@vitejs/plugin-react": "^4.3.4",
    "electron-builder": "^25.1.8",
    "eslint": "^9.17.0",
    "globals": "^15.13.0",
    "prettier": "^3.4.2",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.2",
    "vite": "^6.0.3"
  }
}
```

### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### `tauri.conf.json`
Electron config:
```json
{
  "name": "Ariadne",
  "productName": "Ariadne Browser",
  "version": "1.0.0",
  "main": "dist/main.js",
  "files": ["dist/**/*", "data/**/*"],
  "directories": {
    "output": "dist-electron"
  },
  "win": {
    "target": ["nsis"],
    "icon": "build/icon.ico"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true
  }
}
```
```

## Success Criteria

- [ ] Launch opens browser window
- [ ] Can open https://example.com
- [ ] Can search in address bar
- [ ] Can use back/forward/reload
- [ ] Can manage multiple tabs
- [ ] Cookies persist across restarts
- [ ] History persists in SQLite
- [ ] Can download files
- [ ] Can bookmark pages
- [ ] Idle memory <= 300 MB (with 10 tabs)

## Not Implemented (for Phase 1)

- ❌ AI provider configuration
- ❌ Cross-tab intelligence
- ❌ Agentic browser actions
- ❌ Multi-provider model support
- ❌ Session/context manager for AI
- ❌ Pop-up windows support
- ❌ Camera/mic/location permissions
- ❌ Advanced page text extraction
- ❌ Stop/Cancel for agent tasks