/* dispatcher.js — LLM-powered turn-level scheduler
 *
 * Three roles: Talker (shell) → Dispatcher (kernel) → Worker (process)
 *
 * Dispatcher decides what happens between Worker turns:
 *   - continue: let the Worker keep going
 *   - steer: inject new instruction into Worker's context
 *   - suspend: pause Worker, free the slot
 *   - resume: resume a suspended Worker
 *   - abort: kill a Worker
 *   - new: create a new Worker
 *   - noop: do nothing
 *
 * All decisions go through LLM — no fast/slow path split.
 */
const Dispatcher = (() => {
  let _ai = null
  const _pendingIntents = []  // Talker's intents, consumed by Dispatcher
  const _workers = new Map()  // workerId → Worker state

  let _nextWorkerId = 1

  function init(ai) { _ai = ai }

  // --- Worker Registry ---

  function registerWorker(id, task, steps) {
    _workers.set(id, {
      id,
      task,
      steps,
      status: 'running',    // running | suspended | done | error | aborted
      turnCount: 0,
      lastTool: null,
      lastResult: null,
      priority: 1,
      createdAt: Date.now(),
      suspendedAt: null,
    })
  }

  function updateWorker(id, update) {
    const w = _workers.get(id)
    if (w) Object.assign(w, update)
  }

  function removeWorker(id) {
    _workers.delete(id)
  }

  function nextWorkerId() {
    return _nextWorkerId++
  }

  // --- Intent Queue (Talker → Dispatcher) ---

  function pushIntent(intent) {
    _pendingIntents.push({ ...intent, time: Date.now() })
  }

  function drainIntents() {
    const intents = [..._pendingIntents]
    _pendingIntents.length = 0
    return intents
  }

  // --- State Summary (for Talker's system prompt) ---

  function getStateSummary() {
    const workers = []
    for (const [id, w] of _workers) {
      workers.push({
        id: w.id,
        task: w.task.slice(0, 60),
        status: w.status,
        turnCount: w.turnCount,
        lastTool: w.lastTool,
        priority: w.priority,
        elapsed: Math.round((Date.now() - w.createdAt) / 1000),
      })
    }
    const schedulerState = Scheduler.getState()
    return {
      workers,
      pending: schedulerState.pending.length,
      slotsUsed: schedulerState.running.length,
      slotsMax: Scheduler.MAX_SLOTS,
    }
  }

  // Format for injection into Talker's system prompt
  function formatForTalker() {
    const state = getStateSummary()
    if (state.workers.length === 0 && state.pending === 0) return ''

    let s = '\nDISPATCH STATE:'
    if (state.workers.length > 0) {
      s += '\n- Workers: ' + state.workers.map(w =>
        `#${w.id} "${w.task}"(${w.status}, turn ${w.turnCount}${w.lastTool ? ', last: ' + w.lastTool : ''}, ${w.elapsed}s)`
      ).join(' | ')
    }
    s += `\n- Slots: ${state.slotsUsed}/${state.slotsMax} used`
    if (state.pending > 0) s += `\n- Queue: ${state.pending} pending`
    return s
  }

  // --- Core: LLM-based dispatch decision ---

  async function decide(trigger, context) {
    if (!_ai) return { action: 'continue' }

    const state = getStateSummary()
    const intents = drainIntents()

    // Build context for Dispatcher LLM
    const workerSummary = state.workers.map(w =>
      `#${w.id} "${w.task}" — ${w.status}, turn ${w.turnCount}, last tool: ${w.lastTool || 'none'}, elapsed: ${w.elapsed}s, priority: ${w.priority}`
    ).join('\n  ') || '(none)'

    const intentSummary = intents.length > 0
      ? intents.map(i => JSON.stringify(i)).join('\n  ')
      : '(none)'

    const prompt = `Trigger: ${trigger}
${context ? `Context: ${context}` : ''}

Workers:
  ${workerSummary}

Pending queue: ${state.pending} tasks
Slots: ${state.slotsUsed}/${state.slotsMax}

New intents from Talker:
  ${intentSummary}

Decide what to do. Output ONLY valid JSON:`

    const system = `You are the scheduler of Fluid Agent OS. You manage Worker processes.

Each Worker runs a task using tools, one turn at a time. Between turns, you decide:
- "continue" — let the Worker keep going (default if nothing needs changing)
- "steer" — inject a new instruction into the Worker's next turn (workerId + instruction required)
- "suspend" — pause a Worker to free a slot (workerId required)
- "resume" — resume a suspended Worker (workerId required)
- "abort" — kill a Worker (workerId required)
- "new" — create a new Worker for a new task (task + steps required)
- "reorder" — change priority of a Worker (workerId + priority required)
- "noop" — do nothing (for pure conversation, no task impact)

Output JSON:
{"action": "continue"}
{"action": "steer", "workerId": 1, "instruction": "focus on the intro section"}
{"action": "suspend", "workerId": 2}
{"action": "resume", "workerId": 2}
{"action": "abort", "workerId": 1}
{"action": "new", "task": "...", "steps": ["..."], "priority": 1}
{"action": "reorder", "workerId": 1, "priority": 0}
{"action": "noop"}

Rules:
- If no intents and Worker is progressing normally → "continue"
- If Talker intent relates to a running Worker → "steer" that Worker
- If Talker intent is a new unrelated task → "new"
- If user says stop/cancel → "abort"
- Urgent tasks (priority 0) can preempt background tasks (priority 2) via "suspend" + "new"
- Be decisive. One action per decision.`

    try {
      const result = await _ai.think(prompt, {
        system,
        stream: false,
        history: [],
        tools: [],
      })
      const text = typeof result === 'string' ? result
        : result?.answer ?? result?.content ?? JSON.stringify(result)
      const json = text.match(/\{[\s\S]*?\}/)
      if (json) return JSON.parse(json[0])
    } catch (e) {
      console.warn('[Dispatcher] LLM error:', e.message)
    }
    return { action: 'continue' }
  }

  // --- Checkpoint: called between Worker turns ---

  async function beforeTurn(workerId) {
    const w = _workers.get(workerId)
    if (!w) return { action: 'continue' }

    // Only call LLM if there are pending intents or multiple workers
    const hasIntents = _pendingIntents.length > 0
    const multiWorker = _workers.size > 1

    if (!hasIntents && !multiWorker) {
      // Simple case: single worker, no new intents → just continue
      return { action: 'continue' }
    }

    const decision = await decide(
      `Worker #${workerId} about to start turn ${w.turnCount + 1}`,
      `Task: "${w.task}", last tool: ${w.lastTool || 'none'}`
    )

    return decision
  }

  async function afterTurn(workerId, turnResult) {
    const w = _workers.get(workerId)
    if (!w) return

    w.turnCount++
    w.lastTool = turnResult.lastTool || null
    w.lastResult = turnResult.summary || null

    // Check if there are pending intents that need immediate attention
    if (_pendingIntents.length > 0) {
      const decision = await decide(
        `Worker #${workerId} completed turn ${w.turnCount}`,
        `Tool used: ${w.lastTool || 'none'}, result: ${(w.lastResult || '').slice(0, 100)}`
      )
      return decision
    }
  }

  // --- Handle Talker intent (called when Talker outputs an action block) ---

  async function handleIntent(intent) {
    pushIntent(intent)

    // If no workers running, fast-path: just return the intent as-is
    if (_workers.size === 0) {
      drainIntents()  // consume it
      if (intent.action === 'execute') {
        return { action: 'new', task: intent.task, steps: intent.steps || [], priority: intent.priority || 1 }
      }
      if (intent.action === 'abort') {
        return { action: 'abort', workerId: null }
      }
      return { action: 'noop' }
    }

    // Workers running — need LLM to decide
    return decide(`New intent from Talker`, `Intent: ${JSON.stringify(intent)}`)
  }

  return {
    init, registerWorker, updateWorker, removeWorker, nextWorkerId,
    pushIntent, drainIntents,
    getStateSummary, getState: () => {
      const s = getStateSummary()
      return { running: s.workers.filter(w => w.status === 'running'), pending: s.workers.filter(w => w.status === 'suspended') }
    }, formatForTalker,
    decide, beforeTurn, afterTurn, handleIntent,
  }
})()
