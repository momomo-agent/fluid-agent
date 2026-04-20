/* intent-queue.js — Priority intent queue for Dispatcher
 *
 * Manages user intents with three priority levels:
 *   urgent  — interrupt current Worker (stop/cancel/change)
 *   normal  — process at next checkpoint
 *   background — process when idle
 */
const IntentQueue = (() => {
  let _nextId = 1
  const _queue = []  // { id, intent, priority, createdAt, source }

  const PRIORITY_ORDER = { urgent: 0, normal: 1, background: 2 }

  // Timeouts (ms)
  const URGENT_MAX_WAIT = 30_000    // urgent: force interrupt after 30s
  const NORMAL_DEGRADE = 60_000     // normal: degrade to background after 60s
  const BACKGROUND_EXPIRE = 120_000 // background: expire after 120s

  function enqueue(intent, { priority = 'normal', source = 'talker' } = {}) {
    const entry = {
      id: _nextId++,
      intent,
      priority,
      createdAt: Date.now(),
      source,
    }
    _queue.push(entry)
    _sort()
    EventBus.emit('intent.enqueued', entry)
    return entry.id
  }

  function _sort() {
    _queue.sort((a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.createdAt - b.createdAt
    )
  }

  function peek() { return _queue[0] || null }

  function dequeue() {
    const item = _queue.shift()
    if (item) EventBus.emit('intent.dequeued', item)
    return item || null
  }

  function dequeueAll() {
    const items = [..._queue]
    _queue.length = 0
    return items
  }

  function size() { return _queue.length }

  function hasUrgent() {
    return _queue.some(i => i.priority === 'urgent')
  }

  // Garbage collection: degrade/expire old intents
  function gc() {
    const now = Date.now()
    for (let i = _queue.length - 1; i >= 0; i--) {
      const item = _queue[i]
      const age = now - item.createdAt

      if (item.priority === 'background' && age > BACKGROUND_EXPIRE) {
        _queue.splice(i, 1)
        EventBus.emit('intent.expired', item)
      } else if (item.priority === 'normal' && age > NORMAL_DEGRADE) {
        item.priority = 'background'
      }
    }
    _sort()
  }

  function getState() {
    return _queue.map(i => ({
      id: i.id,
      priority: i.priority,
      task: (i.intent?.task || JSON.stringify(i.intent)).slice(0, 60),
      age: Math.round((Date.now() - i.createdAt) / 1000),
      source: i.source,
    }))
  }

  function clear() { _queue.length = 0 }

  return { enqueue, peek, dequeue, dequeueAll, size, hasUrgent, gc, getState, clear }
})()
