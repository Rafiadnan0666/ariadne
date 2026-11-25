import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { BookmarkDTO } from '../types'
import { Icon } from './Icon'

interface BookmarksBarProps {
  bookmarks: BookmarkDTO[]
  onNavigate: (url: string) => void
  onAdd: (bookmark: { title: string; url: string; folderId?: string }) => void
  onAddFolder: (title: string, parentId?: string) => void
  onUpdate: (id: string, updates: { title?: string; url?: string }) => void
  onDelete: (id: string) => void
  onToggle: () => void
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

interface MenuState {
  x: number
  y: number
  bookmark: BookmarkDTO
}

export const BookmarksBar: React.FC<BookmarksBarProps> = ({
  bookmarks,
  onNavigate,
  onAdd,
  onAddFolder,
  onUpdate,
  onDelete,
  onToggle,
}) => {
  const [openFolderId, setOpenFolderId] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)

  const roots = bookmarks.filter((bookmark) => !bookmark.parentId)
  const openFolder = openFolderId ? bookmarks.find((bookmark) => bookmark.id === openFolderId) : null
  const childrenOf = useCallback(
    (parentId?: string) => bookmarks.filter((bookmark) => bookmark.parentId === (parentId || undefined)),
    [bookmarks]
  )

  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(event.target as Node)) {
        setOpenFolderId(null)
        setAddMenuOpen(false)
        setMenu(null)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenFolderId(null)
        setAddMenuOpen(false)
        setMenu(null)
      }
    }
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const promptEdit = (bookmark: BookmarkDTO) => {
    const title = window.prompt('Bookmark name', bookmark.title)
    if (title === null) return
    if (bookmark.isFolder) {
      if (title.trim()) onUpdate(bookmark.id, { title: title.trim() })
      return
    }
    const url = window.prompt('Bookmark URL', bookmark.url)
    if (url === null) return
    if (title.trim() && url.trim()) onUpdate(bookmark.id, { title: title.trim(), url: url.trim() })
  }

  const promptNewBookmark = (folderId?: string) => {
    const title = window.prompt('Bookmark name')
    if (title === null || !title.trim()) return
    const url = window.prompt('Bookmark URL', 'https://')
    if (url === null || !url.trim()) return
    onAdd({ title: title.trim(), url: url.trim(), folderId })
    setAddMenuOpen(false)
  }

  const promptNewFolder = (parentId?: string) => {
    const title = window.prompt('Folder name')
    if (title === null || !title.trim()) return
    onAddFolder(title.trim(), parentId)
    setAddMenuOpen(false)
  }

  const openMenu = (bookmark: BookmarkDTO, event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 260),
      bookmark,
    })
  }

  return (
    <div className="bookmarks-bar" ref={barRef}>
      <div className="bookmarks-items">
        {roots.map((bookmark) => (
          <button
            key={bookmark.id}
            className={`bookmark-chip ${bookmark.isFolder ? 'folder' : ''} ${openFolderId === bookmark.id ? 'active' : ''}`}
            title={bookmark.isFolder ? bookmark.title : `${bookmark.title}\n${bookmark.url}`}
            onClick={() => {
              if (bookmark.isFolder) {
                setOpenFolderId((current) => (current === bookmark.id ? null : bookmark.id))
              } else {
                onNavigate(bookmark.url)
              }
            }}
            onContextMenu={(event) => openMenu(bookmark, event)}
          >
            <Icon name={bookmark.isFolder ? 'folder' : 'star'} size={13} filled={!bookmark.isFolder} />
            <span>{bookmark.title || (bookmark.isFolder ? 'Folder' : hostOf(bookmark.url))}</span>
            {bookmark.isFolder && <Icon name="chevron" size={11} />}
          </button>
        ))}
        {roots.length === 0 && (
          <span className="bookmarks-empty">Bookmarks you save appear here. Press Ctrl+D on a page.</span>
        )}
      </div>

      <div className="bookmarks-actions">
        <button
          className={`icon-btn ${addMenuOpen ? 'active' : ''}`}
          title="Add bookmark or folder"
          aria-label="Add bookmark or folder"
          onClick={() => setAddMenuOpen((open) => !open)}
        >
          <Icon name="plus" size={14} />
        </button>
        <button className="icon-btn" title="Hide bookmarks bar (Ctrl+Shift+B)" aria-label="Hide bookmarks bar" onClick={onToggle}>
          <Icon name="chevron" size={14} className="rotate-180" />
        </button>
      </div>

      {addMenuOpen && (
        <div className="bookmarks-menu add" role="menu">
          <button role="menuitem" onClick={() => promptNewBookmark(undefined)}>
            <Icon name="star" size={14} /> Add bookmark
          </button>
          <button role="menuitem" onClick={() => promptNewFolder(undefined)}>
            <Icon name="folder" size={14} /> New folder
          </button>
        </div>
      )}

      {openFolder && (
        <div className="bookmarks-folder" role="menu" aria-label={openFolder.title}>
          <div className="bookmarks-folder-head">
            <Icon name="folder" size={13} />
            <strong>{openFolder.title}</strong>
          </div>
          {childrenOf(openFolder.id).length === 0 && <div className="bookmarks-folder-empty">This folder is empty.</div>}
          {childrenOf(openFolder.id).map((child) =>
            child.isFolder ? (
              <div key={child.id} className="bookmarks-folder-group">
                <div className="bookmarks-folder-group-head">
                  <Icon name="folder" size={12} />
                  {child.title}
                </div>
                {childrenOf(child.id).map((leaf) => (
                  <button
                    key={leaf.id}
                    className="bookmarks-folder-row"
                    role="menuitem"
                    onClick={() => {
                      setOpenFolderId(null)
                      onNavigate(leaf.url)
                    }}
                    onContextMenu={(event) => openMenu(leaf, event)}
                  >
                    <Icon name="star" size={11} filled />
                    <span>{leaf.title || hostOf(leaf.url)}</span>
                    <span className="bookmarks-folder-host">{hostOf(leaf.url)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <button
                key={child.id}
                className="bookmarks-folder-row"
                role="menuitem"
                onClick={() => {
                  setOpenFolderId(null)
                  onNavigate(child.url)
                }}
                onContextMenu={(event) => openMenu(child, event)}
              >
                <Icon name="star" size={11} filled />
                <span>{child.title || hostOf(child.url)}</span>
                <span className="bookmarks-folder-host">{hostOf(child.url)}</span>
              </button>
            )
          )}
          <div className="bookmarks-folder-foot">
            <button className="text-btn" onClick={() => promptNewBookmark(openFolder.id)}>
              <Icon name="plus" size={12} /> Add bookmark
            </button>
          </div>
        </div>
      )}

      {menu && (
        <>
          <div className="menu-scrim" onMouseDown={() => setMenu(null)} />
          <div
            className="context-menu bookmarks-context"
            style={{ left: menu.x, top: menu.y }}
            role="menu"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="context-menu-title">{menu.bookmark.title || hostOf(menu.bookmark.url)}</div>
            {!menu.bookmark.isFolder && (
              <button
                role="menuitem"
                onClick={() => {
                  onNavigate(menu.bookmark.url)
                  setMenu(null)
                }}
              >
                <Icon name="external" size={14} /> Open
              </button>
            )}
            <button
              role="menuitem"
              onClick={() => {
                promptEdit(menu.bookmark)
                setMenu(null)
              }}
            >
              <Icon name="settings" size={14} /> Edit
            </button>
            {menu.bookmark.isFolder && (
              <button
                role="menuitem"
                onClick={() => {
                  promptNewBookmark(menu.bookmark.id)
                  setMenu(null)
                }}
              >
                <Icon name="plus" size={14} /> Add bookmark here
              </button>
            )}
            <div className="context-menu-sep" />
            <button
              role="menuitem"
              className="danger"
              onClick={() => {
                onDelete(menu.bookmark.id)
                setMenu(null)
                if (openFolderId === menu.bookmark.id) setOpenFolderId(null)
              }}
            >
              <Icon name="trash" size={14} /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}
