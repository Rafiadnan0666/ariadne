import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SessionContextManager, type PageInput } from '../src/context/manager';
import {
  hashText,
  isExcludedHost,
  normalizeUrl,
  redactSecrets,
  resolveSelectionTabs,
} from '../src/context/extraction';
import { findDuplicate } from '../src/context/dedupe';
import { chunkItem } from '../src/context/chunking';
import { rankChunks, queryTerms } from '../src/context/ranking';
import { askWithPreview, buildPromptPreview, unsupportedAnswer } from '../src/context/qa';
import type { ContextItem, ContextProvider, TabInfo } from '../src/context/types';

function page(tabId: string, url: string, title: string, text: string, extra: Partial<PageInput> = {}): PageInput {
  return {
    tabId,
    url,
    title,
    text,
    headings: [{ level: 1, text: title }],
    metadata: { description: `${title} description` },
    ...extra,
  };
}

function itemFor(input: PageInput): ContextItem {
  const now = Date.now();
  return {
    id: `${input.tabId}:x`,
    tabId: input.tabId,
    url: input.url,
    title: input.title,
    text: input.text,
    selectedText: input.selectedText,
    headings: input.headings || [],
    links: [],
    metadata: { wordCount: input.text.split(/\s+/).length, charCount: input.text.length },
    sources: [{ tabId: input.tabId, url: input.url, title: input.title }],
    contentHash: hashText(input.text),
    extractedAt: now,
    lastAccessedAt: now,
    isPrivate: false,
    approxBytes: input.text.length,
    approxTokens: Math.ceil(input.text.length / 4),
  };
}

const PRICE_TEXT = [
  'The Ariadne Widget costs 42 dollars and ships in two days.',
  'It includes a one year warranty and a rechargeable battery.',
  'Customer reviews mention the bright display and quiet keyboard.',
].join(' ');

const DOC_V1_TEXT = [
  'Version one of the deployment guide requires Node 18 and the legacy configuration format.',
  'The service starts with the command npm run start:legacy.',
].join(' ');

const DOC_V2_TEXT = [
  'Version two of the deployment guide requires Node 22 and the new JSON configuration format.',
  'The service starts with the command npm run start.',
].join(' ');

const ARTICLE_TEXT = [
  'Migratory birds navigate using the Earth magnetic field and visual landmarks.',
  'Researchers tracked Arctic terns across a 70,000 kilometre annual migration.',
].join(' ');

const PRODUCT_B_TEXT = [
  'The competing Beacon Widget costs 55 dollars and ships overnight.',
  'Its warranty lasts six months and the battery is not replaceable.',
].join(' ');

test('URL normalization strips fragments and tracking parameters', () => {
  assert.equal(
    normalizeUrl('https://Example.com/path/?utm_source=x&q=1#section'),
    'https://example.com/path?q=1'
  );
});

test('exclusions support exact hosts, subdomains and globs', () => {
  assert.equal(isExcludedHost('example.com', ['example.com']), true);
  assert.equal(isExcludedHost('docs.example.com', ['.example.com']), true);
  assert.equal(isExcludedHost('news.example.com', ['*.example.com']), true);
  assert.equal(isExcludedHost('notexample.com', ['example.com']), false);
});

test('secret-shaped strings are redacted from extracted text', () => {
  const redacted = redactSecrets('token=abcdef123456 password=hunter2 eyJabcdefghij.klmnopqrst.uvwxyzabcd');
  assert.ok(!redacted.includes('hunter2'));
  assert.ok(!redacted.includes('abcdef123456'));
  assert.ok(redacted.includes('[REDACTED'));
});

test('selection modes resolve current, selected and all tabs', () => {
  const tabs: TabInfo[] = [
    { id: '1', url: 'https://a.example', title: 'A', active: true },
    { id: '2', url: 'https://b.example', title: 'B' },
    { id: '3', url: 'about:blank', title: 'Blank' },
  ];
  assert.deepEqual(resolveSelectionTabs(tabs, { mode: 'current', tabIds: [] }).map((t) => t.id), ['1']);
  assert.deepEqual(resolveSelectionTabs(tabs, { mode: 'selected', tabIds: ['2', '2', '3'] }).map((t) => t.id), ['2', '3']);
  assert.deepEqual(resolveSelectionTabs(tabs, { mode: 'all', tabIds: [] }).map((t) => t.id), ['1', '2']);
});

test('chunking keeps user selection first and labels headings', () => {
  const item = itemFor(page('1', 'https://a.example', 'Ariadne Widget', PRICE_TEXT, { selectedText: 'The selected price is 42 dollars.' }));
  const chunks = chunkItem(item);
  assert.ok(chunks.length >= 1);
  assert.equal(chunks[0].selected, true);
  assert.ok(chunks.some((chunk) => chunk.section === 'Ariadne Widget'));
});

test('dedupe detects exact URL and near-duplicate content', () => {
  const a = itemFor(page('1', 'https://a.example/doc', 'Deployment guide', DOC_V1_TEXT));
  const exact = findDuplicate([a], { url: a.url, title: a.title, text: a.text, contentHash: a.contentHash });
  assert.equal(exact?.kind, 'exact-url');

  const b = itemFor(page('2', 'https://b.example/doc-copy', 'Deployment guide copy', `${DOC_V1_TEXT} Extra trailing sentence.`));
  const near = findDuplicate([a], b, 0.5);
  assert.equal(near?.kind, 'near-duplicate');
});

test('manager dedupes, tracks sources and never re-chunks an unchanged page', () => {
  const manager = new SessionContextManager();
  const first = manager.upsertPage(page('1', 'https://shop.example/widget', 'Ariadne Widget', PRICE_TEXT));
  assert.ok(first && !first.skipped);
  const chunkCount = manager.stats().chunks;

  const again = manager.upsertPage(page('1', 'https://shop.example/widget', 'Ariadne Widget', PRICE_TEXT));
  assert.equal(again?.skipped, true);
  assert.equal(again?.reason, 'unchanged');
  assert.equal(manager.stats().chunks, chunkCount);

  const copy = manager.upsertPage(page('2', 'https://mirror.example/widget', 'Ariadne Widget', `${PRICE_TEXT} Prices verified today.`));
  assert.equal(copy?.skipped, true);
  assert.equal(copy?.duplicateKind, 'near-duplicate');
  assert.equal(manager.stats().items, 1);
  const item = manager.listItems()[0];
  assert.equal(item.sources.length, 2);
  assert.deepEqual(item.sources.map((source) => source.tabId).sort(), ['1', '2']);
});

test('changed page replaces the old extraction for that tab', () => {
  const manager = new SessionContextManager();
  manager.upsertPage(page('1', 'https://docs.example/guide', 'Guide v1', DOC_V1_TEXT));
  manager.upsertPage(page('1', 'https://docs.example/guide', 'Guide v2', DOC_V2_TEXT));
  assert.equal(manager.stats().items, 1);
  assert.ok(manager.listItems()[0].text.includes('Version two'));
});

test('retrieval returns the right chunk and source URL', () => {
  const manager = new SessionContextManager();
  manager.upsertPage(page('1', 'https://shop.example/widget', 'Ariadne Widget', PRICE_TEXT));
  manager.upsertPage(page('2', 'https://docs.example/guide', 'Deployment guide', DOC_V1_TEXT));
  manager.upsertPage(page('3', 'https://nature.example/birds', 'Bird migration', ARTICLE_TEXT));

  const result = manager.retrieve('How much does the Ariadne Widget cost?', { maxChunks: 3 });
  assert.ok(result.hits.length > 0);
  assert.equal(result.hits[0].chunk.tabId, '1');
  assert.equal(result.hits[0].chunk.url, 'https://shop.example/widget');
  assert.ok(result.hits[0].matchedTerms.length > 0);
});

test('ensurePerTab keeps every selected tab represented for comparisons', () => {
  const manager = new SessionContextManager();
  manager.upsertPage(page('1', 'https://shop.example/widget', 'Ariadne Widget', PRICE_TEXT));
  manager.upsertPage(page('2', 'https://shop.example/beacon', 'Beacon Widget', PRODUCT_B_TEXT));
  const result = manager.retrieve('Which widget is cheaper?', { tabIds: ['1', '2'], maxChunks: 4, ensurePerTab: true });
  const tabs = new Set(result.hits.map((hit) => hit.chunk.tabId));
  assert.ok(tabs.has('1'));
  assert.ok(tabs.has('2'));
});

test('bounds evict items, chunks and characters', () => {
  const manager = new SessionContextManager({ maxItems: 2, maxChunks: 4, maxTotalChars: 2000 });
  for (let i = 1; i <= 6; i++) {
    manager.upsertPage(page(String(i), `https://site${i}.example/page`, `Page ${i}`, `Unique content number ${i} `.repeat(80)));
  }
  const stats = manager.stats();
  assert.ok(stats.items <= 2, `items=${stats.items}`);
  assert.ok(stats.chunks <= 4, `chunks=${stats.chunks}`);
  assert.ok(stats.chars <= 2000, `chars=${stats.chars}`);
});

test('excluded hosts are never extracted into context', () => {
  const manager = new SessionContextManager();
  manager.setExclusions(['secret.example']);
  assert.equal(manager.upsertPage(page('1', 'https://secret.example/page', 'Secret', PRICE_TEXT)), null);
  assert.equal(manager.stats().items, 0);
});

test('private context is never persisted and is wiped on session end', () => {
  const saved: string[] = [];
  const manager = new SessionContextManager({}, {
    saveItem: (item) => { saved.push(item.id); },
    deleteItem: () => undefined,
    clear: () => undefined,
  });

  manager.upsertPage(page('1', 'https://public.example/page', 'Public', PRICE_TEXT));
  manager.upsertPage(page('2', 'https://private.example/page', 'Private', DOC_V1_TEXT, { isPrivate: true }));

  assert.equal(manager.stats().items, 2);
  assert.equal(manager.stats().privateItems, 1);
  assert.equal(saved.length, 1, 'only the public item is persisted');

  const removed = manager.clearPrivate();
  assert.equal(removed, 1);
  assert.equal(manager.stats().items, 1);
  assert.equal(manager.stats().privateItems, 0);
  assert.ok(manager.listItems().every((item) => !item.isPrivate));
});

test('older context is compressed extractively', () => {
  const manager = new SessionContextManager({ compressAfterMs: 0, maxCompressedChars: 120 });
  manager.upsertPage(page('1', 'https://long.example/article', 'Long article', `${ARTICLE_TEXT} ${DOC_V1_TEXT} ${PRICE_TEXT}`));
  const before = manager.listItems()[0].text.length;
  const compressed = manager.compressOlderContext(0);
  assert.equal(compressed, 1);
  const item = manager.listItems()[0];
  assert.equal(item.compressed, true);
  assert.ok(item.text.length < before);
  assert.ok(item.text.length <= 120);
});

test('QA preview shows exactly what is sent, including source URLs', () => {
  const manager = new SessionContextManager();
  manager.upsertPage(page('1', 'https://shop.example/widget', 'Ariadne Widget', PRICE_TEXT));
  const retrieval = manager.retrieve('What does the Ariadne Widget cost?', { maxChunks: 2 });
  const provider = fakeProvider((request) => {
    const source = request.messages[1].content.match(/\[S1\][^\n]*\nURL: ([^\n]+)/);
    return `It costs 42 dollars [S1]. (source: ${source?.[1] || 'unknown'})`;
  });

  const preview = buildPromptPreview('What does the Ariadne Widget cost?', retrieval, provider);
  assert.equal(preview.sources.length, 1);
  assert.ok(preview.userPrompt.includes('https://shop.example/widget'));
  assert.ok(preview.systemPrompt.includes('Every factual claim must cite'));
  assert.ok(preview.approxInputTokens > 0);
  assert.equal(preview.isTestOnlyProvider, true);
});

test('QA refuses to send if the preview payload changed', async () => {
  const manager = new SessionContextManager();
  manager.upsertPage(page('1', 'https://shop.example/widget', 'Ariadne Widget', PRICE_TEXT));
  const retrieval = manager.retrieve('price', { maxChunks: 2 });
  const provider = fakeProvider(() => 'It costs 42 dollars [S1].');
  const preview = buildPromptPreview('price', retrieval, provider);
  await assert.rejects(() => askWithPreview(preview, provider, 'wrong-hash'), /changed since preview/);
});

test('QA returns cited answers with tab/URL source tracking', async () => {
  const manager = new SessionContextManager();
  manager.upsertPage(page('1', 'https://shop.example/widget', 'Ariadne Widget', PRICE_TEXT));
  manager.upsertPage(page('2', 'https://shop.example/beacon', 'Beacon Widget', PRODUCT_B_TEXT));
  const retrieval = manager.retrieve('compare widget prices', { tabIds: ['1', '2'], maxChunks: 4, ensurePerTab: true });
  const provider = fakeProvider((request) => {
    const ids = Array.from(new Set(Array.from(request.messages[1].content.matchAll(/\[S\d+\]/g)).map((m) => m[0])));
    return `The Ariadne Widget costs 42 dollars ${ids[0] || '[S1]'} and the Beacon Widget costs 55 dollars ${ids[1] || ids[0] || '[S1]'}.`;
  });
  const preview = buildPromptPreview('compare widget prices', retrieval, provider);
  const answer = await askWithPreview(preview, provider, preview.payloadHash);
  assert.equal(answer.supported, true);
  assert.ok(answer.citations.length >= 1);
  assert.ok(answer.citations.every((citation) => citation.url.startsWith('https://')));
  assert.ok(answer.citations.some((citation) => citation.url.includes('widget')));
});

test('QA flags uncited model output as unsupported', async () => {
  const manager = new SessionContextManager();
  manager.upsertPage(page('1', 'https://shop.example/widget', 'Ariadne Widget', PRICE_TEXT));
  const retrieval = manager.retrieve('price', { maxChunks: 2 });
  const provider = fakeProvider(() => 'The price is 42 dollars.');
  const preview = buildPromptPreview('price', retrieval, provider);
  const answer = await askWithPreview(preview, provider, preview.payloadHash);
  assert.equal(answer.supported, false);
  assert.match(answer.warning || '', /without citing/);
});

test('QA with no retrieved context refuses to guess', () => {
  const manager = new SessionContextManager();
  const retrieval = manager.retrieve('unanswerable', { maxChunks: 3 });
  const answer = unsupportedAnswer('unanswerable', retrieval, fakeProvider(() => 'nope'));
  assert.equal(answer.supported, false);
  assert.match(answer.answer, /Not supported/);
  assert.equal(answer.citations.length, 0);
});

test('ranking ignores stopword-only queries but still returns chunks', () => {
  const manager = new SessionContextManager();
  manager.upsertPage(page('1', 'https://a.example', 'A', PRICE_TEXT));
  const result = manager.retrieve('what is the', { maxChunks: 2 });
  assert.ok(result.totalChunks > 0);
  assert.equal(queryTerms('what is the').length, 0);
});

test('BM25 ranking is deterministic and prefers exact term matches', () => {
  const manager = new SessionContextManager();
  manager.upsertPage(page('1', 'https://a.example', 'A', ARTICLE_TEXT));
  manager.upsertPage(page('2', 'https://b.example', 'B', PRICE_TEXT));
  const first = manager.retrieve('rechargeable battery', { maxChunks: 3 });
  const second = manager.retrieve('rechargeable battery', { maxChunks: 3 });
  assert.deepEqual(first.hits.map((h) => h.chunk.id), second.hits.map((h) => h.chunk.id));
  assert.equal(first.hits[0].chunk.tabId, '2');
  assert.ok(rankChunks('battery', manager.listChunks(), { maxChunks: 2 }).hits.length > 0);
});

function fakeProvider(reply: (request: { messages: Array<{ role: string; content: string }> }) => string): ContextProvider {
  return {
    id: 'test-only-fake',
    name: 'TEST-ONLY FAKE PROVIDER (no network)',
    isLocal: true,
    isTestOnly: true,
    async chat(request) {
      return {
        text: reply(request as { messages: Array<{ role: string; content: string }> }),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    },
  };
}
