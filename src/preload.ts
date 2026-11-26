import { contextBridge, ipcRenderer } from 'electron'

const EVENT_CHANNELS = new Set([
  'tabs-updated',
  'tab-updated',
  'tab-load-error',
  'download-updated',
  'download-removed',
  'downloads-cleared',
  'shortcut',
  'permission-request',
  'settings-updated',
  'history-cleared',
  'ai:stream-chunk',
  'ai:agent:step',
  'ai:agent:tool-call',
  'ai:agent:tool-result',
  'memory-stats',
])

function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

function on(channel: string, callback: (...args: any[]) => void): () => void {
  // Unknown channels are refused, but never crash the renderer over a
  // subscription: a missing event should degrade to "no updates", not a
  // blank window.
  if (!EVENT_CHANNELS.has(channel)) {
    console.warn(`Refused unknown event channel: ${channel}`)
    return () => undefined
  }
  const subscription = (_event: unknown, ...args: any[]) => callback(...args)
  ipcRenderer.on(channel, subscription)
  return () => ipcRenderer.removeListener(channel, subscription)
}

const tab = {
  create: (url?: string) => invoke<string>('tab:create', url),
  close: (id: string) => invoke<string | null>('tab:close', id),
  setActive: (id: string) => invoke<void>('tab:set-active', id),
  getAll: () => invoke<any[]>('tab:get-all'),
  navigate: (id: string, url: string) => invoke<void>('tab:navigate', id, url),
  setWebContents: (id: string, webContentsId: number) => invoke<void>('tab:set-web-contents', id, webContentsId),
  back: () => invoke<void>('tab:back'),
  forward: () => invoke<void>('tab:forward'),
  reload: () => invoke<void>('tab:reload'),
  stop: () => invoke<void>('tab:stop'),
  forceReload: () => invoke<void>('tab:force-reload'),
  devtools: () => invoke<void>('tab:devtools'),
  duplicate: (id: string) => invoke<string | null>('tab:duplicate', id),
  pin: (id: string) => invoke<boolean>('tab:pin', id),
  mute: (id: string) => invoke<boolean>('tab:mute', id),
  reorder: (fromIndex: number, toIndex: number) => invoke<void>('tab:reorder', fromIndex, toIndex),
  reopenClosed: () => invoke<string | null>('tab:reopen-closed'),
  getClosed: () => invoke<any[]>('tab:get-closed'),
  setZoom: (id: string, factor: number) => invoke<void>('tab:set-zoom', id, factor),
  getZoom: (id: string) => invoke<number>('tab:get-zoom', id),
  findInPage: (id: string, text: string, options?: { forward?: boolean; findNext?: boolean }) =>
    invoke<any>('tab:find-in-page', id, text, options),
  stopFinding: (id: string, action: 'clear' | 'keep' | 'activate') => invoke<void>('tab:stop-finding', id, action),
  print: (id: string) => invoke<void>('tab:print', id),
  viewSource: (id: string) => invoke<string | null>('tab:view-source', id),
  fullscreen: () => invoke<void>('tab:fullscreen'),
}

const downloads = {
  get: () => invoke<any[]>('downloads:get'),
  pause: (id: string) => invoke<boolean>('downloads:pause', id),
  resume: (id: string) => invoke<boolean>('downloads:resume', id),
  cancel: (id: string) => invoke<boolean>('downloads:cancel', id),
  remove: (id: string) => invoke<void>('downloads:remove', id),
  open: (id: string) => invoke<void>('downloads:open', id),
  showInFolder: (id: string) => invoke<void>('downloads:show-in-folder', id),
  retry: (id: string) => invoke<boolean>('downloads:retry', id),
  clear: () => invoke<void>('downloads:clear'),
  getPath: () => invoke<string>('downloads:get-path'),
  setPath: (directory: string) => invoke<void>('downloads:set-path', directory),
}

const settings = {
  get: () => invoke<any>('settings:get'),
  set: (patch: Record<string, unknown>) => invoke<any>('settings:set', patch),
}

const history = {
  get: () => invoke<any[]>('history:get'),
  add: (url: string, title: string) => invoke<void>('history:add', url, title),
  remove: (id: number) => invoke<void>('history:delete', id),
  clear: (options?: { since?: number }) => invoke<void>('history:clear', options),
}

const bookmarks = {
  get: () => invoke<any[]>('bookmarks:get'),
  add: (bookmark: { title: string; url: string; folderId?: string }) => invoke<any>('bookmarks:add', bookmark),
  addFolder: (title: string, parentId?: string) => invoke<any>('bookmarks:add-folder', title, parentId),
  update: (id: string, updates: { title?: string; url?: string }) => invoke<any>('bookmarks:update', id, updates),
  remove: (id: string) => invoke<void>('bookmarks:delete', id),
  move: (id: string, parentId: string, index?: number) => invoke<any>('bookmarks:move', id, parentId, index),
  import: (html: string) => invoke<{ imported: number }>('bookmarks:import', html),
  export: () => invoke<string>('bookmarks:export'),
}

const permissions = {
  respond: (id: string, decision: 'grant' | 'deny', remember: boolean) =>
    invoke<boolean>('permission:respond', id, decision, remember),
  getDecisions: () => invoke<Record<string, 'grant' | 'deny'>>('permission:get-decisions'),
  clear: (origin?: string) => invoke<void>('permission:clear', origin),
}

const windowApi = {
  create: (options?: { private?: boolean; url?: string }) => invoke<number>('window:create', options),
  close: () => invoke<void>('window:close'),
  minimize: () => invoke<void>('window:minimize'),
  maximize: () => invoke<void>('window:maximize'),
  isMaximized: () => invoke<boolean>('window:is-maximized'),
  getInfo: () => invoke<{ id: number; isPrivate: boolean; partition: string }>('window:info'),
}

const ai = {
  getConfig: () => invoke<any>('ai:config:get'),
  updateConfig: (updates: any) => invoke<any>('ai:config:update', updates),
  getProviders: () => invoke<any[]>('ai:providers:list'),
  addProvider: (config: any, apiKeys?: string[]) => invoke<any>('ai:provider:add', config, apiKeys),
  removeProvider: (id: string) => invoke<any>('ai:provider:remove', id),
  testProvider: (id: string, apiKeys?: string[]) => invoke<{ success: boolean; error?: string }>('ai:provider:test', id, apiKeys),
  setApiKeys: (providerId: string, apiKeys: string[]) =>
    invoke<any>('ai:provider:set-keys', providerId, apiKeys),
  addApiKey: (providerId: string, apiKey: string) =>
    invoke<any>('ai:provider:add-key', providerId, apiKey),
  removeApiKey: (providerId: string, keyIndex: number) =>
    invoke<any>('ai:provider:remove-key', providerId, keyIndex),
  getMaskedKeys: (providerId: string) =>
    invoke<string[]>('ai:provider:get-masked-keys', providerId),
  getKeyCount: (providerId: string) =>
    invoke<number>('ai:provider:key-count', providerId),
  getModels: () => invoke<any[]>('ai:models:list'),
  getModelsForProvider: (providerId: string) => invoke<any[]>('ai:models:for-provider', providerId),
  getModelSlots: () => invoke<Record<string, string>>('ai:model-slot:get-all'),
  setModelSlot: (slot: string, modelId: string) => invoke<any>('ai:model-slot:set', slot, modelId),
  getModelSlot: (slot: string) => invoke<string>('ai:model-slot:get', slot),
  getModelForSlot: (slot: string) => invoke<any>('ai:model-slot:get-model', slot),
  getProviderTypes: () => invoke<string[]>('ai:provider-types'),
  discoverModels: (type: string, baseUrl: string, apiKey?: string) => invoke<any[]>('ai:models:discover', type, baseUrl, apiKey),
  addProviderAuto: (params: { type: string; name: string; baseUrl: string; apiKey?: string }) => invoke<any>('ai:provider:add-auto', params),
  getSystemPrompt: () => invoke<string>('ai:system-prompt:get'),
  setSystemPrompt: (prompt: string) => invoke<any>('ai:system-prompt:set', prompt),
  chatComplete: (request: any) => invoke<any>('ai:chat:complete', request),
  chatStream: (request: any, requestId: string) => invoke<any>('ai:chat:stream', request, requestId),
  cancelChat: () => invoke<void>('ai:chat:cancel'),
  onStreamChunk: (callback: (payload: { requestId: string; chunk: any }) => void) => on('ai:stream-chunk', callback),
  extractPage: (tabId: string) => invoke<any>('ai:extract-page', tabId),
  getTabsContext: (tabIds: string[]) => invoke<string>('ai:get-tabs-context', tabIds),
  contextRetrieve: (query: string, tabIds?: string[]) => invoke<any>('ai:context:retrieve', query, tabIds),
  contextFormat: (query: string, tabIds?: string[]) => invoke<string>('ai:context:format', query, tabIds),
  contextIngest: (tabId: string) => invoke<void>('ai:context:ingest', tabId),
  getUsage: (providerId?: string, since?: number) => invoke<any[]>('ai:usage', providerId, since),
  getTotalUsage: (since?: number) => invoke<any>('ai:usage-total', since),
  // Agent
  getAgentTools: () => invoke<any[]>('ai:agent:tools'),
  runAgent: (request: any, context: any) => invoke<any>('ai:agent:run', request, context),
  approveTool: (toolCallId: string, approved: boolean) => invoke<any>('ai:agent:approve', toolCallId, approved),
  onAgentStep: (callback: (step: any) => void) => on('ai:agent:step', callback),
  onAgentToolCall: (callback: (payload: { toolCall: any; preview: string; requiresApproval: boolean }) => void) => on('ai:agent:tool-call', callback),
}

const memory = {
  getConfig: () => invoke<any>('memory:config:get'),
  setConfig: (patch: any) => invoke<any>('memory:config:set', patch),
  check: () => invoke<any>('memory:check'),
  getDiscardedTabs: () => invoke<any[]>('memory:discarded-tabs'),
  isTabDiscarded: (tabId: string) => invoke<boolean>('tab:is-discarded', tabId),
  onStats: (callback: (stats: any) => void) => on('memory-stats', callback),
}

const context = {
  getState: () => invoke<any>('context:get-state'),
  extract: (selection: any, options?: any) => invoke<any>('context:extract', selection, options),
  preview: (question: string, tabIds?: string[], maxChunks?: number) =>
    invoke<any>('context:preview', question, tabIds, maxChunks),
  ask: (payloadHash: string) => invoke<any>('context:ask', payloadHash),
  setExclusions: (hosts: string[]) => invoke<any>('context:set-exclusions', hosts),
  setPrivateSession: (enabled: boolean) => invoke<any>('context:set-private-session', enabled),
  clearPrivate: () => invoke<any>('context:clear-private'),
  clear: () => invoke<any>('context:clear'),
  removeItem: (itemId: string) => invoke<any>('context:remove-item', itemId),
  removeTab: (tabId: string) => invoke<any>('context:remove-tab', tabId),
  getItemText: (itemId: string) => invoke<any>('context:get-item-text', itemId),
  screenshot: (tabId: string) => invoke<any>('context:screenshot', tabId),
  markTabPrivate: (tabId: string, isPrivate: boolean) => invoke<any>('context:mark-tab-private', tabId, isPrivate),
}

const security = {
  checkUrl: (url: string) => invoke<{ safe: boolean; threatType?: string }>('security:check-url', url),
  checkPassword: (password: string) => invoke<{ breached: boolean; count: number }>('security:check-password', password),
  refreshAdBlock: () => invoke<{ success: boolean }>('security:refresh-adblock'),
}

const appApi = {
  getInfo: () => invoke<any>('app:info'),
  openExternal: (url: string) => invoke<void>('app:open-external', url),
  clearBrowsingData: (options?: { history?: boolean; cookies?: boolean; cache?: boolean; permissions?: boolean }) =>
    invoke<boolean>('privacy:clear-data', options),
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Namespaced API
  tab,
  downloads,
  settings,
  history,
  bookmarks,
  permissions,
  window: windowApi,
  ai,
  memory,
  context,
  security,
  app: appApi,

  // Backwards-compatible flat aliases used by older components.
  createTab: tab.create,
  closeTab: tab.close,
  setActiveTab: tab.setActive,
  getTabs: tab.getAll,
  setUrl: tab.navigate,
  setTabWebContents: tab.setWebContents,
  back: tab.back,
  forward: tab.forward,
  reload: tab.reload,
  stop: tab.stop,
  duplicateTab: tab.duplicate,
  pinTab: tab.pin,
  muteTab: tab.mute,
  reorderTab: tab.reorder,
  reopenClosedTab: tab.reopenClosed,
  getClosedTabs: tab.getClosed,
  setTabZoom: tab.setZoom,
  getTabZoom: tab.getZoom,
  findInPage: tab.findInPage,
  stopFinding: tab.stopFinding,
  print: tab.print,
  fullscreen: tab.fullscreen,
  getHistory: history.get,
  addHistory: history.add,
  deleteHistoryEntry: history.remove,
  clearHistory: history.clear,
  getBookmarks: bookmarks.get,
  addBookmark: bookmarks.add,
  addBookmarkFolder: bookmarks.addFolder,
  updateBookmark: bookmarks.update,
  deleteBookmark: bookmarks.remove,
  moveBookmark: bookmarks.move,
  importBookmarks: bookmarks.import,
  exportBookmarks: bookmarks.export,
  getDownloads: downloads.get,
  pauseDownload: downloads.pause,
  resumeDownload: downloads.resume,
  cancelDownload: downloads.cancel,
  removeDownload: downloads.remove,
  openDownload: downloads.open,
  showDownloadInFolder: downloads.showInFolder,
  retryDownload: downloads.retry,
  clearDownloads: downloads.clear,
  getDownloadPath: downloads.getPath,
  setDownloadPath: downloads.setPath,
  createWindow: windowApi.create,
  closeWindow: windowApi.close,
  minimizeWindow: windowApi.minimize,
  maximizeWindow: windowApi.maximize,
  isMaximized: windowApi.isMaximized,

  on,
  ready: () => invoke('app:info'),
})
