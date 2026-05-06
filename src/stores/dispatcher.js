import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useVFSStore } from './vfs.js'
import { EventBus } from '../composables/useEventBus.js'

const MAX_SLOTS = 3
const MAX_RETRIES = 2
const MAX_TURN_BUDGET = 30
const MAX_TOKEN_BUDGET = 200000
const TURN_QUANTUM = 10

export const useDispatcherStore = defineStore('dispatcher', () => {
  const pending = ref([])
  const slots = ref(new Map())
  const completed = ref([])
  const decisionLog = ref([])
  let nextTaskId = 1

  const PROC_DIR = '/proc/scheduler'

  // ── Scheduler ──

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
    pending, slots, completed, decisionLog,
    enqueue, cancel, getState, isIdle,
    completeSlot, failSlot, suspendSlot, recordTurn,
    restore
  }
})
