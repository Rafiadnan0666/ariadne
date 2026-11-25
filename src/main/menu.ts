import { app, BrowserWindow, Menu, MenuItemConstructorOptions } from 'electron'

export type ShortcutAction =
  | 'new-tab'
  | 'new-window'
  | 'new-private-window'
  | 'close-tab'
  | 'reopen-closed-tab'
  | 'next-tab'
  | 'prev-tab'
  | 'focus-address'
  | 'find-in-page'
  | 'find-next'
  | 'find-prev'
  | 'reload'
  | 'force-reload'
  | 'stop'
  | 'back'
  | 'forward'
  | 'home'
  | 'open-downloads'
  | 'open-history'
  | 'toggle-bookmarks'
  | 'toggle-ai'
  | 'devtools'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'fullscreen'
  | 'print'
  | 'view-source'
  | 'about'

function send(action: ShortcutAction): void {
  const window = BrowserWindow.getFocusedWindow()
  if (!window || window.isDestroyed()) return
  window.webContents.send('shortcut', action)
}

function item(
  label: string,
  accelerator: string | undefined,
  action: ShortcutAction,
  extra: Partial<MenuItemConstructorOptions> = {}
): MenuItemConstructorOptions {
  return { label, accelerator, click: () => send(action), ...extra }
}

export function installApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        item('New Tab', 'CmdOrCtrl+T', 'new-tab'),
        item('New Window', 'CmdOrCtrl+N', 'new-window'),
        item('New Private Window', 'CmdOrCtrl+Shift+N', 'new-private-window'),
        { type: 'separator' },
        item('Close Tab', 'CmdOrCtrl+W', 'close-tab'),
        item('Reopen Closed Tab', 'CmdOrCtrl+Shift+T', 'reopen-closed-tab'),
        { type: 'separator' },
        item('Print…', 'CmdOrCtrl+P', 'print'),
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        item('Reload', 'CmdOrCtrl+R', 'reload'),
        item('Force Reload', 'CmdOrCtrl+Shift+R', 'force-reload'),
        item('Stop Loading', undefined, 'stop'),
        { type: 'separator' },
        item('Zoom In', 'CmdOrCtrl+=', 'zoom-in'),
        item('Zoom Out', 'CmdOrCtrl+-', 'zoom-out'),
        item('Reset Zoom', 'CmdOrCtrl+0', 'zoom-reset'),
        { type: 'separator' },
        item('Toggle Full Screen', 'F11', 'fullscreen'),
        item('Toggle Bookmarks Bar', 'CmdOrCtrl+Shift+B', 'toggle-bookmarks'),
        item('Toggle AI Sidebar', 'CmdOrCtrl+Shift+A', 'toggle-ai'),
        { type: 'separator' },
        item('Developer Tools', 'F12', 'devtools'),
      ],
    },
    {
      label: 'History',
      submenu: [
        item('Back', 'Alt+Left', 'back'),
        item('Forward', 'Alt+Right', 'forward'),
        item('Home', 'Alt+Home', 'home'),
        { type: 'separator' },
        item('Show History', 'CmdOrCtrl+H', 'open-history'),
        item('Show Downloads', 'CmdOrCtrl+J', 'open-downloads'),
        { type: 'separator' },
        item('Focus Address Bar', 'CmdOrCtrl+L', 'focus-address'),
      ],
    },
    {
      label: 'Tabs',
      submenu: [
        item('Next Tab', 'Ctrl+Tab', 'next-tab'),
        item('Previous Tab', 'Ctrl+Shift+Tab', 'prev-tab'),
        item('Find in Page', 'CmdOrCtrl+F', 'find-in-page'),
        item('Find Next', 'F3', 'find-next'),
        item('Find Previous', 'Shift+F3', 'find-prev'),
        item('View Source', 'CmdOrCtrl+U', 'view-source'),
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Ariadne',
          click: () => {
            const window = BrowserWindow.getFocusedWindow()
            window?.webContents.send('shortcut', 'about')
          },
        },
      ],
    },
  ]

  // macOS needs an application menu with standard roles.
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    })
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
