import {
  ProviderConfig,
  ProviderType,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatMessage,
  ModelMetadata,
  ProviderHealth,
  ProviderUsage,
  TokenUsage,
  ModelCapability,
  RequestMetadata,
} from './types';
import { getCredential } from './credentials';

export interface StreamCallback {
  (chunk: ChatCompletionChunk): void;
}

export interface ProviderAdapter {
  readonly config: ProviderConfig;

  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  chatCompletionStream(request: ChatCompletionRequest, onChunk: StreamCallback): Promise<void>;
  cancelActiveRequest?(): void;

  listModels(): Promise<ModelMetadata[]>;
  healthCheck(): Promise<ProviderHealth>;

  estimateTokens(messages: ChatMessage[]): number;
  calculateCost(usage: TokenUsage, model: ModelMetadata): number | undefined;
}

export abstract class BaseProvider implements ProviderAdapter {
  readonly config: ProviderConfig;
  protected apiKeys: string[] = [];
  protected currentKeyIndex = 0;
  protected abortController: AbortController | null = null;
  private abortReason: 'timeout' | 'cancelled' | null = null;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    const keyRefs = this.config.apiKeyRefs || (this.config.apiKeyRef ? [this.config.apiKeyRef] : []);
    for (const keyRef of keyRefs) {
      const key = await getCredential(this.config.id, keyRef);
      if (key) this.apiKeys.push(key);
    }
    if (this.apiKeys.length === 0 && keyRefs.length > 0) {
      throw new Error(`No API keys found for provider ${this.config.id}`);
    }
  }

  getCurrentApiKey(): string | null {
    if (this.apiKeys.length === 0) return null;
    return this.apiKeys[this.currentKeyIndex];
  }

  rotateApiKey(): boolean {
    if (this.apiKeys.length <= 1) return false;
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
    return true;
  }

  getApiKeyCount(): number {
    return this.apiKeys.length;
  }

  async shutdown(): Promise<void> {
    this.abortReason = 'cancelled';
    this.abortController?.abort();
  }

  cancelActiveRequest(): void {
    this.abortReason = 'cancelled';
    this.abortController?.abort();
  }

  abstract chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  abstract chatCompletionStream(request: ChatCompletionRequest, onChunk: StreamCallback): Promise<void>;
  abstract listModels(): Promise<ModelMetadata[]>;
  abstract healthCheck(): Promise<ProviderHealth>;

  protected getBaseUrl(): string {
    return this.config.baseUrl || this.getDefaultBaseUrl();
  }

  protected abstract getDefaultBaseUrl(): string;
  protected abstract getAuthHeaders(): Record<string, string>;
  protected abstract transformRequest(request: ChatCompletionRequest): Record<string, unknown>;
  protected abstract transformResponse(response: unknown): ChatCompletionResponse;
  protected abstract transformStreamChunk(chunk: unknown): ChatCompletionChunk | null;
  protected abstract transformStreamError(error: unknown): Error;

  estimateTokens(messages: ChatMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        total += msg.content.length / 4;
      } else {
        for (const part of msg.content) {
          if (part.type === 'text') total += part.text.length / 4;
        }
      }
    }
    return Math.ceil(total);
  }

  calculateCost(usage: TokenUsage, model: ModelMetadata): number | undefined {
    const caps = model.capabilities;
    if (!caps.inputCostPer1k || !caps.outputCostPer1k) return undefined;
    return (usage.promptTokens / 1000) * caps.inputCostPer1k + (usage.completionTokens / 1000) * caps.outputCostPer1k;
  }

  protected async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    this.abortController = new AbortController();
    this.abortReason = null;
    const timeoutId = setTimeout(() => {
      this.abortReason = 'timeout';
      this.abortController?.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: this.abortController.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  protected async fetchStream(
    url: string,
    options: RequestInit,
    onChunk: StreamCallback,
    timeoutMs: number
  ): Promise<void> {
    this.abortController = new AbortController();
    this.abortReason = null;
    const timeoutId = setTimeout(() => {
      this.abortReason = 'timeout';
      this.abortController?.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') return;
            try {
              const parsed = JSON.parse(data);
              const chunk = this.transformStreamChunk(parsed);
              if (chunk) onChunk(chunk);
            } catch {
              // Ignore parse errors in stream
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (this.abortReason === 'cancelled') throw new Error('CANCELLED');
        throw new Error('Request timeout');
      }
      throw this.transformStreamError(error);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}