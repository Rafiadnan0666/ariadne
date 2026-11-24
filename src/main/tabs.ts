import * as path from 'path'
import { app, BrowserWindow, webContents } from 'electron'
import * as SQLite from 'sqlite3'

export interface TabState {
  id: string
  url: string
  title: string
  active: boolean
  webContentsId?: number
  isPrivate?: boolean
  pinned?: boolean
  muted?: boolean
  loading?: boolean
  favicon?: string
  zoomFactor?: number
}

const dbPath = path.join(app.getPath('userData'), 'ariadne.db')
const tabs = new Map<string, TabState>()
const closedTabs: TabState[] = []
const MAX_CLOSED_TABS = 10
let nextTabId = 1

export function init() {
  const db = new SQLite.Database(dbPath)
  db.run(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      title TEXT,
      visited_at INTEGER NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS closed_tabs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tab_id TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      closed_at INTEGER NOT NULL
    )
  `)
}

export function getTabs(): TabState[] {
  return Array.from(tabs.values())
}

export function getTabById(id: string): TabState | undefined {
  return tabs.get(id)
}

export async function createTab(url?: string, webContentsId?: number, isPrivate?: boolean): Promise<string> {
  const id = String(nextTabId++)
  const tab: TabState = {
    id,
    url: url || 'about:blank',
    title: 'New Tab',
    active: true,
    webContentsId,
    isPrivate,
    pinned: false,
    muted: false,
    loading: false,
    zoomFactor: 1.0,
  }
  // Deactivate other tabs
  for (const t of tabs.values()) {
    t.active = false
  }
  tabs.set(id, tab)
  return id
}

export async function closeTab(id: string): Promise<void> {
  const tab = tabs.get(id)
  if (tab) {
    // Save to closed tabs
    if (!tab.isPrivate) {
      const db = new SQLite.Database(dbPath)
      db.run('INSERT INTO closed_tabs (tab_id, url, title, closed_at) VALUES (?, ?, ?, ?)', [
        id,
        tab.url,
        tab.title,
        Date.now()
      ])
      db.close()
      
      closedTabs.unshift({ ...tab })
      if (closedTabs.length > MAX_CLOSED_TABS) {
        closedTabs.pop()
      }
    }
    tabs.delete(id)
    
    // Activate another tab
    const remaining = Array.from(tabs.values())
    if (remaining.length > 0) {
      remaining[0].active = true
    }
  }
}

export async function setActiveTab(id: string): Promise<void> {
  const tab = tabs.get(id)
  if (tab) tab.active = true
  for (const t of tabs.values()) {
    if (t.id !== id) t.active = false
  }
}

export async function setUrl(id: string, url: string): Promise<void> {
  const tab = tabs.get(id)
  if (tab) {
    tab.url = url
    // Add to history
    const db = new SQLite.Database(dbPath)
    db.run('INSERT INTO history (url, title, visited_at) VALUES (?, ?, ?)', [
      url,
      tab.title || 'Untitled',
      Date.now()
    ])
    db.close()
  }
}

export function setTabWebContents(id: string, webContentsId: number): void {
  const tab = tabs.get(id)
  if (tab) {
    tab.webContentsId = webContentsId
  }
}

export function setTabTitle(id: string, title: string): void {
  const tab = tabs.get(id)
  if (tab) {
    tab.title = title
  }
}

export function getHistory() {
  return new Promise<any[]>((resolve, reject) => {
    const db = new SQLite.Database(dbPath)
    db.all('SELECT * FROM history ORDER BY visited_at DESC LIMIT 1000', (err, rows) => {
      db.close()
      if (err) reject(err)
      else resolve(rows)
    })
  })
}

export function addHistory(url: string, title: string) {
  return new Promise<void>((resolve, reject) => {
    const db = new SQLite.Database(dbPath)
    db.run('INSERT INTO history (url, title, visited_at) VALUES (?, ?, ?)',
      [url, title, Date.now()], (err) => {
        db.close()
        if (err) reject(err)
        else resolve()
      })
  })
}

export async function duplicateTab(id: string): Promise<string | null> {
  const tab = tabs.get(id)
  if (!tab) return null
  const newId = await createTab(tab.url)
  const newTab = tabs.get(newId)
  if (newTab) {
    newTab.title = tab.title
    newTab.isPrivate = tab.isPrivate
  }
  return newId
}

export async function pinTab(id: string): Promise<void> {
  const tab = tabs.get(id)
  if (tab) {
    tab.pinned = !tab.pinned
  }
}

export async function muteTab(id: string): Promise<void> {
  const tab = tabs.get(id)
  if (tab) {
    tab.muted = !tab.muted
  }
}

export async function reopenClosedTab(): Promise<string | null> {
  if (closedTabs.length === 0) return null
  const closedTab = closedTabs.shift()!
  const newId = await createTab(closedTab.url, undefined, closedTab.isPrivate)
  const newTab = tabs.get(newId)
  if (newTab) {
    newTab.title = closedTab.title
    newTab.isPrivate = closedTab.isPrivate
  }
  // Remove from database
  const db = new SQLite.Database(dbPath)
  db.run('DELETE FROM closed_tabs WHERE tab_id = ?', [closedTab.id])
  db.close()
  return newId
}

export function getClosedTabs(): TabState[] {
  return [...closedTabs]
}

export function setTabZoom(id: string, factor: number): void {
  const tab = tabs.get(id)
  if (tab) {
    tab.zoomFactor = factor
  }
}

export function getTabZoom(id: string): number {
  const tab = tabs.get(id)
  return tab?.zoomFactor || 1.0
}

export function findInPage(id: string, text: string, options?: { forward?: boolean; matchCase?: boolean }): Promise<any> {
  const tab = tabs.get(id)
  if (tab && tab.webContentsId) {
    const wc = webContents.fromId(tab.webContentsId)
    if (wc) {
      return Promise.resolve(wc.findInPage(text, options))
    }
  }
  return Promise.resolve({ requestId: 0, activeMatchOrdinal: 0, matches: 0, selectionArea: { x: 0, y: 0, width: 0, height: 0 } })
}

export function stopFinding(id: string, action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void {
  const tab = tabs.get(id)
  if (tab && tab.webContentsId) {
    const wc = webContents.fromId(tab.webContentsId)
    if (wc) {
      wc.stopFindInPage(action)
    }
  }
}

export function printTab(id: string): void {
  const tab = tabs.get(id)
  if (tab && tab.webContentsId) {
    const wc = webContents.fromId(tab.webContentsId)
    if (wc) {
      wc.print({ silent: false, printBackground: true })
    }
  }
}

export function viewSource(id: string): void {
  const tab = tabs.get(id)
  if (tab) {
    createTab(`view-source:${tab.url}`)
  }
}

export function fullscreenTab(id: string): void {
  // This is handled at window level
}

export function reorderTab(fromIndex: number, toIndex: number): void {
  const tabArray = Array.from(tabs.values())
  const [removed] = tabArray.splice(fromIndex, 1)
  tabArray.splice(toIndex, 0, removed)
  tabs.clear()
  tabArray.forEach((tab, index) => {
    tabs.set(tab.id, tab)
  })
}