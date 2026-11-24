import type {
  ContextSelection,
  ExtractionBatchResult,
  PickerState,
  PreviewResult,
  QAAnswer,
} from '../context/types'

export {}

declare global {
  interface Window {
    electronAPI: {
      // Tab management
      createTab: (url?: string) => Promise<string>
      closeTab: (id: string) => Promise<void>
      setActiveTab: (id: string) => Promise<void>
      getTabs: () => Promise<any[]>
      setUrl: (id: string, url: string) => Promise<void>
      back: () => Promise<void>
      forward: () => Promise<void>
      reload: () => Promise<void>
      stop: () => Promise<void>
      getHistory: () => Promise<any[]>
      addHistory: (url: string, title: string) => Promise<void>

      // AI Provider management
      ai: {
        getConfig: () => Promise<any>
        updateConfig: (updates: any) => Promise<any>
        getProviders: () => Promise<any[]>
        addProvider: (config: any, apiKey?: string) => Promise<any>
        removeProvider: (id: string) => Promise<any>
        testProvider: (id: string, apiKey?: string) => Promise<{ success: boolean; error?: string }>
        setApiKey: (providerId: string, keyName: string, apiKey: string) => Promise<any>
        getMaskedKey: (providerId: string, keyName: string) => Promise<string | null>
        getModels: () => Promise<any[]>
        getModelSlots: () => Promise<Record<string, string>>
        setModelSlot: (slot: string, modelId: string) => Promise<any>
        getModelForSlot: (slot: string) => Promise<any>
        getProviderTypes: () => Promise<string[]>
        getSystemPrompt: () => Promise<string>
        setSystemPrompt: (prompt: string) => Promise<any>

        // Chat
        chat: (request: any) => Promise<any>
        chatStream: (request: any) => Promise<any>
        onStreamChunk: (callback: (chunk: any) => void) => () => void

        // Page extraction
        extractPage: (tabId: string) => Promise<any>
        getTabsContext: (tabIds: string[]) => Promise<string>

        // Usage tracking
        getUsage: (providerId?: string, since?: number) => Promise<any[]>
        getTotalUsage: (since?: number) => Promise<any>
      }

      // Cross-tab context (Session C)
      context: {
        getState: () => Promise<PickerState>
        extract: (selection: ContextSelection, options?: { force?: boolean; selectedTextByTab?: Record<string, string> }) => Promise<ExtractionBatchResult>
        preview: (question: string, tabIds?: string[], maxChunks?: number) => Promise<PreviewResult>
        ask: (payloadHash: string) => Promise<QAAnswer>
        setExclusions: (hosts: string[]) => Promise<PickerState>
        setPrivateSession: (enabled: boolean) => Promise<PickerState>
        clearPrivate: () => Promise<PickerState>
        clear: () => Promise<PickerState>
        removeItem: (itemId: string) => Promise<PickerState>
        removeTab: (tabId: string) => Promise<PickerState>
        getItemText: (itemId: string) => Promise<{ id: string; text: string; selectedText?: string } | null>
        screenshot: (tabId: string) => Promise<{
          dataUrl: string
          url: string
          title: string
          width: number
          height: number
          isPrivate: boolean
          timestamp: number
        } | null>
        markTabPrivate: (tabId: string, isPrivate: boolean) => Promise<PickerState>
      }

      on: (channel: string, callback: (...args: any[]) => void) => () => void
      ready: () => Promise<any>
    }
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: any
    }
  }
}