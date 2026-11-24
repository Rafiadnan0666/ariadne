# Phase 2 Plan: AI-Native Browser Core

## Objective
Transform Ariadne from a conventional browser into an AI-native browser with multi-provider LLM integration, cross-tab context understanding, and agentic capabilities — all while keeping API keys and agent logic in the main process (never exposed to renderer/webviews).

---

## Architecture Principles

| Principle | Implementation |
|-----------|----------------|
| **Keys never leave main** | Provider clients instantiated in main; renderer only sees `agent:chat` IPC |
| **Cross-tab context** | Shared `SessionContext` in main aggregates page content from all tabs |
| **Provider abstraction** | Single `AIProvider` interface; swap OpenAI/Anthropic/9Router/LM Studio via config |
| **Agent runtime** | Planning → Execution → Verification loop in main; tools = browser actions (navigate, extract, click, type) |
| **Privacy first** | Local LM Studio preferred; cloud providers opt-in; no telemetry |

---

## Module Structure (New)

```
src/
├── main/
│   ├── ai/
│   │   ├── index.ts           # AI system entry, provider registry
│   │   ├── providers/
│   │   │   ├── base.ts        # AIProvider interface
│   │   │   ├── openai.ts      # OpenAI / 9Router compatible
│   │   │   ├── anthropic.ts   # Anthropic Claude
│   │   │   └── lmstudio.ts    # Local LM Studio (OpenAI-compatible)
│   │   ├── context/
│   │   │   ├── SessionContext.ts   # Cross-tab page content + history
│   │   │   ├── PageExtractor.ts    # webContents.executeJavaScript → clean text/DOM
│   │   │   └── ContextPipeline.ts  # Chunking, embedding, retrieval
│   │   ├── agents/
│   │   │   ├── AgentRuntime.ts     # Plan → Execute → Verify loop
│   │   │   ├── tools/
│   │   │   │   ├── browser.ts      # navigate, back, forward, reload
│   │   │   │   ├── extract.ts      # getPageText, getDOM, findElements
│   │   │   │   ├── interact.ts     # click, type, select, scroll
│   │   │   │   └── tabs.ts         # createTab, closeTab, switchTab
│   │   │   └── planner.ts          # LLM-based task decomposition
│   │   └── ipc.ts                # IPC handlers: agent:chat, agent:stream, context:get
│   └── index.ts                  # (register AI IPC)
├── preload.ts                    # (expose agent API)
└── renderer/
    ├── components/
    │   ├── AgentSidebar.tsx      # Chat UI, streaming responses
    │   ├── ContextIndicator.tsx  # Shows active tabs in context
    │   └── AgentToolsPanel.tsx   # Debug: show tool calls
    └── hooks/
        └── useAgent.ts           # React hook for agent communication
```

---

## Implementation Checklist

### 2.1 Provider Abstraction Layer
- [ ] `AIProvider` interface: `chat(messages, tools?, stream?)`, `embed(texts)`
- [ ] `OpenAIProvider` — supports 9Router via baseURL override
- [ ] `AnthropicProvider` — native Claude API
- [ ] `LMStudioProvider` — local, OpenAI-compatible, no API key
- [ ] Config schema: `ai.providers[]`, `ai.defaultProvider`, `ai.embeddingProvider`
- [ ] Secure key storage: `electron-store` encrypted or OS keychain

### 2.2 Page Extraction & Context Pipeline
- [ ] `PageExtractor.extract(webContents)` → `{ text, markdown, dom, metadata }`
- [ ] Readability-style cleanup (remove nav, footer, ads)
- [ ] Chunking: 512 tokens with 50 overlap
- [ ] Embeddings: local (LM Studio) or remote; store in SQLite `embeddings` table
- [ ] Retrieval: vector similarity (cosine) + BM25 hybrid
- [ ] `SessionContext.getContext(query, tabs?)` → relevant chunks + citations

### 2.3 Agent Runtime
- [ ] Tool definitions (JSON Schema) for all browser actions
- [ ] `AgentRuntime.run(task, context)` → async iterator of steps
- [ ] Planner: decompose high-level goal → tool call sequence
- [ ] Executor: call tools via existing IPC (tab:navigate, extract, interact)
- [ ] Verifier: check result matches intent; retry/rollback on failure
- [ ] Streaming: emit `agent:step` events for UI

### 2.4 IPC & Preload
- [ ] `agent:chat(messages, options?)` → stream or single response
- [ ] `agent:stream` — Server-Sent Events style for real-time UI
- [ ] `context:get(query, tabIds?)` → retrieved chunks
- [ ] `context:refresh(tabId)` — re-extract current page
- [ ] Preload exposes typed `window.agentAPI`

### 2.5 Renderer UI
- [ ] Agent sidebar (toggle: Ctrl+Shift+A)
- [ ] Streaming message bubbles
- [ ] Context indicator: "3 tabs in context: Google, GitHub, MDN"
- [ ] Tool call visualization (expandable)
- [ ] Settings: provider selection, API keys, local model config

---

## Data Models

```typescript
// providers/base.ts
interface AIProvider {
  id: string;
  name: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
  chatStream(req: ChatRequest): AsyncIterable<ChatChunk>;
  embed(texts: string[]): Promise<number[][]>;
}

interface ChatRequest {
  messages: Message[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { function: string };
  temperature?: number;
  maxTokens?: number;
}

// agents/tools/browser.ts
type BrowserTool =
  | { name: 'navigate'; args: { url: string; tabId?: string } }
  | { name: 'goBack'; args: { tabId: string } }
  | { name: 'goForward'; args: { tabId: string } }
  | { name: 'reload'; args: { tabId: string } }
  | { name: 'createTab'; args: { url?: string } }
  | { name: 'closeTab'; args: { tabId: string } }
  | { name: 'switchTab'; args: { tabId: string } };

// agents/tools/extract.ts
type ExtractTool =
  | { name: 'getPageText'; args: { tabId: string; maxChars?: number } }
  | { name: 'getPageMarkdown'; args: { tabId: string } }
  | { name: 'getDOM'; args: { tabId: string; selector?: string } }
  | { name: 'findElements'; args: { tabId: string; selector: string } }
  | { name: 'getLinks'; args: { tabId: string } };

// agents/tools/interact.ts
type InteractTool =
  | { name: 'click'; args: { tabId: string; selector: string } }
  | { name: 'type'; args: { tabId: string; selector: string; text: string } }
  | { name: 'select'; args: { tabId: string; selector: string; value: string } }
  | { name: 'scroll'; args: { tabId: string; direction: 'up'|'down'; amount?: number } }
  | { name: 'waitFor'; args: { tabId: string; selector: string; timeout?: number } };
```

---

## Security Boundaries

| Boundary | Enforcement |
|----------|-------------|
| Renderer → Provider | ❌ Blocked — only `agent:chat` IPC |
| Renderer → Keys | ❌ Never exposed |
| Webview → Main | ✅ Only via `executeJavaScript` (main-controlled) |
| Agent → File System | ❌ No direct access; downloads via browser IPC |
| Agent → Network | ✅ Only via provider HTTP clients (main) |

---

## Dependencies to Add

```json
{
  "dependencies": {
    "sqlite3": "^5.1.6",
    "electron-store": "^10.0.0",
    "openai": "^4.50.0",
    "@anthropic-ai/sdk": "^0.24.0",
    "tiktoken": "^1.0.14",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "@types/uuid": "^9.0.8"
  }
}
```

---

## Milestones

| Milestone | Target | Verification |
|-----------|--------|--------------|
| M1: Provider abstraction + LM Studio working | Week 1 | `agent:chat` returns local model response |
| M2: Page extraction + context retrieval | Week 1 | `context:get("login form")` returns relevant chunks from open tabs |
| M3: Agent runtime with 5 browser tools | Week 2 | Agent can "go to GitHub, find TypeScript repos, extract top 5" |
| M4: Streaming UI + sidebar | Week 2 | Real-time chat in sidebar, tool calls visible |
| M5: Planner + verifier loop | Week 3 | Multi-step task: "book a flight" → navigate → fill form → verify confirmation |
| M6: Settings + provider switching | Week 3 | Switch between OpenAI/Anthropic/LM Studio in UI |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| LM Studio not running | Graceful fallback to cloud; clear error UI |
| Embedding model mismatch | Pin `text-embedding-3-small` or `nomic-embed-text`; store model dim in DB |
| Token limits on large pages | Chunk + summarize before context injection |
| Agent loops infinitely | Max 10 steps per run; verifier must approve completion |
| Webview script injection blocked | Use `executeJavaScript` with `world: 'isolated'`; CSP may block — test per site |

---

## Start Command

```powershell
# Add deps
npm install openai @anthropic-ai/sdk tiktoken uuid electron-store
npm install -D @types/uuid

# Build & run
npm run build:electron && npm run build:renderer && npm start
```