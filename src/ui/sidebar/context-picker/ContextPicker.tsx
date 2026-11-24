import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ContextItemSummary,
  ContextSelection,
  ExtractionSummary,
  PickerState,
  PreviewResult,
  QAAnswer,
} from '../../../context/types'
import './ContextPicker.css'

export interface ContextPickerProps {
  isOpen: boolean
  onClose: () => void
  activeTabId?: string
  /** Reads the current text selection from the live webview. */
  getActiveSelection?: () => Promise<string | undefined>
}

type Busy = 'extract' | 'preview' | 'send' | 'screenshot' | null

interface Message {
  kind: 'info' | 'error' | 'success'
  text: string
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function ContextPicker({ isOpen, onClose, activeTabId, getActiveSelection }: ContextPickerProps) {
  const [state, setState] = useState<PickerState | null>(null)
  const [mode, setMode] = useState<ContextSelection['mode']>('current')
  const [selectedTabIds, setSelectedTabIds] = useState<Set<string>>(new Set())
  const [includeSelectedText, setIncludeSelectedText] = useState(true)
  const [busy, setBusy] = useState<Busy>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [summaries, setSummaries] = useState<ExtractionSummary[]>([])
  const [exclusionsDraft, setExclusionsDraft] = useState('')
  const [draftInitialized, setDraftInitialized] = useState(false)
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)
  const [itemTexts, setItemTexts] = useState<Record<string, string>>({})
  const [question, setQuestion] = useState('')
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null)
  const [answer, setAnswer] = useState<QAAnswer | null>(null)
  const [showPayload, setShowPayload] = useState(true)
  const [screenshot, setScreenshot] = useState<{ dataUrl: string; title: string; width: number; height: number } | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await window.electronAPI.context.getState()
      setState(next)
      if (!draftInitialized) {
        setExclusionsDraft(next.exclusions.join('\n'))
        setDraftInitialized(true)
      }
      setSelectedTabIds((current) => {
        if (current.size > 0) {
          const valid = new Set(next.tabs.map((entry) => entry.tab.id))
          const kept = new Set(Array.from(current).filter((id) => valid.has(id)))
          if (kept.size > 0) return kept
        }
        const active = next.tabs.find((entry) => entry.tab.id === activeTabId)?.tab.id
          || next.tabs.find((entry) => entry.tab.active)?.tab.id
          || next.tabs[0]?.tab.id
        return active ? new Set([active]) : new Set()
      })
    } catch (error) {
      setMessage({ kind: 'error', text: `Could not load context state: ${errorText(error)}` })
    }
  }, [activeTabId, draftInitialized])

  useEffect(() => {
    if (isOpen) void refresh()
  }, [isOpen, refresh])

  const invalidatePreview = useCallback(() => {
    setPreviewResult(null)
    setAnswer(null)
  }, [])

  const selection = useMemo<ContextSelection>(() => ({
    mode,
    tabIds: mode === 'selected' ? Array.from(selectedTabIds) : [],
    includeSelectedText,
  }), [mode, selectedTabIds, includeSelectedText])

  const toggleTab = useCallback((id: string) => {
    setSelectedTabIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const runExtraction = useCallback(async (force: boolean) => {
    if (selection.mode === 'selected' && selection.tabIds.length === 0) {
      setMessage({ kind: 'error', text: 'Select at least one tab first.' })
      return
    }
    setBusy('extract')
    setMessage(null)
    invalidatePreview()
    try {
      const selectedTextByTab: Record<string, string> = {}
      const includesActive = Boolean(activeTabId) && (
        selection.mode === 'current' ||
        selection.mode === 'all' ||
        (selection.mode === 'selected' && selectedTabIds.has(activeTabId as string))
      )
      if (includeSelectedText && includesActive && getActiveSelection) {
        const selectedText = await getActiveSelection()
        if (selectedText && activeTabId) selectedTextByTab[activeTabId] = selectedText
      }
      const result = await window.electronAPI.context.extract(selection, { force, selectedTextByTab })
      setSummaries(result.summaries)
      const ok = result.summaries.filter((summary) => summary.ok && !summary.skipped).length
      const cached = result.summaries.filter((summary) => summary.skipped).length
      const failed = result.summaries.filter((summary) => !summary.ok).length
      setMessage({
        kind: failed > 0 && ok === 0 ? 'error' : 'success',
        text: `Extraction: ${ok} added, ${cached} cached/deduped, ${failed} failed.`,
      })
      await refresh()
    } catch (error) {
      setMessage({ kind: 'error', text: `Extraction failed: ${errorText(error)}` })
    } finally {
      setBusy(null)
    }
  }, [activeTabId, getActiveSelection, includeSelectedText, invalidatePreview, refresh, selection, selectedTabIds])

  const saveExclusions = useCallback(async () => {
    const hosts = exclusionsDraft.split(/[\n,]+/).map((host) => host.trim()).filter(Boolean)
    setBusy('extract')
    setMessage(null)
    invalidatePreview()
    try {
      const next = await window.electronAPI.context.setExclusions(hosts)
      setState(next)
      setExclusionsDraft(next.exclusions.join('\n'))
      setMessage({ kind: 'success', text: `Saved ${next.exclusions.length} exclusion${next.exclusions.length === 1 ? '' : 's'}.` })
    } catch (error) {
      setMessage({ kind: 'error', text: `Could not save exclusions: ${errorText(error)}` })
    } finally {
      setBusy(null)
    }
  }, [exclusionsDraft, invalidatePreview])

  const togglePrivateSession = useCallback(async (enabled: boolean) => {
    setBusy('extract')
    setMessage(null)
    invalidatePreview()
    try {
      const next = await window.electronAPI.context.setPrivateSession(enabled)
      setState(next)
      setMessage({
        kind: 'info',
        text: enabled
          ? 'Private session on: extracted context stays in memory only and is wiped when you turn this off.'
          : 'Private session ended: private context was wiped.',
      })
      await refresh()
    } catch (error) {
      setMessage({ kind: 'error', text: `Could not change private session: ${errorText(error)}` })
    } finally {
      setBusy(null)
    }
  }, [invalidatePreview, refresh])

  const wipePrivate = useCallback(async () => {
    setBusy('extract')
    invalidatePreview()
    try {
      const next = await window.electronAPI.context.clearPrivate()
      setState(next)
      setMessage({ kind: 'success', text: 'Private context wiped.' })
    } catch (error) {
      setMessage({ kind: 'error', text: `Could not wipe private context: ${errorText(error)}` })
    } finally {
      setBusy(null)
    }
  }, [invalidatePreview])

  const clearAll = useCallback(async () => {
    if (!window.confirm('Remove all extracted cross-tab context?')) return
    setBusy('extract')
    invalidatePreview()
    try {
      const next = await window.electronAPI.context.clear()
      setState(next)
      setSummaries([])
      setMessage({ kind: 'success', text: 'All context cleared.' })
    } catch (error) {
      setMessage({ kind: 'error', text: `Could not clear context: ${errorText(error)}` })
    } finally {
      setBusy(null)
    }
  }, [invalidatePreview])

  const removeItem = useCallback(async (itemId: string) => {
    setBusy('extract')
    invalidatePreview()
    try {
      const next = await window.electronAPI.context.removeItem(itemId)
      setState(next)
      setItemTexts((current) => {
        const copy = { ...current }
        delete copy[itemId]
        return copy
      })
      if (expandedItemId === itemId) setExpandedItemId(null)
    } catch (error) {
      setMessage({ kind: 'error', text: `Could not remove item: ${errorText(error)}` })
    } finally {
      setBusy(null)
    }
  }, [expandedItemId, invalidatePreview])

  const toggleItem = useCallback(async (item: ContextItemSummary) => {
    if (expandedItemId === item.id) {
      setExpandedItemId(null)
      return
    }
    setExpandedItemId(item.id)
    if (!itemTexts[item.id]) {
      try {
        const result = await window.electronAPI.context.getItemText(item.id)
        if (result) setItemTexts((current) => ({ ...current, [item.id]: result.text }))
      } catch (error) {
        setMessage({ kind: 'error', text: `Could not read item: ${errorText(error)}` })
      }
    }
  }, [expandedItemId, itemTexts])

  const buildPreview = useCallback(async () => {
    if (!question.trim()) {
      setMessage({ kind: 'error', text: 'Enter a question first.' })
      return
    }
    setBusy('preview')
    setMessage(null)
    setAnswer(null)
    try {
      const tabIds = mode === 'all'
        ? undefined
        : mode === 'current'
          ? (activeTabId ? [activeTabId] : undefined)
          : Array.from(selectedTabIds)
      const result = await window.electronAPI.context.preview(question.trim(), tabIds, 8)
      setPreviewResult(result)
      setShowPayload(true)
      if (!result.hasSources) {
        setMessage({ kind: 'error', text: 'No relevant chunks found. Extract the tabs first or rephrase the question.' })
      } else {
        setMessage({
          kind: 'info',
          text: `Preview ready: ${result.preview.sources.length} source chunks, ~${formatCount(result.preview.approxInputTokens)} input tokens. Nothing has been sent.`,
        })
      }
    } catch (error) {
      setMessage({ kind: 'error', text: `Could not build preview: ${errorText(error)}` })
    } finally {
      setBusy(null)
    }
  }, [activeTabId, mode, question, selectedTabIds])

  const sendPreview = useCallback(async () => {
    if (!previewResult) return
    setBusy('send')
    setMessage(null)
    try {
      const result = await window.electronAPI.context.ask(previewResult.preview.payloadHash)
      setAnswer(result)
      setMessage({
        kind: result.supported ? 'success' : 'error',
        text: result.supported
          ? 'Answer received with citations.'
          : 'The answer is not supported by the selected tabs.',
      })
    } catch (error) {
      setMessage({ kind: 'error', text: `Send failed: ${errorText(error)}` })
    } finally {
      setBusy(null)
    }
  }, [previewResult])

  const captureScreenshot = useCallback(async () => {
    if (!activeTabId) return
    setBusy('screenshot')
    setMessage(null)
    try {
      const result = await window.electronAPI.context.screenshot(activeTabId)
      if (!result) {
        setMessage({ kind: 'error', text: 'Screenshot failed or the tab has no http(s) URL.' })
        return
      }
      setScreenshot({ dataUrl: result.dataUrl, title: result.title, width: result.width, height: result.height })
      setMessage({ kind: 'info', text: 'Screenshot captured in memory only (explicit request; not added to context).' })
    } catch (error) {
      setMessage({ kind: 'error', text: `Screenshot failed: ${errorText(error)}` })
    } finally {
      setBusy(null)
    }
  }, [activeTabId])

  if (!isOpen) return null

  const stats = state?.stats
  const provider = state?.provider
  const activeTab = state?.tabs.find((entry) => entry.tab.id === activeTabId)
  const sendDisabled = !previewResult || !previewResult.hasSources || Boolean(answer) || busy !== null

  return (
    <div className="ctx-overlay" role="dialog" aria-modal="true" aria-label="Cross-tab context">
      <div className="ctx-panel">
        <header className="ctx-header">
          <div>
            <div className="ctx-title">Cross-tab context</div>
            <div className="ctx-subtitle">Local extraction · explicit payload preview · cited answers</div>
          </div>
          <button className="ctx-icon-button" onClick={onClose} title="Close">✕</button>
        </header>

        <div className="ctx-scroll">
          {!state ? (
            <div className="ctx-empty">Loading context state…</div>
          ) : (
            <>
              <section className="ctx-section">
                <div className="ctx-section-title">Provider</div>
                <div className="ctx-provider">
                  <span className={`ctx-badge ${provider?.available ? 'ctx-badge-ok' : 'ctx-badge-warn'}`}>
                    {provider?.available ? 'available' : 'not configured'}
                  </span>
                  {provider?.isTestOnly && <span className="ctx-badge ctx-badge-test">TEST-ONLY FAKE — no network</span>}
                  <span className="ctx-provider-name">{provider?.name}</span>
                  {provider?.model && <span className="ctx-muted">({provider.model})</span>}
                </div>
                {provider?.isTestOnly && (
                  <div className="ctx-note ctx-note-warn">
                    Answers are generated by a deterministic test-only fake. This path exists to test the pipeline and is never real AI.
                  </div>
                )}
                {!provider?.available && (
                  <div className="ctx-note ctx-note-warn">
                    No research model slot is configured. Preview works, but sending will fail until Session B configures a provider.
                    Set <code>ARIADNE_TEST_FAKE_PROVIDER=1</code> to use the labeled test-only fake.
                  </div>
                )}
              </section>

              <section className="ctx-section">
                <div className="ctx-section-title">1. Choose tabs</div>
                <div className="ctx-mode-row">
                  {(['current', 'selected', 'all'] as const).map((value) => (
                    <label key={value} className={`ctx-mode ${mode === value ? 'ctx-mode-active' : ''}`}>
                      <input
                        type="radio"
                        name="ctx-mode"
                        checked={mode === value}
                        onChange={() => setMode(value)}
                      />
                      {value === 'current' ? 'Current tab' : value === 'selected' ? 'Selected tabs' : 'All tabs'}
                    </label>
                  ))}
                  <label className="ctx-check">
                    <input
                      type="checkbox"
                      checked={includeSelectedText}
                      onChange={(event) => setIncludeSelectedText(event.target.checked)}
                    />
                    Include current text selection
                  </label>
                </div>

                <div className="ctx-tabs">
                  {state.tabs.length === 0 && <div className="ctx-empty">No tabs open.</div>}
                  {state.tabs.map((entry) => {
                    const isChecked = mode === 'selected' ? selectedTabIds.has(entry.tab.id) : mode === 'all' || entry.tab.id === activeTabId
                    return (
                      <label key={entry.tab.id} className={`ctx-tab ${isChecked ? 'ctx-tab-included' : ''}`}>
                        {mode === 'selected' && (
                          <input
                            type="checkbox"
                            checked={selectedTabIds.has(entry.tab.id)}
                            onChange={() => toggleTab(entry.tab.id)}
                          />
                        )}
                        <span className="ctx-tab-main">
                          <span className="ctx-tab-title">{entry.tab.title || entry.tab.url}</span>
                          <span className="ctx-tab-url">{entry.tab.url}</span>
                        </span>
                        <span className="ctx-tab-meta">
                          {entry.tab.id === activeTabId && <span className="ctx-badge">active</span>}
                          {entry.isPrivate && <span className="ctx-badge ctx-badge-test">private</span>}
                          {entry.excluded && <span className="ctx-badge ctx-badge-warn">excluded</span>}
                          {entry.cached
                            ? <span className="ctx-size">{formatCount(entry.chars)} chars · ~{formatCount(entry.approxTokens)} tok</span>
                            : <span className="ctx-muted">not extracted</span>}
                        </span>
                      </label>
                    )
                  })}
                </div>

                <div className="ctx-actions">
                  <button className="ctx-button ctx-button-primary" onClick={() => void runExtraction(false)} disabled={busy !== null}>
                    {busy === 'extract' ? 'Extracting…' : 'Extract selected'}
                  </button>
                  <button className="ctx-button" onClick={() => void runExtraction(true)} disabled={busy !== null}>
                    Re-extract (force)
                  </button>
                  <button className="ctx-button" onClick={() => void captureScreenshot()} disabled={busy !== null || !activeTabId}>
                    {busy === 'screenshot' ? 'Capturing…' : 'Capture screenshot (explicit)'}
                  </button>
                </div>
                {screenshot && (
                  <div className="ctx-screenshot-wrap">
                    <div className="ctx-muted">{screenshot.title} · {screenshot.width}×{screenshot.height} · memory only</div>
                    <img className="ctx-screenshot" src={screenshot.dataUrl} alt={`Screenshot of ${screenshot.title}`} />
                  </div>
                )}
                {summaries.length > 0 && (
                  <div className="ctx-summaries">
                    {summaries.map((summary) => (
                      <div key={summary.tabId} className={`ctx-summary ${summary.ok ? '' : 'ctx-summary-error'}`}>
                        <span>{summary.ok ? (summary.skipped ? 'cached' : 'added') : 'failed'}</span>
                        <span className="ctx-summary-title">{summary.title}</span>
                        <span className="ctx-muted">
                          {summary.reason || `${formatCount(summary.chars)} chars · ~${formatCount(summary.approxTokens)} tok · ${summary.durationMs}ms`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="ctx-section">
                <div className="ctx-section-title">
                  2. Included context
                  <span className="ctx-section-meta">
                    {stats ? `${stats.items} pages · ${stats.chunks} chunks · ${formatCount(stats.chars)} chars · ~${formatCount(stats.approxTokens)} tokens` : ''}
                  </span>
                </div>
                {state.items.length === 0 && <div className="ctx-empty">Nothing extracted yet.</div>}
                <div className="ctx-items">
                  {state.items.map((item) => (
                    <div key={item.id} className="ctx-item">
                      <div className="ctx-item-row">
                        <button className="ctx-link-button" onClick={() => void toggleItem(item)}>
                          {expandedItemId === item.id ? '▾' : '▸'} {item.title || item.url}
                        </button>
                        <span className="ctx-item-meta">
                          {item.isPrivate && <span className="ctx-badge ctx-badge-test">private</span>}
                          {item.compressed && <span className="ctx-badge">compressed</span>}
                          <span className="ctx-size">{formatCount(item.chars)} chars · ~{formatCount(item.approxTokens)} tok</span>
                          <span className="ctx-muted">{item.sources.length} source{item.sources.length === 1 ? '' : 's'}</span>
                          <button className="ctx-remove" onClick={() => void removeItem(item.id)} title="Remove this item">✕</button>
                        </span>
                      </div>
                      <div className="ctx-item-url">{item.url}</div>
                      {item.sources.length > 1 && (
                        <div className="ctx-sources">
                          {item.sources.map((source) => (
                            <div key={`${source.tabId}:${source.url}`} className="ctx-source">
                              tab {source.tabId} · {source.url}
                            </div>
                          ))}
                        </div>
                      )}
                      {expandedItemId === item.id && (
                        <pre className="ctx-item-text">{itemTexts[item.id] || item.snippet}</pre>
                      )}
                    </div>
                  ))}
                </div>
                <div className="ctx-actions">
                  <button className="ctx-button ctx-button-danger" onClick={() => void clearAll()} disabled={busy !== null || state.items.length === 0}>
                    Clear all context
                  </button>
                </div>
              </section>

              <section className="ctx-section">
                <div className="ctx-section-title">3. Privacy & exclusions</div>
                <label className="ctx-check">
                  <input
                    type="checkbox"
                    checked={state.privateSession}
                    onChange={(event) => void togglePrivateSession(event.target.checked)}
                    disabled={busy !== null}
                  />
                  Private session (in-memory only, wiped when turned off)
                </label>
                <div className="ctx-note">
                  Private extraction uses a fresh ephemeral session partition, never writes to disk, and strips private source aliases from public items.
                </div>
                <div className="ctx-actions">
                  <button className="ctx-button" onClick={() => void wipePrivate()} disabled={busy !== null || (state.stats.privateItems === 0 && !state.privateSession)}>
                    Wipe private context now
                  </button>
                </div>
                <label className="ctx-label" htmlFor="ctx-exclusions">Never extract these hosts (exact, .example.com, or *.example.com)</label>
                <textarea
                  id="ctx-exclusions"
                  className="ctx-textarea"
                  value={exclusionsDraft}
                  onChange={(event) => setExclusionsDraft(event.target.value)}
                  placeholder={'bank.example.com\n*.internal.example\naccounts.example.com'}
                  rows={4}
                />
                <div className="ctx-actions">
                  <button className="ctx-button" onClick={() => void saveExclusions()} disabled={busy !== null}>
                    Save exclusions
                  </button>
                </div>
              </section>

              <section className="ctx-section">
                <div className="ctx-section-title">4. Ask across tabs</div>
                <textarea
                  className="ctx-textarea"
                  value={question}
                  onChange={(event) => {
                    setQuestion(event.target.value)
                    invalidatePreview()
                  }}
                  placeholder="Compare prices, find differences, or ask which tab supports a claim…"
                  rows={3}
                />
                <div className="ctx-actions">
                  <button className="ctx-button ctx-button-primary" onClick={() => void buildPreview()} disabled={busy !== null}>
                    {busy === 'preview' ? 'Building preview…' : 'Preview payload (nothing sent)'}
                  </button>
                </div>

                {previewResult && (
                  <div className="ctx-preview">
                    <div className="ctx-preview-meta">
                      <span className="ctx-badge ctx-badge-ok">preview</span>
                      <span>{previewResult.preview.providerName}</span>
                      {previewResult.preview.isTestOnlyProvider && <span className="ctx-badge ctx-badge-test">TEST-ONLY</span>}
                      <span className="ctx-muted">
                        {previewResult.preview.sources.length} sources · ~{formatCount(previewResult.preview.approxInputTokens)} input tokens
                      </span>
                    </div>
                    <details
                      className="ctx-payload"
                      open={showPayload}
                      onToggle={(event) => setShowPayload((event.target as HTMLDetailsElement).open)}
                    >
                      <summary>Exact payload that will be sent</summary>
                      <div className="ctx-payload-label">System prompt</div>
                      <pre>{previewResult.preview.systemPrompt}</pre>
                      <div className="ctx-payload-label">User message</div>
                      <pre>{previewResult.preview.userPrompt}</pre>
                    </details>
                    <div className="ctx-actions">
                      <button className="ctx-button ctx-button-primary" onClick={() => void sendPreview()} disabled={sendDisabled}>
                        {busy === 'send' ? 'Sending…' : answer ? 'Sent' : 'Send this payload'}
                      </button>
                      <span className="ctx-muted">Nothing is sent until you click Send.</span>
                    </div>
                  </div>
                )}

                {answer && (
                  <div className={`ctx-answer ${answer.supported ? 'ctx-answer-ok' : 'ctx-answer-warn'}`}>
                    <div className="ctx-answer-head">
                      <span className={`ctx-badge ${answer.supported ? 'ctx-badge-ok' : 'ctx-badge-warn'}`}>
                        {answer.supported ? 'cited' : 'unsupported'}
                      </span>
                      {answer.warning && <span className="ctx-muted">{answer.warning}</span>}
                    </div>
                    <pre className="ctx-answer-text">{answer.answer}</pre>
                    <div className="ctx-citations">
                      {answer.citations.length === 0 && <div className="ctx-muted">No citations.</div>}
                      {answer.citations.map((citation) => (
                        <div key={citation.sourceId} className="ctx-citation">
                          <span className="ctx-badge">[{citation.sourceId}]</span>
                          <span className="ctx-citation-title">{citation.title}</span>
                          <span className="ctx-citation-url">{citation.url}</span>
                          <span className="ctx-muted">tab {citation.tabId} · chunk {citation.chunkIndex}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {message && <div className={`ctx-message ctx-message-${message.kind}`}>{message.text}</div>}
            </>
          )}
        </div>

        <footer className="ctx-footer">
          <span>{activeTab ? `Active: ${activeTab.tab.title || activeTab.tab.url}` : 'No active tab'}</span>
          <span className="ctx-muted">Local ranking · no embeddings download · bounded context</span>
        </footer>
      </div>
    </div>
  )
}
