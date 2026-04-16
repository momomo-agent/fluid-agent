/* agent.js — Dual-brain agent: Talker + Worker, powered by Agentic */
const Agent = (() => {
  let ai = null
  const messages = []
  let workerAbort = null
  let planWinId = null // reuse single plan window

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

    if (workerAbort && blackboard.currentTask) {
      blackboard.directive = 'abort'
      workerAbort.abort()
      workerAbort = null
      setWorkerStatus('')
      showActivity('Task interrupted')
    }

    const bubble = createStreamBubble()
    let fullReply = ''

    try {
      const os = getOsState()
      const system = buildTalkerSystem(os)
      const result = await ai.think(userMessage, {
        system,
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
        startWorker(action.task || userMessage, action.steps)
      }
    } catch (err) {
      if (!fullReply) bubble.textContent = `Error: ${err.message}`
    }
  }

  function cleanReply(text) { return text.replace(/```json[\s\S]*?```/g, '').trim() }

  function buildTalkerSystem(os) {
    let sys = `You are Fluid Agent, an AI that IS the operating system. Windows, files, and terminals are your expressions.

You are always responsive. The user can interrupt you at any time.

Current OS state:
- Open windows: ${os.windows}
- Focused window: ${os.focused}
- Working directory: ${os.cwd}
- Desktop files: ${JSON.stringify(os.desktop)}
- Documents: ${JSON.stringify(os.documents)}
`
    if (blackboard.currentTask) {
      sys += `\nActive task: ${blackboard.currentTask.goal} (${blackboard.currentTask.status})\nCompleted: ${blackboard.completedSteps.map(s => s.text).join(', ') || 'none'}\n`
    }
    sys += `\nWhen the user asks you to DO something (create files, write code, organize, build), respond conversationally AND include a JSON action block:

\`\`\`json
{"action": "execute", "reply": "your reply", "task": "what to do", "steps": ["step 1", "step 2"]}
\`\`\`

For pure conversation, just reply normally. Keep replies concise.`
    return sys
  }

  function parseAction(text) {
    const m = text.match(/```json\s*(\{[\s\S]*?\})\s*```/)
    if (!m) return null
    try { return JSON.parse(m[1]) } catch { return null }
  }

  async function startWorker(taskDescription, plannedSteps) {
    if (workerAbort) { workerAbort.abort(); workerAbort = null }

    const abort = new AbortController()
    workerAbort = abort
    const steps = (plannedSteps || []).map(s => ({ text: s, status: 'pending' }))
    blackboard.currentTask = { goal: taskDescription, steps, currentStep: 0, status: 'running' }
    blackboard.directive = null
    blackboard.completedSteps = []
    blackboard.workerLog = []

    // Reuse existing plan window or open new one
    if (planWinId && WindowManager.windows.has(planWinId)) {
      WindowManager.updatePlan(planWinId, taskDescription, steps)
      WindowManager.focus(planWinId)
    } else {
      planWinId = WindowManager.openPlan(taskDescription, steps)
    }

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
      run_command: ({ command }) => {
        showActivity(`$ ${command}`)
        return { output: Shell.exec(command) || '(no output)' }
      },
      open_finder: ({ path }) => { WindowManager.openFinder(path); showActivity(`Finder: ${path}`); return { success: true } },
      open_file: ({ path }) => { WindowManager.openEditor(path); showActivity(`Opened ${path.split('/').pop()}`); return { success: true } },
      open_terminal: () => { WindowManager.openTerminal(); showActivity('Opened Terminal'); return { success: true } },
      open_image: ({ src, title }) => { WindowManager.openImage(src, title); showActivity(`Opened image: ${title || src.split('/').pop()}`); return { success: true } },
      close_window: ({ title }) => { const ok = WindowManager.closeByTitle(title); return { success: ok } },
      focus_window: ({ title }) => { const ok = WindowManager.focusByTitle(title); return { success: ok } },
      list_windows: () => ({ windows: WindowManager.getState().windows }),
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
      focus_window: { desc: 'Focus/bring a window to front by title or type', schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
      list_windows: { desc: 'List all open windows', schema: { type: 'object', properties: {} } },
      done: { desc: 'Signal task completion', schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } },
    }

    const tools = Object.entries(toolDefs).map(([name, { desc, schema }]) => ({
      name, description: desc, input_schema: schema,
      execute: (params) => {
        if (abort.signal.aborted) throw new Error('aborted')
        blackboard.workerLog.push({ tool: name, params, time: Date.now() })

        const stepIdx = blackboard.currentTask.currentStep
        if (steps[stepIdx]) { steps[stepIdx].status = 'running'; WindowManager.updatePlan(planWinId, taskDescription, steps) }

        const result = toolHandlers[name](params)

        if (steps[stepIdx]) {
          steps[stepIdx].status = 'done'
          blackboard.currentTask.currentStep++
          blackboard.completedSteps.push(steps[stepIdx])
          WindowManager.updatePlan(planWinId, taskDescription, steps)
        }

        if (result.done) {
          blackboard.currentTask.status = 'done'
          setWorkerStatus('✅ Done')
          steps.forEach(s => { if (s.status === 'pending') s.status = 'done' })
          WindowManager.updatePlan(planWinId, taskDescription, steps)
        }
        return result
      }
    }))

    try {
      const os = getOsState()
      await ai.think(taskDescription, {
        system: `You are the execution engine of Fluid Agent OS. Execute the given task using tools.

Current OS state:
- Open windows: ${os.windows}
- Working directory: ${os.cwd}
- Desktop files: ${JSON.stringify(os.desktop)}

Execute efficiently. Use list_windows to see what's open. Use close_window/focus_window to manage windows.
When finished, call the done tool with a summary.`,
        stream: false,
        tools,
      })

      if (blackboard.currentTask?.status !== 'done') {
        blackboard.currentTask.status = 'done'
        setWorkerStatus('✅ Done')
        setTimeout(() => setWorkerStatus(''), 3000)
      }
    } catch (err) {
      if (err.message === 'aborted' || abort.signal.aborted) {
        blackboard.currentTask.status = 'aborted'
        setWorkerStatus('⏹ Interrupted')
        showActivity('Task interrupted')
        steps.forEach(s => { if (s.status === 'pending' || s.status === 'running') s.status = 'aborted' })
        WindowManager.updatePlan(planWinId, taskDescription, steps)
        setTimeout(() => setWorkerStatus(''), 2000)
      } else {
        setWorkerStatus('❌ Error')
        showActivity(`Error: ${err.message}`)
        addBubble('system', `Worker error: ${err.message}`)
      }
    }
    workerAbort = null
  }

  return { configure, chat, blackboard, showActivity }
})()
