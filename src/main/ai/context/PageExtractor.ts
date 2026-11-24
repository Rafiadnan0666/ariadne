import { BrowserWindow, session, webContents } from 'electron';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

function isExtractableUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isExcludedHost(host: string, excludedHosts: readonly string[]): boolean {
  return excludedHosts.some(e => host === e || host.endsWith('.' + e));
}

function redactSecrets(value: string): string {
  // Redact common secret patterns
  return value
    .replace(/[A-Za-z0-9+/]{40,}/g, '[REDACTED]')  // base64-like strings
    .replace(/sk-[A-Za-z0-9]{20,}/g, '[REDACTED]')  // OpenAI keys
    .replace(/xoxb-[A-Za-z0-9-]{10,}/g, '[REDACTED]')  // Slack tokens
    .replace(/Bearer\s+[A-Za-z0-9._-]{20,}/gi, 'Bearer [REDACTED]')
    .replace(/"(?:password|secret|token|api[_-]?key)"\s*:\s*"[^"]*"/gi, '"$1": "[REDACTED]"')
    .replace(/'(?:password|secret|token|api[_-]?key)'\s*:\s*'[^']*'/gi, "'$1': '[REDACTED]'");
}

export interface ExtractedHeading {
  level: number;
  text: string;
}

export interface ExtractedLink {
  url: string;
  text: string;
  title?: string;
}

export interface ExtractedAccessibility {
  language?: string;
  landmarkCount?: number;
  imagesTotal?: number;
  imagesWithAlt?: number;
  headingCount?: number;
  hasSelection?: boolean;
}

export interface ExtractedPage {
  url: string;
  title: string;
  readableText: string;
  selectedText?: string;
  headings: ExtractedHeading[];
  metadata: Record<string, string>;
  links: ExtractedLink[];
  accessibility?: ExtractedAccessibility;
  timestamp: number;
  tabId: string;
  isPrivate: boolean;
  extractionMs?: number;
}

export interface ExtractOptions {
  /** Use an ephemeral in-memory session and never persist anything. */
  isPrivate?: boolean;
  /** Refuse to load hosts the user excluded. */
  excludedHosts?: readonly string[];
  timeoutMs?: number;
  /** Extra time for client-rendered pages after did-finish-load. */
  settleMs?: number;
  /** Session partition used for non-private extraction (defaults to the app session). */
  partition?: string;
}

export interface ScreenshotResult {
  dataUrl: string;
  url: string;
  title: string;
  width: number;
  height: number;
  isPrivate: boolean;
  timestamp: number;
}

interface TabInfo {
  id: string;
  webContentsId: number;
  url: string;
  title: string;
  isPrivate: boolean;
}

interface RawExtraction {
  url?: string;
  title?: string;
  readableText?: string;
  selectedText?: string;
  headings?: unknown;
  metadata?: unknown;
  links?: unknown;
  accessibility?: unknown;
  timestamp?: number;
  error?: string;
}

const MAX_TEXT_LENGTH = 50000;
const MAX_SELECTED_LENGTH = 20000;
const MAX_HEADINGS = 200;
const MAX_LINKS = 150;
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_SETTLE_MS = 500;
const APP_PARTITION = 'persist:ariadne';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return raw;
  }
}

function redactText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return redactSecrets(value).slice(0, maxLength);
}

/**
 * Extracts readable page content for the cross-tab context pipeline.
 *
 * Two paths exist:
 * - `extractPage(tabId)` for a live, registered webContents (Session B's IPC)
 * - `extractFromUrl(url)` for tabs that are not currently mounted. It loads the
 *   URL in a hidden, sandboxed BrowserWindow with no preload and no node
 *   integration, then runs the extraction script in that isolated page.
 *
 * Private extraction uses a fresh in-memory partition and clears it afterwards.
 * Screenshots are captured only through the explicit `captureScreenshot` call.
 */
export class PageExtractor {
  private extractionScript = '';
  private tabMap = new Map<string, TabInfo>();
  private mainWindow: BrowserWindow | null = null;
  private activeExtractions = 0;
  private maxConcurrent = 3;
  private queue: Array<() => void> = [];
  private hiddenWindows = new Set<BrowserWindow>();

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  registerTab(tabId: string, webContentsId: number, url: string, title: string, isPrivate: boolean): void {
    this.tabMap.set(tabId, { id: tabId, webContentsId, url, title, isPrivate });
  }

  unregisterTab(tabId: string): void {
    this.tabMap.delete(tabId);
  }

  updateTab(tabId: string, url: string, title: string): void {
    const tab = this.tabMap.get(tabId);
    if (tab) {
      tab.url = url;
      tab.title = title;
    }
  }

  /** Extract a registered live tab. Private tabs are refused per the AI contract. */
  async extractPage(tabId: string): Promise<ExtractedPage | null> {
    const tab = this.tabMap.get(tabId);
    if (!tab) {
      console.warn(`[PageExtractor] Tab ${tabId} not found`);
      return null;
    }

    if (tab.isPrivate) {
      console.log(`[PageExtractor] Skipping private live tab ${tabId}`);
      return null;
    }

    const contents = webContents.fromId(tab.webContentsId);
    if (!contents || contents.isDestroyed()) {
      console.warn(`[PageExtractor] WebContents for tab ${tabId} not found or destroyed`);
      return null;
    }

    try {
      const started = Date.now();
      const page = await this.extractFromContents(contents, tab.url, tabId, false);
      if (page) page.extractionMs = Date.now() - started;
      return page;
    } catch (error) {
      console.error(`[PageExtractor] Failed to extract page for tab ${tabId}:`, error);
      return null;
    }
  }

  async extractMultiplePages(tabIds: string[]): Promise<ExtractedPage[]> {
    const results: ExtractedPage[] = [];
    for (const tabId of tabIds) {
      const page = await this.extractPage(tabId);
      if (page) results.push(page);
    }
    return results;
  }

  /**
   * Load a URL in an isolated hidden window and extract it. This is how tabs
   * that are not currently mounted in the single-webview shell are handled.
   */
  async extractFromUrl(rawUrl: string, options: ExtractOptions = {}): Promise<ExtractedPage | null> {
    if (!isExtractableUrl(rawUrl)) {
      console.warn(`[PageExtractor] Refusing non-http(s) URL: ${rawUrl}`);
      return null;
    }
    const url = sanitizeUrl(rawUrl);
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      return null;
    }
    if (options.excludedHosts && isExcludedHost(host, options.excludedHosts)) {
      console.log(`[PageExtractor] Host excluded by user: ${host}`);
      return null;
    }

    const started = Date.now();
    const tabId = `url:${host}`;
    return this.withHiddenWindow(url, options, async (contents) => {
      const page = await this.extractFromContents(contents, url, tabId, options.isPrivate === true);
      if (page) page.extractionMs = Date.now() - started;
      return page;
    });
  }

  /**
   * Explicit screenshot capture. Never called by the extraction pipeline; the
   * renderer must ask for it directly. Returns a data URL held in memory only.
   */
  async captureScreenshot(rawUrl: string, options: ExtractOptions = {}): Promise<ScreenshotResult | null> {
    if (!isExtractableUrl(rawUrl)) return null;
    const url = sanitizeUrl(rawUrl);
    return this.withHiddenWindow(url, options, async (contents) => {
      const image = await contents.capturePage();
      const size = image.getSize();
      return {
        dataUrl: image.toDataURL(),
        url: contents.getURL() || url,
        title: contents.getTitle(),
        width: size.width,
        height: size.height,
        isPrivate: options.isPrivate === true,
        timestamp: Date.now(),
      };
    });
  }

  getTabsContext(tabIds: string[]): string {
    const contexts: string[] = [];
    for (const tabId of tabIds) {
      const tab = this.tabMap.get(tabId);
      if (!tab || tab.isPrivate) continue;
      contexts.push(`[Tab: ${tab.title}] ${tab.url}`);
    }
    return contexts.join('\n');
  }

  getAllTabIds(): string[] {
    return Array.from(this.tabMap.keys()).filter((id) => !this.tabMap.get(id)?.isPrivate);
  }

  dispose(): void {
    for (const win of Array.from(this.hiddenWindows)) {
      if (!win.isDestroyed()) win.destroy();
    }
    this.hiddenWindows.clear();
  }

  private async extractFromContents(
    contents: Electron.WebContents,
    fallbackUrl: string,
    tabId: string,
    isPrivate: boolean
  ): Promise<ExtractedPage | null> {
    if (contents.isDestroyed()) return null;
    const script = this.getExtractionScript();
    const raw = await contents.executeJavaScript(script, true);
    const parsed = this.parseRaw(raw);
    if (!parsed) return null;

    if (parsed.error) {
      console.warn(`[PageExtractor] Page script error: ${parsed.error}`);
    }

    const readableText = redactText(parsed.readableText, MAX_TEXT_LENGTH);
    const selectedText = parsed.selectedText
      ? redactText(parsed.selectedText, MAX_SELECTED_LENGTH) || undefined
      : undefined;

    if (readableText.length < 100 && !selectedText) {
      console.log(`[PageExtractor] Insufficient readable content (${readableText.length} chars)`);
      return null;
    }

    const title = redactText(parsed.title, 500) || fallbackUrl;
    const finalUrl = sanitizeUrl(contents.getURL() || parsed.url || fallbackUrl);

    return {
      url: finalUrl,
      title,
      readableText,
      selectedText,
      headings: this.sanitizeHeadings(parsed.headings),
      metadata: this.sanitizeMetadata(parsed.metadata),
      links: this.sanitizeLinks(parsed.links),
      accessibility: this.sanitizeAccessibility(parsed.accessibility),
      timestamp: Date.now(),
      tabId,
      isPrivate,
    };
  }

  private parseRaw(raw: unknown): RawExtraction | null {
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as RawExtraction;
      } catch {
        return null;
      }
    }
    if (raw && typeof raw === 'object') return raw as RawExtraction;
    return null;
  }

  private sanitizeHeadings(value: unknown): ExtractedHeading[] {
    if (!Array.isArray(value)) return [];
    const headings: ExtractedHeading[] = [];
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      const level = Number((entry as { level?: unknown }).level);
      const text = redactText((entry as { text?: unknown }).text, 300).trim();
      if (!text || !Number.isFinite(level)) continue;
      headings.push({ level: Math.min(6, Math.max(1, Math.trunc(level))), text });
      if (headings.length >= MAX_HEADINGS) break;
    }
    return headings;
  }

  private sanitizeMetadata(value: unknown): Record<string, string> {
    const result: Record<string, string> = {};
    if (!value || typeof value !== 'object') return result;
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (typeof raw !== 'string') continue;
      const safeKey = key.slice(0, 100);
      result[safeKey] = redactText(raw, 1000);
      if (Object.keys(result).length >= 60) break;
    }
    return result;
  }

  private sanitizeLinks(value: unknown): ExtractedLink[] {
    if (!Array.isArray(value)) return [];
    const links: ExtractedLink[] = [];
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      const rawUrl = (entry as { url?: unknown }).url;
      const text = redactText((entry as { text?: unknown }).text, 300).trim();
      if (typeof rawUrl !== 'string' || !text || !isExtractableUrl(rawUrl)) continue;
      const title = redactText((entry as { title?: unknown }).title, 300).trim();
      links.push({ url: sanitizeUrl(rawUrl), text, title: title || undefined });
      if (links.length >= MAX_LINKS) break;
    }
    return links;
  }

  private sanitizeAccessibility(value: unknown): ExtractedAccessibility | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const source = value as Record<string, unknown>;
    const number = (key: string): number | undefined => {
      const raw = source[key];
      return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : undefined;
    };
    return {
      language: typeof source.language === 'string' ? source.language.slice(0, 40) : undefined,
      landmarkCount: number('landmarkCount'),
      imagesTotal: number('imagesTotal'),
      imagesWithAlt: number('imagesWithAlt'),
      headingCount: number('headingCount'),
      hasSelection: source.hasSelection === true,
    };
  }

  private getExtractionScript(): string {
    if (this.extractionScript) return this.extractionScript;
    const candidates = [
      path.join(__dirname, 'extraction-script.js'),
      path.join(process.cwd(), 'src', 'main', 'ai', 'context', 'extraction-script.js'),
    ];
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          this.extractionScript = fs.readFileSync(candidate, 'utf-8');
          return this.extractionScript;
        }
      } catch {
        // Try the next candidate.
      }
    }
    throw new Error(
      'Extraction script not found. Run "npm run build:electron" (it copies extraction-script.js into dist).'
    );
  }

  private async acquire(): Promise<void> {
    if (this.activeExtractions < this.maxConcurrent) {
      this.activeExtractions++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.activeExtractions++;
  }

  private release(): void {
    this.activeExtractions = Math.max(0, this.activeExtractions - 1);
    const next = this.queue.shift();
    if (next) next();
  }

  private async withHiddenWindow<T>(
    url: string,
    options: ExtractOptions,
    run: (contents: Electron.WebContents) => Promise<T>
  ): Promise<T> {
    await this.acquire();
    const isPrivate = options.isPrivate === true;
    const partition = isPrivate
      ? `ariadne-private-${randomUUID()}`
      : (options.partition || APP_PARTITION);
    let win: BrowserWindow | null = null;
    try {
      win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 900,
        skipTaskbar: true,
        webPreferences: {
          partition,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webviewTag: false,
          javascript: true,
          images: false,
          spellcheck: false,
          backgroundThrottling: false,
        },
      });
      this.hiddenWindows.add(win);

      const contents = win.webContents;
      const userAgent = contents
        .getUserAgent()
        .replace(/\sElectron\/[\d.]+/g, '')
        .replace(/\sAriadne Browser\/[\d.]+/g, '');
      contents.setUserAgent(userAgent);
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      contents.on('will-attach-webview', (event) => event.preventDefault());
      contents.on('will-navigate', (event, target) => {
        if (!/^https?:/i.test(target)) event.preventDefault();
      });

      await this.loadUrl(contents, url, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      await delay(options.settleMs ?? DEFAULT_SETTLE_MS);
      return await run(contents);
    } finally {
      if (win && !win.isDestroyed()) {
        this.hiddenWindows.delete(win);
        win.destroy();
      }
      if (isPrivate) {
        try {
          const privateSession = session.fromPartition(partition);
          await privateSession.clearStorageData();
          await privateSession.clearCache();
        } catch (error) {
          console.warn('[PageExtractor] Failed to clear private session:', error);
        }
      }
      this.release();
    }
  }

  private loadUrl(contents: Electron.WebContents, url: string, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        contents.removeListener('did-finish-load', onFinish);
        contents.removeListener('did-fail-load', onFail);
        if (error) reject(error);
        else resolve();
      };
      const onFinish = (): void => finish();
      const onFail = (
        _event: Electron.Event,
        code: number,
        description: string,
        _validatedUrl: string,
        isMainFrame: boolean
      ): void => {
        // Redirects can emit ERR_ABORTED for the intermediate URL.
        if (isMainFrame === false || code === -3) return;
        finish(new Error(`Page load failed (${code}): ${description}`));
      };
      const timer = setTimeout(
        () => finish(new Error(`Page load timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
      contents.once('did-finish-load', onFinish);
      contents.on('did-fail-load', onFail);
      contents.loadURL(url).catch((error: unknown) => {
        finish(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }
}

export const pageExtractor = new PageExtractor();
