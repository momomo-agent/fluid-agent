import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const RECENCY_WINDOW = 5 * 60 * 1000
const DECAY_WINDOW = 30 * 60 * 1000
const HOT_THRESHOLD = 3

export const useCapabilitiesStore = defineStore('capabilities', () => {
  const caps = ref(new Map())
  const usage = ref(new Map())

  function register(name, { description, icon, schema, handler, category = 'general', alwaysAvailable = false }) {
    caps.value.set(name, { name, description, icon: icon || '🔧', schema, handler, category, alwaysAvailable })
  }

  function unregister(name) { caps.value.delete(name) }

  function get(name) { return caps.value.get(name) }
  function has(name) { return caps.value.has(name) }

  function getToolDefs() {
    const defs = {}
    for (const [name, cap] of caps.value) {
      defs[name] = { desc: cap.description, schema: cap.schema }
    }
    return defs
  }

  function getHandlers() {
    const handlers = {}
    for (const [name, cap] of caps.value) {
      if (cap.handler) handlers[name] = cap.handler
    }
    return handlers
  }

  function getAlwaysAvailable() {
    return [...caps.value.entries()].filter(([, c]) => c.alwaysAvailable).map(([n]) => n)
  }

  function describe() {
    const groups = {}
    for (const [name, cap] of caps.value) {
      const cat = cap.category || 'general'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(`${cap.icon} ${name}: ${cap.description}`)
    }
    return Object.entries(groups)
      .map(([cat, items]) => `**${cat}**: ${items.join(', ')}`)
      .join('\n')
  }

  function catalog() {
    const out = {}
    for (const [name, cap] of caps.value) out[name] = cap.description
    return out
  }

  function list() { return [...caps.value.values()] }
  function count() { return caps.value.size }

  function recordUse(name) {
    const u = usage.value.get(name) || { count: 0, lastUsed: 0 }
    u.count++
    u.lastUsed = Date.now()
    usage.value.set(name, u)
  }

  function getActiveDynamic() {
    const now = Date.now()
    const active = new Set(getAlwaysAvailable())
    for (const [name, u] of usage.value) {
      if (!caps.value.has(name)) continue
      if (now - u.lastUsed < RECENCY_WINDOW) { active.add(name); continue }
      if (u.count >= HOT_THRESHOLD && now - u.lastUsed < DECAY_WINDOW) { active.add(name); continue }
    }
    return [...active]
  }

  return {
    caps, usage,
    register, unregister, get, has,
    getToolDefs, getHandlers, getAlwaysAvailable, getActiveDynamic,
    recordUse, describe, catalog, list, count
  }
})
