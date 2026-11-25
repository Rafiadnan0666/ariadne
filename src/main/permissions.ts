import { BrowserWindow, Session, WebContents } from 'electron'
import Store from 'electron-store'
import { randomUUID } from 'crypto'

type PermissionSetting = 'grant' | 'deny'

interface PendingPermission {
  callback: (granted: boolean) => void
  windowId: number
  timeout: NodeJS.Timeout
}

const store = new Store({ name: 'permissions' }) as unknown as {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

const decisions = new Map<string, PermissionSetting>()
const pending = new Map<string, PendingPermission>()

function key(origin: string, permission: string): string {
  return `${origin}|${permission}`
}

function originOf(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

export function initPermissions(): void {
  const saved = store.get('decisions')
  if (saved && typeof saved === 'object') {
    for (const [entry, value] of Object.entries(saved as Record<string, unknown>)) {
      if (value === 'grant' || value === 'deny') decisions.set(entry, value)
    }
  }
}

export function getPermissionDecisions(): Record<string, PermissionSetting> {
  return Object.fromEntries(decisions)
}

export function respondToPermission(id: string, granted: boolean, remember: boolean): boolean {
  const request = pending.get(id)
  if (!request) return false
  clearTimeout(request.timeout)
  pending.delete(id)
  request.callback(granted)

  if (remember) {
    const entry = pendingOrigins.get(id)
    if (entry) {
      decisions.set(key(entry.origin, entry.permission), granted ? 'grant' : 'deny')
      pendingOrigins.delete(id)
      persist()
    }
  } else {
    pendingOrigins.delete(id)
  }
  return true
}

const pendingOrigins = new Map<string, { origin: string; permission: string }>()

export function clearPermissionDecisions(origin?: string): void {
  if (!origin) {
    decisions.clear()
  } else {
    for (const entry of Array.from(decisions.keys())) {
      if (entry.startsWith(`${origin}|`)) decisions.delete(entry)
    }
  }
  persist()
}

function persist(): void {
  store.set('decisions', Object.fromEntries(decisions))
}

function shellWindowFor(contents: WebContents): BrowserWindow | null {
  const host = contents.hostWebContents
  if (host) return BrowserWindow.fromWebContents(host)
  return BrowserWindow.fromWebContents(contents)
}

export function configureSessionPermissions(session: Session, isPrivateWindow: (windowId: number) => boolean): void {
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const origin = originOf(details.requestingUrl || contents.getURL())
    if (!origin) {
      callback(false)
      return
    }

    const remembered = decisions.get(key(origin, permission))
    if (remembered) {
      callback(remembered === 'grant')
      return
    }

    const window = shellWindowFor(contents)
    if (!window || window.isDestroyed()) {
      callback(false)
      return
    }

    const id = randomUUID()
    pendingOrigins.set(id, { origin, permission })
    const timeout = setTimeout(() => {
      const request = pending.get(id)
      if (!request) return
      pending.delete(id)
      pendingOrigins.delete(id)
      request.callback(false)
    }, 30_000)

    pending.set(id, { callback, windowId: window.id, timeout })
    window.webContents.send('permission-request', { id, origin, permission })
    if (isPrivateWindow(window.id)) {
      // Never persist a decision made inside a private window.
      pendingOrigins.delete(id)
    }
  })
}

export function denyPendingForWindow(windowId: number): void {
  for (const [id, request] of Array.from(pending.entries())) {
    if (request.windowId !== windowId) continue
    clearTimeout(request.timeout)
    pending.delete(id)
    pendingOrigins.delete(id)
    request.callback(false)
  }
}
