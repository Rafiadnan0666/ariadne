import React, { useState, useEffect, useRef, useCallback } from 'react'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  isStreaming?: boolean
  sources?: Array<{ url: string; title: string }>
}

interface ModelInfo {
  id: string
  name: string
  provider: string
  capabilities: {
    contextWindow: number
    supportsVision: boolean
    supportsTools: boolean
    supportsStreaming: boolean
  }
}

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

type ModelSlot = 'fastBrowsing' | 'research' | 'reasoning' | 'coding' | 'verification'

const SLOT_LABELS: Record<ModelSlot, string> = {
  fastBrowsing: 'Fast Browsing',
  research: 'Research',
  reasoning: 'Reasoning',
  coding: 'Coding',
  verification: 'Verification',
}

export const ChatSidebar: React.FC<{ isOpen: boolean; onClose: () => void; activeTabId?: string }> = ({
  isOpen,
  onClose,
  activeTabId,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelSlots, setModelSlots] = useState<Record<ModelSlot, string>>({
    fastBrowsing: '',
    research: '',
    reasoning: '',
    coding: '',
    verification: '',
  })
  const [selectedSlot, setSelectedSlot] = useState<ModelSlot>('fastBrowsing')
  const [pageContext, setPageContext] = useState<PageContext | null>(null)
  const [includePageContext, setIncludePageContext] = useState(true)
  const [providers, setProviders] = useState<any[]>([])
  const [systemPrompt, setSystemPrompt] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Load initial data
  useEffect(() => {
    if (!isOpen) return

    const loadData = async () => {
      try {
        const [modelsData, slotsData, providersData, promptData] = await Promise.all([
          window.electronAPI.ai.getModels(),
          window.electronAPI.ai.getModelSlots(),
          window.electronAPI.ai.getProviders(),
          window.electronAPI.ai.getSystemPrompt(),
        ])
        setModels(modelsData)
        setModelSlots(slotsData)
        setProviders(providersData)
        setSystemPrompt(promptData)
      } catch (e) {
        console.error('Failed to load AI data:', e)
      }
    }
    loadData()
  }, [isOpen])

  // Extract page context when active tab changes
  useEffect(() => {
    if (!activeTabId || !includePageContext) return

    const extractContext = async () => {
      try {
        const context = await window.electronAPI.ai.extractPage(activeTabId)
        if (context) {
          setPageContext(context)
        }
      } catch (e) {
        console.error('Failed to extract page context:', e)
      }
    }

    extractContext()
  }, [activeTabId, includePageContext])

  const getModelForSlot = useCallback((slot: ModelSlot) => {
    const modelId = modelSlots[slot]
    return models.find(m => m.id === modelId)
  }, [modelSlots, models])

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return

    const userMessage: ChatMessage = { role: 'user', content: input }
    setMessages(prev => [...prev, userMessage])
    const currentInput = input
    setInput('')
    setIsLoading(true)

    const model = getModelForSlot(selectedSlot)
    if (!model) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'No model selected for this task. Please configure a model in settings.' }])
      setIsLoading(false)
      return
    }

    // Build messages with context
    const chatMessages = messages.map(m => ({ role: m.role, content: m.content }))
    chatMessages.push({ role: 'user', content: currentInput })

    // Add page context if enabled and available
    if (includePageContext && pageContext) {
      const contextMessage = `Page context from ${pageContext.title} (${pageContext.url}):\n\n${pageContext.readableText.substring(0, 8000)}`
      chatMessages.unshift({ role: 'system', content: contextMessage })
    }

    // Add system prompt
    if (systemPrompt) {
      chatMessages.unshift({ role: 'system', content: systemPrompt })
    }

    const request = {
      model: model.id,
      messages: chatMessages,
      temperature: 0.7,
      stream: true,
    }

    abortControllerRef.current = new AbortController()

    try {
      // Start streaming
      const assistantMessage: ChatMessage = { role: 'assistant', content: '', isStreaming: true }
      let messageIndex = messages.length
      setMessages(prev => [...prev, assistantMessage])

      const unsubscribe = window.electronAPI.ai.onStreamChunk((chunk: any) => {
        const delta = chunk.choices[0]?.delta?.content || ''
        if (delta) {
          setMessages(prev => {
            const newMessages = [...prev]
            const msg = newMessages[messageIndex]
            if (msg && msg.isStreaming) {
              newMessages[messageIndex] = { ...msg, content: msg.content + delta }
            }
            return newMessages
          })
        }
        if (chunk.choices[0]?.finishReason) {
          setMessages(prev => {
            const newMessages = [...prev]
            const msg = newMessages[messageIndex]
            if (msg) {
              newMessages[messageIndex] = { ...msg, isStreaming: false }
            }
            return newMessages
          })
        }
      })

      await window.electronAPI.ai.chatStream(request)
      unsubscribe()
    } catch (e) {
      console.error('Chat error:', e)
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${String(e)}` }])
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }, [input, isLoading, selectedSlot, modelSlots, models, messages, includePageContext, pageContext, systemPrompt, getModelForSlot])

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      setIsLoading(false)
    }
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }, [sendMessage])

  const formatContextSize = (text: string) => {
    const chars = text.length
    const tokens = Math.ceil(chars / 4)
    return `${tokens.toLocaleString()} tokens (~${chars.toLocaleString()} chars)`
  }

  if (!isOpen) return null

  const currentModel = getModelForSlot(selectedSlot)

  return (
    <div className="ai-sidebar">
      <div className="ai-sidebar-header">
        <div className="ai-sidebar-title">
          <span className="ai-icon">🤖</span>
          <span>Ariadne AI</span>
        </div>
        <div className="ai-sidebar-actions">
          <button className="ai-btn" onClick={() => setShowSettings(!showSettings)} title="Settings">⚙</button>
          <button className="ai-btn" onClick={onClose} title="Close">✕</button>
        </div>
      </div>

      {showSettings && (
        <div className="ai-settings-panel">
          <h4>AI Settings</h4>
          
          <div className="ai-setting-group">
            <label>Task Model Slots</label>
            {Object.entries(SLOT_LABELS).map(([slot, label]) => (
              <div key={slot} className="ai-slot-selector">
                <span className="ai-slot-label">{label}</span>
                <select
                  value={modelSlots[slot as ModelSlot] || ''}
                  onChange={e => {
                    const newSlots = { ...modelSlots, [slot]: e.target.value }
                    setModelSlots(newSlots)
                    window.electronAPI.ai.setModelSlot(slot, e.target.value)
                  }}
                >
                  <option value="">-- Select model --</option>
                  {models.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.provider})
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="ai-setting-group">
            <label>System Prompt</label>
            <textarea
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              onBlur={e => window.electronAPI.ai.setSystemPrompt(e.target.value)}
              rows={4}
              placeholder="System prompt for the AI..."
            />
          </div>

          <div className="ai-setting-group">
            <label>Providers</label>
            {providers.map(p => (
              <div key={p.id} className="ai-provider-item">
                <div className="ai-provider-info">
                  <span className={`ai-provider-status ${p.enabled ? 'enabled' : 'disabled'}`}></span>
                  <span>{p.name} ({p.type})</span>
                </div>
                <button className="ai-btn-small" onClick={() => window.electronAPI.ai.removeProvider(p.id)}>
                  Remove
                </button>
              </div>
            ))}
            <button className="ai-btn-primary" onClick={() => alert('Add provider UI TBD')}>
              + Add Provider
            </button>
          </div>
        </div>
      )}

      <div className="ai-chat-area">
        <div className="ai-model-selector">
          <label>Task: </label>
          <select value={selectedSlot} onChange={e => setSelectedSlot(e.target.value as ModelSlot)}>
            {Object.entries(SLOT_LABELS).map(([slot, label]) => (
              <option key={slot} value={slot}>
                {label} {modelSlots[slot as ModelSlot] ? `(${models.find(m => m.id === modelSlots[slot as ModelSlot])?.name || modelSlots[slot as ModelSlot]})` : '(no model)'}
              </option>
            ))}
          </select>
          {currentModel && (
            <span className="ai-model-info">
              Context: {currentModel.capabilities.contextWindow.toLocaleString()} tokens
              {currentModel.capabilities.supportsVision && ' 👁'}
              {currentModel.capabilities.supportsTools && ' 🔧'}
            </span>
          )}
        </div>

        {includePageContext && pageContext && (
          <div className="ai-context-preview">
            <label>
              <input
                type="checkbox"
                checked={includePageContext}
                onChange={e => setIncludePageContext(e.target.checked)}
              />
              Include page context ({formatContextSize(pageContext.readableText)})
            </label>
            <details>
              <summary>{pageContext.title} - {pageContext.url}</summary>
              <pre>{pageContext.readableText.substring(0, 500)}...</pre>
            </details>
          </div>
        )}

        <div className="ai-messages" role="log" aria-live="polite">
          {messages.length === 0 && (
            <div className="ai-welcome">
              <p>Welcome to Ariadne AI! Select a task type and model, then ask a question.</p>
              <p className="ai-hint">Page context is {includePageContext ? 'enabled' : 'disabled'}. Toggle in settings.</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`ai-message ${msg.role} ${msg.isStreaming ? 'streaming' : ''}`}>
              <div className="ai-message-role">{msg.role === 'user' ? 'You' : 'AI'}</div>
              <div className="ai-message-content">{msg.content || '<generating...>'}</div>
              {msg.sources && msg.sources.length > 0 && (
                <div className="ai-sources">
                  {msg.sources.map((s, si) => (
                    <a key={si} href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.title || s.url}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="ai-input-area">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isLoading ? 'Generating...' : 'Ask a question... (Shift+Enter for new line)'}
            disabled={isLoading}
            rows={3}
          />
          <div className="ai-input-actions">
            {isLoading ? (
              <button className="ai-btn-danger" onClick={stopGeneration}>Stop</button>
            ) : (
              <button className="ai-btn-primary" onClick={sendMessage} disabled={!input.trim()}>
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}