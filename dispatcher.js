/* dispatcher.js — Runtime Scheduler v2
 *
 * Observe → Decide → Act pattern with:
 *   - IntentQueue for priority-based intent management
 *   - CheckpointStore for turn-level persistence
 *   - Fast path (deterministic rules) + Slow path (LLM decisions)
 *
 * Three roles: Talker (shell) → Dispatcher (kernel) → Worker (process)
 */
const Dispatcher = (() => {
  let _ai = null
  let _store = null
  const _workers = new Map()  // workerId → Worker state
  const _decisionLog = []     // last N decisions for debugging
  const MAX_LOG = 50
  const MAX_TURNS = 30        // guardrail: max turns per Worker
  const STALL_THRESHOLD = 5   // guardrail: consecutive no-output turns

  let _nextWorkerId = 1

  function init(ai, store) {
    _ai = ai
    _store = store
    if (store) CheckpointStore.init(store)
  }

  // ═══════════════════════════════════════════════════════════════
  // Worker Registry
  // ═══════════════════════════════════════════════════════════════

  function registerWorker(id, task, steps, { priority = 1, messages = [], tools = [], system = '' } = {}) {
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
      priority,
      createdAt: Date.now(),
      suspendedAt: null,
      messages,
      tools,
      system,
      completedSteps: [],
      totalTokens: 0,
      toolCallCount: 0,
    })
  }

  function updateWorker(id, update) {
    const w = _workers.get(id)
    if (!w) return
    Object.assign(w, update)

    // Track stall
    if (update.lastResult) {
      w.stallTurns = 0
    } else if (update.turnCount > w.turnCount) {
      w.stallTurns++
    }
  }

  function removeWorker(id) { _workers.delete(id) }
  function getWorker(id) { return _workers.get(id) }
  function nextWorkerId() { return _nextWorkerId++ }

  // ═══════════════════════════════════════════════════════════════
  // Step 1: OBSERVE — Pure data collection, no LLM
  // ═══════════════════════════════════════════════════════════════

  function observe(trigger = 'turn_complete') {
    return {
      timestamp: Date.now(),
      trigger,  // 'turn_complete' | 'new_intent' | 'error' | 'worker_done'

      workers: Array.from(_workers.values()).map(w => ({
        id: w.id,
        task: w.task.slice(0, 80),
        status: w.status,
        turnCount: w.turnCount,
        maxTurns: MAX_TURNS,
        lastTool: w.lastTool,
        lastResultSummary: (w.lastResultSummary || '').slice(0, 100),
        elapsed: Math.round((Date.now() - w.createdAt) / 1000),
        stallTurns: w.stallTurns,
        priority: w.priority,
      })),

      intents: IntentQueue.getState().slice(0, 5),

      resources: {
        activeSlots: Array.from(_workers.values()).filter(w => w.status === 'running').length,
        maxSlots: Scheduler.MAX_SLOTS,
        pendingCount: IntentQueue.size(),
      },
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Step 2: DECIDE — Fast path first, then LLM
  // ═══════════════════════════════════════════════════════════════

  function fastPath(obs) {
    // Rule 1: Single Worker, no intents, just completed a turn → continue
    if (obs.workers.length === 1 && obs.intents.length === 0 &&
        obs.trigger === 'turn_complete' && obs.workers[0].status === 'running') {
      return { action: 'continue', reason: 'single_worker_no_intent' }
    }

    // Rule 2: Worker reported done → cleanup
    const doneWorker = obs.workers.find(w => w.status === 'done')
    if (doneWorker) {
      return { action: 'cleanup', workerId: doneWorker.id, reason: 'worker_done' }
    }

    // Rule 3: Urgent intent + single running Worker → immediate steer
    if (obs.intents.length > 0 && obs.intents[0].priority === 'urgent') {
      const running = obs.workers.filter(w => w.status === 'running')
      if (running.length === 1) {
        const intent = IntentQueue.dequeue()
        return { action: 'steer', workerId: running[0].id, instruction: intent?.intent?.task || intent?.intent, reason: 'urgent_intent' }
      }
    }

    // Rule 4: Worker exceeded max turns → force abort
    const overLimit = obs.workers.find(w => w.turnCount >= w.maxTurns && w.status === 'running')
    if (overLimit) {
      return { action: 'abort', workerId: overLimit.id, reason: 'max_turns_exceeded' }
    }

    // Rule 5: Worker stalled → steer
    const stalled = obs.workers.find(w => w.stallTurns >= STALL_THRESHOLD && w.status === 'running')
    if (stalled) {
      return { action: 'steer', workerId: stalled.id, instruction: '你似乎卡住了，尝试换个方法或总结当前进度', reason: 'stall_detected' }
    }

    // Rule 6: No running Workers + has pending intents → spawn new
    const running = obs.workers.filter(w => w.status === 'running')
    if (running.length === 0 && obs.intents.length > 0 && obs.resources.activeSlots < obs.resources.maxSlots) {
      const intent = IntentQueue.dequeue()
      if (intent) {
        return { action: 'new', task: intent.intent?.task || intent.intent, priority: intent.priority, reason: 'idle_with_intent' }
      }
    }

    return null  // Need LLM decision
  }

  async function decide(observation) {
    // Try fast path first
    const fast = fastPath(observation)
    if (fast) {
      _logDecision(fast, observation, 'fast')
      return fast
    }

    // Slow path: LLM decision
    if (!_ai) return { action: 'continue', reason: 'no_ai_fallback' }

    try {
      const prompt = buildDecisionPrompt(observation)
      const resp = await _ai.step(
        [{ role: 'user', content: prompt }],
        { system: DISPATCHER_SYSTEM, stream: false }
      )

      const text = resp?.content || resp?.text || (typeof resp === 'string' ? resp : '')
      const jsonMatch = text.match(/\{[\s\S]*?\}/)
      if (!jsonMatch) return { action: 'continue', reason: 'parse_failed' }

      const decision = JSON.parse(jsonMatch[0])
      _logDecision(decision, observation, 'llm')
      return decision
    } catch (err) {
      console.error('[Dispatcher.decide] LLM error:', err.message)
      return { action: 'continue', reason: 'llm_error' }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Step 3: ACT — Execute the decision
  // ═══════════════════════════════════════════════════════════════

  async function act(decision) {
    switch (decision.action) {
      case 'continue':
        break

      case 'new':
        EventBus.emit('dispatcher.new', { task: decision.task, priority: decision.priority })
        break

      case 'steer':
        EventBus.emit('dispatcher.steer', { workerId: decision.workerId, instruction: decision.instruction })
        break

      case 'suspend': {
        const w = _workers.get(decision.workerId)
        if (w) {
          w.status = 'suspended'
          w.suspendedAt = Date.now()
          EventBus.emit('dispatcher.suspend', { workerId: decision.workerId })
        }
        break
      }

      case 'resume': {
        const w = _workers.get(decision.workerId)
        if (w) {
          w.status = 'running'
          w.suspendedAt = null
          EventBus.emit('dispatcher.resume', { workerId: decision.workerId })
        }
        break
      }

      case 'abort':
        EventBus.emit('dispatcher.abort', { workerId: decision.workerId, reason: decision.reason })
        break

      case 'cleanup':
        removeWorker(decision.workerId)
        if (_store) await CheckpointStore.markDone(String(decision.workerId))
        break

      case 'parallel':
        if (decision.tasks) {
          for (const t of decision.tasks) {
            EventBus.emit('dispatcher.new', { task: t.task || t, priority: t.priority || 1 })
          }
        }
        break
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Main entry points (called by Worker turn loop)
  // ═══════════════════════════════════════════════════════════════

  // Called before each Worker turn
  async function beforeTurn(workerId) {
    // GC the intent queue
    IntentQueue.gc()

    // If urgent intent exists, fast-decide
    if (IntentQueue.hasUrgent()) {
      const obs = observe('new_intent')
      const decision = await decide(obs)
      if (decision.action !== 'continue') {
        await act(decision)
        return decision
      }
    }

    return { action: 'continue' }
  }

  // Called after each Worker turn
  async function afterTurn(workerId, turnResult) {
    const w = _workers.get(workerId)
    if (!w) return { action: 'continue' }

    // Update Worker state
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

    // Save checkpoint
    if (_store) {
      const checkpoint = CheckpointStore.buildCheckpoint(w, {
        intentQueue: IntentQueue.getState(),
        workers: Array.from(_workers.values()).map(wk => ({ id: wk.id, task: wk.task, status: wk.status })),
        decisionLog: _decisionLog.slice(-10),
      })
      await CheckpointStore.save(String(workerId), w.turnCount, checkpoint)
    }

    // Observe → Decide → Act
    const obs = observe('turn_complete')
    const decision = await decide(obs)
    await act(decision)
    return decision
  }

  // Called when Talker produces an intent
  function handleIntent(intent, priority = 'normal') {
    IntentQueue.enqueue(intent, { priority, source: 'talker' })

    // Urgent intents trigger immediate scheduling
    if (priority === 'urgent') {
      EventBus.emit('dispatcher.urgent', { intent })
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Resume from checkpoint (page reload / crash recovery)
  // ═══════════════════════════════════════════════════════════════

  async function checkForResume() {
    if (!_store) return []
    const unfinished = await CheckpointStore.listUnfinished()
    return unfinished
  }

  async function resumeWorker(workerId) {
    const checkpoint = await CheckpointStore.restoreLatest(String(workerId))
    if (!checkpoint) return null

    // Re-register Worker with saved state
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
  // State & Formatting (for Talker's system prompt)
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
      })),
      intents: IntentQueue.getState(),
      freeSlots: Scheduler.MAX_SLOTS - Array.from(_workers.values()).filter(w => w.status === 'running').length,
    }
  }

  function getState() {
    const s = getStateSummary()
    return {
      running: s.workers.filter(w => w.status === 'running'),
      pending: s.workers.filter(w => w.status === 'suspended'),
      intents: s.intents,
    }
  }

  function formatForTalker() {
    const s = getStateSummary()
    if (s.workers.length === 0 && s.intents.length === 0) return '\n## Dispatch State\nNo active tasks. Ready for new work.\n'

    let out = '\n## Dispatch State\n'
    if (s.workers.length) {
      out += 'Active Workers:\n'
      for (const w of s.workers) {
        out += `- Worker #${w.id}: "${w.task}" [${w.status}] (turn ${w.turnCount}, ${w.elapsed}s, last tool: ${w.lastTool || 'none'})\n`
      }
      out += '\nIMPORTANT: If the user\'s new message relates to an active Worker\'s task, use STEER to redirect it — do NOT create a duplicate task.\n'
    }
    if (s.intents.length) {
      out += `Queued intents: ${s.intents.length}\n`
    }
    out += `Slots: ${Scheduler.MAX_SLOTS - s.freeSlots}/${Scheduler.MAX_SLOTS} used\n`
    return out
  }

  // ═══════════════════════════════════════════════════════════════
  // Batch planning (multi-intent decomposition)
  // ═══════════════════════════════════════════════════════════════

  async function planBatch(intents) {
    if (!_ai || !intents.length) return null

    try {
      const resp = await _ai.step(
        [{ role: 'user', content: `Plan these tasks:\n${JSON.stringify(intents.map(i => i.intent))}` }],
        { system: PLANNER_SYSTEM, stream: false }
      )

      const text = resp?.content || resp?.text || (typeof resp === 'string' ? resp : '')
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return null
      const plan = JSON.parse(jsonMatch[0])
      if (!plan.tasks || !Array.isArray(plan.tasks)) return null
      return plan
    } catch (err) {
      console.error('[Dispatcher.planBatch] Error:', err.message)
      return null
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Internal helpers
  // ═══════════════════════════════════════════════════════════════

  function _logDecision(decision, observation, path) {
    _decisionLog.push({
      ...decision,
      path,
      trigger: observation.trigger,
      at: Date.now(),
    })
    if (_decisionLog.length > MAX_LOG) _decisionLog.shift()
  }

  function buildDecisionPrompt(obs) {
    return `## System State (Observation)

\`\`\`json
${JSON.stringify(obs, null, 2)}
\`\`\`

Based on this state, decide the next action.`
  }

  // ═══════════════════════════════════════════════════════════════
  // System prompts
  // ═══════════════════════════════════════════════════════════════

  const DISPATCHER_SYSTEM = `You are Fluid OS's runtime scheduler. You manage Worker lifecycle.

You receive a JSON Observation (system state snapshot) and output a single JSON Action.

Available Actions:
- {"action": "continue"} — current Worker keeps executing
- {"action": "new", "task": "...", "priority": 1} — spawn new Worker
- {"action": "steer", "workerId": N, "instruction": "..."} — inject instruction into Worker
- {"action": "suspend", "workerId": N} — pause Worker, free slot
- {"action": "resume", "workerId": N} — resume suspended Worker
- {"action": "abort", "workerId": N, "reason": "..."} — kill Worker
- {"action": "parallel", "tasks": [{"task": "...", "priority": 1}, ...]} — spawn multiple Workers

Decision principles:
1. User intent takes priority over system efficiency
2. Urgent intents must be handled within 1 turn
3. When uncertain, choose "continue" (conservative)
4. Parallelize when possible, but respect maxSlots
5. Stalled Workers (stallTurns >= 5) need intervention

Output JSON only. No explanation.`

  const PLANNER_SYSTEM = `You decompose multiple user intents into an execution plan.

Rules:
- Tasks that depend on another's output must list that dependency
- Independent tasks can run in parallel (no dependencies)
- Nearly identical tasks can be merged
- Preserve original index for tracking

Output JSON:
{"tasks": [{"index": 0, "task": "description", "steps": [], "priority": 1, "dependsOn": []}, ...]}

dependsOn contains indices of tasks this one depends on. Empty = can run immediately.
Keep it minimal.`

  return {
    init, registerWorker, updateWorker, removeWorker, getWorker, nextWorkerId,
    handleIntent,
    observe, decide, act,
    beforeTurn, afterTurn,
    checkForResume, resumeWorker,
    getStateSummary, getState, formatForTalker,
    planBatch,
    get decisionLog() { return _decisionLog },
  }
})()
