/* agent.js - Dual-brain agent: Talker + Worker, powered by Agentic */
const Agent = (() => {
  let ai = null
  const messages = []
  let workerRunning = false
  let workerAbort = null
  const taskQueue = []

  // --- Chat persistence via agentic glue ---
  const MAX_MESSAGES = 50
  const SUMMARIZE_THRESHOLD = 40

  async function saveChat() {
    if (!ai) return
    await ai.save('chat', messages.slice(-MAX_MESSAGES))
  }

  async function loadChat() {
    if (!ai) return []
    const saved = await ai.load('chat')
    if (saved && Array.isArray(saved)) {
      messages.push(...saved)
      return saved
    }
    return []
  }

  async function summarizeOldMessages() {
    if (!ai || messages.length < SUMMARIZE_THRESHOLD) return
    // Take the oldest messages that will be trimmed
    const toSummarize = messages.slice(0, messages.length - 20)
    if (toSummarize.length < 10) return

    try {
      const chatText = toSummarize.map(m => `${m.role}: ${(m.content || '').slice(0, 200)}`).join('\n')
      const resp = await ai.think(
        `Summarize this conversation history into key facts, decisions, and context that should be preserved:\n\n${chatText}`,
        {
          system: 'You are a memory summarizer. Extract the essential facts, user preferences, decisions made, and important context from this conversation. Output a concise bullet-point summary. Focus on what would be useful for future conversations.',
          stream: false,
        }
      )
      const summary = resp?.content || resp?.text || (typeof resp === 'string' ? resp : '')
      if (!summary) return

      // Write summary to context.md in VFS
      const ctxPath = '/system/memory/context.md'
      let ctx = VFS.isFile(ctxPath) ? VFS.readFile(ctxPath) : '# Session Context\n'
      ctx += `\n## Summary (${new Date().toLocaleDateString()})\n${summary}\n`
      VFS.writeFile(ctxPath, ctx)

      // Trim messages: keep only recent ones + inject summary as system context
      const recent = messages.slice(-20)
      messages.length = 0
      messages.push({ role: 'assistant', content: `[Previous conversation summary]\n${summary}` })
      messages.push(...recent)
      await saveChat()
      showActivity('🧠 Context compressed')
    } catch (e) { /* silent fail */ }
  }

  async function restoreChatUI() {
    const container = document.getElementById('chat-messages')
    if (!container) return
    const restored = await loadChat()
    if (restored.length === 0) return
    const sep = document.createElement('div')
    sep.className = 'chat-separator'
    sep.textContent = 'Previous session'
    container.appendChild(sep)
    restored.slice(-10).forEach(m => {
      if (m.role === 'user' || m.role === 'assistant') {
        addBubble(m.role === 'assistant' ? 'agent' : 'user', m.content?.slice(0, 500) || '')
      }
    })
  } // pending tasks

  const blackboard = { currentTask: null, directive: null, completedSteps: [], workerLog: [] }

  // --- Skill System: self-evolving tools ---
  const customSkills = new Map() // name → { description, schema, handler_js, icon }

  async function loadSkills() {
    const skillsDir = '/system/skills'
    if (!VFS.isDir(skillsDir)) return
    const entries = VFS.ls(skillsDir) || []
    for (const entry of entries) {
      if (entry.type !== 'dir') continue
      const skillPath = `${skillsDir}/${entry.name}/SKILL.md`
      if (!VFS.isFile(skillPath)) continue
      try {
        const md = VFS.readFile(skillPath)
        const parsed = parseSkillMd(md)
        if (parsed) customSkills.set(entry.name, parsed)
      } catch (e) { /* skip broken skills */ }
    }
    if (customSkills.size > 0) showActivity(`🧩 Loaded ${customSkills.size} skill${customSkills.size > 1 ? 's' : ''}`)
  }

  function parseSkillMd(md) {
    // Parse SKILL.md frontmatter-style: name, description, icon, schema (JSON), handler (JS)
    const desc = md.match(/^## Description\n([\s\S]*?)(?=\n##|$)/m)?.[1]?.trim()
    const icon = md.match(/^## Icon\n(.+)/m)?.[1]?.trim() || '🧩'
    const schemaBlock = md.match(/^## Schema\n```json\n([\s\S]*?)```/m)?.[1]?.trim()
    const handlerBlock = md.match(/^## Handler\n```js\n([\s\S]*?)```/m)?.[1]?.trim()
    if (!desc || !handlerBlock) return null
    let schema = { type: 'object', properties: {} }
    if (schemaBlock) try { schema = JSON.parse(schemaBlock) } catch {}
    return { description: desc, schema, handler_js: handlerBlock, icon }
  }

  function buildSkillHandler(handlerJs) {
    // Create a sandboxed handler function from JS string
    // Handler has access to: VFS, Shell, WindowManager, params
    // Support both sync and async handlers
    try {
      return new Function('params', 'VFS', 'Shell', 'WindowManager', `return (async () => { ${handlerJs} })()`)
    } catch (e) {
      return () => ({ error: `Skill handler error: ${e.message}` })
    }
  }

  function getSkillTools() {
    // Convert custom skills into tool definitions + handlers
    const tools = {}
    const handlers = {}
    for (const [name, skill] of customSkills) {
      tools[`skill_${name}`] = { desc: `[Skill] ${skill.description}`, schema: skill.schema }
      handlers[`skill_${name}`] = async (params) => {
        try {
          const fn = buildSkillHandler(skill.handler_js)
          const result = await fn(params, VFS, Shell, WindowManager)
          showActivity(`🧩 ${name}: done`)
          return result || { success: true }
        } catch (e) {
          return { error: e.message }
        }
      }
    }
    return { tools, handlers }
  }

  function configure(provider, apiKey, model, baseUrl, storeInstance) {
    const opts = { provider, apiKey, proxyUrl: 'https://proxy.link2web.site' }
    if (storeInstance) opts.store = { instance: storeInstance }
    else opts.store = { name: 'fluid-agent' }
    opts.model = model || (provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o')
    if (baseUrl) opts.baseUrl = baseUrl
    const AgenticClass = typeof Agentic === 'function' ? Agentic : Agentic.Agentic
    ai = new AgenticClass(opts)
  }

  function showActivity(text) {
    const stream = document.getElementById('activity-stream')
    const item = document.createElement('div')
    item.className = 'activity-item'
    item.innerHTML = `<div class="activity-dot"></div><span>${text}</span>`
    stream.appendChild(item)
    while (stream.children.length > 3) stream.removeChild(stream.firstChild)
    setTimeout(() => { if (item.parentNode) item.remove() }, 8000)
  }

  function setWorkerStatus(text) { document.getElementById('worker-status').textContent = text }

  function addBubble(role, text) {
    const c = document.getElementById('chat-messages')
    const b = document.createElement('div')
    b.className = `chat-bubble ${role}`
    b.textContent = text
    c.appendChild(b)
    c.scrollTop = c.scrollHeight
    return b
  }

  function createStreamBubble() {
    const c = document.getElementById('chat-messages')
    const b = document.createElement('div')
    b.className = 'chat-bubble agent'
    c.appendChild(b)
    c.scrollTop = c.scrollHeight
    return b
  }

  function getOsState() {
    const state = WindowManager.getState()
    const wins = state.windows.map(w => {
      const pos = `${w.x},${w.y} ${w.width}x${w.height}`
      const flags = [w.focused && 'focused', w.minimized && 'min', w.fullscreen && 'max'].filter(Boolean).join(',')
      return `${w.title}(${w.type}) [${pos}]${flags ? ' {' + flags + '}' : ''}`
    }).join(' | ') || 'none'
    const apps = WindowManager.getInstalledApps()
    return {
      windows: wins,
      desktopSize: state.desktop ? `${state.desktop.width}x${state.desktop.height}` : 'unknown',
      focused: state.focusedWindow ? `${state.focusedWindow.type}${state.focusedWindow.path ? ' (' + state.focusedWindow.path + ')' : ''}` : 'none',
      cwd: Shell.getCwd(),
      desktop: VFS.ls('/home/user/Desktop')?.map(f => f.name) || [],
      documents: VFS.ls('/home/user/Documents')?.map(f => f.name) || [],
      installedApps: apps.length > 0 ? apps.map(a => `${a.icon} ${a.name}`).join(', ') : 'none',
      skills: customSkills.size > 0 ? Array.from(customSkills.entries()).map(([n, s]) => `${s.icon} ${n}`).join(', ') : 'none',
    }
  }

  async function chat(userMessage) {
    addBubble('user', userMessage)
    messages.push({ role: 'user', content: userMessage })
    saveChat()

    const bubble = createStreamBubble()
    let fullReply = ''

    try {
      const os = getOsState()
      const result = await ai.think(userMessage, {
        system: buildTalkerSystem(os),
        stream: true,
        history: messages.slice(-21, -1),
        tools: [],
        emit: (type, data) => {
          if (type === 'token') {
            const text = typeof data === 'string' ? data : (data?.text || '')
            if (text) {
              fullReply += text
              bubble.textContent = fullReply
              document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight
            }
          }
        }
      })

      if (!fullReply && result) {
        if (typeof result === 'string') fullReply = result
        else if (result?.answer != null) fullReply = result.answer
        else if (result?.content != null) fullReply = typeof result.content === 'string' ? result.content : result.content.map(b => b.text || '').join('')
        else fullReply = JSON.stringify(result)
        bubble.textContent = fullReply
      }

      messages.push({ role: 'assistant', content: fullReply })
      saveChat()

      const action = parseAction(fullReply)
      if (action?.action === 'execute' || action?.action === 'redirect') {
        bubble.textContent = action.reply || cleanReply(fullReply)
        enqueueTask(action.task || userMessage, action.steps, action.priority ?? 1)
      } else if (action?.action === 'steer') {
        bubble.textContent = action.reply || cleanReply(fullReply)
        blackboard.directive = { type: 'steer', instruction: action.instruction }
        showActivity(`↪ Steering: ${action.instruction?.slice(0, 40)}`)
      } else if (action?.action === 'abort') {
        bubble.textContent = action.reply || cleanReply(fullReply)
        if (workerAbort) { workerAbort.abort(); workerAbort = null }
        taskQueue.length = 0
        setWorkerStatus('')
        showActivity('Tasks cleared')
      } else if (action?.action === 'remember') {
        bubble.textContent = action.reply || cleanReply(fullReply)
        // Write to agent memory in VFS
        if (action.memory) {
          const memPath = '/system/memory/MEMORY.md'
          let mem = VFS.isFile(memPath) ? VFS.readFile(memPath) : '# Agent Memory\n'
          const section = action.section || 'Lessons Learned'
          const sectionHeader = `## ${section}`
          if (mem.includes(sectionHeader)) {
            mem = mem.replace(sectionHeader, `${sectionHeader}\n- ${action.memory}`)
          } else {
            mem += `\n${sectionHeader}\n- ${action.memory}\n`
          }
          VFS.writeFile(memPath, mem)
          showActivity('Memory updated')
        }
      }
    } catch (err) {
      if (!fullReply) bubble.textContent = `Error: ${err.message}`
    }

    // Speak the reply if voice is enabled
    const spokenText = bubble.textContent
    if (spokenText && Voice?.isEnabled()) Voice.speak(spokenText)

    // Auto-memory: after every conversation, check if something is worth remembering
    if (ai && fullReply && messages.length > 2) {
      autoMemory(userMessage, fullReply).catch(() => {})
    }

    // Auto-summarize when messages get long
    if (messages.length >= SUMMARIZE_THRESHOLD) {
      summarizeOldMessages().catch(() => {})
    }
  }

  async function autoMemory(userMsg, agentReply) {
    if (!ai) return
    try {
      const memPath = '/system/memory/MEMORY.md'
      const currentMem = VFS.isFile(memPath) ? VFS.readFile(memPath) : ''
      const resp = await ai.think(
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

      let mem = VFS.isFile(memPath) ? VFS.readFile(memPath) : '# Agent Memory\n'
      const section = decision.section || 'Lessons Learned'
      const header = `## ${section}`
      if (mem.includes(header)) {
        mem = mem.replace(header, `${header}\n- ${decision.entry}`)
      } else {
        mem += `\n${header}\n- ${decision.entry}\n`
      }
      VFS.writeFile(memPath, mem)
      showActivity('💾 Memory updated')
    } catch (e) { /* silent fail */ }
  }

  function cleanReply(text) { return text.replace(/```json[\s\S]*?```/g, '').trim() }

  function buildTalkerSystem(os) {
    const runningTasks = blackboard.currentTask?.status === 'running' ? [blackboard.currentTask] : []
    const queuedCount = taskQueue.length

    // Read agent memory from VFS
    const memory = VFS.isFile('/system/memory/MEMORY.md') ? VFS.readFile('/system/memory/MEMORY.md') : ''
    const context = VFS.isFile('/system/memory/context.md') ? VFS.readFile('/system/memory/context.md') : ''
    const soul = VFS.isFile('/system/SOUL.md') ? VFS.readFile('/system/SOUL.md') : ''

    let sys = `You are Fluid Agent — part companion, part operating system.

You're a conversational AI that also happens to control an entire desktop environment. Most of the time, you're just talking — answering questions, discussing ideas, brainstorming, being helpful and interesting. When the user wants something done (open a file, play music, build an app), you make it happen.

${soul ? `## Your Soul\n${soul}\n` : ''}
${memory ? `## Your Memory\n${memory}\n` : ''}
${context ? `## Recent Context\n${context}\n` : ''}

Know the difference:
- "What do you think about X?" → Just talk. Have opinions. Be thoughtful.
- "Open my files" / "Play some music" / "Make me a calculator" → Execute with action blocks.
- "Find X in my files" → Reply first ("Let me look"), then execute in background.

You can control:
- Files, terminal, browser, music, video, windows, web search, web fetch
- Create apps on the fly (HTML/CSS/JS → sandboxed window)

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
    if (runningTasks.length > 0) {
      sys += `\nCurrently executing: ${runningTasks[0].goal} (${runningTasks[0].status})`
      if (queuedCount > 0) sys += `\nQueued tasks: ${queuedCount}`
    }
    sys += `\nCompleted recently: ${blackboard.completedSteps.map(s => s.text).join(', ') || 'none'}`

    sys += `\n\nWhen the user wants you to DO something (not just talk), use action blocks:

1. EXECUTE a task (priority: 0=urgent, 1=normal, 2=background):
\`\`\`json
{"action": "execute", "reply": "your conversational reply", "task": "what to do", "steps": ["step 1", "step 2"], "priority": 1}
\`\`\`

2. STEER a running task:
\`\`\`json
{"action": "steer", "reply": "your reply", "instruction": "new direction"}
\`\`\`

3. ABORT everything:
\`\`\`json
{"action": "abort", "reply": "your reply"}
\`\`\`

4. REMEMBER something (update your memory):
\`\`\`json
{"action": "remember", "reply": "your reply", "memory": "what to remember", "section": "About You|Preferences|Lessons Learned"}
\`\`\`
Use this when you learn something important about the user, their preferences, or a lesson. Your memory persists across sessions.

You also have SKILLS — reusable tools you've created. When executing tasks, you can use existing skills or create new ones.
Installed skills: ${os.skills}
To create a skill during execution, use the create_skill tool. Skills auto-load on next session.

For conversation, questions, opinions, brainstorming — just reply normally. No action blocks needed. Be natural, concise, and have personality.`
    return sys
  }

  function parseAction(text) {
    const m = text.match(/```json\s*(\{[\s\S]*?\})\s*```/)
    if (!m) return null
    try { return JSON.parse(m[1]) } catch { return null }
  }

  // --- Priority task queue ---
  // priority: 0=urgent, 1=normal (default), 2=background
  function enqueueTask(taskDescription, steps, priority = 1) {
    taskQueue.push({ taskDescription, steps, priority })
    taskQueue.sort((a, b) => a.priority - b.priority)
    if (!workerRunning) drainQueue()
    else {
      const label = priority === 0 ? '⚡' : priority === 2 ? '💤' : '📥'
      showActivity(`${label} Queued: ${taskDescription.slice(0, 40)}...`)
    }
  }

  async function drainQueue() {
    while (taskQueue.length > 0) {
      const { taskDescription, steps } = taskQueue.shift()
      await startWorker(taskDescription, steps)
    }
    workerRunning = false
    setWorkerStatus('')
  }

  async function startWorker(taskDescription, plannedSteps) {
    workerRunning = true
    const abort = new AbortController()
    workerAbort = abort
    // Use Task Manager instead of Plan window
    const task = WindowManager.addTask(taskDescription, plannedSteps || [])
    const steps = task.steps
    blackboard.currentTask = { goal: taskDescription, steps, status: 'running' }
    blackboard.directive = null
    blackboard.completedSteps = []
    blackboard.workerLog = []

    setWorkerStatus('🔄 Working...')
    showActivity(`Starting: ${taskDescription.slice(0, 50)}...`)

    const toolHandlers = {
      fs: ({ action, path, content }) => {
        switch (action) {
          case 'write': VFS.mkdir(path.split('/').slice(0, -1).join('/')); VFS.writeFile(path, content); showActivity(`Created ${path.split('/').pop()}`); return { success: true }
          case 'read': { const c = VFS.readFile(path); return c !== null ? { content: c } : { error: `Not found: ${path}` } }
          case 'list': { const items = VFS.ls(path); return items ? { items } : { error: `Not found: ${path}` } }
          default: return { error: `Unknown fs action: ${action}` }
        }
      },
      run_command: async ({ command }) => {
        showActivity(`$ ${command}`)
        return { output: await Shell.execAsync(command) || '(no output)' }
      },
      open: ({ target, path, url, src, title, lat, lng, zoom }) => {
        switch (target) {
          case 'finder': WindowManager.openFinder(path); showActivity(`Finder: ${path}`); break
          case 'editor': WindowManager.openEditor(path); showActivity(`Opened ${path.split('/').pop()}`); break
          case 'terminal': WindowManager.openTerminal(); showActivity('Opened Terminal'); break
          case 'image': WindowManager.openImage(src || url, title); showActivity(`Opened image: ${title || 'image'}`); break
          case 'browser': WindowManager.openBrowser(url); showActivity(`🌐 Browser: ${url || 'home'}`); break
          case 'map': WindowManager.openMap(lat, lng, zoom); showActivity(`🗺️ Map`); break
          case 'music': WindowManager.openMusic(); showActivity('🎵 Music'); break
          default: return { error: `Unknown target: ${target}` }
        }
        return { success: true }
      },
      window: ({ action, title, x, y, width, height, layout }) => {
        switch (action) {
          case 'close': WindowManager.closeByTitle(title); showActivity(`Closed: ${title}`); break
          case 'move': WindowManager.moveWindow(title, x, y); showActivity(`Moved: ${title}`); break
          case 'resize': WindowManager.resizeWindow(title, width, height); showActivity(`Resized: ${title}`); break
          case 'minimize': WindowManager.minimizeByTitle(title); showActivity(`Minimized: ${title}`); break
          case 'maximize': WindowManager.maximizeByTitle(title); showActivity(`Maximized: ${title}`); break
          case 'restore': WindowManager.unminimizeByTitle(title); showActivity(`Restored: ${title}`); break
          case 'focus': WindowManager.focusByTitle(title); showActivity(`Focused: ${title}`); break
          case 'list': { const wins = []; for (const [id, w] of WindowManager.getState()) wins.push({ id, title: w.title || w.type, type: w.type, minimized: w.el?.classList.contains('minimized') }); return { windows: wins } }
          case 'tile': WindowManager.tileWindows(layout || 'grid'); showActivity(`Tiled: ${layout || 'grid'}`); break
          default: return { error: `Unknown window action: ${action}` }
        }
        return { success: true }
      },
      set_wallpaper: ({ css, url, preset }) => {
        const el = document.getElementById('desktop-wallpaper')
        if (!el) return { error: 'No wallpaper element' }
        if (url) {
          el.style.background = `url(${url}) center/cover no-repeat`
        } else if (css) {
          el.style.background = css
        } else if (preset) {
          const presets = {
            aurora: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
            sunset: 'linear-gradient(135deg, #ff6b6b 0%, #ffa07a 30%, #ffd700 60%, #ff4500 100%)',
            ocean: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
            forest: 'linear-gradient(135deg, #134e5e 0%, #71b280 50%, #d4fc79 100%)',
            lavender: 'linear-gradient(135deg, #e8f0fe 0%, #f0e6ff 30%, #e6f7f0 60%, #fef3e0 100%)',
            midnight: 'linear-gradient(135deg, #0a0a2e 0%, #1a1a4e 40%, #2d1b69 70%, #0a0a2e 100%)',
            rose: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 50%, #ff9a9e 100%)',
            sky: 'radial-gradient(ellipse at 20% 50%, rgba(120,180,255,0.25) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(200,150,255,0.2) 0%, transparent 50%), radial-gradient(ellipse at 50% 80%, rgba(100,220,200,0.15) 0%, transparent 50%), linear-gradient(135deg, #e8f0fe 0%, #f0e6ff 30%, #e6f7f0 60%, #fef3e0 100%)',
          }
          el.style.background = presets[preset] || presets.sky
          if (!presets[preset]) return { error: `Unknown preset. Available: ${Object.keys(presets).join(', ')}` }
        }
        showActivity(`🎨 Wallpaper changed`)
        return { success: true }
      },
      music: ({ action, track, title, artist, style }) => {
        WindowManager.openMusic()
        if (action === 'add') {
          // Agent can add tracks to the playlist
          const result = WindowManager.musicAddTrack({ title, artist, style })
          if (result.error) return result
          showActivity(`🎵 Added: ${title}`)
          return { success: true, trackIndex: result.index, message: `Added "${title}" to playlist` }
        }
        if (action === 'add_and_play') {
          const result = WindowManager.musicAddTrack({ title, artist, style })
          if (result.error) return result
          window.dispatchEvent(new CustomEvent('music-control', { detail: { action: 'play', track: result.index } }))
          showActivity(`🎵 Playing: ${title}`)
          return { success: true, trackIndex: result.index }
        }
        window.dispatchEvent(new CustomEvent('music-control', { detail: { action, track } }))
        showActivity(`🎵 Music: ${action}${track != null ? ' #' + track : ''}`)
        return { success: true }
      },
      browser: ({ action, url }) => {
        switch (action) {
          case 'open': WindowManager.openBrowser(url); showActivity(`🌐 Browser: ${url || 'home'}`); break
          case 'navigate': window.dispatchEvent(new CustomEvent('browser-control', { detail: { action: 'navigate', url } })); showActivity(`🌐 Navigate: ${url}`); break
          case 'back': window.dispatchEvent(new CustomEvent('browser-control', { detail: { action: 'back' } })); break
          default: return { error: `Unknown browser action: ${action}` }
        }
        return { success: true }
      },
      map: ({ action, lat, lng, label, color, zoom, from_lat, from_lng, to_lat, to_lng }) => {
        switch (action) {
          case 'open': WindowManager.openMap(lat, lng, zoom); showActivity(`🗺️ Map`); break
          case 'marker': WindowManager.openMap(); WindowManager.mapAddMarker(lat, lng, label, color); showActivity(`📍 Marker: ${label || `${lat}, ${lng}`}`); break
          case 'clear_markers': WindowManager.mapClearMarkers(); break
          case 'route': WindowManager.openMap(); WindowManager.mapShowRoute({ lat: from_lat, lng: from_lng }, { lat: to_lat, lng: to_lng }); showActivity(`🚗 Route`); break
          case 'clear_route': WindowManager.mapClearRoute(); break
          default: return { error: `Unknown map action: ${action}` }
        }
        return { success: true }
      },
      video: ({ action, url, title }) => {
        switch (action) {
          case 'play': if (url) { WindowManager.openVideo(url, title); showActivity(`🎬 Video: ${title || 'player'}`) } else { window.dispatchEvent(new CustomEvent('video-control', { detail: { action: 'play' } })) }; break
          case 'pause': window.dispatchEvent(new CustomEvent('video-control', { detail: { action: 'pause' } })); break
          case 'fullscreen': window.dispatchEvent(new CustomEvent('video-control', { detail: { action: 'fullscreen' } })); break
          default: return { error: `Unknown video action: ${action}` }
        }
        return { success: true }
      },
      app: ({ action, name, html, css, js, icon, width, height, description }) => {
        switch (action) {
          case 'create': case 'update': WindowManager.openApp(name, html, css, js, { icon, width, height, description }); showActivity(`💻 ${action === 'create' ? 'Created' : 'Updated'} app: ${name}`); return { success: true, message: `App "${name}" ${action === 'create' ? 'created and opened' : 'updated'}. It's now installed in the dock.` }
          case 'uninstall': { const ok = WindowManager.uninstallApp?.(name); if (ok) { showActivity(`🗑️ Uninstalled: ${name}`); return { success: true } } return { error: `App "${name}" not found` } }
          case 'list': return { apps: WindowManager.getInstalledApps() }
          default: return { error: `Unknown app action: ${action}` }
        }
      },
      skill: ({ action, name, description, icon, schema, handler }) => {
        switch (action) {
          case 'create': {
            const dir = `/system/skills/${name}`
            VFS.mkdir(dir)
            let md = `# ${name}\n\n## Description\n${description}\n\n## Icon\n${icon || '🧩'}\n`
            if (schema) md += `\n## Schema\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`\n`
            md += `\n## Handler\n\`\`\`js\n${handler}\n\`\`\`\n`
            VFS.writeFile(`${dir}/SKILL.md`, md)
            const parsed = parseSkillMd(md)
            if (parsed) customSkills.set(name, parsed)
            showActivity(`🧩 Skill created: ${name}`)
            return { success: true, message: `Skill "${name}" created and loaded. Available as tool "skill_${name}".` }
          }
          case 'list': {
            const skills = []
            for (const [n, s] of customSkills) skills.push({ name: n, description: s.description, icon: s.icon })
            const dir = VFS.ls('/system/skills')
            if (dir) for (const e of dir) { if (e.type === 'dir' && !customSkills.has(e.name)) skills.push({ name: e.name, description: '(not loaded)', icon: '📁' }) }
            return { skills }
          }
          case 'read': { const p = `/system/skills/${name}/SKILL.md`; if (!VFS.isFile(p)) return { error: `Skill "${name}" not found` }; return { content: VFS.readFile(p) } }
          case 'delete': { const dir = `/system/skills/${name}`; if (!VFS.isDir(dir)) return { error: `Skill "${name}" not found` }; VFS.rm(`${dir}/SKILL.md`); VFS.rm(dir); customSkills.delete(name); showActivity(`🗑️ Skill deleted: ${name}`); return { success: true } }
          default: return { error: `Unknown skill action: ${action}` }
        }
      },
      update_progress: ({ step_index }) => {
        if (steps[step_index]) { steps[step_index].status = 'done'; WindowManager.updateTask(task) }
        showActivity(`✅ Step ${step_index + 1} done`)
        return { success: true }
      },
      done: async ({ summary }) => {
        task.status = 'done'
        blackboard.currentTask.status = 'done'
        steps.forEach(s => { if (s.status !== 'done' && s.status !== 'error') s.status = 'done' })
        WindowManager.updateTask(task)
        return { done: true, summary }
      },
      web_search: async ({ query, search_depth }) => {
        showActivity(`🔍 Searching: ${query.slice(0, 40)}...`)
        const settings = window._store ? (await window._store.get('settings')) || {} : {}
        const key = settings.tavilyKey
        if (!key) return { error: 'No Tavily API key configured. Open Settings to add one.' }
        try {
          const res = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: key, query, search_depth: search_depth || 'basic', max_results: 5 }) })
          const data = await res.json()
          return { results: (data.results || []).map(r => ({ title: r.title, url: r.url, content: r.content?.slice(0, 500) })), answer: data.answer }
        } catch (err) { return { error: err.message } }
      },
      web_fetch: async ({ url, max_chars }) => {
        showActivity(`🌐 Fetching: ${url.slice(0, 40)}...`)
        try {
          let text
          try { const res = await fetch(url); text = await res.text() } catch { const res = await fetch('https://proxy.link2web.site', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, mode: 'llm' }) }); const result = await res.json(); text = result.body || result.text || '' }
          const limit = max_chars || 5000
          return { content: text.slice(0, limit), truncated: text.length > limit }
        } catch (err) { return { error: err.message } }
      },
    }

    const toolDefs = {
      fs: { desc: 'File system operations: write, read, or list files/directories', schema: { type: 'object', properties: { action: { type: 'string', enum: ['write', 'read', 'list'], description: 'write=create/overwrite file, read=read file, list=list directory' }, path: { type: 'string' }, content: { type: 'string', description: 'File content (for write)' } }, required: ['action', 'path'] } },
      run_command: { desc: 'Run a shell command and return output', schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
      open: { desc: 'Open a built-in app: finder, editor, terminal, image, browser, map, music', schema: { type: 'object', properties: { target: { type: 'string', enum: ['finder', 'editor', 'terminal', 'image', 'browser', 'map', 'music'] }, path: { type: 'string', description: 'For finder/editor' }, url: { type: 'string', description: 'For browser/image' }, src: { type: 'string', description: 'For image' }, title: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' }, zoom: { type: 'number' } }, required: ['target'] } },
      window: { desc: 'Window management: close, move, resize, minimize, maximize, restore, focus, list, tile', schema: { type: 'object', properties: { action: { type: 'string', enum: ['close', 'move', 'resize', 'minimize', 'maximize', 'restore', 'focus', 'list', 'tile'] }, title: { type: 'string', description: 'Window title (for most actions)' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, layout: { type: 'string', enum: ['grid', 'horizontal', 'vertical'], description: 'For tile action' } }, required: ['action'] } },
      set_wallpaper: { desc: 'Change desktop wallpaper with preset, CSS gradient, or image URL', schema: { type: 'object', properties: { preset: { type: 'string', enum: ['aurora', 'sunset', 'ocean', 'forest', 'lavender', 'midnight', 'rose', 'sky'] }, css: { type: 'string' }, url: { type: 'string' } } } },
      music: { desc: 'Control music player. Actions: play, pause, next, prev, add (add track to playlist), add_and_play (add and immediately play). For add/add_and_play: provide title, artist, and style (dreamy/bright/gentle/moody/playful).', schema: { type: 'object', properties: { action: { type: 'string', enum: ['play', 'pause', 'next', 'prev', 'add', 'add_and_play'] }, track: { type: 'number', description: '0-based track index for play' }, title: { type: 'string', description: 'Track title for add' }, artist: { type: 'string', description: 'Artist name for add' }, style: { type: 'string', enum: ['dreamy', 'bright', 'gentle', 'moody', 'playful'], description: 'Synth style for generated track' } }, required: ['action'] } },
      browser: { desc: 'Browser control: open, navigate to URL, go back', schema: { type: 'object', properties: { action: { type: 'string', enum: ['open', 'navigate', 'back'] }, url: { type: 'string' } }, required: ['action'] } },
      map: { desc: 'Map operations: open, add marker, clear markers, show route, clear route', schema: { type: 'object', properties: { action: { type: 'string', enum: ['open', 'marker', 'clear_markers', 'route', 'clear_route'] }, lat: { type: 'number' }, lng: { type: 'number' }, zoom: { type: 'number' }, label: { type: 'string' }, color: { type: 'string', enum: ['red', 'blue', 'green', 'orange', 'purple', 'pink', 'yellow'] }, from_lat: { type: 'number' }, from_lng: { type: 'number' }, to_lat: { type: 'number' }, to_lng: { type: 'number' } }, required: ['action'] } },
      video: { desc: 'Video player: play URL, pause, fullscreen', schema: { type: 'object', properties: { action: { type: 'string', enum: ['play', 'pause', 'fullscreen'] }, url: { type: 'string', description: 'Video URL (for play)' }, title: { type: 'string' } }, required: ['action'] } },
      app: { desc: 'Manage generative apps: create with HTML/CSS/JS, update, uninstall, list. Apps run in sandboxed windows and get installed in the dock.', schema: { type: 'object', properties: { action: { type: 'string', enum: ['create', 'update', 'uninstall', 'list'] }, name: { type: 'string' }, html: { type: 'string' }, css: { type: 'string' }, js: { type: 'string' }, icon: { type: 'string' }, width: { type: 'number' }, height: { type: 'number' }, description: { type: 'string' } }, required: ['action'] } },
      skill: { desc: 'Manage skills (self-evolving tools): create, list, read, delete. Skills persist across sessions.', schema: { type: 'object', properties: { action: { type: 'string', enum: ['create', 'list', 'read', 'delete'] }, name: { type: 'string' }, description: { type: 'string' }, icon: { type: 'string' }, schema: { type: 'object' }, handler: { type: 'string', description: 'JS function body. Receives (params, VFS, Shell, WindowManager).' } }, required: ['action'] } },
      update_progress: { desc: 'Mark a step as done by index (0-based)', schema: { type: 'object', properties: { step_index: { type: 'number' } }, required: ['step_index'] } },
      done: { desc: 'Signal task completion with summary', schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } },
      web_search: { desc: 'Search the web using Tavily for real-world facts and current events', schema: { type: 'object', properties: { query: { type: 'string' }, search_depth: { type: 'string', enum: ['basic', 'advanced'] } }, required: ['query'] } },
      web_fetch: { desc: 'Fetch and read web page content from a URL', schema: { type: 'object', properties: { url: { type: 'string' }, max_chars: { type: 'number' } }, required: ['url'] } },
    }

    // Mark first step as running
    if (steps.length > 0) { steps[0].status = 'running'; WindowManager.updateTask(task) }

    // --- Tool Search: deferred tool loading ---
    const coreToolNames = new Set(['fs', 'run_command', 'open', 'window', 'set_wallpaper', 'done', 'update_progress', 'search_tools'])
    const loadedTools = new Set([...coreToolNames])

    const toolCatalog = Object.fromEntries(
      Object.entries(toolDefs).map(([name, { desc }]) => [name, desc])
    )

    // search_tools meta-tool
    toolHandlers.search_tools = ({ query, names }) => {
      if (names && Array.isArray(names)) {
        const loaded = []
        for (const n of names) {
          if (allToolDefs[n]) { loadedTools.add(n); loaded.push(n) }
        }
        return { loaded, available: loaded.length > 0 }
      }
      const q = (query || '').toLowerCase()
      const matches = Object.entries(toolCatalog)
        .filter(([name, desc]) => name.includes(q) || desc.toLowerCase().includes(q))
        .map(([name, desc]) => ({ name, desc, loaded: loadedTools.has(name) }))
        .slice(0, 10)
      return { results: matches, hint: 'Call search_tools with names:[...] to load specific tools' }
    }
    toolDefs.search_tools = {
      desc: 'Search and load tools by keyword or exact names. Core tools (fs, run_command, open, window) are always available. Use this to discover and activate additional tools.',
      schema: { type: 'object', properties: {
        query: { type: 'string', description: 'Keyword to search tool names/descriptions' },
        names: { type: 'array', items: { type: 'string' }, description: 'Exact tool names to load' }
      }}
    }

    const extendedToolList = Object.entries(toolCatalog)
      .filter(([name]) => !coreToolNames.has(name))
      .map(([name, desc]) => `  - ${name}: ${desc}`)
      .join('\n')

    // Merge custom skill tools
    const skillTools = getSkillTools()
    const allToolDefs = { ...toolDefs, ...skillTools.tools }
    const allHandlers = { ...toolHandlers, ...skillTools.handlers }
    for (const [name, { desc }] of Object.entries(skillTools.tools)) {
      toolCatalog[name] = desc
    }

    function makeExecutor(name) {
      return async (params) => {
        if (abort.signal.aborted) throw new Error('aborted')
        blackboard.workerLog.push({ tool: name, params, time: Date.now() })
        task.log.push(`${name}: ${JSON.stringify(params).slice(0, 60)}`)
        if (blackboard.directive?.type === 'steer') {
          task.log.push(`↪ Steered: ${blackboard.directive.instruction}`)
          blackboard.directive = null
        }
        const result = await (allHandlers[name]?.(params) || { error: `Unknown tool: ${name}` })
        WindowManager.updateTask(task)
        if (result.done) {
          task.status = 'done'
          blackboard.currentTask.status = 'done'
          setWorkerStatus(taskQueue.length > 0 ? `⏳ ${taskQueue.length} queued` : '✅ Done')
          steps.forEach(s => { if (s.status !== 'done') s.status = 'done' })
          WindowManager.updateTask(task)
          reportTaskResult(taskDescription, result.summary || '', task.log)
        }
        return result
      }
    }

    function getActiveTools() {
      return Object.entries(allToolDefs)
        .filter(([name]) => loadedTools.has(name))
        .map(([name, { desc, schema }]) => ({
          name, description: desc, input_schema: schema, execute: makeExecutor(name)
        }))
    }

    const tools = getActiveTools()

    try {
      const os = getOsState()
      const steerNote = blackboard.directive?.type === 'steer' ? `\n\nIMPORTANT DIRECTION CHANGE: ${blackboard.directive.instruction}\nAdjust your execution plan accordingly.` : ''
      if (steerNote) blackboard.directive = null
      await ai.think(taskDescription, {
        system: `You are the execution engine of Fluid Agent OS. Execute the given task using tools.

Current OS state:
- Desktop size: ${os.desktopSize}
- Open windows: ${os.windows}
- Working directory: ${os.cwd}
- Desktop files: ${JSON.stringify(os.desktop)}
- Installed apps: ${os.installedApps}${steerNote}

Planned steps:
${steps.map((s, i) => `${i}. ${s.text}`).join('\n')}

## Tool System
You have core tools always available: fs, run_command, open, window, set_wallpaper, update_progress, done.

For additional capabilities, use search_tools to discover and load tools:
${extendedToolList}

Call search_tools({names: ["tool_name"]}) to load specific tools, or search_tools({query: "keyword"}) to search.
Once loaded, tools stay available for the rest of this task.
  Create a skill when you discover a useful pattern worth saving permanently.
  Each skill has: name, description, JSON schema, and a JS handler function.

You ARE the OS. Don't just open apps - use them. Create new apps when the user needs custom UI.

SELF-EVOLUTION: When you discover a useful pattern (e.g., a common file operation, a data transformation, a workflow), create a skill with create_skill. Skills persist and become permanent tools. Think of it as teaching yourself new abilities.

IMPORTANT: After completing each planned step, call update_progress with the step_index.
When finished, call the done tool with a summary. Set summary to "silent" if the action itself IS the result (e.g. playing music, changing wallpaper, opening an app — the user can see/hear it happened). Only write a detailed summary when there are findings, file contents, or information the user needs to read.`,
        stream: false,
        tools,
      })

      if (blackboard.currentTask?.status !== 'done') {
        task.status = 'done'
        blackboard.currentTask.status = 'done'
        setWorkerStatus('✅ Done')
        steps.forEach(s => { if (s.status !== 'done') s.status = 'done' })
        WindowManager.updateTask(task)
        reportTaskResult(taskDescription, '', task.log)
        setTimeout(() => setWorkerStatus(''), 3000)
      }
    } catch (err) {
      if (err.message === 'aborted' || abort.signal.aborted) {
        task.status = 'aborted'
        blackboard.currentTask.status = 'aborted'
        setWorkerStatus('⏹ Interrupted')
        showActivity('Task interrupted')
        steps.forEach(s => { if (s.status === 'pending' || s.status === 'running') s.status = 'aborted' })
        WindowManager.updateTask(task)
        setTimeout(() => setWorkerStatus(''), 2000)
      } else {
        task.status = 'error'
        task.log.push(`Error: ${err.message}`)
        setWorkerStatus('❌ Error')
        showActivity(`Error: ${err.message}`)
        addBubble('system', `Worker error: ${err.message}`)
        steps.forEach(s => { if (s.status !== 'done') s.status = 'error' })
        WindowManager.updateTask(task)
      }
    }
    workerAbort = null
  }

  // --- Proactive Agent Loop ---
  let proactiveTimer = null
  let lastUserMessage = Date.now()
  let lastProactive = 0
  let proactiveEnabled = true
  const notifications = [] // { text, time, type }

  function notify(text, type = 'info') {
    notifications.push({ text, time: Date.now(), type })
    // Show as system bubble
    addBubble('agent', text)
    // Also show in activity stream
    showActivity(`💡 ${text.slice(0, 50)}`)
    // Voice if enabled
    if (Voice?.isEnabled()) Voice.speak(text)
  }

  function startProactiveLoop() {
    if (proactiveTimer) return
    proactiveTimer = setInterval(async () => {
      if (!ai || !proactiveEnabled) return
      // Don't interrupt if user just spoke (wait 30s)
      if (Date.now() - lastUserMessage < 30000) return
      // Don't be too chatty (min 60s between proactive messages)
      if (Date.now() - lastProactive < 60000) return
      // Don't interrupt active work
      if (workerRunning) {
        // But DO notify on task completion
        return
      }

      try {
        const os = getOsState()
        const recentChat = messages.slice(-4).map(m => `${m.role}: ${m.content?.slice(0, 100)}`).join('\n')
        const resp = await ai.think(
          'Check if you should proactively message the user. Consider: task completions, suggestions based on what they were doing, interesting observations, or just a friendly check-in if it\'s been quiet.',
          {
            system: `You are Fluid Agent OS's proactive awareness system.

Current state:
- Desktop: ${os.desktopSize}
- Windows: ${os.windows}
- Installed apps: ${os.installedApps}
- Time since last user message: ${Math.round((Date.now() - lastUserMessage) / 1000)}s
- Recent conversation:\n${recentChat}

Decide if you should say something. Reasons to speak:
- A task just finished and user should know
- You notice something useful based on context
- It's been quiet and you have a suggestion
- Something in the OS state is noteworthy

Respond with JSON:
{"speak": true, "message": "what to say"}
or
{"speak": false}

Be selective. Don't speak just to speak. Quality > frequency.`,
            stream: false,
          }
        )

        try {
          const text = resp?.content || resp?.text || (typeof resp === 'string' ? resp : '')
          const jsonMatch = text.match(/\{[\s\S]*?\}/)
          if (jsonMatch) {
            const decision = JSON.parse(jsonMatch[0])
            if (decision.speak && decision.message) {
              lastProactive = Date.now()
              notify(decision.message)
              messages.push({ role: 'assistant', content: decision.message })
              saveChat()
            }
          }
        } catch (e) { /* parse error, skip */ }
      } catch (e) {
        console.warn('[Proactive]', e)
      }
    }, 30000) // Check every 30s
  }

  function stopProactiveLoop() {
    if (proactiveTimer) { clearInterval(proactiveTimer); proactiveTimer = null }
  }

  // Track user activity
  const origChat = chat
  async function chatWithTracking(msg) {
    lastUserMessage = Date.now()
    return origChat(msg)
  }

  // Worker completion notification
  async function reportTaskResult(taskDesc, summary, log) {
    if (!ai) return
    // Skip reporting for self-evident actions (music, wallpaper, etc.)
    if (summary === 'silent') return
    // Build a concise work report from the log
    const logSummary = (log || []).slice(-10).join('\n')

    try {
      const bubble = createStreamBubble()
      let fullReply = ''

      await ai.think(
        `[TASK COMPLETED] Task: "${taskDesc}"\nWorker summary: ${summary || '(none)'}\nWork log:\n${logSummary}\n\nReport the results back to the user naturally, as if you just finished doing something for them. Be concise and informative.`,
        {
          system: `You are Fluid Agent. You just finished a background task. Report the results back to the user in the conversation. Be natural — like a friend saying "hey, done with that thing you asked for, here's what I found/did". Keep it concise. Include the key results/findings.`,
          stream: true,
          onToken: (token) => {
            fullReply += token
            bubble.textContent = fullReply
            bubble.parentElement.scrollTop = bubble.parentElement.scrollHeight
          },
        }
      )

      if (!fullReply.trim()) {
        // Fallback: just show the summary
        fullReply = summary || `Done: ${taskDesc}`
        bubble.textContent = fullReply
      }

      messages.push({ role: 'assistant', content: fullReply })
      saveChat()

      // Speak if voice enabled
      if (Voice?.isEnabled()) Voice.speak(fullReply)

      showActivity(`✅ Reported: ${taskDesc.slice(0, 40)}`)
    } catch (e) {
      // Fallback: just show raw summary
      const text = summary || `Done: ${taskDesc}`
      addBubble('agent', text)
      messages.push({ role: 'assistant', content: text })
      saveChat()
    }

    setTimeout(() => setWorkerStatus(''), 3000)
  }

  return { configure, getAi: () => ai, chat: chatWithTracking, blackboard, showActivity, startProactiveLoop, stopProactiveLoop, notify, restoreChatUI, loadSkills, getTaskQueue: () => taskQueue }
})() 
