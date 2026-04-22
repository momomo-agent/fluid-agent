/* scheduler.js — Task scheduler with parallel slots, turn-aware scheduling, and VFS persistence */
const Scheduler = (() => {
  const MAX_SLOTS = 3
  const MAX_RETRIES = 2
  const RETRY_BASE_MS = 1000
  const MAX_TURN_BUDGET = 30       // max turns per slot before forced suspend
  const MAX_TOKEN_BUDGET = 200000  // max tokens per slot before forced suspend
  const TURN_QUANTUM = 10          // turns per time slice for round-robin
  let nextTaskId = 1
  const pending = []       // { id, task, steps, priority, dependsOn, status:'pending', retryCount:0 }
  const slots = new Map()  // slotIndex → { id, task, steps, priority, abort, status:'running', turnCount, totalTokens }
  const completed = []     // last N completed tasks

  const PROC_DIR = '/proc/scheduler'

  // ═══════════════════════════════════════════════════════════════
  // VFS persistence
  // ═══════════════════════════════════════════════════════════════

  function _ensureProcDir() {
    if (typeof VFS !== 'undefined' && !VFS.isDir(PROC_DIR)) {
      VFS.mkdir(PROC_DIR)
    }
  }

  function _save() {
    if (typeof VFS === 'undefined') return
    _ensureProcDir()
    VFS.writeFile(`${PROC_DIR}/state.json`, JSON.stringify({
      nextTaskId,
      pending: pending.map(t => ({
        id: t.id, task: t.task, steps: t.steps, priority: t.priority,
        dependsOn: t.dependsOn, status: t.status, retryCount: t.retryCount || 0,
        meta: t.meta || {},
      })),
      slots: Array.from(slots.entries()).map(([idx, s]) => ({
        slotIndex: idx, id: s.id, task: s.task, steps: s.steps,
        priority: s.priority, status: s.status, meta: s.meta || {},
      })),
      completed: completed.slice(-20).map(t => ({
        id: t.id, task: t.task, status: t.status,
      })),
    }, null, 2))
  }

  function _restore() {
    if (typeof VFS === 'undefined') return
    if (!VFS.isFile(`${PROC_DIR}/state.json`)) return

    try {
      const data = JSON.parse(VFS.readFile(`${PROC_DIR}/state.json`))
      nextTaskId = data.nextTaskId || 1

      // Restore completed (for dependency resolution)
      if (data.completed) completed.push(...data.completed)

      // Restore pending tasks
      if (data.pending) {
        for (const t of data.pending) {
          if (t.status === 'pending') pending.push(t)
        }
      }

      // Tasks that were running in slots → back to pending (will be re-scheduled)
      if (data.slots) {
        for (const s of data.slots) {
          if (s.status === 'running') {
            pending.push({
              id: s.id, task: s.task, steps: s.steps || [],
              priority: s.priority, dependsOn: [], status: 'pending',
              retryCount: 0, meta: s.meta || {},
            })
          }
        }
      }

      pending.sort((a, b) => a.priority - b.priority)

      if (pending.length > 0) {
        console.log(`[Scheduler] Restored ${pending.length} pending tasks from VFS`)
        schedule()
      }
    } catch { /* corrupt state, start fresh */ }
  }

  // ═══════════════════════════════════════════════════════════════
  // Task lifecycle
  // ═══════════════════════════════════════════════════════════════

  function enqueue(taskDescription, steps = [], priority = 1, dependsOn = [], meta = {}) {
    // Dedup
    const norm = taskDescription.trim().toLowerCase()
    const isDup = pending.some(t => t.task.trim().toLowerCase() === norm && t.status === 'pending')
      || Array.from(slots.values()).some(s => s.task.trim().toLowerCase() === norm && s.status === 'running')
    if (isDup) {
      console.log(`[Scheduler] Dedup: "${taskDescription.slice(0, 60)}" already queued/running, skipping`)
      return -1
    }
    const id = nextTaskId++
    const entry = { id, task: taskDescription, steps, priority, dependsOn, status: 'pending', retryCount: 0, meta }
    pending.push(entry)
    pending.sort((a, b) => a.priority - b.priority)
    EventBus.emit('scheduler.enqueued', { id, task: taskDescription, priority })
    _save()
    schedule()
    return id
  }

  function schedule() {
    for (let i = 0; i < MAX_SLOTS; i++) {
      if (slots.has(i)) continue
      const ready = findReady()
      if (!ready) break

      if (!ready && pending.some(t => t.priority === 0)) {
        const bgSlot = findLowestPrioritySlot()
        if (bgSlot !== null && slots.get(bgSlot).priority >= 2) {
          pauseSlot(bgSlot)
          const urgent = findReady()
          if (urgent) startInSlot(i, urgent)
        }
        continue
      }

      startInSlot(i, ready)
    }
  }

  function findReady() {
    for (let i = 0; i < pending.length; i++) {
      const t = pending[i]
      if (t.status !== 'pending') continue
      const depsOk = t.dependsOn.every(depId =>
        completed.some(c => c.id === depId && c.status === 'done')
      )
      if (depsOk) {
        pending.splice(i, 1)
        return t
      }
    }
    return null
  }

  function findLowestPrioritySlot() {
    let worst = null, worstPri = -1
    for (const [idx, s] of slots) {
      if (s.priority > worstPri) { worst = idx; worstPri = s.priority }
    }
    return worst
  }

  function startInSlot(slotIndex, entry) {
    const abortController = new AbortController()
    entry.status = 'running'
    entry.abort = abortController
    entry.schedulerSlot = slotIndex
    entry.turnCount = entry.turnCount || 0
    entry.totalTokens = entry.totalTokens || 0
    slots.set(slotIndex, entry)
    _save()

    console.log(`[Scheduler] Slot ${slotIndex}: starting "${entry.task.slice(0, 60)}" (id=${entry.id}, pri=${entry.priority})`)

    if (Scheduler._onStart) {
      Scheduler._onStart(entry.task, entry.steps, abortController, {
        workerId: entry.meta?.workerId || entry.workerId,
        resume: entry.meta?.resume || false,
        messages: entry.meta?.messages,
        system: entry.meta?.system,
        tools: entry.meta?.tools,
      })
        .then(result => finishSlot(slotIndex, entry, 'done', result))
        .catch(err => {
          if (abortController.signal.aborted) {
            finishSlot(slotIndex, entry, 'aborted')
          } else {
            retryOrFail(slotIndex, entry, err)
          }
        })
    }
  }

  function finishSlot(slotIndex, entry, status, result) {
    slots.delete(slotIndex)
    entry.status = status
    completed.push({ id: entry.id, task: entry.task, status, result })
    if (completed.length > 50) completed.shift()
    EventBus.emit('scheduler.finished', { id: entry.id, task: entry.task, status, result })
    _save()
    schedule()
  }

  function retryOrFail(slotIndex, entry, error) {
    entry.retryCount = (entry.retryCount || 0) + 1
    if (entry.retryCount <= MAX_RETRIES) {
      console.log(`[Scheduler] Retry ${entry.retryCount}/${MAX_RETRIES} for "${entry.task.slice(0, 40)}"`)
      slots.delete(slotIndex)
      entry.status = 'pending'
      pending.push(entry)
      EventBus.emit('scheduler.retry', { id: entry.id, attempt: entry.retryCount })
      _save()
      setTimeout(() => schedule(), RETRY_BASE_MS * Math.pow(2, entry.retryCount - 1))
    } else {
      finishSlot(slotIndex, entry, 'error', { error: error?.message || String(error) })
    }
  }

  function pauseSlot(slotIndex) {
    const entry = slots.get(slotIndex)
    if (!entry) return
    if (entry.abort) entry.abort.abort()
    slots.delete(slotIndex)
    entry.status = 'pending'
    entry.priority = 2
    pending.push(entry)
    _save()
    console.log(`[Scheduler] Paused slot ${slotIndex}: "${entry.task.slice(0, 40)}"`)
  }

  // ═══════════════════════════════════════════════════════════════
  // Turn-aware scheduling
  // ═══════════════════════════════════════════════════════════════

  // Called by Dispatcher after each worker turn. Returns scheduling decision.
  function turnCompleted(workerId, turnInfo = {}) {
    // Find the slot running this worker
    let slotIndex = null, entry = null
    for (const [idx, s] of slots) {
      if (s.meta?.workerId === workerId || s.workerId === workerId) {
        slotIndex = idx
        entry = s
        break
      }
    }
    if (!entry) return { action: 'continue' }

    // Update turn stats
    entry.turnCount = (entry.turnCount || 0) + 1
    entry.totalTokens = (entry.totalTokens || 0) + (turnInfo.tokens || 0)
    _save()

    // --- Budget checks ---

    // Token budget exceeded
    if (entry.totalTokens >= MAX_TOKEN_BUDGET) {
      console.log(`[Scheduler] Slot ${slotIndex}: token budget exceeded (${entry.totalTokens}/${MAX_TOKEN_BUDGET})`)
      EventBus.emit('scheduler.budget', { id: entry.id, type: 'tokens', used: entry.totalTokens, limit: MAX_TOKEN_BUDGET })
      return { action: 'suspend', reason: `Token budget exceeded (${entry.totalTokens})` }
    }

    // Turn budget exceeded
    if (entry.turnCount >= MAX_TURN_BUDGET) {
      console.log(`[Scheduler] Slot ${slotIndex}: turn budget exceeded (${entry.turnCount}/${MAX_TURN_BUDGET})`)
      EventBus.emit('scheduler.budget', { id: entry.id, type: 'turns', used: entry.turnCount, limit: MAX_TURN_BUDGET })
      return { action: 'suspend', reason: `Turn budget exceeded (${entry.turnCount})` }
    }

    // --- Preemption check ---
    // If there's a higher-priority task waiting and we've used our quantum
    const hasHigherPriority = pending.some(t => t.status === 'pending' && t.priority < entry.priority)
    if (hasHigherPriority && entry.turnCount >= TURN_QUANTUM) {
      console.log(`[Scheduler] Slot ${slotIndex}: preempting for higher priority task (turn ${entry.turnCount})`)
      return { action: 'suspend', reason: 'Higher priority task waiting' }
    }

    // --- Fair scheduling (round-robin) ---
    // If other tasks are waiting and we've used our quantum, yield
    const waitingCount = pending.filter(t => t.status === 'pending').length
    if (waitingCount > 0 && entry.turnCount > 0 && entry.turnCount % TURN_QUANTUM === 0) {
      console.log(`[Scheduler] Slot ${slotIndex}: quantum expired (${TURN_QUANTUM} turns), yielding for fairness`)
      return { action: 'suspend', reason: `Quantum expired (${TURN_QUANTUM} turns)` }
    }

    return { action: 'continue' }
  }

  // Get turn stats for a slot by workerId
  function getSlotStats(workerId) {
    for (const [idx, s] of slots) {
      if (s.meta?.workerId === workerId || s.workerId === workerId) {
        return { slotIndex: idx, turnCount: s.turnCount || 0, totalTokens: s.totalTokens || 0, priority: s.priority }
      }
    }
    return null
  }

  // ═══════════════════════════════════════════════════════════════
  // Steer / Abort
  // ═══════════════════════════════════════════════════════════════

  function steer(taskId, instruction) {
    for (const [, entry] of slots) {
      if (entry.id === taskId || (taskId == null && entry.status === 'running')) {
        entry.steerInstruction = instruction
        console.log(`[Scheduler] Steered task ${entry.id}: "${instruction.slice(0, 60)}"`)
        return true
      }
    }
    return false
  }

  function abort(workerId) {
    // Abort by workerId (from meta)
    for (const [idx, entry] of slots) {
      if (entry.meta?.workerId === workerId || entry.workerId === workerId) {
        if (entry.abort) entry.abort.abort()
        finishSlot(idx, entry, 'aborted')
        return true
      }
    }
    // Also remove from pending
    const pi = pending.findIndex(t => t.meta?.workerId === workerId || t.workerId === workerId)
    if (pi >= 0) {
      pending.splice(pi, 1)
      _save()
      return true
    }
    return false
  }

  // ═══════════════════════════════════════════════════════════════
  // State queries
  // ═══════════════════════════════════════════════════════════════

  function getState() {
    return {
      pending: pending.map(t => ({ id: t.id, task: t.task, priority: t.priority, status: t.status })),
      slots: Array.from(slots.entries()).map(([idx, s]) => ({ slot: idx, id: s.id, task: s.task, priority: s.priority, status: s.status })),
      completed: completed.slice(-10),
    }
  }

  function isIdle() {
    return slots.size === 0 && pending.length === 0
  }

  return {
    enqueue, steer, abort, getState, isIdle, schedule,
    turnCompleted, getSlotStats,
    _onStart: null, _restore, MAX_SLOTS,
    MAX_TURN_BUDGET, MAX_TOKEN_BUDGET, TURN_QUANTUM,
  }
})()
