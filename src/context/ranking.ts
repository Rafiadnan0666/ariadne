import type { ContextChunk, RetrievalOptions, RetrievalResult, ScoredChunk } from './types';

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'how', 'i',
  'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'was', 'were',
  'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'you', 'your', 'about', 'into',
  'can', 'could', 'should', 'would', 'do', 'does', 'did', 'not', 'but', 'if', 'then', 'than',
  'these', 'those', 'there', 'here', 'me', 'my', 'we', 'our', 'us', 'they', 'them', 'he', 'she',
]);

function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map(stem);
}

export function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const token of tokenize(query)) {
    if (STOPWORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    terms.push(token);
  }
  return terms;
}

function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
  return tf;
}

const K1 = 1.2;
const B = 0.75;

/**
 * BM25-lite ranking over chunks. Local, deterministic, no embeddings/model
 * downloads. Optional embeddings can be layered later via cosine similarity.
 */
export function rankChunks(
  query: string,
  chunks: readonly ContextChunk[],
  options: RetrievalOptions = {}
): RetrievalResult {
  const maxChunks = options.maxChunks ?? 10;
  const filtered = options.tabIds && options.tabIds.length > 0
    ? chunks.filter((c) => options.tabIds!.includes(c.tabId))
    : chunks.slice();
  const visible = options.includePrivate ? filtered : filtered.filter((c) => !c.isPrivate);

  if (visible.length === 0) {
    return { query, hits: [], totalChunks: 0, matchedTabs: [] };
  }

  const terms = queryTerms(query);
  const tokenized = visible.map((chunk) => tokenize(chunk.text));
  const avgLen = tokenized.reduce((sum, tokens) => sum + tokens.length, 0) / visible.length || 1;

  const docFreq = new Map<string, number>();
  for (const tokens of tokenized) {
    const unique = new Set(tokens);
    for (const term of terms) {
      if (unique.has(term)) docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
  }

  const normalizedQuery = query.toLowerCase().replace(/\s+/g, ' ').trim();
  const scored: ScoredChunk[] = visible.map((chunk, index) => {
    const tokens = tokenized[index];
    const tf = termFrequency(tokens);
    let score = 0;
    const matched: string[] = [];

    for (const term of terms) {
      const freq = tf.get(term) || 0;
      if (freq === 0) continue;
      const df = docFreq.get(term) || 0;
      const idf = Math.log(1 + (visible.length - df + 0.5) / (df + 0.5));
      const lengthNorm = K1 * (1 - B + (B * tokens.length) / avgLen);
      score += idf * ((freq * (K1 + 1)) / (freq + lengthNorm));
      matched.push(term);
    }

    if (normalizedQuery.length > 3 && chunk.text.toLowerCase().includes(normalizedQuery)) {
      score += 2;
    }
    if (chunk.selected) score += 1.5;
    if (chunk.compressed) score *= 0.6;
    // Tiny term-presence nudge so comparison questions surface each tab.
    if (matched.length > 0) score += matched.length * 0.05;

    return { chunk, score, matchedTerms: matched };
  });

  scored.sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex);

  const hits = scored.filter((s) => s.score > 0).slice(0, maxChunks);
  const usedIds = new Set(hits.map((h) => h.chunk.id));

  if (options.ensurePerTab) {
    const requestedTabs = options.tabIds && options.tabIds.length > 0
      ? options.tabIds
      : Array.from(new Set(visible.map((c) => c.tabId)));

    for (const tabId of requestedTabs) {
      if (hits.length >= maxChunks) break;
      if (hits.some((h) => h.chunk.tabId === tabId)) continue;
      const candidate = scored.find((s) => s.chunk.tabId === tabId && !usedIds.has(s.chunk.id));
      if (candidate) {
        hits.push(candidate);
        usedIds.add(candidate.chunk.id);
      }
    }
  }

  // Ensure a stable, budget-bounded result set.
  hits.sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex);

  return {
    query,
    hits: hits.slice(0, maxChunks),
    totalChunks: visible.length,
    matchedTabs: Array.from(new Set(hits.filter((h) => h.score > 0).map((h) => h.chunk.tabId))),
  };
}

/** Exposed for tests. */
export const __rankingInternals = { stem, STOPWORDS };
