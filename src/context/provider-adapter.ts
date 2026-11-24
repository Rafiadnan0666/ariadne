import type { ContextProvider, ProviderChatRequest, ProviderChatResponse } from './types';

/**
 * Structural view of the provider contract published in docs/AI-CONTRACT.md
 * (ProviderRegistry.stream) plus the non-streaming methods the registry
 * currently exposes. Declared locally so Session C does not depend on
 * Session B's in-flight files; any object satisfying this shape is accepted.
 */
export interface ContractChunk {
  choices?: Array<{
    index?: number;
    delta?: { role?: string; content?: string | unknown };
    finishReason?: string | null;
  }>;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export type ContractTask = 'fastBrowsing' | 'research' | 'reasoning' | 'coding' | 'verification';

export interface ContractMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface ContractStreamRequest {
  task: ContractTask;
  messages: ContractMessage[];
  signal?: AbortSignal;
  sourceTabId?: string;
  sourceUrl?: string;
}

export interface ContractChatRequest {
  model: string;
  messages: ContractMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ContractChatResponse {
  choices?: Array<{
    message?: { role?: string; content?: string | unknown };
    finishReason?: string;
  }>;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface ContractRegistry {
  /** Published contract: AsyncIterable of chunks. */
  stream?(request: ContractStreamRequest): AsyncIterable<ContractChunk>;
  /** Current registry API: resolves the model from request.model. */
  chatCompletion?(request: ContractChatRequest): Promise<ContractChatResponse>;
  /** Current registry streaming API (callback based). */
  chatCompletionStream?(
    request: ContractChatRequest,
    onChunk: (chunk: ContractChunk) => void
  ): Promise<unknown>;
  getModelSlot?(slot: ContractTask): string;
}

export interface ProviderIdentity {
  id: string;
  name: string;
  isLocal?: boolean;
  isTestOnly?: boolean;
}

function contentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object' && 'text' in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }
        return '';
      })
      .join('');
  }
  return '';
}

function normalizeUsage(usage: ContractChunk['usage']): ProviderChatResponse['usage'] | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.promptTokens ?? usage.prompt_tokens ?? 0,
    completionTokens: usage.completionTokens ?? usage.completion_tokens ?? 0,
    totalTokens: usage.totalTokens ?? usage.total_tokens ?? 0,
  };
}

/**
 * Adapt the provider registry to the context Q&A contract.
 *
 * Preference order:
 * 1. `stream()` from docs/AI-CONTRACT.md (true streaming)
 * 2. `chatCompletion()` (current registry; model resolved from the research slot)
 * 3. `chatCompletionStream()` (callback streaming)
 */
export function adaptRegistryStream(registry: ContractRegistry, identity: ProviderIdentity): ContextProvider {
  return {
    id: identity.id,
    name: identity.name,
    isLocal: identity.isLocal,
    isTestOnly: identity.isTestOnly === true,
    async chat(request: ProviderChatRequest): Promise<ProviderChatResponse> {
      const messages = request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));

      if (typeof registry.stream === 'function') {
        let text = '';
        let usage: ProviderChatResponse['usage'];
        for await (const chunk of registry.stream({ task: 'research', messages })) {
          const delta = chunk.choices?.[0]?.delta;
          if (delta && typeof delta.content === 'string') text += delta.content;
          const normalized = normalizeUsage(chunk.usage);
          if (normalized) usage = normalized;
        }
        return { text, usage };
      }

      const model = request.model || registry.getModelSlot?.('research') || '';
      if (!model) {
        throw new Error(
          'No research model is configured. Set the "research" model slot in AI settings, ' +
            'or set ARIADNE_TEST_FAKE_PROVIDER=1 to exercise the pipeline with the test-only fake.'
        );
      }

      if (typeof registry.chatCompletion === 'function') {
        const response = await registry.chatCompletion({
          model,
          messages,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
        });
        return {
          text: contentToString(response.choices?.[0]?.message?.content),
          usage: response.usage
            ? {
                promptTokens: response.usage.promptTokens ?? 0,
                completionTokens: response.usage.completionTokens ?? 0,
                totalTokens: response.usage.totalTokens ?? 0,
              }
            : undefined,
        };
      }

      if (typeof registry.chatCompletionStream === 'function') {
        let text = '';
        let usage: ProviderChatResponse['usage'];
        await registry.chatCompletionStream(
          { model, messages, temperature: request.temperature, maxTokens: request.maxTokens },
          (chunk) => {
            const delta = chunk.choices?.[0]?.delta;
            if (delta && typeof delta.content === 'string') text += delta.content;
            const normalized = normalizeUsage(chunk.usage);
            if (normalized) usage = normalized;
          }
        );
        return { text, usage };
      }

      throw new Error(
        'The configured provider registry does not expose a supported chat method ' +
          '(expected stream, chatCompletion, or chatCompletionStream).'
      );
    },
  };
}

/** Honest placeholder when no provider is configured/available. */
export class UnavailableProvider implements ContextProvider {
  readonly id = 'unavailable';
  readonly name = 'No AI provider configured';
  readonly isLocal = true;
  readonly isTestOnly = false;

  async chat(): Promise<ProviderChatResponse> {
    throw new Error(
      'No AI provider is available. Configure a provider and a research model slot, or set ' +
        'ARIADNE_TEST_FAKE_PROVIDER=1 to exercise the pipeline with the clearly labeled test-only fake.'
    );
  }
}
