import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { AddressSuggestion } from '../types'
import { Icon } from './Icon'

interface AddressBarProps {
  value: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  focusToken: number
  suggestions: AddressSuggestion[]
  onChange: (query: string) => void
  onNavigate: (raw: string) => void
  onSelectSuggestion: (suggestion: AddressSuggestion) => void
  onFocus: () => void
  onBlur: () => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onStop: () => void
  onHome: () => void
}

function prettyUrl(raw: string): string {
  if (!raw || raw === 'about:blank') return ''
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return raw
    const path = `${url.pathname}${url.search}${url.hash}`
    return `${url.host}${path === '/' ? '' : path}`
  } catch {
    return raw
  }
}

function securityOf(raw: string): 'secure' | 'insecure' | 'internal' {
  try {
    const url = new URL(raw)
    if (url.protocol === 'https:') return 'secure'
    if (url.protocol === 'http:') return 'insecure'
    return 'internal'
  } catch {
    return 'internal'
  }
}

const KIND_ICON = {
  search: 'search',
  url: 'globe',
  history: 'history',
  bookmark: 'star',
  tab: 'panel',
} as const

export const AddressBar: React.FC<AddressBarProps> = ({
  value,
  isLoading,
  canGoBack,
  canGoForward,
  focusToken,
  suggestions,
  onChange,
  onNavigate,
  onSelectSuggestion,
  onFocus,
  onBlur,
  onBack,
  onForward,
  onReload,
  onStop,
  onHome,
}) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)

  useEffect(() => {
    if (!focused) setDraft(value)
  }, [value, focused])

  useEffect(() => {
    setSelectedIndex(-1)
  }, [suggestions])

  useEffect(() => {
    if (focusToken > 0 && inputRef.current) {
      setDraft(value)
      setFocused(true)
      inputRef.current.focus()
      inputRef.current.select()
    }
    // Only react to explicit focus requests, not value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken])

  const submit = useCallback(
    (raw: string) => {
      const trimmed = raw.trim()
      if (!trimmed) return
      setFocused(false)
      setDraft(trimmed)
      inputRef.current?.blur()
      onNavigate(trimmed)
    },
    [onNavigate]
  )

  const choose = useCallback(
    (suggestion: AddressSuggestion) => {
      setFocused(false)
      inputRef.current?.blur()
      if (suggestion.tabId) onSelectSuggestion(suggestion)
      else submit(suggestion.value)
    },
    [onSelectSuggestion, submit]
  )

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      const selected = selectedIndex >= 0 ? suggestions[selectedIndex] : undefined
      if (selected) choose(selected)
      else submit(draft)
      return
    }
    if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault()
      setSelectedIndex((index) => Math.min(index + 1, suggestions.length - 1))
      return
    }
    if (event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault()
      setSelectedIndex((index) => Math.max(index - 1, -1))
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setFocused(false)
      setDraft(value)
      inputRef.current?.blur()
    }
  }

  const security = securityOf(value)
  const shown = focused ? draft : prettyUrl(value)

  return (
    <div className="address-wrap">
      <div className={`address-bar ${focused ? 'focused' : ''}`}>
        <div className="nav-buttons">
          <button className="icon-btn" onClick={onBack} disabled={!canGoBack} title="Back (Alt+Left)" aria-label="Back">
            <Icon name="back" />
          </button>
          <button
            className="icon-btn"
            onClick={onForward}
            disabled={!canGoForward}
            title="Forward (Alt+Right)"
            aria-label="Forward"
          >
            <Icon name="forward" />
          </button>
          <button
            className={`icon-btn ${isLoading ? 'stop' : ''}`}
            onClick={isLoading ? onStop : onReload}
            title={isLoading ? 'Stop loading (Esc)' : 'Reload (Ctrl+R)'}
            aria-label={isLoading ? 'Stop loading' : 'Reload'}
          >
            <Icon name={isLoading ? 'stop' : 'reload'} />
          </button>
          <button className="icon-btn home-btn" onClick={onHome} title="Home (Alt+Home)" aria-label="Home">
            <Icon name="home" />
          </button>
        </div>

        <div className="address-field">
          <span
            className={`security-dot ${security}`}
            title={
              security === 'secure'
                ? 'Connection is encrypted (HTTPS)'
                : security === 'insecure'
                  ? 'Connection is not encrypted (HTTP)'
                  : 'Browser page'
            }
          >
            <Icon name={security === 'secure' ? 'lock' : 'globe'} size={13} />
          </span>
          <input
            ref={inputRef}
            type="text"
            value={shown}
            onChange={(event) => {
              setDraft(event.target.value)
              onChange(event.target.value)
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              setDraft(value)
              setFocused(true)
              onFocus()
              requestAnimationFrame(() => inputRef.current?.select())
            }}
            onBlur={() => {
              window.setTimeout(() => setFocused(false), 120)
              onBlur()
            }}
            placeholder="Search or enter address"
            autoComplete="off"
            spellCheck={false}
            aria-label="Address and search bar"
            aria-autocomplete="list"
            aria-controls="address-suggestions"
            aria-activedescendant={selectedIndex >= 0 ? `address-suggestion-${selectedIndex}` : undefined}
          />
          {isLoading && <span className="address-spinner" aria-hidden="true" />}
        </div>
      </div>

      {focused && suggestions.length > 0 && (
        <div className="address-suggestions" id="address-suggestions" role="listbox" aria-label="Suggestions">
          {suggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.kind}-${suggestion.value}-${index}`}
              id={`address-suggestion-${index}`}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              className={`suggestion-row ${index === selectedIndex ? 'selected' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => choose(suggestion)}
            >
              <span className={`suggestion-icon ${suggestion.kind}`}>
                <Icon name={KIND_ICON[suggestion.kind]} size={14} />
              </span>
              <span className="suggestion-label">{suggestion.label}</span>
              {suggestion.detail && <span className="suggestion-detail">{suggestion.detail}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
