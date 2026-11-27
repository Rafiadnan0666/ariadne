import { ProviderConfig, ProviderType } from '../types';
import { ProviderAdapter } from '../provider';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { NineRouterProvider } from './ninerouter';
import { LMStudioProvider } from './lmstudio';
import { CustomProvider, CustomAdapterConfig } from './custom';

export function createProvider(config: ProviderConfig, customConfig?: CustomAdapterConfig): ProviderAdapter {
  switch (config.type) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case '9router':
      return new NineRouterProvider(config);
    case 'lmstudio':
      return new LMStudioProvider(config);
    case 'custom':
      // Generic OpenAI-compatible endpoint works out of the box; callers may
      // override the default paths via customConfig.
      return new CustomProvider(config, customConfig ?? {
        chatCompletionsPath: '/chat/completions',
        modelsPath: '/models',
      });
    default:
      const exhaustive: never = config.type;
      throw new Error(`Unknown provider type: ${exhaustive}`);
  }
}

export const PROVIDER_TYPES: ProviderType[] = ['openai', 'anthropic', '9router', 'lmstudio', 'custom'];

export function getDefaultConfig(type: ProviderType): Partial<ProviderConfig> {
  const defaults: Record<ProviderType, Partial<ProviderConfig>> = {
    openai: { baseUrl: 'https://api.openai.com/v1', timeout: 60000 },
    anthropic: { baseUrl: 'https://api.anthropic.com/v1', timeout: 60000 },
    '9router': { baseUrl: 'https://api.9router.com/v1', timeout: 60000 },
    lmstudio: { baseUrl: 'http://localhost:1234/v1', timeout: 120000 },
    custom: { timeout: 60000 },
  };
  return defaults[type];
}

export type { ProviderConfig, ProviderType } from '../types';
export type { ProviderAdapter, StreamCallback } from '../provider';
export type { ModelMetadata, ModelCapability, ModelSlot } from '../types';
export type { ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk, ChatMessage } from '../types';
export type { ProviderHealth, ProviderUsage, TokenUsage } from '../types';
export { OpenAIProvider } from './openai';
export { AnthropicProvider } from './anthropic';
export { NineRouterProvider } from './ninerouter';
export { LMStudioProvider } from './lmstudio';
export { CustomProvider, CustomAdapterConfig } from './custom';