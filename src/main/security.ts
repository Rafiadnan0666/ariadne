import { session, Session, app, safeStorage } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { getSettings } from './index'

// --- Types ---
export type SafeBrowsingMode = 'enhanced' | 'standard' | 'none'

export interface SecurityConfig {
  safeBrowsing: SafeBrowsingMode
  httpsOnly: boolean
  warnInsecure: boolean
  passwordBreachCheck: boolean
  blockAds: boolean
  blockTrackers: boolean
  downloadScanning: boolean
}

export interface ThreatMatch {
  threatType: string
  platformType: string
  threat: { url: string }
  cacheDuration: string
}

// --- Safe Browsing (local-first, Google Safe Browsing API v4 compatible) ---
const SAFE_BROWSING_LISTS = [
  'goog-malware-shavar',
  'goog-phish-shavar',
  'goog-unwanted-shavar',
  'goog-social-shavar',
]

const SB_CACHE_DIR = path.join(app.getPath('userData'), 'safe-browsing')
const SB_UPDATE_INTERVAL = 30 * 60 * 1000 // 30 min

let sbEnabled = false
let sbMode: SafeBrowsingMode = 'standard'
let sbUpdateTimer: NodeJS.Timeout | null = null

function getSbConfig(): SecurityConfig {
  const s = getSettings()
  return {
    safeBrowsing: s.safeBrowsing,
    httpsOnly: s.httpsOnly,
    warnInsecure: s.warnInsecure,
    passwordBreachCheck: s.passwordBreachCheck,
    blockAds: s.blockAds,
    blockTrackers: s.blockTrackers,
    downloadScanning: s.downloadScanning,
  }
}

export function initSafeBrowsing(): void {
  const cfg = getSbConfig()
  sbMode = cfg.safeBrowsing
  sbEnabled = sbMode !== 'none'

  if (!sbEnabled) return

  if (!fs.existsSync(SB_CACHE_DIR)) fs.mkdirSync(SB_CACHE_DIR, { recursive: true })

  sbUpdateTimer = setInterval(updateSafeBrowsingLists, SB_UPDATE_INTERVAL)
  updateSafeBrowsingLists().catch(console.error)
}

async function updateSafeBrowsingLists(): Promise<void> {
  // Privacy-first: use local lists from https://github.com/brave/adblock-lists
  // or fetch from Google Safe Browsing API v4 (requires API key)
  // For now, we use a built-in minimal list and allow external list URLs via settings.
  // TODO: Implement full Safe Browsing API v4 client with hashed prefix matching.
  console.log('[SafeBrowsing] Lists updated (placeholder)')
}

function hashUrlPrefix(url: string, prefixSize: number): string {
  let hash = 0
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash) + url.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(16).substring(0, prefixSize)
}

export function checkUrlSafe(url: string): Promise<{ safe: boolean; threatType?: string }> {
  return new Promise((resolve) => {
    const cfg = getSbConfig()
    if (cfg.safeBrowsing === 'none') return resolve({ safe: true })

    const cached = checkLocalCache(url)
    if (cached) return resolve(cached)

    const prefix = hashUrlPrefix(url, 4)
    const isThreat = checkLocalPrefix(prefix)

    if (isThreat) {
      if (cfg.safeBrowsing === 'enhanced') {
        resolve({ safe: false, threatType: 'malware' })
      } else {
        resolve({ safe: true })
      }
    } else {
      resolve({ safe: true })
    }
  })
}

function checkLocalCache(url: string): { safe: boolean; threatType?: string } | null {
  return null
}

function checkLocalPrefix(prefix: string): boolean {
  return false
}

// --- HTTPS-Only Mode ---
export function applyHttpsOnly(ses: Session, enabled: boolean): void {
  if (!enabled) return

  ses.webRequest.onBeforeRequest(
    { urls: ['http://*/*'] },
    (details, callback) => {
      const url = details.url.replace('http://', 'https://')
      callback({ redirectURL: url })
    }
  )
}

// --- Insecure Site Warnings ---
export function applyInsecureWarnings(ses: Session, enabled: boolean, warnPrivate: boolean): void {
  if (!enabled) return

  ses.webRequest.onHeadersReceived(
    { urls: ['http://*/*'] },
    (details, callback) => {
      const isPrivate = details.url.includes('localhost') || details.url.includes('127.0.0.1') || details.url.includes('192.168.') || details.url.includes('10.') || details.url.includes('172.16.')
      if (isPrivate && !warnPrivate) {
        return callback({ cancel: false })
      }
      console.warn('[Security] Insecure HTTP navigation:', details.url)
      callback({ cancel: false })
    }
  )
}

// --- Ad/Tracker Blocking (declarativeNetRequest) ---
const ADBLOCK_RULES_FILE = path.join(app.getPath('userData'), 'adblock-rules.json')
const ADBLOCK_LIST_URLS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances.txt',
]

let adblockRules: any[] = []
let ruleIdCounter = 1

export async function initAdBlocker(ses: Session): Promise<void> {
  const cfg = getSbConfig()
  if (!cfg.blockAds && !cfg.blockTrackers) return

  await loadAdBlockRules()
  await applyAdBlockRules(ses)
}

async function loadAdBlockRules(): Promise<void> {
  if (fs.existsSync(ADBLOCK_RULES_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(ADBLOCK_RULES_FILE, 'utf-8'))
      adblockRules = data.rules || []
      ruleIdCounter = data.nextId || 1
      console.log(`[AdBlock] Loaded ${adblockRules.length} rules from cache`)
      return
    } catch {}
  }

  adblockRules = generateBuiltinRules()
  await saveAdBlockRules()
}

function generateBuiltinRules(): any[] {
  const rules: any[] = []
  let id = 1

  const blockDomains = [
    'doubleclick.net',
    'google-analytics.com',
    'googlesyndication.com',
    'facebook.net/tr',
    'adservice.google.com',
    'pagead2.googlesyndication.com',
    'analytics.google.com',
    'connect.facebook.net',
    'pixel.facebook.com',
    'bat.bing.com',
    'ads.yahoo.com',
  ]

  for (const domain of blockDomains) {
    rules.push({
      id: id++,
      priority: 1,
      action: { type: 'block' },
      condition: { urlFilter: `||${domain}^`, resourceTypes: ['script', 'image', 'xmlhttprequest', 'sub_frame'] },
    })
  }

  const cosmeticSelectors = [
    '[id^="google_ads"]',
    '[class*="ad-banner"]',
    '[class*="adsbox"]',
    '[id*="ad-banner"]',
    '.advertisement',
    '#ad-banner',
    '[data-ad-slot]',
  ]

  for (const selector of cosmeticSelectors) {
    rules.push({
      id: id++,
      priority: 1,
      action: { type: 'block', redirect: { url: 'data:text/css,/* blocked */' } },
      condition: { urlFilter: '*', resourceTypes: ['main_frame'] },
    })
  }

  ruleIdCounter = id
  return rules
}

async function saveAdBlockRules(): Promise<void> {
  fs.writeFileSync(ADBLOCK_RULES_FILE, JSON.stringify({ rules: adblockRules, nextId: ruleIdCounter }))
}

async function applyAdBlockRules(ses: Session): Promise<void> {
  if (adblockRules.length === 0) return

  try {
    // declarativeNetRequest is available on session in Electron 25+
    const dnr = (ses as any).declarativeNetRequest
    if (dnr) {
      const existing = await dnr.getDynamicRules()
      await dnr.updateDynamicRules({
        removeRuleIds: existing.map((r: any) => r.id),
        addRules: adblockRules,
      })
      console.log(`[AdBlock] Applied ${adblockRules.length} declarative rules`)
    } else {
      console.warn('[AdBlock] declarativeNetRequest not available on this Electron version')
    }
  } catch (e) {
    console.error('[AdBlock] Failed to apply rules:', e)
  }
}

export async function refreshAdBlockLists(): Promise<void> {
  adblockRules = generateBuiltinRules()
  await saveAdBlockRules()
  for (const state of (global as any).windows?.values() || []) {
    try {
      await applyAdBlockRules(session.fromPartition(state.partition))
    } catch {}
  }
}

// --- Download Scanning ---
export function initDownloadScanner(): void {
  // Hook into download manager to scan files
  // Uses local YARA rules or uploads hash to VirusTotal (privacy: hash only)
}

// --- Password Breach Checking (HaveIBeenPwned k-anonymity) ---
const HIBP_API = 'https://api.pwnedpasswords.com/range/'

export async function checkPasswordBreach(password: string): Promise<{ breached: boolean; count: number }> {
  const cfg = getSbConfig()
  if (!cfg.passwordBreachCheck) return { breached: false, count: 0 }

  const crypto = await import('crypto')
  const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase()
  const prefix = sha1.substring(0, 5)
  const suffix = sha1.substring(5)

  try {
    const response = await fetch(`${HIBP_API}${prefix}`)
    if (!response.ok) return { breached: false, count: 0 }
    const text = await response.text()
    const lines = text.split('\n')
    for (const line of lines) {
      const [hashSuffix, count] = line.split(':')
      if (hashSuffix === suffix) {
        return { breached: true, count: parseInt(count, 10) }
      }
    }
    return { breached: false, count: 0 }
  } catch {
    return { breached: false, count: 0 }
  }
}

// --- Certificate Management ---
// Note: Electron's Session doesn't expose getCertificate/importCertificate directly
// These are available via webContents or require native modules

// --- Security Headers ---
export function applySecurityHeaders(ses: Session): void {
  ses.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders || {}

    responseHeaders['X-Content-Type-Options'] = ['nosniff']
    responseHeaders['X-Frame-Options'] = ['DENY']
    responseHeaders['X-XSS-Protection'] = ['1; mode=block']
    responseHeaders['Referrer-Policy'] = ['strict-origin-when-cross-origin']
    responseHeaders['Permissions-Policy'] = ['accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()']

    callback({ responseHeaders })
  })
}

// --- Cleanup ---
export function shutdownSecurity(): void {
  if (sbUpdateTimer) {
    clearInterval(sbUpdateTimer)
    sbUpdateTimer = null
  }
}