import React, { useCallback, useRef, useState } from 'react'
import type { TabDTO } from '../types'
import { Icon } from './Icon'

interface TabStripProps {
  tabs: TabDTO[]
  activeTabId: string | null
  isPrivate: boolean
  aiOpen: boolean
  downloadCount: number
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onMuteTab: (id: string) => void
  onCreateTab: () => void
  onContextMenu: (id: string, event: React.MouseEvent) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onToggleAi: () => void
  onOpenDownloads: () => void
  onOpenHistory: () => void
  onOpenSettings: () => void
}

function hostOf(url: string): string {
  if (!url || url === 'about:blank') return 'New tab'
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const TabRow: React.FC<{
  tab: TabDTO
  index: number
  active: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onMute: (id: string) => void
  onContextMenu: (id: string, event: React.MouseEvent) => void
  onDragStart: (index: number) => void
  onDropAt: (index: number) => void
  dragging: boolean
  setDragging: (value: boolean) => void
}> = ({ tab, index, active, onSelect, onClose, onMute, onContextMenu, onDragStart, onDropAt, dragging, setDragging }) => {
  const [faviconFailed, setFaviconFailed] = useState(false)
  const letter = (tab.title || hostOf(tab.url) || '?').trim().charAt(0).toUpperCase()

  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      className={`tab-row ${active ? 'active' : ''} ${dragging ? 'dragging' : ''} ${tab.pinned ? 'pinned' : ''}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', tab.id)
        onDragStart(index)
        setDragging(true)
      }}
      onDragEnd={() => setDragging(false)}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDropAt(index)
        setDragging(false)
      }}
      onClick={() => onSelect(tab.id)}
      onAuxClick={(event) => {
        if (event.button === 1) onClose(tab.id)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(tab.id)
        }
      }}
      onContextMenu={(event) => onContextMenu(tab.id, event)}
      title={`${tab.title || hostOf(tab.url)}\n${tab.url}`}
    >
      <span className="tab-favicon">
        {tab.favicon && !faviconFailed ? (
          <img src={tab.favicon} alt="" onError={() => setFaviconFailed(true)} />
        ) : (
          <span className="tab-letter">{letter}</span>
        )}
      </span>
      <span className="tab-copy">
        <span className="tab-title">{tab.title || hostOf(tab.url)}</span>
        <span className="tab-host">{hostOf(tab.url)}</span>
      </span>
      <span className="tab-badges">
        {tab.loading && <span className="tab-spinner" aria-label="Loading" />}
        {tab.audioPlaying && !tab.muted && (
          <button
            className="tab-mini-btn"
            title="Mute tab"
            onClick={(event) => {
              event.stopPropagation()
              onMute(tab.id)
            }}
          >
            <Icon name="volume" size={13} />
          </button>
        )}
        {tab.muted && <Icon name="mute" size={13} className="tab-muted" />}
        {tab.pinned && <Icon name="pin" size={12} className="tab-pinned" />}
      </span>
      <button
        className="tab-close"
        title="Close tab"
        aria-label={`Close ${tab.title || 'tab'}`}
        onClick={(event) => {
          event.stopPropagation()
          onClose(tab.id)
        }}
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  )
}

export const TabStrip: React.FC<TabStripProps> = ({
  tabs,
  activeTabId,
  isPrivate,
  aiOpen,
  downloadCount,
  onSelectTab,
  onCloseTab,
  onMuteTab,
  onCreateTab,
  onContextMenu,
  onReorder,
  onToggleAi,
  onOpenDownloads,
  onOpenHistory,
  onOpenSettings,
}) => {
  const dragIndex = useRef<number | null>(null)
  const [dragging, setDragging] = useState(false)

  const handleDropAt = useCallback(
    (index: number) => {
      if (dragIndex.current === null) return
      onReorder(dragIndex.current, index)
      dragIndex.current = null
    },
    [onReorder]
  )

  return (
    <aside className="tab-rail">
      <div className="rail-brand">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M19.1 4.9l-2.8 2.8M7.7 16.3l-2.8 2.8" />
          </svg>
        </span>
        <span className="brand-text">
          <strong>Ariadne</strong>
          <span>{isPrivate ? 'Private window' : 'Browser'}</span>
        </span>
        {isPrivate && (
          <span className="private-badge" title="This window does not save history or cookies">
            <Icon name="lock" size={11} /> Private
          </span>
        )}
      </div>

      <button className="rail-new-tab" onClick={onCreateTab} title="New tab (Ctrl+T)">
        <Icon name="plus" size={15} />
        <span>New tab</span>
        <kbd>Ctrl T</kbd>
      </button>

      <div className="rail-tabs" role="tablist" aria-label="Open tabs">
        {tabs.map((tab, index) => (
          <TabRow
            key={tab.id}
            tab={tab}
            index={index}
            active={tab.id === activeTabId}
            onSelect={onSelectTab}
            onClose={onCloseTab}
            onMute={onMuteTab}
            onContextMenu={onContextMenu}
            onDragStart={(from) => {
              dragIndex.current = from
            }}
            onDropAt={handleDropAt}
            dragging={dragging && dragIndex.current === index}
            setDragging={setDragging}
          />
        ))}
        {tabs.length === 0 && <div className="rail-empty">No open tabs</div>}
      </div>

      <div className="rail-footer">
        <button className="rail-action" onClick={onOpenHistory} title="History (Ctrl+H)">
          <Icon name="history" size={15} />
          <span>History</span>
        </button>
        <button className="rail-action" onClick={onOpenDownloads} title="Downloads (Ctrl+J)">
          <Icon name="download" size={15} />
          <span>Downloads</span>
          {downloadCount > 0 && <span className="rail-count">{downloadCount}</span>}
        </button>
        <button className="rail-action" onClick={onOpenSettings} title="Settings">
          <Icon name="settings" size={15} />
          <span>Settings</span>
        </button>
        <button
          className={`rail-action rail-ai ${aiOpen ? 'active' : ''}`}
          onClick={onToggleAi}
          title="Toggle AI sidebar (Ctrl+Shift+A)"
          aria-pressed={aiOpen}
        >
          <Icon name="sparkle" size={15} />
          <span>Ask Ariadne</span>
          <kbd>Ctrl ⇧ A</kbd>
        </button>
      </div>
    </aside>
  )
}
