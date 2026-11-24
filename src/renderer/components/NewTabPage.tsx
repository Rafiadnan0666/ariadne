import React, { useState, useEffect, useCallback } from 'react';

interface TopSite {
  url: string;
  title: string;
  favicon?: string;
  visitCount: number;
}

interface NewTabPageProps {
  onNavigate: (url: string) => void;
  onSearch: (query: string) => void;
  topSites: TopSite[];
  recentlyClosed: Array<{ id: string; url: string; title: string }>;
  searchEngine: { name: string; url: string; keyword: string };
}

export const NewTabPage: React.FC<NewTabPageProps> = ({
  onNavigate,
  onSearch,
  topSites,
  recentlyClosed,
  searchEngine,
}) => {
  const [query, setQuery] = useState('');
  const [showShortcuts, setShowShortcuts] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setQuery('');
      inputRef.current?.blur();
    }
  };

  const isValidUrl = (str: string): boolean => {
    try {
      const url = new URL(str.startsWith('http') ? str : 'http://' + str);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  };

  return (
    <div className="new-tab-page" onKeyDown={handleKeyDown}>
      <div className="new-tab-background">
        <svg className="ariadne-thread" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id="threadGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4285f4" stopOpacity="0.1" />
              <stop offset="50%" stopColor="#34a853" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#ea4335" stopOpacity="0.1" />
            </linearGradient>
          </defs>
          <path
            d="M10,50 Q30,20 50,50 Q70,80 90,50"
            stroke="url(#threadGradient)"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
          />
          <circle cx="50" cy="50" r="3" fill="#4285f4" opacity="0.3" />
        </svg>
      </div>
      <div className="new-tab-content">
        <div className="new-tab-search">
          <form onSubmit={handleSubmit}>
            <div className="search-engine-badge">{searchEngine.name}</div>
            <div className="search-input-wrapper">
              <input
                ref={inputRef}
                type="text"
                className="search-input"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={`Search with ${searchEngine.name} or enter URL`}
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
              <button type="submit" className="search-submit-btn" aria-label="Search">🔍</button>
            </div>
            <div className="search-shortcuts">
              <kbd>Ctrl+L</kbd> Focus · <kbd>Ctrl+T</kbd> New Tab · <kbd>Ctrl+Shift+T</kbd> Reopen Closed
            </div>
          </form>
        </div>

        {topSites.length > 0 && (
          <div className="new-tab-section">
            <div className="section-header">
              <h3>Top Sites</h3>
              <button className="section-edit-btn" onClick={() => setShowShortcuts(!showShortcuts)}>
                {showShortcuts ? 'Done' : 'Edit'}
              </button>
            </div>
            <div className="top-sites-grid">
              {topSites.slice(0, 8).map((site, index) => (
                <a
                  key={site.url}
                  href={site.url}
                  className="top-site-card"
                  onClick={e => { e.preventDefault(); onNavigate(site.url); }}
                >
                  <div className="top-site-favicon">
                    {site.favicon ? (
                      <img src={site.favicon} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} />
                    ) : (
                      <span>{site.title.charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="top-site-title" title={site.title}>{site.title}</div>
                  <div className="top-site-url">{new URL(site.url).hostname}</div>
                  {showShortcuts && (
                    <button className="top-site-remove" onClick={e => { e.preventDefault(); e.stopPropagation(); alert('Remove - TBD'); }}>
                      ✕
                    </button>
                  )}
                </a>
              ))}
              {topSites.length < 8 && (
                <a className="top-site-card add-site-card" onClick={() => alert('Add shortcut - TBD')}>
                  <div className="top-site-favicon add-icon">+</div>
                  <div className="top-site-title">Add Shortcut</div>
                </a>
              )}
            </div>
          </div>
        )}

        {recentlyClosed.length > 0 && (
          <div className="new-tab-section">
            <h3>Recently Closed</h3>
            <div className="recently-closed-list">
              {recentlyClosed.slice(0, 5).map(tab => (
                <div key={tab.id} className="recently-closed-item" onClick={() => onNavigate(tab.url)}>
                  <span className="recently-closed-icon">🕒</span>
                  <div className="recently-closed-info">
                    <div className="recently-closed-title">{tab.title}</div>
                    <div className="recently-closed-url">{tab.url}</div>
                  </div>
                  <span className="recently-closed-restore">Restore</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="new-tab-footer">
          <p>Ariadne Browser · AI-native desktop browser</p>
          <p className="new-tab-shortcuts">
            <kbd>Ctrl+N</kbd> New Window · <kbd>Ctrl+Shift+N</kbd> Private Window · <kbd>F11</kbd> Fullscreen
          </p>
        </div>
      </div>
    </div>
  );
};

import { useRef } from 'react';