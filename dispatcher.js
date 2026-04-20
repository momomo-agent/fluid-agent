/* dispatcher.js - Intent-driven Scheduler v3
 *
 * Watches IntentState for changes, maps intent actions to scheduling decisions.
 * Maintains intentId → workerId mapping.
 *
 * Talker writes intents → IntentState → Dispatcher reacts → Scheduler executes
 */
const Dispatcher = (() => {
  let _ai = null
  let _store = null
  const _workers = new Map()       // workerId → Worker state
  const _intentWorker = new Map()  // intentId → workerId
  const _workerIntent = new Map()  // workerId → intentId
  const _decisionLog = []
  const MAX_LOG = 50
  const MAX_TURNS = 30
  const STALL_THRESHOLD = 5

  let _nextWorkerId = 1

  function init(ai, store) {
    _ai = ai
    _store = store
    if (store) CheckpointStore.init(store)

    // Watch IntentState for changes
    if (typeof IntentState !== 'undefined') {
      IntentState.onChange((action, intent) => {
        _handleIntentChange(action, intent)
      })
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Intent → Scheduling mapping (the core logic)
  // ═══════════════════════════════════════════════════════════════

  function _handleIntentChange(action, intent) {
    console.log(`[Dispatcher] Intent ${action}: ${intent.id} "${intent.goal.slice(0, 60)}"`)

    switch (action) {
      case 'create': {
        // New intent → spawn a Worker
        const workerId = _nextWorkerId++
        _intentWorker.set(intent.id, workerId)
        _workerIntent.set(workerId, intent.id)
        EventBus.emit('dispatcher.spawn', { intentId: intent.id, workerId, task: intent.goal })
        // Enqueue in Scheduler
        Scheduler.enqueue(intent.goal, [], 1, [], { intentId: intent.id, workerId })
        break
      }

      case 'update': {
        // Intent updated → steer existing Worker with full context
        const workerId = _intentWorker.get(intent.id)
        if (workerId != null) {
          const w = _workers.get(workerId)
          if (w && w.status === 'running') {
            // Build steer instruction from goal + recent messages
            const context = intent.messages.length > 0
              ? `Goal: ${intent.goal}\nUser messages: ${intent.messages.slice(-3).join(' → ')}`
              : intent.goal
            w.task = intent.goal
            EventBus.emit('dispatcher.steer', { workerId, instruction: context })
            Scheduler.steer(w.schedulerTaskId || null, context)
            console.log(`[Dispatcher] Steered Worker #${workerId} → "${intent.goal.slice(0, 60)}"`)  
          } else {
            // Worker finished/not started yet — re-enqueue with updated goal
            Scheduler.enqueue(intent.goal, [], 1, [], { intentId: intent.id, workerId })
          }
        } else {
          // No worker for this intent yet (shouldn't happen, but handle gracefully)
          _handleIntentChange('create', intent)
        }
        break
      }

      case 'cancel': {
        const workerId = _intentWorker.get(intent.id)
        if (workerId != null) {
          Scheduler.abort(workerId)
          _cleanup(workerId)
          EventBus.emit('dispatcher.abort', { workerId, reason: 'intent_cancelled' })
        }
        break
      }

      case 'done': {
        const workerId = _intentWorker.get(intent.id)
        if (workerId != null) {
          _cleanup(workerId)
        }
        break
      }
    }
  }

  function _cleanup(workerId) {
    const intentId = _workerIntent.get(workerId)
    _workers.delete(workerId)
    _workerIntent.delete(workerId)
    if (intentId) _intentWorker.delete(intentId)
    if (_store) CheckpointStore.markDone(String(workerId)).catch(() => {})
  }

  // ═══════════════════════════════════════════════════════════════
  // Worker Registry (called by agent.js worker loop)
  // ═══════════════════════════════════════════════════════════════

  function registerWorker(id, task, steps, opts = {}) {
    _workers.set(id, {
      id,
      task,
      steps,
      status: 'running',
      turnCount: 0,
      stallTurns: 0,
      lastTool: null,
      lastResult: null,
      lastResultSummary: '',
      priority: opts.priority || 1,
      createdAt: Date.now(),
      suspendedAt: null,
      messages: opts.messages || [],
      tools: opts.tools || [],
      system: opts.system || '',
      completedSteps: [],
      totalTokens: 0,
      toolCallCount: 0,
      schedulerTaskId: opts.schedulerTaskId || null,
    })
  }

  function updateWorker(id, update) {
    const w = _workers.get(id)
    if (!w) return
    Object.assign(w, update)
    if (update.lastResult) {
      w.stallTurns = 0
    } else if (update.turnCount > w.turnCount) {
      w.stallTurns++
    }
  }

  function removeWorker(id) { _cleanup(id) }
  function getWorker(id) { return _workers.get(id) }
  function nextWorkerId() { return _nextWorkerId++ }

  // ═══════════════════════════════════════════════════════════════
  // Worker turn lifecycle (guardrails)
  // ═══════════════════════════════════════════════════════════════

  async function beforeTurn(workerId) {
    return { action: 'continue' }
  }

  async function afterTurn(workerId, turnResult) {
    const w = _workers.get(workerId)
    if (!w) return { action: 'continue' }

    w.turnCount++
    if (turnResult.toolCalls?.length) {
      w.lastTool = turnResult.toolCalls[0].name
      w.toolCallCount += turnResult.toolCalls.length
      w.stallTurns = 0
    }
    if (turnResult.text) {
      w.lastResultSummary = turnResult.text.slice(0, 100)
      w.stallTurns = 0
    }

    // Checkpoint
    if (_store) {
      const checkpoint = CheckpointStore.buildCheckpoint(w, {
        workers: Array.from(_workers.values()).map(wk => ({ id: wk.id, task: wk.task, status: wk.status })),
        decisionLog: _decisionLog.slice(-10),
      })
      await CheckpointStore.save(String(workerId), w.turnCount, checkpoint)
    }

    // Guardrails
    if (w.turnCount >= MAX_TURNS) {
      _logDecision({ action: 'abort', workerId, reason: 'max_turns_exceeded' }, null, 'guardrail')
      return { action: 'abort', workerId, reason: 'max_turns_exceeded' }
    }
    if (w.stallTurns >= STALL_THRESHOLD) {
      _logDecision({ action: 'steer', workerId, instruction: '你似乎卡住了,尝试换个方法或总结当前进度' }, null, 'guardrail')
      return { action: 'steer', workerId, instruction: '你似乎卡住了,尝试换个方法或总结当前进度' }
    }

    return { action: 'continue' }
  }

  // ═══════════════════════════════════════════════════════════════
  // State for Talker's system prompt
  // ═══════════════════════════════════════════════════════════════

  function getStateSummary() {
    return {
      workers: Array.from(_workers.values()).map(w => ({
        id: w.id,
        task: w.task.slice(0, 60),
        status: w.status,
        turnCount: w.turnCount,
        lastTool: w.lastTool,
        priority: w.priority,
        elapsed: Math.round((Date.now() - w.createdAt) / 1000),
        intentId: _workerIntent.get(w.id) || null,
      })),
      freeSlots: Scheduler.MAX_SLOTS - Array.from(_workers.values()).filter(w => w.status === 'running').length,
    }
  }

  function getState() {
    const s = getStateSummary()
    return {
      running: s.workers.filter(w => w.status === 'running'),
      pending: s.workers.filter(w => w.status === 'suspended'),
    }
  }

  function formatForTalker() {
    const s = getStateSummary()
    const activeIntents = typeof IntentState !== 'undefined' ? IntentState.active() : []

    if (s.workers.length === 0 && activeIntents.length === 0) {
      return '\n## System State\nNo active tasks. Ready for new work.\n'
    }

    let out = '\n## System State\n'
    if (s.workers.length) {
      out += 'Workers:\n'
      for (const w of s.workers) {
        const intentId = w.intentId ? ` [${w.intentId}]` : ''
        out += `- #${w.id}${intentId}: "${w.task}" [${w.status}] (turn ${w.turnCount}, last: ${w.lastTool || 'none'})\n`
      }
    }
    out += `Slots: ${Scheduler.MAX_SLOTS - s.freeSlots}/${Scheduler.MAX_SLOTS}\n`
    return out
  }

  // ═══════════════════════════════════════════════════════════════
  // Resume from checkpoint
  // ═══════════════════════════════════════════════════════════════

  async function checkForResume() {
    if (!_store) return []
    return await CheckpointStore.listUnfinished()
  }

  async function resumeWorker(workerId) {
    const checkpoint = await CheckpointStore.restoreLatest(String(workerId))
    if (!checkpoint) return null
    registerWorker(workerId, checkpoint.task, checkpoint.worker.steps, {
      priority: 1,
      messages: checkpoint.worker.messages,
      tools: checkpoint.worker.tools,
      system: checkpoint.worker.system,
    })
    const w = _workers.get(workerId)
    if (w) {
      w.turnCount = checkpoint.turnIndex
      w.completedSteps = checkpoint.worker.completedSteps
    }
    EventBus.emit('dispatcher.resumed', { workerId, fromTurn: checkpoint.turnIndex })
    return checkpoint
  }

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  function _logDecision(decision, obs, source) {
    _decisionLog.push({ ...decision, source, timestamp: Date.now() })
    if (_decisionLog.length > MAX_LOG) _decisionLog.shift()
  }

  // Legacy compat: handleIntent for any code still calling it
  function handleIntent(intent, priority) {
    console.warn('[Dispatcher] handleIntent is deprecated, use IntentState.create/update instead')
    if (typeof IntentState !== 'undefined') {
      IntentState.create(intent?.task || intent)
    }
  }

  return {
    init, registerWorker, updateWorker, removeWorker, getWorker, nextWorkerId,
    handleIntent,
    beforeTurn, afterTurn,
    checkForResume, resumeWorker,
    getStateSummary, getState, formatForTalker,
    get decisionLog() { return _decisionLog },
  }
})()
