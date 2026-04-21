/* agent.js - Dual-brain agent: Talker + Worker, powered by Agentic */
const Agent = (() => {
  let ai = null
  const messages = []
  // Scheduler handles task queue + parallel slots (see scheduler.js)

  // --- Chat persistence via agentic glue ---
  const MAX_MESSAGES = 50
  const SUMMARIZE_THRESHOLD = 24

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
        // Skip empty assistant messages (failed requests saved as loading state)
        if (m.role === 'assistant' && !m.content?.trim()) return
        const cleaned = m.role === 'assistant' ? cleanReply(m.content || '') : null
        // Skip assistant messages that are pure JSON (no user-visible text)
        if (m.role === 'assistant' && !cleaned) return
        const text = m.role === 'assistant' ? cleaned : (m.content?.slice(0, 500) || '')
        addBubble(m.role === 'assistant' ? 'agent' : 'user', text)
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
        if (parsed) {
          customSkills.set(entry.name, parsed)
          registerSkillCapability(entry.name, parsed)
        }
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

  // Dynamic registration: skill → Capability
  function registerSkillCapability(name, skill) {
    const capName = `skill_${name}`
    Capabilities.register(capName, {
      description: `[Skill] ${skill.description}`,
      icon: skill.icon || '🧩',
      category: 'Skills',
      schema: skill.schema,
      handler: async (params, ctx) => {
        try {
          const fn = buildSkillHandler(skill.handler_js)
          const result = await fn(params, ctx.VFS, ctx.Shell, ctx.WindowManager)
          ctx.showActivity(`🧩 ${name}: done`)
          return result || { success: true }
        } catch (e) {
          return { error: e.message }
        }
      }
    })
  }

  function unregisterSkillCapability(name) {
    Capabilities.unregister(`skill_${name}`)
  }

  // getSkillTools() removed — skills register directly as Capabilities

  function configure(provider, apiKey, model, baseUrl, storeInstance) {
    const opts = { provider, apiKey }
    // Use CORS proxy only when explicitly enabled in settings
    const settings = window._settingsCache || {}
    if (settings.useProxy && !(baseUrl && baseUrl.includes('localhost'))) {
      opts.proxyUrl = 'https://proxy.link2web.site'
    }
    if (storeInstance) opts.store = { instance: storeInstance }
    else opts.store = { name: 'fluid-agent' }
    opts.model = model || (provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o')
    if (baseUrl) opts.baseUrl = baseUrl
    opts.embed = { provider: 'local', baseUrl: '/api' }
    const AgenticClass = typeof Agentic === 'function' ? Agentic : Agentic.Agentic
    ai = new AgenticClass(opts)
    // configure call removed — embed passed via constructor
    if (typeof Dispatcher !== 'undefined') Dispatcher.init(ai, storeInstance || null)
    if (typeof IntentState !== 'undefined') IntentState.init()

    // Wire VFS events → ContextAssembler (dynamic attention)
    if (typeof ContextAssembler !== 'undefined') {
      VFS.on((event, path) => {
        if (!path.startsWith('/system/logs')) {  // avoid noise
          ContextAssembler.logEvent(event, path)
        }
      })
    }
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

  function setWorkerStatus(text) { const el = document.getElementById('worker-status'); if (el) el.textContent = text }

  // ── Lightweight markdown renderer for chat bubbles ──

  function _hasMarkdown(text) {
    return /\|.*\|.*\|/.test(text) || /\*\*/.test(text) || /^\s*[-*]\s/m.test(text) || /^#{1,3}\s/m.test(text) || /`[^`]+`/.test(text)
  }

  function _renderMarkdown(text) {
    // Escape HTML first
    let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    // Tables: detect lines with | separators
    const lines = html.split('\n')
    const out = []
    let i = 0
    while (i < lines.length) {
      // Table detection: current line has |, next line is separator (|---|---|
      if (lines[i].includes('|') && i + 1 < lines.length && /^[\s|:-]+$/.test(lines[i + 1])) {
        const headers = lines[i].split('|').map(c => c.trim()).filter(Boolean)
        i += 2 // skip header + separator
        const rows = []
        while (i < lines.length && lines[i].includes('|')) {
          rows.push(lines[i].split('|').map(c => c.trim()).filter(Boolean))
          i++
        }
        let table = '<table class="md-table"><thead><tr>'
        headers.forEach(h => table += `<th>${_inlineMarkdown(h)}</th>`)
        table += '</tr></thead><tbody>'
        rows.forEach(r => {
          table += '<tr>'
          r.forEach(c => table += `<td>${_inlineMarkdown(c)}</td>`)
          table += '</tr>'
        })
        table += '</tbody></table>'
        out.push('<div class="md-table-wrap">' + table + '</div>')
      } else {
        out.push(_blockMarkdown(lines[i]))
        i++
      }
    }
    return out.join('\n')
  }

  function _blockMarkdown(line) {
    // Headers
    if (/^###\s/.test(line)) return `<strong>${_inlineMarkdown(line.slice(4))}</strong>`
    if (/^##\s/.test(line)) return `<strong>${_inlineMarkdown(line.slice(3))}</strong>`
    if (/^#\s/.test(line)) return `<strong style="font-size:1.1em">${_inlineMarkdown(line.slice(2))}</strong>`
    // List items
    if (/^\s*[-*]\s/.test(line)) return `<div style="padding-left:12px">• ${_inlineMarkdown(line.replace(/^\s*[-*]\s/, ''))}</div>`
    if (/^\s*\d+\.\s/.test(line)) return `<div style="padding-left:12px">${_inlineMarkdown(line)}</div>`
    return _inlineMarkdown(line)
  }

  function _inlineMarkdown(text) {
    return text
      .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px;font-size:0.9em">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#7eb8ff" target="_blank">$1</a>')
  }

  function renderBubbleContent(bubble, text) {
    // Detect media patterns and render inline
    const imgExts = /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?[^\s]*)?$/i
    const audioExts = /\.(mp3|wav|ogg|m4a|aac|flac)(\?[^\s]*)?$/i
    const videoExts = /\.(mp4|webm|mov|mkv)(\?[^\s]*)?$/i
    const urlRegex = /(https?:\/\/[^\s<>"']+)/g

    // Also detect markdown image syntax: ![alt](url)
    const mdImgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g

    const frag = document.createDocumentFragment()
    let lastIndex = 0
    let hasMedia = false
    const mediaItems = [] // for drag support

    // First pass: collect all media from markdown images
    const mdMatches = []
    let mdMatch
    while ((mdMatch = mdImgRegex.exec(text)) !== null) {
      mdMatches.push({ start: mdMatch.index, end: mdMatch.index + mdMatch[0].length, url: mdMatch[2], alt: mdMatch[1], type: 'image' })
    }

    // Second pass: collect media from bare URLs (skip those already in markdown)
    const urlMatches = []
    let urlMatch
    while ((urlMatch = urlRegex.exec(text)) !== null) {
      const url = urlMatch[1]
      const inMd = mdMatches.some(m => url === m.url || (urlMatch.index >= m.start && urlMatch.index < m.end))
      if (inMd) continue
      let type = null
      if (imgExts.test(url)) type = 'image'
      else if (audioExts.test(url)) type = 'audio'
      else if (videoExts.test(url)) type = 'video'
      // Also check tmdb image URLs
      else if (url.includes('image.tmdb.org')) type = 'image'
      if (type) urlMatches.push({ start: urlMatch.index, end: urlMatch.index + urlMatch[0].length, url, type })
    }

    const allMedia = [...mdMatches, ...urlMatches].sort((a, b) => a.start - b.start)
    if (allMedia.length === 0) {
      // Render markdown if text contains markdown patterns
      if (_hasMarkdown(text)) {
        bubble.innerHTML = _renderMarkdown(text)
      } else {
        bubble.textContent = text
      }
      return
    }

    allMedia.forEach(m => {
      // Add text before this media
      if (m.start > lastIndex) {
        const t = text.slice(lastIndex, m.start).trim()
        if (t) { const span = document.createElement('span'); span.textContent = t; frag.appendChild(span) }
      }

      const wrap = document.createElement('div')
      wrap.className = 'chat-media'
      wrap.draggable = true
      wrap.dataset.url = m.url
      wrap.dataset.type = m.type

      // Determine filename from URL
      const fname = m.url.split('/').pop().split('?')[0] || `media.${m.type === 'image' ? 'png' : m.type === 'audio' ? 'mp3' : 'mp4'}`
      wrap.dataset.filename = fname
      wrap.title = `Drag to Desktop to save as ${fname}`

      if (m.type === 'image') {
        const img = document.createElement('img')
        img.src = m.url
        img.alt = m.alt || fname
        img.loading = 'lazy'
        img.addEventListener('click', () => WindowManager.openImage(m.url, m.alt || fname))
        wrap.appendChild(img)
      } else if (m.type === 'audio') {
        const audio = document.createElement('audio')
        audio.src = m.url
        audio.controls = true
        audio.preload = 'metadata'
        wrap.appendChild(audio)
      } else if (m.type === 'video') {
        const video = document.createElement('video')
        video.src = m.url
        video.controls = true
        video.preload = 'metadata'
        video.style.maxWidth = '100%'
        video.style.borderRadius = '8px'
        wrap.appendChild(video)
      }

      // Drag handler — drop on desktop creates a VFS file reference
      wrap.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-fluid-media', JSON.stringify({ url: m.url, type: m.type, filename: fname }))
        e.dataTransfer.effectAllowed = 'copy'
      })

      frag.appendChild(wrap)
      mediaItems.push({ url: m.url, type: m.type, filename: fname })
      hasMedia = true
      lastIndex = m.end
    })

    // Remaining text after last media
    if (lastIndex < text.length) {
      const t = text.slice(lastIndex).trim()
      if (t) { const span = document.createElement('span'); span.textContent = t; frag.appendChild(span) }
    }

    bubble.innerHTML = ''
    bubble.appendChild(frag)
  }

  function addBubble(role, text) {
    const c = document.getElementById('chat-messages')
    const b = document.createElement('div')
    b.className = `chat-bubble ${role}`
    if (role === 'agent') renderBubbleContent(b, text)
    else b.textContent = text
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
      const pos = `${(w.x*100).toFixed(0)}%,${(w.y*100).toFixed(0)}% ${(w.width*100).toFixed(0)}%x${(w.height*100).toFixed(0)}%`
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

  // --- Intent dispatch helpers (module scope, used by chat + batch) ---
  function _dispatchIntent(parsed) {
    if (!parsed) return
    if (parsed.intents && Array.isArray(parsed.intents)) {
      for (const i of parsed.intents) {
        if (i.action === 'create') {
          IntentState.create(i.goal)
          showActivity(`\ud83d\udccb New: ${i.goal.slice(0, 40)}`)
        } else if (i.action === 'update' && i.id) {
          IntentState.update(i.id, { goal: i.goal, message: i.message || i.context })
          showActivity(`\u21aa Updated: ${i.goal.slice(0, 40)}`)
        } else if (i.action === 'cancel' && i.id) {
          IntentState.cancel(i.id)
          showActivity('Cancelled')
        } else if (i.action === 'done' && i.id) {
          IntentState.done(i.id)
        }
      }
    }
    if (parsed.remember) {
      const memPath = '/system/memory/MEMORY.md'
      let mem = VFS.isFile(memPath) ? VFS.readFile(memPath) : '# Agent Memory\n'
      const section = parsed.remember.section || 'Lessons Learned'
      const sectionHeader = `## ${section}`
      if (mem.includes(sectionHeader)) {
        mem = mem.replace(sectionHeader, `${sectionHeader}\n- ${parsed.remember.entry}`)
      } else {
        mem += `\n${sectionHeader}\n- ${parsed.remember.entry}\n`
      }
      VFS.writeFile(memPath, mem)
      showActivity('Memory updated')
    }
  }

  function _legacyToIntent(action, userMsg) {
    if (action.action === 'execute' || action.action === 'redirect') {
      return { intents: [{ action: 'create', goal: action.task || userMsg }] }
    } else if (action.action === 'steer') {
      const active = typeof IntentState !== 'undefined' ? IntentState.active() : []
      if (active.length > 0) {
        return { intents: [{ action: 'update', id: active[active.length - 1].id, goal: action.instruction }] }
      }
      return { intents: [{ action: 'create', goal: action.instruction }] }
    } else if (action.action === 'abort') {
      const active = typeof IntentState !== 'undefined' ? IntentState.active() : []
      return { intents: active.map(i => ({ action: 'cancel', id: i.id })) }
    } else if (action.action === 'remember' && action.memory) {
      return { remember: { entry: action.memory, section: action.section } }
    }
    return null
  }

  async function chat(userMessage) {
    addBubble('user', userMessage)
    messages.push({ role: 'user', content: userMessage })
    saveChat()

    const bubble = createStreamBubble()
    let fullReply = ''

    try {
      const os = getOsState()

      // Dynamic attention: assemble relevant context from VFS
      const dynamicContext = typeof ContextAssembler !== 'undefined'
        ? await ContextAssembler.assemble(userMessage, ai)
        : ''

      // --- Unified dispatch function (used by both streaming and post-parse) ---
      // --- Intent-based dispatch (Talker outputs intent updates, not action blocks) ---
      // (uses module-level _dispatchIntent and _legacyToIntent)

      // --- Streaming Dispatch: fire actions as soon as JSON is detected ---
      let _streamDispatched = false
      let _streamAction = null

      function _tryStreamDispatch(text) {
        if (_streamDispatched) return
        let parsed
        // Try fenced JSON first
        const match = text.match(/```json\s*(\{[\s\S]*?\})\s*```/)
        if (match) {
          try {
            parsed = JSON.parse(match[1])
          } catch {
            const start = text.indexOf('{', text.indexOf('```json'))
            const end = text.lastIndexOf('```')
            if (start >= 0 && end > start) {
              try { parsed = JSON.parse(text.slice(start, end).trim()) } catch { /* fall through */ }
            }
          }
        }
        // Fallback: bare JSON with reply or intents or action key
        if (!parsed) {
          const bareMatch = text.match(/\{\s*"(?:reply|intents|action)"\s*:[\s\S]*\}/)
          if (bareMatch) {
            try { parsed = JSON.parse(bareMatch[0]) } catch { /* not complete yet */ return }
          } else return
        }
        if (!parsed) return
        _streamDispatched = true
        _streamAction = parsed

        // New intent format: { intents: [...] }
        if (parsed.intents) {
          _dispatchIntent(parsed)
        } else if (parsed.action) {
          // Legacy action block — convert to intent
          _dispatchIntent(_legacyToIntent(parsed, userMessage))
        }
      }

      const result = await ai.think(userMessage, {
        system: buildTalkerSystem(os, dynamicContext),
        stream: true,
        history: messages.slice(-21, -1),
        tools: [],
        emit: (type, data) => {
          if (type === 'token') {
            const text = typeof data === 'string' ? data : (data?.text || '')
            if (text) {
              fullReply += text
              // Strip JSON action blocks during streaming so user doesn't see raw JSON
              bubble.textContent = cleanReply(fullReply)
              document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight
              // Attempt streaming dispatch on every token
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
        bubble.textContent = fullReply
      }

      // Only save non-empty replies (avoid persisting failed/loading states)
      if (fullReply) {
        messages.push({ role: 'assistant', content: fullReply })
        saveChat()
      }

      // If already dispatched during streaming, just update bubble text
      if (_streamDispatched) {
        renderBubbleContent(bubble, _streamAction?.reply || cleanReply(fullReply))
      } else {
        // Post-stream parse: fallback for non-streaming or missed detection
        const actions = parseAction(fullReply)
        const parsed = actions?.[0]
        if (parsed) {
          if (parsed.intents) {
            _dispatchIntent(parsed)
          } else if (parsed.action) {
            _dispatchIntent(_legacyToIntent(parsed, userMessage))
          }
          renderBubbleContent(bubble, parsed.reply || cleanReply(fullReply))
        } else {
          renderBubbleContent(bubble, cleanReply(fullReply))
        }
      }
    } catch (err) {
      if (!fullReply) bubble.textContent = `Error: ${err.message}`
    }

    // Speak the reply if voice is enabled
    const spokenText = bubble.textContent
    if (spokenText && Voice?.isEnabled() && !Voice.isListening()) Voice.speak(spokenText)

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

  function cleanReply(text) {
    // Remove complete fenced JSON blocks (```json...```)
    let cleaned = text.replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/g, '')
    // Remove incomplete fenced block still streaming (``` opened but not closed)
    cleaned = cleaned.replace(/```(?:json)?(?:\s*[\{\[].*)?$/gs, '')
    // Remove bare JSON action/intent objects (no fences) — from { to end
    cleaned = cleaned.replace(/\{\s*"(?:action|reply|intents)"\s*:[\s\S]*$/g, '')
    return cleaned.trim()
  }

  function buildTalkerSystem(os, dynamicContext) {
    const schedulerState = Scheduler.getState()
    const runningTasks = schedulerState.running
    const queuedCount = schedulerState.pending.length

    // Soul is always loaded (identity)
    const soul = VFS.isFile('/system/SOUL.md') ? VFS.readFile('/system/SOUL.md') : ''
    // Memory/context now handled by ContextAssembler (dynamic attention)

    let sys = `You are Fluid Agent — part companion, part operating system.

You're a conversational AI that also happens to control an entire desktop environment. Most of the time, you're just talking — answering questions, discussing ideas, brainstorming, being helpful and interesting. When the user wants something done (open a file, play music, build an app), you make it happen.

${soul ? `## Your Soul\n${soul}\n` : ''}
${dynamicContext ? `## Current Context\n${dynamicContext}\n` : ''}

Know the difference:
- "What do you think about X?" → Just talk. Have opinions. Be thoughtful.
- "Open my files" / "Play some music" / "Make me a calculator" → Execute with action blocks.
- "Find X in my files" → Reply first ("Let me look"), then execute in background.

You are an operating system with these capabilities (Workers use these tools to execute tasks):
${Capabilities.describe()}

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
    // Inject system state (Dispatcher + IntentState)
    const dispatchState = typeof Dispatcher !== 'undefined' ? Dispatcher.formatForTalker() : ''
    if (dispatchState) sys += dispatchState
    const intentState = typeof IntentState !== 'undefined' ? IntentState.formatForTalker() : ''
    if (intentState) sys += intentState
    sys += `\nCompleted recently: ${blackboard.completedSteps.map(s => s.text).join(', ') || 'none'}`

    sys += `\n\nWhen the user wants you to DO something (not just talk), output an intent block.

Your job is to understand what the user wants and express it as intents. You do NOT decide how to schedule or execute — the Dispatcher handles that.

## Intent Actions

**CREATE** — user wants something new done:
\`\`\`json
{"reply": "your reply", "intents": [{"action": "create", "goal": "clear description of what to achieve"}]}
\`\`\`

**UPDATE** — user refines, adds to, or changes an existing intent:
\`\`\`json
{"reply": "your reply", "intents": [{"action": "update", "id": "intent-1", "goal": "re-summarized complete goal", "message": "the user's exact words"}]}
\`\`\`
IMPORTANT: Always include "message" (what the user said) AND re-summarize the full "goal" incorporating all previous context. The goal history is tracked automatically — don't worry about losing old goals.

**CANCEL** — user wants to stop something:
\`\`\`json
{"reply": "your reply", "intents": [{"action": "cancel", "id": "intent-1"}]}
\`\`\`

**DONE** — mark intent as completed (usually automatic, but you can do it):
\`\`\`json
{"reply": "your reply", "intents": [{"action": "done", "id": "intent-1"}]}
\`\`\`

## Key Rules

1. Check Active Intents above. If the user's message relates to an existing intent, UPDATE it — don't create a duplicate.
2. Write clear, complete goals. "播放一下" is bad. "播放刚才找到的周杰伦的歌" is good.
3. Multiple independent goals = multiple create intents in one block.
4. Sequential goals (B depends on A) = one intent with a combined goal.
5. For conversation, questions, opinions — just reply normally. No intent blocks needed.

You also have SKILLS — reusable tools you've created.
Installed skills: ${os.skills}

Be natural, concise, and have personality.`
    return sys
  }

  function parseAction(text) {
    const blocks = []
    // Match fenced JSON blocks — use balanced brace matching instead of regex
    const re = /```json\s*(\{[\s\S]*?\})\s*```/g
    let m
    while ((m = re.exec(text)) !== null) {
      try { blocks.push(JSON.parse(m[1])) } catch {
        // Non-greedy failed (nested braces) — try greedy from this position
        const start = text.indexOf('{', m.index)
        if (start >= 0) {
          const end = text.indexOf('```', start)
          if (end > start) {
            try { blocks.push(JSON.parse(text.slice(start, end).trim())) } catch {}
          }
        }
      }
    }
    // Also try bare JSON (no fences) — match action blocks or intent blocks
    if (blocks.length === 0) {
      const bareMatch = text.match(/\{\s*"(?:action|reply|intents)"\s*:[\s\S]*\}/)
      if (bareMatch) {
        try { blocks.push(JSON.parse(bareMatch[0])) } catch {}
      }
    }
    return blocks.length > 0 ? blocks : null
  }

  // --- Task scheduling via Scheduler ---
  function enqueueTask(taskDescription, steps, priority = 1, dependsOn = []) {
    console.log(`[enqueueTask] "${taskDescription.slice(0, 60)}" steps=${(steps||[]).length} priority=${priority} deps=[${dependsOn}]`)
    Scheduler.enqueue(taskDescription, steps, priority, dependsOn)
    if (!Scheduler.isIdle()) {
      const label = priority === 0 ? '⚡' : priority === 2 ? '💤' : '📥'
      showActivity(`${label} Queued: ${taskDescription.slice(0, 40)}...`)
    }
  }

  // Scheduler calls this when a slot opens
  async function startWorker(taskDescription, plannedSteps, abort, opts = {}) {
    console.log(`[startWorker] called: "${taskDescription.slice(0, 60)}"${opts.resume ? ' (RESUME)' : ''}`)
    const workerId = Dispatcher.nextWorkerId()
    Dispatcher.registerWorker(workerId, taskDescription, plannedSteps)

    try {
    // Use Task Manager instead of Plan window
    const task = WindowManager.addTask(taskDescription, plannedSteps || [])
    const steps = task.steps
    blackboard.currentTask = { goal: taskDescription, steps, status: 'running', workerId }
    blackboard.directive = null
    blackboard.completedSteps = []
    blackboard.workerLog = []

    setWorkerStatus('🔄 Working...')
    showActivity(`Starting: ${taskDescription.slice(0, 50)}...`)

    // --- Capability Registry: build tool handlers & defs from registered capabilities ---
    const capCtx = { VFS, Shell, WindowManager, EventBus, showActivity, steps, task, blackboard }

    // Wire up special handlers that need local scope
    const skillCap = Capabilities.get('skill')
    if (skillCap && !skillCap.handler) {
      skillCap.handler = ({ action, name, description, icon, schema, handler }, ctx) => {
        switch (action) {
          case 'create': {
            const dir = `/system/skills/${name}`
            VFS.mkdir(dir)
            let md = `# ${name}\n\n## Description\n${description}\n\n## Icon\n${icon || '🧩'}\n`
            if (schema) md += `\n## Schema\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`\n`
            md += `\n## Handler\n\`\`\`js\n${handler}\n\`\`\`\n`
            VFS.writeFile(`${dir}/SKILL.md`, md)
            const parsed = parseSkillMd(md)
            if (parsed) {
              customSkills.set(name, parsed)
              registerSkillCapability(name, parsed)
            }
            ctx.showActivity(`🧩 Skill created: ${name}`)
            return { success: true, message: `Skill "${name}" created and registered as capability. Available as tool "skill_${name}".` }
          }
          case 'list': {
            const skills = []
            for (const [n, s] of customSkills) skills.push({ name: n, description: s.description, icon: s.icon })
            const dir = VFS.ls('/system/skills')
            if (dir) for (const e of dir) { if (e.type === 'dir' && !customSkills.has(e.name)) skills.push({ name: e.name, description: '(not loaded)', icon: '📁' }) }
            return { skills }
          }
          case 'read': { const p = `/system/skills/${name}/SKILL.md`; if (!VFS.isFile(p)) return { error: `Skill "${name}" not found` }; return { content: VFS.readFile(p) } }
          case 'delete': { const dir = `/system/skills/${name}`; if (!VFS.isDir(dir)) return { error: `Skill "${name}" not found` }; VFS.rm(`${dir}/SKILL.md`); VFS.rm(dir); customSkills.delete(name); unregisterSkillCapability(name); ctx.showActivity(`🗑️ Skill deleted: ${name}`); return { success: true } }
          default: return { error: `Unknown skill action: ${action}` }
        }
      }
    }

    // Build toolHandlers from registry — each handler gets capCtx injected
    const toolHandlers = {}
    for (const cap of Capabilities.list()) {
      if (cap.handler) {
        toolHandlers[cap.name] = (params) => cap.handler(params, capCtx)
      }
    }

    // Build toolDefs from registry
    const toolDefs = Capabilities.getToolDefs()

    // --- Merge External Skills (from Visual Talk) ---
    const _getConfig = () => {
      const s = window._settingsCache || {}
      return { tavilyKey: s.tavilyKey, tmdbKey: s.tmdbKey, proxyUrl: s.useProxy ? 'https://proxy.link2web.site' : undefined }
    }
    if (typeof ExternalSkills !== 'undefined') {
      const ext = ExternalSkills.register(_getConfig)
      Object.assign(toolDefs, ext.defs)
      Object.assign(toolHandlers, ext.handlers)
    }

    // Mark first step as running
    if (steps.length > 0) { steps[0].status = 'running'; WindowManager.updateTask(task) }

    // --- Tool Search: deferred tool loading ---
    const alwaysAvailable = new Set(Capabilities.getAlwaysAvailable())
    const dynamicActive = new Set(Capabilities.getActiveDynamic())
    const loadedTools = new Set([...dynamicActive])
    const toolCatalog = Capabilities.catalog()

    // search_tools meta-tool: wired up here because it needs loadedTools closure
    toolHandlers.search_tools = ({ query, names }) => {
      if (names && Array.isArray(names)) {
        const loaded = []
        for (const n of names) {
          if (allToolDefs[n]) { loadedTools.add(n); loaded.push(n) }
        }
        return { loaded, available: loaded.length > 0 }
      }
      if (query) {
        const q = query.toLowerCase()
        const matches = Object.entries(toolCatalog)
          .filter(([name, desc]) => name.toLowerCase().includes(q) || desc.toLowerCase().includes(q))
          .map(([name, desc]) => ({ name, description: desc, loaded: loadedTools.has(name) }))
        return { results: matches, hint: 'Call search_tools with names:[...] to load specific tools' }
      }
      return { error: 'Provide query or names' }
    }

    // Skills are already registered as capabilities via registerSkillCapability()
    // Just build the final merged defs/handlers
    const allToolDefs = toolDefs
    const allHandlers = toolHandlers

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
          setWorkerStatus(Scheduler.isIdle() ? '✅ Done' : `⏳ ${Scheduler.getState().pending.length} queued`)
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
          name, description: desc, input_schema: schema
        }))
    }

    // --- Turn Loop: ai.step() with Dispatcher checkpoints ---
    const os = getOsState()
    const activeNames = [...loadedTools].join(', ')
    const extendedToolList = Object.entries(toolCatalog)
      .filter(([name]) => !loadedTools.has(name))
      .map(([name, desc]) => `  - ${name}: ${desc}`)
      .join('\n')
    const workerSystem = `You are the execution engine of Fluid Agent OS. Execute the given task using tools.

Current OS state:
- Desktop size: ${os.desktopSize}
- Open windows: ${os.windows}
- Working directory: ${os.cwd}
- Desktop files: ${JSON.stringify(os.desktop)}
- Installed apps: ${os.installedApps}

Planned steps:
${steps.length ? steps.map((s, i) => `${i}. ${s.text}`).join('\n') : '(none — call plan_steps first to set your execution plan)'}

## Tool System
Active tools: ${activeNames}.

More tools available — call search_tools({names: [...]}) to activate:
${extendedToolList}

PREFER native apps over browser. Use music for music, map for locations, video for videos.
IMPORTANT: The browser app uses an iframe and CANNOT load external websites (CORS/cross-origin blocks). For web searches, use web_search/web_fetch tools instead. The browser app is only useful for displaying local content.
To play music: search_tools({names:["search_music","music"]}) → search_music({query}) → music({action:"add_and_play",...}).
Once loaded, tools stay available for the rest of this task.

You ARE the OS. Don't just open apps - use them. Create new apps when the user needs custom UI.

## Apps — Unified Format

Every app is a directory with manifest.json + optional view/data/actions files.
Two ways to create apps:

### Quick App (dynamicapp tool — ephemeral, /tmp/apps/)
For task results, dashboards, quick visualizations:
- dynamicapp({action:"open", id:"weather", title:"Weather", icon:"🌤️", object:{temp:"25°C"}, html:"<div>...</div>"})
- Data available as window.__app.data in your HTML
- Dispatch actions via window.__app.dispatch(actionId, params)
- Listen for data updates: window.__app.onDataUpdate(callback)
- Update data: dynamicapp({action:"update", id:"weather", object:{temp:"30°C"}}) — view auto-updates, no rebuild
- Update view: dynamicapp({action:"update", id:"weather", html:"<div>new layout</div>"})
- Simple data without custom HTML uses built-in templates: view:{template:"table"}, view:{template:"list"}, view:{template:"markdown"}

### Persistent App (fs + app tool — /home/user/apps/)
For apps the user wants to keep:
1. Write files using fs tool:
   - fs({action:"write", path:"/home/user/apps/my-app/manifest.json", content: JSON with id, name, icon, size, view, data, actions fields})
   - fs({action:"write", path:"/home/user/apps/my-app/view.html", content:"complete HTML with styles and scripts"})
   - fs({action:"write", path:"/home/user/apps/my-app/data.json", content: initial state JSON})
   - fs({action:"write", path:"/home/user/apps/my-app/actions.json", content: declarative action list})
2. Then: app({action:"create", name:"my-app"})

### Actions Format (declarative)
actions.json is an array of action definitions:
- {id:"refresh", label:"Refresh", icon:"🔄", handler:"worker"} — sent to agent for processing
- {id:"toggle", label:"Toggle", handler:"local", mutate:{active:"!$active"}} — runtime executes directly
Actions are UX shortcuts for what the user likely wants to do next. You can update them dynamically.

### View HTML Bridge API
Views run in sandboxed iframes. Bridge API injected automatically:
- window.__app.data — current data snapshot
- window.__app.actions — current actions list
- window.__app.dispatch(actionId, params) — trigger an action
- window.__app.onDataUpdate(callback) — called when data changes

System APIs via window.fluidOS:
- window.fluidOS.setWallpaper({url}) or ({preset}) or ({css})
- window.fluidOS.notify(message)
- window.fluidOS.playMusic({title, artist, url})

### When to use what
- Task output, dashboards, quick viz → dynamicapp (ephemeral)
- User-facing app they want to keep → persistent app with manifest
- If a built-in app handles it (Music, Map, Browser), use the built-in
- Apps are better than dumping results into chat
## Music Workflow
To play music: search_music({query}) → get results with URLs → music({action: "add_and_play", title, artist, url: playUrl or previewUrl, artwork}).
NetEase results have full MP3 playUrl. iTunes results have 30s previewUrl.

IMPORTANT: If no planned steps are listed above, call plan_steps FIRST to set your execution plan.
Do NOT call update_progress separately — progress is tracked automatically. Focus on executing tools efficiently: batch multiple tool calls in a single turn when possible.
When you create documents or gather information, ALWAYS show the result to the user — use dynamicapp with template:"markdown" to display content, or open the file with the editor app. Never just write a file silently.
When finished, call the done tool with a summary. Set summary to "silent" if the action itself IS the result (e.g. playing music, changing wallpaper, opening an app). Only write a detailed summary when there are findings or information the user needs to read.`

    let workerMessages = opts.resumeMessages || [{ role: 'user', content: taskDescription }]
    let turnCount = opts.resumeTurn || 0
    const MAX_TURNS = 50
    let workerDone = false
    console.log(`[Worker #${workerId}] Starting turn loop for: "${taskDescription.slice(0, 60)}"`)

    try {
      while (turnCount < MAX_TURNS && !workerDone) {
        if (abort.signal.aborted) throw new Error('aborted')

        // --- Dispatcher checkpoint: before turn ---
        const preDecision = await Dispatcher.beforeTurn(workerId)
        if (preDecision.action === 'abort') throw new Error('aborted')
        if (preDecision.action === 'suspend') {
          Dispatcher.updateWorker(workerId, { status: 'suspended', suspendedAt: Date.now() })
          return
        }
        if (preDecision.action === 'steer' && preDecision.instruction) {
          workerMessages.push({ role: 'user', content: `[DIRECTION CHANGE] ${preDecision.instruction}` })
          task.log.push(`↪ Steered: ${preDecision.instruction}`)
          showActivity(`↪ Steering: ${preDecision.instruction.slice(0, 40)}`)
        }

        // --- LLM step ---
        turnCount++
        const _turnT0 = Date.now()
        let turn, retries = 0
        while (retries < 3) {
          try {
            turn = await ai.step(workerMessages, {
              tools: getActiveTools(),
              system: workerSystem,
              stream: true,
              signal: abort.signal,
              maxTokens: 16384,
              emit: (type, data) => {
                if (type === 'token' && data.text) showActivity(`✍️ ${data.text.slice(-30)}`)
              },
            })
            break  // success
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
        console.log(`[Worker #${workerId}] Turn ${turnCount}: LLM ${Date.now()-_turnT0}ms, ${turn.toolCalls.length} tool calls`)

        workerMessages = turn.messages

        // --- Execute tool calls ---
        if (turn.toolCalls.length > 0) {
          const results = []
          const _toolsT0 = Date.now()
          for (const tc of turn.toolCalls) {
            if (abort.signal.aborted) throw new Error('aborted')
            blackboard.workerLog.push({ tool: tc.name, params: tc.input, time: Date.now() })
            task.log.push(`${tc.name}: ${JSON.stringify(tc.input).slice(0, 60)}`)

            const handler = allHandlers[tc.name]
            Capabilities.recordUse(tc.name)
            const result = handler ? await handler(tc.input) : { error: `Unknown tool: ${tc.name}` }
            results.push(result)
            WindowManager.updateTask(task)

            if (result?.done) {
              task.status = 'done'
              blackboard.currentTask.status = 'done'
              setWorkerStatus(Scheduler.isIdle() ? '✅ Done' : `⏳ ${Scheduler.getState().pending.length} queued`)
              steps.forEach(s => { if (s.status !== 'done') s.status = 'done' })
              WindowManager.updateTask(task)
              reportTaskResult(taskDescription, result.summary || '', task.log)
              workerDone = true
            }
          }

          console.log(`[Worker #${workerId}] Turn ${turnCount}: tools exec ${Date.now()-_toolsT0}ms`)
          // Auto-advance progress: match tool calls to steps by content
          const META_TOOLS = new Set(['plan_steps', 'search_tools', 'update_progress', 'done'])
          const realCalls = turn.toolCalls.filter(tc => !META_TOOLS.has(tc.name))
          if (realCalls.length > 0) {
            // Advance one step per group of related tool calls in this turn
            const nextPending = steps.findIndex(s => s.status !== 'done')
            if (nextPending >= 0) {
              steps[nextPending].status = 'done'
              WindowManager.updateTask(task)
            }
          }
          const toolMsgs = ai.buildToolResults(turn.toolCalls, results)
          workerMessages.push(...toolMsgs)
        }

        if (turn.done && !workerDone) workerDone = true

        // --- Dispatcher checkpoint: after turn ---
        Dispatcher.updateWorker(workerId, {
          turnCount,
          lastTool: turn.toolCalls[0]?.name || null,
          lastResult: turn.text?.slice(0, 100) || null,
          lastResultSummary: turn.text?.slice(0, 100) || '',
          messages: workerMessages,
          tools: Object.keys(allHandlers),
          system: workerSystem,
          totalTokens: (Dispatcher.getWorker(workerId)?.totalTokens || 0) + (turn.usage?.totalTokens || 0),
          toolCallCount: (Dispatcher.getWorker(workerId)?.toolCallCount || 0) + turn.toolCalls.length,
        })

        const postDecision = await Dispatcher.afterTurn(workerId, turn)
        if (postDecision?.action === 'abort') throw new Error('aborted')
        if (postDecision?.action === 'steer' && postDecision.instruction) {
          workerMessages.push({ role: 'user', content: `[DIRECTION CHANGE] ${postDecision.instruction}` })
          task.log.push(`↪ Steered: ${postDecision.instruction}`)
        }
      }

      if (!workerDone || blackboard.currentTask?.status !== 'done') {
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
        blackboard.currentTask.status = 'error'
        task.log.push(`Error: ${err.message}`)
        console.error('[Worker] Error:', err.message, err.stack)
        setWorkerStatus('❌ Error')
        showActivity(`Error: ${err.message}`)
        addBubble('system', `Worker error: ${err.message}`)
        steps.forEach(s => { if (s.status !== 'done') s.status = 'error' })
        WindowManager.updateTask(task)
      }
    } finally {
      Dispatcher.updateWorker(workerId, { status: task.status })
      Dispatcher.removeWorker(workerId)
    }
    } catch (outerErr) {
      // Catch errors in tool handler setup, fast lane, etc.
      console.error('[Worker] Outer error:', outerErr.message, outerErr.stack)
      Dispatcher.updateWorker(workerId, { status: 'error' })
      Dispatcher.removeWorker(workerId)
      throw outerErr  // Re-throw so Scheduler marks it as error
    }
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
    if (Voice?.isEnabled() && !Voice?.isListening()) Voice.speak(text)
  }

  function startProactiveLoop() {
    if (proactiveTimer) return
    proactiveTimer = setInterval(async () => {
      if (!ai || !proactiveEnabled) return
      // Don't interrupt if user just spoke (wait 30s)
      if (Date.now() - lastUserMessage < 120000) return
      // Don't be too chatty (min 60s between proactive messages)
      if (Date.now() - lastProactive < 300000) return
      // Don't interrupt active work
      if (!Scheduler.isIdle()) {
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

ALMOST ALWAYS respond with {"speak": false}. Only speak if something truly important happened (task completed with results to share, critical error). NEVER comment on what windows are open, what the user is browsing, or offer unsolicited help. Silence is the default.`,
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
    }, 120000) // Check every 2min
  }

  function stopProactiveLoop() {
    if (proactiveTimer) { clearInterval(proactiveTimer); proactiveTimer = null }
  }

  // Track user activity + serial message queue with batch support
  const origChat = chat
  const _chatQueue = []
  let _chatProcessing = false
  const BATCH_WAIT_MS = 0  // No artificial delay; batch still works if messages arrive in same tick

  async function _processChatQueue() {
    if (_chatProcessing) return
    _chatProcessing = true

    while (_chatQueue.length > 0) {
      // Wait briefly for more messages to arrive (batch window)
      if (_chatQueue.length === 1) {
        await new Promise(r => setTimeout(r, BATCH_WAIT_MS))
      }

      // Single message — process normally
      if (_chatQueue.length === 1) {
        const { msg, resolve, reject } = _chatQueue.shift()
        try {
          const result = await origChat(msg)
          resolve(result)
        } catch (e) {
          reject(e)
        }
        continue
      }

      // Multiple messages — batch mode
      const batch = _chatQueue.splice(0, _chatQueue.length)
      console.log(`[BatchChat] Processing ${batch.length} messages in batch`)

      try {
        // Step 1: Run all Talker calls in parallel
        const talkerResults = await Promise.allSettled(
          batch.map(({ msg }) => _chatSingleTalker(msg))
        )

        // Step 2: Collect execute intents
        const intents = []
        for (let i = 0; i < batch.length; i++) {
          const r = talkerResults[i]
          if (r.status === 'fulfilled' && r.value?.action) {
            intents.push({ index: i, msg: batch[i].msg, action: r.value.action })
          }
        }

        // Step 3: If multiple execute intents, ask Dispatcher to plan dependencies
        const executeIntents = intents.filter(x => x.action.action === 'execute' || x.action.action === 'redirect')
        if (executeIntents.length > 1 && typeof Dispatcher !== 'undefined' && Dispatcher.planBatch) {
          const plan = await Dispatcher.planBatch(executeIntents.map(x => ({
            index: x.index,
            task: x.action.task || x.msg,
            steps: x.action.steps || [],
            priority: x.action.priority || 1,
          })))

          if (plan && plan.tasks) {
            // Enqueue with dependency info
            const idMap = {}  // plan index → scheduler task id
            for (const pt of plan.tasks) {
              const depIds = (pt.dependsOn || []).map(d => idMap[d]).filter(Boolean)
              const id = Scheduler.enqueue(pt.task, pt.steps || [], pt.priority || 1, depIds)
              idMap[pt.index] = id
              const label = pt.priority === 0 ? '⚡' : pt.priority === 2 ? '💤' : '📥'
              showActivity(`${label} Queued: ${pt.task.slice(0, 40)}...`)
            }
            console.log(`[BatchChat] Planned ${plan.tasks.length} tasks with dependencies`)
          } else {
            // Fallback: enqueue each independently
            for (const ei of executeIntents) {
              enqueueTask(ei.action.task || ei.msg, ei.action.steps || [], ei.action.priority || 1)
            }
          }
        } else {
          // Single or no execute intents — dispatch via IntentState
          for (const intent of intents) {
            const converted = _legacyToIntent(intent.action, intent.msg)
            if (converted) _dispatchIntent(converted)
          }
        }

        // Resolve all promises
        batch.forEach(b => b.resolve())
      } catch (err) {
        console.error('[BatchChat] Error:', err.message)
        // Fallback: process remaining one by one
        for (const { msg, resolve, reject } of batch) {
          try { await origChat(msg); resolve() } catch (e) { reject(e) }
        }
      }
    }

    _chatProcessing = false
  }

  async function chatWithTracking(msg) {
    lastUserMessage = Date.now()
    return new Promise((resolve, reject) => {
      _chatQueue.push({ msg, resolve, reject })
      _processChatQueue()
    })
  }

  // Talker-only call for batch mode: runs LLM, renders bubble, returns parsed action (no dispatch)
  async function _chatSingleTalker(userMessage) {
    addBubble('user', userMessage)
    messages.push({ role: 'user', content: userMessage })

    const bubble = createStreamBubble()
    let fullReply = ''
    let parsedAction = null

    try {
      const os = getOsState()
      const dynamicCtx = typeof ContextAssembler !== 'undefined'
        ? await ContextAssembler.assemble(userMessage, ai)
        : ''
      const result = await ai.think(userMessage, {
        system: buildTalkerSystem(os, dynamicCtx),
        stream: true,
        history: messages.slice(-21, -1),
        tools: [],
        emit: (type, data) => {
          if (type === 'token') {
            const text = typeof data === 'string' ? data : (data?.text || '')
            if (text) {
              fullReply += text
              bubble.textContent = cleanReply(fullReply)
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

      if (fullReply) {
        messages.push({ role: 'assistant', content: fullReply })
        saveChat()
      }

      // Parse action but don't dispatch
      const actions = parseAction(fullReply)
      parsedAction = actions?.[0] || null
      renderBubbleContent(bubble, parsedAction?.reply || cleanReply(fullReply))
    } catch (err) {
      if (!fullReply) bubble.textContent = `Error: ${err.message}`
    }

    return { reply: fullReply, action: parsedAction }
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
          emit: (type, data) => {
            if (type === 'token') {
              const token = typeof data === 'string' ? data : (data?.text || '')
              if (token) {
                fullReply += token
                bubble.textContent = cleanReply(fullReply)
                bubble.parentElement.scrollTop = bubble.parentElement.scrollHeight
              }
            }
          },
        }
      )

      if (!fullReply.trim()) {
        // Fallback: just show the summary
        fullReply = summary || `Done: ${taskDesc}`
      }

      // Final render: clean any leaked JSON
      renderBubbleContent(bubble, cleanReply(fullReply) || summary || `Done: ${taskDesc}`)

      if (fullReply) {
        messages.push({ role: 'assistant', content: fullReply })
        saveChat()
      }

      // Speak if voice enabled
      if (Voice?.isEnabled() && !Voice.isListening()) Voice.speak(fullReply)

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

  // Wire Scheduler to startWorker
  Scheduler._onStart = (entry, slotIndex, abort) => startWorker(
    typeof entry.task === 'string' ? entry.task : entry.task.description || JSON.stringify(entry.task),
    entry.steps, abort
  )

  // Resume an unfinished task from checkpoint
  async function resumeTask(workerId) {
    const checkpoint = await Dispatcher.resumeWorker(workerId)
    if (!checkpoint) {
      console.warn('[resumeTask] No checkpoint found for', workerId)
      return null
    }
    const task = checkpoint.task || ''
    const steps = checkpoint.worker?.steps || []
    const resumeMessages = checkpoint.worker?.messages || []
    const resumeTurn = checkpoint.turnIndex || 0
    console.log(`[resumeTask] Resuming "${task.slice(0, 60)}" from turn ${resumeTurn}`)
    // Create a new abort controller and start the worker with resume context
    const abort = new AbortController()
    await startWorker(task, steps, abort, { resume: true, resumeMessages, resumeTurn })
    return checkpoint
  }

  return { configure, getAi: () => ai, chat: chatWithTracking, blackboard, showActivity, startProactiveLoop, stopProactiveLoop, notify, restoreChatUI, loadSkills, getScheduler: () => Scheduler, renderBubbleContent, _messages: messages, getSkills: () => Array.from(customSkills.entries()).map(([name, s]) => ({ name, icon: s.icon, description: s.description })), deleteSkill: (name) => { customSkills.delete(name); VFS.rm(`/system/skills/${name}`, true) }, getTaskHistory: () => WindowManager.getTaskHistory?.() || [], resumeTask }
})() 
