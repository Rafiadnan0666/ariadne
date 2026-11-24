import { estimateTokens, normalizeWhitespace } from './extraction';
import type { ContextChunk, ContextItem } from './types';

export interface ChunkOptions {
  /** Words per chunk. */
  maxWords?: number;
  /** Overlap in words between consecutive chunks. */
  overlapWords?: number;
  /** Hard cap on chunks per page. */
  maxChunks?: number;
  /** Hard cap on characters per chunk. */
  maxCharsPerChunk?: number;
}

export const DEFAULT_CHUNK_OPTIONS: Required<ChunkOptions> = {
  maxWords: 180,
  overlapWords: 40,
  maxChunks: 120,
  maxCharsPerChunk: 1400,
};

function truncateAtWord(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/**
 * Chunk readable page text with overlap and attach the nearest heading as a
 * section label. Deterministic and provider-free.
 */
export function chunkItem(item: ContextItem, options: ChunkOptions = {}): ContextChunk[] {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  const text = normalizeWhitespace(item.text);
  const chunks: ContextChunk[] = [];

  const pushChunk = (raw: string, section: string | undefined, selected = false): void => {
    const value = truncateAtWord(normalizeWhitespace(raw), opts.maxCharsPerChunk);
    if (value.length < 20) return;
    const index = chunks.length;
    chunks.push({
      id: `${item.id}:${index}`,
      itemId: item.id,
      tabId: item.tabId,
      url: item.url,
      title: item.title,
      text: value,
      chunkIndex: index,
      charCount: value.length,
      approxTokens: estimateTokens(value),
      isPrivate: item.isPrivate,
      section,
      selected,
      compressed: item.compressed,
    });
  };

  // The user's explicit selection is always its own, first-class chunk.
  if (item.selectedText && item.selectedText.trim().length > 0) {
    pushChunk(item.selectedText, 'User selection', true);
  }

  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return chunks;

  const step = Math.max(1, opts.maxWords - opts.overlapWords);
  let section: string | undefined;

  for (let start = 0; start < words.length && chunks.length < opts.maxChunks; start += step) {
    const slice = words.slice(start, start + opts.maxWords);
    if (slice.length === 0) break;
    const raw = slice.join(' ');

    // Section attribution: last heading whose text appears in this chunk.
    for (const heading of item.headings) {
      if (heading.text.length >= 3 && raw.includes(heading.text)) {
        section = heading.text;
      }
    }

    pushChunk(raw, section);
    if (start + opts.maxWords >= words.length) break;
  }

  return chunks;
}
