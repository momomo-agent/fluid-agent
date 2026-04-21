/* dispatcher.js - Intent-driven Dispatcher v4
 *
 * Watches IntentState for changes, maps intent actions to scheduling decisions.
 * All state persisted to VFS under /proc/workers/ — no separate checkpoint store.
 *
 * Talker writes intents → IntentState → Dispatcher reacts → Scheduler executes
 */
const Dispatcher = (() => {
  let _ai = null
  const _workers = new Map()       // workerId → Worker state
  const _intentWorker = new Map()  // intentId → workerId
  const _workerIntent = new Map()  // workerId → intentId
  const _decisionLog = []
  const MAX_LOG = 50
  const MAX_TURNS = 30
  const STALL_THRESHOLD = 5

  let _nextWorkerId = 1
  let _pendingDeps = new Map()  // intentId → intent (waiting for dependencies)
  let _dispatchMode = 'llm'   // 'code' | 'llm' — default LLM per kenefe 4/21

  // ═══════════════════════════════════════════════════════════════
  // VFS persistence — /proc/workers/{id}.json
  // ═══════════════════════════════════════════════════════════════

  const PROC_DIR = '/proc/workers'

  function _ensureProcDir() {
    if (typeof VFS !== 'undefined' && !VFS.isDir(PROC_DIR)) {
      VFS.mkdir(PROC_DIR)
    }
  }

  function _saveWorker(workerId) {
    if (typeof VFS === 'undefined') return
    _ensureProcDir()
    const w = _workers.get(workerId)
    if (!w) return
    const intentId = _workerIntent.get(workerId)
    VFS.writeFile(`${PROC_DIR}/${workerId}.json`, JSON.stringify({
      id: w.id,
      task: w.task,
      status: w.status,
      steps: w.steps || [],
      completedSteps: w.completedSteps || [],
      turnCount: w.turnCount || 0,
      intentId: intentId || null,
      messages: (w.messages || []).slice(-20),  // keep last 20 turns for resume
      system: w.system || '',
      tools: w.tools || [],
      createdAt: w.createdAt || Date.now(),
      updatedAt: Date.now(),
      totalTokens: w.totalTokens || 0,
      toolCallCount: w.toolCallCount || 0,
      error: w.error || null,
    }, null, 2))
  }

  function _removeWorkerFile(workerId) {
    if (typeof VFS !== 'undefined' && VFS.isFile(`${PROC_DIR}/${workerId}.json`)) {
      VFS.rm(`${PROC_DIR}/${workerId}.json`)
    }
  }

  function _saveMeta() {
    if (typeof VFS === 'undefined') return
    _ensureProcDir()
    VFS.writeFile(`${PROC_DIR}/meta.json`, JSON.stringify({
      nextWorkerId: _nextWorkerId,
      intentWorker: Object.fromEntries(_intentWorker),
      workerIntent: Object.fromEntries(_workerIntent),
    }, null, 2))
  }

  // ═══════════════════════════════════════════════════════════════
  // Init + Restore
  // ═══════════════════════════════════════════════════════════════

  function init(ai) {
    _ai = ai
    _ensureProcDir()

    // Restore state from VFS
    _restore()

    // Watch IntentState for changes
    if (typeof IntentState !== 'undefined') {
      IntentState.onChange((action, intent) => {
        _handleIntentChange(action, intent)
      })
    }
  }

  function _restore() {
    if (typeof VFS === 'undefined') return

    // Restore meta
    if (VFS.isFile(`${PROC_DIR}/meta.json`)) {
      try {
        const meta = JSON.parse(VFS.readFile(`${PROC_DIR}/meta.json`))
        _nextWorkerId = meta.nextWorkerId || 1
        if (meta.intentWorker) {
          for (const [k, v] of Object.entries(meta.intentWorker)) {
            _intentWorker.set(k, v)
          }
        }
        if (meta.workerIntent) {
          for (const [k, v] of Object.entries(meta.workerIntent)) {
            _workerIntent.set(Number(k), v)
          }
        }
      } catch { /* corrupt meta, start fresh */ }
    }

    // Restore workers
    const entries = VFS.ls(PROC_DIR)
    if (!entries) return
    for (const entry of entries) {
      if (entry.name === 'meta.json' || !entry.name.endsWith('.json')) continue
      try {
        const data = JSON.parse(VFS.readFile(`${PROC_DIR}/${entry.name}`))
        _workers.set(data.id, {
          id: data.id,
          task: data.task,
          status: data.status === 'running' ? 'suspended' : data.status,  // running → suspended on restore
          steps: data.steps || [],
          completedSteps: data.completedSteps || [],
          turnCount: data.turnCount || 0,
          messages: data.messages || [],
          system: data.system || '',
          tools: data.tools || [],
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          totalTokens: data.totalTokens || 0,
          toolCallCount: data.toolCallCount || 0,
        })
        if (data.id >= _nextWorkerId) _nextWorkerId = data.id + 1
      } catch { /* skip corrupt files */ }
    }

    const suspended = Array.from(_workers.values()).filter(w => w.status === 'suspended')
    if (suspended.length > 0) {
      console.log(`[Dispatcher] Restored ${suspended.length} suspended workers from VFS`)
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Intent → Scheduling mapping (the core logic)
  // ═══════════════════════════════════════════════════════════════

  function _handleIntentChange(action, intent) {
    console.log(`[Dispatcher] Intent ${action}: ${intent.id} "${intent.goal.slice(0, 60)}"${_dispatchMode === 'llm' ? ' [LLM mode]' : ''}`)

    // LLM mode: delegate scheduling decisions to LLM
    if (_dispatchMode === 'llm' && (action === 'create' || action === 'update')) {
      _handleIntentLLM(action, intent)
      return
    }

    switch (action) {
      case 'create': {
        // Check dependencies
        if (intent.dependsOn && intent.dependsOn.length > 0) {
          const unmet = intent.dependsOn.filter(depId => {
            const dep = IntentState.get(depId)
            return !dep || dep.status !== 'done'
          })
          if (unmet.length > 0) {
            _pendingDeps.set(intent.id, intent)
            console.log(`[Dispatcher] Intent ${intent.id} waiting on: ${unmet.join(', ')}`)
            return
          }
        }
        _spawnWorkerForIntent(intent)
        break
      }

      case 'update': {
        const workerId = _intentWorker.get(intent.id)
        if (workerId != null) {
          const w = _workers.get(workerId)
          if (w && w.status === 'running') {
            const context = intent.messages.length > 0
              ? `Goal: ${intent.goal}\nUser messages: ${intent.messages.slice(-3).join(' → ')}`
              : intent.goal
            w.task = intent.goal
            _saveWorker(workerId)
            EventBus.emit('dispatcher.steer', { workerId, instruction: context })
            Scheduler.steer(w.schedulerTaskId || null, context)
            console.log(`[Dispatcher] Steered Worker #${workerId} → "${intent.goal.slice(0, 60)}"`)
          } else {
            Scheduler.enqueue(intent.goal, [], 1, [], { intentId: intent.id, workerId })
          }
        } else {
          _handleIntentChange('create', intent)
        }
        break
      }

      case 'cancel': {
        const workerId = _intentWorker.get(intent.id)
        if (workerId != null) {
          const w = _workers.get(workerId)
          if (w) {
            w.status = 'cancelled'
            _saveWorker(workerId)
          }
          Scheduler.abort(workerId)
          EventBus.emit('dispatcher.cancel', { workerId, intentId: intent.id })
          console.log(`[Dispatcher] Cancelled Worker #${workerId}`)
        }
        break
      }

      case 'running':
        break

      case 'done':
      case 'failed': {
        // Check if any pending intents can now proceed
        _checkPendingDeps()
        break
      }
    }
  }

  // Spawn a worker for an intent (extracted for reuse)
  function _spawnWorkerForIntent(intent) {
    IntentState.running(intent.id)
    const workerId = _nextWorkerId++
    _intentWorker.set(intent.id, workerId)
    _workerIntent.set(workerId, intent.id)
    _saveMeta()

    // Inject dependency artifacts into goal context
    let enrichedGoal = intent.goal
    if (intent.dependsOn && intent.dependsOn.length > 0) {
      const depContext = intent.dependsOn.map(depId => {
        const dep = IntentState.get(depId)
        if (!dep) return null
        let ctx = `[${depId}] "${dep.goal}" → ${dep.status}`
        if (dep.result?.summary) ctx += `: ${dep.result.summary.slice(0, 200)}`
        if (dep.artifacts?.length > 0) ctx += ` | artifacts: ${dep.artifacts.join(', ')}`
        return ctx
      }).filter(Boolean)
      if (depContext.length > 0) {
        enrichedGoal += `\n\nDependency results:\n${depContext.join('\n')}`
      }
    }

    EventBus.emit('dispatcher.spawn', { intentId: intent.id, workerId, task: enrichedGoal })
    Scheduler.enqueue(enrichedGoal, [], 1, [], { intentId: intent.id, workerId })
  }

  // Check pending intents whose dependencies may now be satisfied
  function _checkPendingDeps() {
    for (const [intentId, intent] of _pendingDeps) {
      const unmet = (intent.dependsOn || []).filter(depId => {
        const dep = IntentState.get(depId)
        return !dep || dep.status !== 'done'
      })
      // If any dependency failed, fail this intent too
      const failed = (intent.dependsOn || []).filter(depId => {
        const dep = IntentState.get(depId)
        return dep && dep.status === 'failed'
      })
      if (failed.length > 0) {
        _pendingDeps.delete(intentId)
        IntentState.fail(intentId, `Dependency failed: ${failed.join(', ')}`)
        continue
      }
      if (unmet.length === 0) {
        _pendingDeps.delete(intentId)
        console.log(`[Dispatcher] Dependencies met for ${intentId}, spawning worker`)
        _spawnWorkerForIntent(IntentState.get(intentId) || intent)
      }
    }
  }

  // LLM-based dispatch (experimental)
  async function _handleIntentLLM(action, intent) {
    if (!_ai) {
      console.warn('[Dispatcher] LLM mode but no AI instance, falling back to code mode')
      _dispatchMode = 'code'
      _handleIntentChange(action, intent)
      return
    }
    const allIntents = IntentState.all()
    const workers = Array.from(_workers.values()).filter(w => w.status === 'running' || w.status === 'suspended')
    const prompt = `You are a task dispatcher. Given the current state, decide what to do.

Event: ${action} intent ${intent.id} "${intent.goal}"

All intents:\n${allIntents.map(i => `- ${i.id}: "${i.goal}" (${i.status})${i.dependsOn?.length ? ' depends:' + i.dependsOn.join(',') : ''}`).join('\n')}

Active workers:\n${workers.map(w => `- Worker #${w.id}: "${w.task.slice(0, 60)}" (turn ${w.turnCount})`).join('\n') || 'none'}

Free slots: ${Scheduler.MAX_SLOTS - workers.length}

Respond with JSON: {"ops": [{"type": "spawn"|"steer"|"cancel"|"wait", "intentId": "...", "reason": "..."}]}`

    try {
      const resp = await _ai.chat([{ role: 'user', content: prompt }], { max_tokens: 300 })
      const text = resp?.content?.[0]?.text || resp?.text || ''
      const match = text.match(/\{[\s\S]*\}/)
      if (match) {
        const decision = JSON.parse(match[0])
        for (const op of (decision.ops || [])) {
          console.log(`[Dispatcher LLM] ${op.type} ${op.intentId}: ${op.reason || ''}`)
          if (op.type === 'spawn') {
            const target = IntentState.get(op.intentId)
            if (target && target.status === 'active') _spawnWorkerForIntent(target)
          } else if (op.type === 'cancel') {
            IntentState.cancel(op.intentId)
          } else if (op.type === 'steer' && op.instruction) {
            const wId = _intentWorker.get(op.intentId)
            if (wId) Scheduler.steer(null, op.instruction)
          }
          // 'wait' = do nothing, dependency not met
        }
      }
    } catch (e) {
      console.error('[Dispatcher] LLM dispatch failed, falling back to code:', e.message)
      _dispatchMode = 'code'
      _handleIntentChange(action, intent)
    }
  }

  function setDispatchMode(mode) {
    if (mode === 'code' || mode === 'llm') {
      _dispatchMode = mode
      console.log(`[Dispatcher] Mode → ${mode}`)
    }
  }

  function getDispatchMode() { return _dispatchMode }

  // ═══════════════════════════════════════════════════════════════
  // Worker lifecycle
  // ═══════════════════════════════════════════════════════════════

  function nextWorkerId() { return _nextWorkerId }

  function registerWorker(workerId, task, steps) {
    _workers.set(workerId, {
      id: workerId,
      task,
      steps: steps || [],
      completedSteps: [],
      status: 'running',
      turnCount: 0,
      messages: [],
      system: '',
      tools: [],
      createdAt: Date.now(),
      totalTokens: 0,
      toolCallCount: 0,
    })
    _saveWorker(workerId)
    _logDecision(workerId, 'start', `Started: ${task.slice(0, 60)}`)
  }

  function updateWorker(workerId, updates) {
    const w = _workers.get(workerId)
    if (!w) return
    Object.assign(w, updates)
    _saveWorker(workerId)
  }

  function removeWorker(workerId) {
    _workers.delete(workerId)
    // Keep the VFS file for history — mark as done
    // _removeWorkerFile(workerId)  // uncomment to clean up immediately
  }

  function getWorker(id) { return _workers.get(id) }

  // ═══════════════════════════════════════════════════════════════
  // Turn management
  // ═══════════════════════════════════════════════════════════════

  function beforeTurn(workerId) {
    const w = _workers.get(workerId)
    if (!w) return { abort: false }
    w.turnCount = (w.turnCount || 0) + 1

    if (w.turnCount > MAX_TURNS) {
      _logDecision(workerId, 'abort', `Max turns (${MAX_TURNS}) exceeded`)
      return { abort: true, reason: `Maximum turns (${MAX_TURNS}) reached` }
    }
    return { abort: false }
  }

  function afterTurn(workerId, turnResult) {
    const w = _workers.get(workerId)
    if (!w) return

    // Track tokens
    if (turnResult?.usage) {
      w.totalTokens = (w.totalTokens || 0) + (turnResult.usage.input_tokens || 0) + (turnResult.usage.output_tokens || 0)
    }
    if (turnResult?.toolCalls) {
      w.toolCallCount = (w.toolCallCount || 0) + turnResult.toolCalls.length
    }

    // Stall detection
    if (turnResult?.noProgress) {
      w.stallCount = (w.stallCount || 0) + 1
      if (w.stallCount >= STALL_THRESHOLD) {
        _logDecision(workerId, 'stall', `Stalled ${w.stallCount} turns`)
      }
    } else {
      w.stallCount = 0
    }

    // Save state to VFS after every turn
    _saveWorker(workerId)

    // Push progress + artifacts back to intent
    const intentId = _workerIntent.get(workerId)
    if (intentId) {
      const changes = {}
      if (turnResult?.progress) changes.progress = turnResult.progress
      if (turnResult?.artifacts && turnResult.artifacts.length > 0) changes.artifacts = turnResult.artifacts
      if (changes.progress || changes.artifacts) IntentState.update(intentId, changes)
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Resume
  // ═══════════════════════════════════════════════════════════════

  async function checkForResume() {
    const suspended = Array.from(_workers.values()).filter(w => w.status === 'suspended')
    return suspended.map(w => ({
      workerId: w.id,
      task: w.task,
      turnCount: w.turnCount,
      updatedAt: w.updatedAt,
    }))
  }

  async function resumeWorker(workerId) {
    const w = _workers.get(workerId)
    if (!w) return null
    w.status = 'running'
    _saveWorker(workerId)
    return {
      task: w.task,
      steps: w.steps,
      completedSteps: w.completedSteps,
      messages: w.messages,
      system: w.system,
      tools: w.tools,
      turnCount: w.turnCount,
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Completion
  // ═══════════════════════════════════════════════════════════════

  let _onResultsReady = null
  function onResultsReady(fn) { _onResultsReady = fn }

  function workerCompleted(workerId, result) {
    const w = _workers.get(workerId)
    if (w) {
      w.status = 'done'
      _saveWorker(workerId)
    }

    const intentId = _workerIntent.get(workerId)
    if (!intentId) {
      console.warn(`[Dispatcher] workerCompleted: no intent for worker #${workerId}`)
      return
    }
    const summary = result?.summary || ''
    const log = result?.log || []
    console.log(`[Dispatcher] Worker #${workerId} completed → intent ${intentId}: ${summary.slice(0, 80)}`)

    IntentState.done(intentId, { summary, log: log.slice(-10) })
    if (_onResultsReady) _onResultsReady()
  }

  function workerFailed(workerId, error) {
    const w = _workers.get(workerId)
    if (w) {
      w.status = 'failed'
      w.error = typeof error === 'string' ? error : (error?.message || 'Unknown error')
      _saveWorker(workerId)
    }

    const intentId = _workerIntent.get(workerId)
    if (!intentId) return
    console.log(`[Dispatcher] Worker #${workerId} failed → intent ${intentId}: ${error}`)
    IntentState.fail(intentId, error)
    if (_onResultsReady) _onResultsReady()
  }

  // ═══════════════════════════════════════════════════════════════
  // State queries
  // ═══════════════════════════════════════════════════════════════

  function _logDecision(workerId, type, detail) {
    _decisionLog.push({ workerId, type, detail, at: Date.now() })
    if (_decisionLog.length > MAX_LOG) _decisionLog.shift()
  }

  function getStateSummary() {
    const workers = Array.from(_workers.values())
    return {
      workers: workers.map(w => ({ id: w.id, task: w.task, status: w.status })),
      freeSlots: Scheduler.MAX_SLOTS - workers.filter(w => w.status === 'running').length,
    }
  }

  function getState() {
    return {
      workers: Array.from(_workers.values()).map(w => ({
        id: w.id, task: w.task, status: w.status,
        turnCount: w.turnCount, totalTokens: w.totalTokens,
      })),
      freeSlots: Scheduler.MAX_SLOTS - Array.from(_workers.values()).filter(w => w.status === 'running').length,
    }
  }

  function formatForTalker() {
    const workers = Array.from(_workers.values()).filter(w => w.status === 'running' || w.status === 'suspended')
    if (workers.length === 0) return ''
    let out = '\n## Active Workers\n'
    for (const w of workers) {
      out += `- Worker #${w.id}: "${w.task.slice(0, 60)}" (${w.status}, turn ${w.turnCount})\n`
    }
    return out
  }

  // GC: clean up old done/failed worker files
  function gc(keepMs = 7 * 86400_000) {
    if (typeof VFS === 'undefined') return
    const entries = VFS.ls(PROC_DIR)
    if (!entries) return
    const cutoff = Date.now() - keepMs
    for (const entry of entries) {
      if (entry.name === 'meta.json' || !entry.name.endsWith('.json')) continue
      try {
        const data = JSON.parse(VFS.readFile(`${PROC_DIR}/${entry.name}`))
        if ((data.status === 'done' || data.status === 'failed' || data.status === 'cancelled') && data.updatedAt < cutoff) {
          VFS.rm(`${PROC_DIR}/${entry.name}`)
          _workers.delete(data.id)
        }
      } catch {}
    }
  }

  return {
    init, registerWorker, updateWorker, removeWorker, getWorker, nextWorkerId,
    beforeTurn, afterTurn,
    checkForResume, resumeWorker,
    workerCompleted, workerFailed, onResultsReady,
    getStateSummary, getState, formatForTalker, gc,
    setDispatchMode, getDispatchMode,
    get decisionLog() { return _decisionLog },
  }
})()
