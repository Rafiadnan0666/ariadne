export type ProviderType = 'openai' | 'anthropic' | '9router' | 'lmstudio' | 'custom';

export interface ModelCapability {
  contextWindow: number;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  maxOutputTokens?: number;
  inputCostPer1k?: number;
  outputCostPer1k?: number;
}

export interface ModelMetadata {
  id: string;
  name: string;
  provider: string;
  capabilities: ModelCapability;
  description?: string;
}

export type ModelSlot =
  | 'fastBrowsing'
  | 'research'
  | 'reasoning'
  | 'coding'
  | 'verification';

export interface ModelSlotConfig {
  [key: string]: string; // slot -> modelId
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  apiKeyRef?: string; // reference to keytar entry
  enabled: boolean;
  models: ModelMetadata[];
  defaultModel?: string;
  timeout?: number; // ms
  allowedFallback?: boolean; // user explicitly allows fallback to this provider
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentPart[];
  name?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  metadata?: RequestMetadata;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface RequestMetadata {
  slot?: ModelSlot;
  sourceTabId?: string;
  sourceUrl?: string;
  userInitiated: boolean;
}

export interface ChatCompletionChunk {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    delta: Partial<ChatMessage>;
    finishReason: string | null;
  }>;
  usage?: TokenUsage;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finishReason: string;
  }>;
  usage?: TokenUsage;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ProviderHealth {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  lastChecked: number;
}

export interface ProviderUsage {
  providerId: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost?: number;
  timestamp: number;
}

export interface ExtractionResult {
  url: string;
  title: string;
  readableText: string;
  selectedText?: string;
  headings: Array<{ level: number; text: string }>;
  metadata: Record<string, string>;
  timestamp: number;
  tabId: string;
  isPrivate: boolean;
}