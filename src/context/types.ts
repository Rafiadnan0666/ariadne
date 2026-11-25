/**
 * Shared types for Ariadne's cross-tab context pipeline.
 *
 * This module is intentionally free of Electron imports so it can be unit
 * tested with plain Node. The main process wires real tabs into it.
 */

export type SelectionMode = 'current' | 'selected' | 'all';

export interface TabInfo {
  id: string;
  url: string;
  title: string;
  active?: boolean;
  isPrivate?: boolean;
  /** Host/user exclusion applied before extraction. */
  excluded?: boolean;
}

export interface ContextSelection {
  mode: SelectionMode;
  /** Explicit tab ids used by mode === 'selected'. */
  tabIds: string[];
  /** Include the user's current text selection from the page (if any). */
  includeSelectedText?: boolean;
}

export interface ContextHeading {
  level: number;
  text: string;
}

export interface ContextLink {
  href: string;
  text: string;
  isInternal?: boolean;
}

export interface ContextAccessibility {
  language?: string;
  landmarkCount?: number;
  imagesTotal?: number;
  imagesWithAlt?: number;
  headingCount?: number;
  hasSelection?: boolean;
}

export interface ContextMetadata {
  description?: string;
  keywords?: string;
  author?: string;
  ogTitle?: string;
  ogDescription?: string;
  favicon?: string;
  language?: string;
  wordCount: number;
  charCount: number;
  accessibility?: ContextAccessibility;
}

/** A source alias so a fact can always be traced to the tab/URL it came from. */
export interface ContextSource {
  tabId: string;
  url: string;
  title: string;
  isPrivate?: boolean;
  /** When a near-duplicate page was folded into this item. */
  aliasOf?: string;
}

/** One extracted, normalized page (or a user-selected fragment). */
export interface ContextItem {
  id: string;
  tabId: string;
  url: string;
  title: string;
  text: string;
  selectedText?: string;
  headings: ContextHeading[];
  links: ContextLink[];
  metadata: ContextMetadata;
  sources: ContextSource[];
  /** Stable hash of the readable text; used to avoid re-extraction. */
  contentHash: string;
  extractedAt: number;
  lastAccessedAt: number;
  isPrivate: boolean;
  approxBytes: number;
  approxTokens: number;
  /** Extractive compression marker (older context). */
  compressed?: boolean;
}

export interface ContextChunk {
  id: string;
  itemId: string;
  tabId: string;
  url: string;
  title: string;
  text: string;
  chunkIndex: number;
  charCount: number;
  approxTokens: number;
  isPrivate: boolean;
  section?: string;
  selected?: boolean;
  compressed?: boolean;
}

export interface ScoredChunk {
  chunk: ContextChunk;
  score: number;
  matchedTerms: string[];
}

export interface RetrievalOptions {
  /** Restrict retrieval to these tabs. Empty/undefined = all indexed tabs. */
  tabIds?: string[];
  maxChunks?: number;
  /** Include at least the best chunk from every requested tab (cross-tab Q&A). */
  ensurePerTab?: boolean;
  /** Include private-browsing chunks (only within the live private session). */
  includePrivate?: boolean;
}

export interface RetrievalResult {
  query: string;
  hits: ScoredChunk[];
  totalChunks: number;
  matchedTabs: string[];
}

/** Narrow provider contract used by Q&A. Structurally compatible with the
 * provider adapter defined by the provider session (see docs/AI-CONTRACT.md). */
export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderChatRequest {
  model?: string;
  messages: ProviderMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ProviderUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ProviderChatResponse {
  text: string;
  usage?: ProviderUsage;
}

export interface ContextProvider {
  readonly id: string;
  readonly name: string;
  /** True only for local/no-network providers or clearly labeled test fakes. */
  readonly isLocal?: boolean;
  readonly isTestOnly?: boolean;
  chat(request: ProviderChatRequest): Promise<ProviderChatResponse>;
}

export interface PromptSource {
  id: string;
  tabId: string;
  url: string;
  title: string;
  chunkIndex: number;
  text: string;
  approxTokens: number;
}

export interface PromptPreview {
  question: string;
  sources: PromptSource[];
  systemPrompt: string;
  userPrompt: string;
  approxInputTokens: number;
  providerId: string;
  providerName: string;
  isTestOnlyProvider: boolean;
  /** Hash of the exact payload; the send step must present the same hash. */
  payloadHash: string;
  createdAt: number;
}

export interface Citation {
  sourceId: string;
  tabId: string;
  url: string;
  title: string;
  chunkIndex: number;
}

export interface QAAnswer {
  answer: string;
  citations: Citation[];
  supported: boolean;
  /** Set when the model produced no citation or admitted missing support. */
  warning?: string;
  preview: PromptPreview;
  usage?: ProviderUsage;
}

export interface ExtractionSummary {
  tabId: string;
  url: string;
  title: string;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  chars: number;
  approxTokens: number;
  isPrivate: boolean;
  dedupedInto?: string;
  durationMs: number;
}

export interface PickerTabState {
  tab: TabInfo;
  cached: boolean;
  /** Cached extraction exists for a different URL than the tab currently shows. */
  stale?: boolean;
  chars: number;
  approxTokens: number;
  isPrivate: boolean;
  excluded: boolean;
  lastExtractedAt?: number;
}

export interface ContextStats {
  items: number;
  chunks: number;
  chars: number;
  approxTokens: number;
  privateItems: number;
  maxItems: number;
  maxChunks: number;
  maxChars: number;
}

/** Compact item view sent to the picker (full text is fetched on demand). */
export interface ContextItemSummary {
  id: string;
  tabId: string;
  url: string;
  title: string;
  chars: number;
  approxTokens: number;
  selectedTextChars: number;
  headings: number;
  links: number;
  isPrivate: boolean;
  compressed: boolean;
  sources: ContextSource[];
  extractedAt: number;
  lastAccessedAt: number;
  snippet: string;
}

export interface ProviderStatus {
  id: string;
  name: string;
  isLocal: boolean;
  isTestOnly: boolean;
  available: boolean;
  model?: string;
}

export interface PickerState {
  tabs: PickerTabState[];
  items: ContextItemSummary[];
  stats: ContextStats;
  exclusions: string[];
  privateSession: boolean;
  provider: ProviderStatus;
}

export interface ExtractionBatchResult {
  summaries: ExtractionSummary[];
  stats: ContextStats;
  items: ContextItemSummary[];
}

export interface PreviewResult {
  preview: PromptPreview;
  totalChunks: number;
  matchedTabs: string[];
  hasSources: boolean;
}
