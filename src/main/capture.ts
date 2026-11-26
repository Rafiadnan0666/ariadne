import * as fs from 'fs'
import * as path from 'path'
import { app, BrowserWindow } from 'electron'

/**
 * Scripted UI capture used to generate the screenshots in the README and to
 * verify that the shipped renderer actually paints. Enabled only when
 * ARIADNE_CAPTURE_DIR is set, so normal runs never touch it.
 */
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function run(window: BrowserWindow, script: string): Promise<unknown> {
  return window.webContents.executeJavaScript(script)
}

async function click(window: BrowserWindow, selector: string): Promise<boolean> {
  const escaped = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return (await run(
    window,
    `(() => { const el = document.querySelector('${escaped}'); if (el) { el.click(); return true } return false })()`
  )) as boolean
}

async function clickText(window: BrowserWindow, text: string): Promise<boolean> {
  const escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return (await run(
    window,
    `(() => {
      const target = Array.from(document.querySelectorAll('button, [role="tab"], a'))
        .find((el) => (el.textContent || '').trim() === '${escaped}')
      if (target) { target.click(); return true }
      return false
    })()`
  )) as boolean
}

async function selectLabel(window: BrowserWindow, label: string, value: string): Promise<boolean> {
  const escapedLabel = label.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const escapedValue = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return (await run(
    window,
    `(() => {
      const labels = Array.from(document.querySelectorAll('label'))
      const label = labels.find((el) => (el.querySelector('span')?.textContent || '').trim() === '${escapedLabel}')
      const select = label?.querySelector('select')
      if (!select) return false
      select.value = '${escapedValue}'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`
  )) as boolean
}

async function fillLabel(window: BrowserWindow, label: string, value: string): Promise<boolean> {
  const escapedLabel = label.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const escapedValue = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return (await run(
    window,
    `(() => {
      const labels = Array.from(document.querySelectorAll('label'))
      const label = labels.find((el) => (el.querySelector('span')?.textContent || '').trim() === '${escapedLabel}')
      const input = label?.querySelector('input, textarea')
      if (!input) return false
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
      setter.call(input, '${escapedValue}')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`
  )) as boolean
}

async function typeInto(window: BrowserWindow, selector: string, text: string, stepMs = 70): Promise<void> {
  const escaped = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  await run(window, `document.querySelector('${escaped}')?.focus()`)
  for (const character of text) {
    const escapedChar = character.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    await run(
      window,
      `(() => {
        const input = document.querySelector('${escaped}')
        if (!input) return false
        const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
        setter.call(input, input.value + '${escapedChar}')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`
    )
    await delay(stepMs)
  }
}

export async function runDemo(frameDirectory: string, getWindow: () => BrowserWindow | undefined): Promise<void> {
  fs.mkdirSync(frameDirectory, { recursive: true })

  const deadline = Date.now() + 20000
  let window = getWindow()
  while (!window && Date.now() < deadline) {
    await delay(200)
    window = getWindow()
  }
  if (!window) {
    console.error('[demo] no window available')
    app.quit()
    return
  }

  let frame = 0
  let capturing = false
  let recording = true
  const startedAt = Date.now()

  const timer = setInterval(() => {
    if (!recording || capturing || !window || window.isDestroyed()) return
    capturing = true
    window.webContents
      .capturePage()
      .then((image) => {
        fs.writeFileSync(path.join(frameDirectory, `frame-${String(frame++).padStart(4, '0')}.png`), image.toPNG())
      })
      .catch(() => undefined)
      .finally(() => {
        capturing = false
      })
  }, 320)

  try {
    await delay(2200)

    // Type a real search query into the new tab page and open it.
    await typeInto(window, '.ntp-search input', 'badak sumatera meninggal setelah dipindahkan indonesia', 60)
    await delay(400)
    await run(window, `document.querySelector('.ntp-search')?.requestSubmit()`)
    await delay(5000)

    // Open the assistant and its configuration panel.
    await click(window, '[aria-label="Toggle AI sidebar"]')
    await delay(1400)
    await click(window, '[title="AI settings"]')
    await delay(1000)
    await run(window, `document.querySelector('.ai-settings') && (document.querySelector('.ai-settings').scrollTop = 420)`)
    await delay(900)

    // Add a local provider without an API key.
    await clickText(window, '+ Add provider')
    await delay(700)
    await selectLabel(window, 'Type', 'lmstudio')
    await delay(400)
    await fillLabel(window, 'Model ID', 'llama-3.1-8b-instruct')
    await fillLabel(window, 'Model label', 'Llama 3.1 8B (local)')
    await delay(500)
    await clickText(window, 'Add provider')
    await delay(1800)

    // Full settings and appearance.
    await click(window, '[aria-label="Toggle AI sidebar"]')
    await delay(500)
    await click(window, '[aria-label="Settings"]')
    await delay(1200)
    await clickText(window, 'Appearance')
    await delay(1100)
    await click(window, '[title="Close settings"]')
    await delay(900)
  } finally {
    recording = false
    clearInterval(timer)
    await delay(600)
    const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
    fs.writeFileSync(
      path.join(frameDirectory, 'meta.json'),
      JSON.stringify({ frames: frame, seconds, fps: frame / seconds }, null, 2)
    )
    console.log(`[demo] ${frame} frames over ${seconds}s`)
    await run(
      window,
      `window.electronAPI.ai.getProviders().then((list) => Promise.all(list.map((p) => window.electronAPI.ai.removeProvider(p.id))))`
    ).catch(() => undefined)
    app.quit()
  }
}

export async function runCapture(directory: string, getWindow: () => BrowserWindow | undefined): Promise<void> {
  fs.mkdirSync(directory, { recursive: true })

  const deadline = Date.now() + 20000
  let window = getWindow()
  while (!window && Date.now() < deadline) {
    await delay(200)
    window = getWindow()
  }
  if (!window) {
    console.error('[capture] no window available')
    app.quit()
    return
  }

  const save = async (name: string) => {
    const image = await window!.webContents.capturePage()
    fs.writeFileSync(path.join(directory, name), image.toPNG())
    console.log(`[capture] ${name}`)
  }

  // Let the new tab page, fonts and icons settle.
  await delay(2600)
  await save('01-new-tab.png')

  // AI sidebar + provider configuration ----------------------------------
  await click(window, '[aria-label="Toggle AI sidebar"]')
  await delay(1400)
  await save('02-ai-sidebar.png')

  await click(window, '[title="AI settings"]')
  await delay(600)
  await save('03-ai-settings.png')

  await clickText(window, '+ Add provider')
  await delay(500)
  await save('04-add-provider-form.png')

  // Add a local LM Studio provider (no API key needed) end to end.
  await selectLabel(window, 'Type', 'lmstudio')
  await delay(300)
  await fillLabel(window, 'Model ID', 'llama-3.1-8b-instruct')
  await fillLabel(window, 'Model label', 'Llama 3.1 8B (local)')
  await delay(200)
  await save('05-provider-form-filled.png')
  await clickText(window, 'Add provider')
  await delay(2000)
  const providerCheck = await run(
    window,
    `Promise.all([window.electronAPI.ai.getProviders(), window.electronAPI.ai.getModelSlots()]).then(([list, slots]) => ({
      providers: list.map((p) => p.name + ':' + p.models.length),
      slots
    }))`
  )
  console.log('[capture] providers after add:', JSON.stringify(providerCheck))
  await save('06-provider-added.png')

  // Direct IPC check so a UI-only regression cannot hide a backend failure.
  const direct = await run(
    window,
    `window.electronAPI.ai.addProvider({
      id: 'capture-direct',
      name: 'Capture direct',
      type: 'lmstudio',
      baseUrl: 'http://localhost:1234/v1',
      enabled: true,
      models: [{ id: 'capture-model', name: 'Capture model', provider: 'capture-direct', capabilities: { contextWindow: 8192, supportsVision: false, supportsTools: false, supportsStreaming: true } }],
      defaultModel: 'capture-model'
    }).then(() => 'ok').catch((e) => 'error: ' + String(e))`
  )
  console.log('[capture] direct addProvider:', direct)

  // Full settings --------------------------------------------------------
  await click(window, '[aria-label="Toggle AI sidebar"]')
  await delay(300)
  await click(window, '[aria-label="Settings"]')
  await delay(900)
  await save('07-settings.png')

  await clickText(window, 'Appearance')
  await delay(600)
  await save('08-appearance-settings.png')

  await click(window, '[title="Close settings"]')
  await delay(400)

  // Real page load through the webview -----------------------------------
  const tabId = (await run(
    window,
    `window.electronAPI.tab.getAll().then((tabs) => (tabs.find((t) => t.active) || tabs[0] || {}).id)`
  )) as string | undefined
  if (tabId) {
    // Test on a heavy-ad news site
    await run(window, `window.electronAPI.tab.navigate('${tabId}', 'https://www.detik.com')`)
    await delay(8000)
    const tabState = await run(
      window,
      `window.electronAPI.tab.getAll().then((tabs) => tabs.map((t) => ({ title: t.title, url: t.url, loading: t.loading })))`
    )
    console.log('[capture] tab after navigation:', JSON.stringify(tabState))
    await save('09-web-page.png')
  }

  // Clean up the provider created by the capture run so normal usage starts
  // from a clean profile.
  await run(
    window,
    `window.electronAPI.ai.getProviders().then((list) => Promise.all(list.map((p) => window.electronAPI.ai.removeProvider(p.id))))`
  ).catch(() => undefined)

  app.quit()
}
