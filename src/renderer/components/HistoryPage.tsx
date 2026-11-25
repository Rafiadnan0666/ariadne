import React, { useState, useEffect, useCallback } from 'react';
import { Icon } from './Icon';

interface HistoryEntry {
  id: number;
  url: string;
  title: string;
  visitedAt: number;
  visitCount?: number;
}

interface HistoryPageProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (url: string) => void;
  onDeleteEntry: (id: number) => void;
  onClearHistory: (options?: { since?: number }) => void;
}

const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  if (diff < 86400000) { // Today
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diff < 172800000) { // Yesterday
    return 'Yesterday ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diff < 604800000) { // This week
    return date.toLocaleDateString([], { weekday: 'long' }) + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
};

const groupByDate = (entries: HistoryEntry[]): Record<string, HistoryEntry[]> => {
  const groups: Record<string, HistoryEntry[]> = {};
  for (const entry of entries) {
    const date = new Date(entry.visitedAt);
    const key = date.toDateString();
    if (!groups[key]) groups[key] = [];
    groups[key].push(entry);
  }
  return groups;
};

export const HistoryPage: React.FC<HistoryPageProps> = ({
  isOpen,
  onClose,
  onNavigate,
  onDeleteEntry,
  onClearHistory,
}) => {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [loading, setLoading] = useState(true);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [clearOption, setClearOption] = useState<'all' | 'hour' | 'day' | 'week'>('all');

  const loadHistory = useCallback(async () => {
    try {
      const data = await window.electronAPI.history.get();
      setEntries(data);
    } catch (e) {
      console.error('Failed to load history:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const filteredEntries = entries
    .filter(entry => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return entry.title.toLowerCase().includes(query) || entry.url.toLowerCase().includes(query);
      }
      return true;
    })
    .filter(entry => {
      if (filter === 'all') return true;
      const now = Date.now();
      const day = 86400000;
      if (filter === 'today') return now - entry.visitedAt < day;
      if (filter === 'week') return now - entry.visitedAt < day * 7;
      if (filter === 'month') return now - entry.visitedAt < day * 30;
      return true;
    });

  const groupedEntries = groupByDate(filteredEntries);
  const sortedDates = Object.keys(groupedEntries).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  const handleClearHistory = () => {
    let since: number | undefined;
    const now = Date.now();
    const hour = 3600000;
    const day = 86400000;
    const week = 604800000;
    
    if (clearOption === 'hour') since = now - hour;
    else if (clearOption === 'day') since = now - day;
    else if (clearOption === 'week') since = now - week;
    
    onClearHistory(since ? { since } : undefined);
    setShowClearDialog(false);
    loadHistory();
  };

  if (!isOpen) return null;

  return (
    <div className="history-page">
      <div className="history-header">
        <h2>History</h2>
        <div className="history-header-actions">
          <select value={filter} onChange={e => setFilter(e.target.value as 'all' | 'today' | 'week' | 'month')} className="history-filter">
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
          </select>
          <input
            type="text"
            className="history-search"
            placeholder="Search history..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            autoFocus
          />
          <button className="history-clear-btn" onClick={() => setShowClearDialog(true)}>Clear History</button>
          <button className="history-close-btn" onClick={onClose} aria-label="Close history"><Icon name="close" size={16} /></button>
        </div>
      </div>
      <div className="history-content">
        {loading ? (
          <div className="history-loading">Loading history...</div>
        ) : filteredEntries.length === 0 ? (
          <div className="history-empty">No history entries found</div>
        ) : (
          sortedDates.map(dateKey => (
            <div key={dateKey} className="history-date-group">
              <div className="history-date-header">{dateKey}</div>
              <div className="history-entries">
                {groupedEntries[dateKey].map(entry => (
                  <div key={entry.id} className="history-entry">
                    <div className="history-entry-main" onClick={() => onNavigate(entry.url)}>
                      <div className="history-entry-title">{entry.title || entry.url}</div>
                      <div className="history-entry-url">{entry.url}</div>
                    </div>
                    <div className="history-entry-meta">
                      <span className="history-entry-time">{formatDate(entry.visitedAt)}</span>
                      <button className="history-entry-delete" onClick={e => { e.stopPropagation(); onDeleteEntry(entry.id); }} title="Remove from history" aria-label="Remove from history"><Icon name="trash" size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      {showClearDialog && (
        <div className="history-clear-dialog-overlay" onClick={() => setShowClearDialog(false)}>
          <div className="history-clear-dialog" onClick={e => e.stopPropagation()}>
            <h3>Clear Browsing History</h3>
            <p>Select how much history to delete:</p>
            <div className="clear-options">
              <label><input type="radio" name="clear" value="hour" checked={clearOption === 'hour'} onChange={e => setClearOption(e.target.value as 'hour')} /> Last hour</label>
              <label><input type="radio" name="clear" value="day" checked={clearOption === 'day'} onChange={e => setClearOption(e.target.value as 'day')} /> Last 24 hours</label>
              <label><input type="radio" name="clear" value="week" checked={clearOption === 'week'} onChange={e => setClearOption(e.target.value as 'week')} /> Last 7 days</label>
              <label><input type="radio" name="clear" value="all" checked={clearOption === 'all'} onChange={e => setClearOption(e.target.value as 'all')} /> All time</label>
            </div>
            <div className="clear-dialog-actions">
              <button className="btn-cancel" onClick={() => setShowClearDialog(false)}>Cancel</button>
              <button className="btn-danger" onClick={handleClearHistory}>Clear</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};