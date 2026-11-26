import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ModelInfoDTO, ProviderConfigDTO, TabDTO } from '../../types'
import { Icon } from '../Icon'

type ModelSlot = 'fastBrowsing' | 'research' | 'reasoning' | 'coding' | 'verification'

const SLOTS: Array<{ id: ModelSlot; label: string; hint: string }> = [
  { id: 'fastBrowsing', label: 'Fast', hint: 'Quick lookups and summaries' },
  { id: 'research', label: 'Research', hint: 'Cross-tab reading and synthesis' },
  { id: 'reasoning', label: 'Reasoning', hint: 'Harder analysis' },
  { id: 'coding', label: 'Coding', hint: 'Code and developer tasks' },
  { id: 'verification', label: 'Verify', hint: 'Check claims against sources' },
]

interface PageContext {
  url: string
  title: string
  readableText: string
  selectedText?: string
  headings: Array<{ level: number; text: string }>
  metadata: Record<string, string>
  links: Array<{ url: string; text: string; title?: string }>
  timestamp: number
  tabId: string
  isPrivate: boolean
}

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface AgentToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface AgentStep {
  type: 'plan' | 'execute' | 'observe'
  content: string
}

interface ToolResult {
  success: boolean
  result?: unknown
  error?: string
  requiresApproval?: boolean
  preview?: string
}

interface PendingToolCall {
  toolCall: ToolCall
  preview: string
  requiresApproval: boolean
  resolve: (approved: boolean) => void
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  streaming?: boolean
  stopped?: boolean
  error?: string
  sources?: Array<{ tabId: string; url: string; title: string }>
  toolCalls?: ToolCall[]
  toolResults?: Array<{ toolCallId: string; success: boolean; result?: unknown; error?: string }>
}

interface ChatSidebarProps {
  isOpen: boolean
  onClose: () => void
  activeTab: TabDTO | null
  isPrivate: boolean
  width: number
  onOpenTab: (tabId: string) => void
  onOpenContext: () => void
  onOpenSettings: () => void
  notify: (message: string, type?: 'info' | 'success' | 'error' | 'warning') => void
}

interface ProviderForm {
  type: string
  name: string
  baseUrl: string
  modelId: string
  modelName: string
  contextWindow: string
  apiKey: string
}

const EMPTY_PROVIDER_FORM: ProviderForm = {
  type: 'openai',
  name: '',
  baseUrl: '',
  modelId: '',
  modelName: '',
  contextWindow: '128000',
  apiKey: '',
}

const TYPE_DEFAULTS: Record<string, { name: string; baseUrl: string }> = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  anthropic: { name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  '9router': { name: '9Router', baseUrl: 'https://api.9router.com/v1' },
  lmstudio: { name: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1' },
}

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isNewTab(url?: string): boolean {
  return !url || url === 'about:blank' || url === 'ariadne://newtab'
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
  isOpen,
  onClose,
  activeTab,
  isPrivate,
  width,
  onOpenTab,
  onOpenContext,
  onOpenSettings,
  notify,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [models, setModels] = useState<ModelInfoDTO[]>([])
  const [slots, setSlots] = useState<Record<ModelSlot, string>>({
    fastBrowsing: '',
    research: '',
    reasoning: '',
    coding: '',
    verification: '',
  })
  const [providers, setProviders] = useState<ProviderConfigDTO[]>([])
  const [providerTypes, setProviderTypes] = useState<string[]>(['openai', 'anthropic', '9router', 'lmstudio'])
  const [systemPrompt, setSystemPrompt] = useState('')
  const [promptDraft, setPromptDraft] = useState('')
  const [promptSaved, setPromptSaved] = useState(true)
  const [selectedSlot, setSelectedSlot] = useState<ModelSlot>('fastBrowsing')
  const [pageContext, setPageContext] = useState<PageContext | null>(null)
  const [includePage, setIncludePage] = useState(true)
  const [extractState, setExtractState] = useState<'idle' | 'loading' | 'ready' | 'error' | 'private' | 'empty'>('idle')
  const [extractError, setExtractError] = useState('')
  const [extractNonce, setExtractNonce] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [showProviderForm, setShowProviderForm] = useState(false)
  const [showAutoConfig, setShowAutoConfig] = useState(false)
  const [autoConfig, setAutoConfig] = useState({
    type: 'openai',
    name: '',
    baseUrl: '',
    apiKey: '',
  })
  const [autoConfigBusy, setAutoConfigBusy] = useState(false)
  const [discoveredModels, setDiscoveredModels] = useState<ModelInfoDTO[]>([])
  const [discoverBusy, setDiscoverBusy] = useState(false)
  const [providerForm, setProviderForm] = useState<ProviderForm>(EMPTY_PROVIDER_FORM)
  const [providerBusy, setProviderBusy] = useState(false)
  const [providerStatus, setProviderStatus] = useState<Record<string, string>>({})
  const [settingsError, setSettingsError] = useState('')
  const providerFormRef = useRef<HTMLDivElement>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const activeRequestRef = useRef<string | null>(null)

  // Agent state
  const [agentMode, setAgentMode] = useState(false)
  const [agentTools, setAgentTools] = useState<AgentToolDefinition[]>([])
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([])
  const [agentRunning, setAgentRunning] = useState(false)
  const [pendingToolCall, setPendingToolCall] = useState<PendingToolCall | null>(null)
  const [pendingToolCalls, setPendingToolCalls] = useState<PendingToolCall[]>([])
  const messagesRef = useRef<ChatMessage[]>([])

  messagesRef.current = messages

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const refreshAi = useCallback(async () => {
    try {
      const [modelsData, slotsData, providersData, prompt, types] = await Promise.all([
        window.electronAPI.ai.getModels(),
        window.electronAPI.ai.getModelSlots(),
        window.electronAPI.ai.getProviders(),
        window.electronAPI.ai.getSystemPrompt(),
        window.electronAPI.ai.getProviderTypes(),
      ])
      setModels(modelsData)
      setSlots({
        fastBrowsing: slotsData.fastBrowsing || '',
        research: slotsData.research || '',
        reasoning: slotsData.reasoning || '',
        coding: slotsData.coding || '',
        verification: slotsData.verification || '',
      })
      setProviders(providersData)
      setSystemPrompt(prompt)
      setPromptDraft((draft) => (promptSaved ? prompt : draft))
      setProviderTypes(types.filter((type) => type !== 'custom'))
      const preferred = (['fastBrowsing', 'research', 'reasoning', 'coding', 'verification'] as ModelSlot[]).find(
        (slot) => slotsData[slot]
      )
      if (preferred) setSelectedSlot((current) => (slotsData[current] ? current : preferred))
    } catch (error) {
      setSettingsError(`Could not load AI settings: ${errorText(error)}`)
    }
  }, [promptSaved])

  useEffect(() => {
    if (!isOpen) return
    void refreshAi()
    // Only reload when the panel opens or the page changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Opening the provider form must not leave it hidden below the fold.
  useEffect(() => {
    if (!showProviderForm) return
    const timer = window.setTimeout(() => {
      providerFormRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 40)
    return () => window.clearTimeout(timer)
  }, [showProviderForm])

  // Extract the active page when it changes ------------------------------
  useEffect(() => {
    if (!isOpen || !includePage) {
      setExtractState('idle')
      return
    }
    if (!activeTab) {
      setPageContext(null)
      setExtractState('empty')
      return
    }
    if (isPrivate) {
      setPageContext(null)
      setExtractState('private')
      return
    }
    if (isNewTab(activeTab.url)) {
      setPageContext(null)
      setExtractState('empty')
      return
    }
    let cancelled = false
    setExtractState('loading')
    setExtractError('')
    window.electronAPI.ai
      .extractPage(activeTab.id)
      .then((context: PageContext | null) => {
        if (cancelled) return
        if (context && context.readableText) {
          setPageContext(context)
          setExtractState('ready')
        } else {
          setPageContext(null)
          setExtractState('error')
          setExtractError('This page has no readable text to extract.')
        }
      })
      .catch((error) => {
        if (cancelled) return
        setPageContext(null)
        setExtractState('error')
        setExtractError(errorText(error))
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, includePage, activeTab?.id, activeTab?.url, isPrivate, extractNonce])

  // Agent: load available tools
  useEffect(() => {
    if (!isOpen) return
    window.electronAPI.ai.getAgentTools().then(setAgentTools).catch(console.error)
  }, [isOpen])

  // Agent: listen for step updates
  useEffect(() => {
    if (!isOpen || !agentRunning) return
    const unsub = window.electronAPI.ai.onAgentStep((step: AgentStep) => {
      setAgentSteps((prev) => [...prev, step])
    })
    return () => unsub()
  }, [isOpen, agentRunning])

  // Agent: listen for tool calls requiring approval
  useEffect(() => {
    if (!isOpen || !agentRunning) return
    const unsub = window.electronAPI.ai.onAgentToolCall((payload: { toolCall: ToolCall; preview: string; requiresApproval: boolean }) => {
      const promise = new Promise<boolean>((resolve) => {
        setPendingToolCalls((prev) => [...prev, { toolCall: payload.toolCall, preview: payload.preview, requiresApproval: payload.requiresApproval, resolve }])
      })
    })
    return () => unsub()
  }, [isOpen, agentRunning])

  const currentModel = models.find((model) => model.id === slots[selectedSlot]) || null
  const contextWindow = currentModel?.capabilities.contextWindow || 8192
  const historyTokens = useMemo(
    () => messages.reduce((total, message) => total + Math.ceil(message.content.length / 4) + 4, 0),
    [messages]
  )
  const pageTokens = pageContext ? Math.ceil(pageContext.readableText.length / 4) : 0
  const systemTokens = Math.ceil(systemPrompt.length / 4) + 24
  const usedTokens = historyTokens + (includePage ? pageTokens : 0) + systemTokens
  const budgetRatio = Math.min(1, usedTokens / contextWindow)

  const buildRequest = useCallback(
    (text: string, history: ChatMessage[]) => {
      if (!currentModel) return null
      const chatMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
      if (systemPrompt.trim()) chatMessages.push({ role: 'system', content: systemPrompt.trim() })

      if (includePage && pageContext) {
        const reserve = Math.max(1200, Math.floor(contextWindow * 0.3))
        const available = Math.max(1200, contextWindow - reserve - historyTokens - systemTokens)
        const pageText = pageContext.readableText.slice(0, available * 4)
        chatMessages.push({
          role: 'system',
          content: [
            `The user is viewing this page in tab ${pageContext.tabId}.`,
            `Title: ${pageContext.title}`,
            `URL: ${pageContext.url}`,
            pageContext.selectedText ? `Selected text:\n${pageContext.selectedText}` : '',
            'Page text (truncated to fit the context budget):',
            pageText,
            'Answer using this page when it is relevant. Say when the page does not contain the answer.',
          ]
            .filter(Boolean)
            .join('\n\n'),
        })
      }

      for (const message of history) {
        if (!message.content.trim() || message.error) continue
        if (message.role !== 'user' && message.role !== 'assistant') continue
        chatMessages.push({ role: message.role, content: message.content })
      }
      chatMessages.push({ role: 'user', content: text })

      return {
        model: currentModel.id,
        messages: chatMessages,
        temperature: 0.7,
        stream: true,
      }
    },
    [currentModel, systemPrompt, includePage, pageContext, contextWindow, historyTokens, systemTokens]
  )

  const sendMessage = useCallback(
    async (text: string, baseMessages: ChatMessage[] = messagesRef.current) => {
      const trimmed = text.trim()
      if (!trimmed || loading) return
      if (!currentModel) {
        notify('Choose a model for this task before sending a message.', 'error')
        setShowSettings(true)
        return
      }

      const request = buildRequest(trimmed, baseMessages)
      if (!request) return

      const assistantId = uid()
      const requestId = uid()
      const userMessage: ChatMessage = { id: uid(), role: 'user', content: trimmed }
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        streaming: true,
        sources:
          includePage && pageContext
            ? [{ tabId: pageContext.tabId, title: pageContext.title, url: pageContext.url }]
            : undefined,
      }

      setMessages([...baseMessages, userMessage, assistantMessage])
      setInput('')
      setLoading(true)
      activeRequestRef.current = requestId

      const unsubscribe = window.electronAPI.ai.onStreamChunk(({ requestId: incoming, chunk }) => {
        if (incoming !== requestId) return
        const choice = chunk.choices?.[0]
        const delta = choice?.delta?.content || ''
        if (delta) {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId ? { ...message, content: message.content + delta } : message
            )
          )
        }
        if (choice?.finishReason) {
          setMessages((current) =>
            current.map((message) => (message.id === assistantId ? { ...message, streaming: false } : message))
          )
        }
      })

      try {
        await window.electronAPI.ai.chatStream(request, requestId)
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  streaming: false,
                  content: message.content || '(The model returned an empty response.)',
                }
              : message
          )
        )
      } catch (error) {
        const message = errorText(error)
        const cancelled = /cancel/i.test(message)
        setMessages((current) =>
          current.map((entry) =>
            entry.id === assistantId
              ? {
                  ...entry,
                  streaming: false,
                  stopped: cancelled,
                  error: cancelled ? undefined : message,
                  content: cancelled ? entry.content : entry.content,
                }
              : entry
          )
        )
        if (!cancelled) notify(`AI request failed: ${message}`, 'error')
      } finally {
        unsubscribe()
        if (activeRequestRef.current === requestId) {
          activeRequestRef.current = null
          setLoading(false)
        }
      }
    },
    [loading, currentModel, buildRequest, includePage, pageContext, notify]
  )

  const stopGeneration = useCallback(async () => {
    try {
      await window.electronAPI.ai.cancelChat()
    } catch {
      /* the stream will also settle on its own */
    }
    setMessages((current) =>
      current.map((message) => (message.streaming ? { ...message, streaming: false, stopped: true } : message))
    )
    setLoading(false)
    setAgentRunning(false)
    setAgentSteps([])
    setPendingToolCalls([])
  }, [])

  const retry = useCallback(
    (assistantId: string) => {
      const current = messagesRef.current
      const index = current.findIndex((message) => message.id === assistantId)
      if (index < 0) return
      const user = [...current.slice(0, index)].reverse().find((message) => message.role === 'user')
      if (!user) return
      const history = current.filter((message) => message.id !== assistantId && message.id !== user.id)
      void sendMessage(user.content, history)
    },
    [sendMessage]
  )

  // Agent: run agent loop
  const runAgent = useCallback(
    async (text: string, baseMessages: ChatMessage[] = messagesRef.current) => {
      const trimmed = text.trim()
      if (!trimmed || loading) return
      if (!currentModel) {
        notify('Choose a model for this task before sending a message.', 'error')
        setShowSettings(true)
        return
      }
      if (!activeTab || isPrivate) {
        notify('Agent mode requires a non-private tab.', 'error')
        return
      }

      const request = buildRequest(trimmed, baseMessages)
      if (!request) return

      const assistantId = uid()
      const userMessage: ChatMessage = { id: uid(), role: 'user', content: trimmed }
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        streaming: false,
        toolCalls: [],
        toolResults: [],
      }

      setMessages([...baseMessages, userMessage, assistantMessage])
      setInput('')
      setLoading(true)
      setAgentRunning(true)
      setAgentSteps([])
      setPendingToolCalls([])

      try {
        // The main process resolves the live webContents from the tab id.
        const result = await window.electronAPI.ai.runAgent(request, {
          tabId: activeTab.id,
          windowId: (await window.electronAPI.window.getInfo?.())?.id || 0,
        })

        // Final response from agent
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: result.choices?.[0]?.message?.content || 'Agent completed.',
                  toolCalls: result.choices?.[0]?.message?.toolCalls || [],
                  toolResults: result.choices?.[0]?.message?.toolResults || [],
                }
              : message
          )
        )
      } catch (error) {
        const message = errorText(error)
        setMessages((current) =>
          current.map((entry) =>
            entry.id === assistantId
              ? {
                  ...entry,
                  streaming: false,
                  error: message,
                  content: entry.content || `Agent error: ${message}`,
                }
              : entry
          )
        )
        notify(`Agent failed: ${message}`, 'error')
      } finally {
        setLoading(false)
        setAgentRunning(false)
      }
    },
    [loading, currentModel, buildRequest, activeTab, isPrivate, notify]
  )

  // Agent: handle tool approval
  const handleToolApproval = useCallback(
    (toolCallId: string, approved: boolean) => {
      const pending = pendingToolCalls.find((p) => p.toolCall.id === toolCallId)
      if (pending) {
        pending.resolve(approved)
        setPendingToolCalls((prev) => prev.filter((p) => p.toolCall.id !== toolCallId))
      }
    },
    [pendingToolCalls]
  )

  const savePrompt = useCallback(async () => {
    try {
      await window.electronAPI.ai.setSystemPrompt(promptDraft)
      setSystemPrompt(promptDraft)
      setPromptSaved(true)
      notify('System prompt saved', 'success')
    } catch (error) {
      setSettingsError(`Could not save prompt: ${errorText(error)}`)
    }
  }, [promptDraft, notify])

  const changeSlot = useCallback(
    async (slot: ModelSlot, modelId: string) => {
      setSlots((current) => ({ ...current, [slot]: modelId }))
      try {
        await window.electronAPI.ai.setModelSlot(slot, modelId)
      } catch (error) {
        notify(`Could not set model: ${errorText(error)}`, 'error')
      }
    },
    [notify]
  )

  const addProvider = useCallback(async () => {
    if (!providerForm.modelId.trim()) {
      setSettingsError('Enter the model ID exposed by the provider.')
      return
    }
    if (providerForm.type !== 'lmstudio' && !providerForm.apiKey.trim()) {
      setSettingsError('This provider requires an API key.')
      return
    }
    setProviderBusy(true)
    setSettingsError('')
    const id = `${providerForm.type}-${Date.now().toString(36)}`
    const modelId = providerForm.modelId.trim()
    const config = {
      id,
      name: providerForm.name.trim() || TYPE_DEFAULTS[providerForm.type]?.name || providerForm.type,
      type: providerForm.type,
      baseUrl: providerForm.baseUrl.trim() || TYPE_DEFAULTS[providerForm.type]?.baseUrl,
      enabled: true,
      models: [
        {
          id: modelId,
          name: providerForm.modelName.trim() || modelId,
          provider: id,
          capabilities: {
            contextWindow: Math.max(1024, Number(providerForm.contextWindow) || 128000),
            supportsVision: false,
            supportsTools: false,
            supportsStreaming: true,
          },
        },
      ],
      defaultModel: modelId,
    }
    try {
      const apiKey = providerForm.apiKey.trim()
      await window.electronAPI.ai.addProvider(config, apiKey ? [apiKey] : undefined)
      await refreshAi()
      setProviderForm(EMPTY_PROVIDER_FORM)
      setShowProviderForm(false)
      notify('Provider added and ready to use.', 'success')
    } catch (error) {
      setSettingsError(`Could not add provider: ${errorText(error)}`)
    } finally {
      setProviderBusy(false)
    }
  }, [providerForm, refreshAi, notify])

  const handleDiscoverModels = useCallback(async () => {
    if (!providerForm.baseUrl.trim()) {
      setSettingsError('Enter a base URL first.')
      return
    }
    setDiscoverBusy(true)
    setDiscoveredModels([])
    setSettingsError('')
    try {
      const models = await window.electronAPI.ai.discoverModels(
        providerForm.type,
        providerForm.baseUrl.trim(),
        providerForm.type !== 'lmstudio' ? providerForm.apiKey.trim() || undefined : undefined
      )
      if (models.length > 0) {
        setDiscoveredModels(models)
        setProviderForm((current) => ({ ...current, modelId: models[0].id, modelName: models[0].name }))
        notify(`Discovered ${models.length} models. First model selected.`, 'success')
      } else {
        setSettingsError('No models found. Check the base URL and API key.')
      }
    } catch (error) {
      setSettingsError(`Discovery failed: ${errorText(error)}`)
    } finally {
      setDiscoverBusy(false)
    }
  }, [providerForm, notify])

  const handleAutoConfig = useCallback(async () => {
    if (!autoConfig.apiKey.trim() && autoConfig.type !== 'lmstudio') {
      setSettingsError('Enter an API key (not required for LM Studio).')
      return
    }
    if (!autoConfig.name.trim()) {
      setSettingsError('Enter a display name.')
      return
    }
    setAutoConfigBusy(true)
    setSettingsError('')
    try {
      const result = await window.electronAPI.ai.addProviderAuto({
        type: autoConfig.type,
        name: autoConfig.name.trim(),
        baseUrl: autoConfig.baseUrl.trim() || TYPE_DEFAULTS[autoConfig.type]?.baseUrl || '',
        apiKey: autoConfig.apiKey.trim() || undefined,
      })
      if (result.success) {
        await refreshAi()
        setAutoConfig({ type: 'openai', name: '', baseUrl: '', apiKey: '' })
        setShowAutoConfig(false)
        notify('Provider added, models discovered, and first model assigned.', 'success')
      } else {
        setSettingsError('Auto-configure failed.')
      }
    } catch (error) {
      setSettingsError(`Auto-configure failed: ${errorText(error)}`)
    } finally {
      setAutoConfigBusy(false)
    }
  }, [autoConfig, refreshAi, notify])

  const testProvider = useCallback(
    async (provider: ProviderConfigDTO) => {
      setProviderStatus((current) => ({ ...current, [provider.id]: 'Testing…' }))
      try {
        const result = await window.electronAPI.ai.testProvider(provider.id)
        setProviderStatus((current) => ({
          ...current,
          [provider.id]: result.success ? 'Healthy' : `Failed: ${result.error || 'unknown error'}`,
        }))
      } catch (error) {
        setProviderStatus((current) => ({ ...current, [provider.id]: `Failed: ${errorText(error)}` }))
      }
    },
    []
  )

  const removeProvider = useCallback(
    async (provider: ProviderConfigDTO) => {
      if (!window.confirm(`Remove provider “${provider.name}”?`)) return
      try {
        await window.electronAPI.ai.removeProvider(provider.id)
        await refreshAi()
      } catch (error) {
        setSettingsError(`Could not remove provider: ${errorText(error)}`)
      }
    },
    [refreshAi]
  )

  if (!isOpen) return null

  const pageTitle = activeTab?.title || (activeTab ? hostOf(activeTab.url) : 'No page')
  const modelLabel = currentModel ? `${currentModel.name} · ${currentModel.provider}` : 'No model configured'
  const contextStateLabel =
    extractState === 'loading'
      ? 'Reading page…'
      : extractState === 'ready'
        ? `${formatTokens(pageTokens)} tokens`
        : extractState === 'private'
          ? 'Private tab — not read'
          : extractState === 'error'
            ? 'Extraction failed'
            : extractState === 'empty'
              ? 'Nothing to read'
              : 'Page context off'

  return (
    <aside className="ai-sidebar" style={{ width }} aria-label="Ariadne AI assistant">
      <header className="ai-header">
        <div className="ai-title">
          <span className="ai-title-mark">
            <Icon name="sparkle" size={14} />
          </span>
          <div>
            <strong>Ask Ariadne</strong>
            <span className="ai-subtitle">{modelLabel}</span>
          </div>
        </div>
        <div className="ai-header-actions">
          <button
            className={`icon-btn ${agentMode ? 'active' : ''}`}
            onClick={() => setAgentMode((v) => !v)}
            title={agentMode ? 'Disable agent mode (autonomous browsing)' : 'Enable agent mode (autonomous browsing)'}
          >
            <Icon name={agentMode ? 'bot' : 'bot'} size={15} />
          </button>
          <button className="icon-btn" onClick={onOpenContext} title="Cross-tab context">
            <Icon name="panel" size={15} />
          </button>
          <button
            className={`icon-btn ${showSettings ? 'active' : ''}`}
            onClick={() => setShowSettings((open) => !open)}
            title="AI settings"
          >
            <Icon name="settings" size={15} />
          </button>
          <button className="icon-btn" onClick={onClose} title="Close AI sidebar (Ctrl+Shift+A)">
            <Icon name="close" size={15} />
          </button>
        </div>
      </header>

      {agentMode && agentTools.length > 0 && (
        <div className="ai-agent-tools-bar" title="Available agent tools">
          <span className="ai-agent-tools-label">Tools:</span>
          {agentTools.map((tool) => (
            <span key={tool.function.name} className="ai-agent-tool-chip" title={tool.function.description}>
              {tool.function.name}
            </span>
          ))}
        </div>
      )}

      {showSettings && (
        <div className={`ai-settings ${showProviderForm ? 'expanded' : ''}`}>
          <div className="ai-settings-head">
            <strong>AI settings</strong>
            <button className="text-btn" onClick={onOpenSettings}>
              Open full settings
            </button>
          </div>

          {settingsError && <div className="ai-inline-error">{settingsError}</div>}

          <label className="ai-field">
            <span>Task model slots</span>
            {SLOTS.map((slot) => (
              <div className="ai-slot-row" key={slot.id}>
                <span title={slot.hint}>{slot.label}</span>
                <select value={slots[slot.id]} onChange={(event) => void changeSlot(slot.id, event.target.value)}>
                  <option value="">Not set</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} ({model.provider})
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </label>

          <label className="ai-field">
            <span>System prompt</span>
            <textarea
              value={promptDraft}
              onChange={(event) => {
                setPromptDraft(event.target.value)
                setPromptSaved(false)
              }}
              rows={4}
            />
            <div className="ai-field-actions">
              <button className="text-btn" disabled={promptSaved} onClick={() => void savePrompt()}>
                {promptSaved ? 'Saved' : 'Save prompt'}
              </button>
            </div>
          </label>

          <div className="ai-field">
            <span>Providers</span>
            {providers.length === 0 && <div className="ai-muted">No providers configured yet.</div>}
            {providers.map((provider) => (
              <div className="ai-provider" key={provider.id}>
                <span className={`provider-dot ${provider.enabled ? 'on' : 'off'}`} />
                <span className="ai-provider-copy">
                  <strong>{provider.name}</strong>
                  <span>
                    {provider.type}
                    {provider.baseUrl ? ` · ${provider.baseUrl}` : ''}
                  </span>
                  {providerStatus[provider.id] && <span className="ai-provider-status">{providerStatus[provider.id]}</span>}
                </span>
                <button className="mini-btn" onClick={() => void testProvider(provider)}>
                  Test
                </button>
                <button className="mini-btn danger" onClick={() => void removeProvider(provider)}>
                  Remove
                </button>
              </div>
            ))}

            {!showProviderForm ? (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button className="text-btn" onClick={() => setShowProviderForm(true)}>
                  + Add provider
                </button>
                <button className="primary-btn small" onClick={() => setShowAutoConfig(true)}>
                  Add provider + key
                </button>
              </div>
            ) : (
              <div className="provider-form" ref={providerFormRef}>
                <div className="provider-form-grid">
                  <label>
                    <span>Type</span>
                    <select
                      value={providerForm.type}
                      onChange={(event) => {
                        const type = event.target.value
                        setProviderForm((current) => ({
                          ...current,
                          type,
                          name: current.name || TYPE_DEFAULTS[type]?.name || '',
                          baseUrl: current.baseUrl || TYPE_DEFAULTS[type]?.baseUrl || '',
                        }))
                      }}
                    >
                      {providerTypes.map((type) => (
                        <option key={type} value={type}>
                          {TYPE_DEFAULTS[type]?.name || type}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Display name</span>
                    <input
                      value={providerForm.name}
                      onChange={(event) => setProviderForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder={TYPE_DEFAULTS[providerForm.type]?.name}
                    />
                  </label>
                  <label className="span-2">
                    <span>Base URL</span>
                    <input
                      value={providerForm.baseUrl}
                      onChange={(event) => setProviderForm((current) => ({ ...current, baseUrl: event.target.value }))}
                      placeholder={TYPE_DEFAULTS[providerForm.type]?.baseUrl}
                    />
                  </label>
                  <label style={{ position: 'relative' }}>
                    <span>Model ID</span>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                      {discoveredModels.length > 0 ? (
                        <select
                          value={providerForm.modelId}
                          onChange={(event) => {
                            const model = discoveredModels.find(m => m.id === event.target.value)
                            setProviderForm((current) => ({
                              ...current,
                              modelId: event.target.value,
                              modelName: model?.name || event.target.value,
                            }))
                          }}
                          style={{ flex: 1, minWidth: 0 }}
                        >
                          {discoveredModels.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} ({m.id})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={providerForm.modelId}
                          onChange={(event) => setProviderForm((current) => ({ ...current, modelId: event.target.value }))}
                          placeholder="gpt-4o-mini"
                          style={{ flex: 1 }}
                        />
                      )}
                      <button
                        className="mini-btn"
                        disabled={discoverBusy || !providerForm.baseUrl.trim() || (providerForm.type !== 'lmstudio' && !providerForm.apiKey.trim())}
                        onClick={() => void handleDiscoverModels()}
                        style={{ whiteSpace: 'nowrap', height: '32px' }}
                      >
                        {discoverBusy ? 'Discovering…' : 'Discover Models'}
                      </button>
                    </div>
                  </label>
                  <label>
                    <span>Model label</span>
                    <input
                      value={providerForm.modelName}
                      onChange={(event) => setProviderForm((current) => ({ ...current, modelName: event.target.value }))}
                      placeholder="GPT-4o mini"
                    />
                  </label>
                  <label>
                    <span>Context window</span>
                    <input
                      value={providerForm.contextWindow}
                      onChange={(event) =>
                        setProviderForm((current) => ({ ...current, contextWindow: event.target.value }))
                      }
                      inputMode="numeric"
                    />
                  </label>
                  <label>
                    <span>API key</span>
                    <input
                      type="password"
                      value={providerForm.apiKey}
                      onChange={(event) => setProviderForm((current) => ({ ...current, apiKey: event.target.value }))}
                      placeholder={providerForm.type === 'lmstudio' ? 'Not required for local' : 'sk-…'}
                    />
                  </label>
                </div>
                <div className="ai-field-actions">
                  <button className="text-btn" onClick={() => setShowProviderForm(false)}>
                    Cancel
                  </button>
                  <button className="primary-btn small" disabled={providerBusy} onClick={() => void addProvider()}>
                    {providerBusy ? 'Adding…' : 'Add provider'}
                  </button>
                </div>
                <div className="ai-muted">
                  Keys are stored in the OS credential vault, never in the provider JSON.
                </div>
              </div>
            )}

            {showAutoConfig && (
              <div className="provider-form">
                <h4 style={{ margin: '0 0 12px', fontSize: '12px' }}>Add Provider + Key (Auto-Configure)</h4>
                <div className="provider-form-grid">
                  <label>
                    <span>Type</span>
                    <select
                      value={autoConfig.type}
                      onChange={(event) => {
                        const type = event.target.value
                        setAutoConfig((current) => ({
                          ...current,
                          type,
                          name: current.name || TYPE_DEFAULTS[type]?.name || '',
                          baseUrl: current.baseUrl || TYPE_DEFAULTS[type]?.baseUrl || '',
                        }))
                      }}
                    >
                      {providerTypes.map((type) => (
                        <option key={type} value={type}>
                          {TYPE_DEFAULTS[type]?.name || type}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Display name</span>
                    <input
                      value={autoConfig.name}
                      onChange={(event) => setAutoConfig((current) => ({ ...current, name: event.target.value }))}
                      placeholder={TYPE_DEFAULTS[autoConfig.type]?.name}
                    />
                  </label>
                  <label className="span-2">
                    <span>Base URL</span>
                    <input
                      value={autoConfig.baseUrl}
                      onChange={(event) => setAutoConfig((current) => ({ ...current, baseUrl: event.target.value }))}
                      placeholder={TYPE_DEFAULTS[autoConfig.type]?.baseUrl}
                    />
                  </label>
                  <label>
                    <span>API key</span>
                    <input
                      type="password"
                      value={autoConfig.apiKey}
                      onChange={(event) => setAutoConfig((current) => ({ ...current, apiKey: event.target.value }))}
                      placeholder={autoConfig.type === 'lmstudio' ? 'Not required for local' : 'sk-…'}
                    />
                  </label>
                </div>
                <div className="ai-field-actions">
                  <button className="text-btn" onClick={() => { setAutoConfig({ type: 'openai', name: '', baseUrl: '', apiKey: '' }); setShowAutoConfig(false); }}>
                    Cancel
                  </button>
                  <button className="primary-btn small" disabled={autoConfigBusy} onClick={() => void handleAutoConfig()}>
                    {autoConfigBusy ? 'Discovering models & adding…' : 'Add & configure'}
                  </button>
                </div>
                <div className="ai-muted">
                  Tests the key, fetches available models, adds the provider, and assigns the first model to the Fast slot.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="ai-context-bar">
        <button
          className="ai-context-toggle"
          onClick={() => setIncludePage((value) => !value)}
          aria-pressed={includePage}
          title={includePage ? 'Stop sending the current page' : 'Include the current page'}
        >
          <span className={`context-switch ${includePage ? 'on' : ''}`} />
          <span className="ai-context-copy">
            <span className="ai-context-title">{pageTitle}</span>
            <span className="ai-context-meta">
              {contextStateLabel}
              {extractState === 'ready' && ` · ${hostOf(pageContext?.url || '')}`}
            </span>
          </span>
        </button>
        <button
          className="icon-btn"
          title="Re-read this page"
          disabled={!activeTab || isPrivate || isNewTab(activeTab.url) || extractState === 'loading'}
          onClick={() => setExtractNonce((value) => value + 1)}
        >
          <Icon name="retry" size={13} />
        </button>
      </div>

      {extractState === 'error' && (
        <div className="ai-extract-error">
          <span>{extractError}</span>
          <button className="text-btn" onClick={() => setExtractNonce((value) => value + 1)}>
            Retry
          </button>
        </div>
      )}

      {isPrivate && (
        <div className="ai-extract-note">
          <Icon name="lock" size={12} /> Private tabs are never extracted or sent to a model.
        </div>
      )}

      <div className="ai-budget" title={`Estimated ${usedTokens.toLocaleString()} of ${contextWindow.toLocaleString()} tokens`}>
        <div className={`ai-budget-fill ${budgetRatio > 0.85 ? 'warn' : ''}`} style={{ width: `${budgetRatio * 100}%` }} />
        <span>
          {formatTokens(usedTokens)} / {formatTokens(contextWindow)} tokens
        </span>
      </div>

      {agentMode && agentRunning && agentSteps.length > 0 && (
        <div className="ai-agent-steps">
          <div className="ai-agent-steps-header">
            <span className="ai-agent-steps-title">
              <Icon name="bot" size={12} /> Agent working…
            </span>
          </div>
          <div className="ai-agent-steps-list">
            {agentSteps.map((step, index) => (
              <div key={index} className={`ai-agent-step ${step.type}`}>
                <span className="ai-agent-step-type">{step.type.toUpperCase()}</span>
                <span className="ai-agent-step-content">{step.content}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingToolCalls.length > 0 && (
        <div className="ai-agent-approval">
          <div className="ai-agent-approval-header">
            <span className="ai-agent-approval-title">
              <Icon name="alert-triangle" size={12} /> Tool requires approval
            </span>
          </div>
          {pendingToolCalls.map((pending) => (
            <div key={pending.toolCall.id} className="ai-agent-approval-item">
              <div className="ai-agent-approval-preview">
                <strong>{pending.toolCall.function.name}</strong>
                <span>{pending.preview}</span>
              </div>
              <div className="ai-agent-approval-args">
                {pending.toolCall.function.arguments}
              </div>
              <div className="ai-agent-approval-actions">
                <button
                  className="danger-btn small"
                  onClick={() => handleToolApproval(pending.toolCall.id, false)}
                >
                  Deny
                </button>
                <button
                  className="primary-btn small"
                  onClick={() => handleToolApproval(pending.toolCall.id, true)}
                >
                  Allow
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="ai-messages" role="log" aria-live="polite">
        {messages.length === 0 && (
          <div className="ai-welcome">
            <div className="ai-welcome-mark">
              <Icon name="sparkle" size={18} />
            </div>
            <h3>What are you reading?</h3>
            <p>
              Ask about the current page, or open cross-tab context to compare and cite several tabs.
            </p>
            <div className="ai-prompts">
              {[
                'Summarize this page in five bullets.',
                'What are the main claims and how strong is the evidence?',
                'Explain this in simpler terms.',
              ].map((prompt) => (
                <button key={prompt} className="ai-prompt" onClick={() => setInput(prompt)}>
                  {prompt}
                </button>
              ))}
              <button className="ai-prompt context" onClick={onOpenContext}>
                Compare tabs with sources…
              </button>
            </div>
            {!currentModel && (
              <button className="primary-btn small" onClick={() => setShowSettings(true)}>
                Configure a model
              </button>
            )}
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className={`ai-message ${message.role} ${message.error ? 'has-error' : ''}`}>
            <div className="ai-message-head">
              <span>{message.role === 'user' ? 'You' : 'Ariadne'}</span>
              {message.stopped && <span className="ai-stopped">stopped</span>}
            </div>
            <div className="ai-message-body">
              {message.content || (message.streaming ? <span className="ai-typing">…</span> : '')}
              {message.streaming && <span className="ai-caret" />}
            </div>
            {message.sources && message.sources.length > 0 && (
              <div className="ai-sources">
                <span className="ai-sources-label">Source</span>
                {message.sources.map((source) => (
                  <button
                    key={`${source.tabId}-${source.url}`}
                    className="source-chip"
                    onClick={() => onOpenTab(source.tabId)}
                    title={source.url}
                  >
                    <Icon name="panel" size={12} />
                    {source.title || hostOf(source.url)}
                  </button>
                ))}
              </div>
            )}
            {message.error && (
              <div className="ai-message-error">
                <span>{message.error}</span>
                <button className="text-btn" onClick={() => retry(message.id)}>
                  Retry
                </button>
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="ai-composer">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void sendMessage(input)
            }
          }}
          placeholder={currentModel ? 'Ask about this page…' : 'Configure a model to start'}
          rows={2}
          disabled={loading}
        />
        <div className="ai-composer-row">
          <span className="ai-composer-hint">
            <kbd>Enter</kbd> send · <kbd>Shift</kbd> <kbd>Enter</kbd> newline
            {agentMode && <span className="ai-agent-hint"> · Agent mode</span>}
          </span>
          {loading || agentRunning ? (
            <button className="danger-btn small" onClick={() => void stopGeneration()}>
              <Icon name="stop" size={13} /> {agentRunning ? 'Stop Agent' : 'Stop'}
            </button>
          ) : (
            <button
              className="primary-btn small"
              disabled={!input.trim()}
              onClick={() => void (agentMode ? runAgent(input) : sendMessage(input))}
            >
              {agentMode ? 'Run Agent' : 'Send'}
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
