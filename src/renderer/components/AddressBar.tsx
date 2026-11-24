import React, { useState, useRef, useEffect, useCallback } from 'react';

interface SearchSuggestion {
  type: 'history' | 'bookmark' | 'tab' | 'search' | 'url';
  text: string;
  url?: string;
  title?: string;
  icon?: string;
}

interface AddressBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStop: () => void;
  onHome: () => void;
  onNewTab: () => void;
  onToggleAISidebar: () => void;
  showAISidebar: boolean;
  suggestions: SearchSuggestion[];
  showSuggestions: boolean;
}

export const AddressBar: React.FC<AddressBarProps> = ({
  value,
  onChange,
  onSubmit,
  onFocus,
  onBlur,
  isLoading,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onReload,
  onStop,
  onHome,
  onNewTab,
  onToggleAISidebar,
  showAISidebar,
  suggestions,
  showSuggestions,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (showSuggestions && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showSuggestions]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        const suggestion = suggestions[selectedIndex];
        if (suggestion.url) {
          onSubmit(suggestion.url);
        } else {
          onSubmit(suggestion.text);
        }
      } else {
        onSubmit(value);
      }
      setSelectedIndex(-1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Escape') {
      setSelectedIndex(-1);
      inputRef.current?.blur();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
      e.preventDefault();
      inputRef.current?.select();
      setIsEditing(true);
    }
  }, [value, suggestions, onSubmit, selectedIndex]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    setSelectedIndex(-1);
    setIsEditing(true);
  }, [onChange]);

  const handleClick = useCallback(() => {
    setIsEditing(true);
    inputRef.current?.select();
  }, []);

  const isValidUrl = (str: string): boolean => {
    try {
      const url = new URL(str.startsWith('http') ? str : 'http://' + str);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const getDisplayValue = () => {
    if (isEditing) return value;
    try {
      const url = new URL(value);
      return url.hostname + url.pathname + url.search;
    } catch {
      return value;
    }
  };

  return (
    <div className="address-bar">
      <div className="address-left">
        <button className="addr-btn" onClick={onBack} disabled={!canGoBack} title="Back (Alt+Left)" aria-label="Back">←</button>
        <button className="addr-btn" onClick={onForward} disabled={!canGoForward} title="Forward (Alt+Right)" aria-label="Forward">→</button>
        <button className="addr-btn" onClick={isLoading ? onStop : onReload} title={isLoading ? 'Stop (Esc)' : 'Reload (F5/Ctrl+R)'} aria-label={isLoading ? 'Stop' : 'Reload'}>
          {isLoading ? '✕' : '⟳'}
        </button>
        <button className="addr-btn" onClick={onHome} title="Home (Alt+Home)" aria-label="Home">🏠</button>
      </div>
      <div className="address-center">
        <div className="address-input-wrapper">
          <input
            ref={inputRef}
            type="text"
            className="address-input"
            value={isEditing ? value : getDisplayValue()}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => { onFocus(); setIsEditing(true); }}
            onBlur={() => { onBlur(); setIsEditing(false); }}
            onClick={handleClick}
            placeholder="Enter URL or search"
            autoComplete="off"
            spellCheck={false}
            aria-label="Address bar"
            aria-autocomplete="list"
            aria-controls="address-suggestions"
            aria-activedescendant={selectedIndex >= 0 ? `suggestion-${selectedIndex}` : undefined}
          />
          {isLoading && <span className="address-loading-indicator" />}
        </div>
        {showSuggestions && suggestions.length > 0 && (
          <div className="address-suggestions" id="address-suggestions" role="listbox">
            {suggestions.map((suggestion, index) => (
              <div
                key={index}
                id={`suggestion-${index}`}
                className={`address-suggestion ${index === selectedIndex ? 'selected' : ''}`}
                role="option"
                aria-selected={index === selectedIndex}
                onClick={() => {
                  if (suggestion.url) onSubmit(suggestion.url); else onSubmit(suggestion.text);
                }}
              >
                <span className="suggestion-icon">{suggestion.icon || (suggestion.type === 'search' ? '🔍' : suggestion.type === 'history' ? '🕒' : suggestion.type === 'bookmark' ? '★' : '📄')}</span>
                <span className="suggestion-text">{suggestion.text}</span>
                {suggestion.url && suggestion.type !== 'search' && <span className="suggestion-url">{suggestion.url}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="address-right">
        <button className="addr-btn" onClick={onNewTab} title="New Tab (Ctrl+T)" aria-label="New Tab">+</button>
        <button className={`addr-btn ${showAISidebar ? 'active' : ''}`} onClick={onToggleAISidebar} title="AI Sidebar (Ctrl+Shift+A)" aria-label="AI Sidebar" aria-pressed={showAISidebar}>🤖</button>
      </div>
    </div>
  );
};