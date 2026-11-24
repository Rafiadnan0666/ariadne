import React, { useState, useCallback, useEffect } from 'react'
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
  const [tabs, setTabs] = useState<Tab[]>([{ id: '1', url: 'https://www.google.com', title: 'Ariadne', active: true }])
  const [currentTabId, setCurrentTabId] = useState('1')
  const [address, setAddress] = useState('https://www.google.com')
  const [isLoading, setIsLoading] = useState(false)
  const [showAISidebar, setShowAISidebar] = useState(false)
  const webviewRef = React.createRef<any>()

  useEffect(() => {
    window.electronAPI.ready().then(() => {
      window.electronAPI.getTabs().then((tabs) => {
        setTabs(tabs)
        setCurrentTabId(tabs[0]?.id || '1')
        if (tabs[0]) setAddress(tabs[0].url)
      })
    })
  }, [])

  useEffect(() => {
    const unsubscribeTabs = window.electronAPI.on('tabs-updated', () => {
      window.electronAPI.getTabs().then((tabs) => {
        setTabs(tabs)
        if (!tabs.find(t => t.id === currentTabId)) {
          setCurrentTabId(tabs[0]?.id || '1')
        }
        if (tabs.length > 0) {
          const active = tabs.find(t => t.active)
          if (active) setAddress(active.url)
        }
      })
    })
    return () => unsubscribeTabs()
  }, [currentTabId])

  useEffect(() => {
    const unsubscribeNavigate = window.electronAPI.on('url-changed', (event: any, tabId: string, url: string) => {
      const tab = tabs.find(t => t.id === tabId)
      if (tab) {
        setAddress(url)
        setIsLoading(tab.url === url)
      }
    })
    return () => unsubscribeNavigate()
  }, [])

  const createTab = useCallback(() => {
    window.electronAPI.createTab().then((id) => {
      const newTab: Tab = {
        id,
        url: 'about:blank',
        title: 'New Tab',
        active: true
      }
      setTabs(prev => [...prev, newTab])
      setCurrentTabId(id)
      setAddress('about:blank')
    })
  }, [])

  const closeTab = useCallback((id: string) => {
    window.electronAPI.closeTab(id).then(() => {
      setTabs(prev => prev.filter(t => t.id !== id))
      if (currentTabId === id) {
        const remaining = [...tabs].filter(t => t.id !== id)
        if (remaining.length > 0) {
          setCurrentTabId(remaining[0].id)
          setAddress(remaining[0].url)
        }
      }
    })
  }, [currentTabId])

  const switchTab = useCallback((id: string) => {
    setCurrentTabId(id)
    setAddress(tabs.find(t => t.id === id)?.url || 'about:blank')
  }, [tabs])

  const navigate = useCallback((newUrl: string) => {
    if (newUrl && newUrl.startsWith('http')) {
      window.electronAPI.setUrl(currentTabId, newUrl)
      setAddress(newUrl)
      setIsLoading(true)
    } else {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(newUrl)}`
      window.electronAPI.setUrl(currentTabId, searchUrl)
      setAddress(searchUrl)
      setIsLoading(true)
    }
  }, [currentTabId])

  const back = useCallback(() => {
    window.electronAPI.back().then(() => {
      window.electronAPI.getTabs().then(tabs => {
        const active = tabs.find(t => t.active)
        if (active) {
          setAddress(active.url)
          setCurrentTabId(active.id)
        }
      })
    })
  }, [])

  const forward = useCallback(() => {
    window.electronAPI.forward().then(() => {
      window.electronAPI.getTabs().then(tabs => {
        const active = tabs.find(t => t.active)
        if (active) {
          setAddress(active.url)
          setCurrentTabId(active.id)
        }
      })
    })
  }, [])

  const reload = useCallback(() => {
    window.electronAPI.reload()
    window.electronAPI.getTabs().then(tabs => {
      const active = tabs.find(t => t.active)
      if (active) {
        setAddress(active.url)
        setIsLoading(false)
      }
    })
  }, [])

  const goHome = useCallback(() => {
    navigate('https://www.google.com')
  }, [navigate])

  const activeTab = tabs.find(t => t.id === currentTabId)

  return (
    <div className="app">
      <div className="browser-bar">
        <div className="address-bar">
          <div className="address-left">
            <button onClick={back} title="Back" className="btn">←</button>
            <button onClick={forward} title="Forward" className="btn">→</button>
            <button onClick={reload} title="Reload" className="btn">⟳</button>
            <button onClick={goHome} title="Home" className="btn">🏠</button>
          </div>
          <div className="address-center">
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && navigate(e.target.value)}
              placeholder="Enter URL or search"
              className="address-input"
            />
          </div>
          <div className="address-right">
            <button onClick={() => createTab()} title="New Tab" className="btn">+</button>
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
              <span className="tab-close" onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}>✕</span>
              <span className="tab-title">{tab.title}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="main-content">
        <div className="webview-area">
          <webview
            ref={webviewRef}
            src={address}
            partition="persist:ariadne"
            style={{ width: '100%', height: '100%', border: 'none' }}
            ondid-finish-load={() => setIsLoading(false)}
            ondid-navigate={(e) => setAddress(e.url)}
            ondid-stop-loading={() => {}}
          ></webview>
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