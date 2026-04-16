/* agent.js — Dual-brain agent: Talker + Worker, powered by Agentic */
const Agent = (() => {
  let ai = null
  const messages = []
  let workerRunning = false
  let workerAbort = null
  const taskQueue = [] // pending tasks

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
    return {
      windows: wins,
      focused: state.focusedWindow ? `${state.focusedWindow.type}${state.focusedWindow.path ? ' (' + state.focusedWindow.path + ')' : ''}` : 'none',
      cwd: Shell.getCwd(),
      desktop: VFS.ls('/home/user/Desktop')?.map(f => f.name) || [],
      documents: VFS.ls('/home/user/Documents')?.map(f => f.name) || [],
    }
  }

  async function chat(userMessage) {
    addBubble('user', userMessage)
    messages.push({ role: 'user', content: userMessage })

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

    let sys = `You are Fluid Agent, an AI that IS the operating system. Windows, files, and terminals are your expressions.

You are always responsive. The user can talk to you anytime, even while tasks are running.

Current OS state:
- Open windows: ${os.windows}
- Focused window: ${os.focused}
- Working directory: ${os.cwd}
- Desktop files: ${JSON.stringify(os.desktop)}
- Documents: ${JSON.stringify(os.documents)}
`
    if (runningTasks.length > 0) {
      sys += `\nCurrently executing: ${runningTasks[0].goal} (${runningTasks[0].status})`
      if (queuedCount > 0) sys += `\nQueued tasks: ${queuedCount}`
    }
    sys += `\nCompleted recently: ${blackboard.completedSteps.map(s => s.text).join(', ') || 'none'}`

    sys += `\n\nYou can respond with these JSON action blocks:

1. NEW TASK — queue a new task (runs after current finishes):
\`\`\`json
{"action": "execute", "reply": "your reply", "task": "what to do", "steps": ["step 1", "step 2"]}
\`\`\`

2. STEER — change direction of the currently running task:
\`\`\`json
{"action": "steer", "reply": "your reply", "instruction": "new direction for the worker"}
\`\`\`

3. ABORT — stop everything (current task + queue):
\`\`\`json
{"action": "abort", "reply": "your reply"}
\`\`\`

For pure conversation, just reply normally. Keep replies concise.`
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
    else showActivity(`Queued: ${taskDescription.slice(0, 40)}…`)
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
        // Expose musicState for agent control — handled via custom event
        const evt = new CustomEvent('music-control', { detail: { action, track } })
        window.dispatchEvent(evt)
        showActivity(`🎵 Music: ${action}${track != null ? ' #' + track : ''}`)
        return { success: true }
      },
      open_browser: ({ url }) => { WindowManager.openBrowser(url); showActivity(`🌐 Browser: ${url || 'home'}`); return { success: true } },
      play_video: ({ url, title }) => { WindowManager.openVideo(url, title); showActivity(`🎬 Video: ${title || url || 'player'}`); return { success: true } },
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
      play_video: { desc: 'Open video player with a URL', schema: { type: 'object', properties: { url: { type: 'string', description: 'Video URL (YouTube embed, mp4, etc)' }, title: { type: 'string' } } } },
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
- Desktop files: ${JSON.stringify(os.desktop)}${steerNote}

Planned steps:
${steps.map((s, i) => `${i}. ${s.text}`).join('\n')}

IMPORTANT: After completing each planned step, call update_progress with the step_index to show progress to the user.
Execute efficiently. Use list_windows to see what's open. Use close_window/focus_window to manage windows.
When finished, call the done tool with a summary.`,
        stream: false,
        tools,
      })

      if (blackboard.currentTask?.status !== 'done') {
        task.status = 'done'
        blackboard.currentTask.status = 'done'
        setWorkerStatus('✅ Done')
        steps.forEach(s => { if (s.status === 'pending') s.status = 'done' })
        WindowManager.updateTask(task)
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

  return { configure, chat, blackboard, showActivity }
})()
