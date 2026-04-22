/* agentic-conductor bundle — auto-generated */

// --- intent-state.js ---
/**
 * intent-state.js — Persistent intent registry
 *
 * Talker writes intents here. Dispatcher reads and reacts.
 * Pure data layer — no LLM, no scheduling logic.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.IntentState = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  function createIntentState(opts = {}) {
    const _listeners = []
    let _intents = {}
    let _nextId = 1
    const _store = opts.store || null
    const STORE_KEY = 'conductor/intents'

    // --- Persistence (async, fire-and-forget on writes) ---

    function _save() {
      if (!_store) return
      try { _store.set(STORE_KEY, JSON.stringify({ intents: _intents, nextId: _nextId })) } catch {}
    }

    async function _restore() {
      if (!_store) return
      try {
        const raw = await _store.get(STORE_KEY)
        if (raw) {
          const data = typeof raw === 'string' ? JSON.parse(raw) : raw
          _intents = data.intents || {}
          _nextId = data.nextId || 1
        }
      } catch {}
    }

    function _notify(type, intent) {
      for (const fn of _listeners) {
        try { fn(type, intent) } catch (e) { console.error('[IntentState] listener error:', e) }
      }
    }

    // --- CRUD ---

    function create(goal, options = {}) {
      const id = `intent-${_nextId++}`
      const intent = {
        id,
        goal,
        status: 'active',
        dependsOn: options.dependsOn || [],
        priority: options.priority ?? 1,
        progress: null,
        artifacts: [],
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      _intents[id] = intent
      _save()
      _notify('create', intent)
      return { ...intent }
    }

    function update(id, changes) {
      const intent = _intents[id]
      if (!intent) return null

      if (changes.goal) intent.goal = changes.goal
      if (changes.message) intent.messages.push(changes.message)
      if (changes.progress) intent.progress = changes.progress
      if (changes.priority != null) intent.priority = changes.priority

      // Artifacts: merge, dedupe by path
      if (changes.artifacts && changes.artifacts.length > 0) {
        const existing = new Set(intent.artifacts.map(a => typeof a === 'string' ? a : a.path))
        for (const a of changes.artifacts) {
          const key = typeof a === 'string' ? a : a.path
          if (!existing.has(key)) {
            intent.artifacts.push(a)
            existing.add(key)
          }
        }
      }

      intent.updatedAt = Date.now()
      _save()
      _notify('update', intent)
      return { ...intent }
    }

    function setStatus(id, status) {
      const intent = _intents[id]
      if (!intent) return null
      intent.status = status
      intent.updatedAt = Date.now()
      _save()
      _notify(status, intent)
      return { ...intent }
    }

    function cancel(id) { return setStatus(id, 'cancelled') }
    function running(id) { return setStatus(id, 'running') }
    function done(id) { return setStatus(id, 'done') }
    function fail(id) { return setStatus(id, 'failed') }

    function get(id) {
      const intent = _intents[id]
      return intent ? { ...intent } : null
    }

    function getAll() {
      return Object.values(_intents).map(i => ({ ...i }))
    }

    function getActive() {
      return Object.values(_intents)
        .filter(i => !['done', 'failed', 'cancelled'].includes(i.status))
        .map(i => ({ ...i }))
    }

    function onChange(fn) {
      _listeners.push(fn)
      return () => {
        const idx = _listeners.indexOf(fn)
        if (idx >= 0) _listeners.splice(idx, 1)
      }
    }

    // Format intents for Talker context injection
    function formatForTalker(opts = {}) {
      const includeSettled = opts.includeSettled || false
      const all = Object.values(_intents).map(i => ({ ...i }))
      const items = includeSettled ? all : all.filter(i => !['done', 'failed', 'cancelled'].includes(i.status))
      if (items.length === 0) return ''

      const lines = items.map(i => {
        let line = `- [${i.status}] ${i.goal}`
        if (i.progress) line += ` (${i.progress})`
        if (i.dependsOn.length > 0) {
          const depStatus = i.dependsOn.map(depId => {
            const dep = _intents[depId]
            return dep ? `${dep.goal.slice(0, 30)}:${dep.status}` : `${depId}:unknown`
          })
          line += ` [waiting on: ${depStatus.join(', ')}]`
        }
        return line
      })
      return `Intents:\n${lines.join('\n')}`
    }

    function markReported(...ids) {
      for (const id of ids) {
        if (_intents[id]) _intents[id]._reported = true
      }
    }

    function reset() {
      _intents = {}
      _nextId = 1
      _listeners.length = 0
    }

    // Init — return a promise for async restore
    const _ready = _restore()

    const api = {
      create, update, cancel, running, done, fail,
      get, getAll, getActive, onChange, formatForTalker, reset,
      setStatus, markReported,
      ready: _ready,
    }
    return api
  }

  return { createIntentState }
})


// --- scheduler.js ---
/**
 * scheduler.js — Task scheduler with parallel slots, turn-aware scheduling
 *
 * Manages slot allocation, priority queuing, budget enforcement,
 * preemption, and round-robin fairness.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.Scheduler = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  function createScheduler(opts = {}) {
    const MAX_SLOTS = opts.maxSlots || 3
    const MAX_RETRIES = opts.maxRetries ?? 2
    const RETRY_BASE_MS = opts.retryBaseMs || 1000
    const MAX_TURN_BUDGET = opts.maxTurnBudget || 30
    const MAX_TOKEN_BUDGET = opts.maxTokenBudget || 200000
    const TURN_QUANTUM = opts.turnQuantum || 10

    let nextTaskId = 1
    const pending = []
    const slots = new Map()
    const completed = []
    const _listeners = []

    const _store = opts.store || null
    const STORE_KEY = 'conductor/scheduler'

    function _emit(event, data) {
      for (const fn of _listeners) {
        try { fn(event, data) } catch {}
      }
    }

    // --- Persistence ---

    function _save() {
      if (!_store) return
      try {
        _store.set(STORE_KEY, JSON.stringify({
          nextTaskId,
          pending: pending.map(t => ({
            id: t.id, task: t.task, priority: t.priority,
            dependsOn: t.dependsOn, status: t.status,
            retryCount: t.retryCount || 0, meta: t.meta || {},
            turnCount: t.turnCount || 0, totalTokens: t.totalTokens || 0,
          })),
          slots: Array.from(slots.entries()).map(([idx, s]) => ({
            slotIndex: idx, id: s.id, task: s.task,
            priority: s.priority, status: s.status, meta: s.meta || {},
            turnCount: s.turnCount || 0, totalTokens: s.totalTokens || 0,
          })),
          completed: completed.slice(-20).map(t => ({
            id: t.id, task: t.task, status: t.status,
          })),
        }))
      } catch {}
    }

    async function _restore() {
      if (!_store) return
      try {
        const raw = await _store.get(STORE_KEY)
        if (!raw) return
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw

        nextTaskId = data.nextTaskId || 1
        if (data.completed) completed.push(...data.completed)

        if (data.pending) {
          for (const t of data.pending) {
            if (t.status === 'pending') pending.push(t)
          }
        }

        // Running tasks → back to pending
        if (data.slots) {
          for (const s of data.slots) {
            if (s.status === 'running') {
              pending.push({
                id: s.id, task: s.task, priority: s.priority,
                dependsOn: [], status: 'pending', retryCount: 0,
                meta: s.meta || {}, turnCount: s.turnCount || 0,
                totalTokens: s.totalTokens || 0,
              })
            }
          }
        }

        pending.sort((a, b) => a.priority - b.priority)
        if (pending.length > 0) schedule()
      } catch {}
    }

    // --- Task lifecycle ---

    function enqueue(taskDescription, priority = 1, dependsOn = [], meta = {}) {
      // Dedup
      const norm = taskDescription.trim().toLowerCase()
      const isDup = pending.some(t => t.task.trim().toLowerCase() === norm && t.status === 'pending')
        || Array.from(slots.values()).some(s => s.task.trim().toLowerCase() === norm && s.status === 'running')
      if (isDup) return -1

      const id = nextTaskId++
      const entry = {
        id, task: taskDescription, priority, dependsOn,
        status: 'pending', retryCount: 0, meta,
        turnCount: 0, totalTokens: 0,
      }
      pending.push(entry)
      pending.sort((a, b) => a.priority - b.priority)
      _emit('enqueued', { id, task: taskDescription, priority })
      _save()
      schedule()
      return id
    }

    function schedule() {
      for (let i = 0; i < MAX_SLOTS; i++) {
        if (slots.has(i)) continue
        const ready = findReady()
        if (!ready) break
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

    let _onStart = null

    function startInSlot(slotIndex, entry) {
      const abortController = typeof AbortController !== 'undefined'
        ? new AbortController() : { signal: { aborted: false }, abort() { this.signal.aborted = true } }

      entry.status = 'running'
      entry.abort = abortController
      entry.schedulerSlot = slotIndex
      entry.turnCount = entry.turnCount || 0
      entry.totalTokens = entry.totalTokens || 0
      slots.set(slotIndex, entry)
      _save()

      _emit('started', { id: entry.id, task: entry.task, slot: slotIndex })

      if (_onStart) {
        _onStart(entry.task, abortController, {
          taskId: entry.id,
          workerId: entry.meta?.workerId,
          priority: entry.priority,
          resume: entry.meta?.resume || false,
          turnCount: entry.turnCount,
          totalTokens: entry.totalTokens,
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
      _emit('finished', { id: entry.id, task: entry.task, status, result })
      _save()
      schedule()
    }

    function retryOrFail(slotIndex, entry, error) {
      entry.retryCount = (entry.retryCount || 0) + 1
      if (entry.retryCount <= MAX_RETRIES) {
        slots.delete(slotIndex)
        entry.status = 'pending'
        pending.push(entry)
        _emit('retry', { id: entry.id, attempt: entry.retryCount })
        _save()
        setTimeout(() => schedule(), RETRY_BASE_MS * Math.pow(2, entry.retryCount - 1))
      } else {
        finishSlot(slotIndex, entry, 'error', { error: error?.message || String(error) })
      }
    }

    // --- Turn-aware scheduling ---

    function turnCompleted(workerId, turnInfo = {}) {
      let slotIndex = null, entry = null
      for (const [idx, s] of slots) {
        if (s.meta?.workerId === workerId || s.id === workerId) {
          slotIndex = idx; entry = s; break
        }
      }
      if (!entry) return { action: 'continue' }

      entry.turnCount = (entry.turnCount || 0) + 1
      entry.totalTokens = (entry.totalTokens || 0) + (turnInfo.tokens || 0)
      _save()

      // Token budget — hard stop, don't re-enqueue
      if (entry.totalTokens >= MAX_TOKEN_BUDGET) {
        _emit('budget', { id: entry.id, type: 'tokens', used: entry.totalTokens, limit: MAX_TOKEN_BUDGET })
        return { action: 'suspend', reason: `Token budget exceeded (${entry.totalTokens})`, final: true }
      }

      // Turn budget — hard stop, don't re-enqueue
      if (entry.turnCount >= MAX_TURN_BUDGET) {
        _emit('budget', { id: entry.id, type: 'turns', used: entry.turnCount, limit: MAX_TURN_BUDGET })
        return { action: 'suspend', reason: `Turn budget exceeded (${entry.turnCount})`, final: true }
      }

      // Priority preemption — yield slot, re-enqueue
      const hasHigherPriority = pending.some(t => t.status === 'pending' && t.priority < entry.priority)
      if (hasHigherPriority && entry.turnCount >= TURN_QUANTUM) {
        _suspendAndRequeue(slotIndex, entry, 'Higher priority task waiting')
        return { action: 'suspend', reason: 'Higher priority task waiting' }
      }

      // Fair round-robin — yield slot, re-enqueue
      const waitingCount = pending.filter(t => t.status === 'pending').length
      if (waitingCount > 0 && entry.turnCount > 0 && entry.turnCount % TURN_QUANTUM === 0) {
        _suspendAndRequeue(slotIndex, entry, `Quantum expired (${TURN_QUANTUM} turns)`)
        return { action: 'suspend', reason: `Quantum expired (${TURN_QUANTUM} turns)` }
      }

      return { action: 'continue' }
    }

    function _suspendAndRequeue(slotIndex, entry, reason) {
      // Free the slot
      slots.delete(slotIndex)
      // Mark as suspended and preserve state for resume
      entry.status = 'suspended'
      entry.meta = entry.meta || {}
      entry.meta.resume = true
      entry.meta.suspendedAt = Date.now()
      entry.meta.suspendReason = reason
      // Re-enqueue at front (same priority, preserves turnCount/totalTokens)
      pending.unshift(entry)
      _emit('suspended', { id: entry.id, workerId: entry.meta?.workerId, reason })
      _save()
      // Trigger scheduling to fill the freed slot
      schedule()
    }

    function resumeWorker(workerId) {
      const idx = pending.findIndex(t => t.status === 'suspended' && (t.meta?.workerId === workerId || t.id === workerId))
      if (idx < 0) return false
      pending[idx].status = 'pending'
      _save()
      schedule()
      return true
    }

    function getSuspended() {
      return pending.filter(t => t.status === 'suspended').map(t => ({
        id: t.id, task: t.task, workerId: t.meta?.workerId,
        turnCount: t.turnCount, totalTokens: t.totalTokens,
        suspendedAt: t.meta?.suspendedAt, reason: t.meta?.suspendReason,
      }))
    }

    function getSlotStats(workerId) {
      for (const [idx, s] of slots) {
        if (s.meta?.workerId === workerId || s.id === workerId) {
          return { slotIndex: idx, turnCount: s.turnCount || 0, totalTokens: s.totalTokens || 0, priority: s.priority }
        }
      }
      return null
    }

    // --- Steer / Abort ---

    function steer(taskId, instruction) {
      for (const [, entry] of slots) {
        if (entry.id === taskId) {
          entry.steerInstruction = instruction
          return true
        }
      }
      return false
    }

    function abort(workerId) {
      for (const [idx, entry] of slots) {
        if (entry.meta?.workerId === workerId || entry.id === workerId) {
          if (entry.abort) entry.abort.abort()
          finishSlot(idx, entry, 'aborted')
          return true
        }
      }
      const pi = pending.findIndex(t => t.meta?.workerId === workerId || t.id === workerId)
      if (pi >= 0) { pending.splice(pi, 1); _save(); return true }
      return false
    }

    // --- State ---

    function getState() {
      return {
        pending: pending.map(t => ({ id: t.id, task: t.task, priority: t.priority, status: t.status, turnCount: t.turnCount, totalTokens: t.totalTokens })),
        slots: Array.from(slots.entries()).map(([idx, s]) => ({ slot: idx, id: s.id, task: s.task, priority: s.priority, turnCount: s.turnCount, totalTokens: s.totalTokens })),
        completed: completed.slice(-10),
      }
    }

    function isIdle() { return slots.size === 0 && pending.length === 0 }

    function on(fn) { _listeners.push(fn); return () => { const i = _listeners.indexOf(fn); if (i >= 0) _listeners.splice(i, 1) } }

    function setOnStart(fn) { _onStart = fn }

    function reset() {
      for (const [, entry] of slots) { if (entry.abort) entry.abort.abort() }
      slots.clear()
      pending.length = 0
      completed.length = 0
      nextTaskId = 1
      _listeners.length = 0
      _onStart = null
    }

    // Init
    const _ready = _restore()

    return {
      enqueue, schedule, steer, abort,
      turnCompleted, resumeWorker, getSuspended, getSlotStats,
      getState, isIdle, on, setOnStart, reset,
      ready: _ready,
      MAX_SLOTS, MAX_TURN_BUDGET, MAX_TOKEN_BUDGET, TURN_QUANTUM,
    }
  }

  return { createScheduler }
})


// --- dispatcher.js ---
/**
 * dispatcher.js — Intent-driven Dispatcher
 *
 * Watches IntentState for changes, maps intents to scheduling decisions.
 * Supports code mode (deterministic) and LLM mode (semantic reasoning).
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.Dispatcher = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  function createDispatcher(opts = {}) {
    const _intentState = opts.intentState
    const _scheduler = opts.scheduler
    let _ai = opts.ai || null
    let _dispatchMode = opts.mode || 'llm'

    const _workers = new Map()
    const _intentWorker = new Map()
    const _workerIntent = new Map()
    const _decisionLog = []
    const MAX_LOG = 50
    const MAX_TURNS = opts.maxTurns || 30
    const STALL_THRESHOLD = opts.stallThreshold || 3

    let _nextWorkerId = 1
    const _store = opts.store || null
    const STORE_KEY = 'conductor/dispatcher'

    const _listeners = []

    function _emit(event, data) {
      for (const fn of _listeners) {
        try { fn(event, data) } catch {}
      }
    }

    function _logDecision(workerId, action, detail) {
      const entry = { ts: Date.now(), workerId, action, detail }
      _decisionLog.push(entry)
      if (_decisionLog.length > MAX_LOG) _decisionLog.shift()
    }

    // --- Persistence ---

    function _save() {
      if (!_store) return
      try {
        const workers = {}
        for (const [id, w] of _workers) {
          workers[id] = { ...w }
          delete workers[id].abort
        }
        _store.set(STORE_KEY, JSON.stringify({ workers, nextWorkerId: _nextWorkerId }))
      } catch {}
    }

    async function _restore() {
      if (!_store) return
      try {
        const raw = await _store.get(STORE_KEY)
        if (!raw) return
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw
        _nextWorkerId = data.nextWorkerId || 1
        if (data.workers) {
          for (const [id, w] of Object.entries(data.workers)) {
            if (w.status === 'running') w.status = 'suspended'
            _workers.set(Number(id) || id, w)
          }
        }
      } catch {}
    }

    // --- Intent change handler ---

    function _handleIntentChange(type, intent) {
      if (_dispatchMode === 'llm') {
        _handleIntentLLM(type, intent).catch(() => {
          _handleIntentCode(type, intent)
        })
      } else {
        _handleIntentCode(type, intent)
      }
    }

    function _handleIntentCode(type, intent) {
      if (type === 'create') {
        // Check dependencies
        const depsOk = (intent.dependsOn || []).every(depId => {
          const dep = _intentState.get(depId)
          return dep && dep.status === 'done'
        })

        if (depsOk) {
          _spawnWorker(intent)
        }
        // If deps not met, will be picked up when deps complete
      }

      if (type === 'done') {
        // Check if any waiting intents can now proceed
        const waiting = _intentState.getActive().filter(i =>
          i.status === 'active' && i.dependsOn.includes(intent.id)
        )
        for (const w of waiting) {
          const allDepsOk = w.dependsOn.every(depId => {
            const dep = _intentState.get(depId)
            return dep && dep.status === 'done'
          })
          if (allDepsOk) _spawnWorker(w)
        }
      }

      if (type === 'failed') {
        // Cascade: fail any intent depending on this one
        const dependents = _intentState.getActive().filter(i =>
          i.dependsOn.includes(intent.id)
        )
        for (const d of dependents) {
          _intentState.fail(d.id)
        }
      }

      if (type === 'cancelled') {
        const workerId = _intentWorker.get(intent.id)
        if (workerId != null) {
          _scheduler.abort(workerId)
          _workers.delete(workerId)
          _intentWorker.delete(intent.id)
          _workerIntent.delete(workerId)
          _save()
        }
      }

      if (type === 'update') {
        const workerId = _intentWorker.get(intent.id)
        if (workerId != null) {
          const w = _workers.get(workerId)
          if (w && intent.messages.length > 0) {
            w.steerInstruction = intent.messages[intent.messages.length - 1]
            _save()
          }
        }
      }
    }

    async function _handleIntentLLM(type, intent) {
      if (!_ai) {
        _handleIntentCode(type, intent)
        return
      }

      if (type === 'create' || type === 'done' || type === 'update') {
        const state = _intentState.formatForTalker()
        const prompt = `You are a task dispatcher. Given the current intent state, decide what operations to perform.

Current state:
${state}

Event: ${type} on "${intent.goal}" (${intent.id})

Respond with a JSON array of operations:
- {"op":"spawn","intentId":"...","task":"...","priority":N}
- {"op":"cancel","workerId":"..."}
- {"op":"steer","workerId":"...","instruction":"..."}
- {"op":"merge","intentIds":["..."],"mergedGoal":"..."}
- [] for no action

Only JSON, no explanation.`

        try {
          const result = await _ai.chat([{ role: 'user', content: prompt }])
          const text = result.answer || result.content || result.text || ''
          const match = text.match(/\[[\s\S]*\]/)
          if (match) {
            const ops = JSON.parse(match[0])
            for (const op of ops) {
              if (op.op === 'spawn') {
                const target = _intentState.get(op.intentId)
                if (target) _spawnWorker(target, op.priority)
              } else if (op.op === 'cancel' && op.workerId) {
                _scheduler.abort(op.workerId)
              } else if (op.op === 'steer' && op.workerId) {
                const w = _workers.get(Number(op.workerId))
                if (w) w.steerInstruction = op.instruction
              } else if (op.op === 'merge' && op.intentIds) {
                // Merge: cancel all but first, update first's goal
                const [keep, ...rest] = op.intentIds
                for (const rid of rest) _intentState.cancel(rid)
                if (op.mergedGoal) _intentState.update(keep, { goal: op.mergedGoal })
              }
            }
          }
        } catch (e) {
          // Fallback to code mode
          _handleIntentCode(type, intent)
        }
      } else {
        _handleIntentCode(type, intent)
      }
    }

    function _spawnWorker(intent, priority) {
      const workerId = _nextWorkerId++
      _intentState.running(intent.id)

      // Inject dependency artifacts into task context
      let task = intent.goal
      if (intent.dependsOn && intent.dependsOn.length > 0) {
        const depContext = intent.dependsOn.map(depId => {
          const dep = _intentState.get(depId)
          if (!dep) return null
          const parts = [`Completed: "${dep.goal}"`]
          if (dep.progress) parts.push(`Result: ${dep.progress}`)
          if (dep.artifacts.length > 0) parts.push(`Files: ${dep.artifacts.join(', ')}`)
          return parts.join(' | ')
        }).filter(Boolean)

        if (depContext.length > 0) {
          task += `\n\nContext from dependencies:\n${depContext.join('\n')}`
        }
      }

      const worker = {
        id: workerId,
        intentId: intent.id,
        task,
        status: 'running',
        steps: [],           // plan_steps: [{text, status}]
        turnCount: 0,
        totalTokens: 0,
        toolCallCount: 0,
        stallCount: 0,
        createdAt: Date.now(),
      }

      _workers.set(workerId, worker)
      _intentWorker.set(intent.id, workerId)
      _workerIntent.set(workerId, intent.id)
      _save()

      _logDecision(workerId, 'spawn', `Intent ${intent.id}: ${intent.goal.slice(0, 60)}`)
      _emit('spawn', { workerId, intentId: intent.id, task, priority: priority ?? intent.priority })

      // Enqueue in scheduler
      _scheduler.enqueue(task, priority ?? intent.priority, [], { workerId })
    }

    // --- Turn management ---

    function beforeTurn(workerId) {
      const w = _workers.get(workerId)
      if (!w) return { action: 'continue' }

      w.turnCount = (w.turnCount || 0) + 1

      if (w.turnCount > MAX_TURNS) {
        _logDecision(workerId, 'abort', `Max turns (${MAX_TURNS}) exceeded`)
        return { action: 'abort', reason: `Maximum turns (${MAX_TURNS}) reached` }
      }

      if (w.steerInstruction) {
        const instruction = w.steerInstruction
        w.steerInstruction = null
        _save()
        return { action: 'steer', instruction }
      }

      return { action: 'continue' }
    }

    function afterTurn(workerId, turnResult = {}) {
      const w = _workers.get(workerId)
      if (!w) return { action: 'continue' }

      // Track tokens
      const turnTokens = turnResult.usage
        ? (turnResult.usage.input_tokens || 0) + (turnResult.usage.output_tokens || 0)
        : (turnResult.tokens || 0)

      if (turnTokens) w.totalTokens = (w.totalTokens || 0) + turnTokens
      if (turnResult.toolCalls) w.toolCallCount = (w.toolCallCount || 0) + turnResult.toolCalls.length

      // Auto-advance plan steps: skip meta tools, advance one step per turn with real calls
      if (w.steps.length > 0 && turnResult.toolCalls?.length > 0) {
        const META = new Set(['plan_steps', 'done', 'update_progress'])
        const realCalls = turnResult.toolCalls.filter(tc => !META.has(tc.name))
        if (realCalls.length > 0) {
          const nextPending = w.steps.findIndex(s => s.status !== 'done')
          if (nextPending >= 0) {
            w.steps[nextPending].status = 'done'
          }
        }
      }

      // Stall detection
      if (turnResult.noProgress) {
        w.stallCount = (w.stallCount || 0) + 1
        if (w.stallCount >= STALL_THRESHOLD) {
          _logDecision(workerId, 'stall', `Stalled ${w.stallCount} turns`)
        }
      } else {
        w.stallCount = 0
      }

      _save()

      // Push progress + artifacts back to intent
      const intentId = _workerIntent.get(workerId)
      if (intentId) {
        const changes = {}
        // Auto-generate progress from steps
        if (w.steps.length > 0) {
          const done = w.steps.filter(s => s.status === 'done').length
          changes.progress = `${done}/${w.steps.length} steps`
        }
        if (turnResult.progress) changes.progress = turnResult.progress
        if (turnResult.artifacts?.length > 0) changes.artifacts = turnResult.artifacts
        if (changes.progress || changes.artifacts) _intentState.update(intentId, changes)
      }

      // Consult Scheduler
      const decision = _scheduler.turnCompleted(workerId, { tokens: turnTokens })
      if (decision.action === 'suspend') {
        w.status = 'suspended'
        _logDecision(workerId, 'suspend', decision.reason)
        _save()
        return { action: 'suspend', reason: decision.reason, final: !!decision.final }
      }

      return { action: 'continue' }
    }

    // --- Worker completion ---

    function workerCompleted(workerId, result = {}) {
      const intentId = _workerIntent.get(workerId)
      if (intentId) {
        if (result.summary) _intentState.update(intentId, { progress: result.summary })
        _intentState.done(intentId)
      }
      _workers.delete(workerId)
      _intentWorker.delete(intentId)
      _workerIntent.delete(workerId)
      _logDecision(workerId, 'done', result.summary || 'completed')
      _emit('done', { workerId, intentId, result })
      _save()
      // Free the scheduler slot so suspended workers can take it
      _scheduler.abort(workerId)
      // Auto-resume suspended workers now that a slot may be free
      _autoResumeSuspended()
    }

    function workerFailed(workerId, error) {
      const intentId = _workerIntent.get(workerId)
      if (intentId) _intentState.fail(intentId)
      _workers.delete(workerId)
      _intentWorker.delete(intentId)
      _workerIntent.delete(workerId)
      _logDecision(workerId, 'fail', error || 'unknown error')
      _emit('fail', { workerId, intentId, error })
      _save()
      // Free the scheduler slot so suspended workers can take it
      _scheduler.abort(workerId)
      // Auto-resume suspended workers now that a slot may be free
      _autoResumeSuspended()
    }

    function _autoResumeSuspended() {
      const suspended = _scheduler.getSuspended()
      for (const s of suspended) {
        _scheduler.resumeWorker(s.workerId || s.id)
      }
    }

    function resumeWorker(workerId) {
      const w = _workers.get(workerId)
      if (!w || w.status !== 'suspended') return false
      w.status = 'running'
      _save()
      _logDecision(workerId, 'resume', `Resumed worker ${workerId}`)
      _emit('resume', { workerId })
      return _scheduler.resumeWorker(workerId)
    }

    function getSuspended() {
      return _scheduler.getSuspended()
    }

    // --- State ---

    function getWorker(id) { return _workers.has(id) ? { ..._workers.get(id) } : null }
    function getWorkers() { return Array.from(_workers.values()).map(w => ({ ...w })) }
    function getDecisionLog() { return [..._decisionLog] }

    // --- Worker plan ---

    function planSteps(workerId, planned) {
      const w = _workers.get(workerId)
      if (!w) return null
      w.steps = planned.map(text => ({ text, status: 'pending' }))
      _save()
      _emit('plan', { workerId, steps: w.steps })
      return w.steps.map(s => ({ ...s }))
    }

    function getSteps(workerId) {
      const w = _workers.get(workerId)
      return w ? w.steps.map(s => ({ ...s })) : []
    }

    function advanceStep(workerId, stepIndex) {
      const w = _workers.get(workerId)
      if (!w || !w.steps[stepIndex]) return false
      w.steps[stepIndex].status = 'done'
      _save()
      return true
    }

    function setMode(mode) {
      _dispatchMode = mode
    }

    function on(fn) {
      _listeners.push(fn)
      return () => { const i = _listeners.indexOf(fn); if (i >= 0) _listeners.splice(i, 1) }
    }

    function reset() {
      _workers.clear()
      _intentWorker.clear()
      _workerIntent.clear()
      _decisionLog.length = 0
      _nextWorkerId = 1
      _listeners.length = 0
    }

    // Init
    const _ready = _restore()
    _intentState.onChange(_handleIntentChange)

    return {
      beforeTurn, afterTurn,
      workerCompleted, workerFailed,
      resumeWorker, getSuspended,
      planSteps, getSteps, advanceStep,
      getWorker, getWorkers, getDecisionLog,
      setMode, on, reset,
      ready: _ready,
    }
  }

  return { createDispatcher }
})


// --- conductor.js ---
/**
 * agentic-conductor — Multi-intent dispatch engine
 *
 * Facade that wires IntentState + Dispatcher + Scheduler into a single API.
 *
 * Usage:
 *   const { createConductor } = require('agentic-conductor')
 *   const conductor = createConductor({ ai, tools, system })
 *   const result = await conductor.chat("Search AI news and write a report")
 *
 * Strategy:
 *   'single'   — direct LLM loop, no intent splitting (equivalent to Claw)
 *   'dispatch'  — Talker splits intents, Dispatcher + Scheduler manage workers
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const { createIntentState } = require('./intent-state')
    const { createScheduler } = require('./scheduler')
    const { createDispatcher } = require('./dispatcher')
    module.exports = factory(createIntentState, createScheduler, createDispatcher)
  } else {
    // Browser: expect globals
    const cis = root.IntentState?.createIntentState || root.createIntentState
    const cs = root.Scheduler?.createScheduler || root.createScheduler
    const cd = root.Dispatcher?.createDispatcher || root.createDispatcher
    root.AgenticConductor = factory(cis, cs, cd)
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (createIntentState, createScheduler, createDispatcher) {
  'use strict'

  // Built-in memory store (default when no store provided)
  function memoryStore() {
    const map = new Map()
    return {
      get: (k) => Promise.resolve(map.get(k) ?? null),
      set: (k, v) => { map.set(k, v); return Promise.resolve() },
      delete: (k) => { map.delete(k); return Promise.resolve() },
      keys: () => Promise.resolve([...map.keys()]),
      has: (k) => Promise.resolve(map.has(k)),
      clear: () => { map.clear(); return Promise.resolve() },
    }
  }

  const TALKER_SYSTEM = `You are a task-aware AI assistant. When the user asks you to do things, you can:
1. Reply directly for simple questions
2. Create intents for tasks that need background work

When creating intents, output a JSON block:
\`\`\`intents
[{"action":"create","goal":"...","dependsOn":[],"priority":1},
 {"action":"update","id":"...","message":"..."},
 {"action":"cancel","id":"..."}]
\`\`\`

Rules:
- Simple questions → just answer, no intents
- Tasks needing tools/time → create intents
- Sequential tasks → use dependsOn with the ID of the prerequisite
- Always include a natural language reply before/after the intents block`

  function createConductor(opts = {}) {
    const {
      ai,                          // LLM instance: { chat(messages, opts) → { answer, usage } }
      tools = [],                  // Tool definitions for workers
      systemPrompt = '',           // Product-specific system prompt for Talker
      formatContext = null,         // () → string, dynamic context injection
      strategy = 'dispatch',       // 'single' | 'dispatch'
      store = null,                  // agentic-store instance or { get, set, delete, keys }
      maxSlots = 3,
      maxTurnBudget = 30,
      maxTokenBudget = 200000,
      turnQuantum = 10,
      dispatchMode = 'llm',        // 'code' | 'llm'
      planMode = true,               // inject plan_steps + done meta tools into workers
      onWorkerStart = null,        // (task, abort, opts) → Promise<result>
    } = opts

    if (!ai) throw new Error('ai instance is required')

    // --- Single strategy: direct LLM loop ---

    if (strategy === 'single') {
      const messages = []

      return {
        async chat(input, chatOpts = {}) {
          messages.push({ role: 'user', content: input })

          const sys = systemPrompt + (formatContext ? '\n\n' + formatContext() : '')
          const result = await ai.chat(messages, {
            system: sys || undefined,
            tools: chatOpts.tools || tools,
            ...chatOpts,
          })

          const answer = result.answer || result.content || result.text || ''
          messages.push({ role: 'assistant', content: answer })

          return { reply: answer, intents: [], usage: result.usage }
        },
        getState() { return { strategy: 'single', messages: messages.length } },
        getIntents() { return [] },
        cancel() {},
        on() { return () => {} },
        destroy() { messages.length = 0 },
      }
    }

    // --- Dispatch strategy: full intent system ---

    const _store = store || memoryStore()

    const intentState = createIntentState({ store: _store })
    const scheduler = createScheduler({
      store: _store, maxSlots, maxTurnBudget, maxTokenBudget, turnQuantum,
    })
    const dispatcher = createDispatcher({
      intentState, scheduler, ai,
      mode: dispatchMode, store: _store,
    })

    const _listeners = []
    const _talkerMessages = []

    function _emit(event, data) {
      for (const fn of _listeners) {
        try { fn(event, data) } catch {}
      }
    }

    // Wire up worker execution
    scheduler.setOnStart(async (task, abort, taskOpts) => {
      // Wait for all modules to restore before starting workers
      await Promise.all([intentState.ready, scheduler.ready, dispatcher.ready])

      const wid = taskOpts.workerId

      // Built-in meta tools for worker plan management
      const metaTools = planMode ? [
        {
          name: 'plan_steps',
          description: 'Set your execution plan. Call this first before doing any work.',
          parameters: {
            type: 'object',
            properties: { planned: { type: 'array', items: { type: 'string' }, description: 'List of step descriptions' } },
            required: ['planned'],
          },
          execute: ({ planned }) => {
            if (!Array.isArray(planned) || !planned.length) return { error: 'planned must be non-empty array of strings' }
            const steps = dispatcher.planSteps(wid, planned)
            return { success: true, steps: steps.map(s => s.text) }
          },
        },
        {
          name: 'done',
          description: 'Signal task completion with a summary.',
          parameters: {
            type: 'object',
            properties: { summary: { type: 'string', description: 'Brief summary of what was accomplished' } },
            required: ['summary'],
          },
          execute: ({ summary }) => {
            dispatcher.workerCompleted(wid, { summary })
            return { done: true, summary }
          },
        },
      ] : []

      if (onWorkerStart) {
        return onWorkerStart(task, abort, {
          ...taskOpts,
          tools: [...metaTools, ...tools],
          ...(metaTools.length > 0 ? { metaTools } : {}),
          ...(planMode ? { steps: () => dispatcher.getSteps(wid) } : {}),
          beforeTurn: () => dispatcher.beforeTurn(wid),
          afterTurn: (result) => dispatcher.afterTurn(wid, result),
        })
      }
      // Default: no-op, caller must provide onWorkerStart
      throw new Error('onWorkerStart not provided — cannot execute worker')
    })

    // Forward events
    dispatcher.on((event, data) => _emit(`dispatcher.${event}`, data))
    scheduler.on((event, data) => _emit(`scheduler.${event}`, data))

    // --- Talker ---

    async function chat(input, chatOpts = {}) {
      _talkerMessages.push({ role: 'user', content: input })

      // Build system prompt
      let sys = TALKER_SYSTEM
      if (systemPrompt) sys = systemPrompt + '\n\n' + TALKER_SYSTEM
      if (formatContext) sys += '\n\n' + formatContext()

      // Inject active intents context
      const intentContext = intentState.formatForTalker()
      if (intentContext) sys += '\n\n' + intentContext

      const result = await ai.chat(_talkerMessages, {
        system: sys,
        ...chatOpts,
      })

      const answer = result.answer || result.content || result.text || ''
      _talkerMessages.push({ role: 'assistant', content: answer })

      // Parse intent operations from response
      const intents = _parseIntents(answer)
      const createdIntents = []

      for (const op of intents) {
        if (op.action === 'create') {
          const intent = intentState.create(op.goal, {
            dependsOn: op.dependsOn || [],
            priority: op.priority ?? 1,
          })
          createdIntents.push(intent)
        } else if (op.action === 'update' && op.id) {
          intentState.update(op.id, { message: op.message, goal: op.goal })
        } else if (op.action === 'cancel' && op.id) {
          intentState.cancel(op.id)
        }
      }

      // Clean reply: remove intents block
      const cleanReply = answer.replace(/```intents[\s\S]*?```/g, '').trim()

      _emit('chat', { input, reply: cleanReply, intents: createdIntents })

      return {
        reply: cleanReply,
        intents: createdIntents,
        usage: result.usage,
      }
    }

    function _parseIntents(text) {
      const match = text.match(/```intents\s*([\s\S]*?)```/)
      if (!match) return []
      try {
        return JSON.parse(match[1])
      } catch {
        return []
      }
    }

    // --- Public API ---

    function createIntent(goal, options = {}) {
      return intentState.create(goal, options)
    }

    function cancelIntent(id) {
      return intentState.cancel(id)
    }

    function updateIntent(id, changes) {
      return intentState.update(id, changes)
    }

    function completeWorker(workerId, result) {
      dispatcher.workerCompleted(workerId, result)
    }

    function failWorker(workerId, error) {
      dispatcher.workerFailed(workerId, error)
    }

    function afterTurn(workerId, turnResult) {
      return dispatcher.afterTurn(workerId, turnResult)
    }

    function beforeTurn(workerId) {
      return dispatcher.beforeTurn(workerId)
    }

    function getState() {
      return {
        strategy: 'dispatch',
        intents: intentState.getAll(),
        workers: dispatcher.getWorkers(),
        suspended: dispatcher.getSuspended(),
        scheduler: scheduler.getState(),
        decisionLog: dispatcher.getDecisionLog(),
      }
    }

    function getIntents() {
      return intentState.getAll()
    }

    function on(fn) {
      _listeners.push(fn)
      return () => { const i = _listeners.indexOf(fn); if (i >= 0) _listeners.splice(i, 1) }
    }

    function destroy() {
      intentState.reset()
      dispatcher.reset()
      scheduler.reset()
      _talkerMessages.length = 0
      _listeners.length = 0
    }

    return {
      // High-level
      chat,
      createIntent,
      cancelIntent,
      updateIntent,

      // Worker lifecycle
      completeWorker,
      failWorker,
      resumeWorker: (workerId) => dispatcher.resumeWorker(workerId),
      getSuspended: () => dispatcher.getSuspended(),
      beforeTurn,
      afterTurn,

      // Worker plan
      planSteps: (workerId, planned) => dispatcher.planSteps(workerId, planned),
      getSteps: (workerId) => dispatcher.getSteps(workerId),
      advanceStep: (workerId, stepIndex) => dispatcher.advanceStep(workerId, stepIndex),

      // State
      getState,
      getIntents,

      // Events & lifecycle
      on,
      destroy,

      // Internals (for advanced use)
      _intentState: intentState,
      _scheduler: scheduler,
      _dispatcher: dispatcher,
    }
  }

  return { createConductor, memoryStore }
})

