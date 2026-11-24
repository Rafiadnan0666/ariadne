import React, { useState, useCallback, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import { ChatSidebar } from './components/ai/ChatSidebar'
import './styles.css'

interface Tab {
  id: string
  url: string
  title: string
  active: boolean
}

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [currentTabId, setCurrentTabId] = useState<string | null>(null)
  const [address, setAddress] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showAISidebar, setShowAISidebar] = useState(false)
  const webviewRef = useRef<any>(null)
  const isNavigatingRef = useRef(false)

  // Load initial tabs
  useEffect(() => {
    window.electronAPI.ready().then(() => {
      window.electronAPI.getTabs().then((tabs) => {
        if (tabs.length === 0) {
          window.electronAPI.createTab('https://example.com').then(() => {
            window.electronAPI.getTabs().then((newTabs) => {
              setTabs(newTabs)
              const active = newTabs.find(t => t.active) || newTabs[0]
              if (active) {
                setCurrentTabId(active.id)
                setAddress(active.url)
              }
            })
          })
        } else {
          setTabs(tabs)
          const active = tabs.find(t => t.active) || tabs[0]
          if (active) {
            setCurrentTabId(active.id)
            setAddress(active.url)
          }
        }
      })
    })
  }, [])

  // Listen for tab updates from main process
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

  // Listen for navigation events from webview
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

  const createTab = useCallback(() => {
    window.electronAPI.createTab('about:blank').then((id) => {
      window.electronAPI.getTabs().then((newTabs) => {
        setTabs(newTabs)
        const newTab = newTabs.find(t => t.id === id)
        if (newTab) {
          setCurrentTabId(id)
          setAddress('about:blank')
        }
      })
    })
  }, [])

  const closeTab = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    window.electronAPI.closeTab(id).then(() => {
      window.electronAPI.getTabs().then((newTabs) => {
        setTabs(newTabs)
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
          // Reload webview with new tab URL
          if (webviewRef.current) {
            webviewRef.current.src = tab.url
          }
        }
        setTabs(newTabs)
        isNavigatingRef.current = false
      })
    })
  }, [currentTabId])

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
      const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`
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

  const goHome = useCallback(() => {
    navigate('https://example.com')
  }, [navigate])

  const activeTab = tabs.find(t => t.id === currentTabId)

  return (
    <div className="app">
      <div className="browser-bar">
        <div className="address-bar">
          <div className="address-left">
            <button onClick={back} title="Back" className="btn" disabled={!currentTabId}>←</button>
            <button onClick={forward} title="Forward" className="btn" disabled={!currentTabId}>→</button>
            <button onClick={reload} title="Reload" className="btn" disabled={!currentTabId}>⟳</button>
            <button onClick={goHome} title="Home" className="btn" disabled={!currentTabId}>🏠</button>
          </div>
          <div className="address-center">
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && navigate(e.target.value)}
              placeholder="Enter URL or search"
              className="address-input"
              disabled={!currentTabId}
            />
          </div>
          <div className="address-right">
            <button onClick={createTab} title="New Tab" className="btn">+</button>
            <button onClick={() => setShowAISidebar(!showAISidebar)} title="AI Sidebar" className={`btn ${showAISidebar ? 'active' : ''}`}>🤖</button>
          </div>
        </div>
        <div className="tabs-row">
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={`tab${tab.active ? ' active' : ''}`}
              onClick={() => switchTab(tab.id)}
            >
              <span className="tab-title">{tab.title}</span>
              <span className="tab-close" onClick={(e) => closeTab(tab.id, e)}>✕</span>
            </div>
          ))}
          {tabs.length === 0 && (
            <div className="tab new-tab-placeholder" onClick={createTab}>
              <span>+ New Tab</span>
            </div>
          )}
        </div>
      </div>

      <div className="main-content">
        <div className="webview-area">
          {currentTabId ? (
            <webview
              ref={webviewRef}
              src={address}
              partition="persist:ariadne"
              style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
              ondid-start-load={() => { if (!isNavigatingRef.current) setIsLoading(true); }}
              ondid-finish-load={() => {
                setIsLoading(false)
                if (currentTabId && webviewRef.current) {
                  window.electronAPI.setTabWebContents(currentTabId, webviewRef.current.getWebContentsId())
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
            ></webview>
          ) : (
            <div className="no-tab-selected">No tab selected. Click + to create one.</div>
          )}
        </div>

        <ChatSidebar isOpen={showAISidebar} onClose={() => setShowAISidebar(false)} activeTabId={currentTabId} />
      </div>

      <div className="status-bar">
        <span className={`status-dot ${isLoading ? 'loading' : ''}`}></span>
        {isLoading ? <span className="status-text">Loading...</span> : <span className="status-text">{address}</span>}
        <span className="status-spacer"></span>
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