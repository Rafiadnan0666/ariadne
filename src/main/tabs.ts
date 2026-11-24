import * as path from 'path'
import { app, BrowserWindow } from 'electron'
import * as SQLite from 'sqlite3'

export interface TabState {
  id: string
  url: string
  title: string
  active: boolean
}

const dbPath = path.join(app.getPath('userData'), 'ariadne.db')
const tabs = new Map<string, TabState>()
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
}

export function getTabs(): TabState[] {
  return Array.from(tabs.values())
}

export function getTabById(id: string): TabState | undefined {
  return tabs.get(id)
}

export async function createTab(url?: string): Promise<string> {
  const id = String(nextTabId++)
  const tab: TabState = {
    id,
    url: url || 'about:blank',
    title: 'New Tab',
    active: true
  }
  tabs.set(id, tab)
  return id
}

export async function closeTab(id: string): Promise<void> {
  tabs.delete(id)
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

export function getHistory() {
  return new Promise<any[]>((resolve, reject) => {
    const db = new SQLite.Database(dbPath)
    db.all('SELECT * FROM history ORDER BY visited_at DESC LIMIT 50', (err, rows) => {
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
