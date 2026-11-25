import Store from 'electron-store';
import { aiSystem } from '../ai';
import { getTabById, getTabs, type TabState } from '../tabs';
import { pageExtractor } from '../ai/context/PageExtractor';
import { SessionContextManager } from '../../context/manager';
import { adaptRegistryStream, UnavailableProvider, type ContractRegistry } from '../../context/provider-adapter';
import { buildPromptPreview, askWithPreview } from '../../context/qa';
import { TEST_ONLY_PROVIDER_ID, TEST_ONLY_PROVIDER_NAME, TestOnlyProvider } from '../../context/test-only-provider';
import { isExtractableUrl, normalizeUrl, resolveSelectionTabs } from '../../context/extraction';
import type {
  ContextItem,
  ContextItemSummary,
  ContextMetadata,
  ContextProvider,
  ContextSelection,
  ExtractionBatchResult,
  ExtractionSummary,
  PickerState,
  PreviewResult,
  ProviderStatus,
  QAAnswer,
  TabInfo,
} from '../../context/types';

interface ContextStoreShape {
  exclusions: string[];
}

interface PreviewEntry {
  preview: ReturnType<typeof buildPromptPreview>;
  provider: ContextProvider;
  createdAt: number;
}

export interface ExtractRequestOptions {
  force?: boolean;
  /** Current text selection supplied by the renderer for the active tab. */
  selectedTextByTab?: Record<string, string>;
}

interface ExtractedGroup {
  url: string;
  tabs: TabInfo[];
  page: Awaited<ReturnType<typeof pageExtractor.extractFromUrl>>;
  error?: string;
  durationMs: number;
}

const PREVIEW_TTL_MS = 5 * 60 * 1000;

function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  return Promise.all(workers).then(() => results);
}

function snippetOf(text: string, max = 240): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max).trim()}…`;
}

function toTabInfo(tab: TabState, privateTabs: Set<string>, privateSession: boolean): TabInfo {
  return {
    id: tab.id,
    url: tab.url,
    title: tab.title,
    active: tab.active,
    isPrivate: tab.isPrivate === true || privateSession || privateTabs.has(tab.id),
  };
}

/**
 * Owns the live cross-tab context: extraction, bounded storage, exclusions,
 * private-session handling, and preview/confirm Q&A.
 */
export class ContextService {
  private readonly manager = new SessionContextManager();
  private readonly store = new Store({
    name: 'context-config',
    defaults: { exclusions: [] },
  }) as unknown as {
    get<K extends keyof ContextStoreShape>(key: K): ContextStoreShape[K];
    set<K extends keyof ContextStoreShape>(key: K, value: ContextStoreShape[K]): void;
  };
  private readonly privateTabs = new Set<string>();
  private privateSession = false;
  private readonly previews = new Map<string, PreviewEntry>();

  constructor() {
    const exclusions = this.store.get('exclusions') || [];
    this.manager.setExclusions(exclusions);
  }

  getExclusions(): string[] {
    return this.manager.getExclusions();
  }

  applyExclusions(hosts: readonly string[]): PickerState {
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const raw of hosts) {
      const host = raw.trim().toLowerCase();
      if (!host || seen.has(host)) continue;
      seen.add(host);
      cleaned.push(host);
    }
    this.manager.applyExclusions(cleaned);
    this.store.set('exclusions', cleaned);
    return this.getState();
  }

  isPrivateSession(): boolean {
    return this.privateSession;
  }

  setPrivateSession(enabled: boolean): PickerState {
    this.privateSession = enabled;
    if (!enabled) {
      this.manager.clearPrivate();
      for (const tabId of Array.from(this.privateTabs)) {
        this.manager.removeTab(tabId);
      }
      this.privateTabs.clear();
    }
    return this.getState();
  }

  markTabPrivate(tabId: string, isPrivate: boolean): PickerState {
    if (isPrivate) {
      this.privateTabs.add(tabId);
    } else {
      this.privateTabs.delete(tabId);
      for (const item of this.manager.listItems()) {
        if (item.tabId === tabId && item.isPrivate) this.manager.removeItem(item.id, false);
      }
    }
    return this.getState();
  }

  /** Wipe every private item and alias immediately. */
  clearPrivate(): number {
    const removed = this.manager.clearPrivate();
    for (const tabId of Array.from(this.privateTabs)) {
      this.manager.removeTab(tabId);
    }
    this.privateTabs.clear();
    return removed;
  }

  async clearAll(): Promise<PickerState> {
    await this.manager.clearAll();
    this.previews.clear();
    return this.getState();
  }

  removeItem(itemId: string): PickerState {
    this.manager.removeItem(itemId);
    return this.getState();
  }

  removeTab(tabId: string): PickerState {
    this.manager.removeTab(tabId);
    this.privateTabs.delete(tabId);
    return this.getState();
  }

  getState(windowId?: number): PickerState {
    const tabs = getTabs(windowId).map((tab) => {
      const info = toTabInfo(tab, this.privateTabs, this.privateSession);
      const cached = this.manager.getCachedForTab(tab.id);
      const stale = cached.length > 0 && cached.every((item) => normalizeUrl(item.url) !== normalizeUrl(tab.url));
      return {
        tab: { ...info, excluded: this.manager.isExcluded(tab.url) },
        cached: cached.length > 0,
        stale,
        chars: cached.reduce((sum, item) => sum + item.text.length + (item.selectedText?.length || 0), 0),
        approxTokens: cached.reduce((sum, item) => sum + item.approxTokens, 0),
        isPrivate: info.isPrivate === true,
        excluded: this.manager.isExcluded(tab.url),
        lastExtractedAt: cached.length
          ? Math.max(...cached.map((item) => item.extractedAt))
          : undefined,
      };
    });

    return {
      tabs,
      items: this.manager.listItems().map((item) => this.summarize(item)),
      stats: this.manager.stats(),
      exclusions: this.manager.getExclusions(),
      privateSession: this.privateSession,
      provider: this.getProviderStatus(),
    };
  }

  /**
   * Extract the selected tabs. Same-URL tabs are loaded once, and cached pages
   * are not re-fetched unless `force` is set.
   */
  async extract(selection: ContextSelection, options: ExtractRequestOptions = {}, windowId?: number): Promise<ExtractionBatchResult> {
    const allTabs = getTabs(windowId).map((tab) => toTabInfo(tab, this.privateTabs, this.privateSession));
    const resolved = resolveSelectionTabs(allTabs, selection);

    // One network load per normalized URL, no matter how many tabs point at it.
    const groups = new Map<string, TabInfo[]>();
    for (const tab of resolved) {
      if (!isExtractableUrl(tab.url)) continue;
      const key = normalizeUrl(tab.url);
      const list = groups.get(key);
      if (list) list.push(tab);
      else groups.set(key, [tab]);
    }

    const groupEntries = Array.from(groups.entries());
    const extracted = await mapLimit(groupEntries, 3, async ([url, tabs]) => {
      const started = Date.now();
      const isPrivate = tabs.some((tab) => tab.isPrivate) || this.privateSession;
      const allCached = !options.force && tabs.every((tab) => this.manager.hasFreshPage(tab.id, tab.url));
      if (allCached) {
        return { url, tabs, page: null, error: 'cached', durationMs: 0 } as ExtractedGroup;
      }
      try {
        const page = await pageExtractor.extractFromUrl(url, {
          isPrivate,
          excludedHosts: this.manager.getExclusions(),
        });
        return {
          url,
          tabs,
          page,
          error: page ? undefined : 'no readable content',
          durationMs: Date.now() - started,
        } as ExtractedGroup;
      } catch (error) {
        return {
          url,
          tabs,
          page: null,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - started,
        } as ExtractedGroup;
      }
    });

    const summaries: ExtractionSummary[] = [];
    for (const tab of resolved) {
      const group = extracted.find((entry) => entry.tabs.some((candidate) => candidate.id === tab.id));
      if (!group) {
        summaries.push(this.failureSummary(tab, 'not an http(s) URL'));
        continue;
      }
      if (group.error === 'cached') {
        const cached = this.manager.getCachedForTab(tab.id);
        summaries.push({
          tabId: tab.id,
          url: tab.url,
          title: tab.title,
          ok: true,
          skipped: true,
          reason: 'cached (unchanged, not re-extracted)',
          chars: cached.reduce((sum, item) => sum + item.text.length, 0),
          approxTokens: cached.reduce((sum, item) => sum + item.approxTokens, 0),
          isPrivate: tab.isPrivate === true,
          durationMs: 0,
        });
        continue;
      }
      if (!group.page) {
        summaries.push(this.failureSummary(tab, group.error || 'extraction failed', group.durationMs));
        continue;
      }

      const selectedText = selection.includeSelectedText === false
        ? undefined
        : options.selectedTextByTab?.[tab.id];
      const upsert = this.manager.upsertPage({
        tabId: tab.id,
        url: group.page.url || tab.url,
        title: group.page.title || tab.title,
        text: group.page.readableText,
        selectedText,
        headings: group.page.headings,
        links: this.mapLinks(group.page.links, group.page.url || tab.url),
        metadata: this.mapMetadata(group.page),
        isPrivate: tab.isPrivate === true || group.page.isPrivate,
      });

      if (!upsert) {
        summaries.push(this.failureSummary(tab, 'excluded or unsupported URL', group.durationMs));
        continue;
      }

      summaries.push({
        tabId: tab.id,
        url: upsert.item.url,
        title: upsert.item.title,
        ok: true,
        skipped: upsert.skipped,
        reason: upsert.reason,
        chars: upsert.item.text.length + (upsert.item.selectedText?.length || 0),
        approxTokens: upsert.item.approxTokens,
        isPrivate: upsert.item.isPrivate,
        dedupedInto: upsert.duplicateOf,
        durationMs: group.durationMs,
      });
    }

    this.manager.compressOlderContext();
    return { summaries, stats: this.manager.stats(), items: this.getState(windowId).items };
  }

  /** Build the exact payload without calling any provider. */
  preview(question: string, tabIds?: string[], maxChunks = 8): PreviewResult {
    const provider = this.resolveProvider();
    const retrieval = this.manager.retrieve(question, {
      tabIds,
      maxChunks,
      ensurePerTab: Boolean(tabIds && tabIds.length > 1),
      includePrivate: this.privateSession || Array.from(this.privateTabs).length > 0,
    });
    const preview = buildPromptPreview(question, retrieval, provider);
    this.previews.set(preview.payloadHash, { preview, provider, createdAt: Date.now() });
    this.prunePreviews();
    return {
      preview,
      totalChunks: retrieval.totalChunks,
      matchedTabs: retrieval.matchedTabs,
      hasSources: preview.sources.length > 0,
    };
  }

  /** Explicit send. The renderer must pass the hash of the preview the user saw. */
  async ask(payloadHash: string): Promise<QAAnswer> {
    const entry = this.previews.get(payloadHash);
    if (!entry) {
      throw new Error('Preview expired or unknown. Review the payload again before sending.');
    }
    if (Date.now() - entry.createdAt > PREVIEW_TTL_MS) {
      this.previews.delete(payloadHash);
      throw new Error('Preview expired. Review the payload again before sending.');
    }
    if (entry.preview.sources.length === 0) {
      this.previews.delete(payloadHash);
      return {
        answer: 'Not supported by the selected tabs. No relevant context was retrieved.',
        citations: [],
        supported: false,
        preview: entry.preview,
      };
    }
    const answer = await askWithPreview(entry.preview, entry.provider, payloadHash);
    this.previews.delete(payloadHash);
    return answer;
  }

  getItemText(itemId: string): { id: string; text: string; selectedText?: string } | null {
    const item = this.manager.getItem(itemId);
    if (!item) return null;
    return { id: item.id, text: item.text, selectedText: item.selectedText };
  }

  getProviderStatus(): ProviderStatus {
    const provider = this.resolveProvider();
    const available = !(provider instanceof UnavailableProvider);
    const model = provider.isTestOnly
      ? 'test-only fake (no network)'
      : (aiSystem.getRegistry().getModelSlot('research') || undefined);
    return {
      id: provider.id,
      name: provider.name,
      isLocal: provider.isLocal !== false,
      isTestOnly: provider.isTestOnly === true,
      available,
      model,
    };
  }

  async screenshot(tabId: string): Promise<Awaited<ReturnType<typeof pageExtractor.captureScreenshot>>> {
    const tab = getTabById(tabId);
    if (!tab) return null;
    return pageExtractor.captureScreenshot(tab.url, {
      isPrivate: this.privateSession || this.privateTabs.has(tabId),
      excludedHosts: this.manager.getExclusions(),
    });
  }

  dispose(): void {
    this.manager.clearPrivate();
    this.previews.clear();
    pageExtractor.dispose();
  }

  private resolveProvider(): ContextProvider {
    if (process.env.ARIADNE_TEST_FAKE_PROVIDER === '1') {
      return adaptRegistryStream(new TestOnlyProvider(), {
        id: TEST_ONLY_PROVIDER_ID,
        name: TEST_ONLY_PROVIDER_NAME,
        isLocal: true,
        isTestOnly: true,
      });
    }
    const registry = aiSystem.getRegistry();
    const model = registry.getModelSlot('research');
    if (!model) return new UnavailableProvider();
    return adaptRegistryStream(registry as unknown as ContractRegistry, {
      id: 'provider-registry',
      name: `Configured provider (research: ${model})`,
      isLocal: false,
      isTestOnly: false,
    });
  }

  private summarize(item: ContextItem): ContextItemSummary {
    return {
      id: item.id,
      tabId: item.tabId,
      url: item.url,
      title: item.title,
      chars: item.text.length + (item.selectedText?.length || 0),
      approxTokens: item.approxTokens,
      selectedTextChars: item.selectedText?.length || 0,
      headings: item.headings.length,
      links: item.links.length,
      isPrivate: item.isPrivate,
      compressed: item.compressed === true,
      sources: item.sources.map((source) => ({ ...source })),
      extractedAt: item.extractedAt,
      lastAccessedAt: item.lastAccessedAt,
      snippet: snippetOf(item.text),
    };
  }

  private mapMetadata(page: NonNullable<ExtractedGroup['page']>): Partial<ContextMetadata> {
    const metadata = page.metadata || {};
    return {
      description: metadata.description || metadata['og:description'] || metadata['twitter:description'],
      keywords: metadata.keywords,
      author: metadata.author || metadata['article:author'],
      ogTitle: metadata['og:title'],
      ogDescription: metadata['og:description'],
      favicon: metadata.favicon || metadata.icon,
      language: metadata.lang || page.accessibility?.language,
      accessibility: page.accessibility,
    };
  }

  private mapLinks(
    links: NonNullable<ExtractedGroup['page']>['links'],
    pageUrl: string
  ): ContextItem['links'] {
    let pageHost = '';
    try {
      pageHost = new URL(pageUrl).hostname.toLowerCase();
    } catch {
      pageHost = '';
    }
    return links.map((link) => {
      let host = '';
      try {
        host = new URL(link.url).hostname.toLowerCase();
      } catch {
        host = '';
      }
      return {
        href: link.url,
        text: link.text,
        isInternal: Boolean(pageHost) && host === pageHost,
      };
    });
  }

  private failureSummary(tab: TabInfo, reason: string, durationMs = 0): ExtractionSummary {
    return {
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
      ok: false,
      reason,
      chars: 0,
      approxTokens: 0,
      isPrivate: tab.isPrivate === true,
      durationMs,
    };
  }

  private prunePreviews(): void {
    const cutoff = Date.now() - PREVIEW_TTL_MS;
    for (const [hash, entry] of this.previews) {
      if (entry.createdAt < cutoff) this.previews.delete(hash);
    }
  }
}

export const contextService = new ContextService();
