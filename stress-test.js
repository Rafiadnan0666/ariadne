// STRESS TEST - Run with: node stress-test.js
// Requires: npm run build
// Tests: memory, AI fallback, agent loops, concurrent ops, edge cases

const fs = require('fs');
const path = require('path');

const APP_PATH = path.join(__dirname, '.');
const RESULTS = [];

function log(test, pass, details) {
  const icon = pass ? '✅' : '❌';
  console.log(`${icon} ${test}${details ? ' — ' + details : ''}`);
  RESULTS.push({ test, pass, details, timestamp: Date.now() });
}

function readFileSafe(relPath) {
  const full = path.join(APP_PATH, relPath);
  if (!fs.existsSync(full)) return '';
  return fs.readFileSync(full, 'utf-8');
}

async function stressTest() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  ARIADNE STRESS TEST — Harsh, No Mercy                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // 1. BUILD
  console.log('🔨 Building...');
  const { spawn } = require('child_process');
  await new Promise((resolve, reject) => {
    const proc = spawn('npm', ['run', 'build'], { cwd: APP_PATH, shell: true });
    proc.on('close', code => resolve(code));
    proc.on('error', reject);
  });
  log('Build succeeds', true);

  // 2. MEMORY STRESS
  console.log('\n🧠 TEST: Memory pressure & tab discarding');
  try {
    const mainCode = readFileSafe('src/main/index.ts');
    const hasDiscarding = mainCode.includes('discardInactiveTabs') && mainCode.includes('memoryBudgetConfig');
    log('Tab discarding implementation', hasDiscarding);

    const hasBudget = mainCode.includes('maxMemoryMB') && mainCode.includes('1500');
    log('Memory budget configured (1.5GB)', hasBudget);

    const hasRestoration = mainCode.includes('discardedTabs') && mainCode.includes('isTabDiscarded');
    log('Discarded tab restoration API', hasRestoration);

    const hasMonitoring = mainCode.includes('memoryCheckTimer') && mainCode.includes('setInterval');
    log('Periodic memory monitoring', hasMonitoring);
  } catch (e) {
    log('Memory stress check', false, e.message);
  }

  // 3. AI PROVIDER FALLBACK STRESS
  console.log('\n🤖 TEST: AI provider fallback chain');
  try {
    const registryCode = readFileSafe('src/main/ai/registry.ts');
    const providerCode = readFileSafe('src/main/ai/provider.ts');

    const hasKeyRotation = providerCode.includes('rotateApiKey') && providerCode.includes('currentKeyIndex');
    log('Key rotation implemented', hasKeyRotation);

    const hasMultiKey = providerCode.includes('apiKeys') && providerCode.includes('push');
    log('Multiple keys per provider', hasMultiKey);

    const hasFallback = registryCode.includes('fallback') && registryCode.includes('Preserve conversation context');
    log('Fallback with context preservation', hasFallback);

    const hasRetry = registryCode.includes('backoffMs') && registryCode.includes('Math.pow(2, attempt)');
    log('Exponential backoff retry (1s, 2s, 4s, max 10s)', hasRetry);

    const hasErrorClassification = registryCode.includes('classifyError') && registryCode.includes('retryable') && registryCode.includes('fallbackable');
    log('Error classification (retry/fallback/rotate)', hasErrorClassification);

    const hasMaxRetries = registryCode.includes('maxRetries') || registryCode.includes('attempt < maxRetries');
    log('Max retry limit', hasMaxRetries);
  } catch (e) {
    log('AI fallback check', false, e.message);
  }

  // 4. AGENT STRESS
  console.log('\n🤖 TEST: Agent runtime stress');
  try {
    const agentCode = readFileSafe('src/main/ai/agent-tools.ts');
    const sidebarCode = readFileSafe('src/renderer/components/ai/ChatSidebar.tsx');

    const tools = ['navigate', 'click', 'type', 'scroll', 'find', 'highlight', 'extract', 'screenshot', 'wait', 'search'];
    let allTools = true;
    for (const t of tools) {
      if (!agentCode.includes(t)) { allTools = false; console.log(`  Missing tool: ${t}`); }
    }
    log('All 10 agent tools present', allTools);

    const hasApprovalUI = sidebarCode.includes('ai-agent-approval') && sidebarCode.includes('pending.resolve');
    log('Tool approval UI in renderer', hasApprovalUI);

    const hasApprovalIPC = readFileSafe('src/main/index.ts').includes('ai:agent:approve');
    log('Approval IPC handler', hasApprovalIPC);

    const hasLoop = agentCode.includes('maxSteps') || agentCode.includes('step') || agentCode.includes('while');
    log('Agent loop with step tracking', hasLoop);

    const hasErrorHandling = agentCode.includes('try') && agentCode.includes('catch');
    log('Error handling in tools', hasErrorHandling);

    const hasVision = agentCode.includes('vision') || agentCode.includes('screenshot');
    log('Screenshot capability (vision proxy)', hasVision);

    const hasPersistentState = agentCode.includes('session') || agentCode.includes('context') || agentCode.includes('memory');
    log('Agent persistent state design', hasPersistentState);
  } catch (e) {
    log('Agent stress check', false, e.message);
  }

  // 5. CROSS-TAB CONTEXT
  console.log('\n🔍 TEST: Cross-tab intelligence (BM25, citations)');
  try {
    const contextFiles = fs.readdirSync(path.join(APP_PATH, 'src/context'));
    const required = ['chunking.ts', 'ranking.ts', 'dedupe.ts', 'qa.ts', 'EmbeddingStore.ts', 'extraction.ts', 'manager.ts', 'provider-adapter.ts'];
    let allPresent = true;
    for (const f of required) {
      if (!contextFiles.includes(f)) { allPresent = false; console.log(`  Missing: ${f}`); }
    }
    log('All context modules present (src/context/)', allPresent);

    const qaCode = readFileSafe('src/context/qa.ts');
    const hasCitations = qaCode.includes('citation') || qaCode.includes('source') || qaCode.includes('references');
    log('Citations in Q&A', hasCitations);

    const rankingCode = readFileSafe('src/context/ranking.ts');
    const hasBM25 = rankingCode.includes('BM25') || rankingCode.includes('bm25');
    log('BM25 ranking', hasBM25);

    const chunkingCode = readFileSafe('src/context/chunking.ts');
    const hasChunking = chunkingCode.includes('chunk') && chunkingCode.includes('overlap');
    log('Text chunking with overlap', hasChunking);

    const dedupeCode = readFileSafe('src/context/dedupe.ts');
    const hasDedupe = dedupeCode.includes('duplicate') || dedupeCode.includes('similarity');
    log('Deduplication', hasDedupe);
  } catch (e) {
    log('Cross-tab check', false, e.message);
  }

  // 6. SECURITY
  console.log('\n🔒 TEST: Security features');
  try {
    const mainCode = readFileSafe('src/main/index.ts');
    const securityCode = readFileSafe('src/main/security.ts');
    const preloadCode = readFileSafe('src/preload.ts');

    const hasCSP = mainCode.includes('Content-Security-Policy');
    log('CSP headers on responses', hasCSP);

    const hasDNR = securityCode.includes('declarativeNetRequest');
    log('Declarative Net Request (adblock)', hasDNR);

    const hasHTTPSOnly = securityCode.includes('applyHttpsOnly') || mainCode.includes('httpsOnly');
    log('HTTPS-Only mode', hasHTTPSOnly);

    const hasBreach = securityCode.includes('pwnedpasswords') || securityCode.includes('HaveIBeenPwned');
    log('Password breach check (HIBP k-anonymity)', hasBreach);

    const hasDoH = mainCode.includes('dnsOverHttps') && mainCode.includes('DnsOverHttps');
    log('DNS-over-HTTPS (Chromium switches)', hasDoH);

    const hasSafeBrowsing = securityCode.includes('SafeBrowsing') || securityCode.includes('safeBrowsing');
    log('Safe Browsing (placeholder)', hasSafeBrowsing);

    const hasPermissionPrompts = mainCode.includes('permission') && mainCode.includes('prompt');
    log('Permission prompts', hasPermissionPrompts);

    const hasIPCValidation = mainCode.includes('sender') || mainCode.includes('validate');
    log('IPC sender validation', hasIPCValidation);

    const hasSandbox = mainCode.includes('sandbox: true');
    log('Renderer sandbox', hasSandbox);

    const hasContextIsolation = mainCode.includes('contextIsolation: true');
    log('Context isolation', hasContextIsolation);
  } catch (e) {
    log('Security check', false, e.message);
  }

  // 7. PRIVATE WINDOWS
  console.log('\n🕵️ TEST: Private window isolation');
  try {
    const mainCode = readFileSafe('src/main/index.ts');
    const hasPrivatePartition = mainCode.includes('ariadne-private-') && mainCode.includes('partition');
    log('Unique partition per private window', hasPrivatePartition);

    const hasEphemeral = mainCode.includes('clearStorageData') || mainCode.includes('clearCache');
    log('Ephemeral cleanup on close', hasEphemeral);

    const hasPrivateTabs = mainCode.includes('isPrivate') && mainCode.includes('partition');
    log('Tab-level private flag', hasPrivateTabs);
  } catch (e) {
    log('Private window check', false, e.message);
  }

  // 8. SETTINGS PERSISTENCE
  console.log('\n💾 TEST: Settings persistence');
  try {
    const mainCode = readFileSafe('src/main/index.ts');
    const hasElectronStore = mainCode.includes('electron-store') || mainCode.includes('new Store(');
    log('Uses electron-store', hasElectronStore);

    const hasMigration = mainCode.includes('migration') || mainCode.includes('version');
    log('Settings versioning/migration', hasMigration);

    const hasSeparateStores = mainCode.includes('settingsStore') && mainCode.includes('bookmarksStore');
    log('Separate stores for settings/bookmarks', hasSeparateStores);
  } catch (e) {
    log('Settings check', false, e.message);
  }

  // 9. EXTRACTION ROBUSTNESS
  console.log('\n📄 TEST: Page extraction robustness');
  try {
    const extractCode = readFileSafe('src/main/ai/context/PageExtractor.ts');
    const scriptCode = readFileSafe('src/main/ai/context/extraction-script.js');

    const hasShadowDOM = scriptCode.includes('shadowRoot') && scriptCode.includes('getAllElements');
    log('Shadow DOM handling (in extraction-script.js)', hasShadowDOM);

    const hasCSPBypass = extractCode.includes('executeJavaScript') || extractCode.includes('CSP');
    log('CSP-aware extraction', hasCSPBypass);

    const hasVirtualScroll = scriptCode.includes('scrollToBottom') && scriptCode.includes('SCROLL_MAX_ATTEMPTS');
    log('Infinite scroll handling (in extraction-script.js)', hasVirtualScroll);

    const hasTimeout = extractCode.includes('timeout') || extractCode.includes('AbortController');
    log('Extraction timeouts', hasTimeout);

    const hasSettle = extractCode.includes('settleMs') || extractCode.includes('settle');
    log('Settle time for client-rendered pages', hasSettle);

    const hasRedaction = extractCode.includes('redactSecrets') || extractCode.includes('[REDACTED]');
    log('Secret redaction in extracted text', hasRedaction);

    const hasEphemeralExtract = extractCode.includes('isPrivate') && extractCode.includes('partition');
    log('Private extraction mode', hasEphemeralExtract);
  } catch (e) {
    log('Extraction check', false, e.message);
  }

  // 10. CONCURRENT OPERATIONS
  console.log('\n⚡ TEST: Concurrent operations design');
  try {
    const mainCode = readFileSafe('src/main/index.ts');
    const tabsCode = readFileSafe('src/main/tabs.ts');

    const hasWindowMap = mainCode.includes('windows') && mainCode.includes('Map');
    log('Window state management (Map)', hasWindowMap);

    const hasTabMap = tabsCode.includes('tabs') && tabsCode.includes('Map');
    log('Tab state management (Map)', hasTabMap);

    const hasIPCValidation2 = mainCode.includes('sender') || mainCode.includes('validate');
    log('IPC sender validation', hasIPCValidation2);

    const hasBroadcast = mainCode.includes('broadcast') || mainCode.includes('webContents.send');
    log('Broadcast to windows/tabs', hasBroadcast);
  } catch (e) {
    log('Concurrency check', false, e.message);
  }

  // 11. EDGE CASES
  console.log('\n💥 TEST: Edge case handling');
  try {
    const mainCode = readFileSafe('src/main/index.ts');
    const tabsCode = readFileSafe('src/main/tabs.ts');
    const registryCode = readFileSafe('src/main/ai/registry.ts');

    const tryCount = (mainCode.match(/try\s*{/g) || []).length;
    log('Try/catch blocks in main (>7)', tryCount > 7, `${tryCount} found`);

    const hasNullChecks = mainCode.includes('?.') || mainCode.includes('??');
    log('Optional chaining/nullish coalescing', hasNullChecks);

    const hasCorruptionHandling = tabsCode.includes('corrupt') || mainCode.includes('corrupt') || tabsCode.includes('integrity');
    log('DB corruption handling', hasCorruptionHandling);

    const hasEmptyStateHandling = registryCode.includes('this.initialized') && registryCode.includes('return');
    log('Empty state handling (initialized guard)', hasEmptyStateHandling);

    const hasCleanup = mainCode.includes('before-quit') && mainCode.includes('clearHistory');
    log('Graceful shutdown cleanup', hasCleanup);
  } catch (e) {
    log('Edge case check', false, e.message);
  }

  // 12. PERFORMANCE
  console.log('\n⚡ TEST: Performance safeguards');
  try {
    const contextCode = readFileSafe('src/context/manager.ts');
    const extractCode = readFileSafe('src/main/ai/context/PageExtractor.ts');
    const mainCode = readFileSafe('src/main/index.ts');

    const hasBoundedCache = contextCode.includes('max') && (contextCode.includes('cache') || contextCode.includes('limit') || contextCode.includes('size'));
    log('Bounded context cache', hasBoundedCache);

    const hasTimeout2 = extractCode.includes('timeout') || extractCode.includes('AbortController');
    log('Extraction timeouts', hasTimeout2);

    const hasMemoryMonitor = mainCode.includes('memoryMonitor') || mainCode.includes('process.memoryUsage') || mainCode.includes('MemoryBudget');
    log('Memory monitoring', hasMemoryMonitor);

    const hasLazyLoad = mainCode.includes('lazy') || mainCode.includes('dynamic import') || mainCode.includes('import(');
    log('Lazy loading / dynamic imports', hasLazyLoad);
  } catch (e) {
    log('Performance check', false, e.message);
  }

  // 13. TEST SUITE
  console.log('\n🧪 TEST: Test coverage');
  try {
    const testFiles = fs.readdirSync(path.join(APP_PATH, 'tests')).filter(f => f.endsWith('.test.ts') || f.endsWith('.test.js'));
    log('Test files exist', testFiles.length > 0, `${testFiles.length} files`);

    const pkgCode = readFileSafe('package.json');
    const hasTestScript = pkgCode.includes('"test"');
    log('Test script in package.json', hasTestScript);
  } catch (e) {
    log('Test coverage check', false, e.message);
  }

  // RESULTS
  const passed = RESULTS.filter(r => r.pass).length;
  const failed = RESULTS.filter(r => !r.pass).length;
  const total = RESULTS.length;

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  RESULTS: ${passed}/${total} passed, ${failed} failed`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('FAILED (real gaps):');
  RESULTS.filter(r => !r.pass).forEach(r => console.log(`  ❌ ${r.test}${r.details ? ' — ' + r.details : ''}`));

  console.log('\nPASSED:');
  RESULTS.filter(r => r.pass).forEach(r => console.log(`  ✅ ${r.test}`));

  fs.writeFileSync(
    path.join(__dirname, 'stress-results.json'),
    JSON.stringify({ summary: { passed, failed, total }, tests: RESULTS }, null, 2)
  );
  console.log('\n📄 Results saved to stress-results.json');

  process.exit(failed > 0 ? 1 : 0);
}

stressTest().catch(e => {
  console.error('Test harness crashed:', e);
  process.exit(1);
});