import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Tab management
  createTab: (url?: string) => ipcRenderer.invoke('tab:create', url),
  closeTab: (id: string) => ipcRenderer.invoke('tab:close', id),
  setActiveTab: (id: string) => ipcRenderer.invoke('tab:set-active', id),
  getTabs: () => ipcRenderer.invoke('tab:get-all'),
  setUrl: (id: string, url: string) => ipcRenderer.invoke('tab:url', id, url),
  setTabWebContents: (id: string, webContentsId: number) => ipcRenderer.invoke('tab:set-web-contents', id, webContentsId),
  setTabTitle: (id: string, title: string) => ipcRenderer.invoke('tab:set-title', id, title),
  back: () => ipcRenderer.invoke('tab:back'),
  forward: () => ipcRenderer.invoke('tab:forward'),
  reload: () => ipcRenderer.invoke('tab:reload'),
  stop: () => ipcRenderer.invoke('tab:stop'),
  duplicateTab: (id: string) => ipcRenderer.invoke('tab:duplicate', id),
  pinTab: (id: string) => ipcRenderer.invoke('tab:pin', id),
  muteTab: (id: string) => ipcRenderer.invoke('tab:mute', id),
  reorderTab: (fromIndex: number, toIndex: number) => ipcRenderer.invoke('tab:reorder', fromIndex, toIndex),
  reopenClosedTab: () => ipcRenderer.invoke('tab:reopen-closed'),
  getClosedTabs: () => ipcRenderer.invoke('tab:get-closed'),
  setTabZoom: (id: string, factor: number) => ipcRenderer.invoke('tab:set-zoom', id, factor),
  getTabZoom: (id: string) => ipcRenderer.invoke('tab:get-zoom', id),
  findInPage: (id: string, text: string, options?: { forward?: boolean; matchCase?: boolean }) => ipcRenderer.invoke('tab:find-in-page', id, text, options),
  stopFinding: (id: string, action: 'clear' | 'keep' | 'activate') => ipcRenderer.invoke('tab:stop-finding', id, action),
  print: (id: string) => ipcRenderer.invoke('tab:print', id),
  viewSource: (id: string) => ipcRenderer.invoke('tab:view-source', id),
  fullscreen: (id: string) => ipcRenderer.invoke('tab:fullscreen', id),

  // History
  getHistory: () => ipcRenderer.invoke('history:get'),
  addHistory: (url: string, title: string) => ipcRenderer.invoke('history:add', url, title),
  deleteHistoryEntry: (id: number) => ipcRenderer.invoke('history:delete', id),
  clearHistory: (options?: { since?: number }) => ipcRenderer.invoke('history:clear', options),

  // Bookmarks
  getBookmarks: () => ipcRenderer.invoke('bookmarks:get'),
  addBookmark: (bookmark: { title: string; url: string; folderId?: string }) => ipcRenderer.invoke('bookmarks:add', bookmark),
  addBookmarkFolder: (title: string, parentId?: string) => ipcRenderer.invoke('bookmarks:add-folder', title, parentId),
  updateBookmark: (id: string, updates: { title?: string; url?: string }) => ipcRenderer.invoke('bookmarks:update', id, updates),
  deleteBookmark: (id: string) => ipcRenderer.invoke('bookmarks:delete', id),
  moveBookmark: (id: string, parentId: string, index?: number) => ipcRenderer.invoke('bookmarks:move', id, parentId, index),
  importBookmarks: (html: string) => ipcRenderer.invoke('bookmarks:import', html),
  exportBookmarks: () => ipcRenderer.invoke('bookmarks:export'),

  // Downloads
  getDownloads: () => ipcRenderer.invoke('downloads:get'),
  pauseDownload: (id: string) => ipcRenderer.invoke('downloads:pause', id),
  resumeDownload: (id: string) => ipcRenderer.invoke('downloads:resume', id),
  cancelDownload: (id: string) => ipcRenderer.invoke('downloads:cancel', id),
  removeDownload: (id: string) => ipcRenderer.invoke('downloads:remove', id),
  openDownload: (id: string) => ipcRenderer.invoke('downloads:open', id),
  showDownloadInFolder: (id: string) => ipcRenderer.invoke('downloads:show-in-folder', id),
  retryDownload: (id: string) => ipcRenderer.invoke('downloads:retry', id),
  clearDownloads: () => ipcRenderer.invoke('downloads:clear'),
  setDownloadPath: (path: string) => ipcRenderer.invoke('downloads:set-path', path),
  getDownloadPath: () => ipcRenderer.invoke('downloads:get-path'),

  // Permissions
  requestPermission: (tabId: string, permission: string) => ipcRenderer.invoke('permission:request', tabId, permission),
  getPermissions: (origin: string) => ipcRenderer.invoke('permission:get', origin),
  setPermission: (origin: string, permission: string, setting: 'grant' | 'deny' | 'ask') => ipcRenderer.invoke('permission:set', origin, permission, setting),
  clearPermissions: (origin?: string) => ipcRenderer.invoke('permission:clear', origin),

  // Windows
  createWindow: (options?: { private?: boolean; url?: string }) => ipcRenderer.invoke('window:create', options),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),

  // AI System
  ai: {
    // Config
    getConfig: () => ipcRenderer.invoke('ai:config:get'),
    updateConfig: (updates: any) => ipcRenderer.invoke('ai:config:update', updates),

    // Providers
    getProviders: () => ipcRenderer.invoke('ai:providers:list'),
    addProvider: (config: any, apiKey?: string) => ipcRenderer.invoke('ai:provider:add', config, apiKey),
    removeProvider: (id: string) => ipcRenderer.invoke('ai:provider:remove', id),
    testProvider: (id: string, apiKey?: string) => ipcRenderer.invoke('ai:provider:test', id, apiKey),
    setApiKey: (providerId: string, keyName: string, apiKey: string) => ipcRenderer.invoke('ai:provider:set-key', providerId, keyName, apiKey),
    getMaskedKey: (providerId: string, keyName: string) => ipcRenderer.invoke('ai:provider:get-masked-key', providerId, keyName),

    // Models
    getModels: () => ipcRenderer.invoke('ai:models:list'),
    getModelsForProvider: (providerId: string) => ipcRenderer.invoke('ai:models:for-provider', providerId),
    getModelSlots: () => ipcRenderer.invoke('ai:model-slot:get-all'),
    setModelSlot: (slot: string, modelId: string) => ipcRenderer.invoke('ai:model-slot:set', slot, modelId),
    getModelSlot: (slot: string) => ipcRenderer.invoke('ai:model-slot:get', slot),
    getModelForSlot: (slot: string) => ipcRenderer.invoke('ai:model-slot:get-model', slot),

    // Provider types
    getProviderTypes: () => ipcRenderer.invoke('ai:provider-types'),

    // System prompt
    getSystemPrompt: () => ipcRenderer.invoke('ai:system-prompt:get'),
    setSystemPrompt: (prompt: string) => ipcRenderer.invoke('ai:system-prompt:set', prompt),

    // Chat
    chatComplete: (request: any) => ipcRenderer.invoke('ai:chat:complete', request),
    chatStream: (request: any) => ipcRenderer.invoke('ai:chat:stream', request),
    onStreamChunk: (callback: (chunk: any) => void) => {
      const handler = (_e: any, chunk: any) => callback(chunk)
      ipcRenderer.on('ai:stream-chunk', handler)
      return () => ipcRenderer.removeListener('ai:stream-chunk', handler)
    },

    // Page Extraction
    extractPage: (tabId: string) => ipcRenderer.invoke('ai:extract-page', tabId),
    getTabsContext: (tabIds: string[]) => ipcRenderer.invoke('ai:get-tabs-context', tabIds),

    // Context Retrieval
    contextRetrieve: (query: string, tabIds?: string[]) => ipcRenderer.invoke('ai:context:retrieve', query, tabIds),
    contextFormat: (query: string, tabIds?: string[]) => ipcRenderer.invoke('ai:context:format', query, tabIds),
    contextIngest: (tabId: string) => ipcRenderer.invoke('ai:context:ingest', tabId),

    // Usage
    getUsage: (providerId?: string, since?: number) => ipcRenderer.invoke('ai:usage', providerId, since),
    getTotalUsage: (since?: number) => ipcRenderer.invoke('ai:usage-total', since),
  },

  // Context Menu
  showContextMenu: (menu: any) => ipcRenderer.invoke('context-menu:show', menu),

  // Events
  on: (channel: string, callback: (...args: any[]) => void) => {
    const subscription = (_event: any, ...args: any[]) => callback(...args)
    ipcRenderer.on(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  },
  once: (channel: string, callback: (...args: any[]) => void) => {
    const subscription = (_event: any, ...args: any[]) => callback(...args)
    ipcRenderer.once(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  },
  off: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, callback)
  },
  ready: () => ipcRenderer.invoke('app:ready'),
})