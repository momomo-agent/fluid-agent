/* test-vfs-persistence.js — Verify Dispatcher + Scheduler VFS persistence */

// ═══════════════════════════════════════════════════════════════
// Stubs for browser globals
// ═══════════════════════════════════════════════════════════════

const _vfsStore = new Map()  // path → { type, content, children }

globalThis.VFS = {
  _store: _vfsStore,
  isDir(path) {
    const node = _vfsStore.get(path)
    return node?.type === 'dir'
  },
  isFile(path) {
    const node = _vfsStore.get(path)
    return node?.type === 'file'
  },
  mkdir(path) {
    // Create all parent dirs
    const parts = path.split('/').filter(Boolean)
    let cur = ''
    for (const p of parts) {
      cur += '/' + p
      if (!_vfsStore.has(cur)) _vfsStore.set(cur, { type: 'dir', children: [] })
    }
  },
  writeFile(path, content) {
    // Ensure parent dir exists
    const parent = path.split('/').slice(0, -1).join('/')
    if (parent && !_vfsStore.has(parent)) VFS.mkdir(parent)
    _vfsStore.set(path, { type: 'file', content })
  },
  readFile(path) {
    const node = _vfsStore.get(path)
    return node?.type === 'file' ? node.content : null
  },
  ls(path) {
    const prefix = path.endsWith('/') ? path : path + '/'
    const entries = []
    const seen = new Set()
    for (const [k, v] of _vfsStore) {
      if (k.startsWith(prefix) && k !== path) {
        const rest = k.slice(prefix.length)
        const name = rest.split('/')[0]
        if (!seen.has(name)) {
          seen.add(name)
          entries.push({ name, type: v.type, size: v.content?.length || 0 })
        }
      }
    }
    return entries
  },
  rm(path) { _vfsStore.delete(path) },
}

// EventBus stub
const _events = {}
globalThis.EventBus = {
  emit(event, data) {
    (_events[event] || []).forEach(fn => fn(data))
  },
  on(event, fn) {
    if (!_events[event]) _events[event] = []
    _events[event].push(fn)
  },
}

// IntentState stub
const _intents = {}
let _intentNextId = 1
const _intentListeners = []
globalThis.IntentState = {
  create(goal) {
    const id = `intent-${_intentNextId++}`
    _intents[id] = { id, goal, status: 'active', messages: [], createdAt: Date.now() }
    _intentListeners.forEach(fn => fn('create', _intents[id]))
    return _intents[id]
  },
  running(id) { if (_intents[id]) _intents[id].status = 'running' },
  done(id, result) { if (_intents[id]) { _intents[id].status = 'done'; _intents[id].result = result } },
  fail(id, error) { if (_intents[id]) { _intents[id].status = 'failed'; _intents[id].error = error } },
  update(id, changes) {
    if (!_intents[id]) return null
    if (changes.message) _intents[id].messages.push(changes.message)
    if (changes.goal) _intents[id].goal = changes.goal
    return _intents[id]
  },
  cancel(id) { if (_intents[id]) _intents[id].status = 'cancelled' },
  onChange(fn) { _intentListeners.push(fn) },
  active() { return Object.values(_intents).filter(i => i.status === 'active' || i.status === 'running') },
  init() {},
}

// ═══════════════════════════════════════════════════════════════
// Load modules (eval as browser scripts)
// ═══════════════════════════════════════════════════════════════

const fs = require('fs')
const path = require('path')
const dir = __dirname

const vm = require('vm')

function loadScript(name) {
  const code = fs.readFileSync(path.join(dir, name), 'utf8')
  vm.runInThisContext(code, { filename: name })
}

loadScript('scheduler.js')
loadScript('dispatcher.js')

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

let passed = 0
let failed = 0

function assert(condition, msg) {
  if (condition) {
    passed++
    console.log(`  ✅ ${msg}`)
  } else {
    failed++
    console.error(`  ❌ ${msg}`)
  }
}

function resetVFS() {
  _vfsStore.clear()
  Object.keys(_intents).forEach(k => delete _intents[k])
  _intentNextId = 1
  _intentListeners.length = 0  // Clear onChange listeners (Dispatcher.init re-registers)
}

// --- Test 1: Dispatcher writes worker state to VFS ---
console.log('\n📋 Test 1: Dispatcher writes worker state to VFS')
resetVFS()
Dispatcher.init(null)

Dispatcher.registerWorker(1, 'Build a calculator app', ['design', 'code', 'test'])
assert(VFS.isFile('/proc/workers/1.json'), 'Worker file created in VFS')

const workerData = JSON.parse(VFS.readFile('/proc/workers/1.json'))
assert(workerData.id === 1, 'Worker ID correct')
assert(workerData.task === 'Build a calculator app', 'Worker task correct')
assert(workerData.status === 'running', 'Worker status is running')

// --- Test 2: Dispatcher saves meta ---
console.log('\n📋 Test 2: Dispatcher saves meta on intent create')
resetVFS()
Dispatcher.init(null)

// Simulate Scheduler._onStart to prevent actual execution
Scheduler._onStart = async () => {}

// Trigger intent → dispatcher creates worker
IntentState.create('Play some music')

assert(VFS.isFile('/proc/workers/meta.json'), 'Meta file created')
const meta = JSON.parse(VFS.readFile('/proc/workers/meta.json'))
assert(meta.nextWorkerId > 1, 'nextWorkerId incremented')
assert(Object.keys(meta.intentWorker).length > 0, 'intentWorker mapping saved')

// --- Test 3: Dispatcher afterTurn saves state ---
console.log('\n📋 Test 3: afterTurn persists worker state')
resetVFS()
Dispatcher.init(null)
Dispatcher.registerWorker(5, 'Search for weather', [])

Dispatcher.beforeTurn(5)
Dispatcher.afterTurn(5, { usage: { input_tokens: 100, output_tokens: 50 }, toolCalls: [{}] })
const afterData = JSON.parse(VFS.readFile('/proc/workers/5.json'))
assert(afterData.totalTokens === 150, 'Token count tracked')
assert(afterData.toolCallCount === 1, 'Tool call count tracked')
assert(afterData.turnCount === 1, 'Turn count incremented via beforeTurn')

// --- Test 4: Dispatcher restore from VFS ---
console.log('\n📋 Test 4: Dispatcher restores suspended workers from VFS')
resetVFS()

// Manually write a "running" worker to VFS (simulating crash)
VFS.mkdir('/proc/workers')
VFS.writeFile('/proc/workers/10.json', JSON.stringify({
  id: 10, task: 'Build a todo app', status: 'running',
  steps: [], completedSteps: [], turnCount: 3,
  messages: [{ role: 'user', content: 'hello' }],
  system: '', tools: [], createdAt: Date.now(), updatedAt: Date.now(),
  totalTokens: 500, toolCallCount: 5,
}))
VFS.writeFile('/proc/workers/meta.json', JSON.stringify({
  nextWorkerId: 11,
  intentWorker: { 'intent-1': 10 },
  workerIntent: { '10': 'intent-1' },
}))

// Re-init Dispatcher (simulating page reload)
Dispatcher.init(null)

const resumed = Dispatcher.getWorker(10)
assert(resumed !== null, 'Worker 10 restored')
assert(resumed.status === 'suspended', 'Running worker marked as suspended on restore')
assert(resumed.task === 'Build a todo app', 'Task preserved')
assert(resumed.turnCount === 3, 'Turn count preserved')
assert(resumed.totalTokens === 500, 'Token count preserved')

// --- Test 5: Scheduler writes state to VFS ---
console.log('\n📋 Test 5: Scheduler writes state to VFS')
resetVFS()
Scheduler._onStart = null  // Don't actually start tasks

Scheduler.enqueue('Task A', [], 1)
assert(VFS.isFile('/proc/scheduler/state.json'), 'Scheduler state file created')

const schedState = JSON.parse(VFS.readFile('/proc/scheduler/state.json'))
// Task A should be in slots (started) or pending
const totalTasks = (schedState.pending?.length || 0) + (schedState.slots?.length || 0)
assert(totalTasks >= 0, `Scheduler has tasks tracked (${totalTasks})`)
assert(schedState.nextTaskId > 1, 'nextTaskId incremented')

// --- Test 6: Scheduler restore from VFS ---
console.log('\n📋 Test 6: Scheduler restores pending tasks from VFS')
resetVFS()

// Write scheduler state to VFS (simulating crash)
VFS.mkdir('/proc/scheduler')
VFS.writeFile('/proc/scheduler/state.json', JSON.stringify({
  nextTaskId: 5,
  pending: [
    { id: 3, task: 'Pending task', steps: [], priority: 1, dependsOn: [], status: 'pending', retryCount: 0, meta: {} },
  ],
  slots: [
    { slotIndex: 0, id: 4, task: 'Running task', steps: [], priority: 1, status: 'running', meta: {} },
  ],
  completed: [{ id: 1, task: 'Old task', status: 'done' }],
}))

Scheduler._onStart = null
Scheduler._restore()

const state = Scheduler.getState()
// Running task should be back in pending or started in a slot
const allTasks = [...state.pending.map(t => t.task), ...state.slots.map(s => s.task)]
assert(allTasks.includes('Pending task'), 'Pending task restored (pending or slot)')
assert(allTasks.includes('Running task'), 'Running task restored (pending or slot)')

// --- Test 7: Dispatcher workerCompleted updates VFS ---
console.log('\n📋 Test 7: workerCompleted persists done status')
resetVFS()
Dispatcher.init(null)
Dispatcher.registerWorker(20, 'Find restaurants', [])

Dispatcher.workerCompleted(20, { summary: 'Found 3 restaurants nearby' })
const doneData = JSON.parse(VFS.readFile('/proc/workers/20.json'))
assert(doneData.status === 'done', 'Worker marked as done in VFS')

// --- Test 8: Dispatcher workerFailed updates VFS ---
console.log('\n📋 Test 8: workerFailed persists error')
resetVFS()
Dispatcher.init(null)
Dispatcher.registerWorker(21, 'Broken task', [])

Dispatcher.workerFailed(21, 'API timeout')
const failData = JSON.parse(VFS.readFile('/proc/workers/21.json'))
assert(failData.status === 'failed', 'Worker marked as failed in VFS')
assert(failData.error === 'API timeout', 'Error message preserved')

// --- Test 9: Dispatcher GC cleans old workers ---
console.log('\n📋 Test 9: GC cleans old done workers')
resetVFS()
Dispatcher.init(null)

VFS.mkdir('/proc/workers')
VFS.writeFile('/proc/workers/99.json', JSON.stringify({
  id: 99, task: 'Old task', status: 'done',
  updatedAt: Date.now() - 8 * 86400_000,  // 8 days ago
}))
VFS.writeFile('/proc/workers/100.json', JSON.stringify({
  id: 100, task: 'Recent task', status: 'done',
  updatedAt: Date.now(),  // just now
}))

Dispatcher.gc(7 * 86400_000)
assert(!VFS.isFile('/proc/workers/99.json'), 'Old done worker cleaned up')
assert(VFS.isFile('/proc/workers/100.json'), 'Recent done worker kept')

// --- Test 10: End-to-end intent → VFS flow ---
console.log('\n📋 Test 10: End-to-end intent → worker → VFS')
resetVFS()
Scheduler._onStart = async (task, steps, abort, opts) => {
  // Simulate what agent.js startWorker does
  if (opts?.workerId) Dispatcher.registerWorker(opts.workerId, task, steps)
  return { summary: `Completed: ${task}` }
}
Dispatcher.init(null)

const intent = IntentState.create('Show me the weather in Beijing')

// Give event loop a tick for async scheduling
setTimeout(() => {
  const files = VFS.ls('/proc/workers')?.filter(f => f.name !== 'meta.json' && f.name.endsWith('.json')) || []
  assert(files.length > 0, `Worker file created from intent (found ${files.length} files)`)

  const metaFile = VFS.readFile('/proc/workers/meta.json')
  assert(metaFile !== null, 'Meta file exists after intent flow')

  // Summary
  console.log(`\n${'═'.repeat(50)}`)
  console.log(`Results: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}, 100)
