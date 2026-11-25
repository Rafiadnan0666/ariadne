import { app, DownloadItem, Session, shell } from 'electron'
import Store from 'electron-store'
import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'

export interface DownloadRecord {
  id: string
  url: string
  filename: string
  totalBytes: number
  receivedBytes: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  startTime: number
  endTime?: number
  mimeType?: string
  filePath?: string
  canResume: boolean
  paused?: boolean
  isDangerous?: boolean
  isPrivate?: boolean
}

const RISKY_EXTENSIONS = new Set([
  '.exe',
  '.msi',
  '.bat',
  '.cmd',
  '.com',
  '.scr',
  '.ps1',
  '.vbs',
  '.js',
  '.jar',
  '.dmg',
  '.pkg',
  '.appimage',
])

function isRisky(filename: string): boolean {
  return RISKY_EXTENSIONS.has(path.extname(filename).toLowerCase())
}

function uniquePath(directory: string, filename: string): string {
  const safeName = path.basename(filename).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'download'
  const extension = path.extname(safeName)
  const stem = safeName.slice(0, safeName.length - extension.length) || 'download'
  let candidate = path.join(directory, safeName)
  let counter = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${stem} (${counter})${extension}`)
    counter += 1
  }
  return candidate
}

/**
 * Real download handling backed by Electron's will-download event. The renderer
 * only ever receives serialisable records, never DownloadItem handles.
 */
export class DownloadManager extends EventEmitter {
  private readonly store = new Store({ name: 'downloads' }) as unknown as {
    get(key: string): unknown
    set(key: string, value: unknown): void
  }
  private readonly items = new Map<string, DownloadItem>()
  private records: DownloadRecord[] = []
  private counter = 0
  private directory = ''
  private readonly sessions = new Map<boolean, Session>()

  constructor() {
    super()
    const saved = this.store.get('downloads')
    if (Array.isArray(saved)) {
      this.records = (saved as DownloadRecord[]).map((record) =>
        record.state === 'progressing'
          ? { ...record, state: 'interrupted', paused: false, canResume: true }
          : record
      )
    }
  }

  setDirectory(directory: string): void {
    if (directory && fs.existsSync(directory)) this.directory = directory
  }

  getDirectory(): string {
    if (!this.directory) {
      try {
        this.directory = app.getPath('downloads')
      } catch {
        this.directory = app.getPath('temp')
      }
    }
    return this.directory
  }

  attach(session: Session, isPrivate = false): void {
    if (this.sessions.get(isPrivate) === session) return
    this.sessions.set(isPrivate, session)
    session.on('will-download', (_event, item) => this.start(item, isPrivate))
  }

  getDownloads(isPrivate = false): DownloadRecord[] {
    return this.records
      .filter((record) => (record.isPrivate === true) === isPrivate)
      .map((record) => ({ ...record }))
  }

  pause(id: string): boolean {
    const item = this.items.get(id)
    if (!item) return false
    item.pause()
    const record = this.records.find((candidate) => candidate.id === id)
    if (record) {
      record.paused = true
      this.emitUpdate(record)
    }
    return true
  }

  resume(id: string): boolean {
    const item = this.items.get(id)
    if (!item || !item.canResume()) return false
    item.resume()
    const record = this.records.find((candidate) => candidate.id === id)
    if (record) {
      record.paused = false
      this.emitUpdate(record)
    }
    return true
  }

  cancel(id: string): boolean {
    const item = this.items.get(id)
    if (!item) return false
    item.cancel()
    return true
  }

  remove(id: string): void {
    const item = this.items.get(id)
    if (item) item.cancel()
    this.items.delete(id)
    this.records = this.records.filter((record) => record.id !== id)
    this.persist()
    this.emit('removed', id)
  }

  clear(isPrivate = false): void {
    for (const [id, item] of this.items) {
      if (item.getState() === 'progressing') item.cancel()
      this.items.delete(id)
    }
    this.records = this.records.filter((record) => (record.isPrivate === true) !== isPrivate)
    this.persist()
    this.emit('cleared')
  }

  open(id: string): void {
    const record = this.records.find((candidate) => candidate.id === id)
    if (record?.filePath && fs.existsSync(record.filePath)) void shell.openPath(record.filePath)
  }

  showInFolder(id: string): void {
    const record = this.records.find((candidate) => candidate.id === id)
    if (record?.filePath && fs.existsSync(record.filePath)) shell.showItemInFolder(record.filePath)
  }

  retry(id: string): boolean {
    const record = this.records.find((candidate) => candidate.id === id)
    if (!record) return false
    const session = this.sessions.get(record.isPrivate === true)
    if (!session) return false
    this.remove(id)
    session.downloadURL(record.url)
    return true
  }

  private start(item: DownloadItem, isPrivate: boolean): void {
    const id = `dl_${Date.now()}_${this.counter++}`
    const filename = item.getFilename() || 'download'
    const savePath = uniquePath(this.getDirectory(), filename)
    item.setSavePath(savePath)

    const record: DownloadRecord = {
      id,
      url: item.getURL(),
      filename: path.basename(savePath),
      totalBytes: item.getTotalBytes(),
      receivedBytes: item.getReceivedBytes(),
      state: 'progressing',
      startTime: item.getStartTime() * 1000 || Date.now(),
      mimeType: item.getMimeType(),
      filePath: savePath,
      canResume: item.canResume(),
      isDangerous: isRisky(filename),
      isPrivate,
    }

    this.items.set(id, item)
    this.records.unshift(record)
    if (this.records.length > 200) this.records.length = 200
    this.persist()
    this.emitUpdate(record)

    item.on('updated', (_event, state) => {
      const current = this.records.find((candidate) => candidate.id === id)
      if (!current) return
      current.receivedBytes = item.getReceivedBytes()
      current.totalBytes = item.getTotalBytes()
      current.canResume = item.canResume()
      current.paused = item.isPaused()
      if (state === 'interrupted') current.state = 'interrupted'
      else if (state === 'progressing') current.state = 'progressing'
      this.emitUpdate(current)
    })

    item.once('done', (_event, state) => {
      const current = this.records.find((candidate) => candidate.id === id)
      this.items.delete(id)
      if (!current) return
      current.receivedBytes = item.getReceivedBytes()
      current.totalBytes = item.getTotalBytes() || current.receivedBytes
      current.state = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted'
      current.endTime = Date.now()
      current.paused = false
      current.canResume = state === 'interrupted' && item.canResume()
      this.persist()
      this.emitUpdate(current)
    })
  }

  private emitUpdate(record: DownloadRecord): void {
    this.emit('updated', { ...record })
  }

  private persist(): void {
    this.store.set(
      'downloads',
      this.records.filter((record) => record.isPrivate !== true).slice(0, 200)
    )
  }
}

export const downloadManager = new DownloadManager()
