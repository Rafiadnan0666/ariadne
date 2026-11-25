import React, { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

interface TopSite {
  url: string
  title: string
  favicon?: string
  visitCount: number
}

interface NewTabPageProps {
  onSubmit: (raw: string) => void
  onNavigate: (url: string) => void
  topSites: TopSite[]
  recentlyClosed: Array<{ id: string; url: string; title: string }>
  searchEngineName: string
  isPrivate: boolean
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const SiteCard: React.FC<{ site: TopSite; onNavigate: (url: string) => void }> = ({ site, onNavigate }) => {
  const [failed, setFailed] = useState(false)
  const letter = (site.title || hostOf(site.url)).trim().charAt(0).toUpperCase()
  return (
    <button className="site-card" onClick={() => onNavigate(site.url)} title={`${site.title}\n${site.url}`}>
      <span className="site-icon">
        {site.favicon && !failed ? (
          <img src={site.favicon} alt="" onError={() => setFailed(true)} />
        ) : (
          <span>{letter}</span>
        )}
      </span>
      <span className="site-title">{site.title || hostOf(site.url)}</span>
      <span className="site-host">{hostOf(site.url)}</span>
    </button>
  )
}

export const NewTabPage: React.FC<NewTabPageProps> = ({
  onSubmit,
  onNavigate,
  topSites,
  recentlyClosed,
  searchEngineName,
  isPrivate,
}) => {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className="ntp">
      <div className="ntp-inner">
        <div className="ntp-brand">
          <span className="ntp-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.4">
              <circle cx="16" cy="16" r="4.2" />
              <path d="M16 2v6M16 24v6M2 16h6M24 16h6M6.1 6.1l4.2 4.2M21.7 21.7l4.2 4.2M25.9 6.1l-4.2 4.2M10.3 21.7l-4.2 4.2" />
            </svg>
          </span>
          <div>
            <h1>{isPrivate ? 'Private browsing' : 'Ariadne'}</h1>
            <p>
              {isPrivate
                ? 'History, cookies and downloads from this window are kept out of your normal profile.'
                : 'A browser with a thread back to what you were reading.'}
            </p>
          </div>
        </div>

        <form
          className="ntp-search"
          onSubmit={(event) => {
            event.preventDefault()
            if (query.trim()) onSubmit(query.trim())
          }}
        >
          <Icon name="search" size={17} className="ntp-search-icon" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${searchEngineName} or enter an address`}
            autoComplete="off"
            spellCheck={false}
            aria-label="Search or enter address"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setQuery('')
                inputRef.current?.blur()
              }
            }}
          />
          <kbd>Enter</kbd>
        </form>

        {topSites.length > 0 && (
          <section className="ntp-section">
            <div className="ntp-section-head">
              <h2>Frequently visited</h2>
              <span>{topSites.length} sites from your history</span>
            </div>
            <div className="site-grid">
              {topSites.slice(0, 8).map((site) => (
                <SiteCard key={site.url} site={site} onNavigate={onNavigate} />
              ))}
            </div>
          </section>
        )}

        {recentlyClosed.length > 0 && (
          <section className="ntp-section">
            <div className="ntp-section-head">
              <h2>Recently closed</h2>
              <span>Ctrl+Shift+T reopens the last tab</span>
            </div>
            <div className="recent-list">
              {recentlyClosed.slice(0, 5).map((tab) => (
                <button key={`${tab.id}-${tab.url}`} className="recent-row" onClick={() => onNavigate(tab.url)}>
                  <Icon name="history" size={14} />
                  <span className="recent-copy">
                    <span className="recent-title">{tab.title || hostOf(tab.url)}</span>
                    <span className="recent-url">{hostOf(tab.url)}</span>
                  </span>
                  <span className="recent-restore">Restore</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <footer className="ntp-footer">
          <span>
            <kbd>Ctrl</kbd> <kbd>T</kbd> new tab
          </span>
          <span>
            <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>A</kbd> ask Ariadne
          </span>
          <span>
            <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>N</kbd> private window
          </span>
        </footer>
      </div>
    </div>
  )
}
