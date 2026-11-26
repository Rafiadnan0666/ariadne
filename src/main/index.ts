import './profile'
import {
  app,
  BrowserWindow,
  ipcMain,
  IpcMainInvokeEvent,
  session,
  Session,
  shell,
  webContents,
} from 'electron'
import * as path from 'path'
import Store from 'electron-store'
import { randomUUID } from 'crypto'
import {
  init as initTabs,
  closeDatabase,
  createTab,
  closeTab,
  setActiveTab,
  setUrl,
  addHistory,
  getHistory,
  deleteHistoryEntry,
  clearHistory,
  getTabs,
  getTabById,
  setTabWebContents,
  setTabTitle,
  setTabFavicon,
  setTabLoading,
  setTabNavState,
  updateTab,
  duplicateTab,
  pinTab,
  muteTab,
  reopenClosedTab,
  getClosedTabs,
  setTabZoom,
  findInPage,
  stopFinding,
  printTab,
  reorderTab,
  closeTabsForWindow,
  type TabState,
} from './tabs'
import { aiSystem } from './ai'
import { registerAgentToolHandlers } from './ai/agent-tools'
import { storeCredential } from './ai/credentials'
import { contextService } from './context/service'
import { downloadManager, type DownloadRecord } from './downloads'
import {
  initPermissions,
  configureSessionPermissions,
  respondToPermission,
  clearPermissionDecisions,
  denyPendingForWindow,
  getPermissionDecisions,
} from './permissions'
import { installApplicationMenu, type ShortcutAction } from './menu'
import { SEARCH_ENGINES } from '../shared/search-engines'

interface AppSettings {
  theme: 'dark' | 'light' | 'system'
  accentColor: string
  density: 'compact' | 'normal' | 'comfortable'
  showBookmarksBar: boolean
  homePage: string
  defaultSearchEngine: string
  searchSuggestions: boolean
  doNotTrack: boolean
  clearOnExit: boolean
  dnsOverHttps: boolean
  downloadPath: string
  aiSidebarOpen: boolean
}

interface WindowState {
  id: number
  window: BrowserWindow
  isPrivate: boolean
  partition: string
}

const settingsStore = new Store({ name: 'settings' }) as unknown as {
  get(key: string): unknown
  set(key: string, value: unknown): void
}
const bookmarksStore = new Store({ name: 'bookmarks' }) as unknown as {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  accentColor: '#7aa2f7',
  density: 'normal',
  showBookmarksBar: true,
  homePage: 'about:blank',
  defaultSearchEngine: 'google',
  searchSuggestions: true,
  doNotTrack: true,
  clearOnExit: false,
  dnsOverHttps: true,
  downloadPath: '',
  aiSidebarOpen: false,
}

const windows = new Map<number, WindowState>()
const configuredSessions = new Set<string>()
const tabContents = new Map<number, string>()
const privatePartitions = new Set<string>()
let quitting = false

// Memory budget & tab discarding
interface MemoryBudgetConfig {
  enabled: boolean
  maxMemoryMB: number
  checkIntervalMs: number
  discardThreshold: number // 0-1, fraction of budget before discarding
  minActiveTabs: number // never discard if active tabs <= this
}

const DEFAULT_MEMORY_BUDGET: MemoryBudgetConfig = {
  enabled: true,
  maxMemoryMB: 1500, // 1.5GB budget
  checkIntervalMs: 30_000,
  discardThreshold: 0.8,
  minActiveTabs: 2,
}

let memoryBudgetConfig: MemoryBudgetConfig = { ...DEFAULT_MEMORY_BUDGET }
let memoryCheckTimer: NodeJS.Timeout | null = null
const discardedTabs = new Map<string, { url: string; title: string; windowId: number; order: number }>()

function getMemoryBudgetConfig(): MemoryBudgetConfig {
  return memoryBudgetConfig
}

function setMemoryBudgetConfig(patch: Partial<MemoryBudgetConfig>): MemoryBudgetConfig {
  memoryBudgetConfig = { ...memoryBudgetConfig, ...patch }
  restartMemoryMonitor()
  return memoryBudgetConfig
}

function restartMemoryMonitor(): void {
  if (memoryCheckTimer) {
    clearInterval(memoryCheckTimer)
    memoryCheckTimer = null
  }
  if (!memoryBudgetConfig.enabled) return
  memoryCheckTimer = setInterval(checkMemoryAndDiscard, memoryBudgetConfig.checkIntervalMs)
  memoryCheckTimer.unref()
}

async function checkMemoryAndDiscard(): Promise<void> {
  if (!memoryBudgetConfig.enabled) return

  const usage = process.memoryUsage()
  const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024)
  const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024)
  const externalMB = Math.round(usage.external / 1024 / 1024)
  const totalMB = heapUsedMB + externalMB

  if (totalMB >= memoryBudgetConfig.maxMemoryMB * memoryBudgetConfig.discardThreshold) {
    await discardInactiveTabs()
  }

  // Broadcast memory stats to renderer for dev tools / debugging
  broadcast('memory-stats', {
    heapUsedMB,
    heapTotalMB,
    externalMB,
    totalMB,
    budgetMB: memoryBudgetConfig.maxMemoryMB,
    threshold: memoryBudgetConfig.discardThreshold,
  })
}

async function discardInactiveTabs(): Promise<void> {
  // Get all tabs across all windows, sort by last active time (approximate via order)
  const allTabs: Array<{ tab: TabState; windowState: WindowState }> = []
  for (const windowState of windows.values()) {
    const tabsList = getTabs(windowState.id)
    for (const tab of tabsList) {
      if (!tab.pinned && !tab.isPrivate && tab.url !== 'about:blank') {
        allTabs.push({ tab, windowState })
      }
    }
  }

  // Sort by order (higher = older/less recently used)
  allTabs.sort((a, b) => b.tab.order - a.tab.order)

  let discarded = 0
  const activeTabCount = allTabs.filter(t => t.tab.active).length

  for (const { tab, windowState } of allTabs) {
    if (activeTabCount - discarded <= memoryBudgetConfig.minActiveTabs) break
    if (tab.active) continue // Never discard active tab
    if (!tab.webContentsId || !tab.windowId) continue

    const contents = webContents.fromId(tab.webContentsId)
    if (!contents || contents.isDestroyed()) continue

    try {
      // Store discarded tab info for restoration
      discardedTabs.set(tab.id, {
        url: tab.url,
        title: tab.title,
        windowId: tab.windowId,
        order: tab.order,
      })

      // Navigate to about:blank to free memory
      await contents.loadURL('about:blank')
      tab.url = 'about:blank'
      tab.title = 'Discarded tab'
      discarded++

      // Notify renderer
      sendTab(tab)

      // Check if we've freed enough
      const usage = process.memoryUsage()
      const currentMB = Math.round((usage.heapUsed + usage.external) / 1024 / 1024)
      if (currentMB < memoryBudgetConfig.maxMemoryMB * memoryBudgetConfig.discardThreshold) break
    } catch {
      // Ignore errors, try next tab
    }
  }

  if (discarded > 0) {
    broadcast('toast', { text: `Discarded ${discarded} inactive tabs to free memory`, kind: 'info' })
  }
}

async function restoreDiscardedTab(tabId: string): Promise<boolean> {
  const info = discardedTabs.get(tabId)
  if (!info) return false

  const tab = getTabById(tabId)
  if (!tab || !tab.webContentsId) return false

  const contents = webContents.fromId(tab.webContentsId)
  if (!contents || contents.isDestroyed()) return false

  try {
    await contents.loadURL(info.url)
    tab.url = info.url
    tab.title = info.title
    discardedTabs.delete(tabId)
    sendTab(tab)
    return true
  } catch {
    return false
  }
}

function isTabDiscarded(tabId: string): boolean {
  return discardedTabs.has(tabId)
}

function getSettings(): AppSettings {
  const stored = settingsStore.get('settings')
  const merged = { ...DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {}) } as AppSettings
  if (!merged.downloadPath) {
    try {
      merged.downloadPath = app.getPath('downloads')
    } catch {
      merged.downloadPath = ''
    }
  }
  return merged
}

function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const next: AppSettings = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue
    const expected = typeof DEFAULT_SETTINGS[key as keyof AppSettings]
    if (typeof value !== expected) continue
    ;(next as unknown as Record<string, unknown>)[key] = value
  }
  settingsStore.set('settings', next)
  applySettings(next)
  broadcast('settings-updated', next)
  return next
}

function applyDnt(ses: Session, enabled: boolean): void {
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    if (enabled) details.requestHeaders['DNT'] = '1'
    callback({ requestHeaders: details.requestHeaders })
  })
}

function applySettings(settings: AppSettings): void {
  if (settings.downloadPath) downloadManager.setDirectory(settings.downloadPath)
  for (const state of windows.values()) {
    try {
      const ses = session.fromPartition(state.partition)
      applyDnt(ses, settings.doNotTrack)
    } catch {
      // Session may already be destroyed during shutdown.
    }
  }
}

function configureSession(ses: Session, isPrivate: boolean, partition: string): void {
  const key = `${partition}|${isPrivate}`
  if (configuredSessions.has(key)) return
  configuredSessions.add(key)
  configureSessionPermissions(ses, (windowId) => windows.get(windowId)?.isPrivate === true)
  downloadManager.attach(ses, isPrivate)
  applyDnt(ses, getSettings().doNotTrack)
  if (getSettings().dnsOverHttps) {
    // DoH is enabled via app.commandLine switches at startup, not per-session.
    // This flag is a no-op here but kept for clarity; the switch is set in app.whenReady.
  }

  // Content Security Policy
  const csp = [
    "default-src 'self' file: data: blob:;",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' file: data:;",
    "style-src 'self' 'unsafe-inline' data:;",
    "img-src 'self' file: data: blob: https:;",
    "font-src 'self' file: data:;",
    "connect-src 'self' https: wss: ws: data:;",
    "media-src 'self' file: data: blob: https:;",
    "frame-src 'self' file: data: https: http:;",
    "worker-src 'self' file: data: blob:;",
    "object-src 'none';",
    "base-uri 'self';",
    "form-action 'self';",
    "frame-ancestors 'none';",
  ].join(' ')

  ses.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders || {}
    responseHeaders['Content-Security-Policy'] = [csp]
    responseHeaders['X-Content-Type-Options'] = ['nosniff']
    responseHeaders['X-Frame-Options'] = ['DENY']
    responseHeaders['X-XSS-Protection'] = ['1; mode=block']
    responseHeaders['Referrer-Policy'] = ['strict-origin-when-cross-origin']
    responseHeaders['Permissions-Policy'] = ['accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()']
    callback({ responseHeaders })
  })
}

function serializeTab(tab: TabState): Record<string, unknown> {
  return {
    id: tab.id,
    url: tab.url,
    title: tab.title,
    active: tab.active,
    isPrivate: tab.isPrivate === true,
    pinned: tab.pinned === true,
    muted: tab.muted === true,
    loading: tab.loading === true,
    favicon: tab.favicon,
    zoomFactor: tab.zoomFactor ?? 1,
    canGoBack: tab.canGoBack === true,
    canGoForward: tab.canGoForward === true,
    crashed: tab.crashed === true,
    audioPlaying: tab.audioPlaying === true,
  }
}

function sendToWindow(windowId: number | undefined, channel: string, payload?: unknown): void {
  if (windowId === undefined) return
  const state = windows.get(windowId)
  if (!state || state.window.isDestroyed()) return
  state.window.webContents.send(channel, payload)
}

function broadcast(channel: string, payload?: unknown): void {
  for (const state of windows.values()) {
    if (!state.window.isDestroyed()) state.window.webContents.send(channel, payload)
  }
}

function sendTabs(windowId: number): void {
  sendToWindow(windowId, 'tabs-updated', getTabs(windowId).map(serializeTab))
}

function sendTab(tab: TabState): void {
  sendToWindow(tab.windowId, 'tab-updated', serializeTab(tab))
}

function ownerWindow(event: IpcMainInvokeEvent): WindowState {
  const window = BrowserWindow.fromWebContents(event.sender)
  const state = window ? windows.get(window.id) : undefined
  if (!state) throw new Error('IPC sender is not an Ariadne window')
  return state
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return false
  if (!windows.has(window.id)) return false
  const url = event.senderFrame?.url || event.sender.getURL()
  return url.startsWith('file://') && url.includes('index.html')
}

function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error(`Blocked IPC call on ${channel} from an untrusted frame`)
    return listener(event, ...args)
  })
}

function tabForEvent(event: IpcMainInvokeEvent, tabId: string): TabState {
  const state = ownerWindow(event)
  const tab = getTabById(tabId)
  if (!tab || tab.windowId !== state.id) throw new Error('Unknown tab for this window')
  return tab
}

function contentsForTab(tabId: string): Electron.WebContents | null {
  const tab = getTabById(tabId)
  if (!tab?.webContentsId) return null
  const contents = webContents.fromId(tab.webContentsId)
  if (!contents || contents.isDestroyed()) return null
  return contents
}

function isAllowedGuestUrl(raw: string): boolean {
  if (raw === 'about:blank') return true
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function updateNavigationState(tabId: string, contents: Electron.WebContents): void {
  setTabNavState(tabId, contents.canGoBack(), contents.canGoForward())
}

function recordNavigation(tab: TabState): void {
  if (!tab.isPrivate) {
    void addHistory(tab.url, tab.title).catch((error) => console.error('Failed to write history:', error))
  }
}

function attachTabEvents(tabId: string, contents: Electron.WebContents): void {
  if (tabContents.get(contents.id) === tabId) return
  tabContents.set(contents.id, tabId)

  const refresh = (options: { history?: boolean; title?: boolean } = {}): void => {
    const tab = getTabById(tabId)
    if (!tab) return
    if (options.title) tab.title = contents.getTitle() || tab.title
    updateNavigationState(tabId, contents)
    if (options.history) recordNavigation(tab)
    aiSystem.updateTab(tabId, tab.url, tab.title)
    sendTab(tab)
  }

  contents.on('did-start-loading', () => {
    setTabLoading(tabId, true)
    const tab = getTabById(tabId)
    if (tab) sendTab(tab)
  })

  contents.on('did-stop-loading', () => {
    setTabLoading(tabId, false)
    refresh({ title: true })
  })

  contents.on('did-navigate', (_event, url) => {
    const tab = getTabById(tabId)
    if (!tab) return
    setUrl(tabId, url)
    refresh({ title: true, history: true })
  })

  contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (!isMainFrame) return
    const tab = getTabById(tabId)
    if (!tab) return
    setUrl(tabId, url)
    refresh({ history: true })
  })

  contents.on('page-title-updated', (_event, title) => {
    setTabTitle(tabId, title)
    const tab = getTabById(tabId)
    if (tab) {
      aiSystem.updateTab(tabId, tab.url, tab.title)
      sendTab(tab)
    }
  })

  contents.on('page-favicon-updated', (_event, favicons) => {
    setTabFavicon(tabId, favicons[0])
    const tab = getTabById(tabId)
    if (tab) sendTab(tab)
  })

  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return
    setTabLoading(tabId, false)
    sendToWindow(getTabById(tabId)?.windowId, 'tab-load-error', {
      tabId,
      errorCode,
      errorDescription,
      url: validatedURL,
    })
  })

  contents.on('render-process-gone', () => {
    updateTab(tabId, { crashed: true, loading: false })
    const tab = getTabById(tabId)
    if (tab) sendTab(tab)
  })

  contents.on('audio-state-changed', () => {
    const tab = getTabById(tabId)
    if (tab) {
      tab.audioPlaying = contents.isCurrentlyAudible()
      sendTab(tab)
    }
  })

  contents.on('destroyed', () => {
    tabContents.delete(contents.id)
  })
}

function openUrlInNewTab(contents: Electron.WebContents, url: string): void {
  if (!isAllowedGuestUrl(url)) {
    if (/^(mailto|tel):/i.test(url)) void shell.openExternal(url)
    return
  }
  const host = contents.hostWebContents
  const window = host ? BrowserWindow.fromWebContents(host) : null
  const state = window ? windows.get(window.id) : undefined
  if (!state) return
  void createTab(url, { windowId: state.id, isPrivate: state.isPrivate }).then(() => {
    sendTabs(state.id)
    state.window.focus()
  })
}

function registerSecurityHandlers(): void {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() === 'webview') {
      contents.setWindowOpenHandler(({ url }) => {
        openUrlInNewTab(contents, url)
        return { action: 'deny' }
      })
      contents.on('will-navigate', (event, url) => {
        if (!isAllowedGuestUrl(url)) event.preventDefault()
      })
      contents.on('will-redirect', (event, url) => {
        if (!isAllowedGuestUrl(url)) event.preventDefault()
      })
      return
    }

    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })
}

function createBrowserWindow(options: { isPrivate?: boolean; url?: string } = {}): BrowserWindow {
  const isPrivate = options.isPrivate === true
  const partition = isPrivate ? `ariadne-private-${randomUUID()}` : 'persist:ariadne'
  if (isPrivate) privatePartitions.add(partition)
  const ses = session.fromPartition(partition)
  configureSession(ses, isPrivate, partition)

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#101215',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      partition,
      spellcheck: true,
    },
  })

  const state: WindowState = { id: window.id, window, isPrivate, partition }
  windows.set(window.id, state)

  // Renderer diagnostics: never fail silently to a black window.
  window.webContents.on('console-message' as any, (...args: any[]) => {
    const details = args[1] && typeof args[1] === 'object' ? args[1] : null
    const level = details ? details.level : args[1]
    const message = details ? details.message : args[2]
    if (level === 'error' || level === 'warning' || level === 3 || level === 2) {
      console.error(`[renderer:${level}] ${message}`)
    }
  })
  window.webContents.on('preload-error' as any, (_event: any, preloadPath: string, error: Error) => {
    console.error('[renderer] preload failed:', preloadPath, error)
  })
  window.webContents.on('render-process-gone' as any, (_event: any, details: unknown) => {
    console.error('[renderer] process gone:', details)
  })
  window.webContents.on('did-fail-load' as any, (_event: any, code: number, description: string, url: string) => {
    console.error('[renderer] load failed:', code, description, url)
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault()
  })
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete (webPreferences as { preload?: string }).preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
    webPreferences.webviewTag = false
    if (params.partition !== partition) {
      event.preventDefault()
      return
    }
    if (params.src && !isAllowedGuestUrl(params.src)) event.preventDefault()
  })

  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.show()
      sendTabs(window.id)
    }
  })

  void createTab(options.url || 'about:blank', { windowId: window.id, isPrivate })

  window.on('closed', () => {
    denyPendingForWindow(window.id)
    const tabIds = closeTabsForWindow(window.id)
    for (const tabId of tabIds) {
      aiSystem.unregisterTab(tabId)
      contextService.removeTab(tabId)
      tabContents.forEach((mappedTabId, contentsId) => {
        if (mappedTabId === tabId) tabContents.delete(contentsId)
      })
    }
    windows.delete(window.id)
    if (isPrivate) {
      void ses.clearStorageData().catch(() => undefined)
      void ses.clearCache().catch(() => undefined)
      privatePartitions.delete(partition)
    }
  })

  void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  return window
}

function broadcastDownload(record: DownloadRecord): void {
  for (const state of windows.values()) {
    if (state.window.isDestroyed()) continue
    if (state.isPrivate !== (record.isPrivate === true)) continue
    state.window.webContents.send('download-updated', record)
  }
}

function registerIpc(): void {
  // App/window ------------------------------------------------------------
  handle('app:info', async () => ({
    appName: app.getName(),
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
  }))

  handle('app:open-external', async (_event, url: string) => {
    if (/^(https?:|mailto:|tel:)/i.test(url)) await shell.openExternal(url)
  })

  handle('window:info', async (event) => {
    const state = ownerWindow(event)
    return { id: state.id, isPrivate: state.isPrivate, partition: state.partition }
  })

  handle('window:create', async (_event, options?: { private?: boolean; url?: string }) => {
    const window = createBrowserWindow({ isPrivate: options?.private === true, url: options?.url })
    return window.id
  })

  handle('window:close', async (event) => {
    ownerWindow(event).window.close()
  })
  handle('window:minimize', async (event) => {
    ownerWindow(event).window.minimize()
  })
  handle('window:maximize', async (event) => {
    const window = ownerWindow(event).window
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  handle('window:is-maximized', async (event) => ownerWindow(event).window.isMaximized())

  // Settings --------------------------------------------------------------
  handle('settings:get', async () => ({ ...getSettings(), searchEngines: SEARCH_ENGINES }))
  handle('settings:set', async (_event, patch: Partial<AppSettings>) => saveSettings(patch))

  handle('privacy:clear-data', async (event, options?: { history?: boolean; cookies?: boolean; cache?: boolean; permissions?: boolean }) => {
    const state = ownerWindow(event)
    if (options?.history !== false) {
      await clearHistory()
      sendToWindow(state.id, 'history-cleared')
    }
    if (options?.permissions) clearPermissionDecisions()
    if (options?.cookies || options?.cache) {
      const ses = session.fromPartition(state.partition)
      if (options.cookies) await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'shadercache', 'serviceworkers', 'cachestorage'] })
      if (options.cache) await ses.clearCache()
    }
    return true
  })

  // Tabs ------------------------------------------------------------------
  handle('tab:create', async (event, url?: string) => {
    const state = ownerWindow(event)
    const id = await createTab(url, { windowId: state.id, isPrivate: state.isPrivate })
    sendTabs(state.id)
    return id
  })

  handle('tab:close', async (event, id: string) => {
    const state = ownerWindow(event)
    const tab = getTabById(id)
    if (!tab || tab.windowId !== state.id) return null
    aiSystem.unregisterTab(id)
    contextService.removeTab(id)
    const next = await closeTab(id, state.id)
    sendTabs(state.id)
    return next
  })

  handle('tab:set-active', async (event, id: string) => {
    const state = ownerWindow(event)
    // Restore discarded tab if needed
    if (isTabDiscarded(id)) {
      await restoreDiscardedTab(id)
    }
    await setActiveTab(id, state.id)
    sendTabs(state.id)
  })

  handle('tab:get-all', async (event) => getTabs(ownerWindow(event).id).map(serializeTab))

  handle('tab:navigate', async (event, id: string, url: string) => {
    const tab = tabForEvent(event, id)
    if (!isAllowedGuestUrl(url)) throw new Error('Only http(s) and about:blank navigation is allowed')
    setUrl(id, url)
    updateTab(id, { crashed: false })
    const contents = contentsForTab(id)
    if (contents) {
      await contents.loadURL(url)
    } else {
      sendTab(tab)
    }
  })

  handle('tab:set-web-contents', async (event, id: string, webContentsId: number) => {
    const tab = tabForEvent(event, id)
    const contents = webContents.fromId(webContentsId)
    if (!contents || contents.isDestroyed() || contents.getType() !== 'webview') {
      throw new Error('Invalid webview contents')
    }
    if (contents.hostWebContents !== event.sender) {
      throw new Error('Webview does not belong to this window')
    }
    setTabWebContents(id, webContentsId)
    aiSystem.registerTab(id, webContentsId, tab.url, tab.title, tab.isPrivate === true)
    attachTabEvents(id, contents)

    // The webview may finish navigating before its contents id reaches the
    // main process, so events like did-navigate can fire before we attach.
    // Sync the live state once at registration to cover that gap.
    const current = getTabById(id)
    if (current) {
      const liveTitle = contents.getTitle()
      const liveUrl = contents.getURL()
      if (liveTitle) current.title = liveTitle
      if (liveUrl && liveUrl !== 'about:blank') current.url = liveUrl
      current.loading = contents.isLoading()
      current.canGoBack = contents.canGoBack()
      current.canGoForward = contents.canGoForward()
      aiSystem.updateTab(id, current.url, current.title)
      sendTab(current)
    }
  })

  const activeContents = (event: IpcMainInvokeEvent): Electron.WebContents | null => {
    const state = ownerWindow(event)
    const active = getTabs(state.id).find((tab) => tab.active)
    return active ? contentsForTab(active.id) : null
  }

  handle('tab:back', async (event) => {
    const contents = activeContents(event)
    if (contents?.canGoBack()) contents.goBack()
  })
  handle('tab:forward', async (event) => {
    const contents = activeContents(event)
    if (contents?.canGoForward()) contents.goForward()
  })
  handle('tab:reload', async (event) => {
    activeContents(event)?.reload()
  })
  handle('tab:stop', async (event) => {
    activeContents(event)?.stop()
  })
  handle('tab:force-reload', async (event) => {
    activeContents(event)?.reloadIgnoringCache()
  })
  handle('tab:devtools', async (event) => {
    const contents = activeContents(event)
    if (contents) {
      if (contents.isDevToolsOpened()) contents.closeDevTools()
      else contents.openDevTools({ mode: 'detach' })
    }
  })

  handle('tab:duplicate', async (event, id: string) => {
    tabForEvent(event, id)
    const newId = await duplicateTab(id)
    sendTabs(ownerWindow(event).id)
    return newId
  })

  handle('tab:pin', async (event, id: string) => {
    tabForEvent(event, id)
    const pinned = pinTab(id)
    const tab = getTabById(id)
    if (tab) sendTab(tab)
    return pinned
  })

  handle('tab:mute', async (event, id: string) => {
    tabForEvent(event, id)
    const muted = muteTab(id)
    const contents = contentsForTab(id)
    if (contents) contents.setAudioMuted(muted)
    const tab = getTabById(id)
    if (tab) sendTab(tab)
    return muted
  })

  handle('tab:reorder', async (event, fromIndex: number, toIndex: number) => {
    const state = ownerWindow(event)
    reorderTab(fromIndex, toIndex, state.id)
    sendTabs(state.id)
  })

  handle('tab:reopen-closed', async (event) => {
    const state = ownerWindow(event)
    const id = await reopenClosedTab(state.id)
    sendTabs(state.id)
    return id
  })

  handle('tab:get-closed', async () => getClosedTabs())

  handle('tab:set-zoom', async (event, id: string, factor: number) => {
    tabForEvent(event, id)
    const contents = contentsForTab(id)
    if (contents) contents.setZoomFactor(factor)
    setTabZoom(id, factor)
    const tab = getTabById(id)
    if (tab) sendTab(tab)
  })

  handle('tab:get-zoom', async (event, id: string) => {
    tabForEvent(event, id)
    return contentsForTab(id)?.getZoomFactor() ?? 1
  })

  handle('tab:find-in-page', async (event, id: string, text: string, options?: { forward?: boolean; findNext?: boolean }) => {
    tabForEvent(event, id)
    return (await findInPage(id, text, options)) ?? { requestId: 0, activeMatchOrdinal: 0, matches: 0 }
  })

  handle('tab:stop-finding', async (event, id: string, action: 'clear' | 'keep' | 'activate') => {
    tabForEvent(event, id)
    const mapped = action === 'clear' ? 'clearSelection' : action === 'keep' ? 'keepSelection' : 'activateSelection'
    stopFinding(id, mapped)
  })

  handle('tab:print', async (event, id: string) => {
    tabForEvent(event, id)
    printTab(id)
  })

  handle('tab:fullscreen', async (event) => {
    const window = ownerWindow(event).window
    window.setFullScreen(!window.isFullScreen())
  })

  handle('tab:view-source', async (event, id: string) => {
    tabForEvent(event, id)
    const contents = contentsForTab(id)
    if (!contents) return
    const source = await contents.executeJavaScript('document.documentElement.outerHTML', true)
    const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(String(source))}`
    const state = ownerWindow(event)
    const newId = await createTab(dataUrl, { windowId: state.id, isPrivate: state.isPrivate })
    sendTabs(state.id)
    return newId
  })

  // History ---------------------------------------------------------------
  handle('history:get', async () => getHistory())
  handle('history:add', async (_event, url: string, title: string) => addHistory(url, title))
  handle('history:delete', async (_event, id: number) => deleteHistoryEntry(id))
  handle('history:clear', async (event, options?: { since?: number }) => {
    await clearHistory(options?.since)
    sendToWindow(ownerWindow(event).id, 'history-cleared')
  })

  // Bookmarks -------------------------------------------------------------
  const getBookmarks = (): any[] => {
    const value = bookmarksStore.get('bookmarks')
    return Array.isArray(value) ? (value as any[]) : []
  }
  const saveBookmarks = (bookmarks: any[]): void => bookmarksStore.set('bookmarks', bookmarks)

  handle('bookmarks:get', async () => getBookmarks())
  handle('bookmarks:add', async (_event, bookmark: { title: string; url: string; folderId?: string }) => {
    const bookmarks = getBookmarks()
    const entry = {
      id: `bm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      title: String(bookmark.title || bookmark.url || 'Bookmark'),
      url: String(bookmark.url || ''),
      folderId: bookmark.folderId,
      parentId: bookmark.folderId,
      isFolder: false,
      dateAdded: Date.now(),
      dateModified: Date.now(),
    }
    bookmarks.push(entry)
    saveBookmarks(bookmarks)
    return entry
  })
  handle('bookmarks:add-folder', async (_event, title: string, parentId?: string) => {
    const bookmarks = getBookmarks()
    const entry = {
      id: `bm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      title: String(title || 'Folder'),
      url: '',
      folderId: parentId,
      parentId,
      isFolder: true,
      dateAdded: Date.now(),
      dateModified: Date.now(),
    }
    bookmarks.push(entry)
    saveBookmarks(bookmarks)
    return entry
  })
  handle('bookmarks:update', async (_event, id: string, updates: { title?: string; url?: string }) => {
    const bookmarks = getBookmarks()
    const index = bookmarks.findIndex((bookmark) => bookmark.id === id)
    if (index < 0) return null
    bookmarks[index] = { ...bookmarks[index], ...updates, dateModified: Date.now() }
    saveBookmarks(bookmarks)
    return bookmarks[index]
  })
  handle('bookmarks:delete', async (_event, id: string) => {
    let bookmarks = getBookmarks()
    const remove = (target: string): void => {
      bookmarks = bookmarks.filter((bookmark) => bookmark.id !== target)
      for (const child of bookmarks.filter((bookmark) => bookmark.parentId === target)) remove(child.id)
    }
    remove(id)
    saveBookmarks(bookmarks)
  })
  handle('bookmarks:move', async (_event, id: string, parentId: string, index?: number) => {
    const bookmarks = getBookmarks()
    const bookmark = bookmarks.find((candidate) => candidate.id === id)
    if (!bookmark) return null
    bookmark.parentId = parentId || undefined
    bookmark.folderId = parentId || undefined
    bookmark.dateModified = Date.now()
    if (typeof index === 'number') {
      bookmarks.splice(bookmarks.indexOf(bookmark), 1)
      bookmarks.splice(Math.max(0, index), 0, bookmark)
    }
    saveBookmarks(bookmarks)
    return bookmark
  })
  handle('bookmarks:export', async () => {
    const bookmarks = getBookmarks()
    const lines = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>', '<DL><p>']
    for (const bookmark of bookmarks) {
      if (bookmark.isFolder) continue
      lines.push(`  <DT><A HREF="${String(bookmark.url).replace(/"/g, '&quot;')}">${String(bookmark.title).replace(/</g, '&lt;')}</A>`)
    }
    lines.push('</DL><p>')
    return lines.join('\n')
  })
  handle('bookmarks:import', async (_event, html: string) => {
    const bookmarks = getBookmarks()
    const matches = String(html).matchAll(/<A\s+[^>]*HREF="([^"]+)"[^>]*>([\s\S]*?)<\/A>/gi)
    let imported = 0
    for (const match of matches) {
      const url = match[1]
      const title = match[2].replace(/<[^>]+>/g, '').trim() || url
      if (!/^https?:/i.test(url)) continue
      bookmarks.push({
        id: `bm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        title,
        url,
        isFolder: false,
        dateAdded: Date.now(),
        dateModified: Date.now(),
      })
      imported += 1
    }
    saveBookmarks(bookmarks)
    return { imported }
  })

  // Downloads -------------------------------------------------------------
  const ownsDownload = (event: IpcMainInvokeEvent, id: string): boolean =>
    downloadManager.getDownloads(ownerWindow(event).isPrivate).some((record) => record.id === id)

  handle('downloads:get', async (event) => downloadManager.getDownloads(ownerWindow(event).isPrivate))
  handle('downloads:pause', async (event, id: string) => ownsDownload(event, id) && downloadManager.pause(id))
  handle('downloads:resume', async (event, id: string) => ownsDownload(event, id) && downloadManager.resume(id))
  handle('downloads:cancel', async (event, id: string) => ownsDownload(event, id) && downloadManager.cancel(id))
  handle('downloads:remove', async (event, id: string) => {
    if (ownsDownload(event, id)) downloadManager.remove(id)
  })
  handle('downloads:open', async (event, id: string) => {
    if (ownsDownload(event, id)) downloadManager.open(id)
  })
  handle('downloads:show-in-folder', async (event, id: string) => {
    if (ownsDownload(event, id)) downloadManager.showInFolder(id)
  })
  handle('downloads:retry', async (event, id: string) => ownsDownload(event, id) && downloadManager.retry(id))
  handle('downloads:clear', async (event) => downloadManager.clear(ownerWindow(event).isPrivate))
  handle('downloads:get-path', async () => downloadManager.getDirectory())
  handle('downloads:set-path', async (_event, directory: string) => {
    saveSettings({ downloadPath: directory })
    downloadManager.setDirectory(directory)
  })

  // Permissions -----------------------------------------------------------
  handle('permission:respond', async (_event, id: string, decision: 'grant' | 'deny', remember: boolean) => {
    return respondToPermission(id, decision === 'grant', remember)
  })
  handle('permission:get-decisions', async () => getPermissionDecisions())
  handle('permission:clear', async (_event, origin?: string) => clearPermissionDecisions(origin))

  // AI --------------------------------------------------------------------
  handle('ai:config:get', async () => aiSystem.getConfig())
  handle('ai:config:update', async (_event, updates) => aiSystem.updateConfig(updates))
  handle('ai:provider:add', async (_event, config, apiKeys?: string[]) => aiSystem.addProvider(config, apiKeys))
  handle('ai:provider:remove', async (_event, id) => aiSystem.removeProvider(id))
  handle('ai:provider:test', async (_event, id, apiKeys?: string[]) => aiSystem.testProvider(id, apiKeys))
  handle('ai:provider:set-keys', async (_event, providerId, apiKeys: string[]) => aiSystem.setApiKeys(providerId, apiKeys))
  handle('ai:provider:add-key', async (_event, providerId, apiKey: string) => aiSystem.addApiKey(providerId, apiKey))
  handle('ai:provider:remove-key', async (_event, providerId, keyIndex: number) => aiSystem.removeApiKey(providerId, keyIndex))
  handle('ai:provider:get-masked-keys', async (_event, providerId) => aiSystem.getMaskedApiKeys(providerId))
  handle('ai:provider:key-count', async (_event, providerId) => aiSystem.getApiKeyCount(providerId))
  handle('ai:providers:list', async () => aiSystem.getRegistry().getAllConfigs())
  handle('ai:models:list', async () => aiSystem.getAllModels())
  handle('ai:models:for-provider', async (_event, providerId) => aiSystem.getRegistry().getModelsForProvider(providerId))
  handle('ai:model-slot:set', async (_event, slot, modelId) => aiSystem.setModelSlot(slot, modelId))
  handle('ai:model-slot:get', async (_event, slot) => aiSystem.getModelSlot(slot))
  handle('ai:model-slot:get-all', async () => aiSystem.getRegistry().getAllModelSlots())
  handle('ai:model-slot:get-model', async (_event, slot) => aiSystem.getModelForSlot(slot))
  handle('ai:provider-types', async () => aiSystem.getProviderTypes())
  handle('ai:models:discover', async (_event, type: string, baseUrl: string, apiKey?: string) => aiSystem.discoverModels(type as any, baseUrl, apiKey))
  handle('ai:provider:add-auto', async (_event, { type, name, baseUrl, apiKey }: { type: string; name: string; baseUrl: string; apiKey?: string }) => {
    const id = `${type}-${Date.now()}`
    const providerType = type as any
    const models = await aiSystem.discoverModels(providerType, baseUrl, apiKey)
    const config: any = {
      id,
      name,
      type: providerType,
      baseUrl,
      enabled: true,
      models: models.map(m => ({ ...m, provider: id })),
      defaultModel: models[0]?.id,
    }
    if (apiKey) {
      await storeCredential(id, `${id}-key`, apiKey)
      config.apiKeyRef = `${id}-key`
    }
    await aiSystem.addProvider(config)
    // Auto-assign first model to fastBrowsing if no model assigned
    const slots = aiSystem.getRegistry().getAllModelSlots()
    const firstModel = models[0]?.id
    if (firstModel && !slots.fastBrowsing) {
      aiSystem.setModelSlot('fastBrowsing', firstModel)
      if (!slots.research) aiSystem.setModelSlot('research', firstModel)
    }
    return { success: true, provider: config }
  })
  handle('ai:system-prompt:get', async () => aiSystem.getSystemPrompt())
  handle('ai:system-prompt:set', async (_event, prompt) => aiSystem.setSystemPrompt(prompt))
  handle('ai:chat:complete', async (_event, request) => aiSystem.getRegistry().chatCompletion(request))
  handle('ai:chat:cancel', async () => aiSystem.cancelChat())
  handle('ai:usage', async (_event, providerId?: string, since?: number) => aiSystem.getRegistry().getUsageHistory(providerId, since))
  handle('ai:usage-total', async (_event, since?: number) => aiSystem.getRegistry().getTotalUsage(since))

  handle('ai:chat:stream', async (event, request, requestId: string) => {
    const registry = aiSystem.getRegistry()
    const sender = event.sender
    return new Promise((resolve, reject) => {
      let finishReason = 'stop'
      let usage: unknown
      registry
        .chatCompletionStream(request, (chunk: any) => {
          if (chunk.usage) usage = chunk.usage
          if (chunk.choices?.[0]?.finishReason) finishReason = chunk.choices[0].finishReason
          if (!sender.isDestroyed()) sender.send('ai:stream-chunk', { requestId, chunk })
        })
        .then(() => resolve({ requestId, finishReason, usage }))
        .catch(reject)
    })
  })

  // Agent IPC ---------------------------------------------------------------
  handle('ai:agent:tools', async () => aiSystem.getRegistry().getAgentTools())
  
  handle('ai:agent:run', async (event, request, context) => {
    const winState = ownerWindow(event)
    if (!winState) throw new Error('No window')
    const tab = getTabs(winState.id).find(t => t.id === context.tabId)
    if (!tab || !tab.webContentsId) throw new Error('Tab not found')
    
    const toolContext = { tabId: context.tabId, webContentsId: tab.webContentsId, window: winState.window }
    
    return aiSystem.getRegistry().runAgentLoop(
      request,
      toolContext,
      (toolCall, result) => {
        if (!winState.window.webContents.isDestroyed()) {
          winState.window.webContents.send('ai:agent:tool-result', { toolCall, result })
        }
      },
      (step) => {
        if (!winState.window.webContents.isDestroyed()) {
          winState.window.webContents.send('ai:agent:step', step)
        }
      }
    )
  })
  
  handle('ai:agent:approve', async (_event, toolCallId: string, approved: boolean) => {
    // Tool approval handled in renderer - this is for tracking
    return { success: true, toolCallId, approved }
  })

  // Memory budget & tab discarding ------------------------------------------
  handle('memory:config:get', async () => getMemoryBudgetConfig())
  handle('memory:config:set', async (_event, patch: Partial<MemoryBudgetConfig>) => setMemoryBudgetConfig(patch))
  handle('memory:check', async () => checkMemoryAndDiscard())
  handle('memory:discarded-tabs', async () => Array.from(discardedTabs.entries()).map(([id, info]) => ({ id, ...info })))
  handle('tab:is-discarded', async (_event, tabId: string) => isTabDiscarded(tabId))

  handle('ai:extract-page', async (event, tabId: string) => {
    tabForEvent(event, tabId)
    return aiSystem.extractPage(tabId)
  })
  handle('ai:get-tabs-context', async (event, tabIds: string[]) => {
    const allowed = new Set(getTabs(ownerWindow(event).id).map((tab) => tab.id))
    return aiSystem.getTabsContext(tabIds.filter((id) => allowed.has(id)))
  })
  handle('ai:context:retrieve', async (event, query: string, tabIds?: string[]) => {
    const allowed = getTabs(ownerWindow(event).id).map((tab) => tab.id)
    return aiSystem.getContextForQuery(query, tabIds ? tabIds.filter((id) => allowed.includes(id)) : allowed)
  })
  handle('ai:context:format', async (event, query: string, tabIds?: string[]) => {
    const allowed = getTabs(ownerWindow(event).id).map((tab) => tab.id)
    return aiSystem.formatContextForLLM(query, tabIds ? tabIds.filter((id) => allowed.includes(id)) : allowed)
  })
  handle('ai:context:ingest', async (event, tabId: string) => {
    tabForEvent(event, tabId)
    return aiSystem.ingestTab(tabId)
  })

  // Cross-tab context -----------------------------------------------------
  handle('context:get-state', async (event) => contextService.getState(ownerWindow(event).id))
  handle('context:extract', async (event, selection, options) =>
    contextService.extract(selection, options, ownerWindow(event).id)
  )
  handle('context:preview', async (event, question: string, tabIds?: string[], maxChunks?: number) => {
    const allowed = getTabs(ownerWindow(event).id).map((tab) => tab.id)
    const scoped = tabIds && tabIds.length > 0 ? tabIds.filter((id) => allowed.includes(id)) : allowed
    return contextService.preview(question, scoped, maxChunks)
  })
  handle('context:ask', async (_event, payloadHash: string) => contextService.ask(payloadHash))
  handle('context:set-exclusions', async (_event, hosts: string[]) => contextService.applyExclusions(hosts))
  handle('context:set-private-session', async (_event, enabled: boolean) => contextService.setPrivateSession(enabled))
  handle('context:clear-private', async () => {
    contextService.clearPrivate()
    return contextService.getState()
  })
  handle('context:clear', async () => contextService.clearAll())
  handle('context:remove-item', async (_event, itemId: string) => contextService.removeItem(itemId))
  handle('context:remove-tab', async (_event, tabId: string) => contextService.removeTab(tabId))
  handle('context:get-item-text', async (event, itemId: string) => {
    const item = contextService.getItemText(itemId)
    if (!item) return null
    const allowed = new Set(getTabs(ownerWindow(event).id).map((tab) => tab.id))
    const state = contextService.getState(ownerWindow(event).id)
    const summary = state.items.find((candidate) => candidate.id === itemId)
    if (!summary || !allowed.has(summary.tabId)) return null
    return item
  })
  handle('context:screenshot', async (event, tabId: string) => {
    tabForEvent(event, tabId)
    return contextService.screenshot(tabId)
  })
  handle('context:mark-tab-private', async (_event, tabId: string, isPrivate: boolean) =>
    contextService.markTabPrivate(tabId, isPrivate)
  )
}

downloadManager.on('updated', (record: DownloadRecord) => broadcastDownload(record))
downloadManager.on('removed', (id: string) => broadcast('download-removed', id))
downloadManager.on('cleared', () => broadcast('downloads-cleared'))

registerSecurityHandlers()

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const existing = Array.from(windows.values())[0]
    if (existing) {
      if (existing.window.isMinimized()) existing.window.restore()
      existing.window.focus()
    } else {
      createBrowserWindow()
    }
  })

  app.whenReady().then(async () => {
    // Enable DNS-over-HTTPS via command line switches (must be set early)
    if (getSettings().dnsOverHttps) {
      app.commandLine.appendSwitch('enable-features', 'DnsOverHttps<DoHTrial')
      app.commandLine.appendSwitch('force-fieldtrials', 'DoHTrial/Enabled')
      app.commandLine.appendSwitch('force-fieldtrial-params', 'DoHTrial.Enabled:server/https://dns.google/dns-query')
    }

    initPermissions()
    await initTabs()
    await aiSystem.getRegistry().initialize()
    registerAgentToolHandlers()
    installApplicationMenu()
    registerIpc()
    createBrowserWindow()
    restartMemoryMonitor()

    const captureDir = process.env.ARIADNE_CAPTURE_DIR
    const demoDir = process.env.ARIADNE_DEMO_DIR
    const windowForCapture = () => {
      const first = Array.from(windows.values())[0]
      return first && !first.window.isDestroyed() ? first.window : undefined
    }
    if (demoDir) {
      const { runDemo } = await import('./capture')
      void runDemo(demoDir, windowForCapture)
    } else if (captureDir) {
      const { runCapture } = await import('./capture')
      void runCapture(captureDir, windowForCapture)
    }
  })

  app.on('activate', () => {
    if (windows.size === 0) createBrowserWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void (async () => {
      try {
        if (getSettings().clearOnExit) {
          await clearHistory()
          for (const state of windows.values()) {
            const ses = session.fromPartition(state.partition)
            await ses.clearStorageData().catch(() => undefined)
            await ses.clearCache().catch(() => undefined)
          }
        }
        await aiSystem.shutdown()
        contextService.dispose()
        await closeDatabase()
      } catch (error) {
        console.error('Shutdown cleanup failed:', error)
      } finally {
        app.quit()
      }
    })()
  })
}
