import {
  ProviderConfig,
  ProviderType,
  ModelMetadata,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderHealth,
  ProviderUsage,
  ModelSlot,
  TokenUsage,
  ModelCapability,
  RequestMetadata,
} from './types';
import { ProviderAdapter, StreamCallback } from './provider';
import { createProvider, PROVIDER_TYPES, getDefaultConfig } from './providers';
import { storeCredential, getCredential, deleteCredential, listCredentials, maskApiKey } from './credentials';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

const REGISTRY_FILE = 'ai-providers.json';
const USAGE_FILE = 'ai-usage.json';

export class ProviderRegistry {
  private providers = new Map<string, ProviderAdapter>();
  private configs = new Map<string, ProviderConfig>();
  private modelSlots: Record<ModelSlot, string> = {
    fastBrowsing: '',
    research: '',
    reasoning: '',
    coding: '',
    verification: '',
  };
  private usageHistory: ProviderUsage[] = [];
  private healthCache = new Map<string, ProviderHealth>();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.loadConfigs();
    await this.loadUsage();
    for (const config of this.configs.values()) {
      if (config.enabled) {
        await this.startProvider(config);
      }
    }
    this.initialized = true;
  }

  private getRegistryPath(): string {
    return path.join(app.getPath('userData'), REGISTRY_FILE);
  }

  private getUsagePath(): string {
    return path.join(app.getPath('userData'), USAGE_FILE);
  }

  private async loadConfigs(): Promise<void> {
    const registryPath = this.getRegistryPath();
    if (!fs.existsSync(registryPath)) return;

    try {
      const data = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      for (const config of data.providers || []) {
        this.configs.set(config.id, config);
      }
      this.modelSlots = { ...this.modelSlots, ...(data.modelSlots || {}) };
    } catch (error) {
      console.error('Failed to load provider configs:', error);
    }
  }

  private async saveConfigs(): Promise<void> {
    const registryPath = this.getRegistryPath();
    const data = {
      providers: Array.from(this.configs.values()),
      modelSlots: this.modelSlots,
    };
    fs.writeFileSync(registryPath, JSON.stringify(data, null, 2));
  }

  private async loadUsage(): Promise<void> {
    const usagePath = this.getUsagePath();
    if (!fs.existsSync(usagePath)) return;

    try {
      const data = JSON.parse(fs.readFileSync(usagePath, 'utf-8'));
      this.usageHistory = data.history || [];
      if (this.usageHistory.length > 10000) {
        this.usageHistory = this.usageHistory.slice(-10000);
      }
    } catch (error) {
      console.error('Failed to load usage history:', error);
    }
  }

  private async saveUsage(): Promise<void> {
    const usagePath = this.getUsagePath();
    fs.writeFileSync(usagePath, JSON.stringify({ history: this.usageHistory }, null, 2));
  }

  async addProvider(config: ProviderConfig, apiKey?: string): Promise<void> {
    if (this.configs.has(config.id)) {
      throw new Error(`Provider ${config.id} already exists`);
    }

    if (apiKey && config.apiKeyRef) {
      await storeCredential(config.id, config.apiKeyRef, apiKey);
    }

    const mergedConfig = { ...getDefaultConfig(config.type), ...config } as ProviderConfig;
    this.configs.set(config.id, mergedConfig);

    if (mergedConfig.enabled) {
      await this.startProvider(mergedConfig);
    }

    await this.saveConfigs();
  }

  async updateProvider(config: ProviderConfig, apiKey?: string): Promise<void> {
    const existing = this.configs.get(config.id);
    if (!existing) throw new Error(`Provider ${config.id} not found`);

    if (apiKey && config.apiKeyRef) {
      await storeCredential(config.id, config.apiKeyRef, apiKey);
    }

    const wasEnabled = existing.enabled;
    const mergedConfig = { ...existing, ...config, ...getDefaultConfig(config.type) } as ProviderConfig;
    this.configs.set(config.id, mergedConfig);

    if (wasEnabled && !mergedConfig.enabled) {
      await this.stopProvider(config.id);
    } else if (!wasEnabled && mergedConfig.enabled) {
      await this.startProvider(mergedConfig);
    } else if (wasEnabled && mergedConfig.enabled) {
      await this.restartProvider(mergedConfig);
    }

    await this.saveConfigs();
  }

  async removeProvider(id: string): Promise<void> {
    await this.stopProvider(id);
    const config = this.configs.get(id);
    if (config?.apiKeyRef) {
      await deleteCredential(id, config.apiKeyRef);
    }
    this.configs.delete(id);
    this.healthCache.delete(id);
    await this.saveConfigs();
  }

  async setApiKey(providerId: string, keyName: string, apiKey: string): Promise<void> {
    const config = this.configs.get(providerId);
    if (!config) throw new Error(`Provider ${providerId} not found`);

    await storeCredential(providerId, keyName, apiKey);
    config.apiKeyRef = keyName;
    await this.saveConfigs();

    if (config.enabled) {
      await this.restartProvider(config);
    }
  }

  async testProvider(config: ProviderConfig, apiKey?: string): Promise<ProviderHealth> {
    const testConfig = { ...getDefaultConfig(config.type), ...config } as ProviderConfig;
    if (apiKey) {
      await storeCredential('__test__', 'temp', apiKey);
      testConfig.apiKeyRef = 'temp';
    }
    const provider = createProvider(testConfig);
    await provider.initialize();
    const health = await provider.healthCheck();
    await provider.shutdown();
    if (apiKey) {
      await deleteCredential('__test__', 'temp');
    }
    return health;
  }

  private async startProvider(config: ProviderConfig): Promise<void> {
    try {
      const provider = createProvider(config);
      await provider.initialize();
      this.providers.set(config.id, provider);
      const health = await provider.healthCheck();
      this.healthCache.set(config.id, health);
    } catch (error) {
      console.error(`Failed to start provider ${config.id}:`, error);
      this.healthCache.set(config.id, { healthy: false, error: String(error), lastChecked: Date.now() });
    }
  }

  private async stopProvider(id: string): Promise<void> {
    const provider = this.providers.get(id);
    if (provider) {
      await provider.shutdown();
      this.providers.delete(id);
    }
  }

  private async restartProvider(config: ProviderConfig): Promise<void> {
    await this.stopProvider(config.id);
    await this.startProvider(config);
  }

  getProvider(id: string): ProviderAdapter | undefined {
    return this.providers.get(id);
  }

  getConfig(id: string): ProviderConfig | undefined {
    return this.configs.get(id);
  }

  getAllConfigs(): ProviderConfig[] {
    return Array.from(this.configs.values());
  }

  getEnabledProviders(): ProviderAdapter[] {
    return Array.from(this.providers.values());
  }

  getAllModels(): ModelMetadata[] {
    const models: ModelMetadata[] = [];
    for (const provider of this.providers.values()) {
      try {
        // Models are loaded at startup, but we could refresh
        // For now, return from configs
      } catch {}
    }
    for (const config of this.configs.values()) {
      for (const model of config.models) {
        models.push({ ...model, provider: config.id });
      }
    }
    return models;
  }

  getModelsForProvider(providerId: string): ModelMetadata[] {
    const config = this.configs.get(providerId);
    return config?.models || [];
  }

  async getModelById(modelId: string): Promise<{ provider: ProviderAdapter; model: ModelMetadata } | null> {
    for (const provider of this.providers.values()) {
      const config = this.configs.get(provider.config.id);
      const model = config?.models.find((m) => m.id === modelId);
      if (model) return { provider, model };
    }
    return null;
  }

  setModelSlot(slot: ModelSlot, modelId: string): void {
    this.modelSlots[slot] = modelId;
    this.saveConfigs();
  }

  getModelSlot(slot: ModelSlot): string {
    return this.modelSlots[slot];
  }

  getAllModelSlots(): Record<ModelSlot, string> {
    return { ...this.modelSlots };
  }

  getModelForSlot(slot: ModelSlot): ModelMetadata | null {
    const modelId = this.modelSlots[slot];
    if (!modelId) return null;
    for (const config of this.configs.values()) {
      const model = config.models.find((m) => m.id === modelId);
      if (model) return model;
    }
    return null;
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const modelId = request.model;
    const result = await this.getModelById(modelId);
    if (!result) throw new Error(`Model ${modelId} not found or provider not enabled`);

    const { provider, model } = result;
    const startTime = Date.now();

    try {
      const response = await provider.chatCompletion(request);
      this.recordUsage(provider.config.id, modelId, response.usage, model, Date.now() - startTime);
      return response;
    } catch (error) {
      return this.handleErrorAndFallback(error, request, modelId, startTime);
    }
  }

  async chatCompletionStream(
    request: ChatCompletionRequest,
    onChunk: StreamCallback
  ): Promise<ChatCompletionResponse> {
    const modelId = request.model;
    const result = await this.getModelById(modelId);
    if (!result) throw new Error(`Model ${modelId} not found or provider not enabled`);

    const { provider, model } = result;
    const startTime = Date.now();
    let accumulatedUsage: TokenUsage | undefined;
    let finishReason = 'stop';

    try {
      await provider.chatCompletionStream(request, (chunk) => {
        if (chunk.usage) accumulatedUsage = chunk.usage;
        if (chunk.choices[0]?.finishReason) finishReason = chunk.choices[0].finishReason;
        onChunk(chunk);
      });

      if (accumulatedUsage) {
        this.recordUsage(provider.config.id, modelId, accumulatedUsage, model, Date.now() - startTime);
      }

      return {
        id: `stream-${Date.now()}`,
        model: modelId,
        choices: [{ index: 0, message: { role: 'assistant', content: '' }, finishReason }],
        usage: accumulatedUsage,
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'CANCELLED') throw error;
      const fallbackResponse = await this.handleErrorAndFallback(error, request, modelId, startTime);
      // For streaming fallback, we'd need to re-stream - simplified for now
      return fallbackResponse;
    }
  }

  /** Abort any in-flight provider request (used by the chat Stop button). */
  cancelActiveRequests(): void {
    for (const provider of this.providers.values()) {
      provider.cancelActiveRequest?.();
    }
  }

  private async handleErrorAndFallback(
    error: unknown,
    request: ChatCompletionRequest,
    originalModelId: string,
    startTime: number
  ): Promise<ChatCompletionResponse> {
    const originalResult = await this.getModelById(originalModelId);
    const originalProviderId = originalResult?.provider.config.id;

    // Find fallback providers that user explicitly allowed
    const fallbackConfigs = Array.from(this.configs.values()).filter(
      (c) => c.enabled && c.allowedFallback && c.id !== originalProviderId
    );

    for (const fallbackConfig of fallbackConfigs) {
      const fallbackProvider = this.providers.get(fallbackConfig.id);
      if (!fallbackProvider) continue;

      const fallbackModel = fallbackConfig.models[0] || fallbackConfig.defaultModel;
      if (!fallbackModel) continue;

      const fallbackModelId = typeof fallbackModel === 'string' ? fallbackModel : fallbackModel.id;
      if (!fallbackModelId) continue;

      try {
        const fallbackRequest = { ...request, model: fallbackModelId };
        const response = await fallbackProvider.chatCompletion(fallbackRequest);
        const modelMeta = typeof fallbackModel === 'string' ? fallbackConfig.models[0] : fallbackModel;
        this.recordUsage(fallbackConfig.id, fallbackModelId, response.usage, modelMeta, Date.now() - startTime);
        console.warn(`Fell back from ${originalProviderId} to ${fallbackConfig.id}:`, error);
        return response;
      } catch (fallbackError) {
        console.error(`Fallback to ${fallbackConfig.id} also failed:`, fallbackError);
      }
    }

    throw error;
  }

  private recordUsage(
    providerId: string,
    modelId: string,
    usage: TokenUsage | undefined,
    model: ModelMetadata | undefined,
    latencyMs: number
  ): void {
    if (!usage) return;
    const cost = model ? this.providers.get(providerId)?.calculateCost(usage, model) : undefined;
    const record: ProviderUsage = {
      providerId,
      modelId,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      estimatedCost: cost,
      timestamp: Date.now(),
    };
    this.usageHistory.push(record);
    if (this.usageHistory.length > 10000) this.usageHistory.shift();
    this.saveUsage();
  }

  getUsageHistory(providerId?: string, since?: number): ProviderUsage[] {
    let history = this.usageHistory;
    if (providerId) history = history.filter((u) => u.providerId === providerId);
    if (since) history = history.filter((u) => u.timestamp >= since);
    return history;
  }

  getTotalUsage(since?: number): { promptTokens: number; completionTokens: number; totalTokens: number; cost: number } {
    const history = since ? this.usageHistory.filter((u) => u.timestamp >= since) : this.usageHistory;
    return history.reduce(
      (acc, u) => ({
        promptTokens: acc.promptTokens + u.promptTokens,
        completionTokens: acc.completionTokens + u.completionTokens,
        totalTokens: acc.totalTokens + u.totalTokens,
        cost: acc.cost + (u.estimatedCost || 0),
      }),
      { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 }
    );
  }

  async checkAllHealth(): Promise<Map<string, ProviderHealth>> {
    const results = new Map<string, ProviderHealth>();
    for (const [id, provider] of this.providers) {
      const health = await provider.healthCheck();
      this.healthCache.set(id, health);
      results.set(id, health);
    }
    return results;
  }

  getCachedHealth(id: string): ProviderHealth | undefined {
    return this.healthCache.get(id);
  }

  getProviderTypes(): ProviderType[] {
    return PROVIDER_TYPES;
  }

  async shutdown(): Promise<void> {
    for (const provider of this.providers.values()) {
      await provider.shutdown();
    }
    this.providers.clear();
  }
}

export const providerRegistry = new ProviderRegistry();

export type {
  ProviderConfig,
  ProviderType,
  ModelMetadata,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderHealth,
  ProviderUsage,
  ModelSlot,
  TokenUsage,
  ModelCapability,
  RequestMetadata,
} from './types';

export type { ProviderAdapter, StreamCallback } from './provider';