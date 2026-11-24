import { app } from 'electron';
import Store from 'electron-store';
import { ProviderRegistry, providerRegistry, ProviderConfig, ProviderType, ModelSlot, ModelMetadata } from './registry';
import { storeCredential, getCredential, maskApiKey } from './credentials';

const store = new Store({ name: 'ai-config' }) as any;

export interface AIConfig {
  providers: ProviderConfig[];
  modelSlots: Record<ModelSlot, string>;
  systemPrompt: string;
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
};

export class AISystem {
  private registry: ProviderRegistry;
  private config: AIConfig;

  constructor() {
    this.registry = providerRegistry;
    this.config = this.loadConfig();
    this.initializeProviders();
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

  getRegistry(): ProviderRegistry {
    return this.registry;
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
  }

  async addProvider(config: ProviderConfig, apiKey?: string): Promise<void> {
    const existing = this.config.providers.find(p => p.id === config.id);
    if (existing) {
      throw new Error(`Provider ${config.id} already exists`);
    }
    this.config.providers.push(config);
    this.saveConfig(this.config);
    if (config.enabled) {
      await this.registry.addProvider(config, apiKey);
    }
  }

  async removeProvider(id: string): Promise<void> {
    this.config.providers = this.config.providers.filter(p => p.id !== id);
    this.saveConfig(this.config);
    await this.registry.removeProvider(id);
  }

  async testProvider(id: string, apiKey?: string): Promise<{ success: boolean; error?: string }> {
    const config = this.config.providers.find(p => p.id === id);
    if (!config) return { success: false, error: 'Provider not found' };

    try {
      const health = await this.registry.testProvider(config, apiKey);
      return { success: health.healthy, error: health.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  async setApiKey(providerId: string, keyName: string, apiKey: string): Promise<void> {
    await storeCredential(providerId, keyName, apiKey);
    const config = this.registry.getConfig(providerId);
    if (config) {
      config.apiKeyRef = keyName;
      if (config.enabled) {
        await this.registry.updateProvider(config);
      }
    }
  }

  getMaskedApiKey(providerId: string, keyName: string): Promise<string | null> {
    return getCredential(providerId, keyName).then(key => key ? maskApiKey(key) : null);
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

  async shutdown(): Promise<void> {
    await this.registry.shutdown();
  }
}

export const aiSystem = new AISystem();