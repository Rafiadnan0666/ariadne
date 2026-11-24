import { chunkItem, type ChunkOptions } from './chunking';
import { findDuplicate } from './dedupe';
import {
  estimateBytes,
  estimateTokens,
  hashText,
  isExcludedHost,
  isExtractableUrl,
  normalizeUrl,
  normalizeWhitespace,
  redactSecrets,
} from './extraction';
import { rankChunks } from './ranking';
import type {
  ContextChunk,
  ContextHeading,
  ContextItem,
  ContextLink,
  ContextMetadata,
  ContextSource,
  ContextStats,
  RetrievalOptions,
  RetrievalResult,
} from './types';

export interface ContextManagerOptions {
  maxItems: number;
  maxChunks: number;
  maxTotalChars: number;
  maxChunksPerItem: number;
  chunkWords: number;
  chunkOverlapWords: number;
  maxChunkChars: number;
  nearDuplicateThreshold: number;
  cacheTtlMs: number;
  compressAfterMs: number;
  maxCompressedChars: number;
}

export const DEFAULT_MANAGER_OPTIONS: ContextManagerOptions = {
  maxItems: 50,
  maxChunks: 1200,
  maxTotalChars: 300_000,
  maxChunksPerItem: 120,
  chunkWords: 180,
  chunkOverlapWords: 40,
  maxChunkChars: 1400,
  nearDuplicateThreshold: 0.82,
  cacheTtlMs: 10 * 60 * 1000,
  compressAfterMs: 30 * 60 * 1000,
  maxCompressedChars: 320,
};

export interface PageInput {
  tabId: string;
  url: string;
  title: string;
  text: string;
  selectedText?: string;
  headings?: ContextHeading[];
  links?: ContextLink[];
  metadata?: Partial<ContextMetadata>;
  isPrivate?: boolean;
}

export interface UpsertResult {
  item: ContextItem;
  duplicateOf?: string;
  duplicateKind?: 'exact-url' | 'exact-content' | 'near-duplicate';
  /** True when the page was unchanged and no re-chunking happened. */
  skipped: boolean;
  reason?: string;
}

export interface ContextPersistence {
  saveItem(item: ContextItem, chunks: ContextChunk[]): void | Promise<void>;
  deleteItem(itemId: string): void | Promise<void>;
  clear(): void | Promise<void>;
}

/**
 * In-memory, bounded session context manager.
 *
 * Responsibilities:
 * - dedupe same/near-duplicate pages while keeping every source URL
 * - chunk + rank content locally (no provider required)
 * - never re-chunk an unchanged page
 * - evict by item/chunk/character budgets
 * - keep private-browsing items in memory only and wipe them on demand
 */
export class SessionContextManager {
  private readonly items = new Map<string, ContextItem>();
  private readonly chunks = new Map<string, ContextChunk>();
  private readonly itemChunks = new Map<string, string[]>();
  private readonly tabItems = new Map<string, Set<string>>();
  private exclusions: string[] = [];
  private readonly options: ContextManagerOptions;
  private readonly persistence?: ContextPersistence;
  private readonly chunkOptions: ChunkOptions;

  constructor(options: Partial<ContextManagerOptions> = {}, persistence?: ContextPersistence) {
    this.options = { ...DEFAULT_MANAGER_OPTIONS, ...options };
    this.persistence = persistence;
    this.chunkOptions = {
      maxWords: this.options.chunkWords,
      overlapWords: this.options.chunkOverlapWords,
      maxChunks: this.options.maxChunksPerItem,
      maxCharsPerChunk: this.options.maxChunkChars,
    };
  }

  setExclusions(hosts: readonly string[]): void {
    this.exclusions = hosts.map((h) => h.trim()).filter(Boolean);
  }

  /**
   * Apply new exclusions and remove any stored item or source alias that now
   * matches them. Existing content from a newly excluded site must not remain
   * available to Q&A.
   */
  applyExclusions(hosts: readonly string[]): number {
    this.setExclusions(hosts);
    let removed = 0;
    for (const item of Array.from(this.items.values())) {
      if (this.isExcluded(item.url)) {
        if (this.removeItem(item.id)) removed++;
        continue;
      }
      const before = item.sources.length;
      item.sources = item.sources.filter((source) => !this.isExcluded(source.url));
      if (item.sources.length !== before) this.persist(item);
    }
    return removed;
  }

  getExclusions(): string[] {
    return [...this.exclusions];
  }

  isExcluded(url: string): boolean {
    try {
      return isExcludedHost(new URL(url).hostname, this.exclusions);
    } catch {
      return false;
    }
  }

  /**
   * Add or refresh a page. If the page is unchanged (same content hash) it is
   * not re-chunked; if it duplicates another page the source is recorded as an
   * alias instead of duplicating content.
   */
  upsertPage(input: PageInput, options: { force?: boolean } = {}): UpsertResult | null {
    if (!isExtractableUrl(input.url)) return null;
    if (this.isExcluded(input.url)) return null;

    const normalizedText = normalizeWhitespace(redactSecrets(input.text || ''));
    const selectedText = input.selectedText
      ? normalizeWhitespace(redactSecrets(input.selectedText))
      : undefined;
    const contentHash = hashText(`${normalizedText}\n${selectedText || ''}`);

    const existingForTab = this.findByTabAndUrl(input.tabId, input.url);
    if (existingForTab) {
      existingForTab.lastAccessedAt = Date.now();
      if (existingForTab.contentHash === contentHash) {
        return {
          item: existingForTab,
          skipped: true,
          reason: 'unchanged',
        };
      }
      // Same tab + URL but changed content: replace the previous extraction.
      this.removeItem(existingForTab.id);
    }

    const candidate = {
      url: input.url,
      title: input.title || input.url,
      text: normalizedText,
      contentHash,
    };

    const duplicate = findDuplicate(
      Array.from(this.items.values()).filter((item) => item.tabId !== input.tabId || normalizeUrl(item.url) !== normalizeUrl(input.url)),
      candidate,
      this.options.nearDuplicateThreshold
    );

    if (duplicate) {
      const item = duplicate.item;
      item.lastAccessedAt = Date.now();
      const source: ContextSource = {
        tabId: input.tabId,
        url: input.url,
        title: input.title || input.url,
        isPrivate: input.isPrivate === true,
        aliasOf: item.id,
      };
      if (!item.sources.some((s) => s.tabId === source.tabId && normalizeUrl(s.url) === normalizeUrl(source.url))) {
        item.sources.push(source);
      }
      this.tabItems.get(input.tabId)?.add(item.id);
      if (!this.tabItems.has(input.tabId)) this.tabItems.set(input.tabId, new Set([item.id]));
      return {
        item,
        duplicateOf: item.id,
        duplicateKind: duplicate.kind,
        skipped: true,
        reason: duplicate.kind,
      };
    }

    const id = `${input.tabId}:${contentHash.slice(0, 12)}`;
    const now = Date.now();
    const textForSize = `${normalizedText}\n${selectedText || ''}`;
    const item: ContextItem = {
      id,
      tabId: input.tabId,
      url: input.url,
      title: input.title || input.url,
      text: normalizedText,
      selectedText,
      headings: input.headings || [],
      links: input.links || [],
      metadata: {
        ...(input.metadata || {}),
        wordCount: input.metadata?.wordCount ?? normalizedText.split(/\s+/).filter(Boolean).length,
        charCount: input.metadata?.charCount ?? normalizedText.length,
      },
      sources: [{
        tabId: input.tabId,
        url: input.url,
        title: input.title || input.url,
        isPrivate: input.isPrivate === true,
      }],
      contentHash,
      extractedAt: now,
      lastAccessedAt: now,
      isPrivate: input.isPrivate === true,
      approxBytes: estimateBytes(textForSize),
      approxTokens: estimateTokens(textForSize),
    };

    this.items.set(id, item);
    this.indexItem(item);
    this.enforceBounds();
    this.persist(item);

    return { item, skipped: false };
  }

  /** True when a page should be extracted (missing or older than TTL). */
  shouldExtract(tabId: string, url: string, contentHash?: string): boolean {
    const item = this.findByTabAndUrl(tabId, url);
    if (!item) return true;
    if (contentHash && item.contentHash === contentHash) return false;
    return Date.now() - item.extractedAt >= this.options.cacheTtlMs;
  }

  hasFreshPage(tabId: string, url: string, maxAgeMs = this.options.cacheTtlMs): boolean {
    const item = this.findByTabAndUrl(tabId, url);
    if (!item) return false;
    return Date.now() - item.extractedAt < maxAgeMs;
  }

  getCachedForTab(tabId: string): ContextItem[] {
    const ids = this.tabItems.get(tabId);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.items.get(id))
      .filter((item): item is ContextItem => Boolean(item));
  }

  getItem(itemId: string): ContextItem | undefined {
    return this.items.get(itemId);
  }

  listItems(): ContextItem[] {
    return Array.from(this.items.values()).sort((a, b) => b.extractedAt - a.extractedAt);
  }

  listChunks(): ContextChunk[] {
    return Array.from(this.chunks.values());
  }

  retrieve(query: string, options: RetrievalOptions = {}): RetrievalResult {
    for (const item of this.items.values()) {
      if (options.tabIds && !options.tabIds.includes(item.tabId)) continue;
      item.lastAccessedAt = Date.now();
    }
    return rankChunks(query, Array.from(this.chunks.values()), options);
  }

  removeItem(itemId: string, persist = true): boolean {
    const item = this.items.get(itemId);
    if (!item) return false;
    for (const chunkId of this.itemChunks.get(itemId) || []) {
      this.chunks.delete(chunkId);
    }
    this.itemChunks.delete(itemId);
    this.items.delete(itemId);
    this.tabItems.get(item.tabId)?.delete(itemId);
    if (persist && !item.isPrivate) {
      void this.persistence?.deleteItem(itemId);
    }
    return true;
  }

  removeTab(tabId: string): number {
    let removed = 0;
    for (const item of Array.from(this.items.values())) {
      if (item.tabId === tabId) {
        if (this.removeItem(item.id)) removed++;
        continue;
      }
      // The tab may only be an alias of a page extracted from another tab.
      const before = item.sources.length;
      item.sources = item.sources.filter((source) => source.tabId !== tabId);
      if (item.sources.length !== before) this.persist(item);
    }
    this.tabItems.delete(tabId);
    return removed;
  }

  /**
   * Private context never touches persistence and is wiped at session end.
   * Private aliases folded into a public item are stripped as well, otherwise
   * their URLs would leak through that item's persisted source list.
   */
  clearPrivate(): number {
    let removed = 0;
    for (const item of Array.from(this.items.values())) {
      if (item.isPrivate) {
        if (this.removeItem(item.id, false)) removed++;
        continue;
      }
      const before = item.sources.length;
      item.sources = item.sources.filter((source) => !source.isPrivate);
      if (item.sources.length !== before) this.persist(item);
    }
    return removed;
  }

  async clearAll(): Promise<void> {
    this.items.clear();
    this.chunks.clear();
    this.itemChunks.clear();
    this.tabItems.clear();
    await this.persistence?.clear();
  }

  /**
   * Extractive compression for older context. Deterministic, provider-free:
   * keeps the lead sentences + headings rather than calling a model.
   */
  compressOlderContext(olderThanMs = this.options.compressAfterMs, now = Date.now()): number {
    let compressed = 0;
    for (const item of this.items.values()) {
      if (item.compressed) continue;
      if (now - item.extractedAt < olderThanMs) continue;
      const summary = this.extractiveSummary(item, this.options.maxCompressedChars);
      if (summary.length >= item.text.length) continue;
      item.text = summary;
      item.compressed = true;
      this.reindexItem(item);
      this.persist(item);
      compressed++;
    }
    return compressed;
  }

  stats(): ContextStats {
    let chars = 0;
    let tokens = 0;
    let privateItems = 0;
    for (const item of this.items.values()) {
      chars += item.text.length + (item.selectedText?.length || 0);
      tokens += item.approxTokens;
      if (item.isPrivate) privateItems++;
    }
    return {
      items: this.items.size,
      chunks: this.chunks.size,
      chars,
      approxTokens: tokens,
      privateItems,
      maxItems: this.options.maxItems,
      maxChunks: this.options.maxChunks,
      maxChars: this.options.maxTotalChars,
    };
  }

  private findByTabAndUrl(tabId: string, url: string): ContextItem | undefined {
    const ids = this.tabItems.get(tabId);
    if (!ids) return undefined;
    const target = normalizeUrl(url);
    for (const id of ids) {
      const item = this.items.get(id);
      if (item && normalizeUrl(item.url) === target) return item;
    }
    return undefined;
  }

  private indexItem(item: ContextItem): void {
    const chunks = chunkItem(item, this.chunkOptions);
    const ids: string[] = [];
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, chunk);
      ids.push(chunk.id);
    }
    this.itemChunks.set(item.id, ids);
    if (!this.tabItems.has(item.tabId)) this.tabItems.set(item.tabId, new Set());
    this.tabItems.get(item.tabId)!.add(item.id);
  }

  private reindexItem(item: ContextItem): void {
    for (const chunkId of this.itemChunks.get(item.id) || []) {
      this.chunks.delete(chunkId);
    }
    this.itemChunks.delete(item.id);
    this.indexItem(item);
    this.enforceBounds();
  }

  private extractiveSummary(item: ContextItem, maxChars: number): string {
    const parts: string[] = [];
    if (item.headings.length) {
      parts.push(item.headings.slice(0, 6).map((h) => h.text).join(' · '));
    }
    const sentences = item.text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 20);
    let used = parts.join(' ').length;
    for (const sentence of sentences) {
      if (used + sentence.length > maxChars) break;
      parts.push(sentence);
      used += sentence.length + 1;
    }
    if (parts.length === 0) return item.text.slice(0, maxChars);
    return `${parts.join(' ')} …`.slice(0, maxChars);
  }

  private enforceBounds(): void {
    // Evict least-recently-accessed items beyond the item budget.
    if (this.items.size > this.options.maxItems) {
      const ordered = Array.from(this.items.values()).sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
      for (const item of ordered) {
        if (this.items.size <= this.options.maxItems) break;
        this.removeItem(item.id);
      }
    }

    // Evict oldest chunks beyond the chunk budget.
    if (this.chunks.size > this.options.maxChunks) {
      const ordered = Array.from(this.items.values()).sort((a, b) => a.extractedAt - b.extractedAt);
      for (const item of ordered) {
        if (this.chunks.size <= this.options.maxChunks) break;
        this.removeItem(item.id);
      }
    }

    // Evict by total character budget.
    let totalChars = this.totalChars();
    if (totalChars > this.options.maxTotalChars) {
      const ordered = Array.from(this.items.values()).sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
      for (const item of ordered) {
        if (totalChars <= this.options.maxTotalChars) break;
        totalChars -= item.text.length + (item.selectedText?.length || 0);
        this.removeItem(item.id);
      }
    }
  }

  private totalChars(): number {
    let total = 0;
    for (const item of this.items.values()) {
      total += item.text.length + (item.selectedText?.length || 0);
    }
    return total;
  }

  private persist(item: ContextItem): void {
    if (!this.persistence || item.isPrivate) return;
    // Never write a private source URL to disk, even when it was folded into a
    // public item as a near-duplicate alias.
    const sources = item.sources.filter((source) => !source.isPrivate);
    if (sources.length === 0) return;
    const chunks = (this.itemChunks.get(item.id) || [])
      .map((id) => this.chunks.get(id))
      .filter((chunk): chunk is ContextChunk => Boolean(chunk))
      .map((chunk) => ({ ...chunk, isPrivate: false }));
    try {
      void this.persistence.saveItem({ ...item, sources, isPrivate: false }, chunks);
    } catch (error) {
      console.error('[Context] Failed to persist item:', error);
    }
  }
}
