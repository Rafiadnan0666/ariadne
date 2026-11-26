import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { ChatSidebar } from './components/ai/ChatSidebar'
import { TabStrip } from './components/TabStrip'
import { AddressBar } from './components/AddressBar'
import { BookmarksBar } from './components/BookmarksBar'
import { DownloadsPanel } from './components/DownloadsPanel'
import { HistoryPage } from './components/HistoryPage'
import { SettingsPage, type SettingsSection } from './components/SettingsPage'
import { NewTabPage } from './components/NewTabPage'
import { ContextPicker } from '../ui/sidebar/context-picker/ContextPicker'
import { Icon } from './components/Icon'
import { getSearchEngine, resolveNavigationInput, SEARCH_ENGINES } from '../shared/search-engines'
import type {
  AddressSuggestion,
  AppInfoDTO,
  AppSettingsDTO,
  BookmarkDTO,
  DownloadDTO,
  HistoryEntryDTO,
  SearchEngineDTO,
  TabDTO,
} from './types'
import './styles.css'

const NEW_TAB = 'about:blank'
const DEFAULT_SETTINGS: AppSettingsDTO = {
  theme: 'dark',
  accentColor: '#7aa2f7',
  density: 'normal',
  showBookmarksBar: true,
  homePage: NEW_TAB,
  defaultSearchEngine: 'google',
  searchSuggestions: true,
  doNotTrack: true,
  clearOnExit: false,
  downloadPath: '',
  aiSidebarOpen: false,
}

interface WebviewElement extends HTMLElement {
  getWebContentsId(): number
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
  setAudioMuted(muted: boolean): void
  setZoomFactor(factor: number): void
  focus(): void
}

function isNewTab(url: string | undefined): boolean {
  return !url || url === NEW_TAB || url === 'ariadne://newtab'
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url || 'New tab'
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

const WebviewPane = React.memo(function WebviewPane({
  tab,
  partition,
  active,
  register,
  isNewTabPage,
  ntpProps,
}: {
  tab: TabDTO
  partition: string
  active: boolean
  register: (id: string, element: WebviewElement | null) => void
  isNewTabPage: boolean
  ntpProps?: {
    onSubmit: (raw: string) => void
    onNavigate: (url: string) => void
    topSites: Array<{ url: string; title: string; favicon?: string; visitCount: number }>
    recentlyClosed: Array<{ id: string; url: string; title: string }>
    searchEngineName: string
    isPrivate: boolean
  }
}) {
  const [src, setSrc] = useState<string | null>(() => (isNewTab(tab.url) ? null : tab.url))

  useEffect(() => {
    if (src === null && !isNewTab(tab.url)) setSrc(tab.url)
  }, [src, tab.url])

  useEffect(() => {
    if (tab.muted) {
      const element = document.getElementById(`webview-${tab.id}`) as WebviewElement | null
      try {
        element?.setAudioMuted?.(true)
      } catch {
        /* not attached yet */
      }
    }
  }, [tab.muted, tab.id])

  const attach = useCallback(
    (element: WebviewElement | null) => {
      register(tab.id, element)
      if (!element) return
      const registerContents = () => {
        try {
          const id = element.getWebContentsId()
          if (id) void window.electronAPI.tab.setWebContents(tab.id, id)
          element.setZoomFactor?.(tab.zoomFactor || 1)
          element.setAudioMuted?.(tab.muted === true)
        } catch {
          /* webview not ready */
        }
      }
      element.addEventListener('dom-ready', registerContents)
      element.addEventListener('did-finish-load', registerContents)
    },
    // Register once per tab; the parent stores the element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab.id]
  )

  if (isNewTabPage && active && ntpProps) {
    return (
      <div className="tab-view active" aria-hidden={false}>
        <NewTabPage {...ntpProps} />
      </div>
    )
  }

  return (
    <div className={`tab-view ${active ? 'active' : ''}`} aria-hidden={!active}>
      {src && (
        <webview
          id={`webview-${tab.id}`}
          ref={attach}
          src={src}
          partition={partition}
          className="webview"
        />
      )}
    </div>
  )
})

export default function App() {
  const [tabs, setTabs] = useState<TabDTO[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [closedTabs, setClosedTabs] = useState<Array<{ id: string; url: string; title: string }>>([])
  const [settings, setSettings] = useState<AppSettingsDTO>(DEFAULT_SETTINGS)
  const [searchEngines, setSearchEngines] = useState<SearchEngineDTO[]>(SEARCH_ENGINES)
  const [bookmarks, setBookmarks] = useState<BookmarkDTO[]>([])
  const [downloads, setDownloads] = useState<DownloadDTO[]>([])
  const [history, setHistory] = useState<HistoryEntryDTO[]>([])
  const [appInfo, setAppInfo] = useState<AppInfoDTO | null>(null)
  const [windowInfo, setWindowInfo] = useState<{ id: number; isPrivate: boolean; partition: string } | null>(null)
  const [ready, setReady] = useState(false)

  const [aiOpen, setAiOpen] = useState(false)
  const [aiWidth, setAiWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem('ariadne.aiWidth'))
    return Number.isFinite(saved) && saved >= 320 && saved <= 620 ? saved : 390
  })
  const [contextOpen, setContextOpen] = useState(false)
  const [downloadsOpen, setDownloadsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')

  const [addressQuery, setAddressQuery] = useState('')
  const [addressFocusToken, setAddressFocusToken] = useState(0)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findResult, setFindResult] = useState({ matches: 0, activeMatchOrdinal: 0 })
  const [loadError, setLoadError] = useState<{ tabId: string; url: string; errorDescription: string } | null>(null)
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [permission, setPermission] = useState<{ id: string; origin: string; permission: string } | null>(null)
  const [toast, setToast] = useState<{ text: string; kind: 'info' | 'error' | 'success' | 'warning' } | null>(null)
  const [memoryStats, setMemoryStats] = useState<{ totalMB: number; budgetMB: number; heapUsedMB: number } | null>(null)

  const webviews = useRef<Record<string, WebviewElement | null>>({})
  const activeIdRef = useRef<string | null>(null)
  const aiWidthRef = useRef(aiWidth)
  const shortcutRef = useRef<(action: string) => void>(() => undefined)

  activeIdRef.current = activeId
  aiWidthRef.current = aiWidth

  const activeTab = tabs.find((tab) => tab.id === activeId) || null
  const activeEngine = getSearchEngine(settings.defaultSearchEngine)

  const notify = useCallback((text: string, kind: 'info' | 'error' | 'success' | 'warning' = 'info') => {
    setToast({ text, kind })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const refreshBookmarks = useCallback(async () => {
    try {
      setBookmarks(await window.electronAPI.bookmarks.get())
    } catch (error) {
      console.error('Failed to load bookmarks', error)
    }
  }, [])

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await window.electronAPI.history.get())
    } catch (error) {
      console.error('Failed to load history', error)
    }
  }, [])

  const refreshClosedTabs = useCallback(async () => {
    try {
      setClosedTabs(await window.electronAPI.tab.getClosed())
    } catch (error) {
      console.error('Failed to load closed tabs', error)
    }
  }, [])

  // Initial load ---------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [tabList, downloadList, bookmarkList, config, closed, info, version] = await Promise.all([
          window.electronAPI.tab.getAll(),
          window.electronAPI.downloads.get(),
          window.electronAPI.bookmarks.get(),
          window.electronAPI.settings.get(),
          window.electronAPI.tab.getClosed(),
          window.electronAPI.window.getInfo(),
          window.electronAPI.app.getInfo(),
        ])
        if (cancelled) return
        setTabs(tabList)
        setActiveId(tabList.find((tab) => tab.active)?.id ?? tabList[0]?.id ?? null)
        setDownloads(downloadList)
        setBookmarks(bookmarkList)
        setClosedTabs(closed)
        setWindowInfo(info)
        setAppInfo(version)
        setSearchEngines(config.searchEngines?.length ? config.searchEngines : SEARCH_ENGINES)
        const { searchEngines: _engines, ...rest } = config
        setSettings({ ...DEFAULT_SETTINGS, ...rest })
        setAiOpen(config.aiSidebarOpen === true)
        setHistory(await window.electronAPI.history.get())
      } catch (error) {
        console.error('Failed to initialise renderer', error)
        notify(`Could not load browser state: ${errorMessage(error)}`, 'error')
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [notify])

  // Main-process events --------------------------------------------------
  useEffect(() => {
    const unsubscribers = [
      window.electronAPI.on('tabs-updated', (next: TabDTO[]) => {
        setTabs(next)
        setActiveId((current) => {
          if (current && next.some((tab) => tab.id === current)) return current
          return next.find((tab) => tab.active)?.id ?? next[0]?.id ?? null
        })
      }),
      window.electronAPI.on('tab-updated', (updated: TabDTO) => {
        setTabs((current) => current.map((tab) => (tab.id === updated.id ? { ...tab, ...updated } : tab)))
      }),
      window.electronAPI.on('tab-load-error', (payload: { tabId: string; url: string; errorDescription: string }) => {
        setLoadError(payload)
      }),
      window.electronAPI.on('settings-updated', (next: AppSettingsDTO) => setSettings(next)),
      window.electronAPI.on('download-updated', (download: DownloadDTO) => {
        setDownloads((current) => {
          const index = current.findIndex((entry) => entry.id === download.id)
          if (index < 0) return [download, ...current]
          const copy = [...current]
          copy[index] = download
          return copy
        })
      }),
      window.electronAPI.on('download-removed', (id: string) => {
        setDownloads((current) => current.filter((entry) => entry.id !== id))
      }),
      window.electronAPI.on('downloads-cleared', () => setDownloads([])),
      window.electronAPI.on('history-cleared', () => setHistory([])),
      window.electronAPI.on('permission-request', (request: { id: string; origin: string; permission: string }) => {
        setPermission(request)
      }),
      window.electronAPI.on('shortcut', (action: string) => shortcutRef.current(action)),
      window.electronAPI.memory?.onStats?.((stats: any) => setMemoryStats(stats)),
    ].filter((unsubscribe): unsubscribe is () => void => typeof unsubscribe === 'function')
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [])

  // Apply appearance settings -------------------------------------------
  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const applyTheme = () => {
      const useLight = settings.theme === 'light' || (settings.theme === 'system' && media.matches)
      root.dataset.theme = useLight ? 'light' : 'dark'
    }
    applyTheme()
    root.dataset.density = settings.density
    root.style.setProperty('--accent', settings.accentColor)
    if (settings.theme === 'system') media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [settings.theme, settings.density, settings.accentColor])

  // Keep window title in sync -------------------------------------------
  useEffect(() => {
    document.title = activeTab ? `${activeTab.title || hostOf(activeTab.url)} — Ariadne` : 'Ariadne'
  }, [activeTab])

  // Focus the active page when the tab changes --------------------------
  useEffect(() => {
    if (!activeId) return
    const tab = tabs.find((entry) => entry.id === activeId)
    if (tab && !isNewTab(tab.url)) {
      window.setTimeout(() => {
        try {
          webviews.current[activeId]?.focus()
        } catch {
          /* not ready */
        }
      }, 40)
    }
  }, [activeId, tabs])

  // Ensure there is always a tab ----------------------------------------
  useEffect(() => {
    if (!ready || !windowInfo) return
    if (tabs.length === 0) {
      void window.electronAPI.tab.create(NEW_TAB).catch((error) => notify(errorMessage(error), 'error'))
    }
  }, [ready, windowInfo, tabs.length, notify])

  // Address suggestions --------------------------------------------------
  const suggestions = useMemo<AddressSuggestion[]>(() => {
    const query = addressQuery.trim()
    if (!query || !settings.searchSuggestions) return []
    const lower = query.toLowerCase()
    const resolved = resolveNavigationInput(query, settings.defaultSearchEngine)
    const output: AddressSuggestion[] = []
    const seen = new Set<string>()

    if (resolved.isSearch) {
      output.push({
        kind: 'search',
        label: `Search ${activeEngine.name} for “${query}”`,
        value: query,
      })
    } else {
      output.push({ kind: 'url', label: resolved.url, detail: 'Open address', value: resolved.url })
      seen.add(resolved.url)
    }

    for (const tab of tabs) {
      if (output.length >= 8) break
      if (tab.url === resolved.url) continue
      if (!`${tab.title} ${tab.url}`.toLowerCase().includes(lower)) continue
      output.push({
        kind: 'tab',
        label: tab.title || hostOf(tab.url),
        detail: hostOf(tab.url),
        value: tab.url,
        tabId: tab.id,
      })
    }

    for (const bookmark of bookmarks) {
      if (output.length >= 8) break
      if (bookmark.isFolder || seen.has(bookmark.url)) continue
      if (!`${bookmark.title} ${bookmark.url}`.toLowerCase().includes(lower)) continue
      seen.add(bookmark.url)
      output.push({
        kind: 'bookmark',
        label: bookmark.title || bookmark.url,
        detail: hostOf(bookmark.url),
        value: bookmark.url,
      })
    }

    for (const entry of history) {
      if (output.length >= 8) break
      if (seen.has(entry.url)) continue
      if (!`${entry.title} ${entry.url}`.toLowerCase().includes(lower)) continue
      seen.add(entry.url)
      output.push({
        kind: 'history',
        label: entry.title || entry.url,
        detail: hostOf(entry.url),
        value: entry.url,
      })
    }

    return output
  }, [addressQuery, settings.searchSuggestions, settings.defaultSearchEngine, activeEngine.name, tabs, bookmarks, history])

  const topSites = useMemo(() => {
    const counts = new Map<string, { url: string; title: string; count: number }>()
    for (const entry of history) {
      try {
        const url = new URL(entry.url)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
        const key = url.origin
        const existing = counts.get(key)
        if (existing) existing.count += 1
        else counts.set(key, { url: entry.url, title: entry.title || url.hostname, count: 1 })
      } catch {
        /* ignore malformed history rows */
      }
    }
    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((site) => ({ url: site.url, title: site.title, visitCount: site.count }))
  }, [history])

  // Navigation -----------------------------------------------------------
  const navigate = useCallback(
    (raw: string) => {
      const target = resolveNavigationInput(raw, settings.defaultSearchEngine)
      setAddressQuery('')
      setLoadError(null)
      const current = tabs.find((tab) => tab.id === activeIdRef.current)
      if (!current) {
        void window.electronAPI.tab.create(target.url).catch((error) => notify(errorMessage(error), 'error'))
        return
      }
      void window.electronAPI.tab.navigate(current.id, target.url).catch((error) => notify(errorMessage(error), 'error'))
    },
    [settings.defaultSearchEngine, notify]
  )

  const createTab = useCallback(
    async (url: string = NEW_TAB) => {
      try {
        const id = await window.electronAPI.tab.create(url)
        setActiveId(id)
        setAddressQuery('')
      } catch (error) {
        notify(`Could not open tab: ${errorMessage(error)}`, 'error')
      }
    },
    [notify]
  )

  const switchTab = useCallback(async (id: string) => {
    setActiveId(id)
    try {
      await window.electronAPI.tab.setActive(id)
    } catch {
      /* main will resync through tabs-updated */
    }
  }, [])

  const closeTab = useCallback(
    async (id: string) => {
      try {
        await window.electronAPI.tab.close(id)
        await refreshClosedTabs()
      } catch (error) {
        notify(`Could not close tab: ${errorMessage(error)}`, 'error')
      }
    },
    [notify, refreshClosedTabs]
  )

  const closeOtherTabs = useCallback(
    async (id: string) => {
      for (const tab of tabs) {
        if (tab.id !== id) await window.electronAPI.tab.close(tab.id).catch(() => undefined)
      }
      await refreshClosedTabs()
    },
    [tabs, refreshClosedTabs]
  )

  const switchRelative = useCallback(
    (delta: number) => {
      if (tabs.length === 0) return
      const index = tabs.findIndex((tab) => tab.id === activeId)
      const next = tabs[(index + delta + tabs.length) % tabs.length]
      if (next) void switchTab(next.id)
    },
    [tabs, activeId, switchTab]
  )

  const reopenClosedTab = useCallback(async () => {
    try {
      await window.electronAPI.tab.reopenClosed()
      await refreshClosedTabs()
    } catch (error) {
      notify(`Could not reopen tab: ${errorMessage(error)}`, 'error')
    }
  }, [notify, refreshClosedTabs])

  const updateSettings = useCallback(
    async (patch: Partial<AppSettingsDTO>) => {
      setSettings((current) => ({ ...current, ...patch }))
      try {
        const next = await window.electronAPI.settings.set(patch)
        setSettings((current) => ({ ...current, ...next }))
      } catch (error) {
        notify(`Could not save settings: ${errorMessage(error)}`, 'error')
        try {
          const current = await window.electronAPI.settings.get()
          const { searchEngines: _engines, ...rest } = current
          setSettings({ ...DEFAULT_SETTINGS, ...rest })
        } catch {
          /* ignore */
        }
      }
    },
    [notify]
  )

  const toggleAi = useCallback(() => {
    setAiOpen((open) => {
      const next = !open
      void window.electronAPI.settings.set({ aiSidebarOpen: next }).catch(() => undefined)
      return next
    })
  }, [])

  const openSettings = useCallback((section: SettingsSection = 'general') => {
    setSettingsSection(section)
    setSettingsOpen(true)
  }, [])

  // Find in page ---------------------------------------------------------
  useEffect(() => {
    if (!findOpen || !activeId) return
    const timer = window.setTimeout(() => {
      if (!findQuery.trim()) {
        void window.electronAPI.tab.stopFinding(activeId, 'clear').catch(() => undefined)
        setFindResult({ matches: 0, activeMatchOrdinal: 0 })
        return
      }
      void window.electronAPI.tab
        .findInPage(activeId, findQuery)
        .then((result) => setFindResult(result))
        .catch(() => setFindResult({ matches: 0, activeMatchOrdinal: 0 }))
    }, 140)
    return () => window.clearTimeout(timer)
  }, [findQuery, findOpen, activeId])

  const findAgain = useCallback(
    (forward: boolean) => {
      if (!activeId || !findQuery.trim()) return
      void window.electronAPI.tab
        .findInPage(activeId, findQuery, { forward, findNext: true })
        .then((result) => setFindResult(result))
        .catch(() => undefined)
    },
    [activeId, findQuery]
  )

  const closeFind = useCallback(() => {
    if (activeId) void window.electronAPI.tab.stopFinding(activeId, 'clear').catch(() => undefined)
    setFindOpen(false)
    setFindQuery('')
    setFindResult({ matches: 0, activeMatchOrdinal: 0 })
  }, [activeId])

  // Shortcuts ------------------------------------------------------------
  useEffect(() => {
    shortcutRef.current = (action: string) => {
      switch (action) {
        case 'new-tab':
          void createTab()
          break
        case 'new-window':
          void window.electronAPI.window.create().catch((error) => notify(errorMessage(error), 'error'))
          break
        case 'new-private-window':
          void window.electronAPI.window.create({ private: true }).catch((error) => notify(errorMessage(error), 'error'))
          break
        case 'close-tab':
          if (activeId) void closeTab(activeId)
          break
        case 'reopen-closed-tab':
          void reopenClosedTab()
          break
        case 'next-tab':
          switchRelative(1)
          break
        case 'prev-tab':
          switchRelative(-1)
          break
        case 'focus-address':
          setAddressFocusToken((token) => token + 1)
          break
        case 'find-in-page':
          setFindOpen(true)
          break
        case 'find-next':
          findAgain(true)
          break
        case 'find-prev':
          findAgain(false)
          break
        case 'reload':
          void window.electronAPI.tab.reload().catch(() => undefined)
          break
        case 'force-reload':
          void window.electronAPI.tab.forceReload().catch(() => undefined)
          break
        case 'stop':
          void window.electronAPI.tab.stop().catch(() => undefined)
          break
        case 'back':
          void window.electronAPI.tab.back().catch(() => undefined)
          break
        case 'forward':
          void window.electronAPI.tab.forward().catch(() => undefined)
          break
        case 'home':
          navigate(settings.homePage || NEW_TAB)
          break
        case 'open-downloads':
          setDownloadsOpen(true)
          break
        case 'open-history':
          setHistoryOpen(true)
          break
        case 'toggle-bookmarks':
          void updateSettings({ showBookmarksBar: !settings.showBookmarksBar })
          break
        case 'toggle-ai':
          toggleAi()
          break
        case 'devtools':
          void window.electronAPI.tab.devtools().catch(() => undefined)
          break
        case 'zoom-in':
        case 'zoom-out':
        case 'zoom-reset': {
          if (!activeTab) break
          const base = activeTab.zoomFactor || 1
          const next = action === 'zoom-reset' ? 1 : action === 'zoom-in' ? Math.min(3, base + 0.1) : Math.max(0.3, base - 0.1)
          void window.electronAPI.tab.setZoom(activeTab.id, next).catch(() => undefined)
          break
        }
        case 'fullscreen':
          void window.electronAPI.tab.fullscreen().catch(() => undefined)
          break
        case 'print':
          if (activeTab) void window.electronAPI.tab.print(activeTab.id).catch(() => undefined)
          break
        case 'view-source':
          if (activeTab) void window.electronAPI.tab.viewSource(activeTab.id).catch((error) => notify(errorMessage(error), 'error'))
          break
        case 'about':
          openSettings('about')
          break
        default:
          break
      }
    }
  })

  // Escape closes transient UI ------------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (tabMenu) setTabMenu(null)
        else if (permission) setPermission(null)
        else if (findOpen) closeFind()
        else if (contextOpen) setContextOpen(false)
        else if (downloadsOpen) setDownloadsOpen(false)
        else if (historyOpen) setHistoryOpen(false)
        else if (settingsOpen) setSettingsOpen(false)
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        setAddressFocusToken((token) => token + 1)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [tabMenu, permission, findOpen, closeFind, contextOpen, downloadsOpen, historyOpen, settingsOpen])

  // Tab context menu dismiss ---------------------------------------------
  useEffect(() => {
    if (!tabMenu) return
    const dismiss = () => setTabMenu(null)
    window.addEventListener('mousedown', dismiss)
    window.addEventListener('blur', dismiss)
    return () => {
      window.removeEventListener('mousedown', dismiss)
      window.removeEventListener('blur', dismiss)
    }
  }, [tabMenu])

  // AI sidebar resize ----------------------------------------------------
  const beginResize = useCallback((event: React.PointerEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = aiWidthRef.current
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.min(620, Math.max(320, startWidth + (startX - moveEvent.clientX)))
      setAiWidth(next)
    }
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      window.localStorage.setItem('ariadne.aiWidth', String(aiWidthRef.current))
      document.body.classList.remove('resizing')
    }
    document.body.classList.add('resizing')
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, [])

  const getActiveSelection = useCallback(async (): Promise<string | undefined> => {
    const id = activeIdRef.current
    const element = id ? webviews.current[id] : null
    if (!element) return undefined
    try {
      const text = await element.executeJavaScript(
        'window.getSelection() ? window.getSelection().toString() : ""',
        true
      )
      return typeof text === 'string' && text.trim() ? text.trim() : undefined
    } catch {
      return undefined
    }
  }, [])

  const registerWebview = useCallback((id: string, element: WebviewElement | null) => {
    if (element) webviews.current[id] = element
    else delete webviews.current[id]
  }, [])

  // Bookmarks ------------------------------------------------------------
  const bookmarked = Boolean(
    activeTab && !isNewTab(activeTab.url) && bookmarks.some((bookmark) => bookmark.url === activeTab.url && !bookmark.isFolder)
  )

  const toggleBookmark = useCallback(async () => {
    if (!activeTab || isNewTab(activeTab.url)) return
    const existing = bookmarks.find((bookmark) => bookmark.url === activeTab.url && !bookmark.isFolder)
    try {
      if (existing) {
        await window.electronAPI.bookmarks.remove(existing.id)
        notify('Bookmark removed', 'info')
      } else {
        await window.electronAPI.bookmarks.add({ title: activeTab.title || activeTab.url, url: activeTab.url })
        notify('Bookmark added', 'success')
      }
      await refreshBookmarks()
    } catch (error) {
      notify(`Bookmark failed: ${errorMessage(error)}`, 'error')
    }
  }, [activeTab, bookmarks, notify, refreshBookmarks])

  const handleBookmarkAdd = useCallback(
    async (bookmark: { title: string; url: string; folderId?: string }) => {
      try {
        await window.electronAPI.bookmarks.add(bookmark)
        await refreshBookmarks()
        notify('Bookmark saved', 'success')
      } catch (error) {
        notify(`Could not save bookmark: ${errorMessage(error)}`, 'error')
      }
    },
    [notify, refreshBookmarks]
  )

  const handleBookmarkAddFolder = useCallback(
    async (title: string, parentId?: string) => {
      try {
        await window.electronAPI.bookmarks.addFolder(title, parentId)
        await refreshBookmarks()
      } catch (error) {
        notify(`Could not create folder: ${errorMessage(error)}`, 'error')
      }
    },
    [notify, refreshBookmarks]
  )

  const handleBookmarkUpdate = useCallback(
    async (id: string, updates: { title?: string; url?: string }) => {
      try {
        await window.electronAPI.bookmarks.update(id, updates)
        await refreshBookmarks()
      } catch (error) {
        notify(`Could not update bookmark: ${errorMessage(error)}`, 'error')
      }
    },
    [notify, refreshBookmarks]
  )

  const handleBookmarkDelete = useCallback(
    async (id: string) => {
      try {
        await window.electronAPI.bookmarks.remove(id)
        await refreshBookmarks()
      } catch (error) {
        notify(`Could not delete bookmark: ${errorMessage(error)}`, 'error')
      }
    },
    [notify, refreshBookmarks]
  )

  const handleDownloadAction = useCallback(
    (action: 'pause' | 'resume' | 'cancel' | 'remove' | 'open' | 'show-in-folder' | 'retry', id: string) => {
      const run = async () => {
        switch (action) {
          case 'pause':
            await window.electronAPI.downloads.pause(id)
            break
          case 'resume':
            await window.electronAPI.downloads.resume(id)
            break
          case 'cancel':
            await window.electronAPI.downloads.cancel(id)
            break
          case 'remove':
            await window.electronAPI.downloads.remove(id)
            setDownloads((current) => current.filter((entry) => entry.id !== id))
            break
          case 'open':
            await window.electronAPI.downloads.open(id)
            break
          case 'show-in-folder':
            await window.electronAPI.downloads.showInFolder(id)
            break
          case 'retry':
            await window.electronAPI.downloads.retry(id)
            break
        }
      }
      void run().catch((error) => notify(`Download action failed: ${errorMessage(error)}`, 'error'))
    },
    [notify]
  )

  const clearDownloads = useCallback(() => {
    setDownloads([])
    void window.electronAPI.downloads.clear().catch((error) => notify(errorMessage(error), 'error'))
  }, [notify])

  const clearBrowsingData = useCallback(
    async (options: { history?: boolean; cookies?: boolean; cache?: boolean; permissions?: boolean }) => {
      try {
        await window.electronAPI.app.clearBrowsingData(options)
        if (options.history !== false) await refreshHistory()
        notify('Browsing data cleared', 'success')
      } catch (error) {
        notify(`Could not clear data: ${errorMessage(error)}`, 'error')
      }
    },
    [notify, refreshHistory]
  )

  const respondPermission = useCallback(
    async (decision: 'grant' | 'deny', remember: boolean) => {
      if (!permission) return
      const current = permission
      setPermission(null)
      try {
        await window.electronAPI.permissions.respond(current.id, decision, remember)
      } catch (error) {
        notify(`Permission response failed: ${errorMessage(error)}`, 'error')
      }
    },
    [permission, notify]
  )

  // Tab context menu -----------------------------------------------------
  const openTabMenu = useCallback((id: string, event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setTabMenu({ id, x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - 300) })
  }, [])

  const menuTab = tabMenu ? tabs.find((tab) => tab.id === tabMenu.id) : null

  const runMenuAction = useCallback(
    (action: string) => {
      const tab = menuTab
      setTabMenu(null)
      if (!tab) return
      switch (action) {
        case 'reload':
          void window.electronAPI.tab.navigate(tab.id, tab.url).catch((error) => notify(errorMessage(error), 'error'))
          break
        case 'duplicate':
          void window.electronAPI.tab.duplicate(tab.id).catch((error) => notify(errorMessage(error), 'error'))
          break
        case 'pin':
          void window.electronAPI.tab.pin(tab.id).catch((error) => notify(errorMessage(error), 'error'))
          break
        case 'mute':
          void window.electronAPI.tab.mute(tab.id).catch((error) => notify(errorMessage(error), 'error'))
          break
        case 'copy':
          void navigator.clipboard.writeText(tab.url).then(() => notify('Link copied', 'success')).catch(() => undefined)
          break
        case 'close':
          void closeTab(tab.id)
          break
        case 'close-others':
          void closeOtherTabs(tab.id)
          break
        case 'devtools':
          void switchTab(tab.id).then(() => window.electronAPI.tab.devtools()).catch(() => undefined)
          break
      }
    },
    [menuTab, notify, closeTab, closeOtherTabs, switchTab]
  )

  const isPrivate = windowInfo?.isPrivate === true
  const activeDownloadCount = downloads.filter((entry) => entry.state === 'progressing').length

  if (!ready) {
    return (
      <div className="boot-screen">
        <span className="boot-mark">
          <Icon name="sparkle" size={22} />
        </span>
        <span>Starting Ariadne…</span>
      </div>
    )
  }

  return (
    <div className="app" data-private={isPrivate ? 'true' : undefined}>
      <TabStrip
        tabs={tabs}
        activeTabId={activeId}
        isPrivate={isPrivate}
        aiOpen={aiOpen}
        downloadCount={activeDownloadCount}
        onSelectTab={(id) => void switchTab(id)}
        onCloseTab={(id) => void closeTab(id)}
        onMuteTab={(id) => void window.electronAPI.tab.mute(id).catch(() => undefined)}
        onCreateTab={() => void createTab()}
        onContextMenu={openTabMenu}
        onReorder={(from, to) => {
          setTabs((current) => {
            const next = [...current]
            const [moved] = next.splice(from, 1)
            if (moved) next.splice(to, 0, moved)
            return next
          })
          void window.electronAPI.tab.reorder(from, to).catch(() => undefined)
        }}
        onToggleAi={toggleAi}
        onOpenDownloads={() => setDownloadsOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenSettings={() => openSettings('general')}
      />

      <div className="browser-shell">
        <header className="toolbar">
          <AddressBar
            value={activeTab?.url ?? ''}
            isLoading={activeTab?.loading === true}
            canGoBack={activeTab?.canGoBack === true}
            canGoForward={activeTab?.canGoForward === true}
            focusToken={addressFocusToken}
            suggestions={suggestions}
            onChange={setAddressQuery}
            onNavigate={navigate}
            onSelectSuggestion={(suggestion) => {
              if (suggestion.tabId) void switchTab(suggestion.tabId)
              else navigate(suggestion.value)
            }}
            onFocus={() => void refreshHistory()}
            onBlur={() => setAddressQuery('')}
            onBack={() => void window.electronAPI.tab.back().catch(() => undefined)}
            onForward={() => void window.electronAPI.tab.forward().catch(() => undefined)}
            onReload={() => void window.electronAPI.tab.reload().catch(() => undefined)}
            onStop={() => void window.electronAPI.tab.stop().catch(() => undefined)}
            onHome={() => navigate(settings.homePage || NEW_TAB)}
          />

          <div className="toolbar-actions">
            <button
              className={`icon-btn ${bookmarked ? 'active' : ''}`}
              onClick={() => void toggleBookmark()}
              title={bookmarked ? 'Remove bookmark' : 'Bookmark this page (Ctrl+D)'}
              aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
              disabled={!activeTab || isNewTab(activeTab.url)}
            >
              <Icon name="star" filled={bookmarked} />
            </button>
            <button
              className={`icon-btn ${downloadsOpen ? 'active' : ''}`}
              onClick={() => setDownloadsOpen((open) => !open)}
              title="Downloads (Ctrl+J)"
              aria-label="Downloads"
            >
              <Icon name="download" />
              {activeDownloadCount > 0 && <span className="icon-badge">{activeDownloadCount}</span>}
            </button>
            <button
              className={`icon-btn ${historyOpen ? 'active' : ''}`}
              onClick={() => setHistoryOpen((open) => !open)}
              title="History (Ctrl+H)"
              aria-label="History"
            >
              <Icon name="history" />
            </button>
            <button
              className={`icon-btn ${settingsOpen ? 'active' : ''}`}
              onClick={() => openSettings('general')}
              title="Settings"
              aria-label="Settings"
            >
              <Icon name="settings" />
            </button>
            <button
              className={`icon-btn ai-toggle ${aiOpen ? 'active' : ''}`}
              onClick={toggleAi}
              title="Ask Ariadne (Ctrl+Shift+A)"
              aria-label="Toggle AI sidebar"
              aria-pressed={aiOpen}
            >
              <Icon name="sparkle" />
            </button>
          </div>
        </header>

        {settings.showBookmarksBar && (
          <BookmarksBar
            bookmarks={bookmarks}
            onNavigate={navigate}
            onAdd={(bookmark) => void handleBookmarkAdd(bookmark)}
            onAddFolder={(title, parentId) => void handleBookmarkAddFolder(title, parentId)}
            onUpdate={(id, updates) => void handleBookmarkUpdate(id, updates)}
            onDelete={(id) => void handleBookmarkDelete(id)}
            onToggle={() => void updateSettings({ showBookmarksBar: false })}
          />
        )}

        {findOpen && (
          <div className="find-bar">
            <Icon name="search" size={14} />
            <input
              value={findQuery}
              onChange={(event) => setFindQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  findAgain(!event.shiftKey)
                }
                if (event.key === 'Escape') closeFind()
              }}
              placeholder="Find in page"
              autoFocus
              aria-label="Find in page"
            />
            <span className="find-count">
              {findResult.matches > 0 ? `${findResult.activeMatchOrdinal} / ${findResult.matches}` : findQuery ? 'No matches' : ''}
            </span>
            <button className="icon-btn" onClick={() => findAgain(false)} title="Previous match (Shift+Enter)" aria-label="Previous match">
              <Icon name="back" size={14} />
            </button>
            <button className="icon-btn" onClick={() => findAgain(true)} title="Next match (Enter)" aria-label="Next match">
              <Icon name="forward" size={14} />
            </button>
            <button className="icon-btn" onClick={closeFind} title="Close find bar (Esc)">
              <Icon name="close" />
            </button>
          </div>
        )}

        {loadError && (
          <div className="error-banner" role="alert">
            <Icon name="alert" size={15} />
            <span>
              <strong>{loadError.errorDescription || 'Page failed to load'}</strong>
              <span className="error-url">{hostOf(loadError.url)}</span>
            </span>
            <button
              className="text-btn"
              onClick={() => {
                void window.electronAPI.tab.navigate(loadError.tabId, loadError.url).catch((error) => notify(errorMessage(error), 'error'))
                setLoadError(null)
              }}
            >
              Retry
            </button>
            <button className="icon-btn" onClick={() => setLoadError(null)} title="Dismiss">
              <Icon name="close" size={14} />
            </button>
          </div>
        )}

        <div className="workspace">
          <div className="view-stack">
            {windowInfo &&
              tabs.map((tab, index) => {
                const isActive = activeId ? tab.id === activeId : index === 0
                return (
                  <WebviewPane
                    key={tab.id}
                    tab={tab}
                    partition={windowInfo.partition}
                    active={isActive}
                    register={registerWebview}
                    isNewTabPage={isNewTab(tab.url)}
                    ntpProps={isActive && isNewTab(tab.url) ? {
                      onSubmit: navigate,
                      onNavigate: navigate,
                      topSites,
                      recentlyClosed: closedTabs,
                      searchEngineName: activeEngine.name,
                      isPrivate,
                    } : undefined}
                  />
                )
              })}
            {!activeTab && (
              <div className="empty-workspace">
                <p>No tabs are open.</p>
                <button className="primary-btn" onClick={() => void createTab()}>
                  <Icon name="plus" size={15} /> New tab
                </button>
              </div>
            )}
          </div>

          {aiOpen && <div className="ai-resizer" onPointerDown={beginResize} role="separator" aria-orientation="vertical" />}

          <ChatSidebar
            isOpen={aiOpen}
            onClose={toggleAi}
            activeTab={activeTab}
            isPrivate={isPrivate}
            width={aiWidth}
            onOpenTab={(id) => {
              setContextOpen(false)
              void switchTab(id)
            }}
            onOpenContext={() => setContextOpen(true)}
            onOpenSettings={() => openSettings('ai')}
            notify={notify}
          />

          <ContextPicker
            isOpen={contextOpen}
            onClose={() => setContextOpen(false)}
            activeTabId={activeTab?.id}
            getActiveSelection={getActiveSelection}
            onOpenTab={(tabId) => {
              setContextOpen(false)
              void switchTab(tabId)
            }}
          />
        </div>

        <footer className="status-bar">
          <span className={`status-indicator ${activeTab?.loading ? 'loading' : ''}`} />
          <span className="status-url">{activeTab ? (isNewTab(activeTab.url) ? 'New tab' : activeTab.url) : 'Ready'}</span>
          <span className="status-spacer" />
          {activeTab?.crashed && <span className="status-warning">Page crashed — reload to recover</span>}
          {activeTab && (activeTab.zoomFactor || 1) !== 1 && (
            <span className="status-meta">{Math.round((activeTab.zoomFactor || 1) * 100)}%</span>
          )}
          {isPrivate && (
            <span className="status-meta private">
              <Icon name="lock" size={11} /> Private
            </span>
          )}
          {activeDownloadCount > 0 && (
            <button className="status-meta status-button" onClick={() => setDownloadsOpen(true)}>
              <Icon name="download" size={11} /> {activeDownloadCount} downloading
            </button>
          )}
          {memoryStats && (
            <span className={`status-meta memory ${memoryStats.totalMB > memoryStats.budgetMB * 0.9 ? 'warn' : ''}`}>
              <Icon name="shield" size={11} /> {memoryStats.totalMB} MB
            </span>
          )}
          <span className="status-meta">{activeEngine.name}</span>
        </footer>
      </div>

      {downloadsOpen && (
        <DownloadsPanel
          isOpen={downloadsOpen}
          onClose={() => setDownloadsOpen(false)}
          downloads={downloads}
          onPause={(id) => handleDownloadAction('pause', id)}
          onResume={(id) => handleDownloadAction('resume', id)}
          onCancel={(id) => handleDownloadAction('cancel', id)}
          onRemove={(id) => handleDownloadAction('remove', id)}
          onOpenFile={(id) => handleDownloadAction('open', id)}
          onShowInFolder={(id) => handleDownloadAction('show-in-folder', id)}
          onClearAll={clearDownloads}
          onRetry={(id) => handleDownloadAction('retry', id)}
        />
      )}

      {historyOpen && (
        <HistoryPage
          isOpen={historyOpen}
          onClose={() => {
            setHistoryOpen(false)
            void refreshHistory()
          }}
          onNavigate={(url) => {
            setHistoryOpen(false)
            navigate(url)
          }}
          onDeleteEntry={(id) => {
            void window.electronAPI.history.remove(id).then(() => refreshHistory())
          }}
          onClearHistory={(options) => {
            void window.electronAPI.history.clear(options).then(() => refreshHistory())
          }}
        />
      )}

      {settingsOpen && (
        <SettingsPage
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          initialSection={settingsSection}
          settings={settings}
          searchEngines={searchEngines}
          appInfo={appInfo}
          onSave={updateSettings}
          onClearData={clearBrowsingData}
          onOpenAI={() => {
            setSettingsOpen(false)
            setAiOpen(true)
          }}
        />
      )}

      {tabMenu && menuTab && (
        <div className="menu-scrim" onMouseDown={() => setTabMenu(null)}>
          <div
            className="context-menu"
            style={{ left: tabMenu.x, top: tabMenu.y }}
            onMouseDown={(event) => event.stopPropagation()}
            role="menu"
          >
            <div className="context-menu-title">{menuTab.title || hostOf(menuTab.url)}</div>
            <button onClick={() => runMenuAction('reload')} role="menuitem">
              <Icon name="reload" size={14} /> Reload
            </button>
            <button onClick={() => runMenuAction('duplicate')} role="menuitem">
              <Icon name="copy" size={14} /> Duplicate tab
            </button>
            <button onClick={() => runMenuAction('pin')} role="menuitem">
              <Icon name="pin" size={14} /> {menuTab.pinned ? 'Unpin tab' : 'Pin tab'}
            </button>
            <button onClick={() => runMenuAction('mute')} role="menuitem">
              <Icon name={menuTab.muted ? 'volume' : 'mute'} size={14} /> {menuTab.muted ? 'Unmute tab' : 'Mute tab'}
            </button>
            <button onClick={() => runMenuAction('copy')} role="menuitem">
              <Icon name="external" size={14} /> Copy link
            </button>
            <div className="context-menu-sep" />
            <button onClick={() => runMenuAction('devtools')} role="menuitem">
              <Icon name="settings" size={14} /> Inspect element
            </button>
            <button onClick={() => runMenuAction('close')} role="menuitem" className="danger">
              <Icon name="close" size={14} /> Close tab
            </button>
            <button onClick={() => runMenuAction('close-others')} role="menuitem">
              <Icon name="close" size={14} /> Close other tabs
            </button>
          </div>
        </div>
      )}

      {permission && (
        <div className="permission-popover" role="dialog" aria-modal="false" aria-label="Permission request">
          <div className="permission-head">
            <Icon name="shield" size={16} />
            <strong>Permission request</strong>
          </div>
          <p>
            <span className="permission-origin">{permission.origin}</span> wants to use{' '}
            <strong>{permission.permission.replace(/-/g, ' ')}</strong>.
          </p>
          <label className="permission-remember">
            <input type="checkbox" id="remember-permission" /> Remember this decision for this site
          </label>
          <div className="permission-actions">
            <button
              className="text-btn"
              onClick={() => void respondPermission('deny', Boolean((document.getElementById('remember-permission') as HTMLInputElement | null)?.checked))}
            >
              Block
            </button>
            <button
              className="primary-btn small"
              onClick={() => void respondPermission('grant', Boolean((document.getElementById('remember-permission') as HTMLInputElement | null)?.checked))}
            >
              Allow
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.kind}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  )
}

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Ariadne UI crashed', error, info)
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="boot-screen">
          <div className="boot-card" role="alert">
            <h1>Ariadne hit an error</h1>
            <p>The interface could not start. This is a bug, not something you did.</p>
            <pre className="boot-error">{this.state.error.message}</pre>
            <button className="primary-btn" onClick={() => window.location.reload()}>
              Reload interface
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
)
