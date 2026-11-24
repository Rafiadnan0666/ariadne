import { estimateTokens, hashText } from './extraction';
import type {
  Citation,
  ContextProvider,
  PromptPreview,
  PromptSource,
  QAAnswer,
  RetrievalResult,
} from './types';

const SYSTEM_PROMPT = [
  'You are Ariadne, an AI assistant inside a desktop browser.',
  'Answer ONLY from the SOURCES supplied in the user message.',
  'Every factual claim must cite its source using the exact marker [S1], [S2], etc.',
  'When comparing tabs, cite each tab you use.',
  'If the sources do not support an answer, reply exactly: "Not supported by the selected tabs." Do not guess.',
  'Keep answers concise and quote short snippets when useful.',
].join(' ');

export function buildPromptPreview(
  question: string,
  retrieval: RetrievalResult,
  provider: ContextProvider
): PromptPreview {
  const sources: PromptSource[] = retrieval.hits.map((hit, index) => ({
    id: `S${index + 1}`,
    tabId: hit.chunk.tabId,
    url: hit.chunk.url,
    title: hit.chunk.title,
    chunkIndex: hit.chunk.chunkIndex,
    text: hit.chunk.text,
    approxTokens: hit.chunk.approxTokens,
  }));

  const sourceBlocks = sources.map((source) =>
    [
      `[${source.id}] ${source.title}`,
      `URL: ${source.url}`,
      `TAB: ${source.tabId} | CHUNK: ${source.chunkIndex}`,
      source.text,
    ].join('\n')
  );

  const userPrompt = [
    `QUESTION: ${question}`,
    '',
    `SOURCES (${sources.length}):`,
    sourceBlocks.length ? sourceBlocks.join('\n\n') : '(no sources)',
  ].join('\n');

  const approxInputTokens = estimateTokens(SYSTEM_PROMPT) + estimateTokens(userPrompt);

  return {
    question,
    sources,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    approxInputTokens,
    providerId: provider.id,
    providerName: provider.name,
    isTestOnlyProvider: provider.isTestOnly === true,
    payloadHash: hashText(`${provider.id}\n${SYSTEM_PROMPT}\n${userPrompt}`),
    createdAt: Date.now(),
  };
}

export function unsupportedAnswer(question: string, retrieval: RetrievalResult, provider: ContextProvider): QAAnswer {
  const preview = buildPromptPreview(question, retrieval, provider);
  return {
    answer: 'Not supported by the selected tabs. I could not find relevant content for this question.',
    citations: [],
    supported: false,
    preview,
  };
}

function isRefusal(answer: string): boolean {
  return /not supported by the selected tabs|not enough information|no relevant (content|information)|couldn'?t find|cannot find|unable to find/i.test(answer);
}

export function extractCitations(answer: string, preview: PromptPreview): Citation[] {
  const byId = new Map(preview.sources.map((source) => [source.id, source]));
  const seen = new Set<string>();
  const citations: Citation[] = [];
  const pattern = /\[(S\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(answer)) !== null) {
    const sourceId = match[1];
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    const source = byId.get(sourceId);
    if (source) {
      citations.push({
        sourceId,
        tabId: source.tabId,
        url: source.url,
        title: source.title,
        chunkIndex: source.chunkIndex,
      });
    }
  }
  return citations;
}

/**
 * Send a prepared preview to the provider. Callers must only invoke this after
 * the user has explicitly confirmed the exact preview payload.
 */
export async function askWithPreview(
  preview: PromptPreview,
  provider: ContextProvider,
  confirmedPayloadHash: string
): Promise<QAAnswer> {
  if (confirmedPayloadHash !== preview.payloadHash) {
    throw new Error('Context payload changed since preview; refusing to send.');
  }

  const response = await provider.chat({
    messages: [
      { role: 'system', content: preview.systemPrompt },
      { role: 'user', content: preview.userPrompt },
    ],
    temperature: 0.1,
    maxTokens: 700,
  });

  const citations = extractCitations(response.text, preview);
  let supported = citations.length > 0;
  let warning: string | undefined;

  if (!supported && !isRefusal(response.text)) {
    warning = 'The provider answered without citing any source. Treat this as unsupported.';
  }
  if (supported && isRefusal(response.text)) {
    supported = false;
  }

  return {
    answer: response.text,
    citations,
    supported,
    warning,
    preview,
    usage: response.usage,
  };
}
