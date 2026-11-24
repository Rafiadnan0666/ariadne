import { createHash } from 'crypto';
import type { ContextSelection, TabInfo } from './types';

/** Rough token estimate: ~4 chars/token for English prose. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateBytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const TRACKING_PARAMS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^mc_cid$/i,
  /^mc_eid$/i,
  /^ref$/i,
  /^ref_src$/i,
  /^igshid$/i,
  /^spm$/i,
];

/** Stable URL identity for caching/dedupe: no fragment, no tracking params. */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    const keep: string[] = [];
    for (const [k, v] of u.searchParams.entries()) {
      if (!TRACKING_PARAMS.some((re) => re.test(k))) keep.push(`${k}=${v}`);
    }
    u.search = keep.length ? `?${keep.join('&')}` : '';
    if (u.pathname !== '/' && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '');
    }
    return u.toString();
  } catch {
    return raw.trim();
  }
}

export function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isExtractableUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Redact credential-shaped strings from readable page text. This is defense in
 * depth: the extractor never reads form field values or cookies, but pages may
 * still render tokens in text.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9]{16,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\bghp_[A-Za-z0-9]{20,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_API_KEY]')
    .replace(/\b(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .replace(/\bCookie:\s*[^\n]+/gi, 'Cookie: [REDACTED]')
    .replace(/\bSet-Cookie:\s*[^\n]+/gi, 'Set-Cookie: [REDACTED]');
}

/** True when a host matches any user exclusion (exact, subdomain or glob). */
export function isExcludedHost(host: string, exclusions: readonly string[]): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  for (const raw of exclusions) {
    const pattern = raw.trim().toLowerCase();
    if (!pattern) continue;
    if (pattern === h) return true;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2);
      if (h === suffix || h.endsWith(`.${suffix}`)) return true;
    }
    if (pattern.startsWith('.') && (h === pattern.slice(1) || h.endsWith(pattern))) return true;
    if (pattern.includes('*')) {
      const re = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`);
      if (re.test(h)) return true;
    }
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve a selection mode into concrete tabs. `current` requires an active
 * tab; `selected` uses the explicit id list; `all` includes every tab.
 */
export function resolveSelectionTabs(tabs: TabInfo[], selection: ContextSelection): TabInfo[] {
  const byId = new Map(tabs.map((t) => [t.id, t]));
  if (selection.mode === 'current') {
    const active = tabs.find((t) => t.active) || tabs[0];
    return active ? [active] : [];
  }
  if (selection.mode === 'selected') {
    const seen = new Set<string>();
    const result: TabInfo[] = [];
    for (const id of selection.tabIds) {
      const tab = byId.get(id);
      if (tab && !seen.has(id)) {
        seen.add(id);
        result.push(tab);
      }
    }
    return result;
  }
  return tabs.filter((t) => isExtractableUrl(t.url));
}

export function approxItemSize(text: string, selectedText?: string): { approxBytes: number; approxTokens: number } {
  const combined = `${text}\n${selectedText || ''}`;
  return { approxBytes: estimateBytes(combined), approxTokens: estimateTokens(combined) };
}
