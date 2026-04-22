/* agentic.bundle.js — auto-generated 2026-04-22 */

// ═══ agentic-conductor.js ═══
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



// ═══ agentic-core.js ═══
;(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else if (typeof define === 'function' && define.amd) define(factory)
  else { var e = factory(); root.AgenticCore = e; for (var k in e) root[k] = e[k] }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function() {
  'use strict'

// loop-detection.js — 完全对齐 OpenClaw tool-loop-detection.ts
// 浏览器端实现（无 node:crypto，用简单哈希替代）

const WARNING_THRESHOLD = 10
const CRITICAL_THRESHOLD = 20
const GLOBAL_CIRCUIT_BREAKER_THRESHOLD = 30
const TOOL_CALL_HISTORY_SIZE = 30
const EAGER_HINT = 'When you need to use tools, call them BEFORE writing your text response. This allows parallel execution while you compose your answer.'

// ── Hash helpers (browser-safe) ──

function simpleHash(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(16)
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}

function hashToolCall(toolName, params) {
  return `${toolName}:${simpleHash(stableStringify(params))}`
}

function hashToolOutcome(toolName, params, result, error) {
  if (error !== undefined) {
    return `error:${simpleHash(String(error))}`
  }
  if (result === undefined) return undefined

  // Extract text content (OpenClaw format)
  let text = ''
  if (result && typeof result === 'object' && Array.isArray(result.content)) {
    text = result.content
      .filter(e => e && typeof e.type === 'string' && typeof e.text === 'string')
      .map(e => e.text)
      .join('\n')
      .trim()
  }

  const details = (result && typeof result === 'object' && result.details) || {}

  // Known poll tools get special hashing
  if (isKnownPollToolCall(toolName, params)) {
    if (typeof params === 'object' && params !== null) {
      const action = params.action
      if (action === 'poll') {
        return simpleHash(stableStringify({
          action, status: details.status,
          exitCode: details.exitCode ?? null, exitSignal: details.exitSignal ?? null,
          aggregated: details.aggregated ?? null, text,
        }))
      }
      if (action === 'log') {
        return simpleHash(stableStringify({
          action, status: details.status,
          totalLines: details.totalLines ?? null, totalChars: details.totalChars ?? null,
          truncated: details.truncated ?? null,
          exitCode: details.exitCode ?? null, exitSignal: details.exitSignal ?? null, text,
        }))
      }
    }
  }

  return simpleHash(stableStringify({ details, text }))
}

function isKnownPollToolCall(toolName, params) {
  if (toolName === 'command_status') return true
  if (toolName !== 'process' || typeof params !== 'object' || params === null) return false
  return params.action === 'poll' || params.action === 'log'
}

// ── No-progress streak ──

function getNoProgressStreak(history, toolName, argsHash) {
  let streak = 0
  let latestResultHash = undefined

  for (let i = history.length - 1; i >= 0; i--) {
    const record = history[i]
    if (!record || record.toolName !== toolName || record.argsHash !== argsHash) continue
    if (typeof record.resultHash !== 'string' || !record.resultHash) continue

    if (!latestResultHash) {
      latestResultHash = record.resultHash
      streak = 1
      continue
    }
    if (record.resultHash !== latestResultHash) break
    streak++
  }

  return { count: streak, latestResultHash }
}

// ── Ping-pong detection ──

function getPingPongStreak(history, currentHash) {
  const last = history[history.length - 1]
  if (!last) return { count: 0, noProgressEvidence: false }

  let otherSignature, otherToolName
  for (let i = history.length - 2; i >= 0; i--) {
    const call = history[i]
    if (!call) continue
    if (call.argsHash !== last.argsHash) {
      otherSignature = call.argsHash
      otherToolName = call.toolName
      break
    }
  }

  if (!otherSignature || !otherToolName) return { count: 0, noProgressEvidence: false }

  let alternatingTailCount = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const call = history[i]
    if (!call) continue
    const expected = alternatingTailCount % 2 === 0 ? last.argsHash : otherSignature
    if (call.argsHash !== expected) break
    alternatingTailCount++
  }

  if (alternatingTailCount < 2) return { count: 0, noProgressEvidence: false }
  if (currentHash !== otherSignature) return { count: 0, noProgressEvidence: false }

  const tailStart = Math.max(0, history.length - alternatingTailCount)
  let firstHashA, firstHashB
  let noProgressEvidence = true

  for (let i = tailStart; i < history.length; i++) {
    const call = history[i]
    if (!call || !call.resultHash) { noProgressEvidence = false; break }

    if (call.argsHash === last.argsHash) {
      if (!firstHashA) firstHashA = call.resultHash
      else if (firstHashA !== call.resultHash) { noProgressEvidence = false; break }
    } else if (call.argsHash === otherSignature) {
      if (!firstHashB) firstHashB = call.resultHash
      else if (firstHashB !== call.resultHash) { noProgressEvidence = false; break }
    } else {
      noProgressEvidence = false; break
    }
  }

  if (!firstHashA || !firstHashB) noProgressEvidence = false

  return {
    count: alternatingTailCount + 1,
    pairedToolName: last.toolName,
    pairedSignature: last.argsHash,
    noProgressEvidence,
  }
}

// ── Main detection (exact OpenClaw logic) ──

function detectToolCallLoop(state, toolName, params) {
  const history = state.toolCallHistory || []
  const currentHash = hashToolCall(toolName, params)
  const noProgress = getNoProgressStreak(history, toolName, currentHash)
  const noProgressStreak = noProgress.count
  const knownPollTool = isKnownPollToolCall(toolName, params)
  const pingPong = getPingPongStreak(history, currentHash)

  // 1. Global circuit breaker
  if (noProgressStreak >= GLOBAL_CIRCUIT_BREAKER_THRESHOLD) {
    return {
      stuck: true, level: 'critical', detector: 'global_circuit_breaker',
      count: noProgressStreak,
      message: `CRITICAL: ${toolName} has repeated identical no-progress outcomes ${noProgressStreak} times. Session execution blocked by global circuit breaker to prevent runaway loops.`,
    }
  }

  // 2. Known poll no-progress (critical)
  if (knownPollTool && noProgressStreak >= CRITICAL_THRESHOLD) {
    return {
      stuck: true, level: 'critical', detector: 'known_poll_no_progress',
      count: noProgressStreak,
      message: `CRITICAL: Called ${toolName} with identical arguments and no progress ${noProgressStreak} times. This appears to be a stuck polling loop. Session execution blocked to prevent resource waste.`,
    }
  }

  // 3. Known poll no-progress (warning)
  if (knownPollTool && noProgressStreak >= WARNING_THRESHOLD) {
    return {
      stuck: true, level: 'warning', detector: 'known_poll_no_progress',
      count: noProgressStreak,
      message: `WARNING: You have called ${toolName} ${noProgressStreak} times with identical arguments and no progress. Stop polling and either (1) increase wait time between checks, or (2) report the task as failed if the process is stuck.`,
    }
  }

  // 4. Ping-pong (critical)
  if (pingPong.count >= CRITICAL_THRESHOLD && pingPong.noProgressEvidence) {
    return {
      stuck: true, level: 'critical', detector: 'ping_pong',
      count: pingPong.count,
      message: `CRITICAL: You are alternating between repeated tool-call patterns (${pingPong.count} consecutive calls) with no progress. This appears to be a stuck ping-pong loop. Session execution blocked to prevent resource waste.`,
      pairedToolName: pingPong.pairedToolName,
    }
  }

  // 5. Ping-pong (warning)
  if (pingPong.count >= WARNING_THRESHOLD) {
    return {
      stuck: true, level: 'warning', detector: 'ping_pong',
      count: pingPong.count,
      message: `WARNING: You are alternating between repeated tool-call patterns (${pingPong.count} consecutive calls). This looks like a ping-pong loop; stop retrying and report the task as failed.`,
      pairedToolName: pingPong.pairedToolName,
    }
  }

  // 6. Generic repeat (warning only, identical args)
  const recentCount = history.filter(
    h => h.toolName === toolName && h.argsHash === currentHash
  ).length

  if (!knownPollTool && recentCount >= WARNING_THRESHOLD) {
    return {
      stuck: true, level: 'warning', detector: 'generic_repeat',
      count: recentCount,
      message: `WARNING: You have called ${toolName} ${recentCount} times with identical arguments. If this is not making progress, stop retrying and report the task as failed.`,
    }
  }

  return { stuck: false }
}

// ── Record helpers ──

function recordToolCall(state, toolName, params) {
  if (!state.toolCallHistory) state.toolCallHistory = []

  state.toolCallHistory.push({
    toolName,
    argsHash: hashToolCall(toolName, params),
    timestamp: Date.now(),
  })

  if (state.toolCallHistory.length > TOOL_CALL_HISTORY_SIZE) {
    state.toolCallHistory.shift()
  }
}

function recordToolCallOutcome(state, toolName, params, result, error) {
  if (!state.toolCallHistory) state.toolCallHistory = []

  const argsHash = hashToolCall(toolName, params)
  const resultHash = hashToolOutcome(toolName, params, result, error)
  if (!resultHash) return

  // Find last matching unresolved record
  let matched = false
  for (let i = state.toolCallHistory.length - 1; i >= 0; i--) {
    const call = state.toolCallHistory[i]
    if (!call || call.toolName !== toolName || call.argsHash !== argsHash) continue
    if (call.resultHash !== undefined) continue
    call.resultHash = resultHash
    matched = true
    break
  }

  if (!matched) {
    state.toolCallHistory.push({
      toolName, argsHash, resultHash, timestamp: Date.now(),
    })
  }

  if (state.toolCallHistory.length > TOOL_CALL_HISTORY_SIZE) {
    state.toolCallHistory.splice(0, state.toolCallHistory.length - TOOL_CALL_HISTORY_SIZE)
  }
}

// agentic-agent.js - 前端 Agent Loop
// 完全端侧运行，通过可配置的 proxy 调用 LLM
// 支持流式输出 (stream) + 智能循环检测（对齐 OpenClaw）

// ── Error Classification ──

function classifyError(err) {
  const msg = (err && typeof err === 'object' ? err.message || '' : String(err)).toLowerCase()
  const status = err && err.status ? err.status : 0

  if (status === 401 || status === 403 || /unauthorized|forbidden|invalid.*api.?key|authentication/i.test(msg))
    return { category: 'auth', retryable: false }
  if (status === 402 || /billing|payment|quota exceeded|insufficient.?funds/i.test(msg))
    return { category: 'billing', retryable: false }
  if (status === 429 || /rate.?limit|too many requests/i.test(msg))
    return { category: 'rate_limit', retryable: true }
  if (/context.?length|token.?limit|maximum.?context|too.?long/i.test(msg))
    return { category: 'context_overflow', retryable: false }
  if (status >= 500 || status === 529 || /server.?error|internal.?error|bad.?gateway|service.?unavailable/i.test(msg))
    return { category: 'server', retryable: true }
  if (/network|econnrefused|econnreset|etimedout|fetch.?failed|dns|socket/i.test(msg))
    return { category: 'network', retryable: true }
  return { category: 'unknown', retryable: false }
}

const MAX_ROUNDS = 200  // 安全兜底，实际由循环检测控制（与 OpenClaw 一致）

// ── agenticAsk: backward-compat wrapper ──
// If emit (3rd arg) is a function → legacy mode, returns Promise<{answer, rounds, messages}>
// Otherwise → generator mode, returns AsyncGenerator<ChatEvent>

function agenticAsk(prompt, config, emit) {
  if (typeof emit === 'function') {
    // Legacy mode: collect events, call emit(), return final result
    return (async () => {
      let answer = ''
      let rounds = 0
      let messages = []
      for await (const event of _agenticAskGen(prompt, config)) {
        // Map new event types to legacy emit calls
        if (event.type === 'text_delta') {
          emit('token', { text: event.text })
        } else if (event.type === 'tool_use') {
          emit('tool', { name: event.name, input: event.input })
        } else if (event.type === 'warning') {
          emit('warning', { level: event.level, message: event.message })
        } else {
          emit(event.type, event)
        }
        if (event.type === 'done') {
          answer = event.answer
          rounds = event.rounds
          messages = event.messages || []
        }
      }
      return { answer, rounds, messages }
    })()
  }
  // Generator mode
  return _agenticAskGen(prompt, config)
}

// ── Custom provider registry ──

const _customProviders = new Map()

function registerProvider(name, chatFn) {
  _customProviders.set(name, chatFn)
}

function unregisterProvider(name) {
  _customProviders.delete(name)
}

// ── Provider failover ──

async function _callWithFailover(opts) {
  const { messages, tools, model, baseUrl, apiKey, proxyUrl, stream, system, provider, signal, providers } = opts
  const providerList = (providers && providers.length) ? providers : [{ provider, apiKey, baseUrl, model, proxyUrl }]

  let lastErr
  for (let i = 0; i < providerList.length; i++) {
    const p = providerList[i]
    const prov = p.provider || provider
    const custom = _customProviders.get(prov)
    const chatFn = custom || (prov === 'anthropic' ? anthropicChat : openaiChat)
    try {
      return await chatFn({
        messages, tools,
        model: p.model || model,
        baseUrl: p.baseUrl || baseUrl,
        apiKey: p.apiKey || apiKey,
        proxyUrl: p.proxyUrl || proxyUrl,
        stream, emit: function noop(){}, system, signal,
        onToolReady: opts.onToolReady,
      })
    } catch (err) {
      lastErr = err
      if (i < providerList.length - 1) continue
      throw err
    }
  }
  throw lastErr
}

/**
 * Streaming version of _callWithFailover.
 * Yields { type: 'text_delta', text } and { type: 'tool_ready', toolCall } events,
 * then yields { type: 'response', content, tool_calls, stop_reason } at the end.
 */
async function* _streamCallWithFailover(opts) {
  const { messages, tools, model, baseUrl, apiKey, proxyUrl, system, provider, signal, providers, maxTokens } = opts
  const providerList = (providers && providers.length) ? providers : [{ provider, apiKey, baseUrl, model, proxyUrl }]

  let lastErr
  for (let i = 0; i < providerList.length; i++) {
    const p = providerList[i]
    const prov = p.provider || provider
    const pModel = p.model || model
    const pBaseUrl = p.baseUrl || baseUrl
    const pApiKey = p.apiKey || apiKey
    const pProxyUrl = p.proxyUrl || proxyUrl

    // Custom providers: support both async generator (streaming) and plain async (non-streaming)
    const custom = _customProviders.get(prov)
    if (custom) {
      try {
        const result = custom({ messages, tools, model: pModel, baseUrl: pBaseUrl, apiKey: pApiKey, proxyUrl: pProxyUrl, stream: true, emit: function noop(){}, system, signal })
        if (result && typeof result[Symbol.asyncIterator] === 'function') {
          // Streaming custom provider
          let content = ''; const tool_calls = []
          for await (const chunk of result) {
            if (chunk.type === 'text_delta' || chunk.type === 'content') {
              const text = chunk.text || ''
              content += text
              yield { type: 'text_delta', text }
            } else if (chunk.type === 'tool_use') {
              tool_calls.push(chunk)
              yield chunk
            }
          }
          yield { type: 'response', content, tool_calls, stop_reason: tool_calls.length ? 'tool_use' : 'end_turn' }
        } else {
          // Non-streaming custom provider
          const response = await result
          if (response.content) yield { type: 'text_delta', text: response.content }
          yield { type: 'response', content: response.content, tool_calls: response.tool_calls || [], stop_reason: response.stop_reason }
        }
        return
      } catch (err) { lastErr = err; if (i < providerList.length - 1) continue; throw err }
    }

    try {
      const isAnthropic = prov === 'anthropic'
      const base = (pBaseUrl || (isAnthropic ? 'https://api.anthropic.com' : 'https://api.openai.com')).replace(/\/+$/, '')

      let url, headers, body
      if (isAnthropic) {
        url = base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`
        headers = { 'content-type': 'application/json', 'x-api-key': pApiKey, 'anthropic-version': '2023-06-01' }
        // Build Anthropic messages format
        const anthropicMessages = []
        for (const m of messages) {
          if (m.role === 'user') anthropicMessages.push({ role: 'user', content: m.content })
          else if (m.role === 'assistant') {
            if (m.tool_calls?.length) {
              const blocks = []; if (m.content) blocks.push({ type: 'text', text: m.content })
              for (const tc of m.tool_calls) blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })
              anthropicMessages.push({ role: 'assistant', content: blocks })
            } else { anthropicMessages.push({ role: 'assistant', content: m.content }) }
          } else if (m.role === 'tool') {
            const toolResult = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }
            const last = anthropicMessages[anthropicMessages.length - 1]
            if (last?.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') { last.content.push(toolResult) }
            else { anthropicMessages.push({ role: 'user', content: [toolResult] }) }
          }
        }
        body = { model: pModel || 'claude-sonnet-4', max_tokens: maxTokens || 4096, messages: anthropicMessages, stream: true }
        if (system) body.system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
        if (tools?.length) {
          body.tools = tools.map((t, i) => i === tools.length - 1
            ? { ...t, cache_control: { type: 'ephemeral' } }
            : t
          )
        }
        // Enable prompt caching beta
        headers['anthropic-beta'] = 'prompt-caching-2024-07-31'
        if (pProxyUrl) { headers = { ...headers, 'x-base-url': pBaseUrl || 'https://api.anthropic.com', 'x-provider': 'anthropic' }; url = pProxyUrl }
      } else {
        url = base.includes('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`
        headers = { 'content-type': 'application/json', 'authorization': `Bearer ${pApiKey}` }
        // Convert messages to proper OpenAI format (tool_calls need function wrapper)
        const convertedMsgs = messages.map(m => {
          if (m.role === 'assistant' && m.tool_calls?.length) {
            return { ...m, tool_calls: m.tool_calls.map(tc => tc.type === 'function' ? tc : { id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.input || {}) } }) }
          }
          return m
        })
        const oaiMessages = system ? [{ role: 'system', content: system }, ...convertedMsgs] : convertedMsgs
        body = { model: pModel || 'gpt-4', messages: oaiMessages, stream: true }
        if (tools?.length) {
          body.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })); body.tool_choice = 'auto'
        }
        if (pProxyUrl) { headers['x-base-url'] = pBaseUrl || 'https://api.openai.com'; headers['x-provider'] = 'openai'; url = pProxyUrl }
      }

      // Use the appropriate generator
      const gen = isAnthropic ? _streamAnthropicGen(url, headers, body, signal) : _streamOpenAIGen(url, headers, body, signal)

      let content = '', toolCalls = [], stopReason = 'end_turn'
      const oaiToolMap = {} // for OpenAI incremental tool_delta assembly

      for await (const evt of gen) {
        if (evt.type === 'text_delta') {
          content += evt.text
          yield evt
        } else if (evt.type === 'tool_ready') {
          // Anthropic: complete tool call
          toolCalls.push(evt.toolCall)
          yield evt
        } else if (evt.type === 'tool_delta') {
          // OpenAI: incremental tool call assembly
          const td = evt.toolDelta
          if (!oaiToolMap[td.index]) oaiToolMap[td.index] = { id: '', name: '', arguments: '' }
          if (td.id) oaiToolMap[td.index].id = td.id
          if (td.name) oaiToolMap[td.index].name = td.name
          if (td.arguments) oaiToolMap[td.index].arguments += td.arguments
        } else if (evt.type === 'stop') {
          stopReason = evt.stop_reason
        } else if (evt.type === 'usage') {
          yield evt
        }
      }

      // Finalize OpenAI tool calls
      if (Object.keys(oaiToolMap).length) {
        for (const t of Object.values(oaiToolMap)) {
          if (!t.name) continue
          let input = {}; try { input = JSON.parse(t.arguments || '{}') } catch {}
          const tc = { id: t.id, name: t.name, input }
          toolCalls.push(tc)
          yield { type: 'tool_ready', toolCall: tc }
        }
      }

      yield { type: 'response', content, tool_calls: toolCalls, stop_reason: stopReason }
      return
    } catch (err) {
      lastErr = err
      if (i < providerList.length - 1) continue
      throw err
    }
  }
  throw lastErr
}

// ── Core async generator ──

async function* _agenticAskGen(prompt, config) {
  const { provider = 'anthropic', baseUrl, apiKey, model, tools = ['search', 'code'], searchApiKey, history, proxyUrl, stream = true, schema, retries = 2, system, images, audio, signal, providers } = config

  if (!apiKey && (!providers || !providers.length)) throw new Error('API Key required')

  // Schema mode
  if (schema) {
    const result = await schemaAsk(prompt, config, function noop(){})
    yield { type: 'done', answer: result.answer, rounds: 1, stopReason: 'end_turn', messages: [] }
    return
  }

  const { defs: toolDefs, customTools } = buildToolDefs(tools)

  // Build messages
  const messages = []
  if (history?.length) {
    messages.push(...history)
  }

  // Build user message — support vision (images) and audio
  if (images?.length || audio) {
    const content = []
    if (images?.length) {
      for (const img of images) {
        if (provider === 'anthropic') {
          content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type || 'image/jpeg', data: img.data } })
        } else {
          const url = img.url || `data:${img.media_type || 'image/jpeg'};base64,${img.data}`
          content.push({ type: 'image_url', image_url: { url, detail: img.detail || 'low' } })
        }
      }
    }
    if (audio) {
      if (provider === 'anthropic') {
        console.warn('[agenticAsk] Anthropic does not support audio input')
      } else {
        content.push({ type: 'input_audio', input_audio: { data: audio.data, format: audio.format || 'wav' } })
      }
    }
    content.push({ type: 'text', text: prompt })
    messages.push({ role: 'user', content })
  } else {
    messages.push({ role: 'user', content: prompt })
  }

  let round = 0
  let finalAnswer = null
  const state = { toolCallHistory: [] }

  const t_start = Date.now()

  console.log('[agenticAsk] Starting with prompt:', prompt.slice(0, 50))
  console.log('[agenticAsk] Tools available:', tools, 'Stream:', stream)
  console.log('[agenticAsk] Provider:', provider)

  // Eager execution hint at core level: prepend to system when tools are available
  const eagerEnabled = toolDefs.length > 0
  const effectiveSystem = eagerEnabled
    ? (system ? EAGER_HINT + '\n\n' + system : EAGER_HINT)
    : system

  yield { type: 'config', eager: eagerEnabled, tools: toolDefs.length, provider }

  while (round < MAX_ROUNDS) {
    round++

    // Check abort signal
    if (signal && signal.aborted) {
      yield { type: 'error', error: 'aborted', category: 'network', retryable: false }
      return
    }

    const t_round = Date.now()
    let t_firstToken = 0
    console.log(`\n[Round ${round}] Calling LLM...`)
    yield { type: 'status', message: `Round ${round}/${MAX_ROUNDS}` }

    const isStreamRound = stream && (provider === 'anthropic' || !toolDefs.length || round > 1)
    let response

    // Eager tool execution: start tools as soon as LLM finishes each tool_use block
    const eagerResults = new Map() // toolCallId → Promise<result>

    if (isStreamRound) {
      // True streaming path — yield text_delta tokens as they arrive
      try {
        const streamGen = _streamCallWithFailover({ messages, tools: toolDefs, model, baseUrl, apiKey, proxyUrl, system: effectiveSystem, provider, signal, providers })
        for await (const evt of streamGen) {
          if (evt.type === 'text_delta') {
            if (!t_firstToken) t_firstToken = Date.now()
            yield evt // Forward token-level events to consumer
          } else if (evt.type === 'tool_ready') {
            // Start eager tool execution
            const toolCall = evt.toolCall
            const promise = (async () => {
              const t0 = Date.now()
              try {
                const result = await executeTool(toolCall.name, toolCall.input, { searchApiKey, customTools })
                return { call: toolCall, result, error: null, ms: Date.now() - t0 }
              } catch (err) {
                return { call: toolCall, result: null, error: err.message || String(err), ms: Date.now() - t0 }
              }
            })()
            eagerResults.set(toolCall.id, promise)
          } else if (evt.type === 'response') {
            response = evt
          }
        }
      } catch (err) {
        const cls = classifyError(err)
        yield { type: 'error', error: err.message, category: cls.category, retryable: cls.retryable }
        return
      }
    } else {
      // Non-streaming path — await complete response
      try {
        response = await _callWithFailover({ messages, tools: toolDefs, model, baseUrl, apiKey, proxyUrl, stream: false, system: effectiveSystem, provider, signal, providers })
      } catch (err) {
        const cls = classifyError(err)
        yield { type: 'error', error: err.message, category: cls.category, retryable: cls.retryable }
        return
      }
      // Yield text content as text_delta (single chunk for non-streaming)
      if (response.content) {
        t_firstToken = Date.now()
        yield { type: 'text_delta', text: response.content }
      }
    }

    const t_llmDone = Date.now()
    const llmMs = t_llmDone - t_round
    const ttftMs = t_firstToken ? t_firstToken - t_round : null
    console.log(`[Round ${round}] LLM done in ${llmMs}ms (TTFT: ${ttftMs ?? 'n/a'}ms)`)
    yield { type: 'timing', round, phase: 'llm', ms: llmMs, ttft: ttftMs }
    console.log(`[Round ${round}] LLM Response:`)
    console.log(`  - stop_reason: ${response.stop_reason}`)
    console.log(`  - content:`, response.content)
    console.log(`  - tool_calls: ${response.tool_calls?.length || 0}`)

    // Check if done
    if (['end_turn', 'stop'].includes(response.stop_reason) || !response.tool_calls?.length) {
      console.log(`[Round ${round}] Done: stop_reason=${response.stop_reason}, tool_calls=${response.tool_calls?.length || 0}`)
      finalAnswer = response.content
      break
    }

    // Execute tools
    console.log(`[Round ${round}] Executing ${response.tool_calls.length} tool calls...`)
    messages.push({ role: 'assistant', content: response.content, tool_calls: response.tool_calls })

    // Pre-check: abort signal + loop detection
    if (signal && signal.aborted) {
      yield { type: 'error', error: 'aborted', category: 'network', retryable: false }
      return
    }

    const validCalls = []
    for (const call of response.tool_calls) {
      recordToolCall(state, call.name, call.input)
      const loopDetection = detectToolCallLoop(state, call.name, call.input)
      if (loopDetection.stuck) {
        console.log(`[Round ${round}] Loop detected: ${loopDetection.detector} (${loopDetection.level})`)
        yield { type: 'warning', level: loopDetection.level, message: loopDetection.message }
        if (loopDetection.level === 'critical') {
          finalAnswer = `[Loop Detection] ${loopDetection.message}`
          break
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: `LOOP_DETECTED: ${loopDetection.message}` }) })
      } else {
        validCalls.push(call)
      }
    }

    if (!finalAnswer && validCalls.length) {
      // Emit all tool_use events upfront
      for (const call of validCalls) {
        yield { type: 'tool_use', id: call.id, name: call.name, input: call.input }
      }

      const t0 = Date.now()

      // Collect yielded events from streaming tools
      const streamEvents = []

      // Eager execution: tools already started during LLM streaming?
      const hasEager = eagerResults.size > 0
      if (hasEager) {
        console.log(`[Round ${round}] ${eagerResults.size}/${validCalls.length} tools started eagerly during LLM stream`)
      }

      const results = await Promise.all(validCalls.map(async (call) => {
        try {
          // Use eager result if available, otherwise execute now
          let result
          if (eagerResults.has(call.id)) {
            const eager = await eagerResults.get(call.id)
            recordToolCallOutcome(state, call.name, call.input, eager.result, eager.error)
            return eager
          }

          result = await executeTool(call.name, call.input, { searchApiKey, customTools })

          // Streaming tool: async generator → collect progress, return final
          if (result && typeof result[Symbol.asyncIterator] === 'function') {
            let finalResult = null
            for await (const delta of result) {
              if (delta._final) {
                finalResult = delta.result ?? delta
              } else {
                streamEvents.push({ type: 'tool_progress', id: call.id, name: call.name, delta })
              }
            }
            const out = finalResult ?? { streamed: true }
            recordToolCallOutcome(state, call.name, call.input, out, null)
            return { call, result: out, error: null }
          }

          recordToolCallOutcome(state, call.name, call.input, result, null)
          return { call, result, error: null }
        } catch (toolErr) {
          const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr)
          recordToolCallOutcome(state, call.name, call.input, null, errMsg)
          return { call, result: null, error: errMsg }
        }
      }))
      console.log(`[Round ${round}] All ${validCalls.length} tools done in ${Date.now() - t0}ms${hasEager ? ' (eager+parallel)' : ' (parallel)'}`)

      // Yield timing event for this round
      const toolMs = Date.now() - t0
      yield { type: 'timing', round, phase: 'tools', ms: toolMs, eager: hasEager, count: validCalls.length }

      // Yield streaming tool progress events
      for (const evt of streamEvents) {
        yield evt
      }

      // Push results in original order + yield events
      for (const { call, result, error } of results) {
        if (error) {
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error }) })
          yield { type: 'tool_error', id: call.id, name: call.name, error }
        } else {
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
          yield { type: 'tool_result', id: call.id, name: call.name, output: result }
        }
      }
    }

    if (finalAnswer) break
  }

  console.log(`\n[agenticAsk] Loop ended at round ${round}`)

  if (!finalAnswer) {
    console.log('[agenticAsk] Generating final answer (no tools)...')
    yield { type: 'status', message: 'Generating final answer...' }
    try {
      if (stream) {
        // Stream the final answer too
        let content = ''
        for await (const evt of _streamCallWithFailover({ messages, tools: [], model, baseUrl, apiKey, proxyUrl, system, provider, signal, providers })) {
          if (evt.type === 'text_delta') { content += evt.text; yield evt }
          else if (evt.type === 'response') { /* done */ }
        }
        finalAnswer = content || '(no response)'
      } else {
        const chatFn = provider === 'anthropic' ? anthropicChat : openaiChat
        const finalResponse = await chatFn({ messages, tools: [], model, baseUrl, apiKey, proxyUrl, stream: false, emit: function noop(){}, system, signal })
        finalAnswer = finalResponse.content || '(no response)'
      }
    } catch (err) {
      const cls = classifyError(err)
      yield { type: 'error', error: err.message, category: cls.category, retryable: cls.retryable }
      return
    }
    console.log('[agenticAsk] Final answer:', finalAnswer.slice(0, 100))
  }

  console.log('[agenticAsk] Complete. Total rounds:', round, 'Total time:', Date.now() - t_start, 'ms')
  yield { type: 'done', answer: finalAnswer, rounds: round, stopReason: 'end_turn', messages, totalMs: Date.now() - t_start }
}

// ── LLM Chat Functions ──

async function anthropicChat({ messages, tools, model = 'claude-sonnet-4', baseUrl = 'https://api.anthropic.com', apiKey, proxyUrl, stream = false, emit, system, signal, onToolReady }) {
  const base = baseUrl.replace(/\/+$/, '')
  const url = base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`
  
  // Convert messages to Anthropic format (handle tool_use/tool_result)
  const anthropicMessages = []
  for (const m of messages) {
    if (m.role === 'user') {
      anthropicMessages.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      if (m.tool_calls?.length) {
        const blocks = []
        if (m.content) blocks.push({ type: 'text', text: m.content })
        for (const tc of m.tool_calls) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })
        }
        anthropicMessages.push({ role: 'assistant', content: blocks })
      } else {
        anthropicMessages.push({ role: 'assistant', content: m.content })
      }
    } else if (m.role === 'tool') {
      const toolResult = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }
      const last = anthropicMessages[anthropicMessages.length - 1]
      if (last?.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') {
        last.content.push(toolResult)
      } else {
        anthropicMessages.push({ role: 'user', content: [toolResult] })
      }
    }
  }
  
  const body = {
    model,
    max_tokens: opts.maxTokens || 4096,
    messages: anthropicMessages,
    stream,
  }
  if (tools?.length) {
    body.tools = tools
  }
  
  const headers = { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }

  // Enable prompt caching for system + tools (Anthropic beta)
  if (system || tools?.length) {
    headers['anthropic-beta'] = 'prompt-caching-2024-07-31'
  }

  // Apply cache_control to system prompt
  if (system) {
    body.system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
  }

  // Apply cache_control to last tool definition (caches all tools up to that point)
  if (tools?.length) {
    body.tools = tools.map((t, i) => i === tools.length - 1
      ? { ...t, cache_control: { type: 'ephemeral' } }
      : t
    )
  }

  if (stream && !proxyUrl) {
    // Stream mode — direct SSE
    return await streamAnthropic(url, headers, body, emit, signal, onToolReady)
  }

  if (stream && proxyUrl) {
    // Stream via transparent proxy (Vercel Edge / similar)
    // Send stream:true request through proxy with custom headers
    const proxyHeaders = { ...headers, 'x-base-url': baseUrl || 'https://api.anthropic.com', 'x-provider': 'anthropic' }
    return await streamAnthropic(proxyUrl, proxyHeaders, body, emit, signal, onToolReady)
  }

  const response = await callLLM(url, apiKey, body, proxyUrl, true, signal)
  
  const text = response.content.find(c => c.type === 'text')?.text || ''
  
  return {
    content: text,
    tool_calls: response.content.filter(c => c.type === 'tool_use').map(t => ({
      id: t.id, name: t.name, input: t.input
    })),
    stop_reason: response.stop_reason
  }
}

async function openaiChat({ messages, tools, model = 'gpt-4', baseUrl = 'https://api.openai.com', apiKey, proxyUrl, stream = false, emit, system, signal, onToolReady }) {
  const base = baseUrl.replace(/\/+$/, '')
  const url = base.includes('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`
  // Convert messages to proper OpenAI format (tool_calls need function wrapper)
  const convertedMessages = messages.map(m => {
    if (m.role === 'assistant' && m.tool_calls?.length) {
      return {
        ...m,
        tool_calls: m.tool_calls.map(tc => {
          if (tc.type === 'function') return tc  // already OpenAI format
          return { id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.input || {}) } }
        })
      }
    }
    return m
  })
  const oaiMessages = system ? [{ role: 'system', content: system }, ...convertedMessages] : convertedMessages
  const body = { model, messages: oaiMessages, stream }
  if (tools?.length) {
    body.tools = tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema || t.parameters || { type: 'object', properties: {} } }
    }))
  }
  
  const headers = { 'content-type': 'application/json', 'authorization': `Bearer ${apiKey}` }

  if (stream && !proxyUrl) {
    return await streamOpenAI(url, headers, body, emit, signal, onToolReady)
  }

  if (stream && proxyUrl) {
    const proxyHeaders = { ...headers, 'x-base-url': baseUrl || 'https://api.openai.com', 'x-provider': 'openai', 'x-api-key': apiKey }
    return await streamOpenAI(proxyUrl, proxyHeaders, body, emit, signal, onToolReady)
  }

  const response = await callLLM(url, apiKey, body, proxyUrl, false, signal)
  
  // Handle SSE response from non-stream endpoints
  if (typeof response === 'string' && response.includes('chat.completion.chunk')) {
    return parseSSEResponse(response)
  }
  
  const choice = response.choices?.[0]
  if (!choice) return { content: '', tool_calls: [], stop_reason: 'stop' }
  
  const text = choice.message?.content || ''
  
  return {
    content: text,
    tool_calls: choice.message?.tool_calls?.map(t => {
      let input = {}
      try { input = JSON.parse(t.function.arguments || '{}') } catch {}
      return { id: t.id, name: t.function.name, input }
    }) || [],
    stop_reason: choice.finish_reason
  }
}

// ── Streaming Functions ──

// streamAnthropic — legacy (non-generator), kept for backward compat
async function streamAnthropic(url, headers, body, emit, signal, onToolReady) {
  let content = '', toolCalls = [], stopReason = 'end_turn'
  for await (const evt of _streamAnthropicGen(url, headers, body, signal)) {
    if (evt.type === 'text_delta') { content += evt.text; emit('token', { text: evt.text }) }
    else if (evt.type === 'tool_ready') { toolCalls.push(evt.toolCall); if (onToolReady) onToolReady(evt.toolCall) }
    else if (evt.type === 'stop') { stopReason = evt.stop_reason }
  }
  return { content, tool_calls: toolCalls, stop_reason: stopReason }
}

// True streaming generator for Anthropic SSE
async function* _streamAnthropicGen(url, headers, body, signal) {
  const fetchOpts = { method: 'POST', headers, body: JSON.stringify(body) }
  if (signal) fetchOpts.signal = signal
  const res = await fetch(url, fetchOpts)
  if (!res.ok) {
    const err = await res.text()
    const e = new Error(`API error ${res.status}: ${err.slice(0, 300)}`)
    e.status = res.status
    throw e
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let currentToolInput = ''
  let currentTool = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue
      try {
        const event = JSON.parse(data)
        
        // Emit usage from message_start (includes cache stats)
        if (event.type === 'message_start' && event.message?.usage) {
          yield { type: 'usage', usage: event.message.usage }
        }

        if (event.type === 'content_block_delta') {
          if (event.delta?.type === 'text_delta') {
            yield { type: 'text_delta', text: event.delta.text }
          } else if (event.delta?.type === 'input_json_delta') {
            currentToolInput += event.delta.partial_json || ''
          }
        } else if (event.type === 'content_block_start') {
          if (event.content_block?.type === 'tool_use') {
            currentTool = { id: event.content_block.id, name: event.content_block.name }
            currentToolInput = ''
          }
        } else if (event.type === 'content_block_stop') {
          if (currentTool) {
            let input = {}
            try { input = JSON.parse(currentToolInput || '{}') } catch {}
            const toolCall = { ...currentTool, input }
            yield { type: 'tool_ready', toolCall }
            currentTool = null
            currentToolInput = ''
          }
        } else if (event.type === 'message_delta') {
          if (event.usage) yield { type: 'usage', usage: event.usage }
          if (event.delta?.stop_reason) yield { type: 'stop', stop_reason: event.delta.stop_reason }
        }
      } catch {}
    }
  }
}

// streamOpenAI — legacy (non-generator), kept for backward compat
async function streamOpenAI(url, headers, body, emit, signal, onToolReady) {
  let content = '', finishReason = 'stop'
  const toolCallsMap = {}
  for await (const evt of _streamOpenAIGen(url, headers, body, signal)) {
    if (evt.type === 'text_delta') { content += evt.text; emit('token', { text: evt.text }) }
    else if (evt.type === 'tool_delta') {
      const tc = evt.toolDelta
      if (!toolCallsMap[tc.index]) toolCallsMap[tc.index] = { id: '', name: '', arguments: '' }
      if (tc.id) toolCallsMap[tc.index].id = tc.id
      if (tc.name) toolCallsMap[tc.index].name = tc.name
      if (tc.arguments) toolCallsMap[tc.index].arguments += tc.arguments
    }
    else if (evt.type === 'stop') { finishReason = evt.stop_reason }
  }
  const tcList = Object.values(toolCallsMap).filter(t => t.name).map(t => {
    let input = {}; try { input = JSON.parse(t.arguments || '{}') } catch {}
    return { id: t.id, name: t.name, input }
  })
  if (onToolReady) { for (const tc of tcList) onToolReady(tc) }
  return { content, tool_calls: tcList, stop_reason: finishReason }
}

// True streaming generator for OpenAI SSE
async function* _streamOpenAIGen(url, headers, body, signal) {
  const fetchOpts = { method: 'POST', headers, body: JSON.stringify(body) }
  if (signal) fetchOpts.signal = signal
  const res = await fetch(url, fetchOpts)
  if (!res.ok) {
    const err = await res.text()
    const e = new Error(`API error ${res.status}: ${err.slice(0, 300)}`)
    e.status = res.status
    throw e
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue
      try {
        const chunk = JSON.parse(data)
        const delta = chunk.choices?.[0]?.delta
        if (!delta) continue

        if (delta.content) {
          yield { type: 'text_delta', text: delta.content }
        }
        if (chunk.choices?.[0]?.finish_reason) {
          yield { type: 'stop', stop_reason: chunk.choices[0].finish_reason }
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            yield { type: 'tool_delta', toolDelta: { index: tc.index, id: tc.id || '', name: tc.function?.name || '', arguments: tc.function?.arguments || '' } }
          }
        }
      } catch {}
    }
  }
}

// ── Non-stream Proxy/Direct Call ──

async function callLLM(url, apiKey, body, proxyUrl, isAnthropic = false, signal) {
  const headers = { 'content-type': 'application/json' }
  if (isAnthropic) {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else {
    headers['authorization'] = `Bearer ${apiKey}`
  }

  if (proxyUrl) {
    const proxyHeaders = {
      ...headers,
      'x-base-url': url.replace(/\/v1\/.*$/, ''),
      'x-provider': isAnthropic ? 'anthropic' : 'openai',
      'x-api-key': apiKey,
    }
    const fetchOpts = { method: 'POST', headers: proxyHeaders, body: JSON.stringify(body) }
    if (signal) fetchOpts.signal = signal
    const response = await fetch(proxyUrl, fetchOpts)
    if (!response.ok) {
      const text = await response.text()
      const e = new Error(`API error ${response.status}: ${text.slice(0, 300)}`)
      e.status = response.status
      throw e
    }
    return await response.json()
  } else {
    const fetchOpts = { method: 'POST', headers, body: JSON.stringify(body) }
    if (signal) fetchOpts.signal = signal
    const response = await fetch(url, fetchOpts)
    if (!response.ok) {
      const text = await response.text()
      const e = new Error(`API error ${response.status}: ${text}`)
      e.status = response.status
      throw e
    }
    const text = await response.text()
    if (text.trimStart().startsWith('data: ')) return reassembleSSE(text)
    return JSON.parse(text)
  }
}

function parseSSEResponse(sseText) {
  const lines = sseText.split('\n')
  let textContent = ''
  const toolCalls = []
  let currentToolCall = null
  let lastChunkWasToolUse = false
  
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      let jsonStr = line
      if (line.includes('data: ')) jsonStr = line.split('data: ')[1]
      if (!jsonStr || !jsonStr.includes('{')) continue
      const startIdx = jsonStr.indexOf('{')
      const endIdx = jsonStr.lastIndexOf('}')
      if (startIdx === -1 || endIdx === -1) continue
      const chunk = JSON.parse(jsonStr.substring(startIdx, endIdx + 1))
      if (chunk.choices?.[0]?.delta?.content) {
        textContent += chunk.choices[0].delta.content
        lastChunkWasToolUse = false
      }
      if (chunk.name) {
        if (currentToolCall && currentToolCall.name !== chunk.name) toolCalls.push(currentToolCall)
        currentToolCall = { id: chunk.call_id || `call_${Date.now()}`, name: chunk.name, arguments: chunk.arguments || '' }
        lastChunkWasToolUse = true
      } else if (lastChunkWasToolUse && chunk.arguments !== undefined && currentToolCall) {
        currentToolCall.arguments += chunk.arguments
      }
    } catch {}
  }
  if (currentToolCall) toolCalls.push(currentToolCall)
  const parsedToolCalls = toolCalls.map(t => {
    let input = {}
    try { if (t.arguments.trim()) input = JSON.parse(t.arguments) } catch {}
    return { id: t.id, name: t.name, input }
  })
  return { content: textContent, tool_calls: parsedToolCalls, stop_reason: parsedToolCalls.length > 0 ? 'tool_use' : 'stop' }
}

function reassembleSSE(raw) {
  const lines = raw.split('\n')
  let content = ''
  let toolCalls = {}
  let model = ''
  let usage = null
  let finishReason = null
  for (const line of lines) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
    try {
      const chunk = JSON.parse(line.slice(6))
      if (chunk.model) model = chunk.model
      if (chunk.usage) usage = chunk.usage
      const delta = chunk.choices?.[0]?.delta
      if (!delta) continue
      if (delta.content) content += delta.content
      if (delta.finish_reason) finishReason = delta.finish_reason
      if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCalls[tc.index]) toolCalls[tc.index] = { id: '', name: '', arguments: '' }
          if (tc.id) toolCalls[tc.index].id = tc.id
          if (tc.function?.name) toolCalls[tc.index].name = tc.function.name
          if (tc.function?.arguments) toolCalls[tc.index].arguments += tc.function.arguments
        }
      }
    } catch {}
  }
  const tcList = Object.values(toolCalls).filter(t => t.name)
  return {
    choices: [{ message: { content, tool_calls: tcList.length ? tcList.map(t => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.arguments } })) : undefined }, finish_reason: finishReason || 'stop' }],
    model, usage: usage || { prompt_tokens: 0, completion_tokens: 0 }
  }
}

// ── Tools ──

function buildToolDefs(tools) {
  const defs = []
  const customTools = []
  
  // Add registry tools first
  for (const tool of toolRegistry.list()) {
    defs.push({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    })
  }
  
  for (const tool of tools) {
    if (typeof tool === 'string') {
      // Built-in tool
      if (tool === 'search') {
        defs.push({ name: 'search', description: 'Search the web for current information', input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] } })
      } else if (tool === 'code') {
        defs.push({ name: 'execute_code', description: 'Execute Python code', input_schema: { type: 'object', properties: { code: { type: 'string', description: 'Python code to execute' } }, required: ['code'] } })
      }
    } else if (typeof tool === 'object' && tool.name) {
      // Custom tool
      defs.push({
        name: tool.name,
        description: tool.description || '',
        input_schema: tool.parameters || tool.input_schema || { type: 'object', properties: {} }
      })
      customTools.push(tool)
    }
  }
  
  return { defs, customTools }
}

async function executeTool(name, input, config) {
  // Check registry first
  const registered = toolRegistry.get(name)
  if (registered && registered.execute) {
    const result = registered.execute(input)
    // Streaming tool: returns async generator
    if (result && typeof result[Symbol.asyncIterator] === 'function') {
      return result // caller handles iteration
    }
    return await result
  }
  
  // Check custom tools
  if (config.customTools) {
    const custom = config.customTools.find(t => t.name === name)
    if (custom && custom.execute) {
      const result = custom.execute(input)
      if (result && typeof result[Symbol.asyncIterator] === 'function') {
        return result
      }
      return await result
    }
  }
  
  // Built-in tools
  if (name === 'search') return await searchWeb(input.query, config.searchApiKey)
  if (name === 'execute_code') return { output: '[Code execution not available in browser]' }
  
  return { error: 'Unknown tool' }
}

async function searchWeb(query, apiKey) {
  if (!apiKey) return { error: 'Search API key required' }
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: 5 })
  })
  const data = await response.json()
  return { results: data.results || [] }
}

// ── Schema Mode (Structured Output) ──

async function schemaAsk(prompt, config, emit) {
  const { provider = 'anthropic', baseUrl, apiKey, model, history, proxyUrl, schema, retries = 2, images } = config
  
  const schemaStr = JSON.stringify(schema, null, 2)
  const systemPrompt = `You must respond with valid JSON that matches this schema:\n${schemaStr}\n\nRules:\n- Output ONLY the JSON object, no markdown, no explanation, no code fences\n- All required fields must be present\n- Types must match exactly`
  
  // Build user content — support vision images
  let userContent = systemPrompt + '\n\n' + prompt
  if (images?.length) {
    const content = []
    for (const img of images) {
      if (provider === 'anthropic') {
        content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type || 'image/jpeg', data: img.data } })
      } else {
        const url = img.url || `data:${img.media_type || 'image/jpeg'};base64,${img.data}`
        content.push({ type: 'image_url', image_url: { url, detail: img.detail || 'auto' } })
      }
    }
    content.push({ type: 'text', text: systemPrompt + '\n\n' + prompt })
    userContent = content
  }
  
  const messages = []
  if (history?.length) messages.push(...history)
  messages.push({ role: 'user', content: prompt })
  
  let lastError = null
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      console.log(`[schema] Retry ${attempt}/${retries}: ${lastError}`)
      emit('status', { message: `Retry ${attempt}/${retries}...` })
      // Add error feedback for retry
      messages.push({ role: 'assistant', content: lastError.raw })
      messages.push({ role: 'user', content: `That JSON was invalid: ${lastError.message}\n\nPlease fix and return ONLY valid JSON matching the schema.` })
    }
    
    emit('status', { message: attempt === 0 ? 'Generating structured output...' : `Retry ${attempt}/${retries}...` })
    
    const chatFn = provider === 'anthropic' ? anthropicChat : openaiChat
    const response = await chatFn({
      messages: [{ role: 'user', content: userContent }],
      tools: [], model, baseUrl, apiKey, proxyUrl, stream: false, emit
    })
    
    const raw = response.content.trim()
    
    // Try to extract JSON (handle markdown fences)
    let jsonStr = raw
    const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    if (fenceMatch) jsonStr = fenceMatch[1].trim()
    
    // Parse
    let parsed
    try {
      parsed = JSON.parse(jsonStr)
    } catch (e) {
      lastError = { message: `JSON parse error: ${e.message}`, raw }
      continue
    }
    
    // Validate against schema
    const validation = validateSchema(parsed, schema)
    if (!validation.valid) {
      lastError = { message: validation.error, raw }
      continue
    }
    
    // Success
    return { answer: raw, data: parsed, attempts: attempt + 1 }
  }
  
  // All retries exhausted
  throw new Error(`Schema validation failed after ${retries + 1} attempts: ${lastError.message}`)
}

function validateSchema(data, schema) {
  if (!schema || !schema.type) return { valid: true }
  
  // Type check
  if (schema.type === 'object') {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return { valid: false, error: `Expected object, got ${Array.isArray(data) ? 'array' : typeof data}` }
    }
    // Required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in data)) {
          return { valid: false, error: `Missing required field: "${field}"` }
        }
      }
    }
    // Property types
    if (schema.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        if (key in data && data[key] !== null && data[key] !== undefined) {
          const val = data[key]
          if (prop.type === 'string' && typeof val !== 'string') return { valid: false, error: `Field "${key}" should be string, got ${typeof val}` }
          if (prop.type === 'number' && typeof val !== 'number') return { valid: false, error: `Field "${key}" should be number, got ${typeof val}` }
          if (prop.type === 'boolean' && typeof val !== 'boolean') return { valid: false, error: `Field "${key}" should be boolean, got ${typeof val}` }
          if (prop.type === 'array' && !Array.isArray(val)) return { valid: false, error: `Field "${key}" should be array, got ${typeof val}` }
          // Enum check
          if (prop.enum && !prop.enum.includes(val)) return { valid: false, error: `Field "${key}" must be one of: ${prop.enum.join(', ')}` }
        }
      }
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(data)) return { valid: false, error: `Expected array, got ${typeof data}` }
  } else if (schema.type === 'string') {
    if (typeof data !== 'string') return { valid: false, error: `Expected string, got ${typeof data}` }
  } else if (schema.type === 'number') {
    if (typeof data !== 'number') return { valid: false, error: `Expected number, got ${typeof data}` }
  }
  
  return { valid: true }
}

// ── Tool Registry ──

const toolRegistry = {
  _tools: new Map(),
  
  register(name, tool) {
    if (!name || typeof name !== 'string') throw new Error('Tool name required')
    if (!tool || typeof tool !== 'object') throw new Error('Tool must be an object')
    if (!tool.description) throw new Error('Tool description required')
    if (!tool.execute || typeof tool.execute !== 'function') throw new Error('Tool execute function required')
    
    this._tools.set(name, {
      name,
      description: tool.description,
      parameters: tool.parameters || { type: 'object', properties: {} },
      execute: tool.execute,
      streaming: !!tool.streaming,
    })
  },
  
  unregister(name) {
    this._tools.delete(name)
  },
  
  get(name) {
    return this._tools.get(name)
  },
  
  list(category) {
    const tools = Array.from(this._tools.values())
    if (!category) return tools
    return tools.filter(t => t.category === category)
  },
  
  clear() {
    this._tools.clear()
  }
}

// ── Audio: TTS (synthesize) ─────────────────────────────────────

async function synthesize(text, config = {}) {
  const {
    provider = 'openai',
    baseUrl = 'https://api.openai.com',
    apiKey,
    proxyUrl,
    model = 'tts-1',
    voice = 'alloy',
    format = 'mp3',
  } = config

  if (!apiKey) throw new Error('API key required for TTS')
  if (!text?.trim()) return null

  // ElevenLabs
  if (provider === 'elevenlabs') {
    const voiceId = voice
    const modelId = model || 'eleven_turbo_v2_5'
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`
    const res = await _audioFetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: modelId, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    })
    return res.arrayBuffer()
  }

  // OpenAI-compatible (default) — works with agentic-service too
  const base = (baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/, '')
  const url = `${base}/v1/audio/speech`
  const targetUrl = proxyUrl || url
  const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  if (proxyUrl) headers['X-Target-URL'] = url

  const res = await _audioFetch(targetUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, voice, input: text, response_format: format }),
  })
  return res.arrayBuffer()
}

// ── Audio: STT (transcribe) ─────────────────────────────────────

async function transcribe(audio, config = {}) {
  const {
    provider = 'openai',
    baseUrl = 'https://api.openai.com',
    apiKey,
    proxyUrl,
    model = 'whisper-1',
    language = 'zh',
    timestamps = false,
  } = config

  if (!apiKey) throw new Error('API key required for STT')

  // ElevenLabs
  if (provider === 'elevenlabs') {
    const modelId = model || 'scribe_v2'
    const url = 'https://api.elevenlabs.io/v1/speech-to-text'
    const form = _buildAudioForm(audio, 'audio.wav', 'audio/wav')
    form.append('model_id', modelId)
    const res = await _audioFetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
    })
    const data = await res.json()
    return timestamps ? data : (data.text?.trim() || '')
  }

  // OpenAI-compatible (default)
  const base = (baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/, '')
  const url = `${base}/v1/audio/transcriptions`
  const targetUrl = proxyUrl || url
  const form = _buildAudioForm(audio, 'audio.wav', 'audio/wav')
  form.append('model', model)
  if (language) form.append('language', language.split('-')[0])
  if (timestamps) {
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'word')
  }

  const headers = { 'Authorization': `Bearer ${apiKey}` }
  if (proxyUrl) headers['X-Target-URL'] = url

  const res = await _audioFetch(targetUrl, { method: 'POST', headers, body: form })
  const data = await res.json()
  return timestamps ? data : (data.text?.trim() || '')
}

// ── Audio helpers ───────────────────────────────────────────────

function _buildAudioForm(audio, filename, mimeType) {
  // Node.js Buffer → Blob
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(audio)) {
    const blob = new Blob([audio], { type: mimeType })
    const form = new FormData()
    form.append('file', blob, filename)
    return form
  }
  // ArrayBuffer → Blob
  if (audio instanceof ArrayBuffer || (audio?.buffer instanceof ArrayBuffer)) {
    const blob = new Blob([audio], { type: mimeType })
    const form = new FormData()
    form.append('file', blob, filename)
    return form
  }
  // Already a Blob/File
  if (audio instanceof Blob) {
    const form = new FormData()
    form.append('file', audio, filename)
    return form
  }
  // File path (string, Node.js only)
  if (typeof audio === 'string' && typeof require === 'function') {
    const fs = require('fs')
    const buf = fs.readFileSync(audio)
    const blob = new Blob([buf], { type: mimeType })
    const form = new FormData()
    form.append('file', blob, filename)
    return form
  }
  throw new Error('Unsupported audio input type')
}

async function _audioFetch(url, opts, retries = 3) {
  let lastErr
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, opts)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Audio API ${res.status}: ${text.slice(0, 300)}`)
      }
      return res
    } catch (err) {
      lastErr = err
      if (i < retries - 1) await new Promise(r => setTimeout(r, 500 * (i + 1)))
    }
  }
  throw lastErr
}

// ── Warmup: pre-heat connection + prompt cache ──
async function warmup(config = {}) {
  const { provider = 'anthropic', apiKey, baseUrl, model, system, tools = [], proxyUrl, providers } = config
  if (!apiKey && (!providers || !providers.length)) {
    console.warn('[warmup] No API key, skipping')
    return { ok: false, reason: 'no_api_key' }
  }

  const t0 = Date.now()
  const { defs: toolDefs } = buildToolDefs(tools)

  // Build minimal request: system + tools + trivial prompt, max_tokens=1
  const warmupSystem = toolDefs.length > 0
    ? (system ? EAGER_HINT + '\n\n' + system : EAGER_HINT)
    : system

  try {
    if (provider === 'anthropic') {
      const base = (baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')
      const url = base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`
      const headers = {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31'
      }
      const body = {
        model: model || 'claude-sonnet-4',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
      }
      if (warmupSystem) {
        body.system = [{ type: 'text', text: warmupSystem, cache_control: { type: 'ephemeral' } }]
      }
      if (toolDefs.length) {
        body.tools = toolDefs.map((t, i) => i === toolDefs.length - 1
          ? { ...t, cache_control: { type: 'ephemeral' } }
          : t
        )
      }

      const fetchUrl = proxyUrl || url
      const fetchHeaders = proxyUrl
        ? { ...headers, 'x-base-url': baseUrl || 'https://api.anthropic.com', 'x-provider': 'anthropic' }
        : headers

      const resp = await fetch(fetchUrl, {
        method: 'POST',
        headers: fetchHeaders,
        body: JSON.stringify(body),
      })
      const data = await resp.json()
      const ms = Date.now() - t0
      const cacheCreated = data.usage?.cache_creation_input_tokens || 0
      const cacheHit = data.usage?.cache_read_input_tokens || 0
      console.log(`[warmup] Anthropic ${ms}ms — cache_created: ${cacheCreated}, cache_hit: ${cacheHit}`)
      return { ok: true, ms, cacheCreated, cacheHit, provider: 'anthropic' }
    } else {
      // OpenAI-compatible: just do a connection warmup (no prompt caching)
      const base = (baseUrl || 'https://api.openai.com').replace(/\/+$/, '')
      const url = base.includes('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`
      const body = {
        model: model || 'gpt-4',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
      }
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      })
      await resp.json()
      const ms = Date.now() - t0
      console.log(`[warmup] OpenAI ${ms}ms (connection only)`)
      return { ok: true, ms, provider: 'openai' }
    }
  } catch (err) {
    const ms = Date.now() - t0
    console.warn(`[warmup] Failed in ${ms}ms:`, err.message)
    return { ok: false, ms, error: err.message }
  }
}

// ── agenticStep: single-turn LLM call, caller controls tool loop ──
// Returns { text, toolCalls, messages, done } — caller executes tools and calls step() again
async function agenticStep(messages, config) {
  const { provider = 'anthropic', baseUrl, apiKey, model, tools = [], proxyUrl, stream = false, system, signal, providers, emit: emitFn, maxTokens } = config

  if (!apiKey && (!providers || !providers.length)) throw new Error('API Key required')

  // Build tool defs from tool objects (same format as think() tools)
  // tools can be: array of {name, description, input_schema, execute} or string names
  let toolDefs = []
  if (tools.length > 0 && typeof tools[0] === 'object' && tools[0].name) {
    // Custom tool objects — convert to provider format
    toolDefs = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema || { type: 'object', properties: {} }
    }))
  } else if (tools.length > 0 && typeof tools[0] === 'string') {
    // Built-in tool names — use buildToolDefs
    const built = buildToolDefs(tools)
    toolDefs = built.defs
  }

  const emit = emitFn || (() => {})
  let response
  let text = ''

  if (stream) {
    // Streaming: yield tokens, collect response
    try {
      const streamGen = _streamCallWithFailover({ messages, tools: toolDefs, model, baseUrl, apiKey, proxyUrl, system, provider, signal, providers, maxTokens })
      for await (const evt of streamGen) {
        if (evt.type === 'text_delta') {
          text += evt.text
          emit('token', { text: evt.text })
        } else if (evt.type === 'response') {
          response = evt
        }
      }
    } catch (err) {
      throw err
    }
  } else {
    try {
      response = await _callWithFailover({ messages, tools: toolDefs, model, baseUrl, apiKey, proxyUrl, stream: false, system, provider, signal, providers, maxTokens })
      text = response.content || ''
    } catch (err) {
      throw err
    }
  }

  const toolCalls = response.tool_calls || []
  const done = ['end_turn', 'stop'].includes(response.stop_reason) || toolCalls.length === 0

  // Build updated messages array (append assistant message)
  const updatedMessages = [...messages]
  if (toolCalls.length > 0) {
    updatedMessages.push({ role: 'assistant', content: text || '', tool_calls: toolCalls })
  } else if (text) {
    updatedMessages.push({ role: 'assistant', content: text })
  }

  return {
    text,
    toolCalls: toolCalls.map(tc => ({ id: tc.id, name: tc.name, input: tc.input })),
    messages: updatedMessages,
    done,
    stopReason: response.stop_reason
  }
}

// Helper: build tool result message for pushing back into messages after executing tools
function buildToolResults(toolCalls, results) {
  return toolCalls.map((tc, i) => {
    const result = results[i]
    const content = result.error
      ? JSON.stringify({ error: result.error })
      : JSON.stringify(result.output ?? result)
    return { role: 'tool', tool_call_id: tc.id, content }
  })
}

  return { agenticAsk, agenticStep, buildToolResults, warmup, classifyError, toolRegistry, synthesize, transcribe, registerProvider, unregisterProvider }
})


// ═══ agentic-store.js ═══
/**
 * agentic-store — Key-value persistence for agentic apps
 * SQLite-first. Browser (sql.js/WASM) + Node.js (better-sqlite3).
 *
 * Usage:
 *   import { createStore } from 'agentic-store'
 *
 *   const store = await createStore('my-app')
 *   await store.set('key', { any: 'data' })
 *   const data = await store.get('key')
 *   await store.delete('key')
 *   await store.keys()
 *   await store.clear()
 *
 * Also exposes raw SQL for advanced use:
 *   store.exec('CREATE TABLE IF NOT EXISTS items (id TEXT, data JSON)')
 *   store.run('INSERT INTO items VALUES (?, ?)', [id, json])
 *   store.all('SELECT * FROM items WHERE id = ?', [id])
 *
 * Backends:
 *   'sqlite-wasm' — Browser (sql.js), persists to IndexedDB
 *   'sqlite-native' — Node.js (better-sqlite3), persists to file
 *   'sqlite-memory' — In-memory SQLite (testing)
 *   'ls' — localStorage fallback (no SQLite available)
 *   'mem' — Plain JS Map (last resort)
 *   'custom' — Bring your own { get, set, delete, keys, clear, has }
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else if (typeof define === 'function' && define.amd) define(factory)
  else root.AgenticStore = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const KV_TABLE = '_kv'
  const KV_DDL = `CREATE TABLE IF NOT EXISTS ${KV_TABLE} (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)`

  // ── SQLite WASM backend (browser, sql.js) ────────────────────────

  function sqliteWasmBackend(name) {
    let db = null
    let SQL = null
    const IDB_KEY = 'agentic-store-' + name

    async function _idbLoad() {
      return new Promise((resolve) => {
        try {
          const req = indexedDB.open(IDB_KEY, 1)
          req.onupgradeneeded = () => req.result.createObjectStore('db')
          req.onsuccess = () => {
            const tx = req.result.transaction('db', 'readonly')
            const get = tx.objectStore('db').get('data')
            get.onsuccess = () => { req.result.close(); resolve(get.result || null) }
            get.onerror = () => { req.result.close(); resolve(null) }
          }
          req.onerror = () => resolve(null)
        } catch { resolve(null) }
      })
    }

    async function _idbSave() {
      if (!db) return
      const data = db.export()
      return new Promise((resolve) => {
        try {
          const req = indexedDB.open(IDB_KEY, 1)
          req.onupgradeneeded = () => req.result.createObjectStore('db')
          req.onsuccess = () => {
            const tx = req.result.transaction('db', 'readwrite')
            tx.objectStore('db').put(data, 'data')
            tx.oncomplete = () => { req.result.close(); resolve() }
            tx.onerror = () => { req.result.close(); resolve() }
          }
          req.onerror = () => resolve()
        } catch { resolve() }
      })
    }

    let _saveTimer = null
    function _debounceSave() {
      if (_saveTimer) clearTimeout(_saveTimer)
      _saveTimer = setTimeout(() => { _idbSave(); _saveTimer = null }, 300)
    }

    return {
      async init() {
        if (!SQL) {
          // sql.js must be loaded externally (CDN or bundled)
          if (typeof initSqlJs === 'function') {
            SQL = await initSqlJs()
          } else if (typeof root !== 'undefined' && root.initSqlJs) {
            SQL = await root.initSqlJs()
          } else {
            throw new Error('sql.js not found. Load it via <script src="https://sql.js.org/dist/sql-wasm.js"> or import.')
          }
        }
        const saved = await _idbLoad()
        db = saved ? new SQL.Database(saved) : new SQL.Database()
        db.run(KV_DDL)
      },
      exec(sql, params) { db.run(sql, params); _debounceSave() },
      run(sql, params) { db.run(sql, params); _debounceSave() },
      all(sql, params) {
        const stmt = db.prepare(sql)
        if (params) stmt.bind(params)
        const rows = []
        while (stmt.step()) rows.push(stmt.getAsObject())
        stmt.free()
        return rows
      },
      get(sql, params) {
        const rows = this.all(sql, params)
        return rows.length > 0 ? rows[0] : undefined
      },

      // KV convenience
      async kvGet(key) {
        const row = this.get(`SELECT value FROM ${KV_TABLE} WHERE key = ?`, [key])
        if (!row) return undefined
        try { return JSON.parse(row.value) } catch { return row.value }
      },
      async kvSet(key, value) {
        this.run(
          `INSERT OR REPLACE INTO ${KV_TABLE} (key, value, updated_at) VALUES (?, ?, ?)`,
          [key, JSON.stringify(value), Date.now()]
        )
      },
      async kvDelete(key) { this.run(`DELETE FROM ${KV_TABLE} WHERE key = ?`, [key]) },
      async kvKeys() { return this.all(`SELECT key FROM ${KV_TABLE}`).map(r => r.key) },
      async kvClear() { this.run(`DELETE FROM ${KV_TABLE}`) },
      async kvHas(key) {
        const row = this.get(`SELECT 1 FROM ${KV_TABLE} WHERE key = ?`, [key])
        return !!row
      },
      async flush() { await _idbSave() },
      async close() {
        if (_saveTimer) { clearTimeout(_saveTimer); await _idbSave() }
        if (db) { db.close(); db = null }
      },
    }
  }

  // ── SQLite native backend (Node.js, better-sqlite3) ──────────────

  function sqliteNativeBackend(filePath) {
    let db = null

    return {
      async init() {
        const Database = require('better-sqlite3')
        const path = require('path')
        const fs = require('fs')
        // Ensure directory exists
        const dir = path.dirname(filePath)
        fs.mkdirSync(dir, { recursive: true })
        db = new Database(filePath)
        db.pragma('journal_mode = WAL')
        db.exec(KV_DDL)
      },
      exec(sql, params) { params ? db.prepare(sql).run(...(Array.isArray(params) ? params : [params])) : db.exec(sql) },
      run(sql, params) { db.prepare(sql).run(...(Array.isArray(params) ? params : [])) },
      all(sql, params) { return db.prepare(sql).all(...(Array.isArray(params) ? params : [])) },
      get(sql, params) { return db.prepare(sql).get(...(Array.isArray(params) ? params : [])) },

      // KV convenience
      async kvGet(key) {
        const row = db.prepare(`SELECT value FROM ${KV_TABLE} WHERE key = ?`).get(key)
        if (!row) return undefined
        try { return JSON.parse(row.value) } catch { return row.value }
      },
      async kvSet(key, value) {
        db.prepare(`INSERT OR REPLACE INTO ${KV_TABLE} (key, value, updated_at) VALUES (?, ?, ?)`)
          .run(key, JSON.stringify(value), Date.now())
      },
      async kvDelete(key) { db.prepare(`DELETE FROM ${KV_TABLE} WHERE key = ?`).run(key) },
      async kvKeys() { return db.prepare(`SELECT key FROM ${KV_TABLE}`).all().map(r => r.key) },
      async kvClear() { db.prepare(`DELETE FROM ${KV_TABLE}`).run() },
      async kvHas(key) { return !!db.prepare(`SELECT 1 FROM ${KV_TABLE} WHERE key = ?`).get(key) },
      async flush() {},
      async close() { if (db) { db.close(); db = null } },
    }
  }

  // ── SQLite in-memory backend (testing) ───────────────────────────

  function sqliteMemoryBackend() {
    let db = null

    return {
      async init() {
        // Try better-sqlite3 (Node.js)
        try {
          const Database = require('better-sqlite3')
          db = new Database(':memory:')
          db.exec(KV_DDL)
          return
        } catch { /* not available */ }
        // Try sql.js (browser/WASM)
        try {
          let SQL
          if (typeof initSqlJs === 'function') SQL = await initSqlJs()
          else if (typeof globalThis !== 'undefined' && globalThis.initSqlJs) SQL = await globalThis.initSqlJs()
          if (SQL) { db = new SQL.Database(); db.run(KV_DDL); return }
        } catch { /* not available */ }
        throw new Error('No SQLite engine found (need better-sqlite3 or sql.js)')
      },
      exec(sql, params) {
        if (db.exec && !db.prepare) { db.run(sql, params) } // sql.js
        else { params ? db.prepare(sql).run(...(Array.isArray(params) ? params : [params])) : db.exec(sql) }
      },
      run(sql, params) { this.exec(sql, params) },
      all(sql, params) {
        if (db.prepare && db.prepare(sql).all) {
          return db.prepare(sql).all(...(Array.isArray(params) ? params : []))
        }
        // sql.js path
        const stmt = db.prepare(sql)
        if (params) stmt.bind(params)
        const rows = []
        while (stmt.step()) rows.push(stmt.getAsObject())
        stmt.free()
        return rows
      },
      get(sql, params) {
        const rows = this.all(sql, params)
        return rows.length > 0 ? rows[0] : undefined
      },
      async kvGet(key) {
        const row = this.get(`SELECT value FROM ${KV_TABLE} WHERE key = ?`, [key])
        if (!row) return undefined
        try { return JSON.parse(row.value) } catch { return row.value }
      },
      async kvSet(key, value) {
        this.run(
          `INSERT OR REPLACE INTO ${KV_TABLE} (key, value, updated_at) VALUES (?, ?, ?)`,
          [key, JSON.stringify(value), Date.now()]
        )
      },
      async kvDelete(key) { this.run(`DELETE FROM ${KV_TABLE} WHERE key = ?`, [key]) },
      async kvKeys() { return this.all(`SELECT key FROM ${KV_TABLE}`).map(r => r.key) },
      async kvClear() { this.run(`DELETE FROM ${KV_TABLE}`) },
      async kvHas(key) { return !!this.get(`SELECT 1 FROM ${KV_TABLE} WHERE key = ?`, [key]) },
      async flush() {},
      async close() { if (db) { db.close(); db = null } },
    }
  }

  // ── File system backend (Node.js, zero deps) ─────────────────────

  function fsBackend(dir) {
    const fs = require('fs')
    const path = require('path')
    fs.mkdirSync(dir, { recursive: true })
    function fp(key) { return path.join(dir, encodeURIComponent(key) + '.json') }
    return {
      async init() {},
      async kvGet(key) { try { return JSON.parse(fs.readFileSync(fp(key), 'utf8')) } catch { return undefined } },
      async kvSet(key, value) { fs.writeFileSync(fp(key), JSON.stringify(value)) },
      async kvDelete(key) { try { fs.unlinkSync(fp(key)) } catch {} },
      async kvKeys() { try { return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => decodeURIComponent(f.slice(0, -5))) } catch { return [] } },
      async kvClear() { try { for (const f of fs.readdirSync(dir)) { if (f.endsWith('.json')) fs.unlinkSync(path.join(dir, f)) } } catch {} },
      async kvHas(key) { return fs.existsSync(fp(key)) },
      async flush() {},
      async close() {},
    }
  }

  // ── IndexedDB kv backend (browser, no sql.js needed) ──────────────

  function idbBackend(dbName) {
    const STORE_NAME = 'kv'
    let _db = null

    function open() {
      if (_db) return Promise.resolve(_db)
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName, 1)
        req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME)
        req.onsuccess = () => { _db = req.result; resolve(_db) }
        req.onerror = () => reject(req.error)
      })
    }
    function tx(mode) { return open().then(db => db.transaction(STORE_NAME, mode).objectStore(STORE_NAME)) }
    function wrap(req) { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) }) }

    return {
      async init() { await open() },
      async kvGet(key) { return wrap((await tx('readonly')).get(key)) },
      async kvSet(key, value) { await wrap((await tx('readwrite')).put(value, key)) },
      async kvDelete(key) { await wrap((await tx('readwrite')).delete(key)) },
      async kvKeys() { return wrap((await tx('readonly')).getAllKeys()) },
      async kvClear() { await wrap((await tx('readwrite')).clear()) },
      async kvHas(key) { return (await wrap((await tx('readonly')).count(key))) > 0 },
      async flush() {},
      async close() { if (_db) { _db.close(); _db = null } },
    }
  }

  // ── localStorage fallback (no SQLite) ────────────────────────────

  function lsBackend(prefix) {
    const pfx = prefix + ':'
    return {
      async init() {},
      async kvGet(key) {
        try {
          const raw = localStorage.getItem(pfx + key)
          return raw != null ? JSON.parse(raw) : undefined
        } catch { return undefined }
      },
      async kvSet(key, value) { localStorage.setItem(pfx + key, JSON.stringify(value)) },
      async kvDelete(key) { localStorage.removeItem(pfx + key) },
      async kvKeys() {
        const result = []
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (k.startsWith(pfx)) result.push(k.slice(pfx.length))
        }
        return result
      },
      async kvClear() {
        const toRemove = []
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (k.startsWith(pfx)) toRemove.push(k)
        }
        toRemove.forEach(k => localStorage.removeItem(k))
      },
      async kvHas(key) { return localStorage.getItem(pfx + key) != null },
      async flush() {},
      async close() {},
    }
  }

  // ── In-memory fallback ───────────────────────────────────────────

  function memBackend() {
    const data = new Map()
    return {
      async init() {},
      async kvGet(key) { return data.has(key) ? structuredClone(data.get(key)) : undefined },
      async kvSet(key, value) { data.set(key, structuredClone(value)) },
      async kvDelete(key) { data.delete(key) },
      async kvKeys() { return [...data.keys()] },
      async kvClear() { data.clear() },
      async kvHas(key) { return data.has(key) },
      async flush() {},
      async close() { data.clear() },
    }
  }

  // ── Factory ──────────────────────────────────────────────────────

  function detectBackend() {
    // Node.js — try better-sqlite3 first, then plain fs
    if (typeof require !== 'undefined') {
      try { require('better-sqlite3'); return 'sqlite-native' } catch {}
      try { require('fs'); return 'fs' } catch {}
    }
    // Browser — try sql.js
    if (typeof initSqlJs === 'function' ||
        (typeof globalThis !== 'undefined' && globalThis.initSqlJs)) {
      return 'sqlite-wasm'
    }
    // Browser — IndexedDB kv (no sql.js needed)
    if (typeof indexedDB !== 'undefined') {
      return 'idb'
    }
    // localStorage
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('__agentic_store_probe__', '1')
        localStorage.removeItem('__agentic_store_probe__')
        return 'ls'
      } catch {}
    }
    return 'mem'
  }

  /**
   * Create a namespaced key-value store.
   * Returns a Promise (async init for SQLite WASM).
   *
   * @param {string} name - Namespace
   * @param {object} [opts] - Options
   * @param {string} [opts.backend] - Force backend
   * @param {string} [opts.path] - File path for sqlite-native
   * @param {object} [opts.custom] - Custom backend
   * @returns {Promise<object>} Store
   */
  async function createStore(name, opts = {}) {
    // Custom backend
    if (opts.custom) {
      const c = opts.custom
      if (c.init) await c.init()
      return {
        get: (k) => c.kvGet ? c.kvGet(k) : c.get(k),
        set: (k, v) => c.kvSet ? c.kvSet(k, v) : c.set(k, v),
        delete: (k) => c.kvDelete ? c.kvDelete(k) : c.delete(k),
        keys: () => c.kvKeys ? c.kvKeys() : c.keys(),
        clear: () => c.kvClear ? c.kvClear() : c.clear(),
        has: (k) => c.kvHas ? c.kvHas(k) : c.has(k),
        flush: () => c.flush ? c.flush() : Promise.resolve(),
        close: () => c.close ? c.close() : Promise.resolve(),
        // Raw SQL if available
        exec: c.exec ? (sql, p) => c.exec(sql, p) : undefined,
        run: c.run ? (sql, p) => c.run(sql, p) : undefined,
        all: c.all ? (sql, p) => c.all(sql, p) : undefined,
        sql: c.get && c.exec ? (sql, p) => c.get(sql, p) : undefined,
        get backend() { return 'custom' },
      }
    }

    const backendType = opts.backend || detectBackend()
    let b

    switch (backendType) {
      case 'sqlite-wasm':
        b = sqliteWasmBackend(name)
        break
      case 'sqlite-native': {
        const filePath = opts.path || require('path').join(
          require('os').homedir(), '.agentic-store', name + '.db'
        )
        b = sqliteNativeBackend(filePath)
        break
      }
      case 'sqlite-memory':
        b = sqliteMemoryBackend()
        break
      case 'idb':
        b = idbBackend('agentic-store-' + name)
        break
      case 'fs': {
        const dir = opts.dir || require('path').join(
          require('os').homedir(), '.agentic-store', name
        )
        b = fsBackend(dir)
        break
      }
      case 'ls':
        b = lsBackend('agentic-store-' + name)
        break
      case 'mem':
        b = memBackend()
        break
      default:
        throw new Error(`Unknown backend: ${backendType}`)
    }

    await b.init()

    const store = {
      // KV API (always available)
      get: (k) => b.kvGet(k),
      set: (k, v) => b.kvSet(k, v),
      delete: (k) => b.kvDelete(k),
      keys: () => b.kvKeys(),
      clear: () => b.kvClear(),
      has: (k) => b.kvHas(k),
      flush: () => b.flush(),
      close: () => b.close(),
      get backend() { return backendType },
    }

    // Raw SQL (only for SQLite backends)
    if (b.exec) {
      store.exec = (sql, params) => b.exec(sql, params)
      store.run = (sql, params) => b.run(sql, params)
      store.all = (sql, params) => b.all(sql, params)
      store.sql = (sql, params) => b.get(sql, params)
    }

    return store
  }

  return { createStore }
})


// ═══ agentic-shell.js ═══
"use strict";
var AgenticShellBrowser = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/browser.ts
  var browser_exports = {};
  __export(browser_exports, {
    AgenticShell: () => AgenticShell,
    MemFS: () => MemFS,
    createBrowserShell: () => createBrowserShell
  });

  // src/index.ts
  function isStreamable(fs) {
    return typeof fs.readStream === "function";
  }
  var AgenticShell = class {
    constructor(fs) {
      this.fs = fs;
      const required = ["read", "write", "ls", "delete", "grep"];
      const missing = required.filter((m) => typeof fs[m] !== "function");
      if (missing.length) throw new Error(`AgenticShell: fs missing required methods: ${missing.join(", ")}`);
      this.env.set("HOME", "/");
      this.env.set("PWD", this.cwd);
      this.env.set("PATH", "/usr/bin:/bin");
    }
    fs;
    cwd = "/";
    env = /* @__PURE__ */ new Map();
    jobs = /* @__PURE__ */ new Map();
    nextJobId = 1;
    setEnv(key, value) {
      this.env.set(key, value);
    }
    getCwd() {
      return this.cwd;
    }
    substituteEnv(cmd) {
      return cmd.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, n) => this.env.get(n) ?? "").replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, n) => this.env.get(n) ?? "");
    }
    async substituteCommands(cmd, depth = 0, maxDepth = 3) {
      if (depth >= maxDepth) return cmd;
      let result = cmd;
      while (true) {
        const start = result.indexOf("$(");
        if (start === -1) break;
        let pdepth = 0, end = -1;
        for (let i = start + 1; i < result.length; i++) {
          if (result[i] === "(") pdepth++;
          else if (result[i] === ")") {
            pdepth--;
            if (pdepth === 0) {
              end = i;
              break;
            }
          }
        }
        if (end === -1) break;
        const inner = result.slice(start + 2, end);
        const r = await this.exec(inner, depth + 1);
        result = result.slice(0, start) + (r.exitCode === 0 ? r.output.trim() : "") + result.slice(end + 1);
      }
      while (true) {
        const start = result.indexOf("`");
        if (start === -1) break;
        const end = result.indexOf("`", start + 1);
        if (end === -1) break;
        const inner = result.slice(start + 1, end);
        const r = await this.exec(inner, depth + 1);
        result = result.slice(0, start) + (r.exitCode === 0 ? r.output.trim() : "") + result.slice(end + 1);
      }
      return result;
    }
    getEnv(key) {
      return this.env.get(key);
    }
    isBackground(cmd) {
      const trimmed = cmd.trimEnd();
      if (trimmed.endsWith("&")) return [true, trimmed.slice(0, -1).trimEnd()];
      return [false, cmd];
    }
    async exec(command, depth = 0) {
      const afterEnv = this.substituteEnv(command.trim());
      const substituted = await this.substituteCommands(afterEnv, depth);
      const [isBg, cleanCmd] = this.isBackground(substituted);
      if (isBg) {
        if (!cleanCmd) return { output: "exec: missing command", exitCode: 1 };
        const id = this.nextJobId++;
        const promise = this.execPipeline(cleanCmd).then((result) => {
          this.jobs.get(id).status = "done";
          return result;
        });
        this.jobs.set(id, { id, command: cleanCmd, status: "running", promise });
        return { output: `[${id}] ${id}`, exitCode: 0 };
      }
      return this.execPipeline(substituted);
    }
    async execPipeline(command) {
      const trimmed = command;
      if (!trimmed) return { output: "", exitCode: 0 };
      const assignMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/);
      if (assignMatch) {
        this.env.set(assignMatch[1], assignMatch[2]);
        return { output: "", exitCode: 0 };
      }
      const inputMatch = trimmed.match(/^(.+?)\s+<\s+(\S+)((?:\s*>>?\s*\S+)?)$/);
      if (inputMatch) {
        const lhs = inputMatch[1].trim();
        const redirectFile = this.resolve(inputMatch[2]);
        const remainder = inputMatch[3].trim();
        if (!lhs) return { output: "bash: syntax error near unexpected token `<'", exitCode: 1 };
        const r = await this.fs.read(redirectFile);
        if (r.error) return { output: `bash: ${inputMatch[2]}: No such file or directory`, exitCode: 1 };
        const stdin = r.content ?? "";
        const cmdOutput = await this.execWithStdin(lhs, stdin);
        const lhsCmd = lhs.trim().split(/\s+/)[0];
        const exitCode2 = lhsCmd === "grep" && cmdOutput === "" ? 1 : this.exitCodeFor(cmdOutput);
        if (remainder) {
          const appendRem = remainder.match(/^>>\s*(\S+)$/);
          const writeRem = remainder.match(/^>\s*(\S+)$/);
          if (appendRem) {
            const outPath = this.resolve(appendRem[1]);
            const werr = this.checkWritable("bash", outPath);
            if (werr) return { output: werr, exitCode: 1 };
            const existing = await this.fs.read(outPath);
            const current = existing.error ? "" : existing.content ?? "";
            await this.fs.write(outPath, current + cmdOutput + "\n");
            return { output: "", exitCode: 0 };
          } else if (writeRem) {
            const outPath = this.resolve(writeRem[1]);
            const werr = this.checkWritable("bash", outPath);
            if (werr) return { output: werr, exitCode: 1 };
            await this.fs.write(outPath, cmdOutput + "\n");
            return { output: "", exitCode: 0 };
          }
        }
        return { output: cmdOutput, exitCode: exitCode2 };
      }
      const appendMatch = trimmed.match(/^(.+?)>>\s*(\S+)$/);
      if (appendMatch) {
        const lhs = appendMatch[1].trim();
        const filePath = this.resolve(appendMatch[2]);
        const werr = this.checkWritable("echo", filePath);
        if (werr) return { output: werr, exitCode: 1 };
        const output2 = await this.execSingle(lhs);
        const exitCode2 = this.exitCodeFor(output2);
        if (exitCode2 !== 0) return { output: output2, exitCode: exitCode2 };
        const existing = await this.fs.read(filePath);
        const current = existing.error ? "" : existing.content ?? "";
        await this.fs.write(filePath, current + output2 + "\n");
        return { output: "", exitCode: 0 };
      }
      const writeMatch = trimmed.match(/^(.+?)>\s*(\S+)$/);
      if (writeMatch) {
        const lhs = writeMatch[1].trim();
        const filePath = this.resolve(writeMatch[2]);
        const werr = this.checkWritable("echo", filePath);
        if (werr) return { output: werr, exitCode: 1 };
        const output2 = await this.execSingle(lhs);
        const exitCode2 = this.exitCodeFor(output2);
        if (exitCode2 !== 0) return { output: output2, exitCode: exitCode2 };
        await this.fs.write(filePath, output2 + "\n");
        return { output: "", exitCode: 0 };
      }
      if (trimmed.includes(" | ")) {
        const segments = trimmed.split(" | ");
        let output2 = "";
        let exitCode2 = 0;
        for (let i = 0; i < segments.length; i++) {
          if (i === 0) {
            const execResult = await this.execSingleWithError(segments[i].trim());
            output2 = execResult.output;
            if (execResult.hadError) {
              exitCode2 = this.exitCodeFor(output2);
              output2 = "";
            }
          } else {
            output2 = await this.execWithStdin(segments[i].trim(), output2);
            const segCmd = segments[i].trim().split(/\s+/)[0];
            if (exitCode2 === 0) {
              if (segCmd === "grep" && output2 === "") exitCode2 = 1;
              else if (this.isErrorOutput(output2)) exitCode2 = this.exitCodeFor(output2);
            }
          }
        }
        if (exitCode2 === 0) exitCode2 = this.exitCodeFor(output2);
        return { output: output2, exitCode: exitCode2 };
      }
      const output = await this.execSingle(trimmed);
      const cmd = trimmed.split(/\s+/)[0];
      const exitCode = cmd === "grep" && output === "" ? 1 : this.exitCodeFor(output);
      return { output, exitCode };
    }
    async jobs_cmd(_args) {
      if (this.jobs.size === 0) return "";
      return [...this.jobs.values()].map((j) => `[${j.id}] ${j.status.padEnd(9)} ${j.command}`).join("\n");
    }
    async fg(args) {
      let id;
      if (!args[0]) {
        id = Math.max(...this.jobs.keys());
        if (!isFinite(id)) return "fg: current: no such job";
      } else {
        id = parseInt(args[0].replace("%", ""));
      }
      if (isNaN(id) || !this.jobs.has(id)) return `fg: ${args[0] ?? ""}: no such job`;
      const job = this.jobs.get(id);
      const result = await job.promise;
      this.jobs.delete(id);
      return result.output;
    }
    async bg(args) {
      const id = parseInt((args[0] ?? "").replace("%", ""));
      if (isNaN(id) || !this.jobs.has(id)) return `bg: ${args[0] ?? ""}: no such job`;
      return "";
    }
    exitCodeFor(output) {
      const first = output.trimStart().split("\n")[0];
      if (/\bcommand not found\b/.test(first)) return 2;
      if (/\b(missing operand|missing pattern|Invalid regular expression)\b/.test(first)) return 2;
      if (/^\w[\w-]*: .+: .+/.test(first)) return 1;
      return 0;
    }
    async execSingle(command) {
      const parts = this.parseArgs(command);
      const [cmd, ...args] = parts;
      switch (cmd) {
        case "ls":
          return this.ls(args);
        case "cat":
          return this.cat(args);
        case "grep":
          return this.grep(args);
        case "find":
          return this.find(args);
        case "pwd":
          return this.cwd;
        case "cd":
          return this.cd(args[0]);
        case "mkdir":
          return this.mkdir(args);
        case "rm":
          return this.rm(args);
        case "mv":
          return this.mv(args);
        case "cp":
          return this.cp(args);
        case "echo":
          return args.join(" ");
        case "export": {
          const expr = args.join(" ");
          const m = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
          if (m) {
            this.env.set(m[1], m[2]);
            return "";
          }
          return "export: not supported";
        }
        case "touch":
          return this.touch(args[0]);
        case "head":
          return this.head(args);
        case "tail":
          return this.tail(args);
        case "wc":
          return this.wc(args);
        case "jobs":
          return this.jobs_cmd(args);
        case "fg":
          return this.fg(args);
        case "bg":
          return this.bg(args);
        default:
          return `${cmd}: command not found`;
      }
    }
    async execSingleWithError(command) {
      const parts = this.parseArgs(command);
      const [cmd, ...args] = parts;
      switch (cmd) {
        case "cat": {
          const expanded = await this.expandPathArgs(args);
          const paths = expanded.filter((a) => !a.startsWith("-"));
          if (!paths.length) return { output: "cat: missing operand", hadError: true };
          const results = await Promise.all(paths.map(async (p) => {
            if (/[*?]/.test(p)) return { text: `cat: ${p}: No such file or directory`, err: true };
            const r = await this.fs.read(this.resolve(p));
            return r.error ? { text: this.fsError("cat", p, r.error), err: true } : { text: r.content ?? "", err: false };
          }));
          const hadError = results.some((r) => r.err);
          return { output: results.map((r) => r.text).join("\n"), hadError };
        }
        case "echo":
          return { output: args.join(" "), hadError: false };
        case "pwd":
          return { output: this.cwd, hadError: false };
        default: {
          const output = await this.execSingle(command);
          return { output, hadError: this.isErrorOutput(output) };
        }
      }
    }
    async execWithStdin(command, stdin) {
      const parts = this.parseArgs(command);
      const [cmd, ...args] = parts;
      if (cmd === "wc") {
        const flags = args.filter((a) => a.startsWith("-"));
        const lines = stdin === "" ? 0 : stdin.split("\n").length;
        const words = stdin.split(/\s+/).filter(Boolean).length;
        const chars = stdin.length;
        if (flags.includes("-l")) return String(lines);
        if (flags.includes("-w")) return String(words);
        if (flags.includes("-c")) return String(chars);
        return `${lines}	${words}	${chars}`;
      }
      if (cmd === "grep") {
        const rawFlags = args.filter((a) => a.startsWith("-"));
        const rest = args.filter((a) => !a.startsWith("-"));
        const flags = [];
        for (const f of rawFlags) {
          if (f.length > 2 && f.startsWith("-")) {
            for (let i = 1; i < f.length; i++) flags.push("-" + f[i]);
          } else {
            flags.push(f);
          }
        }
        const [pattern] = rest;
        if (!pattern) return "grep: missing pattern";
        const caseInsensitive = flags.includes("-i");
        let regex;
        try {
          regex = new RegExp(pattern, caseInsensitive ? "i" : "");
        } catch {
          return `grep: ${pattern}: Invalid regular expression`;
        }
        const lines = stdin.split("\n").filter((l) => regex.test(l));
        if (!lines.length) return "";
        if (flags.includes("-l")) return lines.length ? "(stdin)" : "";
        if (flags.includes("-c")) return String(lines.length);
        return lines.join("\n");
      }
      return this.execSingle(command);
    }
    checkWritable(cmd, path) {
      if (this.fs.readOnly === true) return `${cmd}: ${path}: Permission denied`;
      return null;
    }
    isErrorOutput(output) {
      return /^\w+: .+: .+/.test(output.trimStart().split("\n")[0]);
    }
    fsError(cmd, path, err) {
      if (err?.toLowerCase().includes("not found") || err?.toLowerCase().includes("no such"))
        return `${cmd}: ${path}: No such file or directory`;
      return `${cmd}: ${path}: ${err}`;
    }
    normalizePath(path) {
      const parts = path.split("/").filter(Boolean);
      const stack = [];
      for (const part of parts) {
        if (part === "..") {
          if (stack.length) stack.pop();
        } else if (part !== ".") stack.push(part);
      }
      return "/" + stack.join("/");
    }
    resolve(path) {
      if (!path || path === ".") return this.cwd;
      const raw = path.startsWith("/") ? path : (this.cwd === "/" ? "" : this.cwd) + "/" + path;
      return this.normalizePath(raw);
    }
    parseArgs(cmd) {
      const parts = [];
      let cur = "", inQ = false, q = "";
      for (const ch of cmd) {
        if (inQ) {
          if (ch === q) inQ = false;
          else cur += ch;
        } else if (ch === '"' || ch === "'") {
          inQ = true;
          q = ch;
        } else if (ch === " ") {
          if (cur) {
            parts.push(cur);
            cur = "";
          }
        } else cur += ch;
      }
      if (cur) parts.push(cur);
      return parts;
    }
    matchGlob(name, pattern) {
      let re = "";
      let i = 0;
      while (i < pattern.length) {
        const ch = pattern[i];
        if (ch === "[") {
          const close = pattern.indexOf("]", i + 1);
          if (close !== -1) {
            let bracket = pattern.slice(i, close + 1);
            if (bracket.length > 3 && bracket[1] === "!") {
              bracket = "[^" + bracket.slice(2);
            }
            re += bracket;
            i = close + 1;
            continue;
          }
        }
        if (ch === "*") {
          re += ".*";
          i++;
          continue;
        }
        if (ch === "?") {
          re += ".";
          i++;
          continue;
        }
        re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        i++;
      }
      return new RegExp("^" + re + "$").test(name);
    }
    async expandRecursiveGlob(baseDir, pattern) {
      const results = [];
      const visited = /* @__PURE__ */ new Set();
      const stack = [baseDir];
      while (stack.length) {
        const dir = stack.pop();
        if (visited.has(dir)) continue;
        visited.add(dir);
        let entries;
        try {
          entries = await this.fs.ls(dir);
        } catch {
          continue;
        }
        for (const e of entries) {
          const fullPath = dir === "/" ? "/" + e.name : dir + "/" + e.name;
          if (e.type === "dir") {
            stack.push(fullPath);
          }
          if (this.matchGlob(e.name, pattern)) {
            results.push(fullPath);
          }
        }
      }
      return results;
    }
    async expandGlob(pattern, dir) {
      if (!/[*?[]/.test(pattern)) return [pattern];
      const doubleStarIdx = pattern.indexOf("**");
      if (doubleStarIdx !== -1) {
        const before = pattern.slice(0, doubleStarIdx).replace(/\/$/, "");
        const after = pattern.slice(doubleStarIdx + 2).replace(/^\//, "");
        const baseDir = before ? this.resolve(before) : dir;
        const matchPattern = after || "*";
        return this.expandRecursiveGlob(baseDir, matchPattern);
      }
      const entries = await this.fs.ls(dir);
      return entries.filter((e) => e.type === "file" && this.matchGlob(e.name, pattern)).map((e) => dir === "/" ? "/" + e.name : dir + "/" + e.name);
    }
    async expandPathArgs(args) {
      const result = [];
      for (const a of args) {
        if (a.startsWith("-") || !/[*?[]/.test(a)) {
          result.push(a);
          continue;
        }
        const matches = await this.expandGlob(a, this.cwd);
        if (matches.length) result.push(...matches);
        else result.push(a);
      }
      return result;
    }
    async ls(args) {
      const long = args.includes("-l") || args.includes("-la") || args.includes("-al");
      const all = args.includes("-a") || args.includes("-la") || args.includes("-al");
      const pageIdx = args.indexOf("--page");
      const page = pageIdx !== -1 ? parseInt(args[pageIdx + 1]) : null;
      const sizeIdx = args.indexOf("--page-size");
      const pageSize = sizeIdx !== -1 ? parseInt(args[sizeIdx + 1]) : 20;
      const flagArgs = /* @__PURE__ */ new Set(["-l", "-a", "-la", "-al", "--page", "--page-size"]);
      const flagValues = /* @__PURE__ */ new Set();
      if (pageIdx !== -1 && args[pageIdx + 1]) flagValues.add(args[pageIdx + 1]);
      if (sizeIdx !== -1 && args[sizeIdx + 1]) flagValues.add(args[sizeIdx + 1]);
      const pathArg = args.find((a) => !a.startsWith("-") && !flagValues.has(a));
      if (pathArg && /[*?[]/.test(pathArg)) {
        const matches = await this.expandGlob(pathArg, this.cwd);
        if (!matches.length) return `ls: ${pathArg}: No such file or directory`;
        return matches.map((p) => p.split("/").pop()).join("\n");
      }
      const path = pathArg || this.cwd;
      let lsResult;
      try {
        lsResult = await this.fs.ls(this.resolve(path));
      } catch (err) {
        return this.fsError("ls", path, err.message ?? String(err));
      }
      if (lsResult && lsResult.error) return this.fsError("ls", path, lsResult.error);
      let entries = lsResult;
      if (all) {
        const hasDot = entries.some((e) => e.name === ".");
        const hasDotDot = entries.some((e) => e.name === "..");
        const synthetic = [];
        if (!hasDot) synthetic.push({ name: ".", type: "dir" });
        if (!hasDotDot) synthetic.push({ name: "..", type: "dir" });
        entries = [...synthetic, ...entries];
      } else {
        entries = entries.filter((e) => !e.name.startsWith("."));
      }
      if (page !== null) {
        const validPage = Math.max(1, page);
        const validPageSize = pageSize > 0 ? pageSize : 20;
        const start = (validPage - 1) * validPageSize;
        const end = start + validPageSize;
        entries = entries.slice(start, end);
      }
      if (!entries.length) return "";
      if (long) {
        return entries.map((e) => `${e.type === "dir" ? "d" : "-"}rwxr-xr-x  ${e.name}`).join("\n");
      }
      return entries.map((e) => e.type === "dir" ? e.name + "/" : e.name).join("\n");
    }
    async cat(args) {
      const expanded = await this.expandPathArgs(args);
      const paths = expanded.filter((a) => !a.startsWith("-"));
      if (!paths.length) return "cat: missing operand";
      const results = await Promise.all(paths.map(async (p) => {
        if (/[*?]/.test(p)) return `cat: ${p}: No such file or directory`;
        const r = await this.fs.read(this.resolve(p));
        return r.error ? this.fsError("cat", p, r.error) : r.content ?? "";
      }));
      return results.join("\n");
    }
    async grep(args) {
      const rawFlags = args.filter((a) => a.startsWith("-"));
      const rest = args.filter((a) => !a.startsWith("-"));
      const [pattern, ...paths] = rest;
      if (!pattern) return "grep: missing pattern";
      const flags = [];
      for (const f of rawFlags) {
        if (f.length > 2 && f.startsWith("-")) {
          for (let i = 1; i < f.length; i++) flags.push("-" + f[i]);
        } else {
          flags.push(f);
        }
      }
      try {
        new RegExp(pattern, flags.includes("-i") ? "i" : "");
      } catch {
        return `grep: ${pattern}: Invalid regular expression`;
      }
      const recursive = flags.includes("-r") || flags.includes("-R");
      const expandedPaths = [];
      for (const p of paths) {
        if (/[*?]/.test(p)) {
          const matches = await this.expandGlob(p, this.cwd);
          expandedPaths.push(...matches);
        } else {
          expandedPaths.push(p);
        }
      }
      if (paths.length > 0 && expandedPaths.length === 0)
        return `grep: ${paths[0]}: No such file or directory`;
      const resolvedPaths = expandedPaths.length ? expandedPaths : paths;
      if (resolvedPaths.length === 1 && !recursive) {
        const singlePath = resolvedPaths[0];
        try {
          const raw = await this.grepStream(pattern, singlePath, flags);
          const warning = raw[0]?.startsWith("grep: warning:") ? raw[0] : void 0;
          const matches = warning ? raw.slice(1) : raw;
          if (flags.includes("-c")) return (warning ? warning + "\n" : "") + String(matches.length);
          if (!matches.length) return warning ?? "";
          if (flags.includes("-l")) return (warning ? warning + "\n" : "") + singlePath;
          return raw.join("\n");
        } catch (err) {
          return this.fsError("grep", singlePath, String(err));
        }
      }
      if (resolvedPaths.length > 1 && !recursive && isStreamable(this.fs)) {
        const allMatches = [];
        for (const p of resolvedPaths) {
          try {
            const raw = await this.grepStream(pattern, p, flags);
            allMatches.push(...raw.filter((m) => !m.startsWith("grep: warning:")));
          } catch (err) {
            allMatches.push(this.fsError("grep", p, String(err)));
          }
        }
        if (flags.includes("-c")) return String(allMatches.length);
        if (!allMatches.length) return "";
        if (flags.includes("-l")) return [...new Set(allMatches.map((m) => m.split(":")[0]))].join("\n");
        return allMatches.join("\n");
      }
      const caseInsensitive = flags.includes("-i");
      if (caseInsensitive && (resolvedPaths.length > 0 || recursive)) {
        const regex = new RegExp(pattern, "i");
        const files = [];
        const searchDirs = resolvedPaths.length ? resolvedPaths : [this.cwd];
        for (const p of searchDirs) {
          const resolved = this.resolve(p);
          let isDir = false;
          try {
            await this.fs.ls(resolved);
            isDir = true;
          } catch {
          }
          if (isDir) {
            if (recursive) {
              const collected = await this.findRecursive(resolved, void 0, "f");
              files.push(...collected);
            } else {
              return `grep: ${p}: is a directory`;
            }
          } else {
            files.push(resolved);
          }
        }
        const ciResults = [];
        for (const file of files) {
          const r = await this.fs.read(file);
          if (r.error) continue;
          const lines = (r.content ?? "").split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              ciResults.push({ path: file, line: i + 1, content: lines[i] });
            }
          }
        }
        if (flags.includes("-c")) return String(ciResults.length);
        if (!ciResults.length) {
          for (const p of searchDirs) {
            const resolved = this.resolve(p);
            let lsThrew = false;
            try {
              await this.fs.ls(resolved);
            } catch {
              lsThrew = true;
            }
            if (lsThrew) return this.fsError("grep", p, "No such file or directory");
          }
          return "";
        }
        if (flags.includes("-l")) return [...new Set(ciResults.map((r) => r.path))].join("\n");
        return ciResults.map((r) => `${r.path}:${r.line}: ${r.content}`).join("\n");
      }
      const allResults = await this.fs.grep(pattern);
      const searchPaths = resolvedPaths.length ? resolvedPaths : recursive ? [this.cwd] : [];
      const pathFiltered = searchPaths.length ? allResults.filter((r) => searchPaths.some((p) => r.path.startsWith(this.resolve(p)))) : allResults;
      const filtered = caseInsensitive ? (() => {
        const re = new RegExp(pattern, "i");
        return pathFiltered.filter((r) => re.test(r.content));
      })() : pathFiltered;
      if (flags.includes("-c")) return String(filtered.length);
      if (!filtered.length) {
        for (const p of searchPaths) {
          const resolved = this.resolve(p);
          let lsThrew = false;
          try {
            await this.fs.ls(resolved);
          } catch {
            lsThrew = true;
          }
          if (lsThrew) return this.fsError("grep", p, "No such file or directory");
        }
        return "";
      }
      if (flags.includes("-l")) return [...new Set(filtered.map((r) => r.path))].join("\n");
      return filtered.map((r) => `${r.path}:${r.line}: ${r.content}`).join("\n");
    }
    async grepStream(pattern, path, flags) {
      const resolved = this.resolve(path);
      let regex;
      try {
        regex = new RegExp(pattern, flags.includes("-i") ? "i" : "");
      } catch {
        throw new Error(`${pattern}: Invalid regular expression`);
      }
      if (isStreamable(this.fs)) {
        const matches2 = [];
        let lineNum = 0;
        for await (const line of this.fs.readStream(resolved)) {
          lineNum++;
          if (regex.test(line)) matches2.push(`${resolved}:${lineNum}: ${line}`);
        }
        return matches2;
      }
      const WARNING = "grep: warning: streaming unavailable, using read() fallback";
      const r = await this.fs.read(resolved);
      if (r.error) throw new Error(r.error);
      const lines = (r.content ?? "").split("\n");
      const matches = [];
      lines.forEach((line, idx) => {
        if (regex.test(line)) matches.push(`${resolved}:${idx + 1}: ${line}`);
      });
      return [WARNING, ...matches];
    }
    async findRecursive(basePath, namePattern, typeFilter, visited = /* @__PURE__ */ new Set()) {
      if (visited.has(basePath)) return [];
      visited.add(basePath);
      let entries;
      try {
        entries = await this.fs.ls(basePath);
      } catch {
        return [];
      }
      const results = [];
      for (const e of entries) {
        const fullPath = basePath.replace(/\/$/, "") + "/" + e.name;
        const matchesType = !typeFilter || e.type === (typeFilter === "f" ? "file" : "dir");
        const matchesName = !namePattern || namePattern.test(e.name);
        if (matchesType && matchesName) results.push(fullPath);
        if (e.type === "dir") results.push(...await this.findRecursive(fullPath, namePattern, typeFilter, visited));
      }
      return results;
    }
    async find(args) {
      const nameIdx = args.indexOf("-name");
      const typeIdx = args.indexOf("-type");
      const namePatternStr = nameIdx !== -1 ? args[nameIdx + 1] : void 0;
      const typeFilter = typeIdx !== -1 ? args[typeIdx + 1] : void 0;
      const basePath = args[0]?.startsWith("-") ? this.cwd : args[0] || this.cwd;
      const nameRegex = namePatternStr ? new RegExp("^" + namePatternStr.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") + "$") : void 0;
      const results = await this.findRecursive(this.resolve(basePath), nameRegex, typeFilter);
      return results.join("\n");
    }
    async cd(path) {
      if (!path || path === "~") {
        this.cwd = "/";
        this.env.set("PWD", "/");
        return "";
      }
      const resolved = this.resolve(path);
      try {
        await this.fs.ls(resolved);
      } catch {
        return `cd: ${path}: No such file or directory`;
      }
      const r = await this.fs.read(resolved);
      if (!r.error && r.content !== void 0) return `cd: ${path}: Not a directory`;
      this.cwd = resolved;
      this.env.set("PWD", resolved);
      return "";
    }
    parentOf(path) {
      const parts = path.replace(/\/$/, "").split("/");
      parts.pop();
      return parts.join("/") || "/";
    }
    async mkdirOne(resolved) {
      if (typeof this.fs.mkdir === "function") {
        await this.fs.mkdir(resolved);
      } else {
        await this.fs.write(resolved + "/.keep", "");
      }
    }
    async mkdir(args) {
      const recursive = args.includes("-p");
      const paths = args.filter((a) => !a.startsWith("-"));
      const err = this.checkWritable("mkdir", this.resolve(paths[0] ?? ""));
      if (err) return err;
      for (const p of paths) {
        const resolved = this.resolve(p);
        if (recursive) {
          const segments = resolved.replace(/^\//, "").split("/");
          let prefix = "";
          for (const seg of segments) {
            prefix += "/" + seg;
            try {
              await this.mkdirOne(prefix);
            } catch {
            }
          }
        } else {
          try {
            await this.fs.ls(this.parentOf(resolved));
          } catch {
            return `mkdir: ${p}: No such file or directory`;
          }
          try {
            await this.mkdirOne(resolved);
          } catch (e) {
            const msg = e.message ?? String(e);
            if (msg.toLowerCase().includes("exist"))
              return `mkdir: ${p}: File exists`;
            return `mkdir: ${p}: No such file or directory`;
          }
        }
      }
      return "";
    }
    async rmRecursive(path) {
      const stack = [path];
      const toDelete = [];
      const visited = /* @__PURE__ */ new Set();
      while (stack.length) {
        const cur = stack.pop();
        if (visited.has(cur)) continue;
        visited.add(cur);
        toDelete.push(cur);
        const entries = await this.fs.ls(cur);
        for (const e of entries) {
          const child = cur.replace(/\/$/, "") + "/" + e.name;
          if (e.type === "dir") stack.push(child);
          else toDelete.push(child);
        }
      }
      for (let i = toDelete.length - 1; i >= 0; i--) {
        await this.fs.delete(toDelete[i]);
      }
    }
    async rm(args) {
      const recursive = args.includes("-r") || args.includes("-rf");
      const expanded = await this.expandPathArgs(args);
      const paths = expanded.filter((a) => !a.startsWith("-"));
      if (paths.length === 0) return "rm: missing operand";
      const werr = this.checkWritable("rm", this.resolve(paths[0] ?? ""));
      if (werr) return werr;
      for (const p of paths) {
        const resolved = this.resolve(p);
        if (resolved === "/") return "rm: refusing to remove '/'";
        if (recursive) {
          try {
            await this.rmRecursive(resolved);
          } catch (e) {
            return this.fsError("rm", p, e.message ?? String(e));
          }
        } else {
          const r = await this.fs.read(resolved);
          if (r.error && /no such file/i.test(r.error)) return this.fsError("rm", p, "No such file or directory");
          let lsThrew = false;
          try {
            await this.fs.ls(resolved);
          } catch {
            lsThrew = true;
          }
          if (!lsThrew) return `rm: ${p}: is a directory`;
          try {
            await this.fs.delete(resolved);
          } catch (e) {
            return this.fsError("rm", p, e.message ?? String(e));
          }
        }
      }
      return "";
    }
    async mv(args) {
      const [src, dst] = args.filter((a) => !a.startsWith("-"));
      if (!src || !dst) return "mv: missing operand";
      const srcPath = this.resolve(src);
      const dstPath = this.resolve(dst);
      const werr = this.checkWritable("mv", srcPath);
      if (werr) return werr;
      let isDir = false;
      try {
        await this.fs.ls(srcPath);
        isDir = true;
      } catch {
      }
      if (isDir) {
        const copyErr = await this.copyRecursive(srcPath, dstPath);
        if (copyErr) return copyErr;
        try {
          await this.rmRecursive(srcPath);
        } catch (e) {
          return this.fsError("mv", src, e.message ?? String(e));
        }
        return "";
      } else {
        const r = await this.fs.read(srcPath);
        if (r.error) return this.fsError("mv", src, r.error);
        await this.fs.write(dstPath, r.content ?? "");
        await this.fs.delete(srcPath);
        return "";
      }
    }
    async cp(args) {
      const flags = args.filter((a) => a.startsWith("-"));
      const recursive = flags.includes("-r") || flags.includes("-R");
      const [src, dst] = args.filter((a) => !a.startsWith("-"));
      if (!src || !dst) return "cp: missing operand";
      const werr = this.checkWritable("cp", this.resolve(dst));
      if (werr) return werr;
      if (/[*?]/.test(src)) {
        const matches = await this.expandGlob(src, this.cwd);
        if (!matches.length) return `cp: ${src}: No such file or directory`;
        for (const m of matches) {
          const name = m.split("/").pop();
          const dstPath = this.resolve(dst) + "/" + name;
          const r2 = await this.fs.read(m);
          if (r2.error) return this.fsError("cp", m, r2.error);
          await this.fs.write(dstPath, r2.content ?? "");
        }
        return "";
      }
      if (recursive) return this.copyRecursive(this.resolve(src), this.resolve(dst));
      try {
        await this.fs.ls(this.resolve(src));
        return `cp: ${src}: -r not specified; omitting directory`;
      } catch {
      }
      const r = await this.fs.read(this.resolve(src));
      if (r.error) return this.fsError("cp", src, r.error);
      await this.fs.write(this.resolve(dst), r.content ?? "");
      return "";
    }
    async copyRecursive(src, dst) {
      let entries;
      try {
        entries = await this.fs.ls(src);
      } catch (err) {
        return this.fsError("cp", src, String(err));
      }
      if (typeof this.fs.mkdir === "function") {
        try {
          await this.fs.mkdir(dst);
        } catch {
        }
      }
      for (const entry of entries) {
        const srcPath = src + "/" + entry.name;
        const dstPath = dst + "/" + entry.name;
        if (entry.type === "dir") {
          const err = await this.copyRecursive(srcPath, dstPath);
          if (err) return err;
        } else {
          const r = await this.fs.read(srcPath);
          if (r.error) return this.fsError("cp", srcPath, r.error);
          await this.fs.write(dstPath, r.content ?? "");
        }
      }
      return "";
    }
    async touch(path) {
      if (!path) return "touch: missing operand";
      const werr = this.checkWritable("touch", this.resolve(path));
      if (werr) return werr;
      const r = await this.fs.read(this.resolve(path));
      if (r.content === void 0 || r.content === null) await this.fs.write(this.resolve(path), "");
      return "";
    }
    async head(args) {
      const nIdx = args.indexOf("-n");
      const n = nIdx !== -1 ? parseInt(args[nIdx + 1]) : 10;
      const path = args.find((a) => !a.startsWith("-") && !/^\d+$/.test(a));
      if (!path) return "head: missing operand";
      const r = await this.fs.read(this.resolve(path));
      if (r.error) return this.fsError("head", path, r.error);
      return (r.content ?? "").split("\n").slice(0, n).join("\n");
    }
    async tail(args) {
      const nIdx = args.indexOf("-n");
      const n = nIdx !== -1 ? parseInt(args[nIdx + 1]) : 10;
      const path = args.find((a) => !a.startsWith("-") && !/^\d+$/.test(a));
      if (!path) return "tail: missing operand";
      const r = await this.fs.read(this.resolve(path));
      if (r.error) return this.fsError("tail", path, r.error);
      const lines = (r.content ?? "").split("\n");
      return lines.slice(-n).join("\n");
    }
    async wc(args) {
      const flags = args.filter((a) => a.startsWith("-"));
      const path = args.find((a) => !a.startsWith("-"));
      if (!path) return "wc: missing operand";
      const r = await this.fs.read(this.resolve(path));
      if (r.error) return this.fsError("wc", path, r.error);
      const content = r.content ?? "";
      const lines = content === "" ? 0 : content.split("\n").length;
      const words = content.split(/\s+/).filter(Boolean).length;
      const chars = content.length;
      if (flags.includes("-l")) return `${lines}	${path}`;
      if (flags.includes("-w")) return `${words}	${path}`;
      if (flags.includes("-c")) return `${chars}	${path}`;
      return `${lines}	${words}	${chars}	${path}`;
    }
  };

  // src/browser.ts
  var MemFS = class {
    files = /* @__PURE__ */ new Map();
    dirs = /* @__PURE__ */ new Set(["/"]);
    normalize(p) {
      return p.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
    }
    async read(path) {
      const f = this.files.get(this.normalize(path));
      if (f === void 0) throw new Error(`ENOENT: ${path}`);
      return f;
    }
    async write(path, content) {
      const p = this.normalize(path);
      const dir = p.split("/").slice(0, -1).join("/") || "/";
      this.dirs.add(dir);
      this.files.set(p, content);
    }
    async ls(path) {
      const p = this.normalize(path);
      const entries = [];
      const prefix = p === "/" ? "/" : p + "/";
      for (const [fp] of this.files) {
        if (fp.startsWith(prefix) && !fp.slice(prefix.length).includes("/"))
          entries.push({ name: fp.slice(prefix.length), type: "file", size: this.files.get(fp).length });
      }
      for (const dp of this.dirs) {
        if (dp !== p && dp.startsWith(prefix) && !dp.slice(prefix.length).includes("/"))
          entries.push({ name: dp.slice(prefix.length), type: "dir", size: 0 });
      }
      return entries;
    }
    async delete(path) {
      this.files.delete(this.normalize(path));
    }
    async mkdir(path) {
      this.dirs.add(this.normalize(path));
    }
    async exists(path) {
      const p = this.normalize(path);
      return this.files.has(p) || this.dirs.has(p);
    }
    async grep(pattern, path, opts) {
      const re = new RegExp(pattern);
      const results = [];
      const check = async (fp) => {
        const content = this.files.get(fp);
        if (!content) return;
        content.split("\n").forEach((line, i) => {
          if (re.test(line)) results.push({ file: fp, line: i + 1, content: line });
        });
      };
      const p = this.normalize(path);
      if (this.files.has(p)) {
        await check(p);
      } else if (opts?.recursive) {
        for (const fp of this.files.keys()) if (fp.startsWith(p + "/")) await check(fp);
      }
      return results;
    }
  };
  function createBrowserShell(existingFs) {
    const fs = existingFs || new MemFS();
    return new AgenticShell(fs);
  }
  return __toCommonJS(browser_exports);
})();

if (typeof AgenticShellBrowser !== 'undefined' && typeof AgenticShell === 'undefined') { var AgenticShell = AgenticShellBrowser; }

// ═══ agentic-voice.js ═══
/**
 * agentic-voice — Speech for AI apps
 * TTS (text-to-speech) + STT (speech-to-text) in one library.
 * Zero dependencies. Browser + Node.js.
 *
 * Usage:
 *   const voice = AgenticVoice.createVoice({
 *     tts: { baseUrl: 'https://api.openai.com', apiKey: 'sk-...', voice: 'alloy' },
 *     stt: { mode: 'browser' },  // or 'whisper'
 *   })
 *
 *   // Text-to-Speech
 *   await voice.speak('Hello world')
 *   voice.stop()
 *
 *   // Speech-to-Text (push-to-talk)
 *   voice.startListening()
 *   voice.stopListening()  // → emits 'transcript' event
 *
 *   // Playback progress (0-1)
 *   voice.on('progress', ({ progress, duration, elapsed }) => ...)
 *
 *   // Word-level timestamps
 *   const { words, duration } = await voice.timestamps('Hello world')
 *
 *   // Fetch audio without playing
 *   const buffer = await voice.fetchAudio('Hello world')
 *   const result = await voice.playBuffer(buffer)
 *
 *   // Events
 *   voice.on('transcript', text => console.log(text))
 *   voice.on('speaking', playing => ...)
 *   voice.on('progress', ({ progress, duration, elapsed }) => ...)
 *   voice.on('error', err => ...)
 *
 * Browser:
 *   <script src="agentic-voice.js"></script>
 *   const voice = AgenticVoice.createVoice({ ... })
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else if (typeof define === 'function' && define.amd) define(factory)
  else root.AgenticVoice = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  // ── Event emitter ────────────────────────────────────────────────

  function createEmitter() {
    const listeners = {}
    return {
      on(event, fn) {
        if (!listeners[event]) listeners[event] = []
        listeners[event].push(fn)
        return this
      },
      off(event, fn) {
        if (!listeners[event]) return this
        listeners[event] = listeners[event].filter(f => f !== fn)
        return this
      },
      emit(event, ...args) {
        if (listeners[event]) {
          for (const fn of listeners[event]) {
            try { fn(...args) } catch (e) { console.error('[voice]', e) }
          }
        }
      }
    }
  }

  // ── webm→wav conversion (browser) ───────────────────────────────

  async function webmToWav(blob) {
    const ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)()
    const arrayBuffer = await blob.arrayBuffer()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    const samples = audioBuffer.getChannelData(0)
    const sampleRate = audioBuffer.sampleRate
    const buffer = new ArrayBuffer(44 + samples.length * 2)
    const view = new DataView(buffer)
    const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)) }
    writeStr(0, 'RIFF')
    view.setUint32(4, 36 + samples.length * 2, true)
    writeStr(8, 'WAVE')
    writeStr(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeStr(36, 'data')
    view.setUint32(40, samples.length * 2, true)
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]))
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    }
    ctx.close()
    return new Blob([buffer], { type: 'audio/wav' })
  }

  // ── URL helpers ──────────────────────────────────────────────────

  function cleanUrl(url) {
    return (url || '').trim().replace(/\/+$/, '').replace(/\/v1$/, '')
  }

  // ── TTS Engine ───────────────────────────────────────────────────

  function createTTS(config = {}) {
    const {
      provider = 'openai',
      baseUrl = 'https://api.openai.com',
      apiKey = '',
      model = 'tts-1',
      voice = 'alloy',
      format = 'mp3',
      proxyUrl = null,
    } = config

    let audioCtx = null
    let currentSource = null
    let generation = 0
    let progressRAF = null

    // Observable state
    let _progress = 0
    let _duration = 0
    let _onProgress = null   // callback: ({ progress, duration, elapsed }) => void
    let _onEnd = null         // callback: () => void

    function getAudioCtx() {
      if (!audioCtx) audioCtx = new (globalThis.AudioContext || globalThis.webkitAudioContext)()
      return audioCtx
    }

    function stopProgressLoop() {
      if (progressRAF) {
        cancelAnimationFrame(progressRAF)
        progressRAF = null
      }
    }

    function resetPlaybackState() {
      stopProgressLoop()
      _progress = 0
      _duration = 0
    }

    /**
     * Fetch TTS audio as ArrayBuffer without playing.
     * Returns null on failure.
     */
    async function fetchAudio(text, opts = {}) {
      if (!text?.trim()) return null
      if (!apiKey && !opts.apiKey) return null

      const currentProvider = opts.provider || provider

      // ElevenLabs
      if (currentProvider === 'elevenlabs') {
        const voiceId = opts.voice || voice
        const modelId = opts.model || model || 'eleven_turbo_v2_5'
        const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`
        
        const headers = {
          'xi-api-key': opts.apiKey || apiKey,
          'Content-Type': 'application/json',
        }

        const body = JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          }
        })

        let res, lastErr
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            res = await fetch(url, { method: 'POST', headers, body })
            break
          } catch (err) {
            lastErr = err
            if (attempt < 2) await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
          }
        }
        if (!res) throw lastErr
        if (!res.ok) throw new Error(`ElevenLabs TTS failed: ${res.status} ${res.statusText}`)

        const arrayBuffer = await res.arrayBuffer()
        if (arrayBuffer.byteLength === 0) return null
        return arrayBuffer
      }

      // OpenAI (default)
      const base = cleanUrl(opts.baseUrl || baseUrl)
      const url = `${base}/v1/audio/speech`
      const targetUrl = proxyUrl ? proxyUrl : url
      const headers = {
        'Authorization': `Bearer ${opts.apiKey || apiKey}`,
        'Content-Type': 'application/json',
      }
      if (proxyUrl) headers['X-Target-URL'] = url

      const body = JSON.stringify({
        model: opts.model || model,
        voice: opts.voice || voice,
        input: text,
        response_format: opts.format || format,
      })

      let res, lastErr
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          res = await fetch(targetUrl, { method: 'POST', headers, body })
          break
        } catch (err) {
          lastErr = err
          if (attempt < 2) await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
        }
      }
      if (!res) throw lastErr
      if (!res.ok) throw new Error(`TTS failed: ${res.status} ${res.statusText}`)

      const arrayBuffer = await res.arrayBuffer()
      if (arrayBuffer.byteLength === 0) return null
      return arrayBuffer
    }

    /**
     * Play an already-fetched audio ArrayBuffer.
     * Returns { duration } on success, null on cancel/failure.
     * Emits progress events via _onProgress callback.
     */
    async function playBuffer(arrayBuffer) {
      const gen = ++generation

      // Stop previous
      stop()
      resetPlaybackState()

      // Validate arrayBuffer
      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        console.error('[TTS] Invalid arrayBuffer')
        return null
      }

      console.log('[TTS] Playing buffer, size:', arrayBuffer.byteLength)

      // Use Audio element directly (skip AudioContext)
      const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' })
      const blobUrl = URL.createObjectURL(blob)
      const audio = new Audio()
      audio.src = blobUrl

      return new Promise(resolve => {
        audio.onloadedmetadata = () => {
          _duration = audio.duration
        }
        audio.ontimeupdate = () => {
          if (audio.duration > 0) {
            _progress = audio.currentTime / audio.duration
            _onProgress?.({ progress: _progress, duration: audio.duration, elapsed: audio.currentTime })
          }
        }
        audio.onended = () => {
          URL.revokeObjectURL(blobUrl)
          _progress = 1
          _onProgress?.({ progress: 1, duration: _duration, elapsed: _duration })
          currentSource = null
          _onEnd?.()
          resolve({ duration: _duration })
        }
        audio.onerror = (e) => {
          console.error('[TTS] Audio error:', audio.error)
          URL.revokeObjectURL(blobUrl)
          currentSource = null
          _onEnd?.()
          resolve(null)
        }
        currentSource = audio
        audio.play().catch(e => {
          console.error('[TTS] Play failed:', e)
          URL.revokeObjectURL(blobUrl)
          resolve(null)
        })
      })
    }

    /**
     * Fetch + play in one call (original API).
     */
    async function speak(text, opts = {}) {
      if (!text?.trim()) return false
      if (!apiKey && !opts.apiKey) throw new Error('TTS apiKey required')

      const gen = ++generation
      stop()
      resetPlaybackState()

      const currentProvider = opts.provider || provider

      // ElevenLabs - direct play
      if (currentProvider === 'elevenlabs') {
        const voiceId = opts.voice || voice
        const modelId = opts.model || model || 'eleven_turbo_v2_5'
        const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`
        
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'xi-api-key': opts.apiKey || apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            model_id: modelId,
            voice_settings: { stability: 0.5, similarity_boost: 0.75 }
          })
        })

        console.log('[TTS] Fetch response:', res.status, res.ok)
        if (!res.ok) return false
        const arrayBuffer = await res.arrayBuffer()
        console.log('[TTS] Got arrayBuffer:', arrayBuffer.byteLength, 'bytes')

        const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' })
        const blobUrl = URL.createObjectURL(blob)
        console.log('[TTS] Created blob URL:', blobUrl)
        const audio = new Audio()
        audio.src = blobUrl
        console.log('[TTS] Audio element created, src set')

        return new Promise(resolve => {
          audio.onended = () => {
            console.log('[TTS] Audio ended')
            URL.revokeObjectURL(blobUrl)
            currentSource = null
            _onEnd?.()
            resolve(true)
          }
          audio.onerror = (e) => {
            console.error('[TTS] Audio error:', audio.error)
            URL.revokeObjectURL(blobUrl)
            resolve(false)
          }
          currentSource = audio
          audio.play().catch(e => {
            console.error('[TTS] Play failed:', e)
            resolve(false)
          })
        })
      }

      // OpenAI - use fetchAudio + playBuffer
      const arrayBuffer = await fetchAudio(text, opts)
      if (!arrayBuffer || gen !== generation) return false
      const result = await playBuffer(arrayBuffer)
      return !!result
    }

    /**
     * Get word-level timestamps via Whisper transcription of TTS output.
     * Returns { words: [{ word, start, end }], duration } or null.
     */
    async function timestamps(text, opts = {}) {
      const arrayBuffer = await fetchAudio(text, opts)
      if (!arrayBuffer) return null

      const base = cleanUrl(opts.baseUrl || baseUrl)
      const key = opts.apiKey || apiKey
      if (!base || !key) return null

      try {
        const blob = new Blob([arrayBuffer], { type: `audio/${format}` })
        const form = new FormData()
        form.append('file', blob, `speech.${format}`)
        form.append('model', 'whisper-1')
        form.append('response_format', 'verbose_json')
        form.append('timestamp_granularities[]', 'word')

        const res = await fetch(`${base}/v1/audio/transcriptions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}` },
          body: form,
        })

        if (!res.ok) return null
        const data = await res.json()
        if (!data.words?.length) return null

        return {
          words: data.words,  // [{ word, start, end }, ...]
          duration: data.duration,
          audio: arrayBuffer,  // include buffer so caller can playBuffer() it
        }
      } catch {
        return null
      }
    }

    function stop() {
      generation++
      stopProgressLoop()
      if (currentSource) {
        try {
          if (currentSource.stop) currentSource.stop()
          else if (currentSource.pause) currentSource.pause()
        } catch {}
        currentSource = null
      }
      resetPlaybackState()
    }

    function unlock() {
      const ctx = getAudioCtx()
      if (ctx.state === 'suspended') ctx.resume()
    }

    function destroy() {
      stop()
      if (audioCtx) { try { audioCtx.close() } catch {} }
      audioCtx = null
    }

    return {
      speak,
      fetchAudio,
      playBuffer,
      timestamps,
      stop,
      unlock,
      destroy,
      /** Set progress callback: ({ progress, duration, elapsed }) => void */
      onProgress(cb) { _onProgress = cb },
      /** Set playback-end callback */
      onEnd(cb) { _onEnd = cb },
      get isSpeaking() { return !!currentSource },
      get progress() { return _progress },
      get duration() { return _duration },
      get generation() { return generation },
      bumpGeneration() { return ++generation },
    }
  }

  // ── STT Engine ───────────────────────────────────────────────────

  function createSTT(config = {}) {
    const {
      provider = 'openai',
      mode = 'browser',  // 'browser' (Web Speech API) or 'whisper'
      baseUrl = 'https://api.openai.com',
      apiKey = '',
      language = 'zh-CN',
      model = 'whisper-1',
      proxyUrl = null,
      minHoldMs = 300,
    } = config

    let mediaRecorder = null
    let webSpeechRecognition = null
    let micDownTime = 0
    let micReleased = false

    // ── Web Speech API ──

    function startWebSpeech(onResult, onError) {
      if (webSpeechRecognition) return
      const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition
      if (!SR) { onError?.(new Error('Web Speech API not supported')); return false }

      micDownTime = Date.now()
      const recognition = new SR()
      recognition.lang = language.replace('_', '-')
      recognition.interimResults = false

      recognition.onresult = e => {
        const text = e.results[0]?.[0]?.transcript?.trim()
        webSpeechRecognition = null
        if (text) onResult?.(text)
        else onError?.(new Error('No speech detected'))
      }
      recognition.onerror = e => {
        webSpeechRecognition = null
        onError?.(new Error('Recognition error: ' + e.error))
      }
      recognition.onend = () => {
        webSpeechRecognition = null
      }

      webSpeechRecognition = recognition
      recognition.start()
      return true
    }

    function stopWebSpeech() {
      if (!webSpeechRecognition) return
      const held = Date.now() - micDownTime
      if (held < minHoldMs) {
        webSpeechRecognition.abort()
        webSpeechRecognition = null
        return
      }
      webSpeechRecognition.stop()
    }

    // ── Whisper API ──

    function startWhisper(onResult, onError) {
      console.log('[STT] startWhisper called, mediaRecorder:', mediaRecorder)
      if (mediaRecorder) return false
      micDownTime = Date.now()
      micReleased = false

      if (!navigator.mediaDevices?.getUserMedia) {
        onError?.(new Error('getUserMedia not available (HTTPS required)'))
        return false
      }

      navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        console.log('[STT] Got media stream')
        if (micReleased) {
          console.log('[STT] Mic already released, stopping stream')
          stream.getTracks().forEach(t => t.stop())
          return
        }

        const chunks = []
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
        console.log('[STT] MediaRecorder created')
        
        mediaRecorder.ondataavailable = e => {
          console.log('[STT] Data available:', e.data.size, 'bytes')
          chunks.push(e.data)
        }
        
        mediaRecorder.onstop = async () => {
          console.log('[STT] MediaRecorder stopped')
          stream.getTracks().forEach(t => t.stop())
          const held = Date.now() - micDownTime
          console.log('[STT] Held for', held, 'ms')
          mediaRecorder = null

          if (held < minHoldMs) return

          const blob = new Blob(chunks, { type: 'audio/webm' })
          console.log('[STT] Created blob:', blob.size, 'bytes')
          try {
            const text = await transcribe(blob)
            console.log('[STT] Transcribe result:', text)
            if (text) onResult?.(text)
            else onError?.(new Error('No speech detected'))
          } catch (e) {
            console.error('[STT] Transcribe error:', e)
            onError?.(e)
          }
        }

        mediaRecorder.start()
        console.log('[STT] Recording started')
      }).catch(e => {
        console.error('[STT] getUserMedia error:', e)
        onError?.(new Error('Microphone unavailable: ' + e.message))
      })

      return true
    }

    function stopWhisper() {
      micReleased = true
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop()
      }
      // 立即清理，不等 onstop
      mediaRecorder = null
    }

    /**
     * Transcribe audio.
     * Browser: pass Blob (auto-converts webm→wav)
     * Node.js: pass file path (string) or Buffer
     */
    async function transcribe(input, opts = {}) {
      const currentProvider = opts.provider || provider
      const key = opts.apiKey || apiKey
      if (!key) throw new Error('STT apiKey required')

      // ElevenLabs
      if (currentProvider === 'elevenlabs') {
        const url = 'https://api.elevenlabs.io/v1/speech-to-text'
        const modelId = opts.model || 'scribe_v2'
        const isNode = typeof globalThis.window === 'undefined'
        
        if (isNode && (typeof input === 'string' || Buffer.isBuffer(input))) {
          const fs = require('fs')
          const fileData = typeof input === 'string' ? fs.readFileSync(input) : input
          const boundary = '----AgenticVoice' + Date.now().toString(36)
          const parts = []

          parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`)
          parts.push(fileData)
          parts.push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model_id"\r\n\r\n${modelId}\r\n`)
          parts.push(`--${boundary}--\r\n`)

          const body = Buffer.concat(parts.map(p => typeof p === 'string' ? Buffer.from(p) : p))

          const https = require('https')
          const parsed = new (require('url').URL)(url)
          return new Promise((resolve, reject) => {
            const req = https.request({
              hostname: parsed.hostname,
              path: parsed.pathname,
              method: 'POST',
              headers: {
                'xi-api-key': key,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length,
              },
              timeout: 30000,
            }, (res) => {
              let data = ''
              res.on('data', c => data += c)
              res.on('end', () => {
                try {
                  const result = JSON.parse(data)
                  resolve(result.text?.trim() || '')
                } catch { reject(new Error('Failed to parse ElevenLabs response')) }
              })
            })
            req.on('error', reject)
            req.on('timeout', () => { req.destroy(); reject(new Error('Transcription timeout')) })
            req.write(body)
            req.end()
          })
        }

        // Browser
        console.log('[STT] Transcribing audio blob, size:', input.size)
        const form = new FormData()
        form.append('file', input, 'audio.webm')
        form.append('model_id', modelId)

        console.log('[STT] Sending to ElevenLabs...')
        
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'xi-api-key': key },
            body: form
          })
          console.log('[STT] Response:', res.status, res.ok)
          if (!res.ok) {
            const errorText = await res.text()
            console.error('[STT] Error response:', errorText)
            throw new Error(`ElevenLabs STT failed: ${res.status}`)
          }
          const result = await res.json()
          console.log('[STT] Result:', result)
          return result.text?.trim() || ''
        } catch (e) {
          console.error('[STT] Fetch error:', e.name, e.message)
          throw e
        }
      }

      // OpenAI (default)
      const base = cleanUrl(opts.baseUrl || baseUrl)
      if (!base) throw new Error('STT baseUrl required')

      const url = `${base}/v1/audio/transcriptions`
      const headers = { 'Authorization': `Bearer ${key}` }

      // Node.js: input is file path (string) or Buffer
      const isNode = typeof globalThis.window === 'undefined'
      if (isNode && (typeof input === 'string' || Buffer.isBuffer(input))) {
        const fs = require('fs')
        const fileData = typeof input === 'string' ? fs.readFileSync(input) : input
        const boundary = '----AgenticVoice' + Date.now().toString(36)
        const parts = []

        // file part
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`)
        parts.push(fileData)
        parts.push('\r\n')

        // model part
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${opts.model || model}\r\n`)

        // language part
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${language.split('-')[0]}\r\n`)

        // response_format for timestamps
        if (opts.timestamps) {
          parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`)
          parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nword\r\n`)
        }

        parts.push(`--${boundary}--\r\n`)

        const body = Buffer.concat(parts.map(p => typeof p === 'string' ? Buffer.from(p) : p))

        const http = url.startsWith('https') ? require('https') : require('http')
        const parsed = new (require('url').URL)(url)
        return new Promise((resolve, reject) => {
          const req = http.request({
            hostname: parsed.hostname,
            port: parsed.port || (url.startsWith('https') ? 443 : 80),
            path: parsed.pathname,
            method: 'POST',
            headers: {
              ...headers,
              'Content-Type': `multipart/form-data; boundary=${boundary}`,
              'Content-Length': body.length,
            },
            timeout: 30000,
          }, (res) => {
            let data = ''
            res.on('data', c => data += c)
            res.on('end', () => {
              try {
                const result = JSON.parse(data)
                if (opts.timestamps) resolve(result)
                else resolve(result.text?.trim() || '')
              } catch { reject(new Error('Failed to parse transcription response')) }
            })
          })
          req.on('error', reject)
          req.on('timeout', () => { req.destroy(); reject(new Error('Transcription timeout')) })
          req.write(body)
          req.end()
        })
      }

      // Browser: input is Blob — convert webm→wav
      const wavBlob = await webmToWav(input)
      const form = new FormData()
      form.append('file', wavBlob, 'audio.wav')
      form.append('model', opts.model || model)
      form.append('language', language.split('-')[0])

      if (opts.timestamps) {
        form.append('response_format', 'verbose_json')
        form.append('timestamp_granularities[]', 'word')
      }

      const res = await fetch(url, { method: 'POST', headers, body: form })
      if (!res.ok) throw new Error(`Transcription failed: ${res.status}`)

      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('json')) throw new Error('Transcription service unavailable')

      const result = await res.json()
      if (opts.timestamps) return result
      return result.text?.trim() || ''
    }

    /**
     * Transcribe with word-level timestamps.
     * Returns { words: [{ word, start, end }], text, duration } or null.
     */
    async function transcribeWithTimestamps(input, opts = {}) {
      try {
        const result = await transcribe(input, { ...opts, timestamps: true })
        if (!result?.words?.length) return null
        return {
          words: result.words,
          text: result.text || '',
          duration: result.duration,
        }
      } catch {
        return null
      }
    }

    // ── Public API ──

    function startListening(onResult, onError) {
      if (mode === 'browser') return startWebSpeech(onResult, onError)
      return startWhisper(onResult, onError)
    }

    function stopListening() {
      if (mode === 'browser') stopWebSpeech()
      else stopWhisper()
    }

    function destroy() {
      stopListening()
    }

    return {
      startListening,
      stopListening,
      transcribe,
      transcribeWithTimestamps,
      destroy,
      get isListening() { return !!(mediaRecorder || webSpeechRecognition) },
    }
  }

  // ── createVoice ──────────────────────────────────────────────────

  function createVoice(options = {}) {
    const events = createEmitter()
    const tts = options.tts !== false ? createTTS(options.tts || {}) : null
    const stt = options.stt !== false ? createSTT(options.stt || {}) : null

    // Wire TTS progress/end events
    if (tts) {
      tts.onProgress(data => events.emit('progress', data))
      tts.onEnd(() => events.emit('playbackEnd'))
    }

    let _speaking = false

    const voice = {
      /** Speak text aloud */
      async speak(text, opts) {
        if (!tts) throw new Error('TTS not configured')
        if (stt?.isListening) return false

        _speaking = true
        events.emit('speaking', true)
        try {
          const result = await tts.speak(text, opts)
          return result
        } finally {
          _speaking = false
          events.emit('speaking', false)
        }
      },

      /** Fetch TTS audio without playing */
      async fetchAudio(text, opts) {
        if (!tts) throw new Error('TTS not configured')
        return tts.fetchAudio(text, opts)
      },

      /** Play an already-fetched ArrayBuffer */
      async playBuffer(arrayBuffer) {
        if (!tts) throw new Error('TTS not configured')
        _speaking = true
        events.emit('speaking', true)
        try {
          const result = await tts.playBuffer(arrayBuffer)
          return result
        } finally {
          _speaking = false
          events.emit('speaking', false)
        }
      },

      /** Get word-level timestamps for TTS output */
      async timestamps(text, opts) {
        if (!tts) throw new Error('TTS not configured')
        return tts.timestamps(text, opts)
      },

      /** Stop speaking */
      stop() {
        if (tts) tts.stop()
        _speaking = false
        events.emit('speaking', false)
      },

      /** Start listening (push-to-talk) */
      startListening() {
        if (!stt) throw new Error('STT not configured')
        if (tts) tts.stop()
        _speaking = false

        events.emit('listening', true)
        stt.startListening(
          (text) => {
            events.emit('listening', false)
            events.emit('transcript', text)
          },
          (err) => {
            events.emit('listening', false)
            events.emit('error', err)
          }
        )
      },

      /** Stop listening */
      stopListening() {
        if (stt) stt.stopListening()
        events.emit('listening', false)
      },

      /** Transcribe audio blob or file */
      async transcribe(input, opts) {
        if (!stt) throw new Error('STT not configured')
        return stt.transcribe(input, opts)
      },

      /** Transcribe with word-level timestamps */
      async transcribeWithTimestamps(input, opts) {
        if (!stt) throw new Error('STT not configured')
        return stt.transcribeWithTimestamps(input, opts)
      },

      /** Unlock audio context (call on user gesture) */
      unlock() { if (tts) tts.unlock() },

      /** Events */
      on(event, fn) { events.on(event, fn); return this },
      off(event, fn) { events.off(event, fn); return this },

      /** State */
      get isSpeaking() { return _speaking },
      get isListening() { return stt?.isListening || false },
      get progress() { return tts?.progress || 0 },
      get duration() { return tts?.duration || 0 },

      /** Cleanup */
      destroy() {
        if (tts) tts.destroy()
        if (stt) stt.destroy()
      },
    }

    return voice
  }

  return { createVoice, createTTS, createSTT }
})



// ═══ agentic.js ═══
/**
 * agentic — 给 AI 造身体
 *
 * 统一入口，一个 class 访问所有能力。每个能力可独立配置 provider。
 *
 * Usage:
 *   // 默认实例（后续 configure）
 *   import { ai } from 'agentic'
 *   ai.configure({ llm: { provider: 'anthropic', apiKey: 'sk-...' } })
 *   await ai.think('hello')
 *
 *   // 自定义实例，每个能力独立配置
 *   import { Agentic } from 'agentic'
 *   const ai = new Agentic({
 *     llm:   { provider: 'anthropic', apiKey: 'sk-ant-...' },
 *     tts:   { provider: 'elevenlabs', apiKey: 'el-...' },
 *     stt:   { provider: 'sensevoice', baseUrl: 'http://localhost:18906' },
 *     embed: { provider: 'local', baseUrl: 'http://localhost:9877' },
 *   })
 *
 *   // 简单场景：顶层配置作为所有能力的 fallback
 *   const ai = new Agentic({ provider: 'openai', apiKey: 'sk-...' })
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else if (typeof define === 'function' && define.amd) define(factory)
  else root.Agentic = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const _cache = {}
  function load(name) {
    if (_cache[name] !== undefined) return _cache[name]
    // Browser: check global scope for pre-loaded UMD modules
    // Convention: 'agentic-core' → AgenticCore, 'agentic-store' → AgenticStore, etc.
    if (typeof window !== 'undefined') {
      const globalName = name.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join('')
      if (window[globalName]) { _cache[name] = window[globalName]; return _cache[name] }
    }
    try {
      if (typeof require === 'function') _cache[name] = require(name)
      else _cache[name] = null
    } catch { _cache[name] = null }
    return _cache[name]
  }

  // ── WebSocket connection manager ─────────────────────────────

  const WS = typeof WebSocket !== 'undefined' ? WebSocket
    : (typeof require === 'function' ? (() => { try { return require('ws') } catch { return null } })() : null)

  function createWsConnection(serviceUrl) {
    const wsUrl = serviceUrl.replace(/^http/, 'ws').replace(/\/+$/, '')
    let ws = null
    let connected = false
    let connectPromise = null
    const pending = new Map() // reqId → { resolve, reject, chunks, onDelta }
    let reqCounter = 0

    function connect() {
      if (connectPromise) return connectPromise
      connectPromise = new Promise((resolve, reject) => {
        if (!WS) return reject(new Error('WebSocket not available'))
        ws = new WS(wsUrl)

        ws.onopen = () => {
          connected = true
          connectPromise = null
          resolve(ws)
        }

        ws.onmessage = (event) => {
          let msg
          try { msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString()) } catch { return }

          if (msg._reqId && pending.has(msg._reqId)) {
            const req = pending.get(msg._reqId)
            if (msg.type === 'rpc_result') {
              req.resolve(msg.result)
              pending.delete(msg._reqId)
            } else if (msg.type === 'rpc_error') {
              req.reject(new Error(msg.error || 'RPC error'))
              pending.delete(msg._reqId)
            } else if (msg.type === 'chat_delta') {
              req.chunks.push(msg.text || '')
              if (req.onDelta) req.onDelta(msg.text || '')
            } else if (msg.type === 'chat_end') {
              req.resolve(msg.text || req.chunks.join(''))
              pending.delete(msg._reqId)
            } else if (msg.type === 'chat_error' || msg.type === 'error') {
              req.reject(new Error(msg.error || 'Unknown error'))
              pending.delete(msg._reqId)
            }
          } else if (msg.type === 'chat_delta' || msg.type === 'chat_end' || msg.type === 'chat_error') {
            // Legacy: no _reqId, match to the single pending request
            const first = pending.values().next().value
            if (!first) return
            const reqId = pending.keys().next().value
            if (msg.type === 'chat_delta') {
              first.chunks.push(msg.text || '')
              if (first.onDelta) first.onDelta(msg.text || '')
            } else if (msg.type === 'chat_end') {
              first.resolve(msg.text || first.chunks.join(''))
              pending.delete(reqId)
            } else if (msg.type === 'chat_error') {
              first.reject(new Error(msg.error || 'Unknown error'))
              pending.delete(reqId)
            }
          }
        }

        ws.onerror = (err) => {
          if (!connected) {
            connectPromise = null
            reject(err)
          }
        }

        ws.onclose = () => {
          connected = false
          connectPromise = null
          // Reject all pending
          for (const [id, req] of pending) {
            req.reject(new Error('WebSocket closed'))
          }
          pending.clear()
        }
      })
      return connectPromise
    }

    async function chat(messages, options = {}) {
      if (!connected || !ws || ws.readyState !== 1) await connect()
      const reqId = `r_${++reqCounter}_${Date.now()}`

      return new Promise((resolve, reject) => {
        pending.set(reqId, { resolve, reject, chunks: [], onDelta: options.emit })
        ws.send(JSON.stringify({
          type: 'think',
          _reqId: reqId,
          messages,
          options: { tools: options.tools, prefer: options.prefer },
        }))
      })
    }

    function close() {
      if (ws) { ws.close(); ws = null }
      connected = false
      connectPromise = null
    }

    async function rpc(method, params = {}) {
      if (!connected || !ws || ws.readyState !== 1) await connect()
      const reqId = `r_${++reqCounter}_${Date.now()}`

      return new Promise((resolve, reject) => {
        pending.set(reqId, {
          resolve, reject, chunks: [],
          onDelta: null,
          _rpc: true,
        })
        ws.send(JSON.stringify({ type: 'rpc', _reqId: reqId, method, params }))
      })
    }

    return { connect, chat, rpc, close, get connected() { return connected } }
  }

  // ── Agentic class ────────────────────────────────────────────────

  class Agentic {
    /**
     * @param {object} opts
     * @param {string} [opts.serviceUrl] — agentic-service URL for voice fallback + admin
     * @param {string} [opts.apiKey]     — API key for provider
     * @param {string} [opts.model]
     * @param {string} [opts.baseUrl]    — provider base URL (point to service for OpenAI-compatible)
     * @param {string} [opts.provider]
     * @param {string} [opts.system]
     * @param {object} [opts.tts]
     * @param {object} [opts.stt]
     * @param {object} [opts.memory]
     * @param {object} [opts.store]
     * @param {object} [opts.embed]
     * @param {object} [opts.sense]
     * @param {object} [opts.act]
     * @param {object} [opts.render]
     * @param {object} [opts.fs]
     * @param {object} [opts.shell]
     */
    constructor(opts = {}) {
      this._opts = opts
      this._i = {} // lazy instances
      this._serviceUrl = opts.serviceUrl ? opts.serviceUrl.replace(/\/+$/, '') : null
      this._ws = this._serviceUrl ? createWsConnection(this._serviceUrl) : null

      // Per-capability config — only capabilities that may need their own provider
      // Top-level provider/apiKey/baseUrl/model serves as default for everything
      this._cfg = {}
      for (const cap of ['llm', 'tts', 'stt', 'embed']) {
        this._cfg[cap] = opts[cap] || {}
      }
    }

    /** Resolve a config key for a capability, falling back to top-level opts */
    _cfgFor(cap, key) {
      return this._cfg[cap]?.[key] ?? this._opts[key]
    }

    /** Get full resolved config for a capability */
    _cfgAll(cap) {
      return {
        provider: this._cfgFor(cap, 'provider'),
        apiKey: this._cfgFor(cap, 'apiKey'),
        baseUrl: this._cfgFor(cap, 'baseUrl'),
        model: this._cfgFor(cap, 'model'),
        ...this._cfg[cap],
      }
    }

    _get(key, init) {
      if (!this._i[key]) this._i[key] = init()
      return this._i[key]
    }

    _need(pkg) {
      const m = load(pkg)
      if (!m) throw new Error(`${pkg} not installed — run: npm install ${pkg}`)
      return m
    }

    // ════════════════════════════════════════════════════════════════
    // THINK — serviceUrl → WebSocket to service, otherwise → core direct
    // ════════════════════════════════════════════════════════════════

    async think(input, opts = {}) {
      // Route: serviceUrl → WebSocket, otherwise → core direct
      if (this._ws) {
        const messages = opts.history
          ? [...opts.history, { role: 'user', content: input }]
          : [{ role: 'user', content: input }]
        if (opts.system) messages.unshift({ role: 'system', content: opts.system })
        return this._ws.chat(messages, { tools: opts.tools, emit: opts.emit, prefer: opts.prefer })
      }

      const core = this._need('agentic-core')
      const ask = core.agenticAsk || core

      // Resolve prefer → provider/baseUrl/apiKey/model overrides
      const pref = opts.prefer
      const prefObj = pref && typeof pref === 'object' ? pref : null

      const config = {
        provider: prefObj?.provider || opts.provider || this._cfgFor('llm', 'provider'),
        baseUrl: prefObj?.baseUrl || opts.baseUrl || this._cfgFor('llm', 'baseUrl'),
        apiKey: prefObj?.key || opts.apiKey || this._cfgFor('llm', 'apiKey'),
        model: prefObj?.model || opts.model || this._cfgFor('llm', 'model'),
        system: opts.system || this._opts.system,
        stream: opts.stream || false,
        proxyUrl: opts.proxyUrl || this._opts.proxyUrl,
      }

      if (opts.tools) config.tools = opts.tools
      if (opts.images) config.images = opts.images
      if (opts.audio) config.audio = opts.audio
      if (opts.history) config.history = opts.history
      if (opts.schema) config.schema = opts.schema
      if (opts.emit) config.emit = opts.emit

      const emit = opts.emit || (() => {})
      const result = await ask(input, config, emit)
      if (typeof result === 'string') return result
      if (result?.answer != null) return result.answer
      if (result?.content != null) return typeof result.content === 'string' ? result.content : result.content.map(b => b.text || '').join('')
      return result
    }

    // Note: no `tools` or `stream()` here. Tools and streaming belong to Claw.
    // Agentic is a capability dispatcher — createClaw(), createConductor(), think(), speak(), etc.
    // think() is for simple one-shot Q&A. For agentic tool loops, use createClaw().
    // For multi-intent dispatch with parallel workers, use createConductor().

    // ════════════════════════════════════════════════════════════════
    // STEP — single-turn LLM call, caller controls tool loop
    // ════════════════════════════════════════════════════════════════

    async step(messages, opts = {}) {
      const core = this._need('agentic-core')
      if (!core.agenticStep) throw new Error('agentic-core does not support step() — update to latest version')

      const config = {
        provider: opts.provider || this._cfgFor('llm', 'provider'),
        baseUrl: opts.baseUrl || this._cfgFor('llm', 'baseUrl'),
        apiKey: opts.apiKey || this._cfgFor('llm', 'apiKey'),
        model: opts.model || this._cfgFor('llm', 'model'),
        system: opts.system || this._opts.system,
        stream: opts.stream || false,
        proxyUrl: opts.proxyUrl || this._opts.proxyUrl,
        emit: opts.emit,
      }
      if (opts.tools) config.tools = opts.tools
      if (opts.signal) config.signal = opts.signal

      return core.agenticStep(messages, config)
    }

    // Helper: build tool result messages after executing tools
    buildToolResults(toolCalls, results) {
      const core = this._need('agentic-core')
      if (core.buildToolResults) return core.buildToolResults(toolCalls, results)
      // Fallback
      return toolCalls.map((tc, i) => {
        const r = results[i]
        const content = r.error ? JSON.stringify({ error: r.error }) : JSON.stringify(r.output ?? r)
        return { role: 'tool', tool_call_id: tc.id, content }
      })
    }

    // ════════════════════════════════════════════════════════════════
    // SPEAK — agentic-voice TTS, delegates to core for network
    // ════════════════════════════════════════════════════════════════

    _core() {
      return load('agentic-core')
    }

    _tts() {
      return this._get('tts', () => {
        const v = this._need('agentic-voice')
        const c = this._cfgAll('tts')
        return v.createTTS({
          provider: c.provider || 'openai',
          baseUrl: c.baseUrl,
          apiKey: c.apiKey,
          voice: c.voice, model: c.model,
          core: this._core(),
        })
      })
    }

    _hasVoice() { return !!load('agentic-voice') }

    async speak(text, opts) {
      if (this._ws) {
        const result = await this._ws.rpc('speak', { text, options: opts })
        // result.audio is base64
        if (typeof Buffer !== 'undefined') return Buffer.from(result.audio, 'base64')
        const bin = atob(result.audio)
        const arr = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
        return arr.buffer
      }
      return this._tts().fetchAudio(text, opts)
    }

    async speakAloud(text, opts) { return this._tts().speak(text, opts) }
    async speakStream(stream, opts) { return this._tts().speakStream(stream, opts) }
    async timestamps(text, opts) { return this._tts().timestamps(text, opts) }
    stopSpeaking() { if (this._i.tts) this._i.tts.stop() }

    // ════════════════════════════════════════════════════════════════
    // LISTEN — agentic-voice STT, delegates to core for network
    // ════════════════════════════════════════════════════════════════

    _stt() {
      return this._get('stt', () => {
        const v = this._need('agentic-voice')
        const c = this._cfgAll('stt')
        return v.createSTT({
          provider: c.provider || 'openai',
          baseUrl: c.baseUrl,
          apiKey: c.apiKey,
          model: c.model,
          core: this._core(),
        })
      })
    }

    async listen(audio, opts) {
      if (this._ws) {
        const b64 = typeof audio === 'string' ? audio
          : (typeof Buffer !== 'undefined' && Buffer.isBuffer(audio)) ? audio.toString('base64')
          : _toBase64(audio)
        const result = await this._ws.rpc('listen', { audio: b64, options: opts })
        return result.text
      }
      return this._stt().transcribe(audio, opts)
    }

    async listenWithTimestamps(audio, opts) { return this._stt().transcribeWithTimestamps(audio, opts) }
    startListening(onResult, onError) { return this._stt().startListening(onResult, onError) }
    stopListening() { if (this._i.stt) this._i.stt.stopListening() }

    // ════════════════════════════════════════════════════════════════
    // SEE — agentic-core + images
    // ════════════════════════════════════════════════════════════════

    async see(image, prompt = '描述这张图片', opts = {}) {
      const b64 = typeof image === 'string' ? image : _toBase64(image)
      if (this._ws) {
        const messages = [{ role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
        ]}]
        const result = await this._ws.rpc('see', { messages, options: opts })
        return result.text
      }
      return this.think(prompt, { ...opts, images: [{ url: `data:image/jpeg;base64,${b64}` }] })
    }

    // ════════════════════════════════════════════════════════════════
    // CONVERSE — listen → think → speak
    // ════════════════════════════════════════════════════════════════

    async converse(audio, opts = {}) {
      const transcript = await this.listen(audio)
      const result = await this.think(transcript, opts)
      const answer = typeof result === 'string' ? result : result.answer || ''
      const audioOut = await this.speak(answer)
      return { text: answer, audio: audioOut, transcript }
    }

    // ════════════════════════════════════════════════════════════════
    // REMEMBER / RECALL — agentic-memory
    // ════════════════════════════════════════════════════════════════

    _mem() {
      return this._get('mem', () => this._need('agentic-memory').createMemory({ knowledge: true, ...this._opts.memory }))
    }

    async remember(text, meta = {}) {
      const id = meta.id || `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      await this._mem().learn(id, text, meta)
      return id
    }

    async recall(query, opts) { return this._mem().recall(query, opts) }
    async addMessage(role, content) { return this._mem().add(role, content) }

    // ════════════════════════════════════════════════════════════════
    // SAVE / LOAD — agentic-store
    // ════════════════════════════════════════════════════════════════

    async _store() {
      if (!this._i.store) {
        const storeOpts = this._opts.store || {}
        // Accept a pre-created store instance
        if (storeOpts.instance) {
          this._i.store = storeOpts.instance
        } else {
          const mod = this._need('agentic-store')
          const name = storeOpts.name || 'agentic'
          const s = await mod.createStore(name, storeOpts)
          this._i.store = s
        }
      }
      return this._i.store
    }

    async save(key, value) { const s = await this._store(); return s.set(key, value) }
    async load(key) { const s = await this._store(); return s.get(key) }
    async has(key) { const s = await this._store(); return s.has(key) }
    async keys() { const s = await this._store(); return s.keys() }
    async deleteKey(key) { const s = await this._store(); return s.delete(key) }
    async query(sql, params) { const s = await this._store(); return s.all(sql, params) }
    async sql(sql, params) { const s = await this._store(); return s.run(sql, params) }
    async exec(sql, params) { const s = await this._store(); return s.exec(sql, params) }

    // ════════════════════════════════════════════════════════════════
    // EMBED — agentic-embed
    // ════════════════════════════════════════════════════════════════

    _embedLib() { return this._need('agentic-embed') }

    async _embedIndex() {
      return this._get('embedIndex', async () => {
        const mod = this._embedLib()
        return mod.create({ ...this._opts.embed })
      })
    }

    async embed(text) {
      if (this._ws) {
        const result = await this._ws.rpc('embed', { text: Array.isArray(text) ? text[0] : text })
        return result.embedding
      }
      return this._embedLib().localEmbed(Array.isArray(text) ? text : [text])[0]
    }
    async index(id, text, meta) { const idx = await this._embedIndex(); return idx.add(id, text, meta) }
    async indexMany(docs) { const idx = await this._embedIndex(); return idx.addMany(docs) }
    async search(query, opts) { const idx = await this._embedIndex(); return idx.search(query, opts) }

    // ════════════════════════════════════════════════════════════════
    // PERCEIVE — agentic-sense
    // ════════════════════════════════════════════════════════════════

    _sense() {
      return this._get('sense', () => new (this._need('agentic-sense').AgenticSense)())
    }

    async perceive(frame) { return this._sense().detect(frame) }

    // ════════════════════════════════════════════════════════════════
    // DECIDE / ACT — agentic-act
    // ════════════════════════════════════════════════════════════════

    _act() {
      const o = this._opts
      return this._get('act', () => new (this._need('agentic-act').AgenticAct)({
        apiKey: o.apiKey, model: o.model, baseUrl: o.baseUrl, provider: o.provider,
      }))
    }

    async decide(input) { return this._act().decide(input) }
    async act(input) { return this._act().run(input) }

    // ════════════════════════════════════════════════════════════════
    // RENDER — agentic-render
    // ════════════════════════════════════════════════════════════════

    createRenderer(target, opts) {
      const mod = this._need('agentic-render')
      return mod.createRenderer(target, opts)
    }

    // ════════════════════════════════════════════════════════════════
    // FILESYSTEM — agentic-filesystem
    // ════════════════════════════════════════════════════════════════

    _fs() {
      return this._get('fs', () => {
        const mod = this._need('agentic-filesystem')
        const o = this._opts.fs || {}
        const Backend = o.backend === 'memory' ? mod.MemoryStorage
          : (mod.NodeFsBackend || mod.MemoryStorage)
        return new mod.AgenticFileSystem(Backend ? new Backend(o) : undefined)
      })
    }

    async readFile(path) { const r = await this._fs().read(path); return r?.content !== undefined ? r.content : r }
    async writeFile(path, content) { return this._fs().write(path, content) }
    async deleteFile(path) { return this._fs().delete(path) }
    async ls(prefix) { const r = await this._fs().ls(prefix); return Array.isArray(r) ? r.map(e => e?.name || e) : r }
    async tree(prefix) { return this._fs().tree(prefix) }
    async grep(pattern, opts) { return this._fs().grep(pattern, opts) }
    async semanticGrep(query) { return this._fs().semanticGrep(query) }

    // ════════════════════════════════════════════════════════════════
    // RUN — agentic-shell
    // ════════════════════════════════════════════════════════════════

    _shell() {
      return this._get('shell', () => new (this._need('agentic-shell').AgenticShell)(this._fs()))
    }

    async run(command) { return this._shell().exec(command) }

    // ════════════════════════════════════════════════════════════════
    // SPATIAL — agentic-spatial
    // ════════════════════════════════════════════════════════════════

    async reconstructSpace(images, opts = {}) {
      const o = this._opts
      return this._need('agentic-spatial').reconstructSpace({
        images, apiKey: o.apiKey, model: o.model,
        baseUrl: o.baseUrl, provider: o.provider, ...opts,
      })
    }

    createSpatialSession(opts = {}) {
      const o = this._opts
      return new (this._need('agentic-spatial').SpatialSession)({
        apiKey: o.apiKey, model: o.model,
        baseUrl: o.baseUrl, provider: o.provider, ...opts,
      })
    }

    // ════════════════════════════════════════════════════════════════
    // CLAW — agentic-claw agent runtime
    // ════════════════════════════════════════════════════════════════

    createClaw(opts = {}) {
      const clawMod = this._need('agentic-claw')
      const o = this._opts
      return clawMod.createClaw({
        apiKey: o.apiKey, provider: o.provider,
        baseUrl: o.baseUrl, model: o.model,
        systemPrompt: o.system,
        ...opts,
      })
    }

    // ════════════════════════════════════════════════════════════════
    // CONDUCTOR — multi-intent dispatch engine
    // ════════════════════════════════════════════════════════════════

    createConductor(opts = {}) {
      const conductorMod = this._need('agentic-conductor')
      const o = this._opts

      // Build an AI adapter that uses this Agentic instance
      const aiAdapter = {
        chat: (messages, chatOpts = {}) => this.think(
          messages[messages.length - 1]?.content || '',
          {
            history: messages.slice(0, -1),
            system: chatOpts.system,
            tools: chatOpts.tools,
          }
        ).then(r => ({ answer: r.answer || r.content || r.text, usage: r.usage }))
      }

      // Use agentic-store if available, otherwise conductor's built-in memoryStore
      let store = opts.store
      if (!store) {
        try {
          const storeMod = load('agentic-store')
          if (storeMod) {
            // Lazy: will be initialized on first use
            store = null // let conductor use its built-in memoryStore for now
            // TODO: auto-create agentic-store instance when persist option is set
          }
        } catch {}
      }

      return conductorMod.createConductor({
        ai: aiAdapter,
        systemPrompt: o.system || opts.systemPrompt,
        ...opts,
        store,
      })
    }

    // ════════════════════════════════════════════════════════════════
    // ADMIN — agentic-service management (requires serviceUrl → WS)
    // ════════════════════════════════════════════════════════════════

    get admin() {
      if (!this._ws) return null
      const rpc = (method, params) => this._ws.rpc(method, params)
      return this._get('admin', () => ({
        health: () => rpc('health'),
        status: () => rpc('status'),
        perf: () => rpc('perf'),
        config: (newConfig) => newConfig ? rpc('config.set', newConfig) : rpc('config.get'),
        devices: () => rpc('devices'),
        models: () => rpc('models'),
        engines: () => rpc('engines'),
        queueStats: () => rpc('queue.stats'),
        assignments: (updates) => updates ? rpc('assignments.set', updates) : rpc('assignments.get'),
        addToPool: (model) => rpc('pool.add', model),
        removeFromPool: (id) => rpc('pool.remove', { id }),
      }))
    }

    // ════════════════════════════════════════════════════════════════
    // DISCOVERY + LIFECYCLE
    // ════════════════════════════════════════════════════════════════

    capabilities() {
      const has = name => !!load(name)
      const ws = !!this._ws
      return {
        think: ws || has('agentic-core'),
        speak: ws || has('agentic-voice'),
        listen: ws || has('agentic-voice'),
        see: ws || has('agentic-core'),
        converse: (ws || has('agentic-core')) && (ws || has('agentic-voice')),
        remember: has('agentic-memory'), recall: has('agentic-memory'),
        save: has('agentic-store'), load: has('agentic-store'),
        embed: ws || has('agentic-embed'), search: has('agentic-embed'),
        perceive: has('agentic-sense'),
        decide: has('agentic-act'), act: has('agentic-act'),
        render: has('agentic-render'),
        readFile: has('agentic-filesystem'),
        run: has('agentic-shell'),
        spatial: has('agentic-spatial'),
        claw: has('agentic-claw'),
        conductor: has('agentic-conductor'),
        admin: ws,
      }
    }

    /** Reconfigure this instance (merges into existing config) */
    configure(opts = {}) {
      Object.assign(this._opts, opts)
      for (const cap of ['llm', 'tts', 'stt', 'embed']) {
        if (opts[cap]) this._cfg[cap] = { ...this._cfg[cap], ...opts[cap] }
      }
      if (opts.serviceUrl) {
        this._serviceUrl = opts.serviceUrl.replace(/\/+$/, '')
        if (this._ws) this._ws.close()
        this._ws = createWsConnection(this._serviceUrl)
      }
      // Clear cached instances so they pick up new config
      this._i = {}
      return this
    }

    /** URL of connected agentic-service, or null */
    get serviceUrl() { return this._serviceUrl }

    destroy() {
      if (this._ws) { this._ws.close(); this._ws = null }
      for (const inst of Object.values(this._i)) {
        if (inst?.destroy) inst.destroy()
        else if (inst?.close) inst.close()
        else if (inst?.stopListening) inst.stopListening()
      }
      this._i = {}
    }
  }

  function _toBase64(input) {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) return input.toString('base64')
    if (input instanceof ArrayBuffer) {
      const b = new Uint8Array(input); let s = ''
      for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
      return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64')
    }
    return String(input)
  }

  const ai = new Agentic()
  return { Agentic, ai }
})

