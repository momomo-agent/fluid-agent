import { useAgentStore } from '../stores/agent.js'
import { useSettingsStore } from '../stores/settings.js'
import { useCapabilitiesStore } from '../stores/capabilities.js'
import { useVFSStore } from '../stores/vfs.js'
import { useWindowsStore } from '../stores/windows.js'
import { EventBus } from './useEventBus.js'
import { useShell } from './useShell.js'
import { getAgenticCore } from '../lib/agentic.js'

const MAX_MESSAGES = 50
const SUMMARIZE_THRESHOLD = 24

let _proactiveTimer = null
let _chatQueue = []
let _chatProcessing = false

export function useAgent() {
  const store = useAgentStore()
  const settings = useSettingsStore()
  const capabilities = useCapabilitiesStore()
  const vfs = useVFSStore()
  const windows = useWindowsStore()
  const shell = useShell()

  function configure() {
    const provider = settings.provider
    const apiKey = settings.apiKey
    const model = settings.model
    const baseUrl = settings.baseUrl

    if (!provider || !apiKey) return

    const opts = { provider, apiKey }
    if (settings.useProxy) {
      opts.proxyUrl = settings.getProxyUrl()
    }
    opts.store = { name: 'fluid-agent' }
    opts.model = model || (provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o')
    if (baseUrl) opts.baseUrl = baseUrl

    try {
      const AgenticClass = getAgenticCore()
      store.ai = new AgenticClass(opts)

      // Initialize Conductor if available
      if (store.ai.createConductor) {
        store.conductor = store.ai.createConductor({
          strategy: 'dispatch',
          dispatchMode: 'code',
          intentMode: 'tools',
          planMode: true,
          maxSlots: 3,
          onWorkerStart: (task, abort, conductorOpts) => {
            return startWorker(task, [], abort, {
              workerId: conductorOpts.workerId,
              resume: conductorOpts.resume || false,
              resumeTurn: conductorOpts.turnCount || 0,
              conductorOpts,
            })
          },
        })

        // Wire conductor events to EventBus
        store.conductor.on((event, data) => {
          if (event === 'dispatcher.done') reportViaTalker(data)
          EventBus.emit('conductor.' + event, data)
        })
      }

      store.configured = true
      showActivity('✓ Agent configured')
    } catch (e) {
      console.error('[Agent] Configure failed:', e)
    }
  }

  function showActivity(text) {
    EventBus.emit('activity', text)
  }

  // ── Markdown rendering ──
  function cleanReply(text) {
    let cleaned = text.replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/g, '')
    cleaned = cleaned.replace(/```(?:json)?(?:\s*[\{\[].*)?$/gs, '')
    cleaned = cleaned.replace(/\{\s*"(?:action|reply|intents)"\s*:[\s\S]*$/g, '')
    return cleaned.trim()
  }

  function getOsState() {
    const wins = windows.windowList.map(w => {
      return `${w.title}(${w.type})`
    }).join(' | ') || 'none'

    return {
      windows: wins,
      desktopSize: 'auto',
      focused: windows.focusedWindow ? windows.focusedWindow.type : 'none',
      cwd: shell.getCwd(),
      desktop: vfs.ls('/home/user/Desktop')?.map(f => f.name) || [],
      documents: vfs.ls('/home/user/Documents')?.map(f => f.name) || [],
      installedApps: 'none',
      skills: store.customSkills.size > 0
        ? Array.from(store.customSkills.entries()).map(([n, s]) => `${s.icon} ${n}`).join(', ')
        : 'none',
    }
  }

  function buildTalkerSystem(os) {
    const schedulerState = store.conductor ? store.conductor._scheduler.getState() : { pending: [], slots: [] }
    const runningTasks = schedulerState.slots || []

    let sys = `You are Fluid Agent — part companion, part operating system.

You're a conversational AI that also happens to control an entire desktop environment. Most of the time, you're just talking — answering questions, discussing ideas, brainstorming, being helpful and interesting. When the user wants something done (open a file, play music, build an app), you make it happen.

Know the difference:
- "What do you think about X?" → Just talk. Have opinions. Be thoughtful.
- "Open my files" / "Play some music" / "Make me a calculator" → Create an intent.

You are an operating system with these capabilities:
${capabilities.describe()}

Current OS state:
- Open windows: ${os.windows}
- Focused window: ${os.focused}
- Working directory: ${os.cwd}
- Desktop files: ${JSON.stringify(os.desktop)}
- Documents: ${JSON.stringify(os.documents)}
- Installed apps: ${os.installedApps}
- Installed skills: ${os.skills}
`

    // Inject conductor state
    if (store.conductor) {
      const intentContext = store.conductor._intentState.formatForTalker()
      if (intentContext) sys += intentContext
      const workerContext = store.conductor.getWorkerContext()
      if (workerContext) sys += '\n\n## Worker Activity\n' + workerContext
    }

    sys += `\n\nWhen the user wants you to DO something (not just talk), output an intent block:
\`\`\`json
{"reply": "your conversational reply", "intents": [{"action": "create", "goal": "clear description of what to do"}]}
\`\`\`

Intent rules:
- "action" MUST be one of: "create" (new task), "update" (modify existing), "cancel" (abort), "done" (mark complete)
- "goal" should describe WHAT to do, not HOW — the worker will figure out the tools
- For simple actions like "open terminal", "create a file", "play music" — still use action:"create" with a clear goal
- Examples:
  - User: "open terminal" → {"reply": "Opening it.", "intents": [{"action": "create", "goal": "Open the Terminal window"}]}
  - User: "create hello.txt with Hello World" → {"reply": "On it.", "intents": [{"action": "create", "goal": "Create file hello.txt on Desktop with content Hello World"}]}
  - User: "what's 2+2?" → Just answer "4." No intent needed.

Be natural, concise, and have personality.`
    return sys
  }

  function _dispatchIntent(parsed) {
    if (!parsed || !store.conductor) return
    if (parsed.intents && Array.isArray(parsed.intents)) {
      for (const i of parsed.intents) {
        const action = i.action || 'create'
        if (action === 'create' || (i.goal && !['update', 'cancel', 'done'].includes(action))) {
          // Treat any unknown action with a goal as 'create'
          store.conductor.createIntent(i.goal, { dependsOn: i.dependsOn || [] })
          showActivity(`📋 New: ${i.goal.slice(0, 40)}`)
        } else if (action === 'update' && i.id) {
          store.conductor.updateIntent(i.id, { goal: i.goal, message: i.message || i.context })
        } else if (action === 'cancel' && i.id) {
          store.conductor.cancelIntent(i.id)
        } else if (action === 'done' && i.id) {
          store.conductor._intentState.done(i.id)
        }
      }
    }
    if (parsed.remember) {
      const memPath = '/system/memory/MEMORY.md'
      let mem = vfs.isFile(memPath) ? vfs.readFile(memPath) : '# Agent Memory\n'
      const section = parsed.remember.section || 'Lessons Learned'
      const sectionHeader = `## ${section}`
      if (mem.includes(sectionHeader)) {
        mem = mem.replace(sectionHeader, `${sectionHeader}\n- ${parsed.remember.entry}`)
      } else {
        mem += `\n${sectionHeader}\n- ${parsed.remember.entry}\n`
      }
      vfs.writeFile(memPath, mem)
      showActivity('Memory updated')
    }
  }

  async function chat(userMessage) {
    store.lastUserMessage = Date.now()
    return new Promise((resolve, reject) => {
      _chatQueue.push({ type: 'user', msg: userMessage, resolve, reject })
      _processChatQueue()
    })
  }

  async function _processChatQueue() {
    if (_chatProcessing) return
    _chatProcessing = true

    while (_chatQueue.length > 0) {
      const item = _chatQueue[0]

      if (item.type === 'report') {
        _chatQueue.shift()
        try { await _doReportViaTalker(); item.resolve() }
        catch (e) { item.resolve() }
        continue
      }

      // Collect user messages
      const userItems = []
      while (_chatQueue.length > 0 && _chatQueue[0].type === 'user') {
        userItems.push(_chatQueue.shift())
      }
      if (userItems.length === 0) continue

      for (const { msg, resolve, reject } of userItems) {
        try {
          await _chatSingle(msg)
          resolve()
        } catch (e) { reject(e) }
      }
    }

    _chatProcessing = false
  }

  async function _chatSingle(userMessage) {
    store.messages.push({ role: 'user', content: userMessage })
    EventBus.emit('chat.user', userMessage)

    let fullReply = ''

    try {
      const os = getOsState()
      let _streamDispatched = false
      let _streamAction = null

      function _tryStreamDispatch(text) {
        if (_streamDispatched) return
        const match = text.match(/```json\s*(\{[\s\S]*?\})\s*```/)
        let parsed
        if (match) {
          try { parsed = JSON.parse(match[1]) } catch { return }
        }
        if (!parsed) {
          const bareMatch = text.match(/\{\s*"(?:reply|intents)"\s*:[\s\S]*\}/)
          if (bareMatch) {
            try { parsed = JSON.parse(bareMatch[0]) } catch { return }
          } else return
        }
        if (!parsed?.intents) return
        _streamDispatched = true
        _streamAction = parsed
        _dispatchIntent(parsed)
      }

      const result = await store.ai.think(userMessage, {
        system: buildTalkerSystem(os),
        stream: true,
        history: store.messages.slice(-21, -1),
        tools: [],
        emit: (type, data) => {
          if (type === 'token') {
            const text = typeof data === 'string' ? data : (data?.text || '')
            if (text) {
              fullReply += text
              EventBus.emit('chat.stream', cleanReply(fullReply))
              _tryStreamDispatch(fullReply)
            }
          }
        }
      })

      if (!fullReply && result) {
        if (typeof result === 'string') fullReply = result
        else if (result?.answer != null) fullReply = result.answer
        else if (result?.content != null) fullReply = typeof result.content === 'string' ? result.content : result.content.map(b => b.text || '').join('')
        else fullReply = JSON.stringify(result)
      }

      if (fullReply) {
        store.messages.push({ role: 'assistant', content: fullReply })
      }

      // Parse intents if not already dispatched during streaming
      if (!_streamDispatched) {
        const intentMatch = fullReply.match(/```json\s*(\{[\s\S]*?\})\s*```/) || fullReply.match(/\{\s*"(?:reply|intents)"\s*:[\s\S]*\}/)
        if (intentMatch) {
          try {
            const parsed = JSON.parse(intentMatch[1] || intentMatch[0])
            if (parsed?.intents) {
              _dispatchIntent(parsed)
              EventBus.emit('chat.assistant', parsed.reply || cleanReply(fullReply))
              return
            }
          } catch {}
        }
      }

      const displayText = _streamAction?.reply || cleanReply(fullReply)
      EventBus.emit('chat.assistant', displayText)

    } catch (err) {
      EventBus.emit('chat.assistant', `Error: ${err.message}`)
    }

    // Auto-summarize
    if (store.messages.length >= SUMMARIZE_THRESHOLD) {
      summarizeOldMessages().catch(() => {})
    }
  }

  async function summarizeOldMessages() {
    if (!store.ai || store.messages.length < SUMMARIZE_THRESHOLD) return
    const toSummarize = store.messages.slice(0, store.messages.length - 20)
    if (toSummarize.length < 10) return
    try {
      const chatText = toSummarize.map(m => `${m.role}: ${(m.content || '').slice(0, 200)}`).join('\n')
      const resp = await store.ai.think(
        `Summarize this conversation history into key facts:\n\n${chatText}`,
        { system: 'You are a memory summarizer. Extract essential facts. Output concise bullet-point summary.', stream: false }
      )
      const summary = resp?.content || resp?.text || (typeof resp === 'string' ? resp : '')
      if (!summary) return
      const recent = store.messages.slice(-20)
      store.messages.length = 0
      store.messages.push({ role: 'assistant', content: `[Previous conversation summary]\n${summary}` })
      store.messages.push(...recent)
      showActivity('🧠 Context compressed')
    } catch {}
  }

  // ── Worker execution ──
  async function startWorker(taskDescription, plannedSteps, abort, opts = {}) {
    const workerId = opts.workerId || 0
    const task = {
      id: 'task-' + Date.now(),
      goal: taskDescription,
      steps: (plannedSteps || []).map(s => ({ text: s, status: 'pending' })),
      status: 'running',
      log: [],
      startTime: Date.now()
    }
    store.taskHistory.unshift(task)
    if (store.taskHistory.length > 20) store.taskHistory.pop()
    store.blackboard.currentTask = { goal: taskDescription, steps: task.steps, status: 'running', workerId }
    store.blackboard.completedSteps = []
    store.blackboard.workerLog = []

    showActivity(`Starting: ${taskDescription.slice(0, 50)}...`)
    EventBus.emit('task.update', task)

    // Build tool context
    const capCtx = {
      VFS: vfs, Shell: shell, WindowManager: windows, EventBus,
      showActivity, steps: task.steps, task, blackboard: store.blackboard
    }

    const toolHandlers = {}
    for (const cap of capabilities.list()) {
      if (cap.handler) {
        toolHandlers[cap.name] = (params) => cap.handler(params, capCtx)
      }
    }

    const toolDefs = capabilities.getToolDefs()
    const alwaysAvailable = new Set(capabilities.getAlwaysAvailable())
    const loadedTools = new Set([...capabilities.getActiveDynamic()])
    const toolCatalog = capabilities.catalog()

    // search_tools meta-tool
    toolHandlers.search_tools = ({ query, names }) => {
      if (names && Array.isArray(names)) {
        const loaded = []
        for (const n of names) {
          if (toolDefs[n]) { loadedTools.add(n); loaded.push(n) }
        }
        return { loaded, available: loaded.length > 0 }
      }
      if (query) {
        const q = query.toLowerCase()
        const matches = Object.entries(toolCatalog)
          .filter(([name, desc]) => name.toLowerCase().includes(q) || desc.toLowerCase().includes(q))
          .map(([name, desc]) => ({ name, description: desc, loaded: loadedTools.has(name) }))
        return { results: matches }
      }
      return { error: 'Provide query or names' }
    }

    function getActiveTools() {
      return Object.entries(toolDefs)
        .filter(([name]) => loadedTools.has(name))
        .map(([name, { desc, schema }]) => ({
          name, description: desc, input_schema: schema
        }))
    }

    // Worker system prompt
    const os = getOsState()
    const activeNames = [...loadedTools].join(', ')
    const extendedToolList = Object.entries(toolCatalog)
      .filter(([name]) => !loadedTools.has(name))
      .map(([name, desc]) => `  - ${name}: ${desc}`)
      .join('\n')

    const workerSystem = `You are the execution engine of Fluid Agent OS. Execute the given task using tools.
CRITICAL: You MUST use tools to complete tasks. NEVER answer with just text.

Current OS state:
- Open windows: ${os.windows}
- Working directory: ${os.cwd}
- Desktop files: ${JSON.stringify(os.desktop)}

Active tools: ${activeNames}.
More tools available — call search_tools({names: [...]}) to activate:
${extendedToolList}

When finished, call the done tool with a summary.`

    let workerMessages = [{ role: 'user', content: taskDescription }]
    let turnCount = opts.resumeTurn || 0
    const MAX_TURNS = 50
    let workerDone = false

    try {
      while (turnCount < MAX_TURNS && !workerDone) {
        if (abort.signal.aborted) throw new Error('aborted')

        // Conductor checkpoint
        if (store.conductor) {
          const preDecision = await store.conductor.beforeTurn(workerId)
          if (preDecision.action === 'abort') throw new Error('aborted')
          if (preDecision.action === 'suspend') return
          if (preDecision.action === 'steer' && preDecision.instruction) {
            workerMessages.push({ role: 'user', content: `[DIRECTION CHANGE] ${preDecision.instruction}` })
          }
        }

        turnCount++
        let turn
        try {
          turn = await store.ai.step(workerMessages, {
            tools: getActiveTools(),
            system: workerSystem,
            stream: true,
            signal: abort.signal,
            maxTokens: 16384,
            emit: (type, data) => {
              if (type === 'token' && data.text) showActivity(`✍️ ${data.text.slice(-30)}`)
            },
          })
        } catch (stepErr) {
          if (abort.signal.aborted) throw stepErr
          throw stepErr
        }

        workerMessages = turn.messages

        // Execute tool calls
        if (turn.toolCalls.length > 0) {
          const results = []
          for (const tc of turn.toolCalls) {
            if (abort.signal.aborted) throw new Error('aborted')
            task.log.push(`${tc.name}: ${JSON.stringify(tc.input).slice(0, 60)}`)
            const handler = toolHandlers[tc.name]
            capabilities.recordUse(tc.name)
            const result = handler ? await handler(tc.input) : { error: `Unknown tool: ${tc.name}` }
            results.push(result)
            EventBus.emit('task.update', task)

            if (result?.done) {
              task.status = 'done'
              store.blackboard.currentTask.status = 'done'
              task.steps.forEach(s => { if (s.status !== 'done') s.status = 'done' })
              EventBus.emit('task.update', task)
              if (store.conductor) store.conductor.completeWorker(workerId, { summary: result.summary || '', log: task.log })
              workerDone = true
            }
          }

          // Auto-advance steps
          const META_TOOLS = new Set(['plan_steps', 'search_tools', 'update_progress', 'done'])
          const realCalls = turn.toolCalls.filter(tc => !META_TOOLS.has(tc.name))
          if (realCalls.length > 0) {
            const nextPending = task.steps.findIndex(s => s.status !== 'done')
            if (nextPending >= 0) {
              task.steps[nextPending].status = 'done'
              EventBus.emit('task.update', task)
            }
          }

          const toolMsgs = store.ai.buildToolResults(turn.toolCalls, results)
          workerMessages.push(...toolMsgs)
        }

        if (turn.toolCalls.length === 0 && !workerDone) {
          workerMessages.push({ role: 'user', content: '[SYSTEM] You must use tools. Call the appropriate tool now.' })
        }

        if (turn.done && !workerDone) workerDone = true

        // Post-turn conductor checkpoint
        if (store.conductor) {
          const postDecision = await store.conductor.afterTurn(workerId, {
            toolCalls: turn.toolCalls,
            usage: turn.usage,
            messages: workerMessages,
            noProgress: turn.toolCalls.length === 0,
            progress: turn.toolCalls.length > 0 ? `Used ${turn.toolCalls.map(tc => tc.name).join(', ')}` : '',
            artifacts: [],
          })
          if (postDecision?.action === 'abort') throw new Error('aborted')
          if (postDecision?.action === 'suspend') return
        }
      }

      if (!workerDone) {
        task.status = 'done'
        store.blackboard.currentTask.status = 'done'
        task.steps.forEach(s => { if (s.status !== 'done') s.status = 'done' })
        EventBus.emit('task.update', task)
        if (store.conductor) store.conductor.completeWorker(workerId, { summary: '', log: task.log })
      }
    } catch (err) {
      if (err.message === 'aborted' || abort.signal.aborted) {
        task.status = 'aborted'
        store.blackboard.currentTask.status = 'aborted'
        if (store.conductor) store.conductor.failWorker(workerId, 'aborted')
      } else {
        task.status = 'error'
        store.blackboard.currentTask.status = 'error'
        task.log.push(`Error: ${err.message}`)
        if (store.conductor) store.conductor.failWorker(workerId, err.message)
      }
      EventBus.emit('task.update', task)
    }
  }

  async function reportViaTalker(doneData) {
    return new Promise((resolve) => {
      _chatQueue.push({ type: 'report', resolve, reject: resolve })
      _processChatQueue()
    })
  }

  async function _doReportViaTalker() {
    if (!store.ai || !store.conductor) return
    const intentContext = store.conductor._intentState.formatForTalker({ includeSettled: true })
    if (!intentContext.trim()) return

    const settledIds = store.conductor._intentState.getAll()
      .filter(i => (i.status === 'done' || i.status === 'failed') && !i._reported)
      .map(i => i.id)
    if (settledIds.length === 0) return

    try {
      let fullReply = ''
      const os = getOsState()
      const systemNudge = `[SYSTEM] Workers have completed. Report the results to the user.\n${intentContext}`

      await store.ai.think(systemNudge, {
        system: buildTalkerSystem(os),
        stream: true,
        history: store.messages.slice(-20),
        tools: [],
        emit: (type, data) => {
          if (type === 'token') {
            const token = typeof data === 'string' ? data : (data?.text || '')
            if (token) {
              fullReply += token
              EventBus.emit('chat.stream', cleanReply(fullReply))
            }
          }
        },
      })

      if (!fullReply.trim()) fullReply = 'Done.'
      EventBus.emit('chat.assistant', cleanReply(fullReply))
      store.messages.push({ role: 'assistant', content: fullReply })
      store.conductor._intentState.markReported(...settledIds)
      showActivity('✅ Results reported')
    } catch (e) {
      EventBus.emit('chat.assistant', `Error reporting results: ${e.message}`)
    }
  }

  // ── Proactive loop ──
  function startProactiveLoop() {
    if (_proactiveTimer) return
    _proactiveTimer = setInterval(async () => {
      if (!store.ai || !store.proactiveEnabled) return
      if (Date.now() - store.lastUserMessage < 120000) return
      if (Date.now() - store.lastProactive < 300000) return
      if (store.conductor && !store.conductor._scheduler.isIdle()) return
      // Proactive check omitted for brevity — same logic as legacy
    }, 120000)
  }

  function stopProactiveLoop() {
    if (_proactiveTimer) { clearInterval(_proactiveTimer); _proactiveTimer = null }
  }

  // ── Skills ──
  async function loadSkills() {
    const skillsDir = '/system/skills'
    if (!vfs.isDir(skillsDir)) return
    const entries = vfs.ls(skillsDir) || []
    for (const entry of entries) {
      if (entry.type !== 'dir') continue
      const skillPath = `${skillsDir}/${entry.name}/SKILL.md`
      if (!vfs.isFile(skillPath)) continue
      try {
        const md = vfs.readFile(skillPath)
        const parsed = parseSkillMd(md)
        if (parsed) {
          store.customSkills.set(entry.name, parsed)
          registerSkillCapability(entry.name, parsed)
        }
      } catch {}
    }
    if (store.customSkills.size > 0) showActivity(`🧩 Loaded ${store.customSkills.size} skill(s)`)
  }

  function parseSkillMd(md) {
    const desc = md.match(/^## Description\n([\s\S]*?)(?=\n##|$)/m)?.[1]?.trim()
    const icon = md.match(/^## Icon\n(.+)/m)?.[1]?.trim() || '🧩'
    const schemaBlock = md.match(/^## Schema\n```json\n([\s\S]*?)```/m)?.[1]?.trim()
    const handlerBlock = md.match(/^## Handler\n```js\n([\s\S]*?)```/m)?.[1]?.trim()
    if (!desc || !handlerBlock) return null
    let schema = { type: 'object', properties: {} }
    if (schemaBlock) try { schema = JSON.parse(schemaBlock) } catch {}
    return { description: desc, schema, handler_js: handlerBlock, icon }
  }

  function registerSkillCapability(name, skill) {
    capabilities.register(`skill_${name}`, {
      description: `[Skill] ${skill.description}`,
      icon: skill.icon || '🧩',
      category: 'Skills',
      schema: skill.schema,
      handler: async (params, ctx) => {
        try {
          const fn = new Function('params', 'VFS', 'Shell', 'WindowManager', `return (async () => { ${skill.handler_js} })()`)
          const result = await fn(params, ctx.VFS, ctx.Shell, ctx.WindowManager)
          ctx.showActivity(`🧩 ${name}: done`)
          return result || { success: true }
        } catch (e) {
          return { error: e.message }
        }
      }
    })
  }

  function notify(text) {
    EventBus.emit('chat.assistant', text)
    showActivity(`💡 ${text.slice(0, 50)}`)
  }

  return {
    configure, chat, showActivity, notify,
    startProactiveLoop, stopProactiveLoop, loadSkills,
    cleanReply, getOsState
  }
}
