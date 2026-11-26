import React, { useEffect, useMemo, useState } from 'react'
import type { AppInfoDTO, AppSettingsDTO, SearchEngineDTO } from '../types'
import { Icon, type IconName } from './Icon'

export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'search'
  | 'privacy'
  | 'security'
  | 'shortcuts'
  | 'ai'
  | 'about'

interface SettingsPageProps {
  isOpen: boolean
  onClose: () => void
  initialSection: SettingsSection
  settings: AppSettingsDTO
  searchEngines: SearchEngineDTO[]
  appInfo: AppInfoDTO | null
  onSave: (patch: Partial<AppSettingsDTO>) => Promise<void>
  onClearData: (options: { history?: boolean; cookies?: boolean; cache?: boolean; permissions?: boolean }) => Promise<void>
  onOpenAI: () => void
}

const SECTIONS: Array<{ id: SettingsSection; label: string; icon: IconName }> = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'appearance', label: 'Appearance', icon: 'panel' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'privacy', label: 'Privacy', icon: 'shield' },
  { id: 'security', label: 'Security', icon: 'lock' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'copy' },
  { id: 'ai', label: 'AI', icon: 'sparkle' },
  { id: 'about', label: 'About', icon: 'globe' },
]

const SHORTCUTS: Array<[string, string]> = [
  ['New tab', 'Ctrl+T'],
  ['New window', 'Ctrl+N'],
  ['New private window', 'Ctrl+Shift+N'],
  ['Close tab', 'Ctrl+W'],
  ['Reopen closed tab', 'Ctrl+Shift+T'],
  ['Next tab', 'Ctrl+Tab'],
  ['Previous tab', 'Ctrl+Shift+Tab'],
  ['Focus address bar', 'Ctrl+L'],
  ['Find in page', 'Ctrl+F'],
  ['Find next / previous', 'F3 / Shift+F3'],
  ['Reload', 'Ctrl+R'],
  ['Force reload', 'Ctrl+Shift+R'],
  ['Stop loading', 'Esc'],
  ['Back / forward', 'Alt+Left / Alt+Right'],
  ['Home', 'Alt+Home'],
  ['History', 'Ctrl+H'],
  ['Downloads', 'Ctrl+J'],
  ['Bookmarks bar', 'Ctrl+Shift+B'],
  ['AI sidebar', 'Ctrl+Shift+A'],
  ['Zoom in / out / reset', 'Ctrl+= / Ctrl+- / Ctrl+0'],
  ['Full screen', 'F11'],
  ['Print', 'Ctrl+P'],
  ['View source', 'Ctrl+U'],
  ['Developer tools', 'F12'],
]

const ACCENTS = ['#7aa2f7', '#8fbf8f', '#d7a86e', '#c98bb9', '#7ec8c8', '#b8b8c8']

export const SettingsPage: React.FC<SettingsPageProps> = ({
  isOpen,
  onClose,
  initialSection,
  settings,
  searchEngines,
  appInfo,
  onSave,
  onClearData,
  onOpenAI,
}) => {
  const [section, setSection] = useState<SettingsSection>(initialSection)
  const [draft, setDraft] = useState<AppSettingsDTO>(settings)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ kind: 'info' | 'error' | 'success'; text: string } | null>(null)
  const [clearOptions, setClearOptions] = useState({ history: true, cookies: false, cache: true, permissions: false })

  useEffect(() => {
    if (isOpen) {
      setSection(initialSection)
      setDraft(settings)
      setStatus(null)
    }
  }, [isOpen, initialSection, settings])

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings), [draft, settings])

  if (!isOpen) return null

  const patch = (updates: Partial<AppSettingsDTO>) => setDraft((current) => ({ ...current, ...updates }))

  const save = async () => {
    setSaving(true)
    setStatus(null)
    try {
      await onSave(draft)
      setStatus({ kind: 'success', text: 'Settings saved.' })
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  const clearData = async () => {
    if (!window.confirm('Clear the selected browsing data for this window?')) return
    setSaving(true)
    setStatus(null)
    try {
      await onClearData(clearOptions)
      setStatus({ kind: 'success', text: 'Selected data cleared.' })
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="settings-dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Settings">
        <header className="dialog-header">
          <div>
            <h2>Settings</h2>
            <p>Changes are stored in your local profile.</p>
          </div>
          <div className="dialog-header-actions">
            {dirty && <span className="dirty-dot" title="Unsaved changes" />}
            <button className="primary-btn small" disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button className="icon-btn" onClick={onClose} title="Close settings">
              <Icon name="close" />
            </button>
          </div>
        </header>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections">
            {SECTIONS.map((item) => (
              <button
                key={item.id}
                className={`settings-nav-item ${section === item.id ? 'active' : ''}`}
                onClick={() => setSection(item.id)}
              >
                <Icon name={item.icon} size={15} />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {status && <div className={`settings-status ${status.kind}`}>{status.text}</div>}

            {section === 'general' && (
              <section className="settings-section">
                <h3>Startup and navigation</h3>
                <label className="field">
                  <span>Homepage</span>
                  <input
                    value={draft.homePage}
                    onChange={(event) => patch({ homePage: event.target.value })}
                    placeholder="about:blank"
                  />
                  <small>Use about:blank for a new-tab page, or an https:// address.</small>
                </label>
                <label className="field">
                  <span>Default search engine</span>
                  <select
                    value={draft.defaultSearchEngine}
                    onChange={(event) => patch({ defaultSearchEngine: event.target.value })}
                  >
                    {searchEngines.map((engine) => (
                      <option key={engine.id} value={engine.id}>
                        {engine.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="toggle-row">
                  <span>
                    <strong>Show bookmarks bar</strong>
                    <small>Keep saved pages one click away under the toolbar.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={draft.showBookmarksBar}
                    onChange={(event) => patch({ showBookmarksBar: event.target.checked })}
                  />
                </label>
                <label className="toggle-row">
                  <span>
                    <strong>Show address suggestions</strong>
                    <small>Match history, bookmarks and open tabs while typing.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={draft.searchSuggestions}
                    onChange={(event) => patch({ searchSuggestions: event.target.checked })}
                  />
                </label>
              </section>
            )}

            {section === 'appearance' && (
              <section className="settings-section">
                <h3>Appearance</h3>
                <div className="field">
                  <span>Theme</span>
                  <div className="theme-options">
                    {(['dark', 'light', 'system'] as const).map((theme) => (
                      <button
                        key={theme}
                        className={`theme-card ${draft.theme === theme ? 'active' : ''}`}
                        onClick={() => patch({ theme })}
                      >
                        <span className={`theme-swatch ${theme}`} />
                        <span>{theme === 'system' ? 'Follow system' : theme[0].toUpperCase() + theme.slice(1)}</span>
                        {draft.theme === theme && <Icon name="check" size={14} />}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <span>Accent color</span>
                  <div className="accent-options">
                    {ACCENTS.map((color) => (
                      <button
                        key={color}
                        className={`accent-swatch ${draft.accentColor.toLowerCase() === color ? 'active' : ''}`}
                        style={{ background: color }}
                        title={color}
                        onClick={() => patch({ accentColor: color })}
                      />
                    ))}
                    <input
                      type="color"
                      value={draft.accentColor}
                      onChange={(event) => patch({ accentColor: event.target.value })}
                      title="Custom accent color"
                    />
                  </div>
                </div>
                <label className="field">
                  <span>Interface density</span>
                  <select
                    value={draft.density}
                    onChange={(event) => patch({ density: event.target.value as AppSettingsDTO['density'] })}
                  >
                    <option value="compact">Compact</option>
                    <option value="normal">Normal</option>
                    <option value="comfortable">Comfortable</option>
                  </select>
                </label>
                <p className="settings-note">
                  Ariadne is designed dark-first. The accent color is used for focus rings, active tabs and AI affordances only.
                </p>
              </section>
            )}

            {section === 'search' && (
              <section className="settings-section">
                <h3>Search engines</h3>
                <p className="settings-note">
                  The address bar treats input without a host as a search. Choose which engine receives it.
                </p>
                <div className="engine-list">
                  {searchEngines.map((engine) => (
                    <label key={engine.id} className={`engine-row ${draft.defaultSearchEngine === engine.id ? 'active' : ''}`}>
                      <input
                        type="radio"
                        name="default-engine"
                        checked={draft.defaultSearchEngine === engine.id}
                        onChange={() => patch({ defaultSearchEngine: engine.id })}
                      />
                      <span className="engine-copy">
                        <strong>{engine.name}</strong>
                        <span>{engine.url.replace('%s', '…')}</span>
                      </span>
                      <span className="engine-keyword">{engine.keyword}</span>
                    </label>
                  ))}
                </div>
              </section>
            )}

            {section === 'privacy' && (
              <section className="settings-section">
                <h3>Privacy and security</h3>
                <label className="toggle-row">
                  <span>
                    <strong>Send “Do Not Track”</strong>
                    <small>Ask sites not to track this browser. Sites may ignore it.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={draft.doNotTrack}
                    onChange={(event) => patch({ doNotTrack: event.target.checked })}
                  />
                </label>
                <label className="toggle-row">
                  <span>
                    <strong>DNS over HTTPS (DoH)</strong>
                    <small>Encrypt DNS queries via Google DNS (dns.google). Prevents ISP snooping on domains you visit.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={draft.dnsOverHttps}
                    onChange={(event) => patch({ dnsOverHttps: event.target.checked })}
                  />
                </label>
                <label className="toggle-row">
                  <span>
                    <strong>Clear browsing data on exit</strong>
                    <small>History and site storage for normal windows are removed when Ariadne quits.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={draft.clearOnExit}
                    onChange={(event) => patch({ clearOnExit: event.target.checked })}
                  />
                </label>

                <div className="settings-subsection">
                  <h4>Clear browsing data now</h4>
                  <div className="check-grid">
                    {(
                      [
                        ['history', 'History'],
                        ['cookies', 'Cookies and site data'],
                        ['cache', 'Cache'],
                        ['permissions', 'Site permissions'],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={clearOptions[key]}
                          onChange={(event) => setClearOptions((current) => ({ ...current, [key]: event.target.checked }))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <button className="danger-btn small" disabled={saving} onClick={() => void clearData()}>
                    <Icon name="trash" size={13} /> Clear selected data
                  </button>
                  <p className="settings-note">
                    Private windows already use an isolated, in-memory profile that is discarded when the window closes.
                  </p>
                </div>
              </section>
            )}

            {section === 'security' && (
              <section className="settings-section">
                <h3>Security</h3>

                <div className="settings-subsection">
                  <h4>Safe Browsing</h4>
                  <p className="settings-note">
                    Protects against dangerous sites, downloads, and extensions. Enhanced mode sends hashed URL prefixes to Safe Browsing API.
                  </p>
                  <div className="radio-group">
                    {(['enhanced', 'standard', 'none'] as const).map((mode) => (
                      <label key={mode} className="radio-row">
                        <input
                          type="radio"
                          name="safeBrowsing"
                          checked={draft.safeBrowsing === mode}
                          onChange={() => patch({ safeBrowsing: mode })}
                        />
                        <div>
                          <strong>
                            {mode === 'enhanced' ? 'Enhanced protection' : mode === 'standard' ? 'Standard protection' : 'No protection (not recommended)'}
                          </strong>
                          <small>
                            {mode === 'enhanced'
                              ? 'Real-time, AI-powered protection. Sends hashed URL prefixes to Safe Browsing API.'
                              : mode === 'standard'
                              ? 'Protects against known dangerous sites. Sends obfuscated URL portions via privacy server.'
                              : 'Does not protect against dangerous websites.'}
                          </small>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="settings-subsection">
                  <h4>Secure Connections</h4>
                  <label className="toggle-row">
                    <span>
                      <strong>Always use secure connections (HTTPS-Only)</strong>
                      <small>Upgrade all HTTP requests to HTTPS. Blocks connections that cannot be upgraded.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={draft.httpsOnly}
                      onChange={(event) => patch({ httpsOnly: event.target.checked })}
                    />
                  </label>
                  <label className="toggle-row">
                    <span>
                      <strong>Warn for insecure sites</strong>
                      <small>Show a warning before visiting HTTP sites (including private networks like intranet).</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={draft.warnInsecure}
                      onChange={(event) => patch({ warnInsecure: event.target.checked })}
                    />
                  </label>
                </div>

                <div className="settings-subsection">
                  <h4>Passwords</h4>
                  <label className="toggle-row">
                    <span>
                      <strong>Warn if password was compromised in a data breach</strong>
                      <small>Checks passwords against HaveIBeenPwned using k-anonymity (only first 5 chars of SHA-1 hash sent).</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={draft.passwordBreachCheck}
                      onChange={(event) => patch({ passwordBreachCheck: event.target.checked })}
                    />
                  </label>
                </div>

                <div className="settings-subsection">
                  <h4>Content Blocking</h4>
                  <label className="toggle-row">
                    <span>
                      <strong>Block ads</strong>
                      <small>Blocks ad networks using EasyList (updated automatically).</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={draft.blockAds}
                      onChange={(event) => patch({ blockAds: event.target.checked })}
                    />
                  </label>
                  <label className="toggle-row">
                    <span>
                      <strong>Block trackers</strong>
                      <small>Blocks tracking scripts using EasyPrivacy (updated automatically).</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={draft.blockTrackers}
                      onChange={(event) => patch({ blockTrackers: event.target.checked })}
                    />
                  </label>
                  <button className="secondary-btn small" onClick={() => void window.electronAPI.security.refreshAdBlock()}>
                    <Icon name="refresh" size={13} /> Update block lists now
                  </button>
                </div>

                <div className="settings-subsection">
                  <h4>Downloads</h4>
                  <label className="toggle-row">
                    <span>
                      <strong>Scan downloads for malware</strong>
                      <small>Checks file hashes against local threat database (placeholder for VirusTotal integration).</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={draft.downloadScanning}
                      onChange={(event) => patch({ downloadScanning: event.target.checked })}
                    />
                  </label>
                </div>

                <div className="settings-subsection">
                  <h4>Certificates</h4>
                  <button className="secondary-btn small" onClick={() => window.electronAPI.app.openExternal('chrome://settings/certificates')}>
                    <Icon name="shield" size={13} /> Manage certificates
                  </button>
                  <p className="settings-note">
                    Opens the Chromium certificate manager for HTTPS/SSL certificates.
                  </p>
                </div>
              </section>
            )}

            {section === 'shortcuts' && (
              <section className="settings-section">
                <h3>Keyboard shortcuts</h3>
                <p className="settings-note">
                  These accelerators are registered by the application menu, so they work while Ariadne is focused and do not capture keys system-wide.
                </p>
                <div className="shortcut-table">
                  {SHORTCUTS.map(([action, keys]) => (
                    <div key={action} className="shortcut-row">
                      <span>{action}</span>
                      <span className="shortcut-keys">
                        {keys.split(' / ').map((combination) =>
                          combination.split('+').map((key) => <kbd key={`${action}-${combination}-${key}`}>{key}</kbd>)
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {section === 'ai' && (
              <section className="settings-section">
                <h3>AI</h3>
                <p className="settings-note">
                  Providers, API keys, model slots and the system prompt live in the AI sidebar so you can see the active routing while you chat.
                </p>
                <div className="settings-actions">
                  <button className="primary-btn small" onClick={onOpenAI}>
                    <Icon name="sparkle" size={14} /> Open AI sidebar
                  </button>
                </div>
                <div className="settings-subsection">
                  <h4>How context is handled</h4>
                  <ul className="settings-list">
                    <li>Only the page you explicitly include is extracted for chat.</li>
                    <li>Cross-tab context is extracted locally and previewed before anything is sent.</li>
                    <li>Private tabs are never extracted, and private windows are excluded from history and downloads.</li>
                    <li>Answers from cross-tab context carry citations with the source tab and URL.</li>
                  </ul>
                </div>
              </section>
            )}

            {section === 'about' && (
              <section className="settings-section">
                <h3>About Ariadne</h3>
                <div className="about-block">
                  <span className="about-mark">
                    <Icon name="sparkle" size={22} />
                  </span>
                  <div>
                    <strong>Ariadne Browser</strong>
                    <p>Version {appInfo?.appVersion || '0.1.0'} · Electron {appInfo?.electron || 'unknown'}</p>
                    <p>An AI-native desktop browser built with Electron, React and TypeScript.</p>
                  </div>
                </div>
                <div className="about-links">
                  <button
                    className="text-btn"
                    onClick={() => void window.electronAPI.app.openExternal('https://github.com/Rafiadnan0666/ariadne')}
                  >
                    Source repository <Icon name="external" size={12} />
                  </button>
                  <button
                    className="text-btn"
                    onClick={() => void window.electronAPI.app.openExternal('https://github.com/Rafiadnan0666/ariadne/issues')}
                  >
                    Report an issue <Icon name="external" size={12} />
                  </button>
                </div>
                <details className="technical-details">
                  <summary>Technical details</summary>
                  <pre>
                    {JSON.stringify(
                      {
                        electron: appInfo?.electron,
                        chrome: appInfo?.chrome,
                        node: appInfo?.node,
                        v8: appInfo?.v8,
                        platform: appInfo?.platform,
                        arch: appInfo?.arch,
                      },
                      null,
                      2
                    )}
                  </pre>
                </details>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
