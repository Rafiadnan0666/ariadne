export interface TabDTO {
  id: string
  url: string
  title: string
  active: boolean
  isPrivate?: boolean
  pinned?: boolean
  muted?: boolean
  loading?: boolean
  favicon?: string
  zoomFactor?: number
  canGoBack?: boolean
  canGoForward?: boolean
  crashed?: boolean
  audioPlaying?: boolean
}

export interface DownloadDTO {
  id: string
  url: string
  filename: string
  totalBytes: number
  receivedBytes: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  startTime: number
  endTime?: number
  mimeType?: string
  filePath?: string
  canResume: boolean
  paused?: boolean
  isDangerous?: boolean
  isPrivate?: boolean
}

export interface BookmarkDTO {
  id: string
  title: string
  url: string
  folderId?: string
  parentId?: string
  isFolder: boolean
  dateAdded: number
  dateModified?: number
}

export interface HistoryEntryDTO {
  id: number
  url: string
  title: string
  visitedAt: number
}

export interface AppSettingsDTO {
  theme: 'dark' | 'light' | 'system'
  accentColor: string
  density: 'compact' | 'normal' | 'comfortable'
  showBookmarksBar: boolean
  homePage: string
  defaultSearchEngine: string
  searchSuggestions: boolean
  doNotTrack: boolean
  clearOnExit: boolean
  downloadPath: string
  aiSidebarOpen: boolean
}

export interface SearchEngineDTO {
  id: string
  name: string
  url: string
  keyword: string
}

export interface ModelInfoDTO {
  id: string
  name: string
  provider: string
  capabilities: {
    contextWindow: number
    supportsVision: boolean
    supportsTools: boolean
    supportsStreaming: boolean
    maxOutputTokens?: number
  }
}

export interface ProviderConfigDTO {
  id: string
  name: string
  type: string
  baseUrl?: string
  enabled: boolean
  models: ModelInfoDTO[]
  defaultModel?: string
}

export interface AppInfoDTO {
  appName: string
  appVersion: string
  electron: string
  chrome: string
  node: string
  v8: string
  platform: string
  arch: string
}

export interface StreamChunkDTO {
  choices?: Array<{ delta?: { content?: string }; finishReason?: string }>
  usage?: unknown
}

export interface AddressSuggestion {
  kind: 'search' | 'url' | 'history' | 'bookmark' | 'tab'
  label: string
  detail?: string
  value: string
  tabId?: string
}
