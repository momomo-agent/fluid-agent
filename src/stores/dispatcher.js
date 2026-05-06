import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useVFSStore } from './vfs.js'
import { EventBus } from '../composables/useEventBus.js'

const MAX_SLOTS = 3
const MAX_RETRIES = 2
const MAX_TURN_BUDGET = 30
const MAX_TOKEN_BUDGET = 200000
const TURN_QUANTUM = 10
const STALL_THRESHOLD = 5
const GC_KEEP_MS = 7 * 86400_000 // 7 days

export const useDispatcherStore = defineStore('dispatcher', () => {
  const pending = ref([])
  const slots = ref(new Map())
  const completed = ref([])
  const decisionLog = ref([])
  const workers = ref(new Map()) // workerId → worker state
  let nextTaskId = 1
  let _dispatchMode = 'code' // 'code' | 'llm'
  let _ai = null

  const PROC_DIR = '/proc/scheduler'
  const WORKERS_DIR = '/proc/workers'

  // ═══════════════════════════════════════════════════════════════
  // Dispatch Mode
  // ═══════════════════════════════════════════════════════════════

  function setDispatchMode(mode) {
    if (mode === 'code' || mode === 'llm') _dispatchMode = mode
  }

  function getDispatchMode() { return _dispatchMode }

  function setAI(ai) { _ai = ai }

  // ═══════════════════════════════════════════════════════════════
  // Worker Lifecycle
  // ═══════════════════════════════════════════════════════════════

  function registerWorker(workerId, task, steps) {
    workers.value.set(workerId, {
      id: workerId,
      task,
      steps: steps || [],
      completedSteps: [],
      status: 'running',
      turnCount: 0,
      totalTokens: 0,
      toolCallCount: 0,
      stallCount: 0,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      error: null,
    })
    _saveWorker(workerId)
    _logDecision(workerId, 'start', `Started: ${task.slice(0, 60)}`)
  }

  function updateWorker(workerId, updates) {
    const w = workers.value.get(workerId)
    if (!w) return
    Object.assign(w, updates)
    w.updatedAt = Date.now()
    _saveWorker(workerId)
  }

  function removeWorker(workerId) {
    workers.value.delete(workerId)
  }

  function getWorker(id) {
    return workers.value.get(id)
  }

  // ═══════════════════════════════════════════════════════════════
  // beforeTurn / afterTurn hooks
  // ═══════════════════════════════════════════════════════════════

  function beforeTurn(workerId) {
    const w = workers.value.get(workerId)
    if (!w) return { action: 'continue' }
    w.turnCount = (w.turnCount || 0) + 1
    w.updatedAt = Date.now()

    // Budget check
    if (w.turnCount > MAX_TURN_BUDGET) {
      _logDecision(workerId, 'abort', `Max turns (${MAX_TURN_BUDGET}) exceeded`)
      return { action: 'abort', reason: `Maximum turns (${MAX_TURN_BUDGET}) reached` }
    }
    return { action: 'continue' }
  }

  function afterTurn(workerId, turnResult = {}) {
    const w = workers.value.get(workerId)
    if (!w) return { action: 'continue' }

    // Track tokens
    const turnTokens = turnResult?.usage
      ? (turnResult.usage.input_tokens || 0) + (turnResult.usage.output_tokens || 0)
      : 0
    if (turnTokens) w.totalTokens = (w.totalTokens || 0) + turnTokens
    if (turnResult?.toolCalls) w.toolCallCount = (w.toolCallCount || 0) + turnResult.toolCalls.length

    // Stall detection
    if (turnResult?.noProgress) {
      w.stallCount = (w.stallCount || 0) + 1
      if (w.stallCount >= STALL_THRESHOLD) {
        _logDecision(workerId, 'stall', `Stalled ${w.stallCount} turns`)
      }
    } else {
      w.stallCount = 0
    }

    // Token budget
    if (w.totalTokens >= MAX_TOKEN_BUDGET) {
      _logDecision(workerId, 'suspend', 'Token budget exceeded')
      return { action: 'suspend', reason: 'token_budget' }
    }

    // Round-robin preemption
    if (w.turnCount % TURN_QUANTUM === 0 && pending.value.length > 0) {
      const slot = [...slots.value.values()].find(s => s.id === w.task)
      const higherPriority = pending.value.find(t => slot && t.priority < slot.priority)
      if (higherPriority) {
        return { action: 'suspend', reason: 'preempted' }
      }
    }

    _saveWorker(workerId)
    return { action: 'continue' }
  }

  // ═══════════════════════════════════════════════════════════════
  // LLM Dispatch Mode
  // ═══════════════════════════════════════════════════════════════

  async function handleIntentLLM(action, intent, allIntents) {
    if (!_ai) {
      console.warn('[Dispatcher] LLM mode but no AI instance, falling back to code')
      _dispatchMode = 'code'
      return null
    }

    const activeWorkers = [...workers.value.values()].filter(w => w.status === 'running' || w.status === 'suspended')
    const freeSlots = MAX_SLOTS - activeWorkers.filter(w => w.status === 'running').length

    const prompt = `You are a task dispatcher. Given the current state, decide what to do.

Event: ${action} intent ${intent.id} "${intent.goal}"

All intents:\n${(allIntents || []).map(i => `- ${i.id}: "${i.goal}" (${i.status})${i.dependsOn?.length ? ' depends:' + i.dependsOn.join(',') : ''}`).join('\n')}

Active workers:\n${activeWorkers.map(w => `- Worker #${w.id}: "${w.task.slice(0, 60)}" (turn ${w.turnCount})`).join('\n') || 'none'}

Free slots: ${freeSlots}

Respond with JSON: {"ops": [{"type": "spawn"|"steer"|"cancel"|"wait", "intentId": "...", "reason": "..."}]}`

    try {
      const resp = await _ai.think(prompt, { stream: false, system: 'You are a task scheduler. Respond with JSON only.' })
      const text = resp?.content || resp?.text || (typeof resp === 'string' ? resp : '')
      const match = text.match(/\{[\s\S]*\}/)
      if (match) {
        const decision = JSON.parse(match[0])
        _logDecision(null, 'llm-dispatch', JSON.stringify(decision.ops || []))
        return decision
      }
    } catch (e) {
      console.error('[Dispatcher] LLM dispatch failed:', e.message)
      _dispatchMode = 'code'
    }
    return null
  }

  // ═══════════════════════════════════════════════════════════════
  // Resume
  // ═══════════════════════════════════════════════════════════════

  function checkForResume() {
    const suspended = [...workers.value.values()].filter(w => w.status === 'suspended')
    return suspended.map(w => ({
      workerId: w.id,
      task: w.task,
      turnCount: w.turnCount,
      updatedAt: w.updatedAt,
    }))
  }

  function resumeWorker(workerId) {
    const w = workers.value.get(workerId)
    if (!w || w.status !== 'suspended') return null
    w.status = 'running'
    w.updatedAt = Date.now()
    _saveWorker(workerId)
    return {
      task: w.task,
      steps: w.steps,
      completedSteps: w.completedSteps,
      messages: w.messages,
      turnCount: w.turnCount,
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // formatForTalker
  // ═══════════════════════════════════════════════════════════════

  function formatForTalker() {
    const active = [...workers.value.values()].filter(w => w.status === 'running' || w.status === 'suspended')
    if (active.length === 0) return ''
    let out = '\n## Active Workers\n'
    for (const w of active) {
      out += `- Worker #${w.id}: "${w.task.slice(0, 60)}" (${w.status}, turn ${w.turnCount})\n`
    }
    return out
  }

  // ═══════════════════════════════════════════════════════════════
  // GC: clean up old done/failed workers
  // ═══════════════════════════════════════════════════════════════

  function gc(keepMs = GC_KEEP_MS) {
    const vfs = useVFSStore()
    const cutoff = Date.now() - keepMs

    // Clean worker state
    for (const [id, w] of workers.value) {
      if ((w.status === 'done' || w.status === 'failed' || w.status === 'cancelled') && w.updatedAt < cutoff) {
        workers.value.delete(id)
      }
    }

    // Clean VFS worker files
    if (vfs.isDir(WORKERS_DIR)) {
      const entries = vfs.ls(WORKERS_DIR) || []
      for (const entry of entries) {
        if (entry.name === 'meta.json' || !entry.name.endsWith('.json')) continue
        try {
          const data = JSON.parse(vfs.readFile(`${WORKERS_DIR}/${entry.name}`))
          if ((data.status === 'done' || data.status === 'failed' || data.status === 'cancelled') && data.updatedAt < cutoff) {
            vfs.rm(`${WORKERS_DIR}/${entry.name}`)
          }
        } catch { /* skip corrupt */ }
      }
    }

    // Clean old completed entries
    const cutoffCompleted = completed.value.filter(c => !c.completedAt || c.completedAt > cutoff)
    completed.value.length = 0
    completed.value.push(...cutoffCompleted)
  }

  // ═══════════════════════════════════════════════════════════════
  // Scheduler
  // ═══════════════════════════════════════════════════════════════

  function enqueue(task, { priority = 5, dependsOn = [], steps = [], meta = {} } = {}) {
    const id = `task-${nextTaskId++}`
    const entry = { id, task, steps, priority, dependsOn, status: 'pending', retryCount: 0, meta }
    pending.value.push(entry)
    pending.value.sort((a, b) => a.priority - b.priority)
    _save()
    _trySchedule()
    return id
  }

  function cancel(taskId) {
    const idx = pending.value.findIndex(t => t.id === taskId)
    if (idx >= 0) {
      pending.value.splice(idx, 1)
      _save()
      return true
    }
    for (const [slotIdx, slot] of slots.value) {
      if (slot.id === taskId) {
        slot.status = 'cancelled'
        if (slot.abort) slot.abort.abort()
        slots.value.delete(slotIdx)
        _save()
        return true
      }
    }
    return false
  }

  function getState() {
    return {
      pending: [...pending.value],
      slots: [...slots.value.values()],
      completed: completed.value.slice(-20),
    }
  }

  function isIdle() {
    return pending.value.length === 0 && slots.value.size === 0
  }

  function _trySchedule() {
    while (slots.value.size < MAX_SLOTS && pending.value.length > 0) {
      // Find first task with satisfied dependencies
      const idx = pending.value.findIndex(t => {
        if (t.dependsOn.length === 0) return true
        return t.dependsOn.every(dep => completed.value.some(c => c.id === dep && c.status === 'done'))
      })
      if (idx < 0) break

      const task = pending.value.splice(idx, 1)[0]
      const slotIdx = _nextSlot()
      const abort = new AbortController()
      const slot = {
        ...task,
        slotIndex: slotIdx,
        status: 'running',
        abort,
        turnCount: 0,
        totalTokens: 0,
        startTime: Date.now(),
      }
      slots.value.set(slotIdx, slot)
      _save()

      // Emit for worker to pick up
      EventBus.emit('scheduler.dispatch', { slot: slotIdx, task: slot })
    }
  }

  function completeSlot(slotIdx, { status = 'done', summary = '' } = {}) {
    const slot = slots.value.get(slotIdx)
    if (!slot) return
    slot.status = status
    completed.value.push({ id: slot.id, task: slot.task, status, summary })
    if (completed.value.length > 50) completed.value.shift()
    slots.value.delete(slotIdx)
    _save()
    _trySchedule()
    EventBus.emit('scheduler.completed', { id: slot.id, status, summary })
  }

  function failSlot(slotIdx, error) {
    const slot = slots.value.get(slotIdx)
    if (!slot) return
    if (slot.retryCount < MAX_RETRIES) {
      slot.retryCount++
      slot.status = 'pending'
      pending.value.push(slot)
      pending.value.sort((a, b) => a.priority - b.priority)
      slots.value.delete(slotIdx)
      setTimeout(() => _trySchedule(), 1000 * Math.pow(2, slot.retryCount))
    } else {
      slot.status = 'failed'
      slot.error = error
      completed.value.push({ id: slot.id, task: slot.task, status: 'failed', error })
      slots.value.delete(slotIdx)
      EventBus.emit('scheduler.failed', { id: slot.id, error })
    }
    _save()
  }

  function suspendSlot(slotIdx) {
    const slot = slots.value.get(slotIdx)
    if (!slot) return
    slot.status = 'suspended'
    pending.value.push(slot)
    slots.value.delete(slotIdx)
    _save()
  }

  function recordTurn(slotIdx, { tokens = 0, toolCalls = [] } = {}) {
    const slot = slots.value.get(slotIdx)
    if (!slot) return { action: 'continue' }
    slot.turnCount++
    slot.totalTokens += tokens

    // Budget enforcement
    if (slot.turnCount >= MAX_TURN_BUDGET) {
      return { action: 'suspend', reason: 'turn_budget' }
    }
    if (slot.totalTokens >= MAX_TOKEN_BUDGET) {
      return { action: 'suspend', reason: 'token_budget' }
    }
    // Round-robin preemption
    if (slot.turnCount % TURN_QUANTUM === 0 && pending.value.length > 0) {
      const higherPriority = pending.value.find(t => t.priority < slot.priority)
      if (higherPriority) return { action: 'suspend', reason: 'preempted' }
    }
    return { action: 'continue' }
  }

  function _nextSlot() {
    for (let i = 0; i < MAX_SLOTS; i++) {
      if (!slots.value.has(i)) return i
    }
    return MAX_SLOTS
  }

  // ── VFS persistence ──

  function _save() {
    const vfs = useVFSStore()
    if (!vfs.isDir(PROC_DIR)) vfs.mkdir(PROC_DIR)
    vfs.writeFile(`${PROC_DIR}/state.json`, JSON.stringify({
      nextTaskId,
      pending: pending.value.map(t => ({
        id: t.id, task: t.task, steps: t.steps, priority: t.priority,
        dependsOn: t.dependsOn, status: t.status, retryCount: t.retryCount || 0,
        meta: t.meta || {},
      })),
      slots: [...slots.value.entries()].map(([idx, s]) => ({
        slotIndex: idx, id: s.id, task: s.task, steps: s.steps,
        priority: s.priority, status: s.status, meta: s.meta || {},
      })),
      completed: completed.value.slice(-20),
    }, null, 2))
  }

  function _saveWorker(workerId) {
    const vfs = useVFSStore()
    if (!vfs.isDir(WORKERS_DIR)) vfs.mkdir(WORKERS_DIR)
    const w = workers.value.get(workerId)
    if (!w) return
    vfs.writeFile(`${WORKERS_DIR}/${workerId}.json`, JSON.stringify({
      id: w.id,
      task: w.task,
      status: w.status,
      steps: w.steps || [],
      completedSteps: w.completedSteps || [],
      turnCount: w.turnCount || 0,
      messages: (w.messages || []).slice(-20),
      createdAt: w.createdAt || Date.now(),
      updatedAt: w.updatedAt || Date.now(),
      totalTokens: w.totalTokens || 0,
      toolCallCount: w.toolCallCount || 0,
      error: w.error || null,
    }, null, 2))
  }

  function _logDecision(workerId, type, detail) {
    decisionLog.value.push({ workerId, type, detail, at: Date.now() })
    if (decisionLog.value.length > 50) decisionLog.value.shift()
  }

  function restore() {
    const vfs = useVFSStore()
    if (!vfs.isFile(`${PROC_DIR}/state.json`)) return
    try {
      const data = JSON.parse(vfs.readFile(`${PROC_DIR}/state.json`))
      nextTaskId = data.nextTaskId || 1
      if (data.completed) completed.value.push(...data.completed)
      if (data.pending) {
        for (const t of data.pending) {
          if (t.status === 'pending') pending.value.push(t)
        }
      }
      // Tasks that were running → back to pending
      if (data.slots) {
        for (const s of data.slots) {
          if (s.status === 'running') {
            pending.value.push({
              id: s.id, task: s.task, steps: s.steps || [],
              priority: s.priority, dependsOn: [], status: 'pending',
              retryCount: 0, meta: s.meta || {},
            })
          }
        }
      }
      pending.value.sort((a, b) => a.priority - b.priority)
    } catch {}
  }

  return {
    pending, slots, completed, decisionLog, workers,
    enqueue, cancel, getState, isIdle,
    completeSlot, failSlot, suspendSlot, recordTurn,
    restore,
    // Worker lifecycle
    registerWorker, updateWorker, removeWorker, getWorker,
    // Turn hooks
    beforeTurn, afterTurn,
    // LLM dispatch
    setDispatchMode, getDispatchMode, setAI, handleIntentLLM,
    // Resume
    checkForResume, resumeWorker,
    // State
    formatForTalker, gc,
  }
})
