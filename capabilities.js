// capabilities.js — Capability Registry
// Instead of hardcoded toolDefs, capabilities register themselves.
// Agent discovers available capabilities through the registry.

const Capabilities = (() => {
  const _caps = new Map() // name → { name, description, icon, schema, handler, category, alwaysAvailable }

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

  return { register, unregister, get, has, getToolDefs, getHandlers, getAlwaysAvailable, describe, catalog, list, count }
})()
