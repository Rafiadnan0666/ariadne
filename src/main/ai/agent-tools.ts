import { BrowserWindow, webContents, ipcMain } from 'electron';
import { ToolDefinition } from './types';

export interface AgentToolContext {
  tabId: string;
  webContentsId: number;
  window: BrowserWindow;
}

export interface ToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
  requiresApproval?: boolean;
  preview?: string;
}

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Navigate to a URL in the current tab',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search',
      description: 'Search the web using the default search engine',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          engine: { type: 'string', description: 'Search engine to use (google, duckduckgo, bing, brave, startpage, wikipedia)', enum: ['google', 'duckduckgo', 'bing', 'brave', 'startpage', 'wikipedia'] },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click',
      description: 'Click an element on the page',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of element to click' },
          text: { type: 'string', description: 'Alternative: text content of element to click' },
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
      description: 'Type text into an input field',
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
      description: 'Scroll the page',
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
      description: 'Find text on the page and highlight matches',
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
      description: 'Highlight elements on the page with colored overlay',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of elements to highlight' },
          color: { type: 'string', description: 'Highlight color (hex or name)', default: 'rgba(66,133,244,0.3)' },
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
      description: 'Extract content from the page',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector to extract (optional, defaults to full page)' },
          format: { type: 'string', enum: ['text', 'html', 'markdown', 'json'], description: 'Output format', default: 'text' },
          includeLinks: { type: 'boolean', description: 'Include link URLs', default: true },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'screenshot',
      description: 'Take a screenshot of the page or element',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of element to capture (optional, defaults to viewport)' },
          fullPage: { type: 'boolean', description: 'Capture full page', default: false },
          format: { type: 'string', enum: ['png', 'jpeg'], description: 'Image format', default: 'png' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wait',
      description: 'Wait for a condition (element appears, navigation completes, etc.)',
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

export async function executeAgentTool(
  toolName: string,
  args: Record<string, unknown>,
  context: AgentToolContext
): Promise<ToolResult> {
  const { tabId, webContentsId, window } = context;
  const wc = webContents.fromId(webContentsId);
  if (!wc || wc.isDestroyed()) {
    return { success: false, error: 'WebContents not available' };
  }

  switch (toolName) {
    case 'navigate': {
      const url = args.url as string;
      if (!url) return { success: false, error: 'URL required' };
      
      // Check if it's a search query or URL
      let targetUrl = url;
      if (!/^https?:\/\//i.test(url)) {
        const engine = (args.engine as string) || 'google';
        const searchUrls: Record<string, string> = {
          google: 'https://www.google.com/search?q=',
          duckduckgo: 'https://duckduckgo.com/?q=',
          bing: 'https://www.bing.com/search?q=',
          brave: 'https://search.brave.com/search?q=',
          startpage: 'https://www.startpage.com/sp/search?query=',
          wikipedia: 'https://en.wikipedia.org/w/index.php?search=',
        };
        targetUrl = searchUrls[engine] + encodeURIComponent(url);
      }
      
      const preview = `Navigate to: ${targetUrl}`;
      return { success: true, preview, requiresApproval: true, result: { url: targetUrl } };
    }

    case 'search': {
      const query = args.query as string;
      const engine = (args.engine as string) || 'google';
      if (!query) return { success: false, error: 'Query required' };
      
      const searchUrls: Record<string, string> = {
        google: 'https://www.google.com/search?q=',
        duckduckgo: 'https://duckduckgo.com/?q=',
        bing: 'https://www.bing.com/search?q=',
        brave: 'https://search.brave.com/search?q=',
        startpage: 'https://www.startpage.com/sp/search?query=',
        wikipedia: 'https://en.wikipedia.org/w/index.php?search=',
      };
      const url = searchUrls[engine] + encodeURIComponent(query);
      
      const preview = `Search ${engine} for: "${query}"`;
      return { success: true, preview, requiresApproval: true, result: { url, query, engine } };
    }

    case 'click': {
      const selector = args.selector as string;
      const text = args.text as string;
      const index = (args.index as number) || 0;
      
      let script = '';
      if (selector) {
        script = `
          const elements = document.querySelectorAll(${JSON.stringify(selector)});
          if (elements.length > ${index}) {
            elements[${index}].click();
            return { success: true, selector: ${JSON.stringify(selector)}, index: ${index} };
          }
          return { success: false, error: 'Element not found at index ${index}' };
        `;
      } else if (text) {
        script = `
          const elements = Array.from(document.querySelectorAll('a, button, [role="button"], input[type="submit"], input[type="button"]'));
          const match = elements.find(el => el.textContent?.includes(${JSON.stringify(text)}));
          if (match) {
            match.click();
            return { success: true, text: ${JSON.stringify(text)} };
          }
          return { success: false, error: 'No element found with text: ${text}' };
        `;
      } else {
        return { success: false, error: 'Either selector or text required' };
      }
      
      const preview = selector ? `Click element: ${selector}${index > 0 ? ` [${index}]` : ''}` : `Click element containing: "${text}"`;
      return { success: true, preview, requiresApproval: true, result: { script } };
    }

    case 'type': {
      const selector = args.selector as string;
      const text = args.text as string;
      const clearFirst = args.clearFirst !== false;
      const pressEnter = args.pressEnter === true;
      
      if (!selector || !text) return { success: false, error: 'Selector and text required' };
      
      const script = `
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { success: false, error: 'Element not found' };
        if (${clearFirst}) el.value = '';
        el.value += ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        ${pressEnter ? 'el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));' : ''}
        return { success: true, selector: ${JSON.stringify(selector)}, text: ${JSON.stringify(text)} };
      `;
      
      const preview = `Type into ${selector}: "${text}"${pressEnter ? ' + Enter' : ''}`;
      return { success: true, preview, requiresApproval: true, result: { script } };
    }

    case 'scroll': {
      const direction = args.direction as string;
      const amount = (args.amount as number) || 500;
      const selector = args.selector as string;
      
      let script = '';
      if (selector) {
        script = `
          const el = document.querySelector(${JSON.stringify(selector)});
          if (el) { el.scrollIntoView({ behavior: 'smooth' }); return { success: true }; }
          return { success: false, error: 'Element not found' };
        `;
      } else {
        switch (direction) {
          case 'up': script = `window.scrollBy(0, -${amount});`; break;
          case 'down': script = `window.scrollBy(0, ${amount});`; break;
          case 'top': script = `window.scrollTo(0, 0);`; break;
          case 'bottom': script = `window.scrollTo(0, document.body.scrollHeight);`; break;
        }
      }
      
      const preview = selector ? `Scroll to element: ${selector}` : `Scroll ${direction} ${direction !== 'top' && direction !== 'bottom' ? amount + 'px' : ''}`;
      return { success: true, preview, requiresApproval: false, result: { script } };
    }

    case 'find': {
      const text = args.text as string;
      const highlight = args.highlight !== false;
      
      if (!text) return { success: false, error: 'Text required' };
      
      const script = `
        const searchText = ${JSON.stringify(text)};
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        const matches = [];
        let node;
        while (node = walker.nextNode()) {
          if (node.textContent.toLowerCase().includes(searchText.toLowerCase())) {
            matches.push(node);
          }
        }
        ${highlight ? `
          matches.forEach(node => {
            const range = document.createRange();
            range.selectNode(node);
            const highlight = document.createElement('mark');
            highlight.style.background = 'yellow';
            highlight.style.color = 'black';
            try { range.surroundContents(highlight); } catch {}
          });
        ` : ''}
        return { success: true, count: matches.length, text: searchText };
      `;
      
      const preview = `Find "${text}" on page (${highlight ? 'highlight matches' : 'count only'})`;
      return { success: true, preview, requiresApproval: false, result: { script } };
    }

    case 'highlight': {
      const selector = args.selector as string;
      const color = (args.color as string) || 'rgba(66,133,244,0.3)';
      const label = args.label as string;
      const duration = (args.duration as number) || 5000;
      
      if (!selector) return { success: false, error: 'Selector required' };
      
      const script = `
        const elements = document.querySelectorAll(${JSON.stringify(selector)});
        elements.forEach(el => {
          const rect = el.getBoundingClientRect();
          const overlay = document.createElement('div');
          overlay.style.cssText = \`
            position: fixed;
            left: \${rect.left + window.scrollX}px;
            top: \${rect.top + window.scrollY}px;
            width: \${rect.width}px;
            height: \${rect.height}px;
            background: ${color};
            border: 2px solid ${color.replace('0.3', '1')};
            border-radius: 4px;
            pointer-events: none;
            z-index: 2147483647;
            box-shadow: 0 0 0 2px white;
          \`;
          ${label ? `overlay.title = ${JSON.stringify(label)};` : ''}
          document.body.appendChild(overlay);
          ${duration > 0 ? `setTimeout(() => overlay.remove(), ${duration});` : ''}
        });
        return { success: true, count: elements.length };
      `;
      
      const preview = `Highlight ${selector} with ${color}${label ? ` labeled "${label}"` : ''}${duration > 0 ? ` for ${duration}ms` : ' (permanent)'}`;
      return { success: true, preview, requiresApproval: false, result: { script } };
    }

    case 'extract': {
      const selector = args.selector as string;
      const format = (args.format as string) || 'text';
      const includeLinks = args.includeLinks !== false;
      
      let script = '';
      if (selector) {
        script = `
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return { success: false, error: 'Element not found' };
          return extractContent(el, ${JSON.stringify(format)}, ${includeLinks});
        `;
      } else {
        script = `return extractContent(document.body, ${JSON.stringify(format)}, ${includeLinks});`;
      }
      
      // Inject extraction helper
      const fullScript = `
        function extractContent(root, format, includeLinks) {
          const clone = root.cloneNode(true);
          clone.querySelectorAll('script, style, noscript, iframe').forEach(el => el.remove());
          
          if (format === 'text') {
            return { success: true, content: clone.innerText.trim(), format: 'text' };
          }
          if (format === 'html') {
            return { success: true, content: clone.innerHTML, format: 'html' };
          }
          if (format === 'markdown') {
            // Simple HTML to markdown conversion
            let md = clone.innerText;
            clone.querySelectorAll('a').forEach(a => {
              if (includeLinks && a.href) md = md.replace(a.innerText, \`[\${a.innerText}](\${a.href})\`);
            });
            return { success: true, content: md, format: 'markdown' };
          }
          if (format === 'json') {
            const data = [];
            clone.querySelectorAll('*').forEach(el => {
              if (el.children.length === 0 && el.innerText.trim()) {
                data.push({ tag: el.tagName.toLowerCase(), text: el.innerText.trim(), href: el.href || null });
              }
            });
            return { success: true, content: data, format: 'json' };
          }
          return { success: false, error: 'Unknown format' };
        }
        ${script}
      `;
      
      const preview = `Extract ${format} from ${selector || 'full page'}`;
      return { success: true, preview, requiresApproval: false, result: { script: fullScript } };
    }

    case 'screenshot': {
      const selector = args.selector as string;
      const fullPage = args.fullPage === true;
      const format = (args.format as string) || 'png';
      
      // Screenshots need to be done via Electron's capturePage
      const preview = selector 
        ? `Screenshot element: ${selector}` 
        : `Screenshot ${fullPage ? 'full page' : 'viewport'} as ${format}`;
      
      return { 
        success: true, 
        preview, 
        requiresApproval: false, 
        result: { type: 'screenshot', selector, fullPage, format, tabId } 
      };
    }

    case 'wait': {
      const condition = args.condition as string;
      const selector = args.selector as string;
      const timeout = (args.timeout as number) || 10000;
      
      let script = '';
      switch (condition) {
        case 'element':
          if (!selector) return { success: false, error: 'Selector required for element wait' };
          script = `
            return new Promise(resolve => {
              const start = Date.now();
              const check = () => {
                if (document.querySelector(${JSON.stringify(selector)})) {
                  resolve({ success: true });
                } else if (Date.now() - start > ${timeout}) {
                  resolve({ success: false, error: 'Timeout waiting for element' });
                } else {
                  setTimeout(check, 100);
                }
              };
              check();
            });
          `;
          break;
        case 'navigation':
          script = `
            return new Promise(resolve => {
              if (document.readyState === 'complete') {
                resolve({ success: true });
              } else {
                window.addEventListener('load', () => resolve({ success: true }), { once: true });
                setTimeout(() => resolve({ success: false, error: 'Navigation timeout' }), ${timeout});
              }
            });
          `;
          break;
        case 'networkIdle':
          script = `
            return new Promise(resolve => {
              let pending = 0;
              const observer = new PerformanceObserver(list => {
                list.getEntries().forEach(entry => {
                  if (entry.entryType === 'resource') pending--;
                });
              });
              observer.observe({ entryTypes: ['resource'] });
              const start = Date.now();
              const check = () => {
                if (pending <= 0 && Date.now() - start > 500) {
                  observer.disconnect();
                  resolve({ success: true });
                } else if (Date.now() - start > ${timeout}) {
                  observer.disconnect();
                  resolve({ success: false, error: 'Network idle timeout' });
                } else {
                  setTimeout(check, 100);
                }
              };
              check();
            });
          `;
          break;
        case 'timeout':
          script = `return new Promise(resolve => setTimeout(() => resolve({ success: true }), ${timeout}));`;
          break;
      }
      
      const preview = `Wait for ${condition}${selector ? `: ${selector}` : ''} (${timeout}ms timeout)`;
      return { success: true, preview, requiresApproval: false, result: { script } };
    }

    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

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

  ipcMain.handle('agent:screenshot', async (_event, webContentsId: number, options: { selector?: string; fullPage?: boolean; format?: string }) => {
    const wc = webContents.fromId(webContentsId);
    if (!wc || wc.isDestroyed()) {
      return { success: false, error: 'WebContents not available' };
    }
    try {
      const image = await wc.capturePage();
      const buffer = image.toPNG(); // or toJPEG()
      return { success: true, data: buffer.toString('base64'), mimeType: 'image/png' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}