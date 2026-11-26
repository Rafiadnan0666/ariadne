import type {
  ContextSelection,
  ExtractionBatchResult,
  PickerState,
  PreviewResult,
  QAAnswer,
} from '../context/types'
import type React from 'react'
import type {
  AppInfoDTO,
  AppSettingsDTO,
  BookmarkDTO,
  DownloadDTO,
  HistoryEntryDTO,
  ModelInfoDTO,
  ProviderConfigDTO,
  SearchEngineDTO,
  StreamChunkDTO,
  TabDTO,
} from './types'

export {}

declare global {
  interface Window {
    electronAPI: {
      tab: {
        create: (url?: string) => Promise<string>
        close: (id: string) => Promise<string | null>
        setActive: (id: string) => Promise<void>
        getAll: () => Promise<TabDTO[]>
        navigate: (id: string, url: string) => Promise<void>
        setWebContents: (id: string, webContentsId: number) => Promise<void>
        back: () => Promise<void>
        forward: () => Promise<void>
        reload: () => Promise<void>
        stop: () => Promise<void>
        forceReload: () => Promise<void>
        devtools: () => Promise<void>
        duplicate: (id: string) => Promise<string | null>
        pin: (id: string) => Promise<boolean>
        mute: (id: string) => Promise<boolean>
        reorder: (fromIndex: number, toIndex: number) => Promise<void>
        reopenClosed: () => Promise<string | null>
        getClosed: () => Promise<Array<{ id: string; url: string; title: string }>>
        setZoom: (id: string, factor: number) => Promise<void>
        getZoom: (id: string) => Promise<number>
        findInPage: (
          id: string,
          text: string,
          options?: { forward?: boolean; findNext?: boolean }
        ) => Promise<{ requestId: number; activeMatchOrdinal: number; matches: number }>
        stopFinding: (id: string, action: 'clear' | 'keep' | 'activate') => Promise<void>
        print: (id: string) => Promise<void>
        viewSource: (id: string) => Promise<string | null>
        fullscreen: () => Promise<void>
      }
      downloads: {
        get: () => Promise<DownloadDTO[]>
        pause: (id: string) => Promise<boolean>
        resume: (id: string) => Promise<boolean>
        cancel: (id: string) => Promise<boolean>
        remove: (id: string) => Promise<void>
        open: (id: string) => Promise<void>
        showInFolder: (id: string) => Promise<void>
        retry: (id: string) => Promise<boolean>
        clear: () => Promise<void>
        getPath: () => Promise<string>
        setPath: (directory: string) => Promise<void>
      }
      settings: {
        get: () => Promise<AppSettingsDTO & { searchEngines: SearchEngineDTO[] }>
        set: (patch: Partial<AppSettingsDTO>) => Promise<AppSettingsDTO>
      }
      history: {
        get: () => Promise<HistoryEntryDTO[]>
        add: (url: string, title: string) => Promise<void>
        remove: (id: number) => Promise<void>
        clear: (options?: { since?: number }) => Promise<void>
      }
      bookmarks: {
        get: () => Promise<BookmarkDTO[]>
        add: (bookmark: { title: string; url: string; folderId?: string }) => Promise<BookmarkDTO>
        addFolder: (title: string, parentId?: string) => Promise<BookmarkDTO>
        update: (id: string, updates: { title?: string; url?: string }) => Promise<BookmarkDTO | null>
        remove: (id: string) => Promise<void>
        move: (id: string, parentId: string, index?: number) => Promise<BookmarkDTO | null>
        import: (html: string) => Promise<{ imported: number }>
        export: () => Promise<string>
      }
      permissions: {
        respond: (id: string, decision: 'grant' | 'deny', remember: boolean) => Promise<boolean>
        getDecisions: () => Promise<Record<string, 'grant' | 'deny'>>
        clear: (origin?: string) => Promise<void>
      }
      window: {
        create: (options?: { private?: boolean; url?: string }) => Promise<number>
        close: () => Promise<void>
        minimize: () => Promise<void>
        maximize: () => Promise<void>
        isMaximized: () => Promise<boolean>
        getInfo: () => Promise<{ id: number; isPrivate: boolean; partition: string }>
      }
      ai: {
        getConfig: () => Promise<any>
        updateConfig: (updates: any) => Promise<any>
        getProviders: () => Promise<ProviderConfigDTO[]>
        addProvider: (config: any, apiKeys?: string[]) => Promise<any>
        removeProvider: (id: string) => Promise<any>
        testProvider: (id: string, apiKeys?: string[]) => Promise<{ success: boolean; error?: string }>
        setApiKeys: (providerId: string, apiKeys: string[]) => Promise<any>
        addApiKey: (providerId: string, apiKey: string) => Promise<any>
        removeApiKey: (providerId: string, keyIndex: number) => Promise<any>
        getMaskedKeys: (providerId: string) => Promise<string[]>
        getKeyCount: (providerId: string) => Promise<number>
        getModels: () => Promise<ModelInfoDTO[]>
        getModelsForProvider: (providerId: string) => Promise<ModelInfoDTO[]>
        getModelSlots: () => Promise<Record<string, string>>
        setModelSlot: (slot: string, modelId: string) => Promise<any>
        getModelSlot: (slot: string) => Promise<string>
        getModelForSlot: (slot: string) => Promise<ModelInfoDTO | null>
        getProviderTypes: () => Promise<string[]>
        getSystemPrompt: () => Promise<string>
        setSystemPrompt: (prompt: string) => Promise<any>
        chatComplete: (request: any) => Promise<any>
        chatStream: (request: any, requestId: string) => Promise<any>
        cancelChat: () => Promise<void>
        onStreamChunk: (callback: (payload: { requestId: string; chunk: StreamChunkDTO }) => void) => () => void
        extractPage: (tabId: string) => Promise<any>
        getTabsContext: (tabIds: string[]) => Promise<string>
        contextRetrieve: (query: string, tabIds?: string[]) => Promise<any>
        contextFormat: (query: string, tabIds?: string[]) => Promise<string>
        contextIngest: (tabId: string) => Promise<void>
        getUsage: (providerId?: string, since?: number) => Promise<any[]>
        getTotalUsage: (since?: number) => Promise<any>
        getAgentTools: () => Promise<any[]>
        runAgent: (request: any, context: { tabId: string; windowId?: number }) => Promise<any>
        approveTool: (toolCallId: string, approved: boolean) => Promise<any>
        onAgentStep: (
          callback: (step: { type: 'plan' | 'execute' | 'observe'; content: string }) => void
        ) => () => void
        onAgentToolCall: (
          callback: (payload: { toolCall: any; preview: string; requiresApproval: boolean }) => void
        ) => () => void
      }
      memory: {
        getConfig: () => Promise<any>
        setConfig: (patch: any) => Promise<any>
        check: () => Promise<any>
        getDiscardedTabs: () => Promise<any[]>
        isTabDiscarded: (tabId: string) => Promise<boolean>
        onStats: (callback: (stats: { totalMB: number; budgetMB: number; heapUsedMB: number }) => void) => () => void
      }
      context: {
        getState: () => Promise<PickerState>
        extract: (
          selection: ContextSelection,
          options?: { force?: boolean; selectedTextByTab?: Record<string, string> }
        ) => Promise<ExtractionBatchResult>
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
      app: {
        getInfo: () => Promise<AppInfoDTO>
        openExternal: (url: string) => Promise<void>
        clearBrowsingData: (options?: {
          history?: boolean
          cookies?: boolean
          cache?: boolean
          permissions?: boolean
        }) => Promise<boolean>
      }
      on: (channel: string, callback: (...args: any[]) => void) => () => void
      ready: () => Promise<unknown>
    }
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        partition?: string
        allowpopups?: string
        useragent?: string
      }
    }
  }
}
