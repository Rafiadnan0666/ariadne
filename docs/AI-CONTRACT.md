# Ariadne AI Provider Contract (Session C Integration)

This document defines the stable API contract that Session C (Cross-Tab Intelligence) can build against. All interfaces are finalized and will not change without explicit coordination.

---

## 1. Provider Registry Streaming API

```typescript
// In ProviderRegistry (src/main/ai/registry.ts)

async stream(options: {
  task: ModelSlot;                    // 'fastBrowsing' | 'research' | 'reasoning' | 'coding' | 'verification'
  messages: ChatMessage[];
  signal?: AbortSignal;               // for cancellation
  sourceTabId?: string;               // tab providing page context
  sourceUrl?: string;
}): AsyncIterable<ChatCompletionChunk>
```

**Behavior:**
- Resolves model from `modelSlots[task]`
- Injects page context if `sourceTabId` provided and user enabled it
- Streams chunks via `AsyncIterable` (never buffers full response)
- Emits `usage` in final chunk when provider reports it
- Honors `signal` for immediate cancellation
- Falls back **only** to providers with `allowedFallback: true`

---

## 2. Task Model Slots

```typescript
type ModelSlot =
  | 'fastBrowsing'      // Quick answers, navigation help (small context, fast model)
  | 'research'          // Deep research, summarization (large context, reasoning model)
  | 'reasoning'         // Complex reasoning, multi-step (o1-class model)
  | 'coding'            // Technical/coding tasks (code-aware model)
  | 'verification';     // Independent fact-checking (different provider if possible)
```

**Configuration:**
```typescript
// Get/set via IPC
ai:model-slot:get-all() → Record<ModelSlot, string>  // slot → modelId
ai:model-slot:set(slot, modelId) → void
```

**Default Models (configurable per user):**
| Slot | Recommended Capabilities |
|------|-------------------------|
| fastBrowsing | streaming, <4k context, low latency |
| research | streaming, >32k context, tools |
| reasoning | streaming, >32k context, high reasoning |
| coding | streaming, tools, code training |
| verification | streaming, different provider if available |

---

## 3. Model Capability Metadata

```typescript
interface ModelCapability {
  contextWindow: number;       // Max tokens (input + output)
  supportsVision: boolean;     // Accepts image inputs
  supportsTools: boolean;      // Function calling / tool use
  supportsStreaming: boolean;  // Server-sent events / chunked response
  maxOutputTokens?: number;    // Provider-reported limit
  inputCostPer1k?: number;     // USD per 1k input tokens (for cost display)
  outputCostPer1k?: number;    // USD per 1k output tokens
}
```

**Available via:**
```typescript
ai:models → ModelMetadata[]  // includes capabilities
ai:model-for-slot(slot) → ModelMetadata | null
```

---

## 4. Error Types & Fallback Rules

### Error Classes
```typescript
class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerId: string,
    public readonly code: 'auth' | 'rate_limit' | 'model_not_found' | 'invalid_request' | 'server_error' | 'timeout' | 'unknown'
  ) {}
}

class TimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {}
}

class AbortError extends Error {
  constructor() { super('Aborted'); }
}
```

### Fallback Rules (STRICT)
1. **Never silently fall back to a paid provider** — user must explicitly enable `allowedFallback: true` on the fallback provider config
2. **Fallback order:** User-defined priority in provider list → first healthy provider with `allowedFallback: true`
3. **Fallback preserves task slot:** Uses fallback provider's default model for that slot
4. **No fallback for:** `verification` slot (must use explicitly configured provider)
5. **Streaming fallback:** Re-streams from fallback provider (new stream)

---

## 5. Page Extraction Contract

### ExtractedPage Interface
```typescript
interface ExtractedPage {
  url: string;
  title: string;
  readableText: string;           // Clean text content (bounded)
  selectedText?: string;          // User selection if any
  headings: Array<{ level: number; text: string }>;  // h1-h6
  metadata: Record<string, string>; // meta tags, og:*, twitter:*
  timestamp: number;
  tabId: string;
  isPrivate: boolean;             // Private browsing tabs
}
```

### IPC for Extraction
```typescript
// Main → Renderer
ai:extract-page(tabId: string) → ExtractedPage | null

// Returns null if:
// - Tab not found
// - Tab is private browsing
// - Extraction script failed
// - Page has no readable content (< 100 chars)
```

### Extraction Script (`extraction-script.js`)
- Runs in **page context** via `webContents.executeJavaScript(script, true)`
- Excludes: passwords, cookies, auth tokens, sensitive form fields (credit card, SSN, etc.)
- Bounded: Returns max 50k chars of readable text
- No duplicate extraction: Deduplicates by URL+timestamp

---

## 6. Context Retrieval (Phase 3)

```typescript
// SessionContext.retrieve() — to be implemented by Session C
interface RetrievalResult {
  chunks: ContextChunk[];
  query: string;
  totalChunks: number;
}

interface ContextChunk {
  id: number;
  tabId: string;
  url: string;
  title: string;
  content: string;           // Text chunk
  chunkIndex: number;
  embedding: number[];       // Vector embedding
  tokenCount: number;
  timestamp: number;
}

// Required IPC for Phase 3:
ai:context:retrieve(query: string, tabIds?: string[], maxChunks?: number) → RetrievalResult
ai:context:get-for-query(query: string, tabIds?: string[]) → string  // formatted for LLM
ai:context:ingest(tabId: string) → void                        // store page for retrieval
ai:extract-page(tabId: string) → ExtractedPage | null           // page extraction
ai:get-tabs-context(tabIds: string[]) → string                  // multi-tab summary
```

---

## 7. Usage & Token Tracking

```typescript
interface ProviderUsage {
  providerId: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost?: number;
  timestamp: number;
}

// IPC
ai:usage(providerId?: string, since?: number) → ProviderUsage[]
ai:usage-total(since?: number) → { promptTokens, completionTokens, totalTokens, cost }
```

---

## 8. Secure Credential Handling

### Key Principles
- **Keys never leave main process** — Renderer only sees masked keys (`sk-...xxxx`)
- **OS keychain only** — `keytar` on Windows/macOS/Linux
- **No logging** — Keys never written to console, logs, or files
- **Per-provider, per-key** — Multiple keys per provider supported

### IPC
```typescript
ai:set-api-key(providerId, keyName, apiKey) → void      // stores in keytar
ai:get-masked-key(providerId, keyName) → string | null  // returns "sk-...abcd"
ai:test-provider(id, apiKey?) → { success, error? }     // tests without persisting
```

---

## 9. Streaming Protocol

### Request
```typescript
ai:chat-stream(request: ChatCompletionRequest) → Promise<ChatCompletionResponse>
// Emits 'ai:stream-chunk' events on mainWindow.webContents
```

### Chunk Event
```typescript
// Event: 'ai:stream-chunk'
{
  id: string;
  model: string;
  choices: [{
    index: number;
    delta: { role?: string; content?: string; toolCalls?: ToolCall[] };
    finishReason: string | null;
  }];
  usage?: TokenUsage;  // only in final chunk
}
```

### Client Subscription
```typescript
const unsubscribe = window.electronAPI.ai.onStreamChunk((chunk) => {
  // Handle chunk
});
unsubscribe(); // cleanup
```

---

## 10. Version & Compatibility

| Contract Version | Date | Compatible Sessions |
|------------------|------|---------------------|
| 1.1.0 | 2026-11-24 | Phase 2 complete, Phase 3 complete |

**Breaking changes require:**
1. Update this document
2. Coordinate with Session C
3. Bump contract version

---

## 11. Testing Requirements for Session C

When implementing cross-tab context, ensure:
1. `ai:extract-page` works for normal and private tabs
2. `ai:get-tabs-context` returns formatted string for all tabs
3. Embedding provider configurable via `ai:config`
4. Vector storage uses separate SQLite DB (`ariadne_ai.db`)
5. Private browsing tabs never stored in embeddings DB
6. Context size bounded (max 10 chunks, max 8000 tokens per query)
7. All factual claims from page content include source URL citation