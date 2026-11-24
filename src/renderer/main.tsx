import React, { useState, useCallback, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import { ChatSidebar } from './components/ai/ChatSidebar'
import { TabStrip } from './components/TabStrip'
import { AddressBar } from './components/AddressBar'
import { DownloadsPanel } from './components/DownloadsPanel'
import { BookmarksBar } from './components/BookmarksBar'
import { HistoryPage } from './components/HistoryPage'
import { SettingsPage } from './components/SettingsPage'
import { NewTabPage } from './components/NewTabPage'
import './styles.css'

interface Tab {
  id: string
  url: string
  title: string
  active: boolean
  pinned?: boolean
  muted?: boolean
  loading?: boolean
  favicon?: string
  audioPlaying?: boolean
  zoomFactor?: number
}

interface DownloadItem {
  id: string
  url: string
  filename: string
  totalBytes: number
  receivedBytes: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  startTime: number
  endTime?: number
  mimeType?: string
  filePath?: string
  canResume: boolean
  isDangerous?: boolean
}

interface Bookmark {
  id: string
  title: string
  url: string
  folderId?: string
  parentId?: string
  isFolder: boolean
  children?: Bookmark[]
  dateAdded: number
  dateModified?: number
}

interface SearchSuggestion {
  type: 'history' | 'bookmark' | 'tab' | 'search' | 'url'
  text: string
  url?: string
  title?: string
  icon?: string
}

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [currentTabId, setCurrentTabId] = useState<string | null>(null)
  const [address, setAddress] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showAISidebar, setShowAISidebar] = useState(false)
  const [showDownloads, setShowDownloads] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showBookmarksBar, setShowBookmarksBar] = useState(true)
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [closedTabs, setClosedTabs] = useState<Tab[]>([])
  const [searchSuggestions, setSearchSuggestions] = useState<SearchSuggestion[]>([])
  const [showSearchSuggestions, setShowSearchSuggestions] = useState(false)
  const [topSites, setTopSites] = useState<Array<{url: string; title: string; favicon?: string; visitCount: number}>>([])
  const [recentlyClosed, setRecentlyClosed] = useState<Array<{id: string; url: string; title: string}>>([])
  const [searchEngine, setSearchEngine] = useState({ name: 'Google', url: 'https://www.google.com/search?q=%s', keyword: 'g' })
  const [findInPageActive, setFindInPageActive] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findMatches, setFindMatches] = useState(0)
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)
  const webviewRef = useRef<any>(null)
  const isNavigatingRef = useRef(false)
  const activeWebviewRef = useRef<any>(null)

  // Load initial data
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [tabsData, downloadsData, bookmarksData, settingsData, closedTabsData] = await Promise.all([
          window.electronAPI.getTabs(),
          window.electronAPI.downloads.get(),
          window.electronAPI.getBookmarks(),
          window.electronAPI.settings.get(),
          window.electronAPI.tab.getClosedTabs(),
        ])
        
        setTabs(tabsData)
        setDownloads(downloadsData)
        setBookmarks(bookmarksData)
        setClosedTabs(closedTabsData)
        
        if (settingsData) {
          setShowBookmarksBar(settingsData.showBookmarksBar !== false)
        }
        
        const activeTab = tabsData.find(t => t.active) || tabsData[0]
        if (activeTab) {
          setCurrentTabId(activeTab.id)
          setAddress(activeTab.url)
        }
        
        // Load top sites from history
        const history = await window.electronAPI.getHistory()
        const siteCounts: Record<string, { url: string; title: string; count: number }> = {}
        for (const entry of history) {
          try {
            const url = new URL(entry.url)
            const key = url.origin
            if (!siteCounts[key]) {
              siteCounts[key] = { url: entry.url, title: entry.title || url.hostname, count: 0 }
            }
            siteCounts[key].count++
          } catch {}
        }
        const sortedSites = Object.values(siteCounts)
          .sort((a, b) => b.count - a.count)
          .slice(0, 8)
          .map(s => ({ url: s.url, title: s.title, visitCount: s.count }))
        setTopSites(sortedSites)
      } catch (e) {
        console.error('Failed to load initial data:', e)
      }
    }
    loadInitialData()
  }, [])

  // Listen for tab updates
  useEffect(() => {
    const unsubscribeTabs = window.electronAPI.on('tabs-updated', () => {
      window.electronAPI.getTabs().then((newTabs) => {
        setTabs(newTabs)
        const active = newTabs.find(t => t.active)
        if (active && active.id !== currentTabId) {
          setCurrentTabId(active.id)
          setAddress(active.url)
        }
        if (!newTabs.find(t => t.id === currentTabId)) {
          const first = newTabs[0]
          if (first) {
            setCurrentTabId(first.id)
            setAddress(first.url)
          }
        }
      })
    })
    return () => unsubscribeTabs()
  }, [currentTabId])

  // Listen for navigation events
  useEffect(() => {
    const unsubscribeNavigate = window.electronAPI.on('url-changed', (_event: any, tabId: string, url: string, title: string) => {
      setTabs(prev => prev.map(t => t.id === tabId ? { ...t, url, title } : t))
      if (tabId === currentTabId) {
        setAddress(url)
        setIsLoading(false)
      }
    })
    return () => unsubscribeNavigate()
  }, [currentTabId])

  // Listen for download updates
  useEffect(() => {
    const unsubscribeDownload = window.electronAPI.on('download-updated', (_event: any, download: DownloadItem) => {
      setDownloads(prev => {
        const idx = prev.findIndex(d => d.id === download.id)
        if (idx >= 0) {
          const updated = [...prev]
          updated[idx] = download
          return updated
        }
        return [download, ...prev]
      })
    })
    return () => unsubscribeDownload()
  }, [])

  // Listen for keyboard shortcuts
  useEffect(() => {
    const unsubscribeShortcut = window.electronAPI.on('shortcut', (_event: any, action: string) => {
      handleShortcut(action)
    })
    return () => unsubscribeShortcut()
  }, [])

  // Listen for tab pinned/muted updates
  useEffect(() => {
    const unsubscribePinned = window.electronAPI.on('tab-pinned', (_event: any, tabId: string, pinned: boolean) => {
      setTabs(prev => prev.map(t => t.id === tabId ? { ...t, pinned } : t))
    })
    const unsubscribeMuted = window.electronAPI.on('tab-muted', (_event: any, tabId: string, muted: boolean) => {
      setTabs(prev => prev.map(t => t.id === tabId ? { ...t, muted } : t))
    })
    return () => {
      unsubscribePinned()
      unsubscribeMuted()
    }
  }, [])

  // Listen for permission requests
  useEffect(() => {
    const unsubscribePerm = window.electronAPI.on('permission-request', (_event: any, data: { origin: string; permission: string }) => {
      // Show permission dialog
      console.log('Permission request:', data)
    })
    return () => unsubscribePerm()
  }, [])

  const handleShortcut = useCallback((action: string) => {
    switch (action) {
      case 'new-tab':
        createTab()
        break
      case 'close-tab':
        if (currentTabId) closeTab(currentTabId)
        break
      case 'reopen-closed-tab':
        reopenClosedTab()
        break
      case 'next-tab':
        switchTabRelative(1)
        break
      case 'prev-tab':
        switchTabRelative(-1)
        break
      case 'focus-address':
        // Focus handled by AddressBar
        break
      case 'find-in-page':
        setFindInPageActive(true)
        break
      case 'find-next':
        findInPageNext()
        break
      case 'find-prev':
        findInPagePrev()
        break
      case 'reload':
        reload()
        break
      case 'force-reload':
        forceReload()
        break
      case 'stop':
        stop()
        break
      case 'back':
        back()
        break
      case 'forward':
        forward()
        break
      case 'home':
        goHome()
        break
      case 'open-downloads':
        setShowDownloads(true)
        break
      case 'open-history':
        setShowHistory(true)
        break
      case 'toggle-bookmarks':
        setShowBookmarksBar(!showBookmarksBar)
        break
      case 'toggle-ai':
        setShowAISidebar(!showAISidebar)
        break
      case 'devtools':
        if (mainWindow) mainWindow.webContents.toggleDevTools()
        break
      case 'zoom-in':
        zoomIn()
        break
      case 'zoom-out':
        zoomOut()
        break
      case 'zoom-reset':
        zoomReset()
        break
      case 'fullscreen':
        fullscreen()
        break
      case 'print':
        print()
        break
      case 'view-source':
        viewSource()
        break
      case 'new-window':
        createWindow(false)
        break
      case 'new-private-window':
        createWindow(true)
        break
    }
  }, [currentTabId])

  const createTab = useCallback((url?: string) => {
    window.electronAPI.createTab(url || 'about:blank').then((id) => {
      window.electronAPI.getTabs().then((newTabs) => {
        setTabs(newTabs)
        const newTab = newTabs.find(t => t.id === id)
        if (newTab) {
          setCurrentTabId(id)
          setAddress(url || 'about:blank')
        }
      })
    })
  }, [])

  const closeTab = useCallback((id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    window.electronAPI.closeTab(id).then(() => {
      window.electronAPI.getTabs().then((newTabs) => {
        setTabs(newTabs)
        window.electronAPI.getClosedTabs().then(setClosedTabs)
        if (currentTabId === id) {
          const active = newTabs.find(t => t.active) || newTabs[0]
          if (active) {
            setCurrentTabId(active.id)
            setAddress(active.url)
          } else {
            setCurrentTabId(null)
            setAddress('')
          }
        }
      })
    })
  }, [currentTabId])

  const switchTab = useCallback((id: string) => {
    if (id === currentTabId) return
    isNavigatingRef.current = true
    setIsLoading(true)
    window.electronAPI.setActiveTab(id).then(() => {
      window.electronAPI.getTabs().then((newTabs) => {
        const tab = newTabs.find(t => t.id === id)
        if (tab) {
          setCurrentTabId(id)
          setAddress(tab.url)
          if (activeWebviewRef.current) {
            activeWebviewRef.current.src = tab.url
          }
        }
        setTabs(newTabs)
        isNavigatingRef.current = false
      })
    })
  }, [currentTabId])

  const switchTabRelative = useCallback((delta: number) => {
    const currentIndex = tabs.findIndex(t => t.id === currentTabId)
    if (currentIndex === -1) return
    const newIndex = (currentIndex + delta + tabs.length) % tabs.length
    switchTab(tabs[newIndex].id)
  }, [tabs, currentTabId, switchTab])

  const isValidUrl = (str: string): boolean => {
    try {
      const url = new URL(str.startsWith('http') ? str : 'http://' + str)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }

  const navigate = useCallback((newUrl: string) => {
    if (!currentTabId) return
    isNavigatingRef.current = true
    setIsLoading(true)
    const trimmed = newUrl.trim()
    if (isValidUrl(trimmed)) {
      const url = trimmed.startsWith('http') ? trimmed : 'https://' + trimmed
      window.electronAPI.setUrl(currentTabId, url)
      setAddress(url)
    } else {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
      window.electronAPI.setUrl(currentTabId, searchUrl)
      setAddress(searchUrl)
    }
  }, [currentTabId])

  const back = useCallback(() => {
    if (!currentTabId) return
    window.electronAPI.back()
  }, [currentTabId])

  const forward = useCallback(() => {
    if (!currentTabId) return
    window.electronAPI.forward()
  }, [currentTabId])

  const reload = useCallback(() => {
    if (!currentTabId) return
    window.electronAPI.reload()
  }, [currentTabId])

  const forceReload = useCallback(() => {
    if (!currentTabId) return
    if (activeWebviewRef.current) {
      activeWebviewRef.current.reloadIgnoringCache()
    }
  }, [currentTabId])

  const stop = useCallback(() => {
    if (!currentTabId) return
    window.electronAPI.stop()
    setIsLoading(false)
  }, [currentTabId])

  const goHome = useCallback(() => {
    navigate('https://example.com')
  }, [navigate])

  const duplicateTab = useCallback((id: string) => {
    window.electronAPI.duplicateTab(id).then(() => {
      window.electronAPI.getTabs().then(setTabs)
    })
  }, [])

  const pinTab = useCallback((id: string) => {
    window.electronAPI.pinTab(id)
  }, [])

  const muteTab = useCallback((id: string) => {
    window.electronAPI.muteTab(id)
  }, [])

  const reorderTab = useCallback((fromIndex: number, toIndex: number) => {
    window.electronAPI.reorderTab(fromIndex, toIndex).then((newTabs: any) => {
      setTabs(newTabs)
    })
  }, [])

  const reopenClosedTab = useCallback(() => {
    window.electronAPI.reopenClosedTab().then(() => {
      window.electronAPI.getTabs().then(setTabs)
      window.electronAPI.getClosedTabs().then(setClosedTabs)
    })
  }, [])

  const zoomIn = useCallback(() => {
    if (!currentTabId) return
    const tab = tabs.find(t => t.id === currentTabId)
    const newZoom = Math.min((tab?.zoomFactor || 1) + 0.1, 3)
    window.electronAPI.setTabZoom(currentTabId, newZoom)
  }, [currentTabId, tabs])

  const zoomOut = useCallback(() => {
    if (!currentTabId) return
    const tab = tabs.find(t => t.id === currentTabId)
    const newZoom = Math.max((tab?.zoomFactor || 1) - 0.1, 0.3)
    window.electronAPI.setTabZoom(currentTabId, newZoom)
  }, [currentTabId, tabs])

  const zoomReset = useCallback(() => {
    if (!currentTabId) return
    window.electronAPI.setTabZoom(currentTabId, 1.0)
  }, [currentTabId])

  const fullscreen = useCallback(() => {
    if (!currentTabId) return
    window.electronAPI.tab.fullscreen(currentTabId)
  }, [currentTabId])

  const print = useCallback(() => {
    if (!currentTabId) return
    window.electronAPI.tab.print(currentTabId)
  }, [currentTabId])

  const viewSource = useCallback(() => {
    if (!currentTabId) return
    window.electronAPI.tab.viewSource(currentTabId)
  }, [currentTabId])

  const findInPage = useCallback((query: string) => {
    if (!currentTabId || !query) return
    window.electronAPI.findInPage(currentTabId, query).then((result: any) => {
      setFindMatches(result.matches)
      setActiveMatchIndex(result.activeMatchOrdinal)
    })
  }, [currentTabId])

  const findInPageNext = useCallback(() => {
    if (!currentTabId || !findQuery) return
    window.electronAPI.findInPage(currentTabId, findQuery, { forward: true }).then((result: any) => {
      setActiveMatchIndex(result.activeMatchOrdinal)
    })
  }, [currentTabId, findQuery])

  const findInPagePrev = useCallback(() => {
    if (!currentTabId || !findQuery) return
    window.electronAPI.findInPage(currentTabId, findQuery, { forward: false }).then((result: any) => {
      setActiveMatchIndex(result.activeMatchOrdinal)
    })
  }, [currentTabId, findQuery])

  const stopFinding = useCallback(() => {
    if (!currentTabId) return
    window.electronAPI.stopFinding(currentTabId, 'clear')
    setFindInPageActive(false)
    setFindQuery('')
    setFindMatches(0)
    setActiveMatchIndex(0)
  }, [currentTabId])

  const createWindow = useCallback((privateWindow: boolean) => {
    window.electronAPI.window.create({ private: privateWindow })
  }, [])

  const handleAddressChange = useCallback((value: string) => {
    setAddress(value)
    // Generate search suggestions
    if (value.length > 1) {
      // Generate suggestions from history, bookmarks, tabs
      const suggestions: SearchSuggestion[] = []
      
      // History suggestions
      window.electronAPI.getHistory().then((history: any[]) => {
        for (const entry of history.slice(0, 5)) {
          if (entry.title.toLowerCase().includes(value.toLowerCase()) || entry.url.toLowerCase().includes(value.toLowerCase())) {
            suggestions.push({ type: 'history', text: entry.title, url: entry.url, icon: '🕒' })
          }
        }
        // Bookmark suggestions
        for (const bm of bookmarks.filter(b => !b.isFolder).slice(0, 3)) {
          if (bm.title.toLowerCase().includes(value.toLowerCase()) || bm.url.toLowerCase().includes(value.toLowerCase())) {
            suggestions.push({ type: 'bookmark', text: bm.title, url: bm.url, icon: '★' })
          }
        }
        // Tab suggestions
        for (const tab of tabs.filter(t => t.id !== currentTabId).slice(0, 3)) {
          if (tab.title.toLowerCase().includes(value.toLowerCase()) || tab.url.toLowerCase().includes(value.toLowerCase())) {
            suggestions.push({ type: 'tab', text: tab.title, url: tab.url, icon: '📄' })
          }
        }
        // Search suggestion
        if (!isValidUrl(value)) {
          suggestions.unshift({ type: 'search', text: `Search Google for "${value}"`, icon: '🔍' })
        } else {
          suggestions.unshift({ type: 'url', text: `Go to ${value}`, url: value.startsWith('http') ? value : 'https://' + value, icon: '🌐' })
        }
        setSearchSuggestions(suggestions)
        setShowSearchSuggestions(suggestions.length > 0)
      })
    } else {
      setSearchSuggestions([])
      setShowSearchSuggestions(false)
    }
  }, [bookmarks, tabs, currentTabId])

  const handleAddressSubmit = useCallback((value: string) => {
    setShowSearchSuggestions(false)
    navigate(value)
  }, [navigate])

  const handleAddressFocus = useCallback(() => {
    // Focus handling
  }, [])

  const handleAddressBlur = useCallback(() => {
    setTimeout(() => setShowSearchSuggestions(false), 200)
  }, [])

  const handleDownloadAction = useCallback((action: string, id: string) => {
    switch (action) {
      case 'pause':
        window.electronAPI.downloads.pause(id)
        break
      case 'resume':
        window.electronAPI.downloads.resume(id)
        break
      case 'cancel':
        window.electronAPI.downloads.cancel(id)
        break
      case 'remove':
        window.electronAPI.downloads.remove(id).then(() => {
          setDownloads(prev => prev.filter(d => d.id !== id))
        })
        break
      case 'open':
        window.electronAPI.downloads.open(id)
        break
      case 'show-in-folder':
        window.electronAPI.downloads.showInFolder(id)
        break
      case 'retry':
        window.electronAPI.downloads.retry(id)
        break
    }
  }, [])

  const handleBookmarkAction = useCallback((action: string, data: any) => {
    switch (action) {
      case 'add':
        window.electronAPI.addBookmark(data).then(() => {
          window.electronAPI.getBookmarks().then(setBookmarks)
        })
        break
      case 'add-folder':
        window.electronAPI.addBookmarkFolder(data.title, data.parentId).then(() => {
          window.electronAPI.getBookmarks().then(setBookmarks)
        })
        break
      case 'update':
        window.electronAPI.updateBookmark(data.id, data.updates).then(() => {
          window.electronAPI.getBookmarks().then(setBookmarks)
        })
        break
      case 'delete':
        window.electronAPI.deleteBookmark(data.id).then(() => {
          window.electronAPI.getBookmarks().then(setBookmarks)
        })
        break
      case 'move':
        window.electronAPI.moveBookmark(data.id, data.parentId, data.index).then(() => {
          window.electronAPI.getBookmarks().then(setBookmarks)
        })
        break
    }
  }, [])

  const handleClearDownloads = useCallback(() => {
    window.electronAPI.downloads.clear().then(() => {
      setDownloads([])
    })
  }, [])

  const handleClearHistory = useCallback((options?: { since?: number }) => {
    window.electronAPI.clearHistory(options).then(() => {
      window.electronAPI.getHistory().then((history: any[]) => {
        // Update top sites
        const siteCounts: Record<string, { url: string; title: string; count: number }> = {}
        for (const entry of history) {
          try {
            const url = new URL(entry.url)
            const key = url.origin
            if (!siteCounts[key]) {
              siteCounts[key] = { url: entry.url, title: entry.title || url.hostname, count: 0 }
            }
            siteCounts[key].count++
          } catch {}
        }
        const sortedSites = Object.values(siteCounts)
          .sort((a, b) => b.count - a.count)
          .slice(0, 8)
          .map(s => ({ url: s.url, title: s.title, visitCount: s.count }))
        setTopSites(sortedSites)
      })
    })
  }, [])

  const handleSettingsChange = useCallback((settings: any) => {
    window.electronAPI.settings.set(settings).then(() => {
      if (settings.showBookmarksBar !== undefined) {
        setShowBookmarksBar(settings.showBookmarksBar)
      }
    })
  }, [])

  const activeTab = tabs.find(t => t.id === currentTabId)

  return (
    <div className="app">
      <div className="browser-bar">
        <BookmarksBar
          bookmarks={bookmarks}
          onNavigate={navigate}
          onEditBookmark={(b) => handleBookmarkAction('update', { id: b.id, updates: { title: b.title, url: b.url } })}
          onDeleteBookmark={(id) => handleBookmarkAction('delete', { id })}
          onCreateBookmark={(parentId, title, url, isFolder) => {
            if (isFolder) {
              handleBookmarkAction('add-folder', { title, parentId })
            } else {
              handleBookmarkAction('add', { title, url, folderId: parentId })
            }
          }}
          showBookmarksBar={showBookmarksBar}
          toggleBookmarksBar={() => setShowBookmarksBar(!showBookmarksBar)}
        />
        <AddressBar
          value={address}
          onChange={handleAddressChange}
          onSubmit={handleAddressSubmit}
          onFocus={handleAddressFocus}
          onBlur={handleAddressBlur}
          isLoading={isLoading}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onBack={back}
          onForward={forward}
          onReload={isLoading ? stop : reload}
          onStop={stop}
          onHome={goHome}
          onNewTab={createTab}
          onToggleAISidebar={() => setShowAISidebar(!showAISidebar)}
          showAISidebar={showAISidebar}
          suggestions={searchSuggestions}
          showSuggestions={showSearchSuggestions}
        />
        <TabStrip
          tabs={tabs}
          activeTabId={currentTabId}
          onCreateTab={createTab}
          onCloseTab={closeTab}
          onSwitchTab={switchTab}
          onPinTab={pinTab}
          onMuteTab={muteTab}
          onDuplicateTab={duplicateTab}
          onReopenClosedTab={reopenClosedTab}
          onReorderTab={reorderTab}
          onTabContextMenu={(id, e) => { /* Context menu TBD */ }}
          closedTabs={closedTabs}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onBack={back}
          onForward={forward}
          onReload={isLoading ? stop : reload}
          onStop={stop}
          isLoading={isLoading}
        />
        {findInPageActive && (
          <div className="find-bar">
            <input
              type="text"
              className="find-input"
              placeholder="Find in page..."
              value={findQuery}
              onChange={e => { setFindQuery(e.target.value); findInPage(e.target.value); }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  if (e.shiftKey) findInPagePrev()
                  else findInPageNext()
                } else if (e.key === 'Escape') {
                  stopFinding()
                }
              }}
              autoFocus
            />
            <span className="find-count">{findMatches > 0 ? `${activeMatchIndex} of ${findMatches}` : 'No matches'}</span>
            <button className="find-btn" onClick={findInPagePrev} title="Previous">▲</button>
            <button className="find-btn" onClick={findInPageNext} title="Next">▼</button>
            <button className="find-btn" onClick={stopFinding} title="Close">✕</button>
          </div>
        )}
      </div>

      <div className="main-content">
        <div className="webview-area">
          {currentTabId ? (
            <webview
              ref={(el) => { webviewRef.current = el; activeWebviewRef.current = el; }}
              src={address}
              partition="persist:ariadne"
              style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
              ondid-start-load={() => { if (!isNavigatingRef.current) setIsLoading(true); }}
              ondid-finish-load={() => {
                setIsLoading(false)
                if (currentTabId && webviewRef.current) {
                  window.electronAPI.setTabWebContents(currentTabId, webviewRef.current.getWebContentsId())
                  const wc = webviewRef.current.getWebContents()
                  if (wc) {
                    setCanGoBack(wc.canGoBack())
                    setCanGoForward(wc.canGoForward())
                  }
                }
              }}
              ondid-navigate={(e) => {
                if (currentTabId) {
                  window.electronAPI.addHistory(e.url, e.title || '')
                  window.electronAPI.setUrl(currentTabId, e.url)
                }
              }}
              ondid-stop-loading={() => setIsLoading(false)}
              onpage-title-updated={(e) => {
                if (currentTabId) {
                  window.electronAPI.setTabTitle(currentTabId, e.title || '')
                }
              }}
              onpage-favicon-updated={(e) => {
                if (currentTabId && e.favicons.length > 0) {
                  setTabs(prev => prev.map(t => t.id === currentTabId ? { ...t, favicon: e.favicons[0] } : t))
                }
              }}
              onconsole-message={(e) => {
                if (e.level === 'error') {
                  console.log('Webview error:', e.message)
                }
              }}
              onipc-message={(e) => {
                if (e.channel === 'audio-state-changed') {
                  setTabs(prev => prev.map(t => t.id === currentTabId ? { ...t, audioPlaying: e.args[0] } : t))
                }
              }}
            ></webview>
          ) : (
            <NewTabPage
              onNavigate={navigate}
              onSearch={navigate}
              topSites={topSites}
              recentlyClosed={recentlyClosed}
              searchEngine={searchEngine}
            />
          )}
        </div>

        <ChatSidebar isOpen={showAISidebar} onClose={() => setShowAISidebar(false)} activeTabId={currentTabId} />

        {showDownloads && (
          <DownloadsPanel
            isOpen={showDownloads}
            onClose={() => setShowDownloads(false)}
            downloads={downloads}
            onPause={(id) => handleDownloadAction('pause', id)}
            onResume={(id) => handleDownloadAction('resume', id)}
            onCancel={(id) => handleDownloadAction('cancel', id)}
            onRemove={(id) => handleDownloadAction('remove', id)}
            onOpenFile={(id) => handleDownloadAction('open', id)}
            onShowInFolder={(id) => handleDownloadAction('show-in-folder', id)}
            onClearAll={handleClearDownloads}
            onRetry={(id) => handleDownloadAction('retry', id)}
          />
        )}

        {showHistory && (
          <HistoryPage
            isOpen={showHistory}
            onClose={() => setShowHistory(false)}
            onNavigate={navigate}
            onDeleteEntry={(id) => window.electronAPI.deleteHistoryEntry(id).then(() => {
              window.electronAPI.getHistory().then((h: any[]) => {
                // Update top sites
              })
            })}
            onClearHistory={handleClearHistory}
          />
        )}

        {showSettings && (
          <SettingsPage
            isOpen={showSettings}
            onClose={() => setShowSettings(false)}
          />
        )}
      </div>

      <div className="status-bar">
        <span className={`status-dot ${isLoading ? 'loading' : ''}`}></span>
        {isLoading ? <span className="status-text">Loading...</span> : <span className="status-text">{address}</span>}
        <span className="status-spacer"></span>
        {activeTab && activeTab.zoomFactor && activeTab.zoomFactor !== 1 && (
          <span className="status-text">Zoom: {Math.round(activeTab.zoomFactor * 100)}%</span>
        )}
        <span className="status-text">Done</span>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)