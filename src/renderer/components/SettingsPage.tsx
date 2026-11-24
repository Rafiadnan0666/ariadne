import React, { useState, useEffect, useCallback } from 'react';

interface SettingsPageProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_SHORTCUTS = [
  { action: 'New Tab', keys: 'Ctrl+T', editable: true },
  { action: 'New Window', keys: 'Ctrl+N', editable: true },
  { action: 'New Private Window', keys: 'Ctrl+Shift+N', editable: true },
  { action: 'Close Tab', keys: 'Ctrl+W', editable: true },
  { action: 'Reopen Closed Tab', keys: 'Ctrl+Shift+T', editable: true },
  { action: 'Next Tab', keys: 'Ctrl+Tab', editable: true },
  { action: 'Previous Tab', keys: 'Ctrl+Shift+Tab', editable: true },
  { action: 'Focus Address Bar', keys: 'Ctrl+L / F6', editable: true },
  { action: 'Find in Page', keys: 'Ctrl+F', editable: true },
  { action: 'Find Next', keys: 'F3 / Ctrl+G', editable: true },
  { action: 'Find Previous', keys: 'Shift+F3 / Ctrl+Shift+G', editable: true },
  { action: 'Reload', keys: 'F5 / Ctrl+R', editable: true },
  { action: 'Force Reload', keys: 'Ctrl+Shift+R', editable: true },
  { action: 'Stop Loading', keys: 'Esc', editable: true },
  { action: 'Go Back', keys: 'Alt+Left', editable: true },
  { action: 'Go Forward', keys: 'Alt+Right', editable: true },
  { action: 'Home', keys: 'Alt+Home', editable: true },
  { action: 'Open Downloads', keys: 'Ctrl+J', editable: true },
  { action: 'Open History', keys: 'Ctrl+H', editable: true },
  { action: 'Open Bookmarks', keys: 'Ctrl+Shift+B', editable: true },
  { action: 'Toggle AI Sidebar', keys: 'Ctrl+Shift+A', editable: true },
  { action: 'Open DevTools', keys: 'F12 / Ctrl+Shift+I', editable: true },
  { action: 'Zoom In', keys: 'Ctrl++', editable: true },
  { action: 'Zoom Out', keys: 'Ctrl+-', editable: true },
  { action: 'Reset Zoom', keys: 'Ctrl+0', editable: true },
  { action: 'Fullscreen', keys: 'F11', editable: true },
  { action: 'Print', keys: 'Ctrl+P', editable: true },
  { action: 'View Source', keys: 'Ctrl+U', editable: true },
];

export const SettingsPage: React.FC<SettingsPageProps> = ({ isOpen, onClose }) => {
  const [activeSection, setActiveSection] = useState<'general' | 'appearance' | 'search' | 'privacy' | 'shortcuts' | 'ai' | 'about'>('general');
  const [settings, setSettings] = useState({
    theme: 'dark' as 'light' | 'dark' | 'system',
    accentColor: '#4285f4',
    density: 'normal' as 'compact' | 'normal' | 'comfortable',
    showBookmarksBar: true,
    homePage: 'https://example.com',
    defaultSearchEngine: 'google',
    searchSuggestions: true,
    clearOnExit: false,
    doNotTrack: true,
    blockThirdPartyCookies: false,
    hardwareAcceleration: true,
    shortcuts: DEFAULT_SHORTCUTS,
  });
  const [editingShortcut, setEditingShortcut] = useState<string | null>(null);
  const [editKeys, setEditKeys] = useState('');

  const sections = [
    { id: 'general', label: 'General', icon: '⚙' },
    { id: 'appearance', label: 'Appearance', icon: '🎨' },
    { id: 'search', label: 'Search', icon: '🔍' },
    { id: 'privacy', label: 'Privacy & Security', icon: '🔒' },
    { id: 'shortcuts', label: 'Shortcuts', icon: '⌨' },
    { id: 'ai', label: 'AI', icon: '🤖' },
    { id: 'about', label: 'About', icon: 'ℹ' },
  ];

  const searchEngines = [
    { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s', keyword: 'g' },
    { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', keyword: 'd' },
    { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s', keyword: 'b' },
    { id: 'brave', name: 'Brave Search', url: 'https://search.brave.com/search?q=%s', keyword: 'br' },
    { id: 'startpage', name: 'Startpage', url: 'https://www.startpage.com/sp/search?q=%s', keyword: 'sp' },
    { id: 'wikipedia', name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=%s', keyword: 'w' },
  ];

  return (
    <div className="settings-page-overlay" onClick={onClose}>
      <div className="settings-page" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>
        <div className="settings-body">
          <nav className="settings-nav">
            {sections.map(section => (
              <button
                key={section.id}
                className={`settings-nav-item ${activeSection === section.id ? 'active' : ''}`}
                onClick={() => setActiveSection(section.id as typeof activeSection)}
              >
                <span>{section.icon}</span>
                <span>{section.label}</span>
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {activeSection === 'general' && (
              <div className="settings-section">
                <h3>General</h3>
                <div className="setting-group">
                  <label>Homepage</label>
                  <input
                    type="text"
                    value={settings.homePage}
                    onChange={e => setSettings(s => ({ ...s, homePage: e.target.value }))}
                    placeholder="https://example.com"
                  />
                </div>
                <div className="setting-group">
                  <label>Default Search Engine</label>
                  <select
                    value={settings.defaultSearchEngine}
                    onChange={e => setSettings(s => ({ ...s, defaultSearchEngine: e.target.value }))}
                  >
                    {searchEngines.map(engine => (
                      <option key={engine.id} value={engine.id}>{engine.name}</option>
                    ))}
                  </select>
                </div>
                <div className="setting-group checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.showBookmarksBar}
                      onChange={e => setSettings(s => ({ ...s, showBookmarksBar: e.target.checked }))}
                    />
                    Show Bookmarks Bar
                  </label>
                </div>
                <div className="setting-group checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.searchSuggestions}
                      onChange={e => setSettings(s => ({ ...s, searchSuggestions: e.target.checked }))}
                    />
                    Show Search Suggestions
                  </label>
                </div>
                <div className="setting-group checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.hardwareAcceleration}
                      onChange={e => setSettings(s => ({ ...s, hardwareAcceleration: e.target.checked }))}
                    />
                    Use Hardware Acceleration (requires restart)
                  </label>
                </div>
              </div>
            )}

            {activeSection === 'appearance' && (
              <div className="settings-section">
                <h3>Appearance</h3>
                <div className="setting-group">
                  <label>Theme</label>
                  <select
                    value={settings.theme}
                    onChange={e => setSettings(s => ({ ...s, theme: e.target.value as 'light' | 'dark' | 'system' }))}
                  >
                    <option value="system">System Default</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>
                <div className="setting-group">
                  <label>Accent Color</label>
                  <div className="color-picker-wrapper">
                    <input
                      type="color"
                      value={settings.accentColor}
                      onChange={e => setSettings(s => ({ ...s, accentColor: e.target.value }))}
                    />
                    <span>{settings.accentColor}</span>
                  </div>
                </div>
                <div className="setting-group">
                  <label>Density</label>
                  <select
                    value={settings.density}
                    onChange={e => setSettings(s => ({ ...s, density: e.target.value as 'compact' | 'normal' | 'comfortable' }))}
                  >
                    <option value="compact">Compact</option>
                    <option value="normal">Normal</option>
                    <option value="comfortable">Comfortable</option>
                  </select>
                </div>
                <div className="setting-group checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.hardwareAcceleration}
                      onChange={e => setSettings(s => ({ ...s, hardwareAcceleration: e.target.checked }))}
                    />
                    Hardware Acceleration
                  </label>
                </div>
              </div>
            )}

            {activeSection === 'search' && (
              <div className="settings-section">
                <h3>Search Engines</h3>
                <p className="setting-description">Manage search engines and keywords. Use %s as the query placeholder.</p>
                <table className="search-engines-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Keyword</th>
                      <th>URL Template</th>
                      <th>Default</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchEngines.map(engine => (
                      <tr key={engine.id}>
                        <td>{engine.name}</td>
                        <td><input type="text" value={engine.keyword} readOnly size={4} /></td>
                        <td><input type="text" value={engine.url} readOnly style={{ minWidth: '300px' }} /></td>
                        <td>{settings.defaultSearchEngine === engine.id ? '✓' : ''}</td>
                        <td>
                          <button onClick={() => setSettings(s => ({ ...s, defaultSearchEngine: engine.id }))} disabled={settings.defaultSearchEngine === engine.id}>
                            Make Default
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="btn-primary" onClick={() => alert('Add custom search engine - TBD')}>+ Add Search Engine</button>
              </div>
            )}

            {activeSection === 'privacy' && (
              <div className="settings-section">
                <h3>Privacy & Security</h3>
                <div className="setting-group checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.doNotTrack}
                      onChange={e => setSettings(s => ({ ...s, doNotTrack: e.target.checked }))}
                    />
                    Send "Do Not Track" request
                  </label>
                </div>
                <div className="setting-group checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.blockThirdPartyCookies}
                      onChange={e => setSettings(s => ({ ...s, blockThirdPartyCookies: e.target.checked }))}
                    />
                    Block third-party cookies
                  </label>
                </div>
                <div className="setting-group checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.clearOnExit}
                      onChange={e => setSettings(s => ({ ...s, clearOnExit: e.target.checked }))}
                    />
                    Clear browsing data on exit
                  </label>
                </div>
                <div className="setting-group">
                  <button className="btn-danger" onClick={() => alert('Clear browsing data - TBD')}>Clear Browsing Data...</button>
                </div>
                <div className="setting-group">
                  <button className="btn-secondary" onClick={() => alert('Site settings - TBD')}>Site Settings...</button>
                </div>
                <div className="setting-group">
                  <button className="btn-secondary" onClick={() => alert('Certificates - TBD')}>Manage Certificates...</button>
                </div>
              </div>
            )}

            {activeSection === 'shortcuts' && (
              <div className="settings-section">
                <h3>Keyboard Shortcuts</h3>
                <p className="setting-description">Click a shortcut to edit. Press the new key combination.</p>
                <table className="shortcuts-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Shortcut</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settings.shortcuts.map((shortcut, i) => (
                      <tr key={shortcut.action}>
                        <td>{shortcut.action}</td>
                        <td>
                          {editingShortcut === shortcut.action ? (
                            <input
                              type="text"
                              value={editKeys}
                              onChange={e => setEditKeys(e.target.value)}
                              onKeyDown={e => {
                                e.preventDefault();
                                const keys = [];
                                if (e.ctrlKey) keys.push('Ctrl');
                                if (e.metaKey) keys.push('Cmd');
                                if (e.shiftKey) keys.push('Shift');
                                if (e.altKey) keys.push('Alt');
                                if (e.key !== 'Control' && e.key !== 'Meta' && e.key !== 'Shift' && e.key !== 'Alt') {
                                  keys.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
                                }
                                setEditKeys(keys.join('+'));
                              }}
                              onBlur={() => {
                                if (editKeys) {
                                  setSettings(s => ({
                                    ...s,
                                    shortcuts: s.shortcuts.map(sc => sc.action === shortcut.action ? { ...sc, keys: editKeys } : sc)
                                  }));
                                }
                                setEditingShortcut(null);
                                setEditKeys('');
                              }}
                              autoFocus
                            />
                          ) : (
                            <button
                              className="shortcut-key"
                              onClick={() => { setEditingShortcut(shortcut.action); setEditKeys(shortcut.keys); }}
                            >
                              {shortcut.keys}
                            </button>
                          )}
                        </td>
                        <td></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="btn-secondary" onClick={() => setSettings(s => ({ ...s, shortcuts: DEFAULT_SHORTCUTS }))}>
                  Reset to Defaults
                </button>
              </div>
            )}

            {activeSection === 'ai' && (
              <div className="settings-section">
                <h3>AI Settings</h3>
                <p className="setting-description">Configure AI providers, models, and behavior.</p>
                <div className="setting-group">
                  <button className="btn-primary" onClick={() => alert('AI Settings - managed in AI Sidebar')}>
                    Open AI Sidebar Settings
                  </button>
                </div>
                <div className="setting-group checkbox">
                  <label>
                    <input type="checkbox" defaultChecked />
                    Enable AI features
                  </label>
                </div>
                <div className="setting-group checkbox">
                  <label>
                    <input type="checkbox" />
                    Allow AI to access page content
                  </label>
                </div>
                <div className="setting-group checkbox">
                  <label>
                    <input type="checkbox" />
                    Stream responses
                  </label>
                </div>
              </div>
            )}

            {activeSection === 'about' && (
              <div className="settings-section">
                <h3>About Ariadne</h3>
                <div className="about-info">
                  <div className="about-logo">🕷️</div>
                  <h4>Ariadne Browser</h4>
                  <p>Version 0.1.0 (Development)</p>
                  <p>An AI-native desktop browser built with Electron, React, and TypeScript.</p>
                  <div className="about-links">
                    <a href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a>
                    <a href="https://github.com" target="_blank" rel="noopener noreferrer">Issues</a>
                    <a href="https://github.com" target="_blank" rel="noopener noreferrer">License</a>
                  </div>
                  <details>
                    <summary>Technical Details</summary>
                    <pre>{JSON.stringify({
                      electron: process.versions.electron,
                      chrome: process.versions.chrome,
                      node: process.versions.node,
                      v8: process.versions.v8,
                      platform: process.platform,
                      arch: process.arch,
                    }, null, 2)}</pre>
                  </details>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};