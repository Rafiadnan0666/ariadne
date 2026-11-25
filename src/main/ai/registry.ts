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
import { ProviderAdapter, StreamCallback, BaseProvider } from './provider';
import { createProvider, PROVIDER_TYPES, getDefaultConfig } from './providers';
import { storeCredential, getCredential, deleteCredential, listCredentials, maskApiKey } from './credentials';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

const REGISTRY_FILE = 'ai-providers.json';
const USAGE_FILE = 'ai-usage.json';

// Track active request context for fallback
interface ActiveRequestContext {
  request: ChatCompletionRequest;
  originalProviderId: string;
  originalModelId: string;
  attemptCount: number;
  startTime: number;
}

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
  private activeRequestContext: ActiveRequestContext | null = null;
  private keyRotationIndex = new Map<string, number>(); // providerId -> current key index

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

  async addProvider(config: ProviderConfig, apiKeys?: string[]): Promise<void> {
    if (this.configs.has(config.id)) {
      throw new Error(`Provider ${config.id} already exists`);
    }

    const keyRefs: string[] = [];
    if (apiKeys && apiKeys.length > 0) {
      for (let i = 0; i < apiKeys.length; i++) {
        const keyName = `key-${i + 1}`;
        await storeCredential(config.id, keyName, apiKeys[i]);
        keyRefs.push(keyName);
      }
    } else if (config.apiKeyRefs && config.apiKeyRefs.length > 0) {
      // Keys already stored
    }

    const mergedConfig = { 
      ...getDefaultConfig(config.type), 
      ...config,
      apiKeyRefs: keyRefs.length > 0 ? keyRefs : config.apiKeyRefs,
      fallbackPriority: config.fallbackPriority ?? 10,
      maxRetries: config.maxRetries ?? 2,
      healthCheckInterval: config.healthCheckInterval ?? 300000,
    } as ProviderConfig;
    this.configs.set(config.id, mergedConfig);

    if (mergedConfig.enabled) {
      await this.startProvider(mergedConfig);
    }

    await this.saveConfigs();
  }

  async updateProvider(config: ProviderConfig, apiKeys?: string[]): Promise<void> {
    const existing = this.configs.get(config.id);
    if (!existing) throw new Error(`Provider ${config.id} not found`);

    const keyRefs = existing.apiKeyRefs || [];
    if (apiKeys && apiKeys.length > 0) {
      // Add new keys
      for (let i = 0; i < apiKeys.length; i++) {
        const keyName = `key-${keyRefs.length + i + 1}`;
        await storeCredential(config.id, keyName, apiKeys[i]);
        keyRefs.push(keyName);
      }
    }

    const wasEnabled = existing.enabled;
    const mergedConfig = { 
      ...existing, 
      ...config, 
      ...getDefaultConfig(config.type),
      apiKeyRefs: keyRefs,
    } as ProviderConfig;
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
    if (config?.apiKeyRefs) {
      for (const keyRef of config.apiKeyRefs) {
        await deleteCredential(id, keyRef);
      }
    } else if (config?.apiKeyRef) {
      // Legacy single key
      await deleteCredential(id, config.apiKeyRef);
    }
    this.configs.delete(id);
    this.healthCache.delete(id);
    this.keyRotationIndex.delete(id);
    await this.saveConfigs();
  }

  async setApiKeys(providerId: string, apiKeys: string[]): Promise<void> {
    const config = this.configs.get(providerId);
    if (!config) throw new Error(`Provider ${providerId} not found`);

    // Clear old keys
    if (config.apiKeyRefs) {
      for (const keyRef of config.apiKeyRefs) {
        await deleteCredential(providerId, keyRef);
      }
    } else if (config.apiKeyRef) {
      await deleteCredential(providerId, config.apiKeyRef);
    }

    // Store new keys
    const keyRefs: string[] = [];
    for (let i = 0; i < apiKeys.length; i++) {
      const keyName = `key-${i + 1}`;
      await storeCredential(providerId, keyName, apiKeys[i]);
      keyRefs.push(keyName);
    }

    config.apiKeyRefs = keyRefs;
    this.keyRotationIndex.set(providerId, 0);
    await this.saveConfigs();

    if (config.enabled) {
      await this.restartProvider(config);
    }
  }

  async addApiKey(providerId: string, apiKey: string): Promise<void> {
    const config = this.configs.get(providerId);
    if (!config) throw new Error(`Provider ${providerId} not found`);

    const keyRefs = config.apiKeyRefs || [];
    const keyName = `key-${keyRefs.length + 1}`;
    await storeCredential(providerId, keyName, apiKey);
    keyRefs.push(keyName);

    config.apiKeyRefs = keyRefs;
    await this.saveConfigs();

    if (config.enabled) {
      await this.restartProvider(config);
    }
  }

  async removeApiKey(providerId: string, keyIndex: number): Promise<void> {
    const config = this.configs.get(providerId);
    if (!config || !config.apiKeyRefs || keyIndex >= config.apiKeyRefs.length) {
      throw new Error(`Invalid key index`);
    }

    const keyRef = config.apiKeyRefs[keyIndex];
    await deleteCredential(providerId, keyRef);
    config.apiKeyRefs.splice(keyIndex, 1);
    
    // Adjust rotation index
    const currentIndex = this.keyRotationIndex.get(providerId) || 0;
    if (currentIndex >= config.apiKeyRefs.length && config.apiKeyRefs.length > 0) {
      this.keyRotationIndex.set(providerId, 0);
    }
    
    await this.saveConfigs();

    if (config.enabled) {
      await this.restartProvider(config);
    }
  }

  getApiKeyCount(providerId: string): number {
    const config = this.configs.get(providerId);
    return config?.apiKeyRefs?.length || 0;
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

  // Error classification for retry/fallback decisions
  private classifyError(error: unknown): { retryable: boolean; fallbackable: boolean; rotatable: boolean } {
    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    
    // Rate limits, quotas, server errors -> retryable, fallbackable, rotatable
    if (msg.includes('rate limit') || msg.includes('429') || msg.includes('quota exceeded') || 
        msg.includes('503') || msg.includes('502') || msg.includes('504') || msg.includes('server error')) {
      return { retryable: true, fallbackable: true, rotatable: true };
    }
    
    // Auth errors -> fallbackable, rotatable (try next key)
    if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || 
        msg.includes('forbidden') || msg.includes('invalid api key') || msg.includes('authentication')) {
      return { retryable: false, fallbackable: true, rotatable: true };
    }
    
    // Network errors -> retryable
    if (msg.includes('timeout') || msg.includes('network') || msg.includes('econnreset') || 
        msg.includes('etimedout') || msg.includes('socket')) {
      return { retryable: true, fallbackable: true, rotatable: false };
    }
    
    // Model not found, context length -> fallbackable (different model/provider)
    if (msg.includes('model not found') || msg.includes('context length') || msg.includes('max tokens')) {
      return { retryable: false, fallbackable: true, rotatable: false };
    }
    
    // Unknown -> retryable once, fallbackable
    return { retryable: true, fallbackable: true, rotatable: false };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async executeWithRetry(
    provider: ProviderAdapter,
    request: ChatCompletionRequest,
    config: ProviderConfig,
    model: ModelMetadata,
    startTime: number,
    attempt: number = 0
  ): Promise<ChatCompletionResponse> {
    const maxRetries = config.maxRetries ?? 2;
    
    try {
      const response = await provider.chatCompletion(request);
      this.recordUsage(provider.config.id, request.model, response.usage, model, Date.now() - startTime);
      return response;
    } catch (error) {
      const classification = this.classifyError(error);
      
      // Try key rotation first if rotatable
      if (classification.rotatable && provider instanceof BaseProvider) {
        const rotated = await provider.rotateApiKey();
        if (rotated) {
          console.log(`Rotated API key for ${provider.config.id}, retrying...`);
          return this.executeWithRetry(provider, request, config, model, startTime, attempt);
        }
      }
      
      // Retry with backoff
      if (classification.retryable && attempt < maxRetries) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.log(`Retrying ${provider.config.id} in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})`);
        await this.sleep(backoffMs);
        return this.executeWithRetry(provider, request, config, model, startTime, attempt + 1);
      }
      
      throw error;
    }
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const modelId = request.model;
    const result = await this.getModelById(modelId);
    if (!result) throw new Error(`Model ${modelId} not found or provider not enabled`);

    const { provider, model } = result;
    const startTime = Date.now();

    // Track context for fallback
    this.activeRequestContext = {
      request,
      originalProviderId: provider.config.id,
      originalModelId: modelId,
      attemptCount: 0,
      startTime,
    };

    try {
      return await this.executeWithRetry(provider, request, provider.config, model, startTime);
    } catch (error) {
      return this.handleErrorAndFallback(error, request, modelId, startTime);
    } finally {
      this.activeRequestContext = null;
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

    this.activeRequestContext = {
      request,
      originalProviderId: provider.config.id,
      originalModelId: modelId,
      attemptCount: 0,
      startTime,
    };

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
      
      // For streaming fallback, we'd need to re-stream - simplified: fall back to non-streaming
      const fallbackResponse = await this.handleErrorAndFallback(error, request, modelId, startTime);
      return fallbackResponse;
    } finally {
      this.activeRequestContext = null;
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

    // Get fallback providers sorted by priority
    const fallbackConfigs = Array.from(this.configs.values())
      .filter((c) => c.enabled && c.allowedFallback && c.id !== originalProviderId)
      .sort((a, b) => (a.fallbackPriority ?? 10) - (b.fallbackPriority ?? 10));

    // Preserve conversation context for fallback
    const fallbackRequest = { ...request };

    for (const fallbackConfig of fallbackConfigs) {
      const fallbackProvider = this.providers.get(fallbackConfig.id);
      if (!fallbackProvider) continue;

      const fallbackModel = fallbackConfig.models[0] || fallbackConfig.defaultModel;
      if (!fallbackModel) continue;

      const fallbackModelId = typeof fallbackModel === 'string' ? fallbackModel : fallbackModel.id;
      if (!fallbackModelId) continue;

      try {
        const modelMeta = typeof fallbackModel === 'string' ? fallbackConfig.models[0] : fallbackModel;
        const response = await this.executeWithRetry(
          fallbackProvider, 
          { ...fallbackRequest, model: fallbackModelId }, 
          fallbackConfig, 
          modelMeta as ModelMetadata, 
          startTime
        );
        console.warn(`Fell back from ${originalProviderId} to ${fallbackConfig.id} (model: ${fallbackModelId}):`, error);
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