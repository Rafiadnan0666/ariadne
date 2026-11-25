import Anthropic from '@anthropic-ai/sdk';
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

export class AnthropicProvider extends BaseProvider {
  readonly config: ProviderConfig;
  private client: Anthropic;

  constructor(config: ProviderConfig) {
    super(config);
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.apiKeyRef ? '' : process.env.ANTHROPIC_API_KEY,
      baseURL: config.baseUrl || undefined,
      dangerouslyAllowBrowser: false,
    });
  }

  async initialize(): Promise<void> {
    await super.initialize();
    const key = this.getCurrentApiKey();
    if (key) {
      this.client = new Anthropic({
        apiKey: key,
        baseURL: this.config.baseUrl || undefined,
        dangerouslyAllowBrowser: false,
      });
    }
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.anthropic.com/v1';
  }

  protected getAuthHeaders(): Record<string, string> {
    const key = this.getCurrentApiKey();
    return {
      'x-api-key': key || '',
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
  }

  async rotateKey(): Promise<boolean> {
    const rotated = this.rotateApiKey();
    if (rotated) {
      const key = this.getCurrentApiKey();
      if (key) {
        this.client = new Anthropic({
          apiKey: key,
          baseURL: this.config.baseUrl || undefined,
          dangerouslyAllowBrowser: false,
        });
      }
    }
    return rotated;
  }

  protected transformRequest(request: ChatCompletionRequest): Record<string, unknown> {
    const { system, messages } = this.extractSystemAndMessages(request.messages);
    return {
      model: request.model,
      messages: messages.map(this.transformMessage),
      system,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 4096,
      stream: request.stream,
      tools: request.tools?.map(this.transformTool),
      tool_choice: this.transformToolChoice(request.toolChoice),
    };
  }

  private extractSystemAndMessages(messages: ChatMessage[]): { system?: string; messages: ChatMessage[] } {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const otherMessages = messages.filter((m) => m.role !== 'system');
    const system = systemMessages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    return { system: system || undefined, messages: otherMessages };
  }

  private transformMessage(msg: ChatMessage): Record<string, unknown> {
    if (typeof msg.content === 'string') {
      return { role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content };
    }
    return {
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content.map((part) => {
        if (part.type === 'text') return { type: 'text', text: part.text };
        return { type: 'image', source: { type: 'base64', media_type: 'image/png', data: part.image_url.url.split(',')[1] } };
      }),
    };
  }

  private transformTool(tool: any): Record<string, unknown> {
    return {
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    };
  }

  private transformToolChoice(choice: any): any {
    if (!choice || choice === 'auto') return { type: 'auto' };
    if (choice === 'none') return { type: 'none' };
    if (choice.type === 'function') return { type: 'tool', name: choice.function.name };
    return { type: 'auto' };
  }

  protected transformResponse(response: unknown): ChatCompletionResponse {
    const r = response as any;
    return {
      id: r.id,
      model: r.model,
      choices: [
        {
          index: 0,
          message: this.transformResponseMessage(r),
          finishReason: this.mapStopReason(r.stop_reason),
        },
      ],
      usage: r.usage
        ? {
            promptTokens: r.usage.input_tokens,
            completionTokens: r.usage.output_tokens,
            totalTokens: r.usage.input_tokens + r.usage.output_tokens,
          }
        : undefined,
    };
  }

  private transformResponseMessage(r: any): ChatMessage {
    let content: string | any[] = '';
    if (r.content && Array.isArray(r.content)) {
      content = r.content.map((c: any) => (c.type === 'text' ? c.text : '')).join('');
    } else if (typeof r.content === 'string') {
      content = r.content;
    }

    const message: ChatMessage = { role: 'assistant', content };
    if (r.tool_use) {
      message.toolCalls = r.tool_use.map((tu: any) => ({
        id: tu.id,
        type: 'function',
        function: { name: tu.name, arguments: JSON.stringify(tu.input) },
      }));
    }
    return message;
  }

  protected transformStreamChunk(chunk: unknown): ChatCompletionChunk | null {
    const c = chunk as any;
    if (c.type === 'message_start') return null;
    if (c.type === 'message_delta') {
      return {
        id: c.message?.id || '',
        model: c.message?.model || '',
        choices: [
          {
            index: 0,
            delta: { content: c.delta?.text || '' },
            finishReason: this.mapStopReason(c.delta?.stop_reason),
          },
        ],
        usage: c.usage
          ? {
              promptTokens: c.usage.input_tokens,
              completionTokens: c.usage.output_tokens,
              totalTokens: c.usage.input_tokens + c.usage.output_tokens,
            }
          : undefined,
      };
    }
    if (c.type === 'content_block_delta' && c.delta?.type === 'text_delta') {
      return {
        id: '',
        model: '',
        choices: [{ index: 0, delta: { content: c.delta.text }, finishReason: null }],
      };
    }
    return null;
  }

  protected transformStreamError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  private mapStopReason(reason: string | null | undefined): string {
    if (!reason) return 'stop';
    if (reason === 'end_turn') return 'stop';
    if (reason === 'max_tokens') return 'length';
    if (reason === 'stop_sequence') return 'stop';
    if (reason === 'tool_use') return 'tool_calls';
    return reason;
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = `${this.getBaseUrl()}/messages`;
    const body = this.transformRequest({ ...request, stream: false });
    const timeout = this.config.timeout ?? 60000;

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(body),
    }, timeout);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${error}`);
    }

    const data = await response.json();
    return this.transformResponse(data);
  }

  async chatCompletionStream(request: ChatCompletionRequest, onChunk: StreamCallback): Promise<void> {
    const url = `${this.getBaseUrl()}/messages`;
    const body = this.transformRequest({ ...request, stream: true });
    const timeout = this.config.timeout ?? 60000;

    await this.fetchStream(url, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(body),
    }, onChunk, timeout);
  }

  async listModels(): Promise<ModelMetadata[]> {
    return this.getDefaultModels();
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const response = await this.fetchWithTimeout(
        `${this.getBaseUrl()}/messages`,
        {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
        },
        5000
      );
      const latency = Date.now() - start;
      return { healthy: response.ok || response.status === 400, latencyMs: latency, lastChecked: Date.now() };
    } catch (error) {
      return { healthy: false, error: String(error), lastChecked: Date.now() };
    }
  }

  private getDefaultModels(): ModelMetadata[] {
    return [
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        provider: this.config.id,
        capabilities: {
          contextWindow: 200000,
          supportsVision: true,
          supportsTools: true,
          supportsStreaming: true,
          maxOutputTokens: 8192,
          inputCostPer1k: 0.003,
          outputCostPer1k: 0.015,
        },
      },
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        provider: this.config.id,
        capabilities: {
          contextWindow: 200000,
          supportsVision: true,
          supportsTools: true,
          supportsStreaming: true,
          maxOutputTokens: 8192,
          inputCostPer1k: 0.0008,
          outputCostPer1k: 0.004,
        },
      },
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        provider: this.config.id,
        capabilities: {
          contextWindow: 200000,
          supportsVision: true,
          supportsTools: true,
          supportsStreaming: true,
          maxOutputTokens: 4096,
          inputCostPer1k: 0.015,
          outputCostPer1k: 0.075,
        },
      },
    ];
  }
}