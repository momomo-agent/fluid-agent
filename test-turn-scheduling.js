/* test-turn-scheduling.js — Test turn-aware Scheduler + Dispatcher integration */

const _vfsStore = new Map()
globalThis.VFS = {
  isDir(p) { return _vfsStore.get(p)?.type === 'dir' },
  isFile(p) { return _vfsStore.get(p)?.type === 'file' },
  mkdir(p) {
    const parts = p.split('/').filter(Boolean); let cur = ''
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

IntentState.init()
Scheduler._onStart = () => new Promise(() => {})
Dispatcher.init(null)
Dispatcher.setDispatchMode('code')

let passed = 0, failed = 0, total = 0
function assert(cond, msg) {
  total++
  if (cond) { passed++; console.log(`  ✅ ${msg}`) }
  else { failed++; console.error(`  ❌ ${msg}`) }
}

console.log('\n═══════════════════════════════════════════════════')
console.log('  Test Suite: Turn-Aware Scheduling')
console.log('═══════════════════════════════════════════════════\n')

// ═══════════════════════════════════════════════════════════════
// Test 1: turnCompleted returns continue for normal turns
// ═══════════════════════════════════════════════════════════════

console.log('--- Test 1: Normal turn → continue ---')

const i1 = IntentState.create('Task A')
const w1 = 1  // first worker ID
Dispatcher.registerWorker(w1, 'Task A', [])

const d1 = Scheduler.turnCompleted(w1, { tokens: 1000 })
assert(d1.action === 'continue', 'Normal turn returns continue')

const stats1 = Scheduler.getSlotStats(w1)
assert(stats1 !== null, 'Slot stats found')
assert(stats1.turnCount === 1, 'Turn count incremented to 1')
assert(stats1.totalTokens === 1000, 'Tokens tracked (1000)')

// ═══════════════════════════════════════════════════════════════
// Test 2: Token budget exceeded → suspend
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Test 2: Token budget exceeded → suspend ---')

// Simulate many turns to hit token budget
for (let i = 0; i < 19; i++) {
  Scheduler.turnCompleted(w1, { tokens: 10000 })
}
// Now at 191000 tokens (1000 + 19*10000), one more should exceed 200000
const d2 = Scheduler.turnCompleted(w1, { tokens: 10000 })
assert(d2.action === 'suspend', 'Token budget exceeded → suspend')
assert(d2.reason.includes('Token budget'), 'Reason mentions token budget')

const stats2 = Scheduler.getSlotStats(w1)
assert(stats2.totalTokens >= 200000, `Total tokens ${stats2.totalTokens} >= 200000`)

// ═══════════════════════════════════════════════════════════════
// Test 3: Turn budget exceeded → suspend
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Test 3: Turn budget exceeded → suspend ---')

// Create a new intent/worker
const i3 = IntentState.create('Task B')
const w3 = 2
Dispatcher.registerWorker(w3, 'Task B', [])

// Simulate 29 turns (under budget)
for (let i = 0; i < 29; i++) {
  const d = Scheduler.turnCompleted(w3, { tokens: 100 })
  // Should continue (unless quantum/preemption triggers, but no pending tasks)
}
// Turn 30 should hit MAX_TURN_BUDGET
const d3 = Scheduler.turnCompleted(w3, { tokens: 100 })
assert(d3.action === 'suspend', 'Turn budget exceeded → suspend')
assert(d3.reason.includes('Turn budget'), 'Reason mentions turn budget')

// ═══════════════════════════════════════════════════════════════
// Test 4: Preemption — higher priority task waiting
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Test 4: Preemption for higher priority ---')

// Create a low-priority task in a slot
const i4 = IntentState.create('Low priority background task')
const w4 = 3
Dispatcher.registerWorker(w4, 'Low priority background task', [])

// Manually set its priority to 2 (low) in the slot
for (const [idx, s] of Scheduler.getState().slots.entries ? [] : []) {}
// We need to manipulate the slot priority — enqueue with priority 2
// Actually, let's add a pending high-priority task
Scheduler.enqueue('Urgent task', [], 0, [], { workerId: 99 })  // priority 0 = urgent

// Simulate turns up to quantum (10)
for (let i = 0; i < 9; i++) {
  Scheduler.turnCompleted(w4, { tokens: 100 })
}
// Turn 10 = quantum boundary, with pending task → should suggest suspend
const d4 = Scheduler.turnCompleted(w4, { tokens: 100 })
assert(d4.action === 'suspend', 'Quantum expired with pending task → suspend')
assert(d4.reason.includes('Quantum') || d4.reason.includes('priority'), 'Reason mentions quantum or priority')

// ═══════════════════════════════════════════════════════════════
// Test 5: No pending tasks → no preemption at quantum
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Test 5: No pending tasks → continue at quantum ---')

// Clear pending by aborting the urgent task
Scheduler.abort(99)

const i5 = IntentState.create('Solo task')
const w5 = 4
Dispatcher.registerWorker(w5, 'Solo task', [])

// Run exactly TURN_QUANTUM turns with no pending tasks
for (let i = 0; i < 9; i++) {
  Scheduler.turnCompleted(w5, { tokens: 100 })
}
const d5 = Scheduler.turnCompleted(w5, { tokens: 100 })
assert(d5.action === 'continue', 'No pending tasks → continue even at quantum')

// ═══════════════════════════════════════════════════════════════
// Test 6: Dispatcher.afterTurn integrates with Scheduler
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Test 6: Dispatcher.afterTurn returns Scheduler decision ---')

const i6 = IntentState.create('Integrated task')
const w6 = 5
Dispatcher.registerWorker(w6, 'Integrated task', [])

// Normal turn
const d6a = Dispatcher.afterTurn(w6, {
  usage: { input_tokens: 500, output_tokens: 200 },
  toolCalls: [{ name: 'fs' }],
  progress: 'Working...',
})
assert(d6a.action === 'continue', 'Dispatcher.afterTurn returns continue for normal turn')

// Verify intent got progress update
assert(IntentState.get(i6.id).progress === 'Working...', 'Progress written through afterTurn')

// ═══════════════════════════════════════════════════════════════
// Test 7: getSlotStats returns null for unknown worker
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Test 7: getSlotStats for unknown worker ---')

const stats7 = Scheduler.getSlotStats(999)
assert(stats7 === null, 'Unknown worker returns null stats')

// ═══════════════════════════════════════════════════════════════
// Test 8: Constants are exposed
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Test 8: Scheduler constants ---')

assert(Scheduler.MAX_TURN_BUDGET === 30, 'MAX_TURN_BUDGET = 30')
assert(Scheduler.MAX_TOKEN_BUDGET === 200000, 'MAX_TOKEN_BUDGET = 200000')
assert(Scheduler.TURN_QUANTUM === 10, 'TURN_QUANTUM = 10')
assert(Scheduler.MAX_SLOTS === 3, 'MAX_SLOTS = 3')

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════════════════')
console.log(`  Results: ${passed}/${total} passed, ${failed} failed`)
console.log('═══════════════════════════════════════════════════\n')

process.exit(failed > 0 ? 1 : 0)
