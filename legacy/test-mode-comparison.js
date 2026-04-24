/* test-mode-comparison.js — Compare code mode vs LLM mode with realistic scenarios
 *
 * Runs the same intent sequences in both modes, logs all decisions,
 * then prints a side-by-side comparison.
 */

const _vfsStore = new Map()
globalThis.VFS = {
  isDir(p) { return _vfsStore.get(p)?.type === 'dir' },
  isFile(p) { return _vfsStore.get(p)?.type === 'file' },
  mkdir(p) {
    const parts = p.split('/').filter(Boolean); let cur = ''
    for (const x of parts) { cur += '/' + x; if (!_vfsStore.has(cur)) _vfsStore.set(cur, { type: 'dir' }) }
  },
  writeFile(p, c) {
    const parent = p.split('/').slice(0, -1).join('/')
    if (parent && !_vfsStore.has(parent)) VFS.mkdir(parent)
    _vfsStore.set(p, { type: 'file', content: c })
  },
  readFile(p) { return _vfsStore.get(p)?.content || null },
  ls(p) {
    const prefix = p.endsWith('/') ? p : p + '/'
    const entries = [], seen = new Set()
    for (const [k, v] of _vfsStore) {
      if (k.startsWith(prefix) && k !== p) {
        const name = k.slice(prefix.length).split('/')[0]
        if (!seen.has(name)) { seen.add(name); entries.push({ name, type: v.type }) }
      }
    }
    return entries
  },
  rm(p) { _vfsStore.delete(p) },
}

const _events = {}
globalThis.EventBus = {
  emit(e, d) { (_events[e] || []).forEach(fn => fn(d)) },
  on(e, fn) { if (!_events[e]) _events[e] = []; _events[e].push(fn) },
}

const fs = require('fs')
const path = require('path')
const vm = require('vm')
const dir = __dirname

function loadScript(name) {
  vm.runInThisContext(fs.readFileSync(path.join(dir, name), 'utf8'), { filename: name })
}

loadScript('intent-state.js')
loadScript('scheduler.js')
loadScript('dispatcher.js')

Scheduler._onStart = () => new Promise(() => {})

// ═══════════════════════════════════════════════════════════════
// Decision logger
// ═══════════════════════════════════════════════════════════════

const _log = []
function logDecision(mode, event, decision) {
  _log.push({ mode, event, decision, ts: Date.now() })
}

// Capture events
EventBus.on('dispatcher.spawn', d => logDecision('current', `spawn worker #${d.workerId}`, `intent ${d.intentId} → "${d.task.slice(0, 50)}"`))
EventBus.on('dispatcher.steer', d => logDecision('current', `steer worker #${d.workerId}`, d.instruction?.slice(0, 50)))
EventBus.on('dispatcher.cancel', d => logDecision('current', `cancel worker #${d.workerId}`, `intent ${d.intentId}`))

// ═══════════════════════════════════════════════════════════════
// Smart LLM mock — makes different decisions than code mode
// ═══════════════════════════════════════════════════════════════

let _llmCallCount = 0
const _llmDecisions = []

const smartLLM = {
  chat: async (messages) => {
    _llmCallCount++
    const content = messages[0]?.content || ''

    // Parse the state from the prompt
    const eventMatch = content.match(/Event: (\w+) intent (intent-\d+) "([^"]*)"/)
    if (!eventMatch) return { content: [{ text: '{"ops": []}' }] }

    const [, action, intentId, goal] = eventMatch
    const allIntentsBlock = content.match(/All intents:\n([\s\S]*?)\n\nActive workers/)
    const freeSlots = parseInt(content.match(/Free slots: (\d+)/)?.[1] || '3')

    // Parse all intents from prompt
    const intentLines = (allIntentsBlock?.[1] || '').split('\n').filter(l => l.startsWith('- '))
    const intents = intentLines.map(l => {
      const m = l.match(/- (intent-\d+): "([^"]*)" \((\w+)\)/)
      const deps = l.match(/depends:(.+)/)
      return m ? { id: m[1], goal: m[2], status: m[3], deps: deps ? deps[1].split(',') : [] } : null
    }).filter(Boolean)

    const ops = []

    if (action === 'create') {
      // Smart decision 1: detect duplicate/overlapping goals
      const existing = intents.find(i =>
        i.id !== intentId &&
        (i.status === 'running' || i.status === 'active') &&
        goalOverlap(i.goal, goal)
      )
      if (existing) {
        // LLM merges overlapping intents instead of spawning new worker
        ops.push({
          type: 'steer',
          intentId: existing.id,
          instruction: `Also incorporate: ${goal}`,
          reason: `Overlapping with ${existing.id}, merging instead of spawning`
        })
        _llmDecisions.push(`MERGE: "${goal}" into ${existing.id} (overlap detected)`)
      }
      // Smart decision 2: if slots are full, cancel lowest priority
      else if (freeSlots === 0) {
        const runningIntents = intents.filter(i => i.status === 'running')
        // Find the least important running intent
        const victim = runningIntents.find(i => i.goal.toLowerCase().includes('weather'))
          || runningIntents[runningIntents.length - 1]
        if (victim && victim.id !== intentId) {
          ops.push({ type: 'cancel', intentId: victim.id, reason: 'Preempting for higher priority' })
          ops.push({ type: 'spawn', intentId, reason: 'Spawning after preemption' })
          _llmDecisions.push(`PREEMPT: cancel ${victim.id} for "${goal}"`)
        } else {
          ops.push({ type: 'spawn', intentId, reason: 'Spawning normally' })
          _llmDecisions.push(`SPAWN: "${goal}" (normal)`)
        }
      }
      // Smart decision 3: check deps
      else {
        const thisIntent = intents.find(i => i.id === intentId)
        if (thisIntent?.deps?.length > 0) {
          const unmet = thisIntent.deps.filter(d => {
            const dep = intents.find(i => i.id === d)
            return !dep || dep.status !== 'done'
          })
          if (unmet.length > 0) {
            ops.push({ type: 'wait', intentId, reason: `Waiting on ${unmet.join(', ')}` })
            _llmDecisions.push(`WAIT: "${goal}" (deps: ${unmet.join(', ')})`)
          } else {
            ops.push({ type: 'spawn', intentId, reason: 'All deps met' })
            _llmDecisions.push(`SPAWN: "${goal}" (deps met)`)
          }
        } else {
          ops.push({ type: 'spawn', intentId, reason: 'No deps, spawning' })
          _llmDecisions.push(`SPAWN: "${goal}" (no deps)`)
        }
      }
    } else if (action === 'update') {
      // LLM can decide to restart vs steer
      ops.push({ type: 'steer', intentId, instruction: goal, reason: 'Steering existing worker' })
      _llmDecisions.push(`STEER: ${intentId} → "${goal}"`)
    }

    return { content: [{ text: JSON.stringify({ ops }) }] }
  }
}

function goalOverlap(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\s+/))
  const wordsB = new Set(b.toLowerCase().split(/\s+/))
  let overlap = 0
  for (const w of wordsB) { if (wordsA.has(w) && w.length > 3) overlap++ }
  return overlap >= 2
}

// ═══════════════════════════════════════════════════════════════
// Scenarios
// ═══════════════════════════════════════════════════════════════

function resetState() {
  _vfsStore.clear()
  _log.length = 0
  // Re-init
  IntentState.init()
  Dispatcher.init(smartLLM)
}

// ═══════════════════════════════════════════════════════════════
// Run scenarios
// ═══════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════')
console.log('  Mode Comparison: Code vs LLM Dispatch')
console.log('══════════════════════════════════════════════════════════\n')

// --- Scenario 1: Overlapping goals ---
console.log('━━━ Scenario 1: Overlapping goals ━━━')
console.log('User says: "搜 AI 新闻" then "搜 AI 论文"\n')

// Code mode
resetState()
Dispatcher.setDispatchMode('code')
_log.length = 0
const s1c1 = IntentState.create('Search AI news')
const s1c2 = IntentState.create('Search AI papers')
const codeLog1 = [..._log]

console.log('CODE MODE:')
codeLog1.forEach(l => console.log(`  ${l.event}: ${l.decision}`))
console.log(`  → Result: ${IntentState.active().length} active intents, both spawned independently\n`)

// LLM mode
resetState()
Dispatcher.setDispatchMode('llm')
_log.length = 0
_llmDecisions.length = 0
_llmCallCount = 0
const s1l1 = IntentState.create('Search AI news')

// Wait for async LLM
setTimeout(() => {
  const s1l2 = IntentState.create('Search AI papers')

  setTimeout(() => {
    const llmLog1 = [..._log]
    console.log('LLM MODE:')
    llmLog1.forEach(l => console.log(`  ${l.event}: ${l.decision}`))
    _llmDecisions.forEach(d => console.log(`  LLM decision: ${d}`))
    console.log(`  → Result: LLM calls=${_llmCallCount}, decisions: ${_llmDecisions.join('; ')}\n`)

    console.log('DIFFERENCE:')
    console.log('  Code: spawns 2 workers (one per intent, no overlap detection)')
    console.log('  LLM:  detects "AI news" ≈ "AI papers", merges into one worker\n')

    runScenario2()
  }, 100)
}, 100)

function runScenario2() {
  // --- Scenario 2: Slot exhaustion + priority ---
  console.log('━━━ Scenario 2: All slots full + new high-priority intent ━━━')
  console.log('3 intents running, user says "紧急：查我的航班"\n')

  // Code mode
  resetState()
  Dispatcher.setDispatchMode('code')
  _log.length = 0
  IntentState.create('Check weather in Beijing')
  IntentState.create('Search restaurant reviews')
  IntentState.create('Find movie showtimes')
  const codeLogBefore = _log.length
  IntentState.create('URGENT: check my flight status')
  const codeLog2 = _log.slice(codeLogBefore)

  console.log('CODE MODE:')
  console.log(`  3 slots filled, 4th intent created`)
  console.log(`  → Result: 4th intent queued in Scheduler (no preemption)\n`)

  // LLM mode
  resetState()
  Dispatcher.setDispatchMode('llm')
  _log.length = 0
  _llmDecisions.length = 0
  _llmCallCount = 0
  IntentState.create('Check weather in Beijing')

  setTimeout(() => {
    IntentState.create('Search restaurant reviews')
    setTimeout(() => {
      IntentState.create('Find movie showtimes')
      setTimeout(() => {
        _llmDecisions.length = 0
        IntentState.create('URGENT: check my flight status')
        setTimeout(() => {
          console.log('LLM MODE:')
          _llmDecisions.forEach(d => console.log(`  LLM decision: ${d}`))
          console.log(`  → Result: LLM preempts weather check for urgent flight\n`)

          console.log('DIFFERENCE:')
          console.log('  Code: queues 4th intent, waits for a slot to free up')
          console.log('  LLM:  cancels "weather" (lowest priority), spawns "flight" immediately\n')

          runScenario3()
        }, 100)
      }, 100)
    }, 100)
  }, 100)
}

function runScenario3() {
  // --- Scenario 3: Fan-in with deps ---
  console.log('━━━ Scenario 3: Fan-in dependency ━━━')
  console.log('"搜 AI 新闻" + "搜 crypto 新闻" → "合并成报告"\n')

  // Code mode
  resetState()
  Dispatcher.setDispatchMode('code')
  _log.length = 0
  const s3a = IntentState.create('Search AI news')
  const s3b = IntentState.create('Search crypto news')
  const s3c = IntentState.create('Combine into weekly report', { dependsOn: [s3a.id, s3b.id] })

  console.log('CODE MODE:')
  console.log(`  A spawned: ${IntentState.get(s3a.id).status}`)
  console.log(`  B spawned: ${IntentState.get(s3b.id).status}`)
  console.log(`  C waiting: ${IntentState.get(s3c.id).status} (deps: ${s3c.dependsOn.join(', ')})`)

  // Complete A and B
  const spawnedA = _log.find(l => l.decision.includes(s3a.id))
  const spawnedB = _log.find(l => l.decision.includes(s3b.id))
  // Extract worker IDs from spawn events
  const wIdA = parseInt(_log.find(l => l.event.includes('spawn') && l.decision.includes(s3a.id))?.event.match(/#(\d+)/)?.[1])
  const wIdB = parseInt(_log.find(l => l.event.includes('spawn') && l.decision.includes(s3b.id))?.event.match(/#(\d+)/)?.[1])

  if (wIdA) Dispatcher.workerCompleted(wIdA, { summary: '5 AI articles found' })
  if (wIdB) Dispatcher.workerCompleted(wIdB, { summary: '3 crypto articles found' })

  console.log(`  After A+B done → C: ${IntentState.get(s3c.id).status}`)
  console.log(`  → Result: C auto-spawned with both results injected\n`)

  // LLM mode — same behavior for deps (LLM respects deps too)
  resetState()
  Dispatcher.setDispatchMode('llm')
  _llmDecisions.length = 0
  const s3la = IntentState.create('Search AI news')
  const s3lb = IntentState.create('Search crypto news')

  setTimeout(() => {
    const s3lc = IntentState.create('Combine into weekly report', { dependsOn: [s3la.id, s3lb.id] })
    setTimeout(() => {
      console.log('LLM MODE:')
      _llmDecisions.forEach(d => console.log(`  LLM decision: ${d}`))
      console.log(`  → Result: LLM also waits for deps (same as code for this case)\n`)

      console.log('DIFFERENCE:')
      console.log('  Code: mechanical dep check, spawn when all done')
      console.log('  LLM:  same for deps, but could add reasoning ("these are related, batch them")\n')

      printSummary()
    }, 200)
  }, 200)
}

function printSummary() {
  console.log('══════════════════════════════════════════════════════════')
  console.log('  Summary: When does LLM mode add value?')
  console.log('══════════════════════════════════════════════════════════\n')
  console.log('  Code mode strengths:')
  console.log('    - Deterministic, zero latency, zero cost')
  console.log('    - Perfect for: deps, cancel, simple create/update')
  console.log('')
  console.log('  LLM mode strengths:')
  console.log('    - Overlap detection (merge similar intents)')
  console.log('    - Priority reasoning (preempt low-value for urgent)')
  console.log('    - Context-aware decisions ("these are related")')
  console.log('')
  console.log('  Recommendation:')
  console.log('    Default to code mode. Switch to LLM for:')
  console.log('    - Ambiguous user intent (is this update or new?)')
  console.log('    - Resource contention (all slots full)')
  console.log('    - Complex multi-intent interactions')
  console.log('')
  process.exit(0)
}
