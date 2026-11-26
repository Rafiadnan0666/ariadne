import {
  ProviderConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ModelMetadata,
  ProviderHealth,
} from '../types';
import { BaseProvider, StreamCallback } from '../provider';

export interface CustomAdapterConfig {
  chatCompletionsPath: string;
  modelsPath: string;
  requestTransform?: (request: ChatCompletionRequest) => Record<string, unknown>;
  responseTransform?: (response: unknown) => ChatCompletionResponse;
  streamChunkTransform?: (chunk: unknown) => ChatCompletionChunk | null;
  authHeaderBuilder?: (apiKey: string | null) => Record<string, string>;
  healthCheckPath?: string;
}

export class CustomProvider extends BaseProvider {
  readonly config: ProviderConfig;
  private customConfig: CustomAdapterConfig;

  constructor(config: ProviderConfig, customConfig: CustomAdapterConfig) {
    super(config);
    this.config = config;
    this.customConfig = customConfig;
  }

  protected getDefaultBaseUrl(): string {
    return this.config.baseUrl || '';
  }

  protected requiresApiKey(): boolean {
    // Generic OpenAI-compatible endpoints are often self-hosted and keyless.
    return false;
  }

  protected getAuthHeaders(): Record<string, string> {
    const key = this.getCurrentApiKey();
    if (this.customConfig.authHeaderBuilder) {
      return this.customConfig.authHeaderBuilder(key);
    }
    return key ? { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  }

  async rotateKey(): Promise<boolean> {
    return this.rotateApiKey();
  }

  protected transformRequest(request: ChatCompletionRequest): Record<string, unknown> {
    if (this.customConfig.requestTransform) {
      return this.customConfig.requestTransform(request);
    }
    return {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens,
      stream: request.stream,
    };
  }

  protected transformResponse(response: unknown): ChatCompletionResponse {
    if (this.customConfig.responseTransform) {
      return this.customConfig.responseTransform(response);
    }
    const r = response as any;
    return {
      id: r.id || `custom-${Date.now()}`,
      model: r.model || this.config.defaultModel || 'unknown',
      choices: (r.choices || []).map((c: any, i: number) => ({
        index: c.index ?? i,
        message: c.message || { role: 'assistant', content: c.text || c.content || '' },
        finishReason: c.finish_reason || c.finishReason || 'stop',
      })),
      usage: r.usage
        ? {
            promptTokens: r.usage.prompt_tokens ?? r.usage.promptTokens ?? 0,
            completionTokens: r.usage.completion_tokens ?? r.usage.completionTokens ?? 0,
            totalTokens: r.usage.total_tokens ?? r.usage.totalTokens ?? 0,
          }
        : undefined,
    };
  }

  protected transformStreamChunk(chunk: unknown): ChatCompletionChunk | null {
    if (this.customConfig.streamChunkTransform) {
      return this.customConfig.streamChunkTransform(chunk);
    }
    const c = chunk as any;
    if (c.choices && c.choices.length > 0) {
      const choice = c.choices[0];
      return {
        id: c.id,
        model: c.model,
        choices: [
          {
            index: choice.index ?? 0,
            delta: { content: choice.delta?.content || choice.text || '' },
            finishReason: choice.delta?.finish_reason || choice.finish_reason || null,
          },
        ],
      };
    }
    return null;
  }

  protected transformStreamError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = `${this.getBaseUrl()}${this.customConfig.chatCompletionsPath}`;
    const body = this.transformRequest({ ...request, stream: false });
    const timeout = this.config.timeout ?? 60000;

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(body),
    }, timeout);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Custom provider error: ${response.status} ${error}`);
    }

    const data = await response.json();
    return this.transformResponse(data);
  }

  async chatCompletionStream(request: ChatCompletionRequest, onChunk: StreamCallback): Promise<void> {
    const url = `${this.getBaseUrl()}${this.customConfig.chatCompletionsPath}`;
    const body = this.transformRequest({ ...request, stream: true });
    const timeout = this.config.timeout ?? 60000;

    await this.fetchStream(url, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(body),
    }, onChunk, timeout);
  }

  async listModels(): Promise<ModelMetadata[]> {
    const url = `${this.getBaseUrl()}${this.customConfig.modelsPath}`;
    const response = await this.fetchWithTimeout(url, { headers: this.getAuthHeaders() }, 10000);

    if (!response.ok) {
      return this.getDefaultModels();
    }

    const data: any = await response.json();
    const models = (data.data || data.models || data).map((m: any) => {
      const caps = m.capabilities || {};
      return {
        id: String(m.id || m.name || ''),
        name: String(m.name || m.id || ''),
        provider: this.config.id,
        capabilities: {
          contextWindow: Number(m.context_window || m.contextWindow || 4096),
          supportsVision: Boolean(caps.vision),
          supportsTools: Boolean(caps.tools),
          supportsStreaming: true,
        },
      };
    });
    return models.length > 0 ? models : this.getDefaultModels();
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const path = this.customConfig.healthCheckPath || this.customConfig.modelsPath;
      const url = `${this.getBaseUrl()}${path}`;
      const response = await this.fetchWithTimeout(url, { headers: this.getAuthHeaders() }, 5000);
      const latency = Date.now() - start;
      return { healthy: response.ok, latencyMs: latency, lastChecked: Date.now() };
    } catch (error) {
      return { healthy: false, error: String(error), lastChecked: Date.now() };
    }
  }

  private getDefaultModels(): ModelMetadata[] {
    return [
      {
        id: this.config.defaultModel || 'custom-model',
        name: this.config.name,
        provider: this.config.id,
        capabilities: { contextWindow: 4096, supportsVision: false, supportsTools: false, supportsStreaming: true },
      },
    ];
  }
}