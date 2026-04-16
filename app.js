/* app.js — Bootstrap and wire everything together */
;(function() {
  'use strict'

  // ── API Key Modal ──
  const modal = document.getElementById('api-modal')
  const providerSelect = document.getElementById('provider-select')
  const apiKeyInput = document.getElementById('api-key-input')
  const modelInput = document.getElementById('model-input')
  const baseurlInput = document.getElementById('baseurl-input')
  const apiKeySubmit = document.getElementById('api-key-submit')

  // Check localStorage
  const savedProvider = localStorage.getItem('fluid-provider')
  const savedKey = localStorage.getItem('fluid-apikey')
  const savedModel = localStorage.getItem('fluid-model')
  const savedBaseUrl = localStorage.getItem('fluid-baseurl')
  if (savedProvider && savedKey) {
    modal.classList.add('hidden')
    // Sync to unified settings
    const s = JSON.parse(localStorage.getItem('fluid-settings') || '{}')
    if (!s.apiKey) localStorage.setItem('fluid-settings', JSON.stringify({ provider: savedProvider, apiKey: savedKey, model: savedModel || '', baseUrl: savedBaseUrl || '', voice: s.voice || false }))
    boot(savedProvider, savedKey, savedModel, savedBaseUrl)
  }

  apiKeySubmit.addEventListener('click', () => {
    const provider = providerSelect.value
    const key = apiKeyInput.value.trim()
    const model = modelInput.value.trim()
    const baseUrl = baseurlInput.value.trim()
    if (!key) return
    localStorage.setItem('fluid-provider', provider)
    localStorage.setItem('fluid-apikey', key)
    if (model) localStorage.setItem('fluid-model', model)
    else localStorage.removeItem('fluid-model')
    if (baseUrl) localStorage.setItem('fluid-baseurl', baseUrl)
    else localStorage.removeItem('fluid-baseurl')
    modal.classList.add('hidden')
    boot(provider, key, model, baseUrl)
  })

  apiKeyInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') apiKeySubmit.click()
  })

  async function boot(provider, apiKey, model, baseUrl) {
    // Init agentic-store — single store for the whole OS
    Agent.configure(provider, apiKey, model, baseUrl)
    // ai instance is now ready — init persistence through the glue layer
    const ai = Agent.getAi()
    await VFS.init(ai)
    await WindowManager.loadApps(ai)
    document.getElementById('app').style.display = 'flex'

    // Start proactive awareness loop
    Agent.startProactiveLoop()

    // Open initial Finder window
    WindowManager.openFinder('/home/user/Desktop')

    // Restore previous chat or show welcome
    const container = document.getElementById('chat-messages')
    await Agent.restoreChatUI()
    if (container.children.length === 0) {
      const bubble = document.createElement('div')
      bubble.className = 'chat-bubble agent'
      bubble.textContent = "Hey! I'm Fluid Agent — part companion, part OS. Ask me anything, or tell me to do something."
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
          case 'video': WindowManager.openVideo(); break
          case 'settings': WindowManager.openSettings(); break
        }
      })
    })

    // Load settings and apply voice
    const settings = JSON.parse(localStorage.getItem('fluid-settings') || '{}')
    if (settings.voice) Voice.enable()
    else Voice.disable()

    // --- Clock ---
    const clockEl = document.getElementById('clock')
    function updateClock() {
      const now = new Date()
      clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    updateClock()
    setInterval(updateClock, 30000)

    // --- Worker indicator in header ---
    const workerInd = document.getElementById('worker-indicator')
    setInterval(() => {
      const bb = Agent.blackboard
      if (bb.currentTask && bb.currentTask.status === 'running') {
        workerInd.innerHTML = `<div class="spinner"></div> ${bb.currentTask.goal?.slice(0, 30) || 'Working...'}`
      } else {
        workerInd.innerHTML = ''
      }
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
        if (zone === 'left') { winEl.style.left = '0'; winEl.style.top = '0'; winEl.style.width = w/2+'px'; winEl.style.height = h+'px' }
        else if (zone === 'right') { winEl.style.left = w/2+'px'; winEl.style.top = '0'; winEl.style.width = w/2+'px'; winEl.style.height = h+'px' }
        else if (zone === 'top') { winEl.style.left = '0'; winEl.style.top = '0'; winEl.style.width = w+'px'; winEl.style.height = h+'px' }
      }
    }

    // Voice button — click to toggle, long-press (push-to-talk) to record while held
    const voiceBtn = document.getElementById('voice-btn')
    if (voiceBtn) {
      if (!settings.voice) voiceBtn.style.display = 'none'
      let pttTimer = null
      let isPtt = false

      voiceBtn.addEventListener('mousedown', (e) => {
        e.preventDefault()
        if (!Voice.isEnabled()) { WindowManager.openSettings(); return }
        // Start PTT after 200ms hold
        pttTimer = setTimeout(() => {
          isPtt = true
          Voice.startListening()
          voiceBtn.classList.add('ptt-active')
        }, 200)
      })

      const endPtt = () => {
        if (pttTimer) { clearTimeout(pttTimer); pttTimer = null }
        if (isPtt) {
          isPtt = false
          Voice.stopListening()
          voiceBtn.classList.remove('ptt-active')
        }
      }
      voiceBtn.addEventListener('mouseup', (e) => {
        if (!isPtt && pttTimer) {
          // Short click — toggle mode
          clearTimeout(pttTimer); pttTimer = null
          Voice.toggleListening()
        } else {
          endPtt()
        }
      })
      voiceBtn.addEventListener('mouseleave', endPtt)

      // Touch support for mobile
      voiceBtn.addEventListener('touchstart', (e) => {
        e.preventDefault()
        if (!Voice.isEnabled()) { WindowManager.openSettings(); return }
        pttTimer = setTimeout(() => {
          isPtt = true
          Voice.startListening()
          voiceBtn.classList.add('ptt-active')
        }, 200)
      }, { passive: false })
      voiceBtn.addEventListener('touchend', (e) => {
        if (!isPtt && pttTimer) {
          clearTimeout(pttTimer); pttTimer = null
          Voice.toggleListening()
        } else {
          endPtt()
        }
      })
      voiceBtn.addEventListener('touchcancel', endPtt)
    }

    // --- Notification Center ---
    const notifBtn = document.getElementById('notif-btn')
    const notifPanel = document.getElementById('notif-panel')
    const notifList = document.getElementById('notif-list')
    const notifBadge = document.getElementById('notif-badge')
    const notifEmpty = document.getElementById('notif-empty')
    const notifClear = document.getElementById('notif-clear')
    let notifItems = []
    let unreadCount = 0

    // Load persisted notifications via store
    ai.load('notifs').then(saved => { if (saved) { notifItems = saved; renderNotifs() } })
    function saveNotifs() { ai.save('notifs', notifItems) }

    function renderNotifs() {
      notifList.innerHTML = ''
      notifEmpty.style.display = notifItems.length === 0 ? 'block' : 'none'
      notifItems.slice(-20).reverse().forEach(n => {
        const el = document.createElement('div')
        el.className = `notif-item${n.unread ? ' unread' : ''}`
        el.innerHTML = `<div>${n.text}</div><div class="notif-time">${new Date(n.time).toLocaleTimeString()}</div>`
        notifList.appendChild(el)
      })
      notifBadge.textContent = unreadCount
      notifBadge.classList.toggle('hidden', unreadCount === 0)
    }

    function addNotification(text) {
      notifItems.push({ text, time: Date.now(), unread: true })
      unreadCount++
      if (notifItems.length > 50) notifItems = notifItems.slice(-50)
      saveNotifs()
      renderNotifs()
    }

    notifBtn.addEventListener('click', () => {
      notifPanel.classList.toggle('hidden')
      if (!notifPanel.classList.contains('hidden')) {
        unreadCount = 0
        notifItems.forEach(n => n.unread = false)
        renderNotifs()
        saveNotifs()
      }
    })

    notifClear.addEventListener('click', () => {
      notifItems = []; unreadCount = 0
      ai.deleteKey('notifs')
      renderNotifs()
    })

    // Close panel on outside click
    document.addEventListener('click', (e) => {
      if (!notifPanel.contains(e.target) && e.target !== notifBtn && !notifBtn.contains(e.target)) {
        notifPanel.classList.add('hidden')
      }
    })

    renderNotifs()

    // Hook into Agent.notify to also push to notification center
    const origNotify = Agent.notify
    Agent.notify = function(text, type) {
      origNotify.call(Agent, text, type)
      addNotification(text)
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
