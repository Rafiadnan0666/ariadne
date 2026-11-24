/**
 * ============================================================================
 * TEST-ONLY FAKE PROVIDER — NO NETWORK, NO MODEL. NEVER ENABLE IN PRODUCTION.
 * ============================================================================
 *
 * Implements the docs/AI-CONTRACT.md streaming shape so the cross-tab pipeline
 * can be exercised end-to-end before Session B's real provider is configured.
 * The main process only activates it when ARIADNE_TEST_FAKE_PROVIDER=1, and the
 * UI labels every answer as coming from the test-only fake.
 */
import type { ContractChunk, ContractRegistry, ContractStreamRequest } from './provider-adapter';

export const TEST_ONLY_PROVIDER_ID = 'test-only-fake';
export const TEST_ONLY_PROVIDER_NAME = 'TEST-ONLY FAKE PROVIDER (no network)';

interface ParsedSource {
  id: string;
  title: string;
  url: string;
  text: string;
}

function parsePrompt(prompt: string): { question: string; sources: ParsedSource[] } {
  const questionMatch = prompt.match(/QUESTION:\s*([^\n]+)/);
  const question = questionMatch ? questionMatch[1].trim() : 'Summarize the selected tabs.';
  const sources: ParsedSource[] = [];
  const blocks = prompt.split(/\n\n(?=\[S\d+\])/);
  for (const block of blocks) {
    const header = block.match(/^\[(S\d+)\]\s*([^\n]*)\nURL:\s*([^\n]*)/);
    if (!header) continue;
    const bodyStart = block.indexOf('\n', block.indexOf('URL:'));
    const body = bodyStart >= 0 ? block.slice(bodyStart + 1).trim() : '';
    sources.push({ id: header[1], title: header[2].trim(), url: header[3].trim(), text: body });
  }
  return { question, sources };
}

function firstSentences(text: string, maxChars: number): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxChars) return cleaned;
  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  let out = '';
  for (const sentence of sentences) {
    if (out.length + sentence.length > maxChars) break;
    out += `${sentence} `;
  }
  return (out || cleaned.slice(0, maxChars)).trim();
}

export class TestOnlyProvider implements ContractRegistry {
  readonly id = TEST_ONLY_PROVIDER_ID;
  readonly name = TEST_ONLY_PROVIDER_NAME;
  readonly isTestOnly = true;

  async *stream(request: ContractStreamRequest): AsyncIterable<ContractChunk> {
    const lastUser = [...request.messages].reverse().find((message) => message.role === 'user');
    const { question, sources } = parsePrompt(lastUser?.content || '');
    const answer = this.buildAnswer(question, sources);
    const promptChars = request.messages.reduce((sum, message) => sum + message.content.length, 0);

    // Simulate streaming in a few chunks so the adapter path is exercised.
    const parts = answer.match(/.{1,80}(\s|$)/g) || [answer];
    for (let i = 0; i < parts.length; i++) {
      yield {
        choices: [{
          index: 0,
          delta: { role: i === 0 ? 'assistant' : undefined, content: parts[i] },
          finishReason: i === parts.length - 1 ? 'stop' : null,
        }],
        usage: i === parts.length - 1
          ? {
              promptTokens: Math.ceil(promptChars / 4),
              completionTokens: Math.ceil(answer.length / 4),
              totalTokens: Math.ceil((promptChars + answer.length) / 4),
            }
          : undefined,
      };
    }
  }

  private buildAnswer(question: string, sources: ParsedSource[]): string {
    if (sources.length === 0) return 'Not supported by the selected tabs.';

    const wantsComparison = /compare|difference|differ|versus|vs\.?|price|cost|cheaper|expensive/i.test(question);
    const lines: string[] = [
      wantsComparison
        ? `Comparison across ${sources.length} selected source${sources.length === 1 ? '' : 's'}:`
        : 'Based on the selected tabs:',
    ];

    const used = wantsComparison ? sources : sources.slice(0, Math.min(2, sources.length));
    for (const source of used) {
      const snippet = firstSentences(source.text, 240);
      lines.push(`- [${source.id}] ${source.title} (${source.url}): ${snippet} [${source.id}]`);
    }

    return lines.join('\n');
  }
}
