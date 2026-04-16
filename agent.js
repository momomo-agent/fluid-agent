/* agent.js — Dual-brain agent: Talker + Worker, powered by Agentic */
const Agent = (() => {
  let ai = null // Agentic instance
  const messages = []
  let workerAbort = null

  // ── Blackboard (shared state) ──
  const blackboard = {
    currentTask: null,
    directive: null,
    completedSteps: [],
    workerLog: [],
  }

  function configure(provider, apiKey, model, baseUrl) {
    const opts = { provider, apiKey }
    if (model) opts.model = model
    else opts.model = provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o'
    if (baseUrl) opts.baseUrl = baseUrl
    ai = new Agentic(opts)
  }

  // ── Activity Stream ──
  function showActivity(text) {
    const stream = document.getElementById('activity-stream')
    const item = document.createElement('div')
    item.className = 'activity-item'
    item.innerHTML = `<div class="activity-dot"></div><span>${text}</span>`
    stream.appendChild(item)
    while (stream.children.length > 3) stream.removeChild(stream.firstChild)
    setTimeout(() => { if (item.parentNode) item.remove() }, 8000)
  }

  function setWorkerStatus(text) {
    document.getElementById('worker-status').textContent = text
  }

  // ── Chat UI ──
  function addBubble(role, text) {
    const container = document.getElementById('chat-messages')
    const bubble = document.createElement('div')
    bubble.className = `chat-bubble ${role}`
    bubble.textContent = text
    container.appendChild(bubble)
    container.scrollTop = container.scrollHeight
    return bubble
  }

  function createStreamBubble() {
    const container = document.getElementById('chat-messages')
    const bubble = document.createElement('div')
    bubble.className = 'chat-bubble agent'
    container.appendChild(bubble)
    container.scrollTop = container.scrollHeight
    return bubble
  }

  // ── Talker (always-on, immediate response) ──
  async function chat(userMessage) {
    addBubble('user', userMessage)
    messages.push({ role: 'user', content: userMessage })

    // If worker is running, abort it so we can respond immediately
    if (workerAbort && blackboard.currentTask) {
      blackboard.directive = 'abort'
      workerAbort.abort()
      workerAbort = null
      setWorkerStatus('')
      showActivity('Task interrupted — responding to you')
    }

    const bubble = createStreamBubble()
    let fullReply = ''

    try {
      // Use Agentic.think() with streaming via emit callback
      const result = await ai.think(userMessage, {
        system: buildTalkerSystem(),
        stream: true,
        history: messages.slice(-21, -1),
        tools: [],
        emit: (type, data) => {
          if (type === 'token') {
            fullReply += (data.text || '')
            bubble.textContent = fullReply
            document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight
          }
        }
      })

      // Fallback if streaming didn't populate
      if (!fullReply && result) {
        fullReply = typeof result === 'string' ? result : (result.answer || result)
        bubble.textContent = fullReply
      }

      messages.push({ role: 'assistant', content: fullReply })

      // Parse action from reply
      const action = parseAction(fullReply)
      if (action && action.action === 'execute') {
        bubble.textContent = action.reply || cleanReply(fullReply)
        startWorker(action.task || userMessage, action.steps)
      } else if (action && action.action === 'redirect') {
        bubble.textContent = action.reply || cleanReply(fullReply)
        startWorker(action.detail || action.task, action.steps)
      }

    } catch (err) {
      if (!fullReply) {
        bubble.textContent = `Error: ${err.message}`
      }
    }
  }

  function cleanReply(text) {
    return text.replace(/```json[\s\S]*?```/g, '').trim()
  }

  function buildTalkerSystem() {
    let sys = `You are Fluid Agent, an AI that IS the operating system. Windows, files, and terminals are your expressions — not things you operate, but how you manifest your actions.

You are always responsive. The user can interrupt you at any time.

Current state:
- Working directory: ${Shell.getCwd()}
- Desktop: ${JSON.stringify(VFS.ls('/home/user/Desktop')?.map(f => f.name) || [])}
- Documents: ${JSON.stringify(VFS.ls('/home/user/Documents')?.map(f => f.name) || [])}
- Downloads: ${JSON.stringify(VFS.ls('/home/user/Downloads')?.map(f => f.name) || [])}
`
    if (blackboard.currentTask) {
      sys += `\nActive task: ${blackboard.currentTask.goal} (${blackboard.currentTask.status})
Completed: ${blackboard.completedSteps.map(s => s.text).join(', ') || 'none'}
`
    }

    sys += `\nWhen the user asks you to DO something (create files, write code, organize, build something), respond conversationally AND include a JSON action block:

\`\`\`json
{"action": "execute", "reply": "your conversational reply here", "task": "what to do", "steps": ["step 1", "step 2"]}
\`\`\`

For pure conversation, just reply normally. Keep replies concise. You're a capable OS, not a chatbot.`
    return sys
  }

  function parseAction(text) {
    const match = text.match(/```json\s*(\{[\s\S]*?\})\s*```/)
    if (!match) return null
    try { return JSON.parse(match[1]) } catch { return null }
  }

  // ── Worker (background execution with tools) ──
  async function startWorker(taskDescription, plannedSteps) {
    if (workerAbort) { workerAbort.abort(); workerAbort = null }

    const abort = new AbortController()
    workerAbort = abort

    const steps = (plannedSteps || []).map(s => ({ text: s, status: 'pending' }))
    blackboard.currentTask = { goal: taskDescription, steps, currentStep: 0, status: 'running' }
    blackboard.directive = null
    blackboard.completedSteps = []
    blackboard.workerLog = []

    // Open Plan window
    const planWinId = WindowManager.openPlan(taskDescription, steps)

    setWorkerStatus('🔄 Working...')
    showActivity(`Starting: ${taskDescription.slice(0, 50)}...`)

    // Tool handlers
    const toolHandlers = {
      create_file: ({ path, content }) => {
        VFS.mkdir(path.split('/').slice(0, -1).join('/'))
        VFS.writeFile(path, content)
        showActivity(`Created ${path.split('/').pop()}`)
        return { success: true, message: `Created ${path}` }
      },
      read_file: ({ path }) => {
        const content = VFS.readFile(path)
        return content !== null ? { content } : { error: `File not found: ${path}` }
      },
      list_directory: ({ path }) => {
        const items = VFS.ls(path)
        return items ? { items } : { error: `Directory not found: ${path}` }
      },
      run_command: ({ command }) => {
        showActivity(`$ ${command}`)
        const output = Shell.exec(command)
        return { output: output || '(no output)' }
      },
      open_finder: ({ path }) => {
        WindowManager.openFinder(path)
        showActivity(`Opened Finder: ${path}`)
        return { success: true }
      },
      open_file: ({ path }) => {
        WindowManager.openEditor(path)
        showActivity(`Opened ${path.split('/').pop()}`)
        return { success: true }
      },
      open_terminal: () => {
        WindowManager.openTerminal()
        showActivity('Opened Terminal')
        return { success: true }
      },
      done: ({ summary }) => {
        showActivity(`✅ ${summary}`)
        return { done: true, summary }
      }
    }

    // agentic-core tools format: { name, description, input_schema, execute }
    const tools = Object.entries({
      create_file: { desc: 'Create or overwrite a file', schema: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path e.g. /home/user/Desktop/app.js' }, content: { type: 'string', description: 'File content' } }, required: ['path', 'content'] } },
      read_file: { desc: 'Read a file', schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
      list_directory: { desc: 'List directory contents', schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
      run_command: { desc: 'Run a shell command', schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
      open_finder: { desc: 'Open Finder at a path', schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
      open_file: { desc: 'Open file in editor', schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
      open_terminal: { desc: 'Open terminal window', schema: { type: 'object', properties: {} } },
      done: { desc: 'Signal task completion', schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } },
    }).map(([name, { desc, schema }]) => ({
      name,
      description: desc,
      input_schema: schema,
      execute: (params) => {
        if (abort.signal.aborted) throw new Error('aborted')
        blackboard.workerLog.push({ tool: name, params, time: Date.now() })

        // Update plan step status
        const stepIdx = blackboard.currentTask.currentStep
        if (steps[stepIdx]) {
          steps[stepIdx].status = 'running'
          WindowManager.updatePlan(planWinId, taskDescription, steps)
        }

        const result = toolHandlers[name](params)

        // Mark step done
        if (steps[stepIdx]) {
          steps[stepIdx].status = 'done'
          blackboard.currentTask.currentStep++
          blackboard.completedSteps.push(steps[stepIdx])
          WindowManager.updatePlan(planWinId, taskDescription, steps)
        }

        if (result.done) {
          blackboard.currentTask.status = 'done'
          setWorkerStatus('✅ Done')
          // Mark remaining steps done
          steps.forEach(s => { if (s.status === 'pending') s.status = 'done' })
          WindowManager.updatePlan(planWinId, taskDescription, steps)
        }
        return result
      }
    }))

    try {
      const workerSystem = `You are the execution engine of Fluid Agent OS. Execute the given task using tools.

Virtual filesystem root: /home/user/ (Desktop/, Documents/, Downloads/)
Current directory: ${Shell.getCwd()}

Execute efficiently. Create files, open windows, run commands as needed.
When finished, call the done tool with a summary.`

      // All LLM calls go through Agentic
      await ai.think(taskDescription, {
        system: workerSystem,
        stream: false,
        tools,
      })

      if (blackboard.currentTask && blackboard.currentTask.status !== 'done') {
        blackboard.currentTask.status = 'done'
        setWorkerStatus('✅ Done')
        setTimeout(() => setWorkerStatus(''), 3000)
      }

    } catch (err) {
      if (err.message === 'aborted' || abort.signal.aborted) {
        blackboard.currentTask.status = 'aborted'
        setWorkerStatus('⏹ Interrupted')
        showActivity('Task interrupted')
        // Mark remaining steps as aborted
        steps.forEach(s => { if (s.status === 'pending' || s.status === 'running') s.status = 'aborted' })
        WindowManager.updatePlan(planWinId, taskDescription, steps)
        setTimeout(() => setWorkerStatus(''), 2000)
      } else {
        setWorkerStatus(`❌ Error`)
        showActivity(`Error: ${err.message}`)
        addBubble('system', `Worker error: ${err.message}`)
      }
    }

    workerAbort = null
  }

  return { configure, chat, blackboard, showActivity }
})()
