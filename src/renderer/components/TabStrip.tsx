import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { DndProvider } from 'react-dnd';

interface Tab {
  id: string;
  url: string;
  title: string;
  active: boolean;
  pinned?: boolean;
  muted?: boolean;
  loading?: boolean;
  favicon?: string;
  audioPlaying?: boolean;
}

interface TabStripProps {
  tabs: Tab[];
  activeTabId: string | null;
  onCreateTab: (url?: string) => void;
  onCloseTab: (id: string, e: React.MouseEvent) => void;
  onSwitchTab: (id: string) => void;
  onPinTab: (id: string) => void;
  onMuteTab: (id: string) => void;
  onDuplicateTab: (id: string) => void;
  onReopenClosedTab: () => void;
  onTabContextMenu: (id: string, e: React.MouseEvent) => void;
  closedTabs: Tab[];
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStop: () => void;
  isLoading: boolean;
}

const TabItem: React.FC<{
  tab: Tab;
  index: number;
  activeTabId: string | null;
  onSwitchTab: (id: string) => void;
  onCloseTab: (id: string, e: React.MouseEvent) => void;
  onPinTab: (id: string) => void;
  onMuteTab: (id: string) => void;
  onDuplicateTab: (id: string) => void;
  onTabContextMenu: (id: string, e: React.MouseEvent) => void;
  moveTab: (fromIndex: number, toIndex: number) => void;
}> = ({
  tab,
  index,
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onPinTab,
  onMuteTab,
  onDuplicateTab,
  onTabContextMenu,
  moveTab,
}) => {
  const isActive = tab.id === activeTabId;
  const isPinned = tab.pinned || false;
  const isMuted = tab.muted || false;
  const isLoading = tab.loading || false;

  const [{ isDragging }, drag] = useDrag({
    type: 'TAB',
    item: { id: tab.id, index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
    end: (item, monitor) => {
      const dropResult = monitor.getDropResult();
      if (dropResult && dropResult.index !== index) {
        moveTab(index, dropResult.index);
      }
    },
  });

  const [, drop] = useDrop({
    accept: 'TAB',
    hover: (item: { index: number }) => {
      if (item.index !== index) {
        moveTab(item.index, index);
      }
    },
  });

  const handleDrag = drag;
  const handleDrop = drop;

  const handleClick = (e: React.MouseEvent) => {
    if (e.button === 1) { // Middle click
      e.preventDefault();
      onCloseTab(tab.id, e);
    } else {
      onSwitchTab(tab.id);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onTabContextMenu(tab.id, e);
  };

  return (
    <div
      ref={(node) => {
        handleDrag(node);
        handleDrop(node);
      }}
      className={`tab ${isActive ? 'active' : ''} ${isPinned ? 'pinned' : ''} ${isMuted ? 'muted' : ''} ${isDragging ? 'dragging' : ''}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onDoubleClick={() => { if (isPinned) onPinTab(tab.id); }}
      style={{ opacity: isDragging ? 0.5 : 1 }}
    >
      {tab.favicon && (
        <img
          className="tab-favicon"
          src={tab.favicon}
          alt=""
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      )}
      <span className="tab-title">{tab.title}</span>
      {isLoading && <span className="tab-loading-indicator" />}
      {tab.audioPlaying && !isMuted && <span className="tab-audio-indicator" title="Playing audio">🔊</span>}
      {isMuted && <span className="tab-muted-indicator" title="Muted" onClick={(e) => { e.stopPropagation(); onMuteTab(tab.id); }}>🔇</span>}
      {isPinned && <span className="tab-pinned-indicator" title="Pinned" onClick={(e) => { e.stopPropagation(); onPinTab(tab.id); }}>📌</span>}
      {!isPinned && (
        <span className="tab-close" onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id, e); }}>✕</span>
      )}
    </div>
  );
};

export const TabStrip: React.FC<TabStripProps> = ({
  tabs,
  activeTabId,
  onCreateTab,
  onCloseTab,
  onSwitchTab,
  onPinTab,
  onMuteTab,
  onDuplicateTab,
  onReopenClosedTab,
  onTabContextMenu,
  closedTabs,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onReload,
  onStop,
  isLoading,
}) => {
  const [showTabSearch, setShowTabSearch] = useState(false);
  const [tabSearchQuery, setTabSearchQuery] = useState('');
  const tabSearchInputRef = useRef<HTMLInputElement>(null);

  const pinnedTabs = tabs.filter(t => t.pinned);
  const regularTabs = tabs.filter(t => !t.pinned);

  const moveTab = useCallback((fromIndex: number, toIndex: number) => {
    // This would need to be implemented in parent to reorder tabs array
    console.log('Move tab', fromIndex, toIndex);
  }, []);

  const filteredTabs = tabSearchQuery
    ? tabs.filter(t => t.title.toLowerCase().includes(tabSearchQuery.toLowerCase()))
    : tabs;

  useEffect(() => {
    if (showTabSearch) {
      setTimeout(() => tabSearchInputRef.current?.focus(), 0);
    }
  }, [showTabSearch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowTabSearch(false);
      setTabSearchQuery('');
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
      e.preventDefault();
      onReopenClosedTab();
    }
  };

  return (
    <div className="tab-strip-container" onKeyDown={handleKeyDown}>
      <div className="tab-strip-header">
        <div className="tab-strip-left">
          <button className="tab-strip-btn" onClick={onBack} disabled={!canGoBack} title="Back (Alt+Left)">←</button>
          <button className="tab-strip-btn" onClick={onForward} disabled={!canGoForward} title="Forward (Alt+Right)">→</button>
          <button className="tab-strip-btn" onClick={isLoading ? onStop : onReload} title={isLoading ? 'Stop (Esc)' : 'Reload (F5/Ctrl+R)'}>
            {isLoading ? '✕' : '⟳'}
          </button>
        </div>
        <div className="tab-strip-tabs">
          <DndProvider backend={HTML5Backend}>
            <div className="tab-strip-dnd" style={{ display: 'flex', gap: '2px' }}>
              {pinnedTabs.length > 0 && (
                <>
                  <div className="tab-group-divider">Pinned</div>
                  {pinnedTabs.map((tab, i) => (
                    <TabItem
                      key={tab.id}
                      tab={tab}
                      index={i}
                      activeTabId={activeTabId}
                      onSwitchTab={onSwitchTab}
                      onCloseTab={onCloseTab}
                      onPinTab={onPinTab}
                      onMuteTab={onMuteTab}
                      onDuplicateTab={onDuplicateTab}
                      onTabContextMenu={onTabContextMenu}
                      moveTab={moveTab}
                    />
                  ))}
                  <div className="tab-group-divider">Tabs</div>
                </>
              )}
              {regularTabs.map((tab, i) => (
                <TabItem
                  key={tab.id}
                  tab={tab}
                  index={pinnedTabs.length + i}
                  activeTabId={activeTabId}
                  onSwitchTab={onSwitchTab}
                  onCloseTab={onCloseTab}
                  onPinTab={onPinTab}
                  onMuteTab={onMuteTab}
                  onDuplicateTab={onDuplicateTab}
                  onTabContextMenu={onTabContextMenu}
                  moveTab={moveTab}
                />
              ))}
              {tabs.length === 0 && (
                <div className="tab new-tab-placeholder" onClick={() => onCreateTab('about:blank')}>
                  <span>+ New Tab</span>
                </div>
              )}
            </div>
          </DndProvider>
        </div>
        <div className="tab-strip-right">
          <button className="tab-strip-btn new-tab-btn" onClick={() => onCreateTab('about:blank')} title="New Tab (Ctrl+T)">+</button>
          <button className="tab-strip-btn" onClick={() => { setShowTabSearch(true); setTabSearchQuery(''); }} title="Search Tabs (Ctrl+Shift+A)">🔍</button>
          {showTabSearch && (
            <input
              ref={tabSearchInputRef}
              type="text"
              className="tab-search-input"
              placeholder="Search tabs..."
              value={tabSearchQuery}
              onChange={(e) => setTabSearchQuery(e.target.value)}
              onBlur={() => { setTimeout(() => { setShowTabSearch(false); setTabSearchQuery(''); }, 100); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { const match = filteredTabs[0]; if (match) onSwitchTab(match.id); setShowTabSearch(false); setTabSearchQuery(''); }}}
            />
          )}
        </div>
      </div>
      {showTabSearch && filteredTabs.length > 0 && (
        <div className="tab-search-results">
          {filteredTabs.map(tab => (
            <div key={tab.id} className="tab-search-result" onClick={() => { onSwitchTab(tab.id); setShowTabSearch(false); setTabSearchQuery(''); }}>
              <span>{tab.title}</span>
              <span className="tab-search-url">{tab.url}</span>
            </div>
          ))}
        </div>
      )}
      {closedTabs.length > 0 && (
        <div className="reopen-closed-indicator" onClick={onReopenClosedTab}>
          {closedTabs.length} closed tab{closedTabs.length > 1 ? 's' : ''} · Click to reopen (Ctrl+Shift+T)
        </div>
      )}
    </div>
  );
};