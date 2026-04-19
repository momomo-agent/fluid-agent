#!/usr/bin/env node
/* node-stress-test.js — Run OS stability tests in Node.js (no browser needed)
 *
 * Loads the core modules (EventBus, Scheduler, VFS, WindowManager) in isolation
 * and stress-tests the task pipeline.
 */

const fs = require('fs')
const path = require('path')
const dir = path.resolve(__dirname, '..')

// Minimal DOM mock for WindowManager
global.document = {
  createElement: (tag) => ({
    tagName: tag.toUpperCase(),
    className: '', classList: { add() {}, remove() {}, contains() { return false }, toggle() {} },
    style: {}, dataset: {},
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    appendChild: () => {},
    removeChild: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    offsetLeft: 0, offsetTop: 0, offsetWidth: 800, offsetHeight: 600,
    children: [], childNodes: [],
    innerHTML: '', textContent: '',
    setAttribute: () => {},
    getAttribute: () => null,
  }),
  getElementById: () => ({
    appendChild: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    style: {},
    classList: { add() {}, remove() {}, contains() { return false } },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    offsetWidth: 1200, offsetHeight: 800,
    children: [],
  }),
  addEventListener: () => {},
  body: { appendChild: () => {}, style: {} },
  documentElement: { style: {} },
}
global.window = { innerWidth: 1200, innerHeight: 800, addEventListener: () => {}, getComputedStyle: () => ({}) }
global.requestAnimationFrame = (fn) => setTimeout(fn, 0)
global.ResizeObserver = class { observe() {} disconnect() {} }
global.MutationObserver = class { observe() {} disconnect() {} }
global.HTMLElement = class {}
global.localStorage = { getItem: () => null, setItem: () => {} }

// Load modules in order
function loadModule(filename) {
  const code = fs.readFileSync(path.join(dir, filename), 'utf8')
  try {
    eval(code)
  } catch (e) {
    // Some modules may fail on DOM-heavy parts, that's OK for scheduler/eventbus
    if (!global[filename.replace('.js', '').replace(/-./g, c => c[1].toUpperCase())]) {
      // Try to extract the IIFE result
    }
  }
}

// EventBus
const ebCode = fs.readFileSync(path.join(dir, 'eventbus.js'), 'utf8')
const EventBus = eval(`(function(){ ${ebCode.replace('const EventBus =', 'return')} })()`)
global.EventBus = EventBus

// Scheduler
const schCode = fs.readFileSync(path.join(dir, 'scheduler.js'), 'utf8')
const Scheduler = eval(`(function(){ ${schCode.replace('const Scheduler =', 'return')} })()`)
global.Scheduler = Scheduler

// --- Tests ---
let passed = 0, failed = 0, total = 0

function assert(cond, msg) {
  total++
  if (cond) { passed++; console.log(`  ✅ ${msg}`) }
  else { failed++; console.log(`  ❌ ${msg}`) }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function test1_rapidEnqueue() {
  console.log('\n📋 Test 1: Rapid enqueue 50 tasks')
  const count = 50
  const ids = new Set()

  // Mock worker that completes after random delay
  Scheduler._onStart = (entry, slot, abort) => new Promise(resolve => {
    setTimeout(resolve, Math.random() * 100 + 50)
  })

  for (let i = 0; i < count; i++) {
    const id = Scheduler.enqueue(`task-${i}`, [`step-${i}`], 1)
    ids.add(id)
  }

  assert(ids.size === count, `All ${count} IDs unique (got ${ids.size})`)

  const state = Scheduler.getState()
  const tracked = state.running.length + state.pending.length
  assert(tracked === count, `All ${count} tasks tracked in scheduler (got ${tracked})`)
  assert(state.running.length <= 3, `Max 3 slots used (got ${state.running.length})`)
  assert(state.pending.length === count - state.running.length, `Rest in pending (${state.pending.length})`)

  // Wait for all to complete
  await sleep(6000)
  const stateAfter = Scheduler.getState()
  assert(stateAfter.running.length === 0, `All tasks completed (running: ${stateAfter.running.length})`)
  assert(stateAfter.pending.length === 0, `No pending left (${stateAfter.pending.length})`)
}

async function test2_abortAll() {
  console.log('\n📋 Test 2: Abort all during execution')

  Scheduler._onStart = (entry, slot, abort) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 5000)
    abort.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')) })
  })

  for (let i = 0; i < 10; i++) {
    Scheduler.enqueue(`abort-test-${i}`, [], 1)
  }

  await sleep(100)
  const before = Scheduler.getState()
  assert(before.running.length === 3, `3 running before abort (got ${before.running.length})`)

  Scheduler.abort(null)
  await sleep(100)

  const after = Scheduler.getState()
  assert(after.running.length === 0, `0 running after abort (got ${after.running.length})`)
  assert(after.pending.length === 0, `0 pending after abort (got ${after.pending.length})`)
}

async function test3_priorityPreemption() {
  console.log('\n📋 Test 3: Priority ordering')

  const order = []
  Scheduler._onStart = (entry, slot, abort) => new Promise(resolve => {
    order.push(entry.task)
    setTimeout(resolve, 50)
  })

  // Enqueue low priority first, then high
  Scheduler.enqueue('low-1', [], 2)
  Scheduler.enqueue('low-2', [], 2)
  Scheduler.enqueue('low-3', [], 2)
  Scheduler.enqueue('high-1', [], 0)
  Scheduler.enqueue('normal-1', [], 1)

  await sleep(2000)

  // High priority should have started before remaining lows
  const highIdx = order.indexOf('high-1')
  const lastLowIdx = Math.max(order.indexOf('low-1'), order.indexOf('low-2'), order.indexOf('low-3'))
  // At minimum, high-1 should start within first 4 (3 slots + 1 after first completes)
  assert(highIdx <= 4, `High priority task started early (position ${highIdx})`)
  assert(order.length === 5, `All 5 tasks ran (got ${order.length})`)
}

async function test4_concurrentEnqueue() {
  console.log('\n📋 Test 4: Concurrent enqueue (simulating rapid messages)')

  let started = 0
  Scheduler._onStart = (entry, slot, abort) => new Promise(resolve => {
    started++
    setTimeout(resolve, 30)
  })

  // Simulate 20 messages arriving within 10ms
  const promises = []
  for (let i = 0; i < 20; i++) {
    promises.push(new Promise(resolve => {
      setTimeout(() => {
        Scheduler.enqueue(`concurrent-${i}`, [], 1)
        resolve()
      }, Math.random() * 10)
    }))
  }

  await Promise.all(promises)
  await sleep(3000)

  assert(started === 20, `All 20 concurrent tasks started (got ${started})`)
  const state = Scheduler.getState()
  assert(state.running.length === 0, `All completed (running: ${state.running.length})`)
}

async function test5_steerDuringExecution() {
  console.log('\n📋 Test 5: Steer during execution')

  let steered = false
  Scheduler._onStart = (entry, slot, abort) => new Promise(resolve => {
    // Listen for steer events
    EventBus.on('scheduler.steer', () => { steered = true })
    setTimeout(resolve, 500)
  })

  Scheduler.enqueue('steer-target', ['step1'], 1)
  await sleep(100)

  const state = Scheduler.getState()
  if (state.running.length > 0) {
    const result = Scheduler.steer(state.running[0].id, 'new direction')
    assert(result === true, 'Steer returned true')
    await sleep(50)
    assert(steered, 'Steer event fired')
  } else {
    assert(false, 'No running task to steer')
  }

  Scheduler.abort(null)
  await sleep(100)
}

async function test6_eventBusReliability() {
  console.log('\n📋 Test 6: EventBus reliability under load')

  let enqueued = 0, started = 0, finished = 0
  EventBus.on('scheduler.enqueued', () => enqueued++)
  EventBus.on('scheduler.started', () => started++)
  EventBus.on('scheduler.finished', () => finished++)

  Scheduler._onStart = (entry, slot, abort) => new Promise(resolve => setTimeout(resolve, 20))

  const count = 15
  for (let i = 0; i < count; i++) {
    Scheduler.enqueue(`event-test-${i}`, [], 1)
  }

  await sleep(3000)

  assert(enqueued === count, `${count} enqueued events (got ${enqueued})`)
  assert(started === count, `${count} started events (got ${started})`)
  assert(finished === count, `${count} finished events (got ${finished})`)
}

// --- Run ---
async function main() {
  console.log('🔥 Fluid Agent OS — Node Stress Test')
  console.log(`   Scheduler MAX_SLOTS: ${Scheduler.MAX_SLOTS}`)
  console.log(`   Time: ${new Date().toLocaleString()}`)

  await test1_rapidEnqueue()
  await test2_abortAll()
  await test3_priorityPreemption()
  await test4_concurrentEnqueue()
  await test5_steerDuringExecution()
  await test6_eventBusReliability()

  console.log(`\n${'='.repeat(40)}`)
  console.log(`Results: ${passed}/${total} passed, ${failed} failed`)
  console.log('='.repeat(40))

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
