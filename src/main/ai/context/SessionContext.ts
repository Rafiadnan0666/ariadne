import { PageExtractor, ExtractedPage } from './PageExtractor';
import { EmbeddingStore, ContextChunk } from './EmbeddingStore';

export interface RetrievalResult {
  chunks: ContextChunk[];
  query: string;
  totalChunks: number;
}

export interface SessionContextConfig {
  maxContextTokens: number;
  maxChunks: number;
  embeddingProviderId: string;
}

const DEFAULT_CONFIG: SessionContextConfig = {
  maxContextTokens: 8000,
  maxChunks: 10,
  embeddingProviderId: 'none',
};

export class SessionContext {
  private pageExtractor: PageExtractor;
  private embeddingStore: EmbeddingStore;
  private config: SessionContextConfig;

  constructor() {
    this.pageExtractor = new PageExtractor();
    this.embeddingStore = new EmbeddingStore();
    this.config = DEFAULT_CONFIG;
  }

  setPageExtractor(extractor: PageExtractor): void {
    this.pageExtractor = extractor;
  }

  setEmbeddingStore(store: EmbeddingStore): void {
    this.embeddingStore = store;
  }

  getConfig(): SessionContextConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<SessionContextConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.embeddingProviderId) {
      this.embeddingStore.setEmbeddingProvider(config.embeddingProviderId);
    }
  }

  // Extract page and store in embedding store
  async ingestTab(tabId: string): Promise<void> {
    const page = await this.pageExtractor.extractPage(tabId);
    if (!page) return;

    // Chunk the content
    const chunks = await this.embeddingStore.chunkContent(page.readableText, this.config.maxContextTokens / 4);
    
    // Store each chunk with embedding
    for (const chunk of chunks) {
      const embedding = await this.embeddingStore.generateEmbedding(chunk.content);
      await this.embeddingStore.addChunk({
        ...chunk,
        tabId: page.tabId,
        url: page.url,
        title: page.title,
        embedding,
      });
    }
  }

  // Retrieve relevant context for a query
  async retrieve(query: string, tabIds?: string[]): Promise<RetrievalResult> {
    const chunks = await this.embeddingStore.retrieve(query, tabIds, this.config.maxChunks);
    
    // Filter by token budget
    let tokenCount = 0;
    const filteredChunks: ContextChunk[] = [];
    for (const chunk of chunks) {
      if (tokenCount + chunk.tokenCount <= this.config.maxContextTokens) {
        filteredChunks.push(chunk);
        tokenCount += chunk.tokenCount;
      } else {
        break;
      }
    }

    return {
      chunks: filteredChunks,
      query,
      totalChunks: chunks.length,
    };
  }

  // Format chunks for LLM consumption
  formatForLLM(result: RetrievalResult): string {
    if (result.chunks.length === 0) return '';
    
    const parts: string[] = [];
    parts.push(`Relevant context from ${result.chunks.length} source(s):`);
    
    for (const chunk of result.chunks) {
      parts.push(`\n--- Source: ${chunk.title} (${chunk.url}) ---`);
      parts.push(chunk.content);
    }
    
    return parts.join('\n');
  }

  // Get combined context from multiple tabs for multi-tab queries
  async getTabsContext(tabIds: string[]): Promise<string> {
    const pages = await this.pageExtractor.extractMultiplePages(tabIds);
    if (pages.length === 0) return '';
    
    const parts: string[] = [];
    for (const page of pages) {
      parts.push(`[Tab: ${page.title}] ${page.url}`);
      parts.push(page.readableText.substring(0, 5000));
      parts.push('---');
    }
    return parts.join('\n');
  }

  // Clean up when tab is closed
  async onTabClosed(tabId: string): Promise<void> {
    this.embeddingStore.deleteByTabId(tabId);
    this.pageExtractor.unregisterTab(tabId);
  }

  getStats(): { embeddingStore: ReturnType<EmbeddingStore['getStats']> } {
    return {
      embeddingStore: this.embeddingStore.getStats(),
    };
  }
}

export const sessionContext = new SessionContext();