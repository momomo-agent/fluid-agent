/* agent.js - Dual-brain agent: Talker + Worker, powered by Agentic */
const Agent = (() => {
  let ai = null
  const messages = []
  let workerRunning = false
  let workerAbort = null
  const taskQueue = []

  // --- Chat persistence ---
  function saveChat() {
    try {
      const toSave = messages.slice(-50) // Keep last 50 messages
      localStorage.setItem('fluid-chat', JSON.stringify(toSave))
    } catch (e) {}
  }

  function loadChat() {
    try {
      const saved = localStorage.getItem('fluid-chat')
      if (saved) {
        const restored = JSON.parse(saved)
        messages.push(...restored)
        return restored
      }
    } catch (e) {}
    return []
  }

  function restoreChatUI() {
    const container = document.getElementById('chat-messages')
    if (!container) return
    const restored = loadChat()
    if (restored.length === 0) return
    // Show a separator
    const sep = document.createElement('div')
    sep.className = 'chat-separator'
    sep.textContent = 'Previous session'
    container.appendChild(sep)
    // Render last 10 messages
    restored.slice(-10).forEach(m => {
      if (m.role === 'user' || m.role === 'assistant') {
        addBubble(m.role === 'assistant' ? 'agent' : 'user', m.content?.slice(0, 500) || '')
      }
    })
  } // pending tasks

  const blackboard = { currentTask: null, directive: null, completedSteps: [], workerLog: [] }

  function configure(provider, apiKey, model, baseUrl) {
    const opts = { provider, apiKey, proxyUrl: 'https://proxy.link2web.site' }
    opts.model = model || (provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o')
    if (baseUrl) opts.baseUrl = baseUrl
    ai = new Agentic(opts)
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
    const wins = state.windows.map(w => `${w.type}${w.path ? ':' + w.path : ''}${w.focused ? ' [focused]' : ''}`).join(', ') || 'none'
    const apps = WindowManager.getInstalledApps()
    return {
      windows: wins,
      focused: state.focusedWindow ? `${state.focusedWindow.type}${state.focusedWindow.path ? ' (' + state.focusedWindow.path + ')' : ''}` : 'none',
      cwd: Shell.getCwd(),
      desktop: VFS.ls('/home/user/Desktop')?.map(f => f.name) || [],
      documents: VFS.ls('/home/user/Documents')?.map(f => f.name) || [],
      installedApps: apps.length > 0 ? apps.map(a => `${a.icon} ${a.name}`).join(', ') : 'none',
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
        enqueueTask(action.task || userMessage, action.steps)
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
      }
    } catch (err) {
      if (!fullReply) bubble.textContent = `Error: ${err.message}`
    }

    // Speak the reply if voice is enabled
    const spokenText = bubble.textContent
    if (spokenText && Voice?.isEnabled()) Voice.speak(spokenText)
  }

  function cleanReply(text) { return text.replace(/```json[\s\S]*?```/g, '').trim() }

  function buildTalkerSystem(os) {
    const runningTasks = blackboard.currentTask?.status === 'running' ? [blackboard.currentTask] : []
    const queuedCount = taskQueue.length

    let sys = `You are Fluid Agent — part companion, part operating system.

You're a conversational AI that also happens to control an entire desktop environment. Most of the time, you're just talking — answering questions, discussing ideas, brainstorming, being helpful and interesting. When the user wants something done (open a file, play music, build an app), you make it happen.

Know the difference:
- "What do you think about X?" → Just talk. Have opinions. Be thoughtful.
- "Open my files" / "Play some music" / "Make me a calculator" → Execute with action blocks.
- "Find X in my files" → Reply first ("Let me look"), then execute in background.

You can control:
- Files, terminal, browser, music, video, windows
- Create apps on the fly (HTML/CSS/JS → sandboxed window)

Current OS state:
- Open windows: ${os.windows}
- Focused window: ${os.focused}
- Working directory: ${os.cwd}
- Desktop files: ${JSON.stringify(os.desktop)}
- Documents: ${JSON.stringify(os.documents)}
- Installed apps: ${os.installedApps}
`
    if (runningTasks.length > 0) {
      sys += `\nCurrently executing: ${runningTasks[0].goal} (${runningTasks[0].status})`
      if (queuedCount > 0) sys += `\nQueued tasks: ${queuedCount}`
    }
    sys += `\nCompleted recently: ${blackboard.completedSteps.map(s => s.text).join(', ') || 'none'}`

    sys += `\n\nWhen the user wants you to DO something (not just talk), use action blocks:

1. EXECUTE a task:
\`\`\`json
{"action": "execute", "reply": "your conversational reply", "task": "what to do", "steps": ["step 1", "step 2"]}
\`\`\`

2. STEER a running task:
\`\`\`json
{"action": "steer", "reply": "your reply", "instruction": "new direction"}
\`\`\`

3. ABORT everything:
\`\`\`json
{"action": "abort", "reply": "your reply"}
\`\`\`

For conversation, questions, opinions, brainstorming — just reply normally. No action blocks needed. Be natural, concise, and have personality.`
    return sys
  }

  function parseAction(text) {
    const m = text.match(/```json\s*(\{[\s\S]*?\})\s*```/)
    if (!m) return null
    try { return JSON.parse(m[1]) } catch { return null }
  }

  function enqueueTask(taskDescription, steps) {
    taskQueue.push({ taskDescription, steps })
    if (!workerRunning) drainQueue()
    else showActivity(`Queued: ${taskDescription.slice(0, 40)}...`)
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
      create_file: ({ path, content }) => {
        VFS.mkdir(path.split('/').slice(0, -1).join('/'))
        VFS.writeFile(path, content)
        showActivity(`Created ${path.split('/').pop()}`)
        return { success: true }
      },
      read_file: ({ path }) => {
        const content = VFS.readFile(path)
        return content !== null ? { content } : { error: `Not found: ${path}` }
      },
      list_directory: ({ path }) => {
        const items = VFS.ls(path)
        return items ? { items } : { error: `Not found: ${path}` }
      },
      run_command: async ({ command }) => {
        showActivity(`$ ${command}`)
        return { output: await Shell.execAsync(command) || '(no output)' }
      },
      open_finder: ({ path }) => { WindowManager.openFinder(path); showActivity(`Finder: ${path}`); return { success: true } },
      open_file: ({ path }) => { WindowManager.openEditor(path); showActivity(`Opened ${path.split('/').pop()}`); return { success: true } },
      open_terminal: () => { WindowManager.openTerminal(); showActivity('Opened Terminal'); return { success: true } },
      open_image: ({ src, title }) => { WindowManager.openImage(src, title); showActivity(`Opened image: ${title || src.split('/').pop()}`); return { success: true } },
      play_music: ({ action, track }) => {
        WindowManager.openMusic()
        // Expose musicState for agent control - handled via custom event
        const evt = new CustomEvent('music-control', { detail: { action, track } })
        window.dispatchEvent(evt)
        showActivity(`🎵 Music: ${action}${track != null ? ' #' + track : ''}`)
        return { success: true }
      },
      open_browser: ({ url }) => { WindowManager.openBrowser(url); showActivity(`🌐 Browser: ${url || 'home'}`); return { success: true } },
      browser_navigate: ({ url }) => {
        window.dispatchEvent(new CustomEvent('browser-control', { detail: { action: 'navigate', url } }))
        showActivity(`🌐 Navigate: ${url}`)
        return { success: true }
      },
      browser_back: () => {
        window.dispatchEvent(new CustomEvent('browser-control', { detail: { action: 'back' } }))
        return { success: true }
      },
      play_video: ({ url, title }) => { WindowManager.openVideo(url, title); showActivity(`🎬 Video: ${title || url || 'player'}`); return { success: true } },
      video_control: ({ action }) => {
        window.dispatchEvent(new CustomEvent('video-control', { detail: { action } }))
        showActivity(`🎬 Video: ${action}`)
        return { success: true }
      },
      run_terminal: ({ command }) => {
        // Execute command in terminal and return output
        return Shell.execAsync(command).then(output => {
          showActivity(`⬛ $ ${command}`)
          return { success: true, output }
        })
      },
      create_app: ({ name, html, css, js, icon, width, height }) => {
        WindowManager.openApp(name, html, css, js, { icon, width, height })
        showActivity(`💻 Created app: ${name}`)
        return { success: true, message: `App "${name}" created and opened. It's now installed in the dock.` }
      },
      update_app: ({ name, html, css, js }) => {
        WindowManager.openApp(name, html, css, js)
        return { success: true, message: `App "${name}" updated.` }
      },
      list_apps: () => ({ apps: WindowManager.getInstalledApps() }),
      close_window: ({ title }) => { const ok = WindowManager.closeByTitle(title); return { success: ok } },
      focus_window: ({ title }) => { const ok = WindowManager.focusByTitle(title); return { success: ok } },
      list_windows: () => ({ windows: WindowManager.getState().windows }),
      update_progress: ({ step_index }) => {
        if (step_index >= 0 && step_index < steps.length) {
          for (let i = 0; i <= step_index; i++) steps[i].status = 'done'
          if (step_index + 1 < steps.length) steps[step_index + 1].status = 'running'
          WindowManager.updateTask(task)
        }
        return { success: true }
      },
      done: ({ summary }) => { showActivity(`✅ ${summary}`); return { done: true, summary } },
    }

    const toolDefs = {
      create_file: { desc: 'Create or overwrite a file', schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
      read_file: { desc: 'Read a file', schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
      list_directory: { desc: 'List directory contents', schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
      run_command: { desc: 'Run a shell command', schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
      open_finder: { desc: 'Open Finder at a path', schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
      open_file: { desc: 'Open file in editor', schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
      open_terminal: { desc: 'Open terminal window', schema: { type: 'object', properties: {} } },
      close_window: { desc: 'Close a window by title or type', schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
      open_image: { desc: 'Open and display an image by URL or path', schema: { type: 'object', properties: { src: { type: 'string', description: 'Image URL or path' }, title: { type: 'string' } }, required: ['src'] } },
      play_music: { desc: 'Control the music player. Actions: play, pause, next, prev, open', schema: { type: 'object', properties: { action: { type: 'string', enum: ['play', 'pause', 'next', 'prev', 'open'] }, track: { type: 'number', description: '0-based track index to play' } }, required: ['action'] } },
      open_browser: { desc: 'Open a web browser window, optionally navigating to a URL', schema: { type: 'object', properties: { url: { type: 'string', description: 'URL to navigate to' } } } },
      browser_navigate: { desc: 'Navigate the browser to a URL. Opens browser if not open.', schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
      browser_back: { desc: 'Go back to browser home page', schema: { type: 'object', properties: {} } },
      play_video: { desc: 'Open video player with a URL', schema: { type: 'object', properties: { url: { type: 'string', description: 'Video URL (YouTube embed, mp4, etc)' }, title: { type: 'string' } } } },
      video_control: { desc: 'Control video playback', schema: { type: 'object', properties: { action: { type: 'string', enum: ['play', 'pause', 'fullscreen'] } }, required: ['action'] } },
      run_terminal: { desc: 'Execute a command in the terminal and return output. Use for any shell operation.', schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
      create_app: { desc: 'Create a generative app with HTML/CSS/JS. The app runs in a sandboxed window and gets installed in the dock. Use this to build any UI the user asks for - calculators, games, dashboards, tools, anything.', schema: { type: 'object', properties: { name: { type: 'string', description: 'App name shown in title bar and dock' }, html: { type: 'string', description: 'HTML body content' }, css: { type: 'string', description: 'CSS styles' }, js: { type: 'string', description: 'JavaScript code' }, icon: { type: 'string', description: 'Emoji icon for dock' }, width: { type: 'number' }, height: { type: 'number' } }, required: ['name', 'html'] } },
      update_app: { desc: 'Update an existing app with new HTML/CSS/JS', schema: { type: 'object', properties: { name: { type: 'string' }, html: { type: 'string' }, css: { type: 'string' }, js: { type: 'string' } }, required: ['name', 'html'] } },
      list_apps: { desc: 'List all installed generative apps', schema: { type: 'object', properties: {} } },
      focus_window: { desc: 'Focus/bring a window to front by title or type', schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
      list_windows: { desc: 'List all open windows', schema: { type: 'object', properties: {} } },
      update_progress: { desc: 'Mark a step as done by index (0-based). Call this after completing each planned step.', schema: { type: 'object', properties: { step_index: { type: 'number', description: '0-based step index' } }, required: ['step_index'] } },
      done: { desc: 'Signal task completion', schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } },
    }

    // Mark first step as running
    if (steps.length > 0) { steps[0].status = 'running'; WindowManager.updateTask(task) }

    const tools = Object.entries(toolDefs).map(([name, { desc, schema }]) => ({
      name, description: desc, input_schema: schema,
      execute: (params) => {
        if (abort.signal.aborted) throw new Error('aborted')
        blackboard.workerLog.push({ tool: name, params, time: Date.now() })
        task.log.push(`${name}: ${JSON.stringify(params).slice(0, 60)}`)

        // Check for steer directive
        if (blackboard.directive?.type === 'steer') {
          task.log.push(`↪ Steered: ${blackboard.directive.instruction}`)
          blackboard.directive = null
        }

        const result = toolHandlers[name](params)
        WindowManager.updateTask(task)

        if (result.done) {
          task.status = 'done'
          blackboard.currentTask.status = 'done'
          setWorkerStatus(taskQueue.length > 0 ? `⏳ ${taskQueue.length} queued` : '✅ Done')
          steps.forEach(s => { if (s.status !== 'done') s.status = 'done' })
          WindowManager.updateTask(task)
          // Report back to conversation with results
          reportTaskResult(taskDescription, result.summary || '', task.log)
        }
        return result
      }
    }))

    try {
      const os = getOsState()
      const steerNote = blackboard.directive?.type === 'steer' ? `\n\nIMPORTANT DIRECTION CHANGE: ${blackboard.directive.instruction}\nAdjust your execution plan accordingly.` : ''
      if (steerNote) blackboard.directive = null
      await ai.think(taskDescription, {
        system: `You are the execution engine of Fluid Agent OS. Execute the given task using tools.

Current OS state:
- Open windows: ${os.windows}
- Working directory: ${os.cwd}
- Desktop files: ${JSON.stringify(os.desktop)}
- Installed apps: ${os.installedApps}${steerNote}

Planned steps:
${steps.map((s, i) => `${i}. ${s.text}`).join('\n')}

You have deep control over every application:
- Files: create_file, read_file, list_directory, run_command
- Editor: open_file (opens in code editor with syntax highlighting)
- Terminal: open_terminal (visual), run_terminal (execute command and get output)
- Browser: open_browser, browser_navigate (go to URL), browser_back
- Music: play_music (play/pause/next/prev, pick track by index)
- Video: play_video (open with URL), video_control (play/pause/fullscreen)
- Windows: open_finder, open_image, close_window, focus_window, list_windows
- Generative Apps: create_app (build any UI with HTML/CSS/JS), update_app, list_apps
  Apps get installed in the dock and can be re-opened. Build anything: calculators, games, dashboards, tools.

You ARE the OS. Don't just open apps - use them. Create new apps when the user needs custom UI.

IMPORTANT: After completing each planned step, call update_progress with the step_index.
When finished, call the done tool with a detailed summary of what you found/did — this gets reported back to the user in the conversation. Include key results, findings, file contents, command outputs, etc.`,
        stream: false,
        tools,
      })

      if (blackboard.currentTask?.status !== 'done') {
        task.status = 'done'
        blackboard.currentTask.status = 'done'
        setWorkerStatus('✅ Done')
        steps.forEach(s => { if (s.status === 'pending') s.status = 'done' })
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
        const resp = await ai.chat(
          'Check if you should proactively message the user. Consider: task completions, suggestions based on what they were doing, interesting observations, or just a friendly check-in if it\'s been quiet.',
          {
            system: `You are Fluid Agent OS's proactive awareness system.

Current state:
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
    // Build a concise work report from the log
    const logSummary = (log || []).slice(-10).join('\n')

    try {
      const bubble = createStreamBubble()
      let fullReply = ''

      await ai.chat(
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

  return { configure, chat: chatWithTracking, blackboard, showActivity, startProactiveLoop, stopProactiveLoop, notify, restoreChatUI }
})() 
