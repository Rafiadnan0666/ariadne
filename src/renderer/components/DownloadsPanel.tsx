import React, { useState, useEffect, useCallback } from 'react';

interface DownloadItem {
  id: string;
  url: string;
  filename: string;
  totalBytes: number;
  receivedBytes: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  startTime: number;
  endTime?: number;
  mimeType?: string;
  filePath?: string;
  canResume: boolean;
  isDangerous?: boolean;
}

interface DownloadsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  downloads: DownloadItem[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onOpenFile: (id: string) => void;
  onShowInFolder: (id: string) => void;
  onClearAll: () => void;
  onRetry: (id: string) => void;
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const formatTime = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
};

const getFileIcon = (mimeType?: string, filename?: string): string => {
  if (!mimeType && filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (['pdf'].includes(ext || '')) return '📄';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext || '')) return '📦';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext || '')) return '🖼️';
    if (['mp4', 'webm', 'mov', 'avi'].includes(ext || '')) return '🎬';
    if (['mp3', 'wav', 'ogg', 'flac'].includes(ext || '')) return '🎵';
    if (['exe', 'msi', 'dmg', 'app'].includes(ext || '')) return '⚙️';
    if (['txt', 'md', 'json', 'xml', 'csv'].includes(ext || '')) return '📝';
  }
  if (mimeType?.startsWith('image/')) return '🖼️';
  if (mimeType?.startsWith('video/')) return '🎬';
  if (mimeType?.startsWith('audio/')) return '🎵';
  if (mimeType?.startsWith('application/pdf')) return '📄';
  if (mimeType?.includes('zip') || mimeType?.includes('compressed')) return '📦';
  return '📄';
};

export const DownloadsPanel: React.FC<DownloadsPanelProps> = ({
  isOpen,
  onClose,
  downloads,
  onPause,
  onResume,
  onCancel,
  onRemove,
  onOpenFile,
  onShowInFolder,
  onClearAll,
  onRetry,
}) => {
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'dangerous'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredDownloads = downloads
    .filter(d => {
      if (filter === 'active') return d.state === 'progressing';
      if (filter === 'completed') return d.state === 'completed';
      if (filter === 'dangerous') return d.isDangerous;
      return true;
    })
    .filter(d => d.filename.toLowerCase().includes(searchQuery.toLowerCase()) || d.url.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => b.startTime - a.startTime);

  const activeCount = downloads.filter(d => d.state === 'progressing').length;

  if (!isOpen) return null;

  return (
    <div className="downloads-panel">
      <div className="downloads-header">
        <h3>Downloads {activeCount > 0 && <span className="downloads-badge">{activeCount}</span>}</h3>
        <div className="downloads-header-actions">
          <select value={filter} onChange={e => setFilter(e.target as HTMLSelectElement).value} className="downloads-filter">
            <option value="all">All</option>
            <option value="active">In Progress</option>
            <option value="completed">Completed</option>
            <option value="dangerous">Dangerous</option>
          </select>
          <input
            type="text"
            className="downloads-search"
            placeholder="Search downloads..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {downloads.length > 0 && (
            <button className="downloads-clear-btn" onClick={onClearAll}>Clear All</button>
          )}
          <button className="downloads-close-btn" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="downloads-list">
        {filteredDownloads.length === 0 ? (
          <div className="downloads-empty">
            {downloads.length === 0 ? 'No downloads yet' : 'No downloads match your filter'}
          </div>
        ) : (
          filteredDownloads.map(download => (
            <div key={download.id} className={`download-item ${download.state} ${download.isDangerous ? 'dangerous' : ''}`}>
              <div className="download-icon">{getFileIcon(download.mimeType, download.filename)}</div>
              <div className="download-info">
                <div className="download-filename" title={download.filename}>{download.filename}</div>
                <div className="download-url" title={download.url}>{download.url}</div>
                <div className="download-progress-bar">
                  <div
                    className="download-progress-fill"
                    style={{ width: download.totalBytes > 0 ? `${(download.receivedBytes / download.totalBytes) * 100}%` : '0%' }}
                  />
                </div>
                <div className="download-meta">
                  <span>{formatBytes(download.receivedBytes)} / {formatBytes(download.totalBytes)}</span>
                  {download.state === 'progressing' && download.receivedBytes > 0 && (
                    <span>
                      {formatBytes(download.receivedBytes / ((Date.now() - download.startTime) / 1000))}/s
                      · ETA: {formatTime((download.totalBytes - download.receivedBytes) / (download.receivedBytes / ((Date.now() - download.startTime) / 1000)))}
                    </span>
                  )}
                  {download.state === 'completed' && <span>✓ Completed</span>}
                  {download.state === 'cancelled' && <span>✕ Cancelled</span>}
                  {download.state === 'interrupted' && <span>⚠ Interrupted</span>}
                  {download.isDangerous && <span className="download-warning">⚠ Potentially unsafe</span>}
                </div>
              </div>
              <div className="download-actions">
                {download.state === 'progressing' && (
                  <button className="download-btn" onClick={() => onPause(download.id)} title="Pause">⏸</button>
                )}
                {(download.state === 'interrupted' || download.state === 'cancelled') && download.canResume && (
                  <button className="download-btn" onClick={() => onResume(download.id)} title="Resume">▶</button>
                )}
                {download.state === 'progressing' && (
                  <button className="download-btn" onClick={() => onCancel(download.id)} title="Cancel">✕</button>
                )}
                {download.state === 'completed' && (
                  <>
                    <button className="download-btn" onClick={() => onOpenFile(download.id)} title="Open">📂</button>
                    <button className="download-btn" onClick={() => onShowInFolder(download.id)} title="Show in folder">📁</button>
                  </>
                )}
                {download.state === 'interrupted' && !download.canResume && (
                  <button className="download-btn" onClick={() => onRetry(download.id)} title="Retry">⟳</button>
                )}
                <button className="download-btn" onClick={() => onRemove(download.id)} title="Remove from list">🗑</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};