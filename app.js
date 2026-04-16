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

  function boot(provider, apiKey, model, baseUrl) {
    Agent.configure(provider, apiKey, model, baseUrl)
    document.getElementById('app').style.display = 'flex'

    // Start proactive awareness loop
    Agent.startProactiveLoop()

    // Open initial Finder window
    WindowManager.openFinder('/home/user/Desktop')

    // Restore previous chat or show welcome
    const container = document.getElementById('chat-messages')
    Agent.restoreChatUI()
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

    // Load persisted notifications
    try {
      const saved = localStorage.getItem('fluid-notifs')
      if (saved) notifItems = JSON.parse(saved)
    } catch (e) {}

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
      try { localStorage.setItem('fluid-notifs', JSON.stringify(notifItems)) } catch (e) {}
      renderNotifs()
    }

    notifBtn.addEventListener('click', () => {
      notifPanel.classList.toggle('hidden')
      if (!notifPanel.classList.contains('hidden')) {
        unreadCount = 0
        notifItems.forEach(n => n.unread = false)
        renderNotifs()
        try { localStorage.setItem('fluid-notifs', JSON.stringify(notifItems)) } catch (e) {}
      }
    })

    notifClear.addEventListener('click', () => {
      notifItems = []; unreadCount = 0
      localStorage.removeItem('fluid-notifs')
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
