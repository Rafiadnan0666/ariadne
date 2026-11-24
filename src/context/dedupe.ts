import { hostOf, normalizeUrl, normalizeWhitespace } from './extraction';
import type { ContextItem } from './types';

const SHINGLE_SIZE = 5;
const MAX_SHINGLES = 600;

function words(text: string): string[] {
  return normalizeWhitespace(text)
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

/** Set of word n-grams, capped for predictable cost. */
export function shingles(text: string, size = SHINGLE_SIZE): Set<string> {
  const tokens = words(text);
  const set = new Set<string>();
  if (tokens.length < size) {
    if (tokens.length) set.add(tokens.join(' '));
    return set;
  }
  for (let i = 0; i + size <= tokens.length && set.size < MAX_SHINGLES; i++) {
    set.add(tokens.slice(i, i + size).join(' '));
  }
  return set;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const value of small) {
    if (large.has(value)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

export function titleSimilarity(a: string, b: string): number {
  // Word-level Jaccard handles short titles ("Deployment guide" vs "... copy")
  // where 3-word shingles would otherwise collapse to a single shingle.
  return jaccard(new Set(words(a)), new Set(words(b)));
}

export interface DuplicateMatch {
  item: ContextItem;
  kind: 'exact-url' | 'exact-content' | 'near-duplicate';
  similarity: number;
}

/**
 * Detect same-page and near-duplicate content. Exact matches use normalized URL
 * or content hash; near-duplicates use 5-word shingle Jaccard similarity.
 */
export function findDuplicate(
  items: readonly ContextItem[],
  candidate: Pick<ContextItem, 'url' | 'title' | 'text' | 'contentHash'>,
  nearThreshold = 0.82
): DuplicateMatch | null {
  const url = normalizeUrl(candidate.url);
  const host = hostOf(candidate.url);

  for (const item of items) {
    if (normalizeUrl(item.url) === url) {
      return { item, kind: 'exact-url', similarity: 1 };
    }
    if (item.contentHash && item.contentHash === candidate.contentHash) {
      return { item, kind: 'exact-content', similarity: 1 };
    }
  }

  const candidateShingles = shingles(candidate.text);
  let best: DuplicateMatch | null = null;

  for (const item of items) {
    const sameHost = hostOf(item.url) === host;
    const similarTitle = titleSimilarity(item.title, candidate.title) >= 0.5;
    // Cheap gate before the expensive text comparison.
    if (!sameHost && !similarTitle) continue;

    const similarity = jaccard(candidateShingles, shingles(item.text));
    if (similarity >= nearThreshold && (!best || similarity > best.similarity)) {
      best = { item, kind: 'near-duplicate', similarity };
    }
  }

  return best;
}
