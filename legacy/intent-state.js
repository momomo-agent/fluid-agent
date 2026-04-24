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

  function create(goal, opts = {}) {
    const id = `intent-${_nextId++}`
    const intent = {
      id,
      goal,
      status: 'active',
      progress: '',
      artifacts: [],
      messages: [],
      dependsOn: opts.dependsOn || [],  // array of intent IDs this depends on
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
    // Append message to history (never lose context)
    if (changes.message) intent.messages.push(changes.message)
    // Track goal evolution: keep previous goals
    if (changes.goal && changes.goal !== intent.goal) {
      if (!intent.goalHistory) intent.goalHistory = []
      intent.goalHistory.push({ goal: intent.goal, at: Date.now() })
      intent.goal = changes.goal
    }
    if (changes.progress != null) intent.progress = changes.progress
    if (changes.artifacts) {
      if (!intent.artifacts) intent.artifacts = []
      for (const a of changes.artifacts) {
        if (!intent.artifacts.includes(a)) intent.artifacts.push(a)
      }
    }
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

  function running(id) {
    const intent = _intents[id]
    if (!intent) return null
    intent.status = 'running'
    intent.updatedAt = Date.now()
    _save()
    _notify('running', intent)
    return intent
  }

  function done(id, result) {
    const intent = _intents[id]
    if (!intent) return null
    intent.status = 'done'
    if (result) intent.result = result
    // Preserve progress/artifacts from worker turns
    intent.updatedAt = Date.now()
    _save()
    _notify('done', intent)
    return intent
  }

  function fail(id, error) {
    const intent = _intents[id]
    if (!intent) return null
    intent.status = 'failed'
    intent.error = typeof error === 'string' ? error : (error?.message || 'Unknown error')
    intent.updatedAt = Date.now()
    _save()
    _notify('failed', intent)
    return intent
  }

  // --- Queries ---

  function get(id) { return _intents[id] || null }

  function active() {
    return Object.values(_intents).filter(i => i.status === 'active' || i.status === 'running')
  }

  function all() { return Object.values(_intents) }

  // For Talker's system prompt — concise summary of active intents
  function formatForTalker() {
    const actv = active()
    const settled = Object.values(_intents).filter(i => i.status === 'done' || i.status === 'failed')
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)
    if (actv.length === 0 && settled.length === 0) return ''
    let out = ''
    if (actv.length > 0) {
      out += '\n## Active Intents\n'
      for (const i of actv) {
        out += `- [${i.id}] "${i.goal}" (${i.status})`
        if (i.dependsOn && i.dependsOn.length > 0) out += ` [waiting on: ${i.dependsOn.join(', ')}]`
        if (i.progress) out += `\n  Progress: ${i.progress}`
        if (i.artifacts && i.artifacts.length > 0) out += `\n  Artifacts: ${i.artifacts.join(', ')}`
        if (i.messages.length > 0) {
          const recent = i.messages.slice(-3).map(m => `"${m.slice(0, 30)}"`).join(' → ')
          out += ` (history: ${recent})`
        }
        out += '\n'
      }
      out += '\nWhen the user\'s message relates to an existing intent, UPDATE it (same id, include message + re-summarized goal). Only CREATE for genuinely new goals.\n'
    }
    // Show recently completed intents so Talker can report results naturally
    const unreported = settled.filter(i => !i._reported)
    if (unreported.length > 0) {
      out += '\n## Completed Intents (report these results to the user)\n'
      for (const i of unreported) {
        out += `- [${i.id}] "${i.goal}" → ${i.status}`
        if (i.result) out += `: ${typeof i.result === 'string' ? i.result.slice(0, 300) : JSON.stringify(i.result).slice(0, 300)}`
        if (i.error) out += ` ERROR: ${i.error}`
        out += '\n'
      }
      out += '\nReport these results naturally to the user, then mark them done with: {"action": "done", "id": "intent-X"}\n'
    }
    return out
  }

  function onChange(fn) { _listeners.push(fn) }

  function init() { _load() }

  // Mark intents as reported so Talker doesn't repeat them
  function markReported(...ids) {
    for (const id of ids) {
      if (_intents[id]) _intents[id]._reported = true
    }
    _save()
  }

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

  return { init, create, update, cancel, running, done, fail, get, active, all, formatForTalker, onChange, gc, markReported }
})()
