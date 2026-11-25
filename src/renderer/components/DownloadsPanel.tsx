import React, { useMemo, useState } from 'react'
import type { DownloadDTO } from '../types'
import { Icon } from './Icon'

interface DownloadsPanelProps {
  isOpen: boolean
  onClose: () => void
  downloads: DownloadDTO[]
  onPause: (id: string) => void
  onResume: (id: string) => void
  onCancel: (id: string) => void
  onRemove: (id: string) => void
  onOpenFile: (id: string) => void
  onShowInFolder: (id: string) => void
  onClearAll: () => void
  onRetry: (id: string) => void
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`
}

function fileKind(mimeType?: string, filename?: string): 'archive' | 'image' | 'video' | 'audio' | 'document' | 'file' {
  const ext = filename?.split('.').pop()?.toLowerCase() || ''
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive'
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'].includes(ext)) return 'image'
  if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) return 'audio'
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'csv'].includes(ext)) return 'document'
  if (mimeType?.startsWith('image/')) return 'image'
  if (mimeType?.startsWith('video/')) return 'video'
  if (mimeType?.startsWith('audio/')) return 'audio'
  return 'file'
}

const KIND_ICON = {
  archive: 'folder',
  image: 'globe',
  video: 'play',
  audio: 'volume',
  document: 'copy',
  file: 'download',
} as const

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
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'dangerous'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const filtered = useMemo(
    () =>
      downloads
        .filter((download) => {
          if (filter === 'active') return download.state === 'progressing'
          if (filter === 'completed') return download.state === 'completed'
          if (filter === 'dangerous') return download.isDangerous
          return true
        })
        .filter((download) => {
          const query = searchQuery.trim().toLowerCase()
          if (!query) return true
          return download.filename.toLowerCase().includes(query) || download.url.toLowerCase().includes(query)
        })
        .sort((a, b) => b.startTime - a.startTime),
    [downloads, filter, searchQuery]
  )

  if (!isOpen) return null

  const activeCount = downloads.filter((download) => download.state === 'progressing').length

  return (
    <aside className="downloads-panel" aria-label="Downloads">
      <header className="downloads-header">
        <div className="downloads-title">
          <Icon name="download" size={15} />
          <h3>Downloads</h3>
          {activeCount > 0 && <span className="downloads-badge">{activeCount}</span>}
        </div>
        <div className="downloads-header-actions">
          {downloads.length > 0 && (
            <button className="text-btn" onClick={onClearAll}>
              Clear list
            </button>
          )}
          <button className="icon-btn" onClick={onClose} title="Close downloads" aria-label="Close downloads">
            <Icon name="close" size={15} />
          </button>
        </div>
      </header>

      <div className="downloads-toolbar">
        <div className="downloads-segmented" role="group" aria-label="Filter downloads">
          {(
            [
              ['all', 'All'],
              ['active', 'Active'],
              ['completed', 'Done'],
              ['dangerous', 'Unsafe'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? 'active' : ''}
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="downloads-search"
          placeholder="Search downloads"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          aria-label="Search downloads"
        />
      </div>

      <div className="downloads-list">
        {filtered.length === 0 ? (
          <div className="downloads-empty">
            <Icon name="download" size={22} />
            <p>{downloads.length === 0 ? 'Nothing downloaded yet.' : 'No downloads match this filter.'}</p>
          </div>
        ) : (
          filtered.map((download) => {
            const progress = download.totalBytes > 0 ? (download.receivedBytes / download.totalBytes) * 100 : 0
            const elapsed = Math.max(1, (Date.now() - download.startTime) / 1000)
            const speed = download.receivedBytes / elapsed
            const eta = speed > 0 && download.totalBytes > download.receivedBytes ? (download.totalBytes - download.receivedBytes) / speed : 0
            const paused = download.paused === true
            return (
              <div key={download.id} className={`download-item ${download.state} ${download.isDangerous ? 'dangerous' : ''}`}>
                <span className={`download-icon ${fileKind(download.mimeType, download.filename)}`}>
                  <Icon name={KIND_ICON[fileKind(download.mimeType, download.filename)]} size={15} />
                </span>
                <div className="download-info">
                  <div className="download-filename" title={download.filename}>
                    {download.filename}
                  </div>
                  <div className="download-url" title={download.url}>
                    {download.url}
                  </div>
                  {download.state === 'progressing' && (
                    <>
                      <div className="download-progress-bar" aria-hidden="true">
                        <div className="download-progress-fill" style={{ width: `${Math.min(100, progress)}%` }} />
                      </div>
                      <div className="download-meta">
                        <span>
                          {formatBytes(download.receivedBytes)}
                          {download.totalBytes > 0 ? ` / ${formatBytes(download.totalBytes)}` : ''}
                        </span>
                        {!paused && speed > 0 && (
                          <span>
                            {formatBytes(speed)}/s · ETA {formatTime(eta * 1000)}
                          </span>
                        )}
                        {paused && <span>Paused</span>}
                      </div>
                    </>
                  )}
                  {download.state === 'completed' && (
                    <div className="download-meta">
                      <span>{formatBytes(download.totalBytes || download.receivedBytes)}</span>
                      <span className="download-done">
                        <Icon name="check" size={11} /> Completed
                      </span>
                    </div>
                  )}
                  {download.state === 'cancelled' && <div className="download-meta">Cancelled</div>}
                  {download.state === 'interrupted' && (
                    <div className="download-meta">
                      <span className="download-warning">
                        <Icon name="alert" size={11} /> Interrupted
                      </span>
                    </div>
                  )}
                  {download.isDangerous && (
                    <div className="download-warning">
                      <Icon name="alert" size={11} /> Potentially unsafe file
                    </div>
                  )}
                </div>
                <div className="download-actions">
                  {download.state === 'progressing' &&
                    (paused ? (
                      <button className="download-btn" onClick={() => onResume(download.id)} title="Resume" aria-label="Resume download">
                        <Icon name="play" size={13} />
                      </button>
                    ) : (
                      <button className="download-btn" onClick={() => onPause(download.id)} title="Pause" aria-label="Pause download">
                        <Icon name="pause" size={13} />
                      </button>
                    ))}
                  {download.state === 'progressing' && (
                    <button className="download-btn" onClick={() => onCancel(download.id)} title="Cancel" aria-label="Cancel download">
                      <Icon name="close" size={13} />
                    </button>
                  )}
                  {download.state === 'completed' && (
                    <>
                      <button className="download-btn" onClick={() => onOpenFile(download.id)} title="Open file" aria-label="Open file">
                        <Icon name="external" size={13} />
                      </button>
                      <button
                        className="download-btn"
                        onClick={() => onShowInFolder(download.id)}
                        title="Show in folder"
                        aria-label="Show in folder"
                      >
                        <Icon name="folder" size={13} />
                      </button>
                    </>
                  )}
                  {(download.state === 'interrupted' || download.state === 'cancelled') && download.canResume && (
                    <button className="download-btn" onClick={() => onResume(download.id)} title="Resume" aria-label="Resume download">
                      <Icon name="play" size={13} />
                    </button>
                  )}
                  {download.state === 'interrupted' && !download.canResume && (
                    <button className="download-btn" onClick={() => onRetry(download.id)} title="Retry" aria-label="Retry download">
                      <Icon name="retry" size={13} />
                    </button>
                  )}
                  <button className="download-btn" onClick={() => onRemove(download.id)} title="Remove from list" aria-label="Remove from list">
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
