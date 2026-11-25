import * as path from 'path'
import { app, webContents } from 'electron'
import * as SQLite from 'sqlite3'

/**
 * Tab state is owned by the main process and scoped to the BrowserWindow that
 * created it. Keeping tabs per-window is what makes private windows actually
 * private: a private window never sees the normal window's tab list.
 */
export interface TabState {
  id: string
  url: string
  title: string
  active: boolean
  windowId?: number
  webContentsId?: number
  isPrivate?: boolean
  pinned?: boolean
  muted?: boolean
  loading?: boolean
  favicon?: string
  zoomFactor?: number
  canGoBack?: boolean
  canGoForward?: boolean
  crashed?: boolean
  audioPlaying?: boolean
  /** Stable ordering inside a window; survives drag reorder. */
  order: number
}

interface ClosedTabRecord {
  dbId?: number
  tabId: string
  url: string
  title: string
  isPrivate?: boolean
  closedAt: number
}

const MAX_CLOSED_TABS = 25

let db: SQLite.Database | null = null
let nextTabId = 1
let nextOrder = 1
const tabs = new Map<string, TabState>()
const closedTabs: ClosedTabRecord[] = []

function getDb(): SQLite.Database {
  if (!db) throw new Error('Tab database is not initialised')
  return db
}

function run(sql: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, (error) => (error ? reject(error) : resolve()))
  })
}

function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows as T[])))
  })
}

export async function init(): Promise<void> {
  const dbPath = path.join(app.getPath('userData'), 'ariadne.db')
  db = await new Promise<SQLite.Database>((resolve, reject) => {
    const handle = new SQLite.Database(dbPath, (error) => (error ? reject(error) : resolve(handle)))
  })

  await run(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      title TEXT,
      visited_at INTEGER NOT NULL
    )
  `)
  await run('CREATE INDEX IF NOT EXISTS idx_history_visited_at ON history (visited_at DESC)')
  await run(`
    CREATE TABLE IF NOT EXISTS closed_tabs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tab_id TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      closed_at INTEGER NOT NULL
    )
  `)

  const persisted = await all<{ id: number; tab_id: string; url: string; title: string; closed_at: number }>(
    'SELECT id, tab_id, url, title, closed_at FROM closed_tabs ORDER BY closed_at DESC LIMIT ?',
    [MAX_CLOSED_TABS]
  )
  for (const row of persisted) {
    closedTabs.push({
      dbId: row.id,
      tabId: row.tab_id,
      url: row.url,
      title: row.title || 'New Tab',
      closedAt: row.closed_at,
    })
  }
}

export async function closeDatabase(): Promise<void> {
  if (!db) return
  const handle = db
  db = null
  await new Promise<void>((resolve) => handle.close(() => resolve()))
}

export function getTabs(windowId?: number): TabState[] {
  const list = Array.from(tabs.values())
  return (windowId === undefined ? list : list.filter((tab) => tab.windowId === windowId)).sort(
    (a, b) => a.order - b.order
  )
}

export function getTabById(id: string): TabState | undefined {
  return tabs.get(id)
}

export function getTabByWebContentsId(webContentsId: number): TabState | undefined {
  for (const tab of tabs.values()) {
    if (tab.webContentsId === webContentsId) return tab
  }
  return undefined
}

export interface CreateTabOptions {
  webContentsId?: number
  isPrivate?: boolean
  windowId?: number
  pinned?: boolean
  active?: boolean
  order?: number
}

export async function createTab(url?: string, options: CreateTabOptions = {}): Promise<string> {
  const id = String(nextTabId++)
  const shouldActivate = options.active !== false
  if (shouldActivate && options.windowId !== undefined) {
    for (const tab of tabs.values()) {
      if (tab.windowId === options.windowId) tab.active = false
    }
  }
  const tab: TabState = {
    id,
    url: url || 'about:blank',
    title: 'New Tab',
    active: shouldActivate,
    windowId: options.windowId,
    webContentsId: options.webContentsId,
    isPrivate: options.isPrivate === true,
    pinned: options.pinned === true,
    muted: false,
    loading: false,
    zoomFactor: 1,
    canGoBack: false,
    canGoForward: false,
    order: options.order ?? nextOrder++,
  }
  tabs.set(id, tab)
  return id
}

export async function closeTab(id: string, windowId?: number): Promise<string | null> {
  const tab = tabs.get(id)
  if (!tab || (windowId !== undefined && tab.windowId !== windowId)) return null

  const siblings = getTabs(tab.windowId)
  const index = siblings.findIndex((candidate) => candidate.id === id)

  if (!tab.isPrivate) {
    try {
      await run('INSERT INTO closed_tabs (tab_id, url, title, closed_at) VALUES (?, ?, ?, ?)', [
        tab.id,
        tab.url,
        tab.title,
        Date.now(),
      ])
    } catch (error) {
      console.error('Failed to persist closed tab:', error)
    }
  }
  closedTabs.unshift({
    tabId: tab.id,
    url: tab.url,
    title: tab.title,
    isPrivate: tab.isPrivate,
    closedAt: Date.now(),
  })
  while (closedTabs.length > MAX_CLOSED_TABS) {
    const removed = closedTabs.pop()
    if (removed?.dbId) void run('DELETE FROM closed_tabs WHERE id = ?', [removed.dbId]).catch(() => undefined)
  }

  tabs.delete(id)
  const remaining = siblings.filter((candidate) => candidate.id !== id)
  if (remaining.length > 0) {
    const nextActive = remaining[Math.max(0, index - 1)] || remaining[0]
    for (const candidate of remaining) candidate.active = candidate.id === nextActive.id
    return nextActive.id
  }
  return null
}

export async function setActiveTab(id: string, windowId?: number): Promise<boolean> {
  const tab = tabs.get(id)
  if (!tab || (windowId !== undefined && tab.windowId !== windowId)) return false
  for (const candidate of tabs.values()) {
    if (candidate.windowId === tab.windowId) candidate.active = candidate.id === id
  }
  return true
}

export function setUrl(id: string, url: string): void {
  const tab = tabs.get(id)
  if (tab) tab.url = url
}

export function updateTab(id: string, patch: Partial<TabState>): TabState | undefined {
  const tab = tabs.get(id)
  if (!tab) return undefined
  Object.assign(tab, patch)
  return tab
}

export function setTabWebContents(id: string, webContentsId: number): void {
  const tab = tabs.get(id)
  if (tab) tab.webContentsId = webContentsId
}

export function setTabTitle(id: string, title: string): void {
  const tab = tabs.get(id)
  if (tab) tab.title = title || 'Untitled'
}

export function setTabFavicon(id: string, favicon?: string): void {
  const tab = tabs.get(id)
  if (tab) tab.favicon = favicon
}

export function setTabLoading(id: string, loading: boolean): void {
  const tab = tabs.get(id)
  if (tab) tab.loading = loading
}

export function setTabNavState(id: string, canGoBack: boolean, canGoForward: boolean): void {
  const tab = tabs.get(id)
  if (tab) {
    tab.canGoBack = canGoBack
    tab.canGoForward = canGoForward
  }
}

export function isPrivateTab(id: string): boolean {
  return tabs.get(id)?.isPrivate === true
}

export async function addHistory(url: string, title: string): Promise<void> {
  let protocol = ''
  try {
    protocol = new URL(url).protocol
  } catch {
    return
  }
  if (protocol !== 'http:' && protocol !== 'https:') return
  await run('INSERT INTO history (url, title, visited_at) VALUES (?, ?, ?)', [url, title || url, Date.now()])
}

export interface HistoryEntry {
  id: number
  url: string
  title: string
  visitedAt: number
}

export async function getHistory(limit = 1000): Promise<HistoryEntry[]> {
  const rows = await all<{ id: number; url: string; title: string; visited_at: number }>(
    'SELECT id, url, title, visited_at FROM history ORDER BY visited_at DESC LIMIT ?',
    [limit]
  )
  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    title: row.title || row.url,
    visitedAt: row.visited_at,
  }))
}

export async function deleteHistoryEntry(id: number): Promise<void> {
  await run('DELETE FROM history WHERE id = ?', [id])
}

export async function clearHistory(since?: number): Promise<void> {
  if (since) await run('DELETE FROM history WHERE visited_at >= ?', [since])
  else await run('DELETE FROM history')
}

export async function duplicateTab(id: string): Promise<string | null> {
  const tab = tabs.get(id)
  if (!tab) return null
  const newId = await createTab(tab.url, {
    isPrivate: tab.isPrivate,
    windowId: tab.windowId,
    pinned: tab.pinned,
  })
  const newTab = tabs.get(newId)
  if (newTab) {
    newTab.title = tab.title
    newTab.favicon = tab.favicon
  }
  return newId
}

export function pinTab(id: string): boolean {
  const tab = tabs.get(id)
  if (!tab) return false
  tab.pinned = !tab.pinned
  return tab.pinned
}

export function muteTab(id: string): boolean {
  const tab = tabs.get(id)
  if (!tab) return false
  tab.muted = !tab.muted
  return tab.muted
}

export async function reopenClosedTab(windowId?: number): Promise<string | null> {
  const closed = closedTabs.shift()
  if (!closed) return null
  if (closed.dbId) {
    void run('DELETE FROM closed_tabs WHERE id = ?', [closed.dbId]).catch(() => undefined)
  }
  const newId = await createTab(closed.url, { isPrivate: closed.isPrivate, windowId })
  const newTab = tabs.get(newId)
  if (newTab) newTab.title = closed.title
  return newId
}

export function getClosedTabs(): Array<{ id: string; url: string; title: string }> {
  return closedTabs.map((tab) => ({ id: tab.tabId, url: tab.url, title: tab.title }))
}

export function setTabZoom(id: string, factor: number): void {
  const tab = tabs.get(id)
  if (tab) tab.zoomFactor = Math.min(3, Math.max(0.3, factor))
}

export function getTabZoom(id: string): number {
  return tabs.get(id)?.zoomFactor ?? 1
}

export function findInPage(
  id: string,
  text: string,
  options?: { forward?: boolean; findNext?: boolean }
): Promise<Electron.FoundInPageResult | null> {
  const tab = tabs.get(id)
  if (!tab?.webContentsId) return Promise.resolve(null)
  const contents = webContents.fromId(tab.webContentsId)
  if (!contents || contents.isDestroyed()) return Promise.resolve(null)
  return new Promise((resolve) => {
    const requestId = contents.findInPage(text, options)
    const handler = (_event: Electron.Event, result: Electron.FoundInPageResult): void => {
      if (result.requestId !== requestId) return
      contents.removeListener('found-in-page', handler)
      clearTimeout(timeout)
      resolve(result)
    }
    const timeout = setTimeout(() => {
      contents.removeListener('found-in-page', handler)
      resolve(null)
    }, 1500)
    contents.on('found-in-page', handler)
  })
}

export function stopFinding(id: string, action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void {
  const tab = tabs.get(id)
  if (!tab?.webContentsId) return
  const contents = webContents.fromId(tab.webContentsId)
  if (contents && !contents.isDestroyed()) contents.stopFindInPage(action)
}

export function printTab(id: string): void {
  const tab = tabs.get(id)
  if (!tab?.webContentsId) return
  const contents = webContents.fromId(tab.webContentsId)
  if (contents && !contents.isDestroyed()) contents.print({ silent: false, printBackground: true })
}

export function reorderTab(fromIndex: number, toIndex: number, windowId?: number): TabState[] {
  const list = getTabs(windowId)
  if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length) {
    return list
  }
  const [moved] = list.splice(fromIndex, 1)
  list.splice(toIndex, 0, moved)
  const base = Math.min(...list.map((tab) => tab.order))
  list.forEach((tab, index) => {
    tab.order = base + index
  })
  return getTabs(windowId)
}

/** Remove every tab belonging to a closing window. */
export function closeTabsForWindow(windowId: number): string[] {
  const removed: string[] = []
  for (const tab of Array.from(tabs.values())) {
    if (tab.windowId !== windowId) continue
    tabs.delete(tab.id)
    removed.push(tab.id)
  }
  return removed
}
