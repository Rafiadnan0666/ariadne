import { BrowserWindow, webContents, app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition } from './types';
import { pageExtractor } from './context/PageExtractor';

export interface AgentToolContext {
  tabId: string;
  webContentsId: number;
  window: BrowserWindow;
  /** Ask the user (via the renderer) to approve a mutating action. */
  requestApproval?: (toolCall: { id: string; type: 'function'; function: { name: string; arguments: string } }, preview: string) => Promise<boolean>;
}

export interface ToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
  denied?: boolean;
  requiresApproval?: boolean;
  preview?: string;
}

/** Tools that change the page or navigate require explicit user approval. */
export const AGENT_APPROVAL_TOOLS = new Set(['navigate', 'search', 'click', 'type']);

const NAV_TIMEOUT_MS = 30000;
const SCRIPT_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getContents(context: AgentToolContext) {
  const wc = webContents.fromId(context.webContentsId);
  if (!wc || wc.isDestroyed()) return null;
  return wc;
}

async function runScript(wc: Electron.WebContents, body: string): Promise<unknown> {
  const code = `(() => { try { ${body} } catch (e) { return { __error: String(e) }; } })()`;
  return withTimeout(wc.executeJavaScript(code, true), SCRIPT_TIMEOUT_MS, 'Page script');
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Human-readable preview shown in the approval UI. */
export function buildToolPreview(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'navigate':
      return `Navigate to ${String(args.url ?? '')}`;
    case 'search':
      return `Search ${String(args.engine ?? 'google')} for "${String(args.query ?? '')}"`;
    case 'click':
      return args.selector
        ? `Click element ${String(args.selector)}${args.index ? ` [${String(args.index)}]` : ''}`
        : `Click element containing "${String(args.text ?? '')}"`;
    case 'type':
      return `Type into ${String(args.selector ?? 'field')}: "${String(args.text ?? '')}"${
        args.pressEnter ? ' + Enter' : ''
      }`;
    default:
      return toolName;
  }
}

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'navigate',
      description:
        'Navigate the current tab to a URL. Accepts a full URL (https://...) or a plain query, which is turned into a web search. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to, or a search query' },
          engine: {
            type: 'string',
            description: 'Search engine to use when url is a query',
            enum: ['google', 'duckduckgo', 'bing', 'brave', 'startpage', 'wikipedia'],
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search',
      description: 'Search the web using a search engine and load the results page. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          engine: {
            type: 'string',
            description: 'Search engine to use',
            enum: ['google', 'duckduckgo', 'bing', 'brave', 'startpage', 'wikipedia'],
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click',
      description: 'Click an element on the page by CSS selector or visible text. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of element to click' },
          text: { type: 'string', description: 'Alternative: visible text of element to click' },
          index: { type: 'number', description: 'If multiple matches, which index to click (0-based)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type',
      description:
        'Type text into an input, textarea, or contenteditable element. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of input element' },
          text: { type: 'string', description: 'Text to type' },
          clearFirst: { type: 'boolean', description: 'Clear field before typing', default: true },
          pressEnter: { type: 'boolean', description: 'Press Enter after typing', default: false },
        },
        required: ['selector', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scroll',
      description: 'Scroll the page or scroll an element into view. Safe, runs without approval.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'], description: 'Scroll direction' },
          amount: { type: 'number', description: 'Pixels to scroll (for up/down)' },
          selector: { type: 'string', description: 'Scroll to element matching selector' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find',
      description: 'Find text on the page and optionally highlight matches. Returns matching elements. Safe.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to find' },
          highlight: { type: 'boolean', description: 'Highlight all matches', default: true },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'highlight',
      description: 'Highlight elements on the page with a colored overlay. Safe.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of elements to highlight' },
          color: { type: 'string', description: 'Highlight color (hex or rgba)', default: 'rgba(66,133,244,0.3)' },
          label: { type: 'string', description: 'Optional label to show on highlight' },
          duration: { type: 'number', description: 'Duration in ms before auto-remove (0 = permanent)', default: 5000 },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'extract',
      description:
        'Extract readable content from the current page. Use this to read what is on the page. Safe, runs without approval.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector to extract (optional, defaults to full page)' },
          maxChars: { type: 'number', description: 'Maximum characters to return', default: 6000 },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'screenshot',
      description: 'Capture a PNG screenshot of the viewport and save it to disk. Safe.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of element to capture (optional, defaults to viewport)' },
          fullPage: { type: 'boolean', description: 'Capture full page', default: false },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wait',
      description: 'Wait for an element to appear, a navigation to finish, or a fixed time. Safe.',
      parameters: {
        type: 'object',
        properties: {
          condition: { type: 'string', enum: ['element', 'navigation', 'networkIdle', 'timeout'], description: 'What to wait for' },
          selector: { type: 'string', description: 'Selector for element condition' },
          timeout: { type: 'number', description: 'Timeout in ms', default: 10000 },
        },
        required: ['condition'],
      },
    },
  },
];

const SEARCH_URLS: Record<string, string> = {
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q=',
  brave: 'https://search.brave.com/search?q=',
  startpage: 'https://www.startpage.com/sp/search?query=',
  wikipedia: 'https://en.wikipedia.org/w/index.php?search=',
};

function resolveTargetUrl(raw: string, engine = 'google'): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  const prefix = SEARCH_URLS[engine] || SEARCH_URLS.google;
  return prefix + encodeURIComponent(raw);
}

async function navigateTo(wc: Electron.WebContents, url: string): Promise<ToolResult> {
  try {
    await withTimeout(wc.loadURL(url), NAV_TIMEOUT_MS, 'Navigation');
  } catch (error) {
    const message = describeError(error);
    // Redirects and aborted loads can reject even though the page loaded.
    if (!/ERR_ABORTED|ERR_FAILED \(-3\)/.test(message) && !wc.getURL()) {
      return { success: false, error: `Navigation failed: ${message}` };
    }
  }
  await sleep(600);
  return {
    success: true,
    result: {
      url: wc.getURL(),
      title: wc.getTitle(),
      status: 'loaded',
    },
  };
}

async function extractPage(context: AgentToolContext, selector?: string, maxChars = 6000): Promise<ToolResult> {
  if (selector) {
    const wc = getContents(context);
    if (!wc) return { success: false, error: 'WebContents not available' };
    const output = await runScript(
      wc,
      `
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { __error: 'Selector not found' };
      return {
        text: (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, ${maxChars}),
        htmlLength: (el.innerHTML || '').length,
      };
      `
    );
    const data = output as { __error?: string; text?: string; htmlLength?: number };
    if (data && data.__error) return { success: false, error: data.__error };
    return { success: true, result: { selector, text: data?.text ?? '', url: wc.getURL() } };
  }

  const page = await pageExtractor.extractPage(context.tabId);
  if (!page) {
    return { success: false, error: 'Page extraction failed (tab not registered or private)' };
  }
  const text = (page.readableText || '').slice(0, maxChars);
  const headings = Array.isArray(page.headings) ? page.headings.slice(0, 25) : [];
  const links = Array.isArray(page.links) ? page.links.slice(0, 25) : [];

  // Give the model concrete selectors for interactive elements so it can act
  // on the page instead of guessing CSS.
  let interactive: unknown = [];
  const wc = getContents(context);
  if (wc) {
    try {
      interactive = await runScript(
        wc,
        `
        const describe = (el, i) => {
          const id = el.id ? '#' + el.id : '';
          const name = el.getAttribute('name');
          const type = el.getAttribute('type');
          const tag = el.tagName.toLowerCase();
          let selector = tag + id;
          if (!id && name) selector = tag + '[name="' + name + '"]';
          if (!id && !name) selector = tag + ':nth-of-type(' + (i + 1) + ')';
          return {
            selector,
            tag,
            type: type || undefined,
            name: name || undefined,
            placeholder: el.getAttribute('placeholder') || undefined,
            text: (el.innerText || el.value || '').trim().slice(0, 80) || undefined
          };
        };
        const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select')).slice(0, 15);
        const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], a[href]')).slice(0, 25);
        return {
          inputs: inputs.map(describe),
          clickable: buttons.map(describe)
        };
        `
      );
    } catch {
      interactive = [];
    }
  }

  return {
    success: true,
    result: {
      url: page.url,
      title: page.title,
      text,
      truncated: (page.readableText || '').length > maxChars,
      headings,
      links,
      interactive,
    },
  };
}

export async function executeAgentTool(
  toolName: string,
  args: Record<string, unknown>,
  context: AgentToolContext
): Promise<ToolResult> {
  const wc = getContents(context);
  if (!wc) return { success: false, error: 'WebContents not available' };

  try {
    switch (toolName) {
      case 'navigate': {
        const raw = String(args.url ?? '').trim();
        if (!raw) return { success: false, error: 'URL required' };
        return navigateTo(wc, resolveTargetUrl(raw, String(args.engine ?? 'google')));
      }

      case 'search': {
        const query = String(args.query ?? '').trim();
        if (!query) return { success: false, error: 'Query required' };
        return navigateTo(wc, resolveTargetUrl(query, String(args.engine ?? 'google')));
      }

      case 'click': {
        const selector = args.selector ? String(args.selector) : '';
        const text = args.text ? String(args.text) : '';
        const index = Number(args.index) || 0;
        if (!selector && !text) return { success: false, error: 'Either selector or text required' };

        const output = await runScript(
          wc,
          selector
            ? `
            const elements = document.querySelectorAll(${JSON.stringify(selector)});
            const el = elements[${index}];
            if (!el) return { __error: 'Element not found at index ${index} (matched ' + elements.length + ')' };
            el.scrollIntoView({ block: 'center' });
            el.click();
            return { clicked: true, tag: el.tagName, text: (el.innerText || el.textContent || '').trim().slice(0, 120) };
            `
            : `
            const candidates = Array.from(document.querySelectorAll('a, button, [role="button"], input[type="submit"], input[type="button"], summary'));
            const needle = ${JSON.stringify(text)}.toLowerCase();
            const match = candidates.find((el) => ((el.innerText || el.textContent || el.getAttribute('aria-label') || '').toLowerCase().includes(needle)));
            if (!match) return { __error: 'No clickable element found containing: ' + ${JSON.stringify(text)} };
            match.scrollIntoView({ block: 'center' });
            match.click();
            return { clicked: true, tag: match.tagName, text: (match.innerText || match.textContent || '').trim().slice(0, 120) };
            `
        );
        const data = output as { __error?: string; clicked?: boolean; tag?: string; text?: string };
        if (data && data.__error) return { success: false, error: data.__error };
        await sleep(400);
        return { success: true, result: { ...data, url: wc.getURL() } };
      }

      case 'type': {
        const selector = String(args.selector ?? '');
        const text = String(args.text ?? '');
        const clearFirst = args.clearFirst !== false;
        const pressEnter = args.pressEnter === true;
        if (!selector || !text) return { success: false, error: 'Selector and text required' };

        const output = await runScript(
          wc,
          `
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return { __error: 'Element not found: ' + ${JSON.stringify(selector)} };
          el.focus();
          if (el.isContentEditable) {
            if (${clearFirst}) el.textContent = '';
            el.textContent += ${JSON.stringify(text)};
          } else {
            const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            const next = (${clearFirst} ? '' : (el.value || '')) + ${JSON.stringify(text)};
            if (setter) setter.call(el, next); else el.value = next;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          ${
            pressEnter
              ? `el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                 el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                 if (el.form && typeof el.form.requestSubmit === 'function') el.form.requestSubmit();`
              : ''
          }
          return { typed: true, tag: el.tagName };
          `
        );
        const data = output as { __error?: string; typed?: boolean; tag?: string };
        if (data && data.__error) return { success: false, error: data.__error };
        await sleep(pressEnter ? 800 : 200);
        return { success: true, result: { ...data, url: wc.getURL() } };
      }

      case 'scroll': {
        const direction = String(args.direction ?? 'down');
        const amount = Number(args.amount) || 500;
        const selector = args.selector ? String(args.selector) : '';
        const output = await runScript(
          wc,
          selector
            ? `
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return { __error: 'Element not found' };
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return { scrolled: true, to: 'element' };
            `
            : `
            const delta = ${direction === 'up' ? -amount : direction === 'down' ? amount : 0};
            if (${JSON.stringify(direction)} === 'top') window.scrollTo(0, 0);
            else if (${JSON.stringify(direction)} === 'bottom') window.scrollTo(0, document.body.scrollHeight);
            else window.scrollBy(0, delta);
            return { scrolled: true, y: window.scrollY, height: document.body.scrollHeight };
            `
        );
        const data = output as { __error?: string };
        if (data && data.__error) return { success: false, error: data.__error };
        return { success: true, result: data };
      }

      case 'find': {
        const text = String(args.text ?? '');
        if (!text) return { success: false, error: 'Text required' };
        const highlight = args.highlight !== false;
        const output = await runScript(
          wc,
          `
          const needle = ${JSON.stringify(text)}.toLowerCase();
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
              if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_ACCEPT;
            }
          });
          const matches = [];
          let node;
          while ((node = walker.nextNode()) && matches.length < 20) {
            const idx = node.textContent.toLowerCase().indexOf(needle);
            if (idx === -1) continue;
            const parent = node.parentElement;
            if (!parent) continue;
            matches.push({ tag: parent.tagName, text: node.textContent.trim().slice(0, 160) });
            if (${highlight}) {
              const range = document.createRange();
              range.setStart(node, idx);
              range.setEnd(node, Math.min(idx + needle.length, node.textContent.length));
              const mark = document.createElement('mark');
              mark.style.background = 'rgba(250, 204, 21, 0.5)';
              mark.style.color = 'inherit';
              try { range.surroundContents(mark); } catch (e) {}
            }
          }
          return { count: matches.length, matches };
          `
        );
        return { success: true, result: output };
      }

      case 'highlight': {
        const selector = String(args.selector ?? '');
        if (!selector) return { success: false, error: 'Selector required' };
        const color = String(args.color ?? 'rgba(66,133,244,0.3)');
        const label = args.label ? String(args.label) : '';
        const duration = Number(args.duration) || 0;
        const output = await runScript(
          wc,
          `
          const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).slice(0, 50);
          els.forEach((el, i) => {
            const rect = el.getBoundingClientRect();
            const box = document.createElement('div');
            box.setAttribute('data-ariadne-highlight', '1');
            box.style.cssText = [
              'position:fixed',
              'pointer-events:none',
              'z-index:2147483647',
              'background:' + ${JSON.stringify(color)},
              'outline:2px solid rgba(66,133,244,0.9)',
              'left:' + rect.left + 'px',
              'top:' + rect.top + 'px',
              'width:' + rect.width + 'px',
              'height:' + rect.height + 'px',
              'border-radius:4px'
            ].join(';');
            if (${JSON.stringify(label)}) {
              box.title = ${JSON.stringify(label)};
            }
            document.body.appendChild(box);
          });
          if (${duration} > 0) {
            setTimeout(() => document.querySelectorAll('[data-ariadne-highlight]').forEach((n) => n.remove()), ${duration});
          }
          return { highlighted: els.length };
          `
        );
        return { success: true, result: output };
      }

      case 'extract': {
        return extractPage(context, args.selector ? String(args.selector) : undefined, Number(args.maxChars) || 6000);
      }

      case 'screenshot': {
        let target = wc;
        const selector = args.selector ? String(args.selector) : '';
        if (selector) {
          const rect = (await runScript(
            wc,
            `
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return { __error: 'Element not found' };
            el.scrollIntoView({ block: 'center' });
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
            `
          )) as { __error?: string; x: number; y: number; width: number; height: number };
          if (rect && rect.__error) return { success: false, error: rect.__error };
          const image = await withTimeout(
            target.capturePage({ x: rect.x, y: rect.y, width: Math.max(1, rect.width), height: Math.max(1, rect.height) }),
            10000,
            'Screenshot'
          );
          const dir = path.join(app.getPath('userData'), 'agent-screenshots');
          fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `shot-${Date.now()}.png`);
          fs.writeFileSync(file, image.toPNG());
          return { success: true, result: { path: file, width: image.getSize().width, height: image.getSize().height } };
        }
        const image = await withTimeout(target.capturePage(), 10000, 'Screenshot');
        const dir = path.join(app.getPath('userData'), 'agent-screenshots');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `shot-${Date.now()}.png`);
        fs.writeFileSync(file, image.toPNG());
        return { success: true, result: { path: file, width: image.getSize().width, height: image.getSize().height } };
      }

      case 'wait': {
        const condition = String(args.condition ?? 'timeout');
        const timeout = Math.min(Number(args.timeout) || 10000, 60000);
        if (condition === 'element') {
          const selector = String(args.selector ?? '');
          if (!selector) return { success: false, error: 'Selector required for element wait' };
          const started = Date.now();
          while (Date.now() - started < timeout) {
            const found = await runScript(wc, `return Boolean(document.querySelector(${JSON.stringify(selector)}));`);
            if (found === true) return { success: true, result: { found: true, waitedMs: Date.now() - started } };
            await sleep(250);
          }
          return { success: false, error: `Element ${selector} not found within ${timeout}ms` };
        }
        if (condition === 'navigation') {
          await withTimeout(
            new Promise<void>((resolve) => {
              const done = () => resolve();
              wc.once('did-finish-load', done);
              setTimeout(done, timeout);
            }),
            timeout + 1000,
            'Navigation wait'
          );
          return { success: true, result: { url: wc.getURL() } };
        }
        const waitMs = condition === 'networkIdle' ? Math.min(timeout, 1500) : timeout;
        await sleep(waitMs);
        return { success: true, result: { waitedMs: waitMs } };
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    return { success: false, error: describeError(error) };
  }
}

/** Legacy IPC surface kept for the renderer-side tool playground. */
export function registerAgentToolHandlers(): void {
  ipcMain.handle('agent:execute-tool', async (_event, toolName: string, args: Record<string, unknown>, context: AgentToolContext) => {
    return executeAgentTool(toolName, args, context);
  });

  ipcMain.handle('agent:execute-script', async (_event, script: string, webContentsId: number) => {
    const wc = webContents.fromId(webContentsId);
    if (!wc || wc.isDestroyed()) {
      return { success: false, error: 'WebContents not available' };
    }
    try {
      const result = await wc.executeJavaScript(script);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('agent:screenshot', async (_event, webContentsId: number) => {
    const wc = webContents.fromId(webContentsId);
    if (!wc || wc.isDestroyed()) {
      return { success: false, error: 'WebContents not available' };
    }
    try {
      const image = await wc.capturePage();
      return { success: true, data: image.toPNG().toString('base64'), mimeType: 'image/png' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
