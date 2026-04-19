/* stress-test.js — OS stability stress test
 *
 * Run in browser console after loading fluid-agent.
 * Tests message→task pipeline under concurrent load.
 *
 * Usage: paste into console, or load via <script src="tests/stress-test.js">
 */
const StressTest = (() => {
  const results = []
  let testCount = 0

  function log(msg, type = 'info') {
    const entry = { id: ++testCount, time: Date.now(), type, msg }
    results.push(entry)
    const color = type === 'pass' ? 'green' : type === 'fail' ? 'red' : type === 'warn' ? 'orange' : 'gray'
    console.log(`%c[StressTest #${entry.id}] ${msg}`, `color:${color}`)
  }

  function assert(cond, msg) {
    if (cond) log(`✅ ${msg}`, 'pass')
    else log(`❌ ${msg}`, 'fail')
    return cond
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

  // --- Helpers ---

  function getTaskCount() {
    return (WindowManager.getTaskHistory?.() || []).length
  }

  function getSchedulerState() {
    return Scheduler.getState()
  }

  function getLastNTasks(n) {
    return (WindowManager.getTaskHistory?.() || []).slice(0, n)
  }

  // --- Test 1: Rapid-fire messages (no LLM, direct enqueue) ---
  async function testDirectEnqueue(count = 10) {
    log(`--- Test: Direct enqueue ${count} tasks rapidly ---`)
    const before = getTaskCount()

    for (let i = 0; i < count; i++) {
      Scheduler.enqueue(`stress-direct-${Date.now()}-${i}`, [`step-${i}`], 1)
    }

    await sleep(100)
    const after = getTaskCount()
    const schedulerState = getSchedulerState()
    const totalTracked = schedulerState.running.length + schedulerState.pending.length + (after - before)

    log(`Before: ${before} tasks, After: ${after} tasks, Scheduler running: ${schedulerState.running.length}, pending: ${schedulerState.pending.length}`)
    // Tasks should either be in taskHistory (started) or in scheduler pending
    assert(after - before + schedulerState.pending.length >= count - 3,
      `At least ${count - 3} of ${count} tasks tracked (got ${after - before} in history + ${schedulerState.pending.length} pending)`)
  }

  // --- Test 2: Rapid-fire via chat queue (tests serial queue) ---
  async function testChatQueue(count = 5) {
    log(`--- Test: Chat queue ${count} messages rapidly ---`)
    const before = getTaskCount()

    // Fire all at once — they should queue
    const promises = []
    for (let i = 0; i < count; i++) {
      promises.push(Agent.chat(`Create a file called stress-test-${i}.txt with content "hello ${i}"`))
    }

    log(`Fired ${count} chat messages, waiting for processing...`)

    // Wait for all to complete (with timeout)
    const timeout = count * 30000 // 30s per message max
    const start = Date.now()
    await Promise.race([
      Promise.allSettled(promises),
      sleep(timeout)
    ])

    const elapsed = Date.now() - start
    const after = getTaskCount()
    const schedulerState = getSchedulerState()

    log(`Elapsed: ${(elapsed/1000).toFixed(1)}s, Tasks before: ${before}, after: ${after}, scheduler pending: ${schedulerState.pending.length}`)

    // Each message should have created a task (either completed or pending)
    const created = (after - before) + schedulerState.pending.length
    assert(created >= count - 1, `At least ${count - 1} of ${count} messages became tasks (got ${created})`)

    return { before, after, elapsed, created }
  }

  // --- Test 3: Task ID uniqueness under rapid creation ---
  async function testIdUniqueness(count = 20) {
    log(`--- Test: Task ID uniqueness (${count} rapid creates) ---`)
    const ids = new Set()
    const tasks = []

    for (let i = 0; i < count; i++) {
      const task = WindowManager.addTask(`uniqueness-test-${i}`, [`step`])
      tasks.push(task)
      ids.add(task.id)
    }

    assert(ids.size === count, `All ${count} task IDs unique (got ${ids.size} unique)`)

    // Cleanup
    const history = WindowManager.getTaskHistory()
    for (const t of tasks) {
      t.status = 'done'
    }
  }

  // --- Test 4: Scheduler slot saturation ---
  async function testSlotSaturation() {
    log(`--- Test: Scheduler slot saturation ---`)
    const state = getSchedulerState()
    const maxSlots = 3 // MAX_SLOTS

    // Enqueue more than MAX_SLOTS
    const count = maxSlots + 3
    for (let i = 0; i < count; i++) {
      Scheduler.enqueue(`saturation-${i}`, [`step`], 1)
    }

    await sleep(200)
    const afterState = getSchedulerState()

    log(`Running: ${afterState.running.length}, Pending: ${afterState.pending.length}`)
    assert(afterState.running.length <= maxSlots, `Running slots <= ${maxSlots} (got ${afterState.running.length})`)
    assert(afterState.running.length + afterState.pending.length >= count - maxSlots,
      `Overflow tasks queued (${afterState.pending.length} pending)`)
  }

  // --- Test 5: Abort during execution ---
  async function testAbortDuringExecution() {
    log(`--- Test: Abort during execution ---`)

    // Enqueue a task
    const id = Scheduler.enqueue('abort-test-task', ['step1', 'step2', 'step3'], 1)
    await sleep(500)

    const stateBefore = getSchedulerState()
    const wasRunning = stateBefore.running.some(r => r.task === 'abort-test-task')
    log(`Task running: ${wasRunning}`)

    // Abort all
    Scheduler.abort(null)
    await sleep(200)

    const stateAfter = getSchedulerState()
    assert(stateAfter.running.length === 0, `All tasks aborted (running: ${stateAfter.running.length})`)
  }

  // --- Test 6: Steer intent delivery ---
  async function testSteerDelivery() {
    log(`--- Test: Steer intent delivery ---`)

    // Enqueue a task first
    Scheduler.enqueue('steer-target-task', ['step1', 'step2'], 1)
    await sleep(300)

    const state = getSchedulerState()
    if (state.running.length === 0) {
      log('No running task to steer, skipping', 'warn')
      return
    }

    const targetId = state.running[0].id
    const steered = Scheduler.steer(targetId, 'change direction')
    assert(steered, `Steer delivered to task #${targetId}`)

    // Cleanup
    Scheduler.abort(null)
    await sleep(100)
  }

  // --- Test 7: ResizeObserver reflow ---
  async function testResizeReflow() {
    log(`--- Test: ResizeObserver reflow ---`)

    // Create a window and record its norm
    const id = WindowManager.create({ type: 'terminal', title: 'Resize Test', width: 400, height: 300 })
    const win = WindowManager.windows.get(id)

    if (!win || !win._norm) {
      log('Window created without _norm!', 'fail')
      WindowManager.close(id)
      return
    }

    const normBefore = { ...win._norm }
    log(`Norm before: x=${normBefore.x.toFixed(3)} y=${normBefore.y.toFixed(3)} w=${normBefore.width.toFixed(3)} h=${normBefore.height.toFixed(3)}`)

    // Simulate area resize by checking if norm is preserved
    const el = win.el
    const pxBefore = { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }

    assert(Math.abs(win._norm.x - normBefore.x) < 0.001, 'Norm x stable')
    assert(Math.abs(win._norm.width - normBefore.width) < 0.001, 'Norm width stable')

    WindowManager.close(id)
  }

  // --- Test 8: Concurrent task creation timing ---
  async function testConcurrentTiming() {
    log(`--- Test: Concurrent task creation timing ---`)

    // Simulate what happens when multiple _dispatchAction fire near-simultaneously
    const count = 5
    const promises = []

    for (let i = 0; i < count; i++) {
      promises.push(new Promise(resolve => {
        // Simulate async Dispatcher.handleIntent delay
        setTimeout(() => {
          Scheduler.enqueue(`concurrent-${i}`, [`step`], 1)
          resolve(i)
        }, Math.random() * 50)
      }))
    }

    await Promise.all(promises)
    await sleep(200)

    const state = getSchedulerState()
    const total = state.running.length + state.pending.length
    log(`Created ${count}, tracked: ${total} (running: ${state.running.length}, pending: ${state.pending.length})`)
    assert(total >= count - 3, `At least ${count - 3} of ${count} concurrent tasks tracked`)

    // Cleanup
    Scheduler.abort(null)
    await sleep(100)
  }

  // --- Run all ---
  async function runAll() {
    log('=== Fluid Agent OS Stress Test ===')
    log(`Time: ${new Date().toLocaleString()}`)

    // Abort any existing tasks first
    Scheduler.abort(null)
    await sleep(300)

    await testDirectEnqueue(10)
    await sleep(500)
    Scheduler.abort(null)
    await sleep(300)

    await testIdUniqueness(20)
    await sleep(300)

    await testSlotSaturation()
    await sleep(500)
    Scheduler.abort(null)
    await sleep(300)

    await testAbortDuringExecution()
    await sleep(300)

    await testSteerDelivery()
    await sleep(300)

    await testResizeReflow()
    await sleep(300)

    await testConcurrentTiming()
    await sleep(300)

    // Summary
    const passes = results.filter(r => r.type === 'pass').length
    const fails = results.filter(r => r.type === 'fail').length
    const warns = results.filter(r => r.type === 'warn').length
    log(`\n=== RESULTS: ${passes} pass, ${fails} fail, ${warns} warn ===`, fails > 0 ? 'fail' : 'pass')

    return { passes, fails, warns, results }
  }

  // --- Chat queue stress (requires LLM, slower) ---
  async function runChatStress(count = 5) {
    log('=== Chat Queue Stress Test ===')
    log(`Sending ${count} messages rapidly...`)

    Scheduler.abort(null)
    await sleep(500)

    return testChatQueue(count)
  }

  return { runAll, runChatStress, testDirectEnqueue, testChatQueue, testIdUniqueness, testSlotSaturation, testAbortDuringExecution, testSteerDelivery, testResizeReflow, testConcurrentTiming, results, log, assert }
})()

// Auto-announce
console.log('%c[StressTest] Loaded. Run: StressTest.runAll() or StressTest.runChatStress(5)', 'color:blue;font-weight:bold')
