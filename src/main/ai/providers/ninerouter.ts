import {
  ProviderConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ModelMetadata,
  ProviderHealth,
} from '../types';
import { BaseProvider, StreamCallback } from '../provider';

export class NineRouterProvider extends BaseProvider {
  readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    super(config);
    this.config = config;
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.9router.com/v1';
  }

  protected getAuthHeaders(): Record<string, string> {
    const key = this.getCurrentApiKey();
    return {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };
  }

  async rotateKey(): Promise<boolean> {
    return this.rotateApiKey();
  }

  protected transformRequest(request: ChatCompletionRequest): Record<string, unknown> {
    return {
      model: request.model,
      messages: request.messages.map(this.transformMessage),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens,
      stream: request.stream,
      tools: request.tools,
      tool_choice: request.toolChoice,
    };
  }

  protected transformMessage(msg: any): Record<string, unknown> {
    const base: Record<string, unknown> = { role: msg.role };
    if (msg.name) base.name = msg.name;
    if (msg.toolCallId) base.tool_call_id = msg.toolCallId;

    if (typeof msg.content === 'string') {
      base.content = msg.content;
    } else {
      base.content = msg.content.map((part: any) => {
        if (part.type === 'text') return { type: 'text', text: part.text };
        return { type: 'image_url', image_url: part.image_url };
      });
    }

    if (msg.toolCalls) {
      base.tool_calls = msg.toolCalls.map((tc: any) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }));
    }
    return base;
  }

  protected transformResponse(response: unknown): ChatCompletionResponse {
    const r = response as any;
    return {
      id: r.id,
      model: r.model,
      choices: r.choices.map((c: any) => ({
        index: c.index,
        message: this.transformResponseMessage(c.message),
        finishReason: c.finish_reason,
      })),
      usage: r.usage
        ? {
            promptTokens: r.usage.prompt_tokens,
            completionTokens: r.usage.completion_tokens,
            totalTokens: r.usage.total_tokens,
          }
        : undefined,
    };
  }

  protected transformResponseMessage(msg: any): any {
    const message: any = { role: msg.role, content: msg.content || '' };
    if (msg.tool_calls) {
      message.toolCalls = msg.tool_calls.map((tc: any) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }));
    }
    return message;
  }

  protected transformStreamChunk(chunk: unknown): ChatCompletionChunk | null {
    const c = chunk as any;
    if (!c.choices || c.choices.length === 0) return null;
    const choice = c.choices[0];
    return {
      id: c.id,
      model: c.model,
      choices: [
        {
          index: choice.index,
          delta: {
            role: choice.delta?.role,
            content: choice.delta?.content,
            toolCalls: choice.delta?.tool_calls?.map((tc: any) => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.function?.name, arguments: tc.function?.arguments || '' },
            })),
          },
          finishReason: choice.finish_reason,
        },
      ],
      usage: c.usage
        ? {
            promptTokens: c.usage.prompt_tokens,
            completionTokens: c.usage.completion_tokens,
            totalTokens: c.usage.total_tokens,
          }
        : undefined,
    };
  }

  protected transformStreamError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = `${this.getBaseUrl()}/chat/completions`;
    const body = this.transformRequest({ ...request, stream: false });
    const timeout = this.config.timeout ?? 60000;

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(body),
    }, timeout);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`9Router API error: ${response.status} ${error}`);
    }

    const data = await response.json();
    return this.transformResponse(data);
  }

  async chatCompletionStream(request: ChatCompletionRequest, onChunk: StreamCallback): Promise<void> {
    const url = `${this.getBaseUrl()}/chat/completions`;
    const body = this.transformRequest({ ...request, stream: true });
    const timeout = this.config.timeout ?? 60000;

    await this.fetchStream(url, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(body),
    }, onChunk, timeout);
  }

  async listModels(): Promise<ModelMetadata[]> {
    const url = `${this.getBaseUrl()}/models`;
    const response = await this.fetchWithTimeout(url, { headers: this.getAuthHeaders() }, 10000);

    if (!response.ok) {
      return this.getDefaultModels();
    }

    const data: any = await response.json();
    return (data.data as any[]).map((m) => {
      const caps = m.capabilities || {};
      return {
        id: String(m.id || ''),
        name: String(m.id || ''),
        provider: this.config.id,
        capabilities: {
          contextWindow: Number(m.context_window || 4096),
          supportsVision: Boolean(caps.vision),
          supportsTools: Boolean(caps.tools),
          supportsStreaming: true,
        },
      };
    });
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const url = `${this.getBaseUrl()}/models`;
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
        id: 'gpt-4o',
        name: 'GPT-4o (via 9Router)',
        provider: this.config.id,
        capabilities: { contextWindow: 128000, supportsVision: true, supportsTools: true, supportsStreaming: true },
      },
      {
        id: 'claude-3-5-sonnet',
        name: 'Claude 3.5 Sonnet (via 9Router)',
        provider: this.config.id,
        capabilities: { contextWindow: 200000, supportsVision: true, supportsTools: true, supportsStreaming: true },
      },
    ];
  }
}