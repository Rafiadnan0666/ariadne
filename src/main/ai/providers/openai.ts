import OpenAI from 'openai';
import {
  ProviderConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ModelMetadata,
  ProviderHealth,
  ChatMessage,
} from '../types';
import { BaseProvider, StreamCallback } from '../provider';

export class OpenAIProvider extends BaseProvider {
  readonly config: ProviderConfig;
  private client: OpenAI;

  constructor(config: ProviderConfig) {
    super(config);
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKeyRef ? '' : process.env.OPENAI_API_KEY,
      baseURL: config.baseUrl || undefined,
      dangerouslyAllowBrowser: false,
    });
  }

  async initialize(): Promise<void> {
    await super.initialize();
    const key = this.getCurrentApiKey();
    if (key) {
      this.client = new OpenAI({
        apiKey: key,
        baseURL: this.config.baseUrl || undefined,
        dangerouslyAllowBrowser: false,
      });
    }
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.openai.com/v1';
  }

  protected getAuthHeaders(): Record<string, string> {
    const key = this.getCurrentApiKey();
    return {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };
  }

  async rotateKey(): Promise<boolean> {
    const rotated = this.rotateApiKey();
    if (rotated) {
      const key = this.getCurrentApiKey();
      if (key) {
        this.client = new OpenAI({
          apiKey: key,
          baseURL: this.config.baseUrl || undefined,
          dangerouslyAllowBrowser: false,
        });
      }
    }
    return rotated;
  }

  protected transformRequest(request: ChatCompletionRequest): Record<string, unknown> {
    return {
      model: request.model,
      messages: request.messages.map(this.transformMessage),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens,
      stream: request.stream,
      tools: request.tools?.map(this.transformTool),
      tool_choice: request.toolChoice,
    };
  }

  private transformMessage(msg: ChatMessage): Record<string, unknown> {
    const base: Record<string, unknown> = { role: msg.role };
    if (msg.name) base.name = msg.name;
    if (msg.toolCallId) base.tool_call_id = msg.toolCallId;

    if (typeof msg.content === 'string') {
      base.content = msg.content;
    } else {
      base.content = msg.content.map((part) => {
        if (part.type === 'text') return { type: 'text', text: part.text };
        return { type: 'image_url', image_url: { url: part.image_url.url, detail: part.image_url.detail || 'auto' } };
      });
    }

    if (msg.toolCalls) {
      base.tool_calls = msg.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }));
    }
    return base;
  }

  private transformTool(tool: any): Record<string, unknown> {
    return {
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      },
    };
  }

  protected transformResponse(response: unknown): ChatCompletionResponse {
    const r = response as any;
    return {
      id: r.id,
      model: r.model,
      choices: r.choices.map((c: any) => ({
        index: c.index,
        message: this.transformResponseMessage(c.message),
        finishReason: c.finish_reason === 'function_call' ? 'tool_calls' : c.finish_reason,
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

  private transformResponseMessage(msg: any): ChatMessage {
    const message: ChatMessage = { role: msg.role, content: msg.content || '' };
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
              function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' },
            })),
          },
          finishReason: choice.finish_reason === 'function_call' ? 'tool_calls' : choice.finish_reason,
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
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
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
    return (data.data as any[])
      .filter((m) => m.id.includes('gpt') || m.id.includes('o1'))
      .map((m) => ({
        id: m.id,
        name: m.id,
        provider: this.config.id,
        capabilities: this.getCapabilitiesForModel(m.id),
      }));
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
        name: 'GPT-4o',
        provider: this.config.id,
        capabilities: {
          contextWindow: 128000,
          supportsVision: true,
          supportsTools: true,
          supportsStreaming: true,
          maxOutputTokens: 16384,
          inputCostPer1k: 0.005,
          outputCostPer1k: 0.015,
        },
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        provider: this.config.id,
        capabilities: {
          contextWindow: 128000,
          supportsVision: true,
          supportsTools: true,
          supportsStreaming: true,
          maxOutputTokens: 16384,
          inputCostPer1k: 0.00015,
          outputCostPer1k: 0.0006,
        },
      },
      {
        id: 'o1-preview',
        name: 'o1 Preview',
        provider: this.config.id,
        capabilities: {
          contextWindow: 128000,
          supportsVision: false,
          supportsTools: false,
          supportsStreaming: true,
          maxOutputTokens: 32768,
          inputCostPer1k: 0.015,
          outputCostPer1k: 0.06,
        },
      },
      {
        id: 'gpt-3.5-turbo',
        name: 'GPT-3.5 Turbo',
        provider: this.config.id,
        capabilities: {
          contextWindow: 16385,
          supportsVision: false,
          supportsTools: true,
          supportsStreaming: true,
          maxOutputTokens: 4096,
          inputCostPer1k: 0.0005,
          outputCostPer1k: 0.0015,
        },
      },
    ];
  }

  private getCapabilitiesForModel(modelId: string): ModelMetadata['capabilities'] {
    const defaults = this.getDefaultModels();
    const found = defaults.find((m) => m.id === modelId);
    return found?.capabilities || {
      contextWindow: 4096,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: true,
    };
  }
}