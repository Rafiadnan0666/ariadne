import { app, ipcMain, BrowserWindow, webContents, session } from 'electron'
import { init as initTabs, createTab, closeTab, setActiveTab, setUrl, getHistory, addHistory, getTabs, setTabWebContents, setTabTitle, TabState } from './tabs'
import { aiSystem } from './ai'
import * as path from 'path'

let mainWindow: BrowserWindow | null = null

app.whenReady().then(async () => {
  initTabs()

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

  // Initialize AI system
  await aiSystem.getRegistry().initialize()

  // Core app IPC
  ipcMain.handle('app:ready', async () => {
    return { version: app.getVersion(), platform: process.platform }
  })

  // Tab IPC
  ipcMain.handle('tab:create', async (_e, url?: string) => {
    const id = await createTab(url)
    const tab = getTabs().find(t => t.id === id)
    if (tab) {
      aiSystem.registerTab(id, 0, tab.url, tab.title, tab.isPrivate || false)
    }
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
    // Navigating away invalidates the old page context for this tab.
    aiSystem.unregisterTab(id)
    return setUrl(id, url)
  })

  // Track webContents for each tab
  ipcMain.handle('tab:set-web-contents', async (_e, id: string, webContentsId: number) => {
    setTabWebContents(id, webContentsId)
    const tab = getTabs().find(t => t.id === id)
    if (tab) {
      aiSystem.registerTab(id, webContentsId, tab.url, tab.title, tab.isPrivate || false)
    }
  })

  // WebContents event tracking
  if (mainWindow) {
    mainWindow.webContents.on('did-navigate', (_event, url) => {
      const activeTab = getTabs().find(t => t.active)
      if (activeTab && activeTab.webContentsId) {
        aiSystem.registerTab(activeTab.id, activeTab.webContentsId, url, activeTab.title || 'Untitled', activeTab.isPrivate || false)
      }
    })

    mainWindow?.webContents.on('page-title-updated', (_event, title) => {
      const activeTab = getTabs().find(t => t.active)
      if (activeTab && activeTab.webContentsId && mainWindow) {
        setTabTitle(activeTab.id, title)
        aiSystem.registerTab(activeTab.id, activeTab.webContentsId, activeTab.url, title, activeTab.isPrivate || false)
        mainWindow.webContents.send('url-changed', activeTab.id, activeTab.url, title)
      }
    })

    mainWindow.webContents.on('did-finish-load', () => {
      const activeTab = getTabs().find(t => t.active)
      if (activeTab && activeTab.webContentsId) {
        aiSystem.registerTab(activeTab.id, activeTab.webContentsId, activeTab.url, activeTab.title || 'Untitled', activeTab.isPrivate || false)
      }
    })
  }

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

  // History IPC
  ipcMain.handle('history:get', async () => {
    return getHistory()
  })

  ipcMain.handle('history:add', async (_e, url: string, title: string) => {
    return addHistory(url, title)
  })

  // Download IPC
  ipcMain.handle('download:begin', async (_e, item, webContents) => {
    return true
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

  // Cross-tab context IPC (replaces old context:* namespace)
  // These are now handled by ai:* namespace:
  // ai:context:retrieve, ai:context:format, ai:context:ingest
  // Page extraction: ai:extract-page, ai:get-tabs-context

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
        
        // Emit to renderer via webContents
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
      return { action: 'deny' }
    })
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
})

app.on('window-all-closed', () => {
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
  await aiSystem.shutdown()
})

app.commandLine.appendSwitch('disable-gpu')