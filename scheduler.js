/* scheduler.js — Task scheduler with parallel slots, retry, persistence, and preemption */
const Scheduler = (() => {
  const MAX_SLOTS = 3
  const MAX_RETRIES = 2
  const RETRY_BASE_MS = 1000  // exponential backoff: 1s, 2s, 4s
  let nextTaskId = 1
  const pending = []       // { id, task, steps, priority, dependsOn, status:'pending', retryCount:0 }
  const slots = new Map()  // slotIndex → { id, task, steps, priority, abort, status:'running' }
  const completed = []     // last N completed tasks
  let _store = null        // agentic-store for persistence

  // --- Task lifecycle ---

  function enqueue(taskDescription, steps = [], priority = 1, dependsOn = [], meta = {}) {
    // Dedup: skip if same task is already pending or running
    const norm = taskDescription.trim().toLowerCase()
    const isDup = pending.some(t => t.task.trim().toLowerCase() === norm && t.status === 'pending')
      || Array.from(slots.values()).some(s => s.task.trim().toLowerCase() === norm && s.status === 'running')
    if (isDup) {
      console.log(`[Scheduler] Dedup: "${taskDescription.slice(0, 60)}" already queued/running, skipping`)
      return -1
    }
    const id = nextTaskId++
    const entry = { id, task: taskDescription, steps, priority, dependsOn, status: 'pending', ...meta }
    pending.push(entry)
    pending.sort((a, b) => a.priority - b.priority)
    EventBus.emit('scheduler.enqueued', { id, task: taskDescription, priority })
    schedule()
    return id
  }

  function schedule() {
    // Try to fill empty slots with ready tasks
    for (let i = 0; i < MAX_SLOTS; i++) {
      if (slots.has(i)) continue
      const ready = findReady()
      if (!ready) break

      // Preemption: if ready task is urgent (0) and all slots are busy with background (2),
      // pause the lowest-priority background task
      if (!ready && pending.some(t => t.priority === 0)) {
        const bgSlot = findLowestPrioritySlot()
        if (bgSlot !== null && slots.get(bgSlot).priority >= 2) {
          pauseSlot(bgSlot)
          // Now slot is free, find ready again
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
      // Check dependencies
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
    const abort = new AbortController()
    entry.status = 'running'
    entry.abort = abort
    slots.set(slotIndex, entry)
    const depInfo = entry.dependsOn?.length ? ` (deps: [${entry.dependsOn}] satisfied)` : ''
    EventBus.emit('scheduler.started', { id: entry.id, slot: slotIndex, task: entry.task, depInfo })
    // The actual worker execution is handled by the callback
    if (Scheduler._onStart) {
      Scheduler._onStart(entry, slotIndex, abort).then(() => {
        finishSlot(slotIndex, 'done')
      }).catch(err => {
        if (err.message === 'aborted' || abort.signal.aborted) {
          finishSlot(slotIndex, 'aborted')
        } else {
          // Retry with exponential backoff
          const retries = entry.retryCount || 0
          if (retries < MAX_RETRIES) {
            entry.retryCount = retries + 1
            entry.status = 'pending'
            const delay = RETRY_BASE_MS * Math.pow(2, retries)
            console.log(`[Scheduler] Task ${entry.id} failed (${err.message}), retry ${entry.retryCount}/${MAX_RETRIES} in ${delay}ms`)
            EventBus.emit('scheduler.retry', { id: entry.id, retry: entry.retryCount, delay, error: err.message })
            slots.delete(slotIndex)
            setTimeout(() => { pending.unshift(entry); schedule() }, delay)
          } else {
            console.log(`[Scheduler] Task ${entry.id} failed after ${MAX_RETRIES} retries: ${err.message}`)
            finishSlot(slotIndex, 'error', err.message)
          }
        }
      })
    }
  }

  function finishSlot(slotIndex, status, error) {
    const entry = slots.get(slotIndex)
    if (!entry) return
    entry.status = status
    if (error) entry.error = error
    completed.push(entry)
    if (completed.length > 20) completed.shift()
    slots.delete(slotIndex)
    EventBus.emit('scheduler.finished', { id: entry.id, slot: slotIndex, status })
    // Try to fill the freed slot
    schedule()
  }

  function pauseSlot(slotIndex) {
    const entry = slots.get(slotIndex)
    if (!entry) return
    entry.abort.abort()
    entry.status = 'paused'
    // Re-queue with same priority
    pending.unshift(entry)
    slots.delete(slotIndex)
    EventBus.emit('scheduler.paused', { id: entry.id, slot: slotIndex })
  }

  // --- Steer / Abort ---

  function steer(taskId, instruction) {
    // Find in running slots
    for (const [idx, s] of slots) {
      if (taskId == null || s.id === taskId) {
        EventBus.emit('scheduler.steer', { id: s.id, instruction })
        return true
      }
    }
    return false
  }

  function abort(taskId) {
    if (taskId == null) {
      // Abort everything
      for (const [idx, s] of slots) {
        s.abort.abort()
        finishSlot(idx, 'aborted')
      }
      pending.length = 0
      EventBus.emit('scheduler.aborted', { all: true })
      return true
    }
    // Abort specific task
    for (const [idx, s] of slots) {
      if (s.id === taskId) {
        s.abort.abort()
        finishSlot(idx, 'aborted')
        return true
      }
    }
    // Remove from pending
    const pi = pending.findIndex(t => t.id === taskId)
    if (pi >= 0) { pending.splice(pi, 1); return true }
    return false
  }

  // --- Status ---

  function getState() {
    const running = []
    for (const [idx, s] of slots) {
      running.push({ id: s.id, slot: idx, task: s.task, priority: s.priority, status: s.status })
    }
    return {
      running,
      pending: pending.map(t => ({ id: t.id, task: t.task, priority: t.priority, dependsOn: t.dependsOn })),
      completed: completed.slice(-5).map(t => ({ id: t.id, task: t.task, status: t.status })),
      freeSlots: MAX_SLOTS - slots.size,
    }
  }

  function isIdle() {
    return slots.size === 0 && pending.length === 0
  }

  // --- Persistence ---
  async function save() {
    if (!_store) return
    await _store.set('scheduler', {
      nextTaskId,
      pending: pending.map(t => ({ id: t.id, task: t.task, steps: t.steps, priority: t.priority, dependsOn: t.dependsOn, status: t.status, retryCount: t.retryCount || 0 })),
      completed: completed.slice(-10).map(t => ({ id: t.id, task: t.task, status: t.status })),
    })
  }

  async function restore(store) {
    _store = store
    if (!_store) return false
    const data = await _store.get('scheduler')
    if (!data) return false
    nextTaskId = data.nextTaskId || 1
    if (data.completed) completed.push(...data.completed)
    // Re-enqueue pending tasks that were interrupted
    if (data.pending) {
      for (const t of data.pending) {
        if (t.status === 'pending' || t.status === 'running') {
          t.status = 'pending'
          pending.push(t)
        }
      }
      if (pending.length > 0) {
        console.log(`[Scheduler] Restored ${pending.length} pending tasks`)
        schedule()
      }
    }
    return true
  }

  // Auto-save on state changes
  EventBus.on('scheduler.enqueued', () => save())
  EventBus.on('scheduler.finished', () => save())
  EventBus.on('scheduler.retry', () => save())

  // _onStart is set by agent.js to provide the actual worker execution
  return { enqueue, steer, abort, getState, isIdle, schedule, save, restore, _onStart: null, MAX_SLOTS }
})()
