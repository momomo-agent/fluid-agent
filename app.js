/* app.js — Bootstrap and wire everything together */
;(function() {
  'use strict'

  // Always boot the OS immediately — no modal gate
  boot()

  async function boot() {
    // Create store first — independent of AI
    const store = await AgenticStore.createStore('fluid-os')

    // Migrate settings from localStorage to store (one-time)
    let settings = await store.get('settings')
    if (!settings) {
      const lsSettings = localStorage.getItem('fluid-settings')
      if (lsSettings) {
        settings = JSON.parse(lsSettings)
        await store.set('settings', settings)
      } else {
        settings = {}
      }
    }

    // Make store and settings globally accessible
    window._store = store
    window._settingsCache = settings

    const provider = settings.provider || ''
    const apiKey = settings.apiKey || ''
    const model = settings.model || ''
    const baseUrl = settings.baseUrl || ''

    // Configure agent if we have credentials
    const hasKey = !!(provider && apiKey)
    if (hasKey) {
      Agent.configure(provider, apiKey, model, baseUrl, store)
    }

    // Init persistence — store is independent of AI
    await VFS.init(store)
    await WindowManager.loadApps(store)
    if (hasKey) await Agent.loadSkills()

    document.getElementById('app').style.display = 'flex'

    // Start proactive awareness loop (only if configured)
    if (hasKey) Agent.startProactiveLoop()

    // Restore previous session or open defaults
    let restored = false
    restored = await WindowManager.restoreSession(store)
    if (!restored) {
      WindowManager.openFinder('/home/user/Desktop')
    }

    // No API key? Open Settings so user can configure
    if (!hasKey) {
      WindowManager.openSettings()
    }

    // Restore previous chat or show welcome
    const container = document.getElementById('chat-messages')
    if (hasKey) await Agent.restoreChatUI()
    if (container.children.length === 0) {
      const bubble = document.createElement('div')
      bubble.className = 'chat-bubble agent'
      bubble.textContent = hasKey
        ? "Hey! I'm Fluid Agent — part companion, part OS. Ask me anything, or tell me to do something."
        : "Welcome to Fluid Agent OS! Open Settings to add your API key and get started."
      container.appendChild(bubble)
    }

    // Wire chat input
    const chatInput = document.getElementById('chat-input')
    const chatSend = document.getElementById('chat-send')
    let isComposing = false
    chatInput.addEventListener('compositionstart', () => { isComposing = true })
    chatInput.addEventListener('compositionend', () => { isComposing = false })

    function sendMessage() {
      const text = chatInput.value.trim()
      if (!text) return
      chatInput.value = ''
      chatInput.style.height = 'auto'
      Agent.chat(text)
    }

    chatSend.addEventListener('click', sendMessage)
    chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
        e.preventDefault()
        sendMessage()
      }
    })

    // Auto-resize textarea
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto'
      chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px'
    })

    // Dock clicks (pinned apps)
    document.querySelectorAll('.dock-pinned .dock-item').forEach(item => {
      item.addEventListener('click', () => {
        const app = item.dataset.app
        switch (app) {
          case 'finder': WindowManager.openFinder('/home/user'); break
          case 'terminal': WindowManager.openTerminal(); break
          case 'music': WindowManager.openMusic(); break
          case 'browser': WindowManager.openBrowser(); break
          case 'map': WindowManager.openMap(); break
          case 'video': WindowManager.openVideo(); break
          case 'settings': WindowManager.openSettings(); break
          case 'spotlight': openSpotlight(); break
        }
      })
    })

    // Load settings and apply voice
    if (settings.voice) Voice.enable()
    else Voice.disable()

    // --- Clock (date + time) ---
    const clockEl = document.getElementById('clock')
    function updateClock() {
      const now = new Date()
      const date = now.toLocaleDateString([], { month: 'short', day: 'numeric', weekday: 'short' })
      const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      clockEl.textContent = `${date}  ${time}`
    }
    updateClock()
    setInterval(updateClock, 30000)

    // --- Task status in header ---
    const taskStatusEl = document.getElementById('task-status')
    const taskHoverPanel = document.getElementById('task-hover-panel')
    const taskStatusWrap = document.getElementById('task-status-wrap')
    let hoverTimeout = null

    taskStatusWrap.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimeout)
      updateTaskHoverPanel()
      taskHoverPanel.classList.remove('hidden')
    })
    taskStatusWrap.addEventListener('mouseleave', () => {
      hoverTimeout = setTimeout(() => taskHoverPanel.classList.add('hidden'), 200)
    })
    taskHoverPanel.addEventListener('mouseenter', () => clearTimeout(hoverTimeout))
    taskHoverPanel.addEventListener('mouseleave', () => {
      hoverTimeout = setTimeout(() => taskHoverPanel.classList.add('hidden'), 200)
    })

    function updateTaskHoverPanel() {
      const bb = Agent.blackboard
      const ct = bb.currentTask
      const queued = Agent.getTaskQueue ? Agent.getTaskQueue() : []
      let html = '<div class="thp-title">Tasks</div>'

      if (ct && ct.status === 'running') {
        const steps = ct.steps || []
        html += '<div class="thp-task active">'
        html += `<div class="thp-task-name">${ct.goal || 'Working...'}</div>`
        if (steps.length > 0) {
          html += '<div class="thp-steps">'
          steps.forEach(s => {
            const cls = s.status === 'done' ? 'done' : s.status === 'running' ? 'running' : 'pending'
            html += `<div class="thp-step ${cls}">${s.text || s}</div>`
          })
          html += '</div>'
        }
        html += '</div>'
      }

      if (queued.length > 0) {
        html += `<div class="thp-queue">${queued.length} task${queued.length > 1 ? 's' : ''} queued</div>`
        queued.forEach(q => {
          html += `<div class="thp-task"><div class="thp-task-name">${q.taskDescription?.slice(0, 60) || 'Queued'}</div></div>`
        })
      }

      if (!ct?.status?.match?.(/running/) && queued.length === 0) {
        html += '<div class="thp-empty">No active tasks</div>'
      }

      taskHoverPanel.innerHTML = html
    }

    setInterval(() => {
      const bb = Agent.blackboard
      if (bb.currentTask && bb.currentTask.status === 'running') {
        const goal = bb.currentTask.goal?.slice(0, 30) || 'Working...'
        const steps = bb.currentTask.steps || []
        const doneCount = steps.filter(s => s.status === 'done').length
        const total = steps.length
        const queued = Agent.getTaskQueue ? Agent.getTaskQueue().length : 0
        const queueText = queued > 0 ? ` · +${queued}` : ''
        const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0
        const progressBar = total > 0 ? `<div class="task-progress"><div class="task-progress-fill" style="width:${pct}%"></div></div>` : ''
        const stepText = total > 0 ? `${doneCount}/${total}` : ''
        taskStatusEl.innerHTML = `<div class="spinner"></div> ${goal} ${stepText}${queueText} ${progressBar}`
      } else {
        taskStatusEl.innerHTML = ''
      }
      // Update hover panel if visible
      if (!taskHoverPanel.classList.contains('hidden')) updateTaskHoverPanel()
    }, 1000)

    // --- Keyboard shortcuts ---
    const spotlight = document.getElementById('spotlight')
    const spotInput = document.getElementById('spotlight-input')
    const spotResults = document.getElementById('spotlight-results')
    let spotOpen = false
    let spotSelected = -1

    function openSpotlight() {
      spotlight.classList.remove('hidden')
      spotInput.value = ''
      spotResults.innerHTML = ''
      spotInput.focus()
      spotOpen = true
      spotSelected = -1
    }

    function closeSpotlight() {
      spotlight.classList.add('hidden')
      spotOpen = false
    }

    function searchSpotlight(query) {
      spotResults.innerHTML = ''
      spotSelected = -1
      if (!query.trim()) return
      const q = query.toLowerCase()
      const items = []

      // Search files
      const files = VFS.find('/home/user', '')
      files.forEach(f => {
        const name = f.split('/').pop()
        if (name.toLowerCase().includes(q)) {
          items.push({ icon: VFS.isDir(f) ? '📁' : '📄', label: name, hint: f, action: () => {
            if (VFS.isFile(f)) WindowManager.openEditor(f)
            else WindowManager.openFinder(f)
          }})
        }
      })

      // Search installed apps
      const apps = WindowManager.getInstalledApps()
      apps.forEach(app => {
        if (app.name.toLowerCase().includes(q)) {
          items.push({ icon: app.icon, label: app.name, hint: 'App', action: () => WindowManager.openApp(app.name) })
        }
      })

      // Built-in apps
      const builtins = [
        { icon: '📁', name: 'Finder', action: () => WindowManager.openFinder() },
        { icon: '⬛', name: 'Terminal', action: () => WindowManager.openTerminal() },
        { icon: '🌐', name: 'Browser', action: () => WindowManager.openBrowser('https://example.com') },
        { icon: '⚙️', name: 'Settings', action: () => WindowManager.openSettings() },
      ]
      builtins.forEach(b => {
        if (b.name.toLowerCase().includes(q)) {
          items.push({ icon: b.icon, label: b.name, hint: 'System', action: b.action })
        }
      })

      // Always add "Ask agent" option
      items.push({ icon: '✨', label: `Ask: "${query}"`, hint: 'Chat with agent', action: () => Agent.chat(query) })

      // Render (max 8)
      items.slice(0, 8).forEach((item, i) => {
        const el = document.createElement('div')
        el.className = 'spotlight-item'
        el.innerHTML = `<span class="spot-icon">${item.icon}</span><span class="spot-label">${item.label}</span><span class="spot-hint">${item.hint || ''}</span>`
        el.addEventListener('click', () => { closeSpotlight(); item.action() })
        spotResults.appendChild(el)
      })
    }

    spotInput.addEventListener('input', () => searchSpotlight(spotInput.value))
    spotInput.addEventListener('keydown', (e) => {
      const items = spotResults.querySelectorAll('.spotlight-item')
      if (e.key === 'Escape') { closeSpotlight(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); spotSelected = Math.min(spotSelected + 1, items.length - 1) }
      if (e.key === 'ArrowUp') { e.preventDefault(); spotSelected = Math.max(spotSelected - 1, 0) }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (spotSelected >= 0 && items[spotSelected]) items[spotSelected].click()
        else if (items.length > 0) items[0].click()
        return
      }
      items.forEach((el, i) => el.classList.toggle('selected', i === spotSelected))
    })

    // Close spotlight on outside click
    document.addEventListener('mousedown', (e) => {
      if (spotOpen && !spotlight.contains(e.target)) closeSpotlight()
    })

    document.addEventListener('keydown', (e) => {
      // Cmd/Ctrl+Space → Spotlight
      if ((e.metaKey || e.ctrlKey) && e.code === 'Space') {
        e.preventDefault()
        if (spotOpen) closeSpotlight()
        else openSpotlight()
        return
      }
      // Cmd/Ctrl+K → focus chat input
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        document.getElementById('chat-input')?.focus()
      }
      // Escape → close spotlight first, then focused window
      if (e.key === 'Escape' && !spotOpen) {
        const focused = WindowManager.getFocused()
        if (focused) WindowManager.close(focused)
      }
      // Cmd/Ctrl+N → new file
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        Agent.chat('Create a new file on the Desktop')
      }
    })

    // --- Context menu ---
    let activeMenu = null
    function showContextMenu(x, y, items) {
      if (activeMenu) activeMenu.remove()
      const menu = document.createElement('div')
      menu.className = 'context-menu'
      items.forEach(item => {
        if (item === '---') {
          const sep = document.createElement('div')
          sep.className = 'context-menu-sep'
          menu.appendChild(sep)
          return
        }
        const el = document.createElement('div')
        el.className = 'context-menu-item'
        el.textContent = `${item.icon || ''} ${item.label}`
        el.addEventListener('click', () => { menu.remove(); activeMenu = null; item.action() })
        menu.appendChild(el)
      })
      menu.style.left = Math.min(x, window.innerWidth - 180) + 'px'
      menu.style.top = Math.min(y, window.innerHeight - 200) + 'px'
      document.body.appendChild(menu)
      activeMenu = menu
    }
    document.addEventListener('click', () => { if (activeMenu) { activeMenu.remove(); activeMenu = null } })

    // Desktop right-click
    document.getElementById('desktop-area').addEventListener('contextmenu', (e) => {
      e.preventDefault()
      showContextMenu(e.clientX, e.clientY, [
        { icon: '📄', label: 'New File', action: () => Agent.chat('Create a new text file on the Desktop') },
        { icon: '📁', label: 'New Folder', action: () => Agent.chat('Create a new folder on the Desktop') },
        '---',
        { icon: '💻', label: 'Open Terminal', action: () => WindowManager.openTerminal() },
        { icon: '🌐', label: 'Open Browser', action: () => WindowManager.openBrowser('https://example.com') },
        '---',
        { icon: '🧹', label: 'Clean Desktop', action: () => Agent.chat('Organize and clean up my Desktop') },
        { icon: '⚙️', label: 'Settings', action: () => WindowManager.openSettings() },
      ])
    })

    // --- Window snapping ---
    const desktopArea = document.getElementById('desktop-area')
    let snapPreview = null

    function getSnapZone(x, y) {
      const rect = desktopArea.getBoundingClientRect()
      const margin = 20
      if (x - rect.left < margin) return 'left'
      if (rect.right - x < margin) return 'right'
      if (y - rect.top < margin) return 'top'
      return null
    }

    // Expose snap helpers for windows.js drag handler
    window._snapHelpers = {
      getSnapZone,
      showSnapPreview(zone) {
        if (!snapPreview) {
          snapPreview = document.createElement('div')
          snapPreview.className = 'snap-preview'
          desktopArea.appendChild(snapPreview)
        }
        const rect = desktopArea.getBoundingClientRect()
        const w = rect.width, h = rect.height
        if (zone === 'left') Object.assign(snapPreview.style, { left: '0', top: '0', width: w/2+'px', height: h+'px', display: 'block' })
        else if (zone === 'right') Object.assign(snapPreview.style, { left: w/2+'px', top: '0', width: w/2+'px', height: h+'px', display: 'block' })
        else if (zone === 'top') Object.assign(snapPreview.style, { left: '0', top: '0', width: w+'px', height: h+'px', display: 'block' })
        else if (snapPreview) snapPreview.style.display = 'none'
      },
      hideSnapPreview() { if (snapPreview) snapPreview.style.display = 'none' },
      applySnap(zone, winEl) {
        const rect = desktopArea.getBoundingClientRect()
        const w = rect.width, h = rect.height
        if (zone === 'left') Object.assign(winEl.style, { left: '0', top: '0', width: w/2+'px', height: h+'px' })
        else if (zone === 'right') Object.assign(winEl.style, { left: w/2+'px', top: '0', width: w/2+'px', height: h+'px' })
        else if (zone === 'top') Object.assign(winEl.style, { left: '0', top: '0', width: w+'px', height: h+'px' })
      }
    }

    // --- Mic button (push-to-talk) ---
    const micBtn = document.getElementById('mic-btn')
    if (micBtn) {
      let micActive = false
      micBtn.addEventListener('mousedown', () => {
        micActive = true
        micBtn.classList.add('active')
        Voice.startListening()
      })
      const stopMic = () => {
        if (micActive) {
          micActive = false
          micBtn.classList.remove('active')
          Voice.stopListening()
        }
      }
      micBtn.addEventListener('mouseup', stopMic)
      micBtn.addEventListener('mouseleave', stopMic)
    }

    // --- Notifications go straight to chat ---
    const origNotify = Agent.notify
    Agent.notify = function(text, type) {
      origNotify.call(Agent, text, type)
      // Post as agent message in chat
      const container = document.getElementById('chat-messages')
      const bubble = document.createElement('div')
      bubble.className = 'chat-bubble agent'
      bubble.textContent = text
      container.appendChild(bubble)
      container.scrollTop = container.scrollHeight
    }

    // --- Drag & Drop to Chat ---
    const chatArea = document.getElementById('chat-panel')
    chatArea.addEventListener('dragover', (e) => {
      e.preventDefault()
      chatArea.classList.add('drag-over')
    })
    chatArea.addEventListener('dragleave', () => {
      chatArea.classList.remove('drag-over')
    })
    chatArea.addEventListener('drop', (e) => {
      e.preventDefault()
      chatArea.classList.remove('drag-over')
      const files = e.dataTransfer.files
      if (files.length > 0) {
        Array.from(files).forEach(file => {
          const reader = new FileReader()
          reader.onload = () => {
            const content = reader.result
            // Save to VFS
            const vfsPath = `/home/user/Downloads/${file.name}`
            VFS.writeFile(vfsPath, content)
            // Tell agent about it
            Agent.chat(`I just dropped a file: ${file.name} (${(file.size / 1024).toFixed(1)}KB, ${file.type || 'unknown type'}). It's saved at ${vfsPath}. Take a look.`)
          }
          reader.readAsText(file)
        })
      }
      // Handle text drops
      const text = e.dataTransfer.getData('text/plain')
      if (text && !files.length) {
        Agent.chat(`[Dropped text]: ${text}`)
      }
    })
  }
})()
