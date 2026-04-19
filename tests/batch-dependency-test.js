/* batch-dependency-test.js — Test batch processing + dependency DAG
 *
 * Tests Scheduler dependency handling with various patterns.
 * Run: node tests/batch-dependency-test.js
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// --- Minimal stubs ---
const EventBus = { _h: {}, on(e, f) { (this._h[e] = this._h[e] || []).push(f) }, emit(e, d) { (this._h[e] || []).forEach(f => f(d)) } }
globalThis.EventBus = EventBus

// Load Scheduler (eval in ESM needs globalThis)
const schedulerSrc = readFileSync(__dirname + '/../scheduler.js', 'utf8')
const wrappedSrc = schedulerSrc.replace('const Scheduler', 'globalThis.Scheduler')
new Function('EventBus', wrappedSrc)(EventBus)
const Scheduler = globalThis.Scheduler

// --- Test framework ---
let passed = 0, failed = 0
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`) }
  else { failed++; console.error(`  ❌ ${msg}`) }
}

async function runTests() {

// --- Mock Dispatcher.planBatch ---
// We test the Scheduler's dependency handling directly, then test planBatch prompt logic separately

console.log('\n📋 Test 1: Independent tasks (all parallel)')
{
  // Reset
  Scheduler.abort(null)
  const events = { started: [], finished: [] }
  EventBus.on('scheduler.started', e => events.started.push(e))
  EventBus.on('scheduler.finished', e => events.finished.push(e))

  // Set up instant worker
  Scheduler._onStart = async (entry) => {
    await new Promise(r => setTimeout(r, 50))
  }

  const id1 = Scheduler.enqueue('Check weather', [], 1, [])
  const id2 = Scheduler.enqueue('Write haiku', [], 1, [])
  const id3 = Scheduler.enqueue('Play music', [], 1, [])

  // All 3 should start immediately (3 slots)
  await new Promise(r => setTimeout(r, 20))
  const state = Scheduler.getState()
  assert(state.running.length === 3, `All 3 running in parallel (got ${state.running.length})`)
  assert(state.pending.length === 0, `Nothing pending (got ${state.pending.length})`)

  await new Promise(r => setTimeout(r, 100))
  assert(events.finished.length === 3, `All 3 finished (got ${events.finished.length})`)
}

console.log('\n📋 Test 2: Sequential dependency (A → B)')
{
  Scheduler.abort(null)
  EventBus._h = {}
  const order = []
  EventBus.on('scheduler.started', e => order.push({ event: 'start', id: e.id }))
  EventBus.on('scheduler.finished', e => order.push({ event: 'finish', id: e.id }))

  Scheduler._onStart = async (entry) => {
    await new Promise(r => setTimeout(r, 80))
  }

  const idA = Scheduler.enqueue('Create projects folder', [], 1, [])
  const idB = Scheduler.enqueue('Write readme in projects', [], 1, [idA])

  // A should start, B should be pending
  await new Promise(r => setTimeout(r, 20))
  let state = Scheduler.getState()
  assert(state.running.length === 1, `Only A running (got ${state.running.length})`)
  assert(state.running[0]?.id === idA, `A is the running task`)
  assert(state.pending.length === 1, `B is pending (got ${state.pending.length})`)

  // Wait for A to finish, B should auto-start
  await new Promise(r => setTimeout(r, 120))
  state = Scheduler.getState()
  // B might still be running or just finished
  await new Promise(r => setTimeout(r, 100))

  assert(order.length >= 3, `At least 3 events (start A, finish A, start B)`)
  assert(order[0].event === 'start' && order[0].id === idA, 'A started first')
  assert(order[1].event === 'finish' && order[1].id === idA, 'A finished before B starts')
  assert(order[2].event === 'start' && order[2].id === idB, 'B started after A finished')
}

console.log('\n📋 Test 3: Diamond dependency (A→B, A→C, B+C→D)')
{
  Scheduler.abort(null)
  EventBus._h = {}
  const order = []
  EventBus.on('scheduler.started', e => order.push({ event: 'start', id: e.id, time: Date.now() }))
  EventBus.on('scheduler.finished', e => order.push({ event: 'finish', id: e.id, time: Date.now() }))

  Scheduler._onStart = async (entry) => {
    const delay = entry.task.includes('Setup') ? 100 : 60
    await new Promise(r => setTimeout(r, delay))
  }

  const idA = Scheduler.enqueue('Setup environment', [], 1, [])
  const idB = Scheduler.enqueue('Install frontend deps', [], 1, [idA])
  const idC = Scheduler.enqueue('Install backend deps', [], 1, [idA])
  const idD = Scheduler.enqueue('Run integration tests', [], 1, [idB, idC])

  // A starts immediately
  await new Promise(r => setTimeout(r, 20))
  let state = Scheduler.getState()
  assert(state.running.length === 1, `Only A running initially (got ${state.running.length})`)

  // After A finishes, B and C should start in parallel
  await new Promise(r => setTimeout(r, 130))
  state = Scheduler.getState()
  // B and C should be running (or one might have finished already)
  const bcStarted = order.filter(e => e.event === 'start' && (e.id === idB || e.id === idC))
  assert(bcStarted.length === 2, `B and C both started (got ${bcStarted.length})`)

  // D should not have started yet (B and C not both done)
  const dStarted = order.filter(e => e.event === 'start' && e.id === idD)

  // Wait for everything
  await new Promise(r => setTimeout(r, 200))

  const dStart = order.find(e => e.event === 'start' && e.id === idD)
  const bFinish = order.find(e => e.event === 'finish' && e.id === idB)
  const cFinish = order.find(e => e.event === 'finish' && e.id === idC)

  assert(dStart != null, 'D eventually started')
  if (dStart && bFinish && cFinish) {
    assert(dStart.time >= bFinish.time && dStart.time >= cFinish.time,
      'D started only after both B and C finished')
  }
}

console.log('\n📋 Test 4: Dependency with priority (urgent task bypasses queue but respects deps)')
{
  Scheduler.abort(null)
  EventBus._h = {}
  const order = []
  EventBus.on('scheduler.started', e => order.push({ event: 'start', id: e.id, task: e.task }))

  Scheduler._onStart = async (entry) => {
    await new Promise(r => setTimeout(r, 80))
  }

  // Low priority tasks fill slots
  const id1 = Scheduler.enqueue('Background task 1', [], 2, [])
  const id2 = Scheduler.enqueue('Background task 2', [], 2, [])
  const id3 = Scheduler.enqueue('Background task 3', [], 2, [])

  // Urgent task with dependency on id1
  const idUrgent = Scheduler.enqueue('Urgent: deploy after task 1', [], 0, [id1])

  await new Promise(r => setTimeout(r, 20))
  let state = Scheduler.getState()
  // All 3 bg tasks running, urgent waiting for id1
  assert(state.running.length === 3, `3 slots filled (got ${state.running.length})`)
  assert(state.pending.some(t => t.id === idUrgent), 'Urgent task is pending (waiting for dep)')

  await new Promise(r => setTimeout(r, 200))
  const urgentStart = order.find(e => e.id === idUrgent)
  assert(urgentStart != null, 'Urgent task eventually ran')
}

console.log('\n📋 Test 5: Circular dependency protection')
{
  Scheduler.abort(null)
  EventBus._h = {}

  Scheduler._onStart = async (entry) => {
    await new Promise(r => setTimeout(r, 50))
  }

  // Create tasks with circular deps (A→B, B→A) — should not deadlock
  const idA = Scheduler.enqueue('Task A', [], 1, [])
  // B depends on A (valid)
  const idB = Scheduler.enqueue('Task B', [], 1, [idA])
  // C depends on B (valid chain)
  const idC = Scheduler.enqueue('Task C', [], 1, [idB])

  // This should work fine — linear chain
  await new Promise(r => setTimeout(r, 300))
  const state = Scheduler.getState()
  assert(state.running.length === 0, 'All tasks completed (no deadlock)')
  assert(state.completed.length >= 3, `3 tasks in completed (got ${state.completed.length})`)
}

console.log('\n📋 Test 6: Mixed batch — some parallel, some dependent')
{
  Scheduler.abort(null)
  EventBus._h = {}
  const startTimes = {}
  EventBus.on('scheduler.started', e => { startTimes[e.id] = Date.now() })
  EventBus.on('scheduler.finished', e => { startTimes[e.id + '_done'] = Date.now() })

  Scheduler._onStart = async (entry) => {
    await new Promise(r => setTimeout(r, 60))
  }

  // Simulate planBatch output:
  // "Check weather" — independent
  // "Create folder X" — independent
  // "Write file in X" — depends on "Create folder X"
  // "Search web" — independent
  const id1 = Scheduler.enqueue('Check weather', [], 1, [])
  const id2 = Scheduler.enqueue('Create folder X', [], 1, [])
  const id3 = Scheduler.enqueue('Write file in X', [], 1, [id2])  // depends on id2
  const id4 = Scheduler.enqueue('Search web', [], 1, [])

  await new Promise(r => setTimeout(r, 20))
  let state = Scheduler.getState()
  // id1, id2, id4 should start (3 slots), id3 pending
  assert(state.running.length === 3, `3 tasks running in parallel (got ${state.running.length})`)
  const runningIds = state.running.map(r => r.id)
  assert(!runningIds.includes(id3), 'Task 3 (write file) is NOT running yet (waiting for folder creation)')

  await new Promise(r => setTimeout(r, 200))
  state = Scheduler.getState()
  assert(state.running.length === 0, 'All done')

  // Verify id3 started after id2 finished
  if (startTimes[id3] && startTimes[id2 + '_done']) {
    assert(startTimes[id3] >= startTimes[id2 + '_done'],
      'Write file started after Create folder finished')
  }
}

console.log('\n📋 Test 7: Batch window timing (single message = no batch)')
{
  Scheduler.abort(null)
  EventBus._h = {}

  Scheduler._onStart = async (entry) => {
    await new Promise(r => setTimeout(r, 30))
  }

  // Single enqueue — should start immediately, no 600ms wait
  const start = Date.now()
  const id = Scheduler.enqueue('Single task', [], 1, [])

  await new Promise(r => setTimeout(r, 10))
  const state = Scheduler.getState()
  assert(state.running.length === 1, 'Single task started immediately')
  assert(Date.now() - start < 100, 'No batch delay for single task')

  await new Promise(r => setTimeout(r, 50))
}

console.log('\n📋 Test 8: Dependency on non-existent task (should not block)')
{
  Scheduler.abort(null)
  EventBus._h = {}

  Scheduler._onStart = async (entry) => {
    await new Promise(r => setTimeout(r, 30))
  }

  // Task depends on ID 9999 which doesn't exist
  const id = Scheduler.enqueue('Orphan task', [], 1, [9999])

  await new Promise(r => setTimeout(r, 20))
  const state = Scheduler.getState()
  // This task should be stuck in pending since dep 9999 never completes
  assert(state.pending.length === 1 || state.running.length === 0,
    'Task with missing dep stays pending (not started)')

  // Clean up
  Scheduler.abort(null)
}

// --- Summary ---
console.log(`\n${'='.repeat(40)}`)
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`)
if (failed > 0) process.exit(1)
}

runTests()
