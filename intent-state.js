/* intent-state.js — Persistent intent registry
 *
 * Talker writes intents here. Dispatcher reads and reacts.
 * Stored in VFS at /system/intents.json for persistence + observability.
 */
const IntentState = (() => {
  const PATH = '/system/intents.json'
  const _listeners = []  // onChange callbacks
  let _intents = {}      // id → intent object
  let _nextId = 1

  // --- Persistence ---

  function _load() {
    if (typeof VFS !== 'undefined' && VFS.isFile(PATH)) {
      try {
        const data = JSON.parse(VFS.readFile(PATH))
        _intents = data.intents || {}
        _nextId = (data.nextId || Object.keys(_intents).length) + 1
      } catch { /* corrupt file, start fresh */ }
    }
  }

  function _save() {
    if (typeof VFS !== 'undefined') {
      VFS.writeFile(PATH, JSON.stringify({ intents: _intents, nextId: _nextId }, null, 2))
    }
  }

  function _notify(action, intent) {
    _listeners.forEach(fn => fn(action, intent))
    EventBus.emit('intent.changed', { action, intent })
  }

  // --- Intent CRUD ---

  function create(goal) {
    const id = `intent-${_nextId++}`
    const intent = {
      id,
      goal,
      status: 'active',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    _intents[id] = intent
    _save()
    _notify('create', intent)
    return intent
  }

  function update(id, changes) {
    const intent = _intents[id]
    if (!intent) return null
    if (changes.goal) intent.goal = changes.goal
    if (changes.message) intent.messages.push(changes.message)
    intent.updatedAt = Date.now()
    _save()
    _notify('update', intent)
    return intent
  }

  function cancel(id) {
    const intent = _intents[id]
    if (!intent) return null
    intent.status = 'cancelled'
    intent.updatedAt = Date.now()
    _save()
    _notify('cancel', intent)
    return intent
  }

  function done(id) {
    const intent = _intents[id]
    if (!intent) return null
    intent.status = 'done'
    intent.updatedAt = Date.now()
    _save()
    _notify('done', intent)
    return intent
  }

  // --- Queries ---

  function get(id) { return _intents[id] || null }

  function active() {
    return Object.values(_intents).filter(i => i.status === 'active')
  }

  function all() { return Object.values(_intents) }

  // For Talker's system prompt — concise summary of active intents
  function formatForTalker() {
    const actv = active()
    if (actv.length === 0) return ''
    let out = '\n## Active Intents\n'
    for (const i of actv) {
      out += `- [${i.id}] "${i.goal}"`
      if (i.messages.length > 0) out += ` (last: "${i.messages[i.messages.length - 1].slice(0, 40)}")`
      out += '\n'
    }
    out += '\nWhen the user\'s message relates to an existing intent, UPDATE it (same id). Only CREATE new intents for genuinely new goals.\n'
    return out
  }

  function onChange(fn) { _listeners.push(fn) }

  function init() { _load() }

  // Clean up old done/cancelled intents (keep last 10)
  function gc() {
    const inactive = Object.values(_intents)
      .filter(i => i.status !== 'active')
      .sort((a, b) => b.updatedAt - a.updatedAt)
    if (inactive.length > 10) {
      for (const i of inactive.slice(10)) {
        delete _intents[i.id]
      }
      _save()
    }
  }

  return { init, create, update, cancel, done, get, active, all, formatForTalker, onChange, gc }
})()
