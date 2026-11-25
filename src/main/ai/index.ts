import { app } from 'electron';
import Store from 'electron-store';
import { ProviderRegistry, providerRegistry, ProviderConfig, ProviderType, ModelSlot, ModelMetadata } from './registry';
import { storeCredential, getCredential, maskApiKey } from './credentials';
import { pageExtractor, PageExtractor } from './context/PageExtractor';
import { embeddingStore, EmbeddingStore } from './context/EmbeddingStore';
import { sessionContext, SessionContext, RetrievalResult } from './context/SessionContext';

const store = new Store({ name: 'ai-config' }) as any;

export interface AIConfig {
  providers: ProviderConfig[];
  modelSlots: Record<ModelSlot, string>;
  systemPrompt: string;
  context: {
    maxTokens: number;
    maxChunks: number;
    embeddingProviderId: string;
  };
}

const DEFAULT_CONFIG: AIConfig = {
  providers: [
    {
      id: 'lmstudio-local',
      name: 'LM Studio (Local)',
      type: 'lmstudio',
      baseUrl: 'http://localhost:1234/v1',
      enabled: true,
      models: [
        {
          id: 'local-model',
          name: 'Local Model',
          provider: 'lmstudio-local',
          capabilities: {
            contextWindow: 4096,
            supportsVision: false,
            supportsTools: false,
            supportsStreaming: true,
          },
        },
      ],
    },
  ],
  modelSlots: {
    fastBrowsing: '',
    research: '',
    reasoning: '',
    coding: '',
    verification: '',
  },
  systemPrompt: `You are Ariadne, an AI-native browser agent. You can control the browser, extract page content, and help users accomplish tasks.

Available tools:
- Navigation: navigate, goBack, goForward, reload, createTab, closeTab, switchTab
- Extraction: getPageText, getPageMarkdown, getDOM, findElements, getLinks
- Interaction: click, type, select, scroll, waitFor

Guidelines:
- Prefer local models when available for privacy
- Always cite sources with tab IDs when extracting info
- Ask for clarification on ambiguous tasks
- Verify completion before reporting success
- Never expose API keys or sensitive data`,
  context: {
    maxTokens: 8000,
    maxChunks: 10,
    embeddingProviderId: 'none',
  },
};

export class AISystem {
  private registry: ProviderRegistry;
  private pageExtractor: PageExtractor;
  private embeddingStore: EmbeddingStore;
  private sessionContext: SessionContext;
  private config: AIConfig;

  constructor() {
    this.registry = providerRegistry;
    this.pageExtractor = pageExtractor;
    this.embeddingStore = embeddingStore;
    this.sessionContext = sessionContext;
    this.config = this.loadConfig();
    this.initializeProviders();
    this.initializeContext();
  }

  private loadConfig(): AIConfig {
    const stored = store.get('aiConfig');
    if (!stored) {
      this.saveConfig(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }
    return { ...DEFAULT_CONFIG, ...stored };
  }

  private saveConfig(config: AIConfig): void {
    store.set('aiConfig', config);
  }

  private async initializeProviders(): Promise<void> {
    await this.registry.initialize();
    for (const providerConfig of this.config.providers) {
      if (providerConfig.enabled) {
        try {
          const existing = this.registry.getConfig(providerConfig.id);
          if (!existing) {
            await this.registry.addProvider(providerConfig);
          }
        } catch (e) {
          console.error(`[AI] Failed to register ${providerConfig.id}:`, e);
        }
      }
    }
    // Sync model slots
    for (const [slot, modelId] of Object.entries(this.config.modelSlots)) {
      if (modelId) {
        this.registry.setModelSlot(slot as ModelSlot, modelId);
      }
    }
  }

  private initializeContext(): void {
    this.sessionContext.updateConfig({
      maxContextTokens: this.config.context.maxTokens,
      maxChunks: this.config.context.maxChunks,
      embeddingProviderId: this.config.context.embeddingProviderId,
    });
  }

  getRegistry(): ProviderRegistry {
    return this.registry;
  }

  getPageExtractor(): PageExtractor {
    return this.pageExtractor;
  }

  getEmbeddingStore(): EmbeddingStore {
    return this.embeddingStore;
  }

  getSessionContext(): SessionContext {
    return this.sessionContext;
  }

  getConfig(): AIConfig {
    return { ...this.config };
  }

  async updateConfig(updates: Partial<AIConfig>): Promise<void> {
    this.config = { ...this.config, ...updates };
    this.saveConfig(this.config);

    if (updates.providers) {
      // Re-initialize providers
      await this.registry.shutdown();
      for (const providerConfig of this.config.providers) {
        if (providerConfig.enabled) {
          try {
            const existing = this.registry.getConfig(providerConfig.id);
            if (!existing) {
              await this.registry.addProvider(providerConfig);
            }
          } catch (e) {
            console.error(`[AI] Failed to register ${providerConfig.id}:`, e);
          }
        }
      }
    }
    if (updates.modelSlots) {
      for (const [slot, modelId] of Object.entries(this.config.modelSlots)) {
        if (modelId) {
          this.registry.setModelSlot(slot as ModelSlot, modelId);
        }
      }
    }
    if (updates.context) {
      this.sessionContext.updateConfig(updates.context);
    }
  }

  async addProvider(config: ProviderConfig, apiKeys?: string[]): Promise<void> {
    const existing = this.config.providers.find(p => p.id === config.id);
    if (existing) {
      throw new Error(`Provider ${config.id} already exists`);
    }
    this.config.providers.push(config);
    this.saveConfig(this.config);
    if (config.enabled) {
      await this.registry.addProvider(config, apiKeys);
    }
  }

  async removeProvider(id: string): Promise<void> {
    this.config.providers = this.config.providers.filter(p => p.id !== id);
    this.saveConfig(this.config);
    await this.registry.removeProvider(id);
  }

  async testProvider(id: string, apiKeys?: string[]): Promise<{ success: boolean; error?: string }> {
    const config = this.config.providers.find(p => p.id === id);
    if (!config) return { success: false, error: 'Provider not found' };

    try {
      // Test with first key if provided
      const health = await this.registry.testProvider(config, apiKeys?.[0]);
      return { success: health.healthy, error: health.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  async setApiKeys(providerId: string, apiKeys: string[]): Promise<void> {
    await this.registry.setApiKeys(providerId, apiKeys);
    const config = this.registry.getConfig(providerId);
    if (config) {
      this.saveConfig(this.config);
    }
  }

  async addApiKey(providerId: string, apiKey: string): Promise<void> {
    await this.registry.addApiKey(providerId, apiKey);
    const config = this.registry.getConfig(providerId);
    if (config) {
      this.saveConfig(this.config);
    }
  }

  async removeApiKey(providerId: string, keyIndex: number): Promise<void> {
    await this.registry.removeApiKey(providerId, keyIndex);
    const config = this.registry.getConfig(providerId);
    if (config) {
      this.saveConfig(this.config);
    }
  }

  getApiKeyCount(providerId: string): number {
    return this.registry.getApiKeyCount(providerId);
  }

  getMaskedApiKeys(providerId: string): Promise<string[]> {
    const config = this.registry.getConfig(providerId);
    if (!config?.apiKeyRefs) return Promise.resolve([]);
    return Promise.all(config.apiKeyRefs.map(ref => 
      getCredential(providerId, ref).then(key => key ? maskApiKey(key) : '********')
    ));
  }

  getSystemPrompt(): string {
    return this.config.systemPrompt;
  }

  setSystemPrompt(prompt: string): void {
    this.config.systemPrompt = prompt;
    this.saveConfig(this.config);
  }

  setModelSlot(slot: ModelSlot, modelId: string): void {
    this.config.modelSlots[slot] = modelId;
    this.saveConfig(this.config);
    this.registry.setModelSlot(slot, modelId);
  }

  getModelSlot(slot: ModelSlot): string {
    return this.registry.getModelSlot(slot);
  }

  getModelForSlot(slot: ModelSlot): ModelMetadata | null {
    return this.registry.getModelForSlot(slot);
  }

  getAllModels(): ModelMetadata[] {
    return this.registry.getAllModels();
  }

  getProviderTypes(): ProviderType[] {
    return this.registry.getProviderTypes();
  }

  // Page extraction
  async extractPage(tabId: string) {
    return this.pageExtractor.extractPage(tabId);
  }

  // Register/unregister tabs with extractor
  registerTab(tabId: string, webContentsId: number, url: string, title: string, isPrivate: boolean): void {
    this.pageExtractor.registerTab(tabId, webContentsId, url, title, isPrivate);
  }

  unregisterTab(tabId: string): void {
    this.pageExtractor.unregisterTab(tabId);
    this.sessionContext.onTabClosed(tabId);
  }

  updateTab(tabId: string, url: string, title: string): void {
    this.pageExtractor.updateTab(tabId, url, title);
  }

  // Context retrieval
  async getContextForQuery(query: string, tabIds?: string[]): Promise<RetrievalResult> {
    return this.sessionContext.retrieve(query, tabIds);
  }

  async formatContextForLLM(query: string, tabIds?: string[]): Promise<string> {
    const result = await this.sessionContext.retrieve(query, tabIds);
    return this.sessionContext.formatForLLM(result);
  }

  async getTabsContext(tabIds: string[]): Promise<string> {
    return this.sessionContext.getTabsContext(tabIds);
  }

  // Ingest tab content into embedding store
  async ingestTab(tabId: string): Promise<void> {
    return this.sessionContext.ingestTab(tabId);
  }

  async shutdown(): Promise<void> {
    await this.registry.shutdown();
  }

  cancelChat(): void {
    this.registry.cancelActiveRequests();
  }
}

export const aiSystem = new AISystem();