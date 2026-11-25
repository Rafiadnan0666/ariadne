export interface SearchEngine {
  id: string
  name: string
  /** %s is replaced with the encoded query. */
  url: string
  keyword: string
}

export const SEARCH_ENGINES: SearchEngine[] = [
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s', keyword: 'g' },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', keyword: 'd' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s', keyword: 'b' },
  { id: 'brave', name: 'Brave Search', url: 'https://search.brave.com/search?q=%s', keyword: 'br' },
  { id: 'startpage', name: 'Startpage', url: 'https://www.startpage.com/sp/search?query=%s', keyword: 'sp' },
  { id: 'wikipedia', name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=%s', keyword: 'w' },
]

export function getSearchEngine(id: string | undefined): SearchEngine {
  return SEARCH_ENGINES.find((engine) => engine.id === id) || SEARCH_ENGINES[0]
}

export function buildSearchUrl(engineId: string | undefined, query: string): string {
  return getSearchEngine(engineId).url.replace('%s', encodeURIComponent(query))
}

export interface NavigationTarget {
  url: string
  isSearch: boolean
}

/**
 * Turn omnibox input into a URL or a search. This intentionally requires a
 * dot/host shape before treating text as a URL, so "hello world" searches.
 */
export function resolveNavigationInput(raw: string, engineId?: string): NavigationTarget {
  const input = raw.trim()
  if (!input) return { url: 'about:blank', isSearch: false }

  if (/^(https?|file|about|view-source):/i.test(input)) {
    return { url: input, isSearch: false }
  }

  const looksLikeHost =
    /^localhost(:\d+)?([/?#].*)?$/i.test(input) ||
    /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#].*)?$/.test(input) ||
    (/^[^\s/?#]+\.[^\s/?#]{2,}([/?#].*)?$/.test(input) && !input.includes(' '))

  if (looksLikeHost) {
    return { url: `https://${input}`, isSearch: false }
  }

  return { url: buildSearchUrl(engineId, input), isSearch: true }
}

export function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
