/* agent.js — Dual-brain agent: Talker + Worker */
const Agent = (() => {
  let config = { provider: 'anthropic', apiKey: '', model: '' }
  const messages = []
  let workerAbort = null
  let planWindowId = null

  // ── Blackboard ──
  const blackboard = {
    currentTask: null,    // { goal, steps: [{text, status}], currentStep }
    directive: null,      // null | 'abort' | { type: 'redirect', detail: '...' }
    completedSteps: [],
    workerLog: [],
  }

  function configure(provider, apiKey) {
    config.provider = provider
    config.apiKey = apiKey
    config.model = provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o'
  }

  // ── Activity Stream ──
  function showActivity(text) {
    const stream = document.getElementById('activity-stream')
    const item = document.createElement('div')
    item.className = 'activity-item'
    item.innerHTML = `<div class="activity-dot"></div><span>${text}</span>`
    stream.appendChild(item)
    // Keep only last 3
    while (stream.children.length > 3) stream.removeChild(stream.firstChild)
    // Auto-remove after 8s
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
    bubble.textContent = ''
    container.appendChild(bubble)
    container.scrollTop = container.scrollHeight
    return bubble
  }

  // ── Talker ──
  async function chat(userMessage) {
    addBubble('user', userMessage)
    messages.push({ role: 'user', content: userMessage })

    // If worker is running, check if we need to redirect/abort
    if (workerAbort && blackboard.currentTask) {
      // Abort current worker immediately so Talker can respond
      blackboard.directive = 'abort'
      workerAbort.abort()
      workerAbort = null
      setWorkerStatus('')
    }

    const bubble = createStreamBubble()
    let fullReply = ''

    const systemPrompt = buildTalkerSystem()

    try {
      const talkerConfig = {
        provider: config.provider,
        apiKey: config.apiKey,
        model: config.model,
        system: systemPrompt,
        stream: true,
        history: messages.slice(-21, -1), // exclude current message, agenticAsk adds it as prompt
        tools: [],
      }

      // Use agenticAsk with streaming via emit callback
      const result = await AgenticCore.agenticAsk(userMessage, talkerConfig, (type, data) => {
        if (type === 'token') {
          fullReply += (data.text || '')
          bubble.textContent = fullReply
          document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight
        }
      })

      // If agenticAsk returns answer directly
      if (result && result.answer && !fullReply) {
        fullReply = result.answer
        bubble.textContent = fullReply
      }

      if (!fullReply && result && typeof result === 'string') {
        fullReply = result
        bubble.textContent = fullReply
      }

      messages.push({ role: 'assistant', content: fullReply })

      // Parse action from reply (look for JSON block at end)
      const action = parseAction(fullReply)
      if (action && action.action === 'execute') {
        // Strip the JSON from displayed text
        bubble.textContent = action.reply || fullReply.replace(/```json[\s\S]*```/g, '').trim()
        startWorker(action.detail || action.task || userMessage)
      } else if (action && action.action === 'redirect' && blackboard.currentTask) {
        bubble.textContent = action.reply || fullReply
        startWorker(action.detail)
      }

    } catch (err) {
      if (!fullReply) {
        bubble.textContent = `Error: ${err.message}`
        bubble.classList.add('error')
      }
    }
  }

  function buildTalkerSystem() {
    let sys = `You are Fluid Agent, an AI that IS the operating system. You don't "use" the OS — you ARE it. Windows, files, and terminals are your expressions.

You are always responsive. The user can interrupt you at any time. You respond immediately.

Current virtual filesystem state:
- Working directory: ${Shell.getCwd()}
- Desktop files: ${JSON.stringify(VFS.ls('/home/user/Desktop')?.map(f => f.name) || [])}
- Documents: ${JSON.stringify(VFS.ls('/home/user/Documents')?.map(f => f.name) || [])}
`

    if (blackboard.currentTask) {
      sys += `\nCurrent task: ${blackboard.currentTask.goal}
Steps completed: ${blackboard.completedSteps.map(s => s.text).join(', ') || 'none'}
Status: ${blackboard.currentTask.status || 'running'}
`
    }

    sys += `\nWhen the user asks you to DO something (create files, write code, organize, etc.), respond conversationally AND include a JSON action block at the end of your message:

\`\`\`json
{"action": "execute", "reply": "your conversational reply", "task": "description of what to do", "steps": ["step 1", "step 2", ...]}
\`\`\`

For pure conversation (questions, opinions, etc.), just reply normally without any JSON block.

Keep replies concise and natural. You're a capable OS, not a chatbot.`

    return sys
  }

  function parseAction(text) {
    const match = text.match(/```json\s*(\{[\s\S]*?\})\s*```/)
    if (!match) return null
    try { return JSON.parse(match[1]) } catch { return null }
  }

  // ── Worker ──
  async function startWorker(taskDescription) {
    // Abort previous worker if any
    if (workerAbort) { workerAbort.abort(); workerAbort = null }

    const abort = new AbortController()
    workerAbort = abort

    blackboard.currentTask = { goal: taskDescription, steps: [], currentStep: 0, status: 'planning' }
    blackboard.directive = null
    blackboard.completedSteps = []
    blackboard.workerLog = []

    setWorkerStatus('🔄 Working...')
    showActivity(`Starting: ${taskDescription.slice(0, 50)}...`)

    try {
      // Worker LLM call with tools
      const workerSystem = `You are the execution engine of Fluid Agent OS. You receive a task and execute it step by step using the available tools.

Virtual filesystem is at /home/user/ with Desktop/, Documents/, Downloads/.
Current directory: ${Shell.getCwd()}

Execute the task efficiently. Use tools to create files, open windows, run commands. Be thorough but concise.
After completing all steps, call the done tool.`

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
          showActivity(`Running: ${command}`)
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
          showActivity(`Done: ${summary}`)
          return { done: true, summary }
        }
      }

      // agentic-core custom tools: need { name, description, input_schema, execute }
      const tools = [
        { name: 'create_file', description: 'Create or overwrite a file in the virtual filesystem', input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path like /home/user/Desktop/app.js' }, content: { type: 'string', description: 'File content' } }, required: ['path', 'content'] }, execute: (p) => toolHandlers.create_file(p) },
        { name: 'read_file', description: 'Read a file from the virtual filesystem', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, execute: (p) => toolHandlers.read_file(p) },
        { name: 'list_directory', description: 'List contents of a directory', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, execute: (p) => toolHandlers.list_directory(p) },
        { name: 'run_command', description: 'Run a shell command in the virtual terminal', input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }, execute: (p) => toolHandlers.run_command(p) },
        { name: 'open_finder', description: 'Open a Finder window at a directory path', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, execute: (p) => toolHandlers.open_finder(p) },
        { name: 'open_file', description: 'Open a file in the text editor', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, execute: (p) => toolHandlers.open_file(p) },
        { name: 'open_terminal', description: 'Open a new terminal window', input_schema: { type: 'object', properties: {} }, execute: () => toolHandlers.open_terminal() },
        { name: 'done', description: 'Signal that the task is complete', input_schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] }, execute: (p) => toolHandlers.done(p) },
      ]

      const workerConfig = {
        provider: config.provider,
        apiKey: config.apiKey,
        model: config.model,
        system: workerSystem,
        stream: false,
        tools: tools,
        signal: abort.signal,
      }

      // Run worker
      const result = await AgenticCore.agenticAsk(taskDescription, workerConfig)

      if (blackboard.currentTask) {
        blackboard.currentTask.status = 'done'
        setWorkerStatus('✅ Done')
        setTimeout(() => setWorkerStatus(''), 3000)
      }

    } catch (err) {
      if (err.message === 'aborted' || abort.signal.aborted) {
        blackboard.currentTask.status = 'aborted'
        setWorkerStatus('⏹ Interrupted')
        showActivity('Task interrupted')
        setTimeout(() => setWorkerStatus(''), 2000)
      } else {
        setWorkerStatus(`❌ Error: ${err.message}`)
        showActivity(`Error: ${err.message}`)
      }
    }

    workerAbort = null
  }

  return { configure, chat, blackboard, showActivity }
})()
