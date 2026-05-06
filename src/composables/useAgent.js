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
const CHAT_STORAGE_KEY = 'fluid-chat'

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
      const flags = [w.id === windows.focusedId && 'focused', w.minimized && 'min', w.maximized && 'max'].filter(Boolean).join(',')
      return `${w.title}(${w.type})${flags ? ' {' + flags + '}' : ''}`
    }).join(' | ') || 'none'

    // Installed apps from /home/user/apps
    const appDirs = vfs.ls('/home/user/apps') || []
    const installedApps = appDirs.filter(d => d.type === 'dir').map(d => {
      try {
        const manifest = JSON.parse(vfs.readFile(`/home/user/apps/${d.name}/manifest.json`) || '{}')
        return `${manifest.icon || '💻'} ${manifest.name || d.name}`
      } catch { return `💻 ${d.name}` }
    }).join(', ') || 'none'

    return {
      windows: wins,
      desktopSize: `${window.innerWidth}x${window.innerHeight}`,
      focused: windows.focusedWindow ? `${windows.focusedWindow.type}${windows.focusedWindow.data?.path ? ' (' + windows.focusedWindow.data.path + ')' : ''}` : 'none',
      cwd: shell.getCwd(),
      desktop: vfs.ls('/home/user/Desktop')?.map(f => f.name) || [],
      documents: vfs.ls('/home/user/Documents')?.map(f => f.name) || [],
      installedApps,
      skills: store.customSkills.size > 0
        ? Array.from(store.customSkills.entries()).map(([n, s]) => `${s.icon} ${n}`).join(', ')
        : 'none',
    }
  }

  function buildTalkerSystem(os) {
    const schedulerState = store.conductor ? store.conductor._scheduler.getState() : { pending: [], slots: [] }

    // Load soul from VFS
    const soul = vfs.isFile('/system/SOUL.md') ? vfs.readFile('/system/SOUL.md') : ''

    let sys = `You are Fluid Agent — part companion, part operating system.

You're a conversational AI that also happens to control an entire desktop environment. Most of the time, you're just talking — answering questions, discussing ideas, brainstorming, being helpful and interesting. When the user wants something done (open a file, play music, build an app), you make it happen.

${soul ? `## Your Soul\n${soul}\n` : ''}

Know the difference:
- "What do you think about X?" → Just talk. Have opinions. Be thoughtful.
- "Open my files" / "Play some music" / "Make me a calculator" → Create an intent.
- "Find X in my files" → Reply first ("Let me look"), then create an intent.

You are an operating system with these capabilities (Workers use these tools to execute tasks):
${capabilities.describe()}

IMPORTANT: Use native tools, not the browser. Music → search_music + music tool. Weather → get_weather. Maps → map tool. Only use browser when the user explicitly wants to browse a website.

Current OS state:
- Desktop size: ${os.desktopSize}
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

    sys += `\nCompleted recently: ${store.blackboard.completedSteps.map(s => s.text).join(', ') || 'none'}`

    sys += `\n\nWhen the user wants you to DO something (not just talk), output an intent block.

Your job is to understand what the user wants and express it as intents. You do NOT decide how to schedule or execute — the Dispatcher handles that.

## Intent Actions

**CREATE** — user wants something new done:
\`\`\`json
{"reply": "your reply", "intents": [{"action": "create", "goal": "clear description of what to achieve"}]}
\`\`\`

**CREATE with dependencies** — new intent that needs results from other intents:
\`\`\`json
{"reply": "your reply", "intents": [{"action": "create", "goal": "combine results into a report", "dependsOn": ["intent-1", "intent-2"]}]}
\`\`\`

**UPDATE** — user refines, adds to, or changes an existing intent:
\`\`\`json
{"reply": "your reply", "intents": [{"action": "update", "id": "intent-1", "goal": "re-summarized complete goal", "message": "the user's exact words"}]}
\`\`\`

**CANCEL** — user wants to stop something:
\`\`\`json
{"reply": "your reply", "intents": [{"action": "cancel", "id": "intent-1"}]}
\`\`\`

**DONE** — mark intent as completed:
\`\`\`json
{"reply": "your reply", "intents": [{"action": "done", "id": "intent-1"}]}
\`\`\`

## Key Rules

1. Check Active Intents above. If the user's message relates to an existing intent, UPDATE it — don't create a duplicate.
2. Write clear, complete goals. "播放一下" is bad. "播放刚才找到的周杰伦的歌" is good.
3. Multiple independent goals = multiple create intents in one block.
4. Sequential goals (B depends on A) = create B with dependsOn: ["intent-A"].
5. BIAS TOWARD ACTION: If the user's request could be fulfilled by using tools, create an intent. Only skip intents for pure opinions, philosophical questions, or casual chat.
6. DON'T ASK, DO: If information is missing, make reasonable assumptions and act.
7. NO TOOL ≠ NO ACTION: If no dedicated tool exists, use general tools creatively.

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

    if (!store.ai) {
      // Auto-configure if settings exist but ai not initialized
      const settings = useSettingsStore()
      if (settings.isConfigured()) configure()
      if (!store.ai) {
        EventBus.emit('chat.assistant', 'Please configure your API key in Settings first.')
        return
      }
    }

    let fullReply = ''
    showActivity('Thinking...')

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

      // Auto-memory: judge if this exchange is worth remembering
      autoMemory(userMessage, fullReply)

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
    const soul = vfs.isFile('/system/SOUL.md') ? vfs.readFile('/system/SOUL.md') : ''

    const workerSystem = `${soul ? soul + '\n\n' : ''}You are the execution engine of Fluid Agent OS. Execute the given task using tools.
CRITICAL: You MUST use tools to complete tasks. NEVER answer with just text — always call tools to take action. If you need information, call web_search. If you need to show results, call dynamicapp. Text-only responses are failures.

Current OS state:
- Desktop size: ${os.desktopSize}
- Open windows: ${os.windows}
- Working directory: ${os.cwd}
- Desktop files: ${JSON.stringify(os.desktop)}
- Installed apps: ${os.installedApps}

Planned steps:
${task.steps.length ? task.steps.map((s, i) => (i + '. ' + s.text)).join('\n') : '(none — call plan_steps first to set your execution plan)'}

## Tool System
Active tools: ${activeNames}.

More tools available — call search_tools({names: [...]}) to activate:
${extendedToolList}

PREFER native apps over browser. Use music for music, map for locations, video for videos.
The browser app fetches and renders web content (not an iframe). For data extraction and search, use web_search/web_fetch tools directly.
To play music: search_tools({names:["search_music","music"]}) → search_music({query}) → music({action:"add_and_play",...}).
Once loaded, tools stay available for the rest of this task.

## Apps — Unified Format

Every app is a directory with manifest.json + optional view/data/actions files.

### Quick App (dynamicapp tool — ephemeral, /tmp/apps/)
For task results, dashboards, quick visualizations:
- dynamicapp({action:"open", id:"weather", title:"Weather", icon:"🌤️", object:{temp:"25°C"}, html:"<div>...</div>"})
- Data available as window.__app.data in your HTML
- Dispatch actions via window.__app.dispatch(actionId, params)
- Listen for data updates: window.__app.onDataUpdate(callback)
- Update data: dynamicapp({action:"update", id:"weather", object:{temp:"30°C"}}) — view auto-updates

### Persistent App (fs + app tool — /home/user/apps/)
For apps the user wants to keep:
1. Write files using fs tool
2. Then: app({action:"create", name:"my-app"})

### Design Guidelines for Custom HTML
- Dark theme: use dark backgrounds (#1a1a2e, #16213e, #0f0c29) with light text
- Use modern CSS: flexbox, grid, gradients, border-radius, backdrop-filter
- Monospace fonts for numbers/data: ui-monospace, 'SF Mono', monospace
- System font for text: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
- Accent colors: #4ade80 (green), #60a5fa (blue), #f472b6 (pink), #fbbf24 (amber)
- Keep it minimal — less is more. White space is good.

IMPORTANT: If no planned steps are listed above, call plan_steps FIRST to set your execution plan.
When finished, call the done tool with a summary. Set summary to "silent" if the action itself IS the result (e.g. playing music, changing wallpaper).`

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
        let turn, retries = 0
        while (retries < 3) {
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
            break
          } catch (stepErr) {
            if (abort.signal.aborted) throw stepErr
            retries++
            if (retries >= 3) throw stepErr
            const isRetryable = stepErr.message?.includes('network') || stepErr.message?.includes('fetch') || stepErr.message?.includes('ERR_') || [429, 500, 502, 503].includes(stepErr.status)
            if (!isRetryable) throw stepErr
            const delay = retries * 2000
            console.warn(`[Worker] Retry ${retries}/3 after: ${stepErr.message} (waiting ${delay}ms)`)
            showActivity(`⚠️ Retry ${retries}/3...`)
            await new Promise(r => setTimeout(r, delay))
          }
        }

        workerMessages = turn.messages

        // Execute tool calls
        let _turnArtifacts = []
        if (turn.toolCalls.length > 0) {
          const results = []
          for (const tc of turn.toolCalls) {
            if (abort.signal.aborted) throw new Error('aborted')
            store.blackboard.workerLog.push({ tool: tc.name, params: tc.input, time: Date.now() })
            task.log.push(`${tc.name}: ${JSON.stringify(tc.input).slice(0, 60)}`)
            EventBus.emit('tool.call', { name: tc.name, input: JSON.stringify(tc.input).slice(0, 80) })
            showActivity(`🔧 ${tc.name}`)
            const handler = toolHandlers[tc.name]
            capabilities.recordUse(tc.name)
            const result = handler ? await handler(tc.input) : { error: `Unknown tool: ${tc.name}` }
            results.push(result)

            // Extract artifacts (window IDs, file paths)
            const rs = typeof result === 'string' ? result : JSON.stringify(result || '')
            const winMatch = rs.match(/"winId"\s*:\s*"(win-\d+)"/)
            if (winMatch) _turnArtifacts.push(winMatch[1])
            const pathMatch = rs.match(/\/home\/[^"\s]+/g)
            if (pathMatch) _turnArtifacts.push(...pathMatch)

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
            noProgress: turn.toolCalls.length === 0 && !turn.text,
            progress: turn.toolCalls.length > 0 ? `Used ${turn.toolCalls.map(tc => tc.name).join(', ')}` : (turn.text?.slice(0, 150) || ''),
            artifacts: _turnArtifacts,
          })
          if (postDecision?.action === 'abort') throw new Error('aborted')
          if (postDecision?.action === 'suspend') return
          if (postDecision?.action === 'steer' && postDecision.instruction) {
            workerMessages.push({ role: 'user', content: `[DIRECTION CHANGE] ${postDecision.instruction}` })
            task.log.push(`↪ Steered: ${postDecision.instruction}`)
            showActivity(`↪ Steering: ${postDecision.instruction.slice(0, 40)}`)
          }
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
      const idleTime = Date.now() - store.lastUserMessage
      if (idleTime < 120000) return // User active within 2 min
      if (Date.now() - store.lastProactive < 300000) return // Cooldown 5 min
      if (store.conductor && !store.conductor._scheduler.isIdle()) return

      // Detect signals
      const signals = []

      // Check VFS changes
      const desktopFiles = vfs.ls('/home/user/Desktop') || []
      const docFiles = vfs.ls('/home/user/Documents') || []
      const totalFiles = desktopFiles.length + docFiles.length
      if (totalFiles > 0 && !store._lastFileCount) store._lastFileCount = totalFiles
      if (store._lastFileCount && totalFiles !== store._lastFileCount) {
        signals.push('filesystem_change')
      }
      store._lastFileCount = totalFiles

      // Idle signal
      if (idleTime > 300000) signals.push('idle')

      // Error signal: check if last task failed
      if (store.taskHistory.length > 0 && store.taskHistory[0].status === 'error') {
        signals.push('error')
      }

      // Rapid switch: multiple tasks in short time
      const recentTasks = store.taskHistory.filter(t => Date.now() - t.startTime < 300000)
      if (recentTasks.length >= 3) signals.push('rapid_switch')

      if (signals.length === 0) return

      store.lastProactive = Date.now()

      try {
        const os = getOsState()
        const resp = await store.ai.think(
          `[PROACTIVE] User has been idle for ${Math.floor(idleTime / 1000)}s. Signals: ${signals.join(', ')}. OS state: ${JSON.stringify(os)}. Offer a brief, helpful suggestion or observation if appropriate. Keep it to one sentence. If nothing useful to say, respond with just "[SKIP]".`,
          { system: 'You are Fluid Agent in proactive mode. Be helpful but not annoying. One sentence max.', stream: false }
        )
        const text = resp?.content || resp?.text || (typeof resp === 'string' ? resp : '')
        if (text && !text.includes('[SKIP]')) {
          EventBus.emit('chat.assistant', `💡 ${text.trim()}`)
          store.messages.push({ role: 'assistant', content: `💡 ${text.trim()}` })
        }
      } catch {}
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

  // ── Auto Memory ──
  async function autoMemory(userMsg, agentReply) {
    if (!store.ai) return
    try {
      const memPath = '/system/memory/MEMORY.md'
      const currentMem = vfs.isFile(memPath) ? vfs.readFile(memPath) : ''
      const resp = await store.ai.think(
        `User said: "${userMsg.slice(0, 300)}"\nYou replied: "${agentReply.slice(0, 300)}"\n\nCurrent memory:\n${currentMem.slice(0, 500)}`,
        {
          system: `You are the memory system of Fluid Agent OS. Decide if this exchange contains something worth remembering long-term: user preferences, facts about the user, project context, important decisions, or lessons learned.\n\nRespond with JSON only:\n{"remember": false}\nor\n{"remember": true, "section": "About You|Preferences|Projects|Lessons Learned", "entry": "concise fact to remember"}\n\nBe selective. Only remember genuinely useful facts. Don't remember greetings, small talk, or transient requests.`,
          stream: false,
        }
      )
      const text = resp?.content || resp?.text || (typeof resp === 'string' ? resp : '')
      const jsonMatch = text.match(/\{[\s\S]*?\}/)
      if (!jsonMatch) return
      const decision = JSON.parse(jsonMatch[0])
      if (!decision.remember || !decision.entry) return

      let mem = vfs.isFile(memPath) ? vfs.readFile(memPath) : '# Agent Memory\n'
      const section = decision.section || 'Lessons Learned'
      const header = `## ${section}`
      if (mem.includes(header)) {
        mem = mem.replace(header, `${header}\n- ${decision.entry}`)
      } else {
        mem += `\n${header}\n- ${decision.entry}\n`
      }
      vfs.writeFile(memPath, mem)
      showActivity('💾 Memory updated')
    } catch (e) { /* silent fail */ }
  }

  // ── Resume Task ──
  function resumeTask(workerId) {
    if (!store.conductor) return null
    const ok = store.conductor.resumeWorker(workerId)
    if (!ok) {
      console.warn('[resumeTask] No suspended worker found for', workerId)
      return null
    }
    console.log(`[resumeTask] Resumed worker ${workerId}`)
    return true
  }

  // ── Chat persistence ──
  function saveChat() {
    try {
      const data = store.messages.slice(-MAX_MESSAGES)
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(data))
    } catch {}
  }

  function loadChat() {
    try {
      const raw = localStorage.getItem(CHAT_STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw)
        if (Array.isArray(data) && data.length > 0) {
          store.messages.length = 0
          store.messages.push(...data)
          return true
        }
      }
    } catch {}
    return false
  }

  function clearChat() {
    store.messages.length = 0
    localStorage.removeItem(CHAT_STORAGE_KEY)
  }

  // Auto-save chat after each message
  EventBus.on('chat.assistant', () => { setTimeout(saveChat, 100) })
  EventBus.on('chat.user', () => { setTimeout(saveChat, 100) })

  return {
    configure, chat, showActivity, notify,
    startProactiveLoop, stopProactiveLoop, loadSkills,
    cleanReply, getOsState, resumeTask,
    saveChat, loadChat, clearChat
  }
}
