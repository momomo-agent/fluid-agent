/* test-dispatch-deps.js — Test intent dependencies + dispatch modes
 *
 * Covers: serial, parallel, fan-in deps, cascade fail, code mode, LLM mode
 */

// ═══════════════════════════════════════════════════════════════
// Stubs
// ═══════════════════════════════════════════════════════════════

const _vfsStore = new Map()
globalThis.VFS = {
  _store: _vfsStore,
  isDir(p) { return _vfsStore.get(p)?.type === 'dir' },
  isFile(p) { return _vfsStore.get(p)?.type === 'file' },
  mkdir(p) {
    const parts = p.split('/').filter(Boolean)
    let cur = ''
    for (const x of parts) { cur += '/' + x; if (!_vfsStore.has(cur)) _vfsStore.set(cur, { type: 'dir' }) }
  },
  writeFile(p, c) {
    const parent = p.split('/').slice(0, -1).join('/')
    if (parent && !_vfsStore.has(parent)) VFS.mkdir(parent)
    _vfsStore.set(p, { type: 'file', content: c })
  },
  readFile(p) { return _vfsStore.get(p)?.content || null },
  ls(p) {
    const prefix = p.endsWith('/') ? p : p + '/'
    const entries = [], seen = new Set()
    for (const [k, v] of _vfsStore) {
      if (k.startsWith(prefix) && k !== p) {
        const name = k.slice(prefix.length).split('/')[0]
        if (!seen.has(name)) { seen.add(name); entries.push({ name, type: v.type }) }
      }
    }
    return entries
  },
  rm(p) { _vfsStore.delete(p) },
}

const _events = {}
globalThis.EventBus = {
  emit(e, d) { (_events[e] || []).forEach(fn => fn(d)) },
  on(e, fn) { if (!_events[e]) _events[e] = []; _events[e].push(fn) },
}

// ═══════════════════════════════════════════════════════════════
// Load real modules
// ═══════════════════════════════════════════════════════════════

const fs = require('fs')
const path = require('path')
const vm = require('vm')
const dir = __dirname

function loadScript(name) {
  vm.runInThisContext(fs.readFileSync(path.join(dir, name), 'utf8'), { filename: name })
}

loadScript('intent-state.js')
loadScript('scheduler.js')
loadScript('dispatcher.js')

// ═══════════════════════════════════════════════════════════════
// Test harness
// ═══════════════════════════════════════════════════════════════

let passed = 0, failed = 0, total = 0
function assert(cond, msg) {
  total++
  if (cond) { passed++; console.log(`  ✅ ${msg}`) }
  else { failed++; console.error(`  ❌ ${msg}`) }
}

// Track what Scheduler.enqueue receives
const _enqueued = []
const _origEnqueue = Scheduler.enqueue.bind ? Scheduler.enqueue : null

function resetAll() {
  _vfsStore.clear()
  _enqueued.length = 0
  // Reset IntentState
  IntentState.init()
  // Reset Dispatcher internals by re-evaluating
  // We can't easily reset closures, so we track via events
}

// Capture scheduler enqueue calls via EventBus
const _spawned = []
EventBus.on('dispatcher.spawn', (data) => {
  _spawned.push(data)
})

const _cancelled = []
EventBus.on('dispatcher.cancel', (data) => {
  _cancelled.push(data)
})

// Mock Scheduler._onStart so enqueue actually "runs"
let _schedulerTasks = []
Scheduler._onStart = (task, steps, abort, opts) => {
  _schedulerTasks.push({ task, steps, abort, opts })
  // Return a promise that never resolves (worker stays "running")
  return new Promise(() => {})
}

// ═══════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════

// Init Dispatcher with mock AI
const mockAI = {
  chat: async (messages, opts) => {
    // Return a simple spawn decision for LLM mode tests
    const content = messages[0]?.content || ''
    const intentMatch = content.match(/Event: (\w+) intent (intent-\d+)/)
    if (intentMatch) {
      const [, action, intentId] = intentMatch
      return {
        content: [{ text: JSON.stringify({
          ops: [{ type: 'spawn', intentId, reason: 'LLM decided to spawn' }]
        })}]
      }
    }
    return { content: [{ text: '{"ops": []}' }] }
  }
}

Dispatcher.init(mockAI)
Dispatcher.setDispatchMode('code')  // Tests assume code mode unless explicitly testing LLM

console.log('\n═══════════════════════════════════════════════════')
console.log('  Test Suite: Intent Dependencies + Dispatch Modes')
console.log('═══════════════════════════════════════════════════\n')

// ═══════════════════════════════════════════════════════════════
// Test 1: Simple intent (no deps) — should spawn immediately
// ═══════════════════════════════════════════════════════════════

console.log('--- Test 1: Simple intent (no deps) ---')
_spawned.length = 0
_schedulerTasks.length = 0

const i1 = IntentState.create('Search AI news')
assert(i1.id === 'intent-1', 'Intent created with correct ID')
// onChange fires synchronously, Dispatcher should have reacted
assert(IntentState.get(i1.id).status === 'running', 'Intent moved to running')
assert(_spawned.length === 1, 'One spawn event emitted')
assert(_spawned[0].intentId === i1.id, 'Spawn event has correct intentId')
assert(_spawned[0].task === 'Search AI news', 'Spawn event has correct task')

// ═══════════════════════════════════════════════════════════════
// Test 2: Two parallel intents (no deps) — both spawn immediately
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Test 2: Two parallel intents ---')
_spawned.length = 0

const i2a = IntentState.create('Search crypto news')
const i2b = IntentState.create('Check weather')
assert(_spawned.length === 2, 'Two spawn events for parallel intents')
assert(IntentState.get(i2a.id).status === 'running', 'First parallel intent running')
assert(IntentState.get(i2b.id).status === 'running', 'Second parallel intent running')

// ═══════════════════════════════════════════════════════════════
// Test 3: Serial dependency (B depends on A)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Test 3: Serial dependency (B depends on A) ---')
_spawned.length = 0

const i3a = IntentState.create('Fetch data from API')
assert(IntentState.get(i3a.id).status === 'running', 'A is running')

const i3b = IntentState.create('Process fetched data', { dependsOn: [i3a.id] })
assert(i3b.dependsOn[0] === i3a.id, 'B has dependsOn set')
assert(_spawned.length === 1, 'Only A spawned (B waiting)')
assert(IntentState.get(i3b.id).status === 'active', 'B still active (not running)')

// Now complete A
Dispatcher.workerCompleted(_spawned[0].workerId, { summary: 'Data fetched' })
assert(IntentState.get(i3a.id).status === 'done', 'A is done')

// B should now spawn
assert(_spawned.length === 2, 'B spawned after A completed')
assert(IntentState.get(i3b.id).status === 'running', 'B is now running')

// Check that B's task includes dependency context
const bSpawn = _spawned[1]
assert(bSpawn.task.includes('Dependency results'), 'B task includes dependency results')
assert(bSpawn.task.includes('Data fetched'), 'B task includes A\'s summary')

// ═══════════════════════════════════════════════════════════════
// Test 4: Fan-in (C depends on A + B)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Test 4: Fan-in (C depends on A + B) ---')
_spawned.length = 0

const i4a = IntentState.create('Search AI papers')
const i4b = IntentState.create('Search ML papers')
const i4c = IntentState.create('Combine into report', { dependsOn: [i4a.id, i4b.id] })

assert(_spawned.length === 2, 'A and B spawned, C waiting')
assert(IntentState.get(i4c.id).status === 'active', 'C still active')

// Complete A only — C should still wait
const wA = _spawned.find(s => s.intentId === i4a.id)
Dispatcher.workerCompleted(wA.workerId, { summary: 'Found 5 AI papers' })
assert(IntentState.get(i4a.id).status === 'done', 'A done')
assert(_spawned.length === 2, 'C still waiting (B not done)')
assert(IntentState.get(i4c.id).status === 'active', 'C still active after only A done')

// Complete B — now C should spawn
const wB = _spawned.find(s => s.intentId === i4b.id)
Dispatcher.workerCompleted(wB.workerId, { summary: 'Found 3 ML papers' })
assert(IntentState.get(i4b.id).status === 'done', 'B done')
assert(_spawned.length === 3, 'C spawned after both A and B done')
assert(IntentState.get(i4c.id).status === 'running', 'C is now running')

// Verify C's enriched goal
const cSpawn = _spawned[2]
assert(cSpawn.task.includes('Found 5 AI papers'), 'C task includes A results')
assert(cSpawn.task.includes('Found 3 ML papers'), 'C task includes B results')

// ═══════════════════════════════════════════════════════════════
// Test 5: Cascade failure (B depends on A, A fails → B fails)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Test 5: Cascade failure ---')
_spawned.length = 0

const i5a = IntentState.create('Risky operation')
const i5b = IntentState.create('Use risky result', { dependsOn: [i5a.id] })

assert(_spawned.length === 1, 'Only A spawned')
assert(IntentState.get(i5b.id).status === 'active', 'B waiting')

// Fail A
Dispatcher.workerFailed(_spawned[0].workerId, 'Network error')
assert(IntentState.get(i5a.id).status === 'failed', 'A failed')
assert(IntentState.get(i5b.id).status === 'failed', 'B cascade failed')
assert(IntentState.get(i5b.id).error.includes('Dependency failed'), 'B error mentions dependency')

// ═══════════════════════════════════════════════════════════════
// Test 6: Fan-in with one failure (C depends on A+B, B fails)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Test 6: Fan-in with partial failure ---')
_spawned.length = 0

const i6a = IntentState.create('Task alpha')
const i6b = IntentState.create('Task beta')
const i6c = IntentState.create('Merge alpha+beta', { dependsOn: [i6a.id, i6b.id] })

assert(_spawned.length === 2, 'A and B spawned')

// Complete A
Dispatcher.workerCompleted(_spawned.find(s => s.intentId === i6a.id).workerId, { summary: 'Alpha done' })
assert(IntentState.get(i6c.id).status === 'active', 'C still waiting')

// Fail B → C should cascade fail
Dispatcher.workerFailed(_spawned.find(s => s.intentId === i6b.id).workerId, 'Beta crashed')
assert(IntentState.get(i6b.id).status === 'failed', 'B failed')
assert(IntentState.get(i6c.id).status === 'failed', 'C cascade failed due to B')

// ═══════════════════════════════════════════════════════════════
// Test 7: Update intent while running
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Test 7: Update running intent (steer) ---')
_spawned.length = 0

const i7 = IntentState.create('Search news')
assert(IntentState.get(i7.id).status === 'running', 'Intent running')

// Register the worker so Dispatcher can find it
const w7 = _spawned[0].workerId
Dispatcher.registerWorker(w7, 'Search news', [])

// Update the intent
IntentState.update(i7.id, { goal: 'Search AI news specifically', message: 'focus on AI' })
assert(IntentState.get(i7.id).goal === 'Search AI news specifically', 'Goal updated')
assert(IntentState.get(i7.id).messages.includes('focus on AI'), 'Message recorded')

// ═══════════════════════════════════════════════════════════════
// Test 8: Cancel intent
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Test 8: Cancel intent ---')
_spawned.length = 0
_cancelled.length = 0

const i8 = IntentState.create('Long running task')
assert(_spawned.length === 1, 'Spawned')

IntentState.cancel(i8.id)
assert(IntentState.get(i8.id).status === 'cancelled', 'Intent cancelled')
assert(_cancelled.length === 1, 'Cancel event emitted')

// ═══════════════════════════════════════════════════════════════
// Test 9: Progress + Artifacts flow
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Test 9: Progress + Artifacts via afterTurn ---')
_spawned.length = 0

const i9 = IntentState.create('Build a calculator app')
const w9 = _spawned[0].workerId
Dispatcher.registerWorker(w9, 'Build a calculator app', [])

// Simulate afterTurn with progress
Dispatcher.afterTurn(w9, {
  progress: 'Created HTML structure',
  artifacts: ['win-1'],
  usage: { input_tokens: 100, output_tokens: 50 },
  toolCalls: [{ name: 'fs' }],
})

const intent9 = IntentState.get(i9.id)
assert(intent9.progress === 'Created HTML structure', 'Progress written to intent')
assert(intent9.artifacts.includes('win-1'), 'Artifact written to intent')

// Second turn adds more artifacts
Dispatcher.afterTurn(w9, {
  progress: 'Added CSS styling',
  artifacts: ['win-1', '/home/calc/style.css'],
})

const intent9b = IntentState.get(i9.id)
assert(intent9b.progress === 'Added CSS styling', 'Progress updated')
assert(intent9b.artifacts.length === 2, 'Artifacts deduplicated (win-1 not added twice)')
assert(intent9b.artifacts.includes('/home/calc/style.css'), 'New artifact added')

// ═══════════════════════════════════════════════════════════════
// Test 10: formatForTalker shows deps
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Test 10: formatForTalker shows dependency info ---')

// Create a fresh intent with deps for display
const i10a = IntentState.create('Dep source')
const i10b = IntentState.create('Dep target', { dependsOn: [i10a.id] })

const talkerOutput = IntentState.formatForTalker()
assert(talkerOutput.includes('waiting on:'), 'formatForTalker shows waiting on')
assert(talkerOutput.includes(i10a.id), 'formatForTalker shows dependency ID')

// ═══════════════════════════════════════════════════════════════
// Test 11: Chain dependency (A → B → C)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Test 11: Chain dependency (A → B → C) ---')
_spawned.length = 0

const i11a = IntentState.create('Step 1: gather')
const i11b = IntentState.create('Step 2: process', { dependsOn: [i11a.id] })
const i11c = IntentState.create('Step 3: deliver', { dependsOn: [i11b.id] })

assert(_spawned.length === 1, 'Only A spawned')
assert(IntentState.get(i11b.id).status === 'active', 'B waiting')
assert(IntentState.get(i11c.id).status === 'active', 'C waiting')

// Complete A → B should spawn
Dispatcher.workerCompleted(_spawned[0].workerId, { summary: 'Gathered' })
assert(_spawned.length === 2, 'B spawned after A')
assert(IntentState.get(i11c.id).status === 'active', 'C still waiting (B not done)')

// Complete B → C should spawn
Dispatcher.workerCompleted(_spawned[1].workerId, { summary: 'Processed' })
assert(_spawned.length === 3, 'C spawned after B')
assert(IntentState.get(i11c.id).status === 'running', 'C running')

// Verify C gets B's results (which includes A's context)
assert(_spawned[2].task.includes('Processed'), 'C task includes B results')

// ═══════════════════════════════════════════════════════════════
// Test 12: LLM dispatch mode
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Test 12: LLM dispatch mode ---')
_spawned.length = 0

assert(Dispatcher.getDispatchMode() === 'code', 'Default mode is code')

Dispatcher.setDispatchMode('llm')
assert(Dispatcher.getDispatchMode() === 'llm', 'Mode switched to llm')

// Create intent in LLM mode — should call mockAI
const i12 = IntentState.create('LLM-dispatched task')

// LLM mode is async, need to wait a tick
setTimeout(() => {
  // The mock AI returns a spawn op, so the intent should eventually be running
  assert(_spawned.length >= 1, 'LLM mode triggered spawn')

  // Switch back to code mode
  Dispatcher.setDispatchMode('code')
  assert(Dispatcher.getDispatchMode() === 'code', 'Mode back to code')

  runLLMDepsTest()
}, 100)

function runLLMDepsTest() {

// ═══════════════════════════════════════════════════════════════
// Test 13: LLM mode handles deps
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Test 13: LLM mode handles deps ---')
_spawned.length = 0

Dispatcher.setDispatchMode('llm')

const i13a = IntentState.create('LLM dep source')

setTimeout(() => {
  const i13b = IntentState.create('LLM dep target', { dependsOn: [i13a.id] })

  setTimeout(() => {
    assert(_spawned.length >= 1, 'LLM mode processed intents')
    Dispatcher.setDispatchMode('code')

    runArtifactsTest()
  }, 100)
}, 100)

}

function runArtifactsTest() {

// ═══════════════════════════════════════════════════════════════
// Test 14: Artifacts injection in fan-in
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Test 14: Artifacts injection in fan-in ---')
_spawned.length = 0

const i14a = IntentState.create('Create file A')
const i14b = IntentState.create('Create file B')

// Register workers and add artifacts
const w14a = _spawned.find(s => s.intentId === i14a.id).workerId
const w14b = _spawned.find(s => s.intentId === i14b.id).workerId
Dispatcher.registerWorker(w14a, 'Create file A', [])
Dispatcher.registerWorker(w14b, 'Create file B', [])

// Add artifacts via afterTurn
Dispatcher.afterTurn(w14a, { artifacts: ['/home/fileA.txt'] })
Dispatcher.afterTurn(w14b, { artifacts: ['/home/fileB.txt'] })

// Create C depending on both
const i14c = IntentState.create('Merge files', { dependsOn: [i14a.id, i14b.id] })
assert(IntentState.get(i14c.id).status === 'active', 'C waiting for deps')

// Complete both
Dispatcher.workerCompleted(w14a, { summary: 'File A created' })
Dispatcher.workerCompleted(w14b, { summary: 'File B created' })

// C should spawn with both artifacts in context
const cSpawn14 = _spawned.find(s => s.intentId === i14c.id)
assert(cSpawn14 != null, 'C spawned')
assert(cSpawn14.task.includes('/home/fileA.txt'), 'C task includes A artifacts')
assert(cSpawn14.task.includes('/home/fileB.txt'), 'C task includes B artifacts')

// End of async chain
printSummary()

} // end runArtifactsTest

function printSummary() {

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════════════════')
console.log(`  Results: ${passed}/${total} passed, ${failed} failed`)
console.log('═══════════════════════════════════════════════════\n')

process.exit(failed > 0 ? 1 : 0)
}
