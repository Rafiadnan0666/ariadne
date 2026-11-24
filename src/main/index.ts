import { app, ipcMain, BrowserWindow } from 'electron'
import { init as initTabs, createTab, closeTab, setActiveTab, setUrl, getHistory, addHistory, getTabs } from './tabs'
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
    return createTab(url)
  })

  ipcMain.handle('tab:close', async (_e, id: string) => {
    return closeTab(id)
  })

  ipcMain.handle('tab:set-active', async (_e, id: string) => {
    return setActiveTab(id)
  })

  ipcMain.handle('tab:get-all', async () => {
    return getTabs()
  })

  ipcMain.handle('tab:url', async (_e, id: string, url: string) => {
    return setUrl(id, url)
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

  ipcMain.handle('ai:chat:stream', async (_e, request) => {
    // For streaming, we use a different pattern - return chunks via callback
    // This is simplified; real implementation would use event emitter
    throw new Error('Use ai:chat:stream-events for streaming')
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