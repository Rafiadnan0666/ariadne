import React, { useState, useEffect, useCallback, useRef } from 'react';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  favicon?: string;
}

interface SearchResultsPageProps {
  query: string;
  onNavigate: (url: string) => void;
  onClose: () => void;
  onNewSearch: (query: string) => void;
}

const SEARCH_SOURCES = [
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://html.duckduckgo.com/html/?q=%s', color: '#DE5833' },
  { id: 'brave', name: 'Brave Search', url: 'https://search.brave.com/search?q=%s', color: '#FB542B' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s', color: '#00A6ED' },
];

export const SearchResultsPage: React.FC<SearchResultsPageProps> = ({
  query,
  onNavigate,
  onClose,
  onNewSearch,
}) => {
  const [results, setResults] = useState<Record<string, SearchResult[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [activeSource, setActiveSource] = useState<string>('all');
  const [aiSummary, setAiSummary] = useState<string>('');
  const [aiLoading, setAiLoading] = useState(false);
  const iframeRefs = useRef<Record<string, HTMLIFrameElement>>({});

  const fetchResults = useCallback(async (source: typeof SEARCH_SOURCES[0]) => {
    setLoading(prev => ({ ...prev, [source.id]: true }));
    setErrors(prev => ({ ...prev, [source.id]: '' }));

    try {
      const searchUrl = source.url.replace('%s', encodeURIComponent(query));
      const response = await fetch(`/api/search?url=${encodeURIComponent(searchUrl)}&source=${source.id}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setResults(prev => ({ ...prev, [source.id]: data.results || [] }));
    } catch (error) {
      setErrors(prev => ({ ...prev, [source.id]: error instanceof Error ? error.message : 'Failed to fetch' }));
    } finally {
      setLoading(prev => ({ ...prev, [source.id]: false }));
    }
  }, [query]);

  useEffect(() => {
    SEARCH_SOURCES.forEach(source => fetchResults(source));
  }, [fetchResults]);

  const generateAISummary = useCallback(async () => {
    setAiLoading(true);
    try {
      const allResults = Object.values(results).flat().slice(0, 10);
      const context = allResults.map(r => `${r.title}: ${r.snippet} (${r.url})`).join('\n');
      const response = await fetch('/api/ai-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, context }),
      });
      if (response.ok) {
        const data = await response.json();
        setAiSummary(data.summary || '');
      }
    } catch (error) {
      console.error('AI summary failed:', error);
    } finally {
      setAiLoading(false);
    }
  }, [query, results]);

  const allResults = activeSource === 'all'
    ? Object.values(results).flat()
    : results[activeSource] || [];

  const handleResultClick = (url: string) => {
    onNavigate(url);
  };

  const handleNewSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newQuery = formData.get('query') as string;
    if (newQuery.trim()) {
      onNewSearch(newQuery.trim());
    }
  };

  return (
    <div className="search-results-page">
      {/* Header with search box */}
      <header className="search-results-header">
        <form onSubmit={handleNewSearch} className="search-form">
          <input
            type="search"
            name="query"
            className="search-input"
            value={query}
            placeholder="Search..."
            autoFocus
          />
          <button type="submit" className="search-submit-btn">Search</button>
        </form>
        <button className="close-search-btn" onClick={onClose} title="Close search results">✕</button>
      </header>

      {/* Source tabs */}
      <div className="search-sources-bar">
        <button
          className={`source-tab ${activeSource === 'all' ? 'active' : ''}`}
          onClick={() => setActiveSource('all')}
        >
          All Sources
        </button>
        {SEARCH_SOURCES.map(source => (
          <button
            key={source.id}
            className={`source-tab ${activeSource === source.id ? 'active' : ''}`}
            onClick={() => setActiveSource(source.id)}
            style={{ borderColor: source.color }}
          >
            {source.name}
            {loading[source.id] && <span className="source-loading" />}
            {errors[source.id] && <span className="source-error" title={errors[source.id]}>⚠</span>}
          </button>
        ))}
        <button
          className="source-tab ai-summary-tab"
          onClick={generateAISummary}
          disabled={aiLoading || Object.keys(results).length === 0}
        >
          {aiLoading ? '🤖 Summarizing...' : '🤖 AI Summary'}
        </button>
      </div>

      {/* AI Summary */}
      {aiSummary && (
        <div className="ai-summary-panel">
          <div className="ai-summary-content">{aiSummary}</div>
          <button className="dismiss-summary" onClick={() => setAiSummary('')}>Dismiss</button>
        </div>
      )}

      {/* Results */}
      <main className="search-results-main">
        {Object.keys(results).length === 0 && !aiSummary && (
          <div className="search-loading">
            <div className="spinner" />
            <p>Searching...</p>
          </div>
        )}

        {allResults.length === 0 && Object.keys(results).length > 0 && (
          <div className="search-no-results">
            <p>No results found for "{query}"</p>
            <button onClick={() => onNewSearch(query)}>Try different search</button>
          </div>
        )}

        <div className="search-results-list">
          {allResults.map((result, index) => (
            <article key={`${result.url}-${index}`} className="search-result-item">
              <div className="result-favicon">
                {result.favicon ? (
                  <img src={result.favicon} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                ) : (
                  <span>🌐</span>
                )}
              </div>
              <div className="result-content">
                <h3 className="result-title">
                  <a href={result.url} onClick={(e) => { e.preventDefault(); handleResultClick(result.url); }}>
                    {result.title}
                  </a>
                </h3>
                <div className="result-url">{new URL(result.url).hostname}</div>
                <p className="result-snippet">{result.snippet}</p>
                <div className="result-source-badge" style={{ background: SEARCH_SOURCES.find(s => s.id === result.source)?.color || '#666' }}>
                  {result.source}
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
};