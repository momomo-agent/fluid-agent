// capabilities.js — Capability Registry
// Instead of hardcoded toolDefs, capabilities register themselves.
// Agent discovers available capabilities through the registry.

const Capabilities = (() => {
  const _caps = new Map() // name → { name, description, icon, schema, handler, category, alwaysAvailable }
  const _usage = new Map() // name → { count, lastUsed }

  const RECENCY_WINDOW = 5 * 60 * 1000 // 5 minutes
  const DECAY_WINDOW = 30 * 60 * 1000  // 30 minutes — tools unused this long get deactivated
  const HOT_THRESHOLD = 3              // use count to become "hot"

  function register(name, { description, icon, schema, handler, category = 'general', alwaysAvailable = false }) {
    _caps.set(name, { name, description, icon: icon || '🔧', schema, handler, category, alwaysAvailable })
  }

  function unregister(name) { _caps.delete(name) }

  function get(name) { return _caps.get(name) }

  function has(name) { return _caps.has(name) }

  // Get all capability definitions (for LLM tool schema)
  function getToolDefs() {
    const defs = {}
    for (const [name, cap] of _caps) {
      defs[name] = { desc: cap.description, schema: cap.schema }
    }
    return defs
  }

  // Get all handlers
  function getHandlers() {
    const handlers = {}
    for (const [name, cap] of _caps) {
      if (cap.handler) handlers[name] = cap.handler
    }
    return handlers
  }

  // Get always-available tool names
  function getAlwaysAvailable() {
    return [..._caps.entries()].filter(([, c]) => c.alwaysAvailable).map(([n]) => n)
  }

  // List capabilities grouped by category (for system prompt)
  function describe() {
    const groups = {}
    for (const [name, cap] of _caps) {
      const cat = cap.category || 'general'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(`${cap.icon} ${name}: ${cap.description}`)
    }
    return Object.entries(groups)
      .map(([cat, items]) => `**${cat}**: ${items.join(', ')}`)
      .join('\n')
  }

  // Compact catalog for tool search
  function catalog() {
    const out = {}
    for (const [name, cap] of _caps) out[name] = cap.description
    return out
  }

  function list() {
    return [..._caps.values()]
  }

  function count() { return _caps.size }

  // Track tool usage
  function recordUse(name) {
    const u = _usage.get(name) || { count: 0, lastUsed: 0 }
    u.count++
    u.lastUsed = Date.now()
    _usage.set(name, u)
  }

  // Get dynamically active tool names: always available + recently used + hot (frequently used)
  function getActiveDynamic() {
    const now = Date.now()
    const active = new Set(getAlwaysAvailable())
    for (const [name, u] of _usage) {
      if (!_caps.has(name)) continue
      // Recently used (within recency window)
      if (now - u.lastUsed < RECENCY_WINDOW) { active.add(name); continue }
      // Hot tool (used enough times and not decayed)
      if (u.count >= HOT_THRESHOLD && now - u.lastUsed < DECAY_WINDOW) { active.add(name); continue }
    }
    return [...active]
  }

  // Get usage stats (for debugging)
  function getUsageStats() {
    const stats = {}
    for (const [name, u] of _usage) stats[name] = { ...u, ago: Math.round((Date.now() - u.lastUsed) / 1000) + 's' }
    return stats
  }

  return { register, unregister, get, has, getToolDefs, getHandlers, getAlwaysAvailable, getActiveDynamic, recordUse, getUsageStats, describe, catalog, list, count }
})()
