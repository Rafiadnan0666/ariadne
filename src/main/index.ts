import { app, ipcMain, BrowserWindow, webContents, session, shell, dialog, globalShortcut } from 'electron'
import { init as initTabs, createTab, closeTab, setActiveTab, setUrl, getHistory, addHistory, getTabs, setTabWebContents, setTabTitle, TabState, duplicateTab, pinTab, muteTab, reopenClosedTab, getClosedTabs, setTabZoom, getTabZoom, findInPage, stopFinding, printTab, viewSource, fullscreenTab, reorderTab } from './tabs'
import { aiSystem } from './ai'
import * as path from 'path'
import * as fs from 'fs'
import Store from 'electron-store'

// Disable GPU to avoid cache issues on Windows
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')

let mainWindow: BrowserWindow | null = null

// Initialize stores
const bookmarksStore = new Store({ name: 'bookmarks' }) as any
const downloadsStore = new Store({ name: 'downloads' }) as any
const settingsStore = new Store({ name: 'settings' }) as any

// Initialize default settings
const DEFAULT_SETTINGS = {
  theme: 'dark',
  accentColor: '#4285f4',
  density: 'normal',
  showBookmarksBar: true,
  homePage: 'https://example.com',
  defaultSearchEngine: 'google',
  searchSuggestions: true,
  clearOnExit: false,
  doNotTrack: true,
  blockThirdPartyCookies: false,
  hardwareAcceleration: true,
}

function getSettings(): any {
  const stored = settingsStore.get('settings')
  return { ...DEFAULT_SETTINGS, ...stored }
}

function saveSettings(settings: any): void {
  settingsStore.set('settings', settings)
}

// Bookmarks helpers
function getBookmarks(): any[] {
  return bookmarksStore.get('bookmarks') || []
}

function saveBookmarks(bookmarks: any[]): void {
  bookmarksStore.set('bookmarks', bookmarks)
}

// Downloads helpers
function getDownloads(): any[] {
  return downloadsStore.get('downloads') || []
}

function saveDownloads(downloads: any[]): void {
  downloadsStore.set('downloads', downloads)
}

app.whenReady().then(async () => {
  initTabs()

  // Configure session for webview partition
  const webviewSession = session.fromPartition('persist:ariadne')
  webviewSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(false)
  })

  // Initialize AI system
  await aiSystem.getRegistry().initialize()

  // Core app IPC
  ipcMain.handle('app:ready', async () => {
    return { version: app.getVersion(), platform: process.platform }
  })

  // Settings IPC
  ipcMain.handle('settings:get', async () => {
    return getSettings()
  })

  ipcMain.handle('settings:set', async (_e, settings: any) => {
    saveSettings(settings)
    return getSettings()
  })

  // Tab IPC
  ipcMain.handle('tab:create', async (_e, url?: string) => {
    const id = await createTab(url)
    // Don't register with AI system yet - wait for tab:set-web-contents with real webContentsId
    return id
  })

  ipcMain.handle('tab:close', async (_e, id: string) => {
    aiSystem.unregisterTab(id)
    return closeTab(id)
  })

  ipcMain.handle('tab:set-active', async (_e, id: string) => {
    return setActiveTab(id)
  })

  ipcMain.handle('tab:get-all', async () => {
    return getTabs()
  })

  ipcMain.handle('tab:url', async (_e, id: string, url: string) => {
    aiSystem.unregisterTab(id)
    return setUrl(id, url)
  })

  ipcMain.handle('tab:set-web-contents', async (_e, id: string, webContentsId: number) => {
    setTabWebContents(id, webContentsId)
    const tab = getTabs().find(t => t.id === id)
    if (tab) {
      aiSystem.registerTab(id, webContentsId, tab.url, tab.title, tab.isPrivate || false)
    }
  })

  ipcMain.handle('tab:set-title', async (_e, id: string, title: string) => {
    setTabTitle(id, title)
  })

  ipcMain.handle('tab:back', async () => {
    if (mainWindow) mainWindow.webContents.goBack()
  })

  ipcMain.handle('tab:forward', async () => {
    if (mainWindow) mainWindow.webContents.goForward()
  })

  ipcMain.handle('tab:reload', async () => {
    if (mainWindow) mainWindow.webContents.reload()
  })

  ipcMain.handle('tab:stop', async () => {
    if (mainWindow) mainWindow.webContents.stop()
  })

  ipcMain.handle('tab:duplicate', async (_e, id: string) => {
    const tab = getTabs().find(t => t.id === id)
    if (!tab) return null
    const newId = await createTab(tab.url)
    // Don't register with AI system yet - wait for tab:set-web-contents
    return newId
  })

  ipcMain.handle('tab:pin', async (_e, id: string) => {
    const tab = getTabs().find(t => t.id === id)
    if (tab) {
      mainWindow?.webContents.send('tab-pinned', id, !tab.pinned)
    }
    return true
  })

  ipcMain.handle('tab:mute', async (_e, id: string) => {
    const tab = getTabs().find(t => t.id === id)
    if (tab && tab.webContentsId) {
      const wc = webContents.fromId(tab.webContentsId)
      if (wc) {
        wc.setAudioMuted(!tab.muted)
        mainWindow?.webContents.send('tab-muted', id, !tab.muted)
      }
    }
    return true
  })

  ipcMain.handle('tab:reorder', async (_e, fromIndex: number, toIndex: number) => {
    reorderTab(fromIndex, toIndex)
    return getTabs()
  })

  ipcMain.handle('tab:reopen-closed', async () => {
    return reopenClosedTab()
  })

  ipcMain.handle('tab:get-closed', async () => {
    return getClosedTabs()
  })

  ipcMain.handle('tab:set-zoom', async (_e, id: string, factor: number) => {
    const tab = getTabs().find(t => t.id === id)
    if (tab && tab.webContentsId) {
      const wc = webContents.fromId(tab.webContentsId)
      if (wc) {
        wc.setZoomFactor(factor)
      }
    }
    return true
  })

  ipcMain.handle('tab:get-zoom', async (_e, id: string) => {
    const tab = getTabs().find(t => t.id === id)
    if (tab && tab.webContentsId) {
      const wc = webContents.fromId(tab.webContentsId)
      if (wc) {
        return wc.getZoomFactor()
      }
    }
    return 1.0
  })

  ipcMain.handle('tab:find-in-page', async (_e, id: string, text: string, options?: any) => {
    const tab = getTabs().find(t => t.id === id)
    if (tab && tab.webContentsId) {
      const wc = webContents.fromId(tab.webContentsId)
      if (wc) {
        return wc.findInPage(text, options)
      }
    }
    return { requestId: 0, activeMatchOrdinal: 0, matches: 0, selectionArea: { x: 0, y: 0, width: 0, height: 0 } }
  })

  ipcMain.handle('tab:stop-finding', async (_e, id: string, action: string) => {
    const tab = getTabs().find(t => t.id === id)
    if (tab && tab.webContentsId) {
      const wc = webContents.fromId(tab.webContentsId)
      if (wc) {
        wc.stopFindInPage(action as 'clearSelection' | 'keepSelection' | 'activateSelection')
      }
    }
    return true
  })

  ipcMain.handle('tab:print', async (_e, id: string) => {
    const tab = getTabs().find(t => t.id === id)
    if (tab && tab.webContentsId) {
      const wc = webContents.fromId(tab.webContentsId)
      if (wc) {
        wc.print({ silent: false, printBackground: true })
      }
    }
    return true
  })

  ipcMain.handle('tab:view-source', async (_e, id: string) => {
    const tab = getTabs().find(t => t.id === id)
    if (tab) {
      await createTab(`view-source:${tab.url}`)
    }
    return true
  })

  ipcMain.handle('tab:fullscreen', async (_e, id: string) => {
    if (mainWindow) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen())
    }
    return true
  })

  // History IPC
  ipcMain.handle('history:get', async () => {
    return getHistory()
  })

  ipcMain.handle('history:add', async (_e, url: string, title: string) => {
    return addHistory(url, title)
  })

  ipcMain.handle('history:delete', async (_e, id: number) => {
    const dbPath = path.join(app.getPath('userData'), 'ariadne.db')
    const SQLite = require('sqlite3')
    const db = new SQLite.Database(dbPath)
    return new Promise<void>((resolve, reject) => {
      db.run('DELETE FROM history WHERE id = ?', [id], (err: any) => {
        db.close()
        if (err) reject(err)
        else resolve()
      })
    })
  })

  ipcMain.handle('history:clear', async (_e, options?: { since?: number }) => {
    const dbPath = path.join(app.getPath('userData'), 'ariadne.db')
    const SQLite = require('sqlite3')
    const db = new SQLite.Database(dbPath)
    return new Promise<void>((resolve, reject) => {
      let query = 'DELETE FROM history'
      const params: any[] = []
      if (options?.since) {
        query += ' WHERE visited_at >= ?'
        params.push(options.since)
      }
      db.run(query, params, (err: any) => {
        db.close()
        if (err) reject(err)
        else resolve()
      })
    })
  })

  // Bookmarks IPC
  ipcMain.handle('bookmarks:get', async () => {
    return getBookmarks()
  })

  ipcMain.handle('bookmarks:add', async (_e, bookmark: { title: string; url: string; folderId?: string }) => {
    const bookmarks = getBookmarks()
    const newBookmark = {
      id: `bm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title: bookmark.title,
      url: bookmark.url,
      folderId: bookmark.folderId,
      parentId: bookmark.folderId,
      isFolder: false,
      dateAdded: Date.now(),
      dateModified: Date.now(),
    }
    bookmarks.push(newBookmark)
    saveBookmarks(bookmarks)
    return newBookmark
  })

  ipcMain.handle('bookmarks:add-folder', async (_e, title: string, parentId?: string) => {
    const bookmarks = getBookmarks()
    const newFolder = {
      id: `bm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title,
      url: '',
      folderId: parentId,
      parentId,
      isFolder: true,
      children: [],
      dateAdded: Date.now(),
      dateModified: Date.now(),
    }
    bookmarks.push(newFolder)
    saveBookmarks(bookmarks)
    return newFolder
  })

  ipcMain.handle('bookmarks:update', async (_e, id: string, updates: { title?: string; url?: string }) => {
    const bookmarks = getBookmarks()
    const index = bookmarks.findIndex(b => b.id === id)
    if (index >= 0) {
      bookmarks[index] = { ...bookmarks[index], ...updates, dateModified: Date.now() }
      saveBookmarks(bookmarks)
      return bookmarks[index]
    }
    return null
  })

  ipcMain.handle('bookmarks:delete', async (_e, id: string) => {
    let bookmarks = getBookmarks()
    const deleteRecursive = (id: string) => {
      bookmarks = bookmarks.filter(b => b.id !== id)
      const children = bookmarks.filter(b => b.parentId === id)
      for (const child of children) {
        deleteRecursive(child.id)
      }
    }
    deleteRecursive(id)
    saveBookmarks(bookmarks)
    return true
  })

  ipcMain.handle('bookmarks:move', async (_e, id: string, parentId: string, index?: number) => {
    const bookmarks = getBookmarks()
    const bookmark = bookmarks.find(b => b.id === id)
    if (bookmark) {
      bookmark.parentId = parentId
      bookmark.folderId = parentId
      bookmark.dateModified = Date.now()
      saveBookmarks(bookmarks)
      return bookmark
    }
    return null
  })

  ipcMain.handle('bookmarks:import', async (_e, html: string) => {
    console.log('Import bookmarks - TBD')
    return { imported: 0 }
  })

  ipcMain.handle('bookmarks:export', async () => {
    const bookmarks = getBookmarks()
    let html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n'
    const exportFolder = (parentId: string | undefined, indent: string) => {
      const items = bookmarks.filter(b => b.parentId === parentId)
      for (const item of items) {
        if (item.isFolder) {
          html += `${indent}<DT><H3>${item.title}</H3>\n${indent}<DL><p>\n`
          exportFolder(item.id, indent + '  ')
          html += `${indent}</DL><p>\n`
        } else {
          html += `${indent}<DT><A HREF="${item.url}">${item.title}</A>\n`
        }
      }
    }
    exportFolder(undefined, '  ')
    html += '</DL><p>'
    return html
  })

  // Downloads IPC
  ipcMain.handle('downloads:get', async () => {
    return getDownloads()
  })

  ipcMain.handle('downloads:pause', async (_e, id: string) => {
    return true
  })

  ipcMain.handle('downloads:resume', async (_e, id: string) => {
    return true
  })

  ipcMain.handle('downloads:cancel', async (_e, id: string) => {
    return true
  })

  ipcMain.handle('downloads:remove', async (_e, id: string) => {
    let downloads = getDownloads()
    downloads = downloads.filter(d => d.id !== id)
    saveDownloads(downloads)
    return true
  })

  ipcMain.handle('downloads:open', async (_e, id: string) => {
    const downloads = getDownloads()
    const download = downloads.find(d => d.id === id)
    if (download?.filePath) {
      shell.openPath(download.filePath)
    }
    return true
  })

  ipcMain.handle('downloads:show-in-folder', async (_e, id: string) => {
    const downloads = getDownloads()
    const download = downloads.find(d => d.id === id)
    if (download?.filePath) {
      shell.showItemInFolder(download.filePath)
    }
    return true
  })

  ipcMain.handle('downloads:retry', async (_e, id: string) => {
    return true
  })

  ipcMain.handle('downloads:clear', async () => {
    saveDownloads([])
    return true
  })

  ipcMain.handle('downloads:set-path', async (_e, downloadPath: string) => {
    saveSettings({ ...getSettings(), downloadPath })
    return true
  })

  ipcMain.handle('downloads:get-path', async () => {
    const settings = getSettings()
    return settings.downloadPath || app.getPath('downloads')
  })

  // Permissions IPC
  ipcMain.handle('permission:request', async (_e, tabId: string, permission: string) => {
    return 'ask'
  })

  ipcMain.handle('permission:get', async (_e, origin: string) => {
    return { origin, permission: 'ask' }
  })

  ipcMain.handle('permission:set', async (_e, origin: string, permission: string, setting: 'grant' | 'deny' | 'ask') => {
    return true
  })

  ipcMain.handle('permission:clear', async (_e, origin?: string) => {
    return true
  })

  // Window IPC
  ipcMain.handle('window:create', async (_e, options?: { private?: boolean; url?: string }) => {
    const win = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        preload: path.join(__dirname, '../preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
        partition: options?.private ? `ariadne-private-${Date.now()}` : 'persist:ariadne',
      }
    })
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
    if (options?.url) {
      win.webContents.loadURL(options.url)
    }
    return true
  })

  ipcMain.handle('window:close', async () => {
    if (mainWindow) mainWindow.close()
    return true
  })

  ipcMain.handle('window:minimize', async () => {
    if (mainWindow) mainWindow.minimize()
    return true
  })

  ipcMain.handle('window:maximize', async () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize()
      else mainWindow.maximize()
    }
    return true
  })

  ipcMain.handle('window:is-maximized', async () => {
    return mainWindow?.isMaximized() || false
  })

  // AI System IPC
  ipcMain.handle('ai:config:get', async () => {
    return aiSystem.getConfig()
  })

  ipcMain.handle('ai:config:update', async (_e, updates) => {
    await aiSystem.updateConfig(updates)
  })

  ipcMain.handle('ai:provider:add', async (_e, config, apiKey) => {
    await aiSystem.addProvider(config, apiKey)
  })

  ipcMain.handle('ai:provider:remove', async (_e, id) => {
    await aiSystem.removeProvider(id)
  })

  ipcMain.handle('ai:provider:test', async (_e, id, apiKey) => {
    return aiSystem.testProvider(id, apiKey)
  })

  ipcMain.handle('ai:provider:set-key', async (_e, providerId, keyName, apiKey) => {
    await aiSystem.setApiKey(providerId, keyName, apiKey)
  })

  ipcMain.handle('ai:provider:get-masked-key', async (_e, providerId, keyName) => {
    return aiSystem.getMaskedApiKey(providerId, keyName)
  })

  ipcMain.handle('ai:providers:list', async () => {
    return aiSystem.getRegistry().getAllConfigs()
  })

  ipcMain.handle('ai:models:list', async () => {
    return aiSystem.getAllModels()
  })

  ipcMain.handle('ai:models:for-provider', async (_e, providerId) => {
    return aiSystem.getRegistry().getModelsForProvider(providerId)
  })

  ipcMain.handle('ai:model-slot:set', async (_e, slot, modelId) => {
    aiSystem.setModelSlot(slot, modelId)
  })

  ipcMain.handle('ai:model-slot:get', async (_e, slot) => {
    return aiSystem.getModelSlot(slot)
  })

  ipcMain.handle('ai:model-slot:get-all', async () => {
    return aiSystem.getRegistry().getAllModelSlots()
  })

  ipcMain.handle('ai:chat:complete', async (_e, request) => {
    return aiSystem.getRegistry().chatCompletion(request)
  })

  ipcMain.handle('ai:system-prompt:get', async () => {
    return aiSystem.getSystemPrompt()
  })

  ipcMain.handle('ai:system-prompt:set', async (_e, prompt) => {
    aiSystem.setSystemPrompt(prompt)
  })

  ipcMain.handle('ai:provider-types', async () => {
    return aiSystem.getProviderTypes()
  })

  // Page Extraction IPC
  ipcMain.handle('ai:extract-page', async (_e, tabId: string) => {
    return aiSystem.extractPage(tabId)
  })

  ipcMain.handle('ai:get-tabs-context', async (_e, tabIds: string[]) => {
    return aiSystem.getTabsContext(tabIds)
  })

  // Context Retrieval IPC
  ipcMain.handle('ai:context:retrieve', async (_e, query: string, tabIds?: string[]) => {
    return aiSystem.getContextForQuery(query, tabIds)
  })

  ipcMain.handle('ai:context:format', async (_e, query: string, tabIds?: string[]) => {
    return aiSystem.formatContextForLLM(query, tabIds)
  })

  ipcMain.handle('ai:context:ingest', async (_e, tabId: string) => {
    await aiSystem.ingestTab(tabId)
  })

  // Streaming chat
  ipcMain.handle('ai:chat:stream', async (_e, request) => {
    const { ProviderRegistry } = await import('./ai/registry')
    const registry = aiSystem.getRegistry()
    
    return new Promise<{ id: string; model: string; choices: any[]; usage?: any }>((resolve, reject) => {
      const chunks: any[] = []
      let accumulatedUsage: any = undefined
      let finishReason = 'stop'
      
      registry.chatCompletionStream(request, (chunk: any) => {
        if (chunk.usage) accumulatedUsage = chunk.usage
        if (chunk.choices[0]?.finishReason) finishReason = chunk.choices[0].finishReason
        chunks.push(chunk)
        
        if (mainWindow) {
          mainWindow.webContents.send('ai:stream-chunk', chunk)
        }
      }).then(() => {
        resolve({
          id: `stream-${Date.now()}`,
          model: request.model,
          choices: [{ index: 0, message: { role: 'assistant', content: '' }, finishReason }],
          usage: accumulatedUsage,
        })
      }).catch(reject)
    })
  })

  // Security
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https:') || url.startsWith('http:') || url.startsWith('file:') || url.startsWith('about:')) {
        return { action: 'allow' }
      }
      return { action: 'deny' }
    })
  })

  // Permission handler
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const origin = webContents.getURL()
    if (mainWindow) {
      mainWindow.webContents.send('permission-request', { origin, permission })
      callback(false)
    } else {
      callback(false)
    }
  })

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })

  console.log('Loading file:', path.join(__dirname, '../renderer/index.html'))
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  mainWindow.webContents.openDevTools({ mode: 'detach' })

  // Register global shortcuts
  registerGlobalShortcuts()

  // WebContents event tracking
  mainWindow.webContents.on('did-navigate', (_event, url) => {
    const activeTab = getTabs().find(t => t.active)
    if (activeTab && activeTab.webContentsId) {
      aiSystem.registerTab(activeTab.id, activeTab.webContentsId, url, activeTab.title || 'Untitled', activeTab.isPrivate || false)
    }
  })

  mainWindow!.webContents.on('page-title-updated', (_event, title) => {
    const activeTab = getTabs().find(t => t.active)
    if (activeTab && activeTab.webContentsId) {
      setTabTitle(activeTab.id, title)
      aiSystem.registerTab(activeTab.id, activeTab.webContentsId, activeTab.url, title, activeTab.isPrivate || false)
      mainWindow!.webContents.send('url-changed', activeTab.id, activeTab.url, title)
    }
  })

  mainWindow!.webContents.on('did-finish-load', () => {
    const activeTab = getTabs().find(t => t.active)
    if (activeTab && activeTab.webContentsId) {
      aiSystem.registerTab(activeTab.id, activeTab.webContentsId, activeTab.url, activeTab.title || 'Untitled', activeTab.isPrivate || false)
    }
  })

  mainWindow!.on('closed', () => {
    mainWindow = null
  })
})

function registerGlobalShortcuts() {
  const shortcuts = [
    { accelerator: 'Ctrl+T', callback: () => mainWindow?.webContents.send('shortcut', 'new-tab') },
    { accelerator: 'Ctrl+W', callback: () => mainWindow?.webContents.send('shortcut', 'close-tab') },
    { accelerator: 'Ctrl+Shift+T', callback: () => mainWindow?.webContents.send('shortcut', 'reopen-closed-tab') },
    { accelerator: 'Ctrl+Tab', callback: () => mainWindow?.webContents.send('shortcut', 'next-tab') },
    { accelerator: 'Ctrl+Shift+Tab', callback: () => mainWindow?.webContents.send('shortcut', 'prev-tab') },
    { accelerator: 'Ctrl+L', callback: () => mainWindow?.webContents.send('shortcut', 'focus-address') },
    { accelerator: 'F6', callback: () => mainWindow?.webContents.send('shortcut', 'focus-address') },
    { accelerator: 'Ctrl+F', callback: () => mainWindow?.webContents.send('shortcut', 'find-in-page') },
    { accelerator: 'F3', callback: () => mainWindow?.webContents.send('shortcut', 'find-next') },
    { accelerator: 'Ctrl+G', callback: () => mainWindow?.webContents.send('shortcut', 'find-next') },
    { accelerator: 'Shift+F3', callback: () => mainWindow?.webContents.send('shortcut', 'find-prev') },
    { accelerator: 'Ctrl+Shift+G', callback: () => mainWindow?.webContents.send('shortcut', 'find-prev') },
    { accelerator: 'F5', callback: () => mainWindow?.webContents.send('shortcut', 'reload') },
    { accelerator: 'Ctrl+R', callback: () => mainWindow?.webContents.send('shortcut', 'reload') },
    { accelerator: 'Ctrl+Shift+R', callback: () => mainWindow?.webContents.send('shortcut', 'force-reload') },
    { accelerator: 'Escape', callback: () => mainWindow?.webContents.send('shortcut', 'stop') },
    { accelerator: 'Alt+Left', callback: () => mainWindow?.webContents.send('shortcut', 'back') },
    { accelerator: 'Alt+Right', callback: () => mainWindow?.webContents.send('shortcut', 'forward') },
    { accelerator: 'Alt+Home', callback: () => mainWindow?.webContents.send('shortcut', 'home') },
    { accelerator: 'Ctrl+J', callback: () => mainWindow?.webContents.send('shortcut', 'open-downloads') },
    { accelerator: 'Ctrl+H', callback: () => mainWindow?.webContents.send('shortcut', 'open-history') },
    { accelerator: 'Ctrl+Shift+B', callback: () => mainWindow?.webContents.send('shortcut', 'toggle-bookmarks') },
    { accelerator: 'Ctrl+Shift+A', callback: () => mainWindow?.webContents.send('shortcut', 'toggle-ai') },
    { accelerator: 'F12', callback: () => mainWindow?.webContents.send('shortcut', 'devtools') },
    { accelerator: 'Ctrl+Shift+I', callback: () => mainWindow?.webContents.send('shortcut', 'devtools') },
    { accelerator: 'Ctrl+=', callback: () => mainWindow?.webContents.send('shortcut', 'zoom-in') },
    { accelerator: 'Ctrl+-', callback: () => mainWindow?.webContents.send('shortcut', 'zoom-out') },
    { accelerator: 'Ctrl+0', callback: () => mainWindow?.webContents.send('shortcut', 'zoom-reset') },
    { accelerator: 'F11', callback: () => mainWindow?.webContents.send('shortcut', 'fullscreen') },
    { accelerator: 'Ctrl+P', callback: () => mainWindow?.webContents.send('shortcut', 'print') },
    { accelerator: 'Ctrl+U', callback: () => mainWindow?.webContents.send('shortcut', 'view-source') },
    { accelerator: 'Ctrl+N', callback: () => mainWindow?.webContents.send('shortcut', 'new-window') },
    { accelerator: 'Ctrl+Shift+N', callback: () => mainWindow?.webContents.send('shortcut', 'new-private-window') },
  ]

  for (const shortcut of shortcuts) {
    globalShortcut.register(shortcut.accelerator, shortcut.callback)
  }
}

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const win = new BrowserWindow({
      width: 1400,
      height: 900,
      webPreferences: {
        preload: path.join(__dirname, '../preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true
      }
    })
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
})

app.on('before-quit', async () => {
  globalShortcut.unregisterAll()
  await aiSystem.shutdown()
})