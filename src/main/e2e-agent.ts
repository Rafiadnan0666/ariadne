import { app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as http from 'http'

/**
 * End-to-end agent verification.
 *
 * Enabled only when ARIADNE_E2E_DIR is set. It drives the shipped UI exactly
 * like a user would: adds a real provider (Ollama), enables agent mode, asks
 * the agent to perform tasks, clicks the approval buttons, and records what
 * the agent actually did. Writes a JSON report and screenshots into the
 * directory, then quits.
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
      const target = Array.from(document.querySelectorAll('button, a, [role="button"]'))
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
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
      setter.call(select, '${escapedValue}')
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return select.value === '${escapedValue}'
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

async function fillTextarea(window: BrowserWindow, selector: string, value: string): Promise<boolean> {
  const escapedSelector = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const escapedValue = JSON.stringify(value)
  return (await run(
    window,
    `(() => {
      const el = document.querySelector('${escapedSelector}')
      if (!el) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(el, ${escapedValue})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`
  )) as boolean
}

const TEST_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Ariadne Agent Test Page</title>
<style>body{font-family:system-ui;margin:40px;max-width:640px}input,button{font-size:16px;padding:8px;margin:8px 0}</style>
</head>
<body>
  <h1>Ariadne Agent Test Page</h1>
  <p>Fill the name field and press Submit.</p>
  <label for="name">Name</label>
  <input id="name" name="name" type="text" placeholder="Your name">
  <button id="submit" type="button" onclick="document.getElementById('result').textContent = 'Hello, ' + document.getElementById('name').value + '!'">Submit</button>
  <p id="result">No result yet</p>
</body>
</html>`

function startTestServer(): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(TEST_PAGE)
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => server.close(),
      })
    })
  })
}

interface ScenarioResult {
  name: string
  task: string
  passed: boolean
  finalText: string
  expected: string
  approvals: number
  steps: string[]
  durationMs: number
  error?: string
}

interface Report {
  startedAt: string
  finishedAt?: string
  providerConfigured: boolean
  providerCheck?: unknown
  scenarios: ScenarioResult[]
  passed: number
  failed: number
}

async function waitForAgentDone(window: BrowserWindow, timeoutMs: number): Promise<void> {
  const started = Date.now()
  // Give React a moment to flip into the running state.
  await delay(1200)
  while (Date.now() - started < timeoutMs) {
    const state = (await run(
      window,
      `(() => {
        const stop = Array.from(document.querySelectorAll('.ai-composer button')).find((b) => (b.textContent || '').includes('Stop Agent'))
        const approvals = document.querySelectorAll('.ai-agent-approval-actions .primary-btn').length
        return { running: Boolean(stop), approvals }
      })()`
    )) as { running: boolean; approvals: number }
    if (state.approvals > 0) {
      // Approve every pending mutating action.
      await run(
        window,
        `(() => {
          const buttons = Array.from(document.querySelectorAll('.ai-agent-approval-actions .primary-btn'))
          buttons.forEach((b) => b.click())
          return buttons.length
        })()`
      )
    }
    if (!state.running && Date.now() - started > 2500) return
    await delay(700)
  }
  throw new Error('Agent did not finish within timeout')
}

async function readAgentOutput(window: BrowserWindow): Promise<{ text: string; steps: string[]; approvals: number }> {
  return (await run(
    window,
    `(() => {
      const bodies = Array.from(document.querySelectorAll('.ai-message.assistant .ai-message-body'))
      const text = bodies.length ? (bodies[bodies.length - 1].innerText || '') : ''
      const steps = Array.from(document.querySelectorAll('.ai-agent-step-content')).map((el) => el.textContent || '')
      const approvals = document.querySelectorAll('.ai-agent-approval-item').length
      return { text, steps, approvals }
    })()`
  )) as { text: string; steps: string[]; approvals: number }
}

async function runScenario(
  window: BrowserWindow,
  directory: string,
  name: string,
  task: string,
  expected: RegExp,
  timeoutMs: number,
  screenshotName: string
): Promise<ScenarioResult> {
  const started = Date.now()
  const result: ScenarioResult = {
    name,
    task,
    passed: false,
    finalText: '',
    expected: expected.source,
    approvals: 0,
    steps: [],
    durationMs: 0,
  }
  try {
    // Fresh conversation so scenarios do not inherit context.
    // But don't clear chat if agent mode is already on - just send new message.
    const agentModeOn = await run(
      window,
      `document.querySelector('[title^="Disable agent mode"]') !== null`
    )
    if (!agentModeOn) {
      await click(window, '[aria-label="New chat"]')
      await delay(400)
    }
    const filled = await fillTextarea(window, '.ai-composer textarea', task)
    if (!filled) throw new Error('Composer textarea not found')
    await delay(200)
    const clicked = await clickText(window, 'Run Agent')
    if (!clicked) throw new Error('Run Agent button not found (agent mode off or model missing)')
    await waitForAgentDone(window, timeoutMs)
    await delay(800)
    const output = await readAgentOutput(window)
    result.finalText = output.text
    result.steps = output.steps
    result.approvals = output.approvals
    result.passed = expected.test(output.text)
    const image = await window.webContents.capturePage()
    fs.writeFileSync(path.join(directory, screenshotName), image.toPNG())
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }
  result.durationMs = Date.now() - started
  console.log(`[e2e] ${name}: ${result.passed ? 'PASS' : 'FAIL'} (${result.durationMs}ms) — ${result.finalText.slice(0, 160).replace(/\n/g, ' ')}`)
  return result
}

export async function runAgentE2E(directory: string, getWindow: () => BrowserWindow | undefined): Promise<void> {
  // Enable auto-approval for E2E tests
  process.env.ARIADNE_AUTO_APPROVE = '1'
  fs.mkdirSync(directory, { recursive: true })
  const report: Report = {
    startedAt: new Date().toISOString(),
    providerConfigured: false,
    scenarios: [],
    passed: 0,
    failed: 0,
  }

  const deadline = Date.now() + 30000
  let window = getWindow()
  while (!window && Date.now() < deadline) {
    await delay(200)
    window = getWindow()
  }
  if (!window) {
    console.error('[e2e] no window available')
    app.quit()
    return
  }

  const server = await startTestServer()
  console.log(`[e2e] local test page: ${server.url}`)

  try {
    await delay(2500)
    const sidebarOpen = await click(window, '[aria-label="Toggle AI sidebar"]')
    await delay(1200)
    const settingsOpen = await click(window, '[title="AI settings"]')
    await delay(700)
    const formOpened = await clickText(window, '+ Add provider')
    await delay(600)
    console.log('[e2e] ui steps:', JSON.stringify({ sidebarOpen, settingsOpen, formOpened }))
    if (!formOpened) {
      const buttons = await run(
        window,
        `Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 60)`
      )
      throw new Error(`Provider form did not open. Buttons: ${JSON.stringify(buttons)}`)
    }

    const baseUrl = process.env.ARIADNE_E2E_BASE_URL || 'http://localhost:11434/v1'
    const modelId = process.env.ARIADNE_E2E_MODEL || 'qwen3.5:4b'

    const selectDebug = await run(
      window,
      `(() => {
        const labels = Array.from(document.querySelectorAll('.provider-form label'))
        const label = labels.find((el) => (el.querySelector('span')?.textContent || '').trim() === 'Type')
        const select = label?.querySelector('select')
        if (!select) return { found: false }
        const options = Array.from(select.options).map((o) => o.value)
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
        setter.call(select, 'custom')
        const afterSetter = select.value
        select.dispatchEvent(new Event('change', { bubbles: true }))
        return { found: true, options, afterSetter, afterEvent: select.value, hasCustom: options.includes('custom') }
      })()`
    )
    console.log('[e2e] select debug:', JSON.stringify(selectDebug))
    await delay(300)
    const typeSet = await selectLabel(window, 'Type', 'custom')
    await delay(300)
    const baseSet = await fillLabel(window, 'Base URL', baseUrl)
    const modelSet = await fillLabel(window, 'Model ID', modelId)
    const labelSet = await fillLabel(window, 'Model label', `${modelId} (local)`)
    await delay(300)
    const formValues = await run(
      window,
      `(() => {
        const labels = Array.from(document.querySelectorAll('.provider-form label'))
        return labels.map((l) => ({
          label: (l.querySelector('span')?.textContent || '').trim(),
          value: l.querySelector('input, select')?.value
        }))
      })()`
    )
    console.log('[e2e] form values:', JSON.stringify({ typeSet, baseSet, modelSet, labelSet, formValues }))
    const addClicked = await clickText(window, 'Add provider')
    await delay(2500)
    const settingsError = await run(
      window,
      `document.querySelector('.ai-settings-error, .settings-error, .ai-error')?.textContent || ''`
    )
    console.log('[e2e] add provider clicked:', addClicked, 'error:', JSON.stringify(settingsError))

    const providerCheck = await run(
      window,
      `Promise.all([window.electronAPI.ai.getProviders(), window.electronAPI.ai.getModelSlots()]).then(([list, slots]) => ({
        providers: list.map((p) => ({ name: p.name, type: p.type, models: p.models.map((m) => m.id) })),
        slots
      }))`
    )
    report.providerCheck = providerCheck
    report.providerConfigured = Boolean(
      providerCheck &&
        typeof providerCheck === 'object' &&
        Array.isArray((providerCheck as { providers?: unknown[] }).providers) &&
        ((providerCheck as { providers: unknown[] }).providers.length > 0)
    )
    console.log('[e2e] provider check:', JSON.stringify(providerCheck))
    const providerImage = await window.webContents.capturePage()
    fs.writeFileSync(path.join(directory, '01-provider-added.png'), providerImage.toPNG())
    if (!report.providerConfigured) {
      throw new Error(`Provider was not added. Check the form flow. (${JSON.stringify(providerCheck)})`)
    }

    // Navigate the initial tab to the test page before enabling agent mode.
    const initialTab = (await run(
      window,
      `window.electronAPI.tab.getAll().then((tabs) => tabs.find((t) => t.active)?.id || tabs[0]?.id || '')`
    )) as string | undefined
    if (initialTab) {
      await run(
        window,
        `window.electronAPI.tab.navigate('${initialTab}', '${server.url}').then(() => 'navigated').catch(() => 'failed')`
      )
      await delay(4000)
    }

    // Enable agent mode.
    const agentEnabled = await click(window, '[title^="Enable agent mode"]')
    if (!agentEnabled) throw new Error('Agent mode toggle not found')
    await delay(500)

    const scenarios: Array<{ name: string; task: string; expected: RegExp; timeout: number; shot: string }> = [
      {
        name: 'navigate-and-read',
        task: 'Open https://example.com and tell me the exact text of the main heading on the page.',
        expected: /example domain/i,
        timeout: 180000,
        shot: '02-agent-example.png',
      },
      {
        name: 'interact-with-form',
        task: `Open ${server.url} and type "ariadne" into the name field, then click the Submit button. Tell me the exact text shown in the result element.`,
        expected: /hello,\s*ariadne/i,
        timeout: 240000,
        shot: '03-agent-form.png',
      },
      {
        name: 'search-and-extract',
        task: 'Search Wikipedia for "Sumatran rhinoceros" and tell me the title of the article page you land on.',
        expected: /sumatran rhinoceros/i,
        timeout: 240000,
        shot: '04-agent-search.png',
      },
    ]

    for (const scenario of scenarios) {
      const result = await runScenario(
        window,
        directory,
        scenario.name,
        scenario.task,
        scenario.expected,
        scenario.timeout,
        scenario.shot
      )
      report.scenarios.push(result)
    }
  } catch (error) {
    console.error('[e2e] harness error:', error)
    report.scenarios.push({
      name: 'harness',
      task: 'setup',
      passed: false,
      finalText: '',
      expected: '',
      approvals: 0,
      steps: [],
      durationMs: 0,
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    server.close()
    report.passed = report.scenarios.filter((s) => s.passed).length
    report.failed = report.scenarios.length - report.passed
    report.finishedAt = new Date().toISOString()
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
    console.log(`[e2e] done: ${report.passed}/${report.scenarios.length} scenarios passed`)
    app.quit()
  }
}
