import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Tab management
  createTab: (url?: string) => ipcRenderer.invoke('tab:create', url),
  closeTab: (id: string) => ipcRenderer.invoke('tab:close', id),
  setActiveTab: (id: string) => ipcRenderer.invoke('tab:set-active', id),
  getTabs: () => ipcRenderer.invoke('tab:get-all'),
  setUrl: (id: string, url: string) => ipcRenderer.invoke('tab:url', id, url),
  back: () => ipcRenderer.invoke('tab:back'),
  forward: () => ipcRenderer.invoke('tab:forward'),
  reload: () => ipcRenderer.invoke('tab:reload'),
  stop: () => ipcRenderer.invoke('tab:stop'),
  getHistory: () => ipcRenderer.invoke('history:get'),
  addHistory: (url: string, title: string) => ipcRenderer.invoke('history:add', url, title),

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

    // Usage
    getUsage: (providerId?: string, since?: number) => ipcRenderer.invoke('ai:usage', providerId, since),
    getTotalUsage: (since?: number) => ipcRenderer.invoke('ai:usage-total', since),
  },

  // Events
  on: (channel: string, callback: (...args: any[]) => void) => {
    const subscription = (_event: any, ...args: any[]) => callback(...args)
    ipcRenderer.on(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  },
  ready: () => ipcRenderer.invoke('app:ready')
})