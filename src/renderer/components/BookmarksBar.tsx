import React, { useState, useRef, useEffect } from 'react';

interface Bookmark {
  id: string;
  title: string;
  url: string;
  folderId?: string;
  parentId?: string;
  isFolder: boolean;
  children?: Bookmark[];
  dateAdded: number;
  dateModified?: number;
}

interface BookmarksBarProps {
  bookmarks: Bookmark[];
  onNavigate: (url: string) => void;
  onEditBookmark: (bookmark: Bookmark) => void;
  onDeleteBookmark: (id: string) => void;
  onCreateBookmark: (parentId: string | undefined, title: string, url: string, isFolder: boolean) => void;
  showBookmarksBar: boolean;
  toggleBookmarksBar: () => void;
}

const BookmarkItem: React.FC<{
  bookmark: Bookmark;
  level: number;
  onNavigate: (url: string) => void;
  onEdit: (bookmark: Bookmark) => void;
  onDelete: (id: string) => void;
  onCreate: (parentId: string | undefined, title: string, url: string, isFolder: boolean) => void;
}> = ({ bookmark, level, onNavigate, onEdit, onDelete, onCreate }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(bookmark.title);
  const [editUrl, setEditUrl] = useState(bookmark.url);
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [newFolderTitle, setNewFolderTitle] = useState('');
  const [showAddBookmark, setShowAddBookmark] = useState(false);
  const [newBookmarkTitle, setNewBookmarkTitle] = useState('');
  const [newBookmarkUrl, setNewBookmarkUrl] = useState('');

  const handleNavigate = (e: React.MouseEvent) => {
    if (bookmark.isFolder) {
      e.preventDefault();
      setIsExpanded(!isExpanded);
    } else {
      onNavigate(bookmark.url);
    }
  };

  const handleSaveEdit = () => {
    onEdit({ ...bookmark, title: editTitle, url: editUrl });
    setIsEditing(false);
  };

  const handleAddFolder = () => {
    if (newFolderTitle.trim()) {
      onCreate(bookmark.id, newFolderTitle.trim(), '', true);
      setShowAddFolder(false);
      setNewFolderTitle('');
    }
  };

  const handleAddBookmark = () => {
    if (newBookmarkTitle.trim() && newBookmarkUrl.trim()) {
      onCreate(bookmark.id, newBookmarkTitle.trim(), newBookmarkUrl.trim(), false);
      setShowAddBookmark(false);
      setNewBookmarkTitle('');
      setNewBookmarkUrl('');
    }
  };

  return (
    <div className="bookmark-item" style={{ paddingLeft: `${level * 16 + 8}px` }}>
      <div className="bookmark-row">
        {bookmark.isFolder && (
          <span className="bookmark-folder-toggle" onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}>
            {isExpanded ? '▼' : '▶'}
          </span>
        )}
        {!bookmark.isFolder && <span className="bookmark-icon">🌐</span>}
        {isEditing ? (
          <input
            type="text"
            className="bookmark-edit-input"
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveEdit()}
            onBlur={handleSaveEdit}
            autoFocus
          />
        ) : (
          <span className="bookmark-title" onClick={handleNavigate}>{bookmark.title}</span>
        )}
        {!bookmark.isFolder && (
          <span className="bookmark-url" onClick={handleNavigate}>{bookmark.url}</span>
        )}
        <div className="bookmark-actions">
          {bookmark.isFolder && (
            <>
              <button className="bookmark-btn" onClick={() => setShowAddFolder(true)} title="Add folder">📁</button>
              <button className="bookmark-btn" onClick={() => setShowAddBookmark(true)} title="Add bookmark">🔖</button>
            </>
          )}
          <button className="bookmark-btn" onClick={() => setIsEditing(true)} title="Edit">✏</button>
          <button className="bookmark-btn" onClick={() => onDelete(bookmark.id)} title="Delete">🗑</button>
        </div>
      </div>
      {showAddFolder && (
        <div className="bookmark-add-form">
          <input
            type="text"
            placeholder="Folder name"
            value={newFolderTitle}
            onChange={e => setNewFolderTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddFolder()}
            autoFocus
          />
          <button className="bookmark-btn" onClick={handleAddFolder}>Add</button>
          <button className="bookmark-btn" onClick={() => setShowAddFolder(false)}>Cancel</button>
        </div>
      )}
      {showAddBookmark && (
        <div className="bookmark-add-form">
          <input
            type="text"
            placeholder="Title"
            value={newBookmarkTitle}
            onChange={e => setNewBookmarkTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddBookmark()}
            autoFocus
          />
          <input
            type="text"
            placeholder="URL"
            value={newBookmarkUrl}
            onChange={e => setNewBookmarkUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddBookmark()}
          />
          <button className="bookmark-btn" onClick={handleAddBookmark}>Add</button>
          <button className="bookmark-btn" onClick={() => setShowAddBookmark(false)}>Cancel</button>
        </div>
      )}
      {bookmark.isFolder && isExpanded && bookmark.children && (
        <div className="bookmark-children">
          {bookmark.children.map(child => (
            <BookmarkItem
              key={child.id}
              bookmark={child}
              level={level + 1}
              onNavigate={onNavigate}
              onEdit={onEdit}
              onDelete={onDelete}
              onCreate={onCreate}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const BookmarksBar: React.FC<BookmarksBarProps> = ({
  bookmarks,
  onNavigate,
  onEditBookmark,
  onDeleteBookmark,
  onCreateBookmark,
  showBookmarksBar,
  toggleBookmarksBar,
}) => {
  const rootBookmarks = bookmarks.filter(b => !b.parentId);
  const [showManager, setShowManager] = useState(false);

  if (!showBookmarksBar && !showManager) return null;

  return (
    <div className="bookmarks-bar-container">
      <div className="bookmarks-bar">
        <button className="bookmarks-toggle" onClick={toggleBookmarksBar} title="Toggle Bookmarks Bar (Ctrl+Shift+B)">
          ★
        </button>
        <div className="bookmarks-root">
          {rootBookmarks.map(bookmark => (
            <BookmarkItem
              key={bookmark.id}
              bookmark={bookmark}
              level={0}
              onNavigate={onNavigate}
              onEdit={onEditBookmark}
              onDelete={onDeleteBookmark}
              onCreate={onCreateBookmark}
            />
          ))}
          <button className="bookmark-add-root" onClick={() => onCreateBookmark(undefined, '', '', false)} title="Add bookmark">+</button>
          <button className="bookmark-add-root" onClick={() => onCreateBookmark(undefined, '', '', true)} title="Add folder">📁</button>
        </div>
        <button className="bookmarks-manager-btn" onClick={() => setShowManager(true)} title="Bookmark Manager">📚</button>
      </div>
      {showManager && (
        <div className="bookmarks-manager-overlay" onClick={() => setShowManager(false)}>
          <div className="bookmarks-manager" onClick={e => e.stopPropagation()}>
            <div className="bookmarks-manager-header">
              <h3>Bookmark Manager</h3>
              <button onClick={() => setShowManager(false)}>✕</button>
            </div>
            <div className="bookmarks-manager-content">
              <div className="bookmarks-manager-tree">
                {rootBookmarks.map(bookmark => (
                  <BookmarkItem
                    key={bookmark.id}
                    bookmark={bookmark}
                    level={0}
                    onNavigate={onNavigate}
                    onEdit={onEditBookmark}
                    onDelete={onDeleteBookmark}
                    onCreate={onCreateBookmark}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};