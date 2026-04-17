/* windows.js — macOS-style window manager */
const WindowManager = (() => {
  let nextId = 1
  let topZ = 100
  const windows = new Map()
  const area = () => document.getElementById('desktop-area')

  let cascadeOffset = 0

  function create({ type, title, x, y, width, height, data }) {
    const id = 'win-' + nextId++
    const w = document.createElement('div')
    w.className = 'window'
    w.id = id
    // Cascade windows so they don't stack exactly
    const cx = (x || 60) + cascadeOffset * 30
    const cy = (y || 40) + cascadeOffset * 30
    cascadeOffset = (cascadeOffset + 1) % 6
    w.style.left = cx + 'px'
    w.style.top = cy + 'px'
    w.style.width = (width || 500) + 'px'
    w.style.height = (height || 350) + 'px'
    w.style.zIndex = ++topZ

    w.innerHTML = `
      <div class="window-titlebar">
        <div class="window-dots">
          <div class="window-dot close"></div>
          <div class="window-dot minimize"></div>
          <div class="window-dot maximize"></div>
        </div>
        <div class="window-title">${title || type}</div>
      </div>
      <div class="window-body"></div>
      <div class="window-resize"></div>
    `

    // Focus on click
    w.addEventListener('mousedown', () => focus(id))

    // Close button
    w.querySelector('.window-dot.close').addEventListener('click', e => {
      e.stopPropagation()
      close(id)
    })

    // Minimize button
    w.querySelector('.window-dot.minimize').addEventListener('click', e => {
      e.stopPropagation()
      minimize(id)
    })

    // Maximize/fullscreen button
    w.querySelector('.window-dot.maximize').addEventListener('click', e => {
      e.stopPropagation()
      toggleFullscreen(id)
    })

    // Drag
    const titlebar = w.querySelector('.window-titlebar')
    let dragStart = null
    titlebar.addEventListener('mousedown', e => {
      if (e.target.classList.contains('window-dot')) return
      dragStart = { x: e.clientX - w.offsetLeft, y: e.clientY - w.offsetTop }
      focus(id)
    })
    document.addEventListener('mousemove', e => {
      if (!dragStart) return
      w.style.left = (e.clientX - dragStart.x) + 'px'
      w.style.top = (e.clientY - dragStart.y) + 'px'
      // Snap preview
      if (window._snapHelpers) {
        const zone = window._snapHelpers.getSnapZone(e.clientX, e.clientY)
        window._snapHelpers.showSnapPreview(zone)
      }
    })
    document.addEventListener('mouseup', (e) => {
      if (dragStart && window._snapHelpers) {
        const zone = window._snapHelpers.getSnapZone(e.clientX, e.clientY)
        if (zone) window._snapHelpers.applySnap(zone, w)
        window._snapHelpers.hideSnapPreview()
      }
      dragStart = null
    })

    // Resize
    const resizeHandle = w.querySelector('.window-resize')
    let resizeStart = null
    resizeHandle.addEventListener('mousedown', e => {
      e.stopPropagation()
      resizeStart = { x: e.clientX, y: e.clientY, w: w.offsetWidth, h: w.offsetHeight }
    })
    document.addEventListener('mousemove', e => {
      if (!resizeStart) return
      w.style.width = Math.max(300, resizeStart.w + e.clientX - resizeStart.x) + 'px'
      w.style.height = Math.max(200, resizeStart.h + e.clientY - resizeStart.y) + 'px'
    })
    document.addEventListener('mouseup', () => { resizeStart = null })

    area().appendChild(w)
    const winObj = { id, type, el: w, data: data || {} }
    windows.set(id, winObj)

    // Render content
    renderWindow(winObj)
    focus(id)
    updateDock()
    saveSession()
    return id
  }

  function close(id) {
    const w = windows.get(id)
    if (!w) return
    w.el.classList.add('closing')
    setTimeout(() => {
      w.el.remove()
      windows.delete(id)
    }, 200)
  }

  function focus(id) {
    const w = windows.get(id)
    if (!w) return
    windows.forEach(win => win.el.classList.remove('focused'))
    w.el.style.zIndex = ++topZ
    w.el.classList.add('focused')
  }

  function minimize(id) {
    const w = windows.get(id)
    if (!w) return
    w.el.classList.add('minimized')
    w.minimized = true
    updateDock()
  }

  function unminimize(id) {
    const w = windows.get(id)
    if (!w) return
    w.el.classList.remove('minimized')
    w.minimized = false
    focus(id)
    updateDock()
  }

  function toggleFullscreen(id) {
    const w = windows.get(id)
    if (!w) return
    if (w.fullscreen) {
      // Restore
      w.el.style.left = w._restore.left
      w.el.style.top = w._restore.top
      w.el.style.width = w._restore.width
      w.el.style.height = w._restore.height
      w.el.classList.remove('fullscreen')
      w.fullscreen = false
    } else {
      // Save and go fullscreen
      w._restore = { left: w.el.style.left, top: w.el.style.top, width: w.el.style.width, height: w.el.style.height }
      const a = area()
      w.el.style.left = '0px'
      w.el.style.top = '0px'
      w.el.style.width = a.offsetWidth + 'px'
      w.el.style.height = a.offsetHeight + 'px'
      w.el.classList.add('fullscreen')
      w.fullscreen = true
      focus(id)
    }
  }

  function renderWindow(w) {
    const body = w.el.querySelector('.window-body')
    switch (w.type) {
      case 'finder': renderFinder(w, body); break
      case 'terminal': renderTerminal(w, body); break
      case 'editor': renderEditor(w, body); break
      case 'plan': renderPlan(w, body); break
      case 'settings': renderSettings(w, body); break
      case 'music': renderMusic(w, body); break
      case 'video': renderVideo(w, body); break
      case 'browser': renderBrowser(w, body); break
      case 'map': renderMap(w, body); break
      case 'app': renderApp(w, body); break
    }
  }

  // ── Finder ──
  function renderFinder(w, body) {
    const path = w.data.path || '/home/user/Desktop'
    const items = VFS.ls(path) || []
    body.innerHTML = `
      <div class="finder-path">📁 ${path}</div>
      <div class="finder-grid">
        ${path !== '/' ? '<div class="finder-item" data-path=".."><div class="icon">⬆️</div><div class="name">..</div></div>' : ''}
        ${items.map(i => `
          <div class="finder-item" data-path="${i.name}" data-type="${i.type}">
            <div class="icon">${i.type === 'dir' ? '📁' : fileIcon(i.name)}</div>
            <div class="name">${i.name}</div>
          </div>
        `).join('')}
      </div>
    `
    body.querySelectorAll('.finder-item').forEach(el => {
      el.addEventListener('dblclick', () => {
        const name = el.dataset.path
        const type = el.dataset.type
        if (name === '..') {
          const parent = path.split('/').slice(0, -1).join('/') || '/'
          w.data.path = parent
          w.el.querySelector('.window-title').textContent = parent.split('/').pop() || '/'
          renderFinder(w, body)
        } else if (type === 'dir') {
          w.data.path = VFS.normPath(path + '/' + name)
          w.el.querySelector('.window-title').textContent = name
          renderFinder(w, body)
        } else {
          // Open file in editor
          openEditor(VFS.normPath(path + '/' + name))
        }
      })
    })
  }

  function fileIcon(name) {
    if (name.endsWith('.txt') || name.endsWith('.md')) return '📄'
    if (name.endsWith('.js')) return '🟨'
    if (name.endsWith('.html')) return '🌐'
    if (name.endsWith('.css')) return '🎨'
    if (name.endsWith('.json')) return '📋'
    if (name.endsWith('.py')) return '🐍'
    return '📄'
  }

  // ── Terminal ──
  function renderTerminal(w, body) {
    body.innerHTML = `<div class="terminal-body"><div class="terminal-output"></div><div class="terminal-input-line"><span class="terminal-prompt">user@fluid:${Shell.getCwd()}$ </span><input class="terminal-input" autofocus></div></div>`
    const output = body.querySelector('.terminal-output')
    const input = body.querySelector('.terminal-input')
    const promptEl = body.querySelector('.terminal-prompt')
    let histIdx = -1

    // Welcome
    appendOutput(output, 'FluidOS Terminal v1.0\nType "help" for available commands.\n', 'output')

    input.addEventListener('keydown', async e => {
      if (e.key === 'Enter') {
        const cmd = input.value
        appendOutput(output, `user@fluid:${Shell.getCwd()}$ ${cmd}`, '')
        if (cmd.trim()) {
          // Built-in: say <text> — TTS via Voice
          const sayMatch = cmd.trim().match(/^say\s+(.+)$/i)
          if (sayMatch) {
            const text = sayMatch[1]
            if (Voice?.isEnabled()) {
              appendOutput(output, `Speaking: "${text}"`, 'output')
              Voice.speak(text)
            } else {
              appendOutput(output, 'Voice not enabled. Enable in Settings.', 'error')
            }
          } else if (cmd.trim() === 'listen') {
            if (Voice?.isEnabled()) {
              appendOutput(output, 'Listening... (click mic or type "listen" again to stop)', 'output')
              Voice.toggleListening()
            } else {
              appendOutput(output, 'Voice not enabled. Enable in Settings.', 'error')
            }
          } else if (cmd.trim().match(/^play(\s+\d+)?$/i)) {
            const m = cmd.trim().match(/^play(?:\s+(\d+))?$/i)
            const idx = m[1] != null ? parseInt(m[1]) : null
            WindowManager.openMusic()
            window.dispatchEvent(new CustomEvent('music-control', { detail: { action: 'play', track: idx } }))
            appendOutput(output, idx != null ? `Playing track ${idx}` : 'Playing music', 'output')
          } else if (cmd.trim() === 'pause' || cmd.trim() === 'stop') {
            window.dispatchEvent(new CustomEvent('music-control', { detail: { action: 'pause' } }))
            appendOutput(output, 'Music paused', 'output')
          } else if (cmd.trim() === 'next') {
            window.dispatchEvent(new CustomEvent('music-control', { detail: { action: 'next' } }))
            appendOutput(output, 'Next track', 'output')
          } else {
            const result = await Shell.execAsync(cmd)
            if (result === '\x1bclear') {
              output.innerHTML = ''
            } else if (result) {
              appendOutput(output, result, result.includes('not found') || result.includes('No such') ? 'error' : 'output')
            }
          }
        }
        promptEl.textContent = `user@fluid:${Shell.getCwd()}$ `
        input.value = ''
        histIdx = -1
        body.querySelector('.terminal-body').scrollTop = body.querySelector('.terminal-body').scrollHeight
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const hist = Shell.getHistory()
        if (histIdx < hist.length - 1) { histIdx++; input.value = hist[hist.length - 1 - histIdx] }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        const hist = Shell.getHistory()
        if (histIdx > 0) { histIdx--; input.value = hist[hist.length - 1 - histIdx] }
        else { histIdx = -1; input.value = '' }
      }
    })

    // Focus input on click
    body.addEventListener('click', () => input.focus())
    setTimeout(() => input.focus(), 50)
  }

  function appendOutput(container, text, cls) {
    const line = document.createElement('div')
    line.className = 'terminal-line' + (cls ? ' ' + cls : '')
    line.textContent = text
    container.appendChild(line)
  }

  // ── Editor ──
  function renderEditor(w, body) {
    const path = w.data.path || ''
    const content = VFS.readFile(path) || ''
    body.innerHTML = `<div class="editor-body"><textarea class="editor-textarea">${escapeHtml(content)}</textarea></div>`
    const textarea = body.querySelector('.editor-textarea')

    // Auto-save on change
    let saveTimer = null
    textarea.addEventListener('input', () => {
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        VFS.writeFile(path, textarea.value)
        w.el.querySelector('.window-title').textContent = path.split('/').pop()
      }, 500)
    })

    // Cmd+S
    textarea.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        VFS.writeFile(path, textarea.value)
      }
    })
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  // ── Plan ──
  function renderPlan(w, body) {
    const { goal, steps } = w.data
    body.innerHTML = `
      <div class="plan-body">
        <div class="plan-goal">${goal || 'No active task'}</div>
        <div class="plan-steps">
          ${(steps || []).map((s, i) => `
            <div class="plan-step ${s.status}">
              <div class="plan-step-icon">${stepIcon(s.status)}</div>
              <div class="plan-step-text">${s.text}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `
  }

  function stepIcon(status) {
    switch (status) {
      case 'done': return '✅'
      case 'running': return '⏳'
      case 'aborted': return '❌'
      default: return '○'
    }
  }

  function updatePlan(winId, goal, steps) {
    const w = windows.get(winId)
    if (!w || w.type !== 'plan') return
    w.data.goal = goal
    w.data.steps = steps
    renderPlan(w, w.el.querySelector('.window-body'))
  }

  // ── Helpers ──
  function openFinder(path) {
    return create({ type: 'finder', title: path.split('/').pop() || '/', x: 40, y: 30, width: 520, height: 380, data: { path } })
  }

  function openTerminal() {
    return create({ type: 'terminal', title: 'Terminal', x: 200, y: 100, width: 560, height: 360 })
  }

  function openEditor(path) {
    return create({ type: 'editor', title: path.split('/').pop(), x: 120, y: 60, width: 500, height: 400, data: { path } })
  }

  function openPlan(goal, steps) {
    return create({ type: 'plan', title: 'Plan', x: 300, y: 50, width: 400, height: 320, data: { goal, steps } })
  }

  let taskManagerId = null
  const taskHistory = [] // { id, goal, steps, status, log, startTime }

  function openTaskManager() {
    if (taskManagerId && windows.has(taskManagerId)) {
      focus(taskManagerId)
      return taskManagerId
    }
    taskManagerId = create({ type: 'taskmanager', title: 'Task Manager', x: 300, y: 50, width: 520, height: 380 })
    renderTaskManager()
    return taskManagerId
  }

  function addTask(goal, steps) {
    const task = { id: 'task-' + Date.now(), goal, steps: steps.map(s => ({ text: s, status: 'pending' })), status: 'running', log: [], startTime: Date.now() }
    taskHistory.unshift(task)
    if (taskHistory.length > 20) taskHistory.pop()
    openTaskManager()
    renderTaskManager(task.id)
    return task
  }

  function updateTask(task) {
    if (taskManagerId && windows.has(taskManagerId)) renderTaskManager(task?.id)
  }

  function renderTaskManager(selectedId) {
    const w = windows.get(taskManagerId)
    if (!w) return
    const body = w.el.querySelector('.window-body')
    const sel = selectedId || taskHistory[0]?.id
    const selected = taskHistory.find(t => t.id === sel) || taskHistory[0]

    body.innerHTML = `<div class="tm-layout">
      <div class="tm-list">${taskHistory.map(t => `
        <div class="tm-item ${t.status} ${t.id === selected?.id ? 'active' : ''}" data-id="${t.id}">
          <span class="tm-status-dot"></span>
          <span class="tm-goal">${t.goal.slice(0, 40)}${t.goal.length > 40 ? '…' : ''}</span>
        </div>`).join('') || '<div class="tm-empty">No tasks yet</div>'}
      </div>
      <div class="tm-detail">${selected ? `
        <div class="tm-detail-goal">${selected.goal}</div>
        <div class="tm-steps">${selected.steps.map(s => `
          <div class="tm-step ${s.status}">
            <span class="tm-step-icon">${s.status === 'done' ? '✓' : s.status === 'running' ? '▶' : s.status === 'aborted' ? '✕' : '○'}</span>
            <span>${s.text}</span>
          </div>`).join('')}
        </div>
        ${selected.log.length ? `<div class="tm-log">${selected.log.slice(-8).map(l => `<div class="tm-log-line">${l}</div>`).join('')}</div>` : ''}
      ` : '<div class="tm-empty">Select a task</div>'}</div>
    </div>`

    body.querySelectorAll('.tm-item').forEach(el => {
      el.addEventListener('click', () => renderTaskManager(el.dataset.id))
    })
  }

  // Refresh all finder windows when FS changes
  VFS.on((event, path) => {
    windows.forEach(w => {
      if (w.type === 'finder') {
        renderFinder(w, w.el.querySelector('.window-body'))
      }
    })
  })

  function getState() {
    const focused = [...windows.values()].find(w => w.el.classList.contains('focused'))
    return {
      windows: [...windows.values()].map(w => ({
        id: w.id,
        type: w.type,
        title: w.el.querySelector('.window-title')?.textContent || w.type,
        focused: w.el.classList.contains('focused'),
        path: w.data?.path || null,
      })),
      focusedWindow: focused ? { type: focused.type, title: focused.el.querySelector('.window-title')?.textContent, path: focused.data?.path } : null,
    }
  }

  function closeByTitle(title) {
    for (const [id, w] of windows) {
      if (w.el.querySelector('.window-title')?.textContent === title || w.type === title) {
        close(id); return true
      }
    }
    return false
  }

  function focusByTitle(title) {
    for (const [id, w] of windows) {
      if (w.el.querySelector('.window-title')?.textContent === title || w.type === title) {
        focus(id); return true
      }
    }
    return false
  }

  function openImage(src, title) {
    const id = create('image', { src, path: src })
    const w = windows.get(id)
    const body = w.el.querySelector('.window-body')
    w.el.querySelector('.window-title').textContent = title || src.split('/').pop()
    body.innerHTML = `<div class="image-viewer"><img src="${src}" alt="${title || ''}"></div>`
    return id
  }

  // --- Settings Window ---
  let settingsId = null
  function openSettings() {
    if (settingsId && windows.has(settingsId)) { focus(settingsId); return settingsId }
    settingsId = create({ type: 'settings', title: 'Settings', x: 150, y: 80, width: 420, height: 380 })
    return settingsId
  }

  function renderSettings(w, body) {
    const saved = JSON.parse(localStorage.getItem('fluid-settings') || '{}')
    body.innerHTML = `<div class="settings-body">
      <div class="settings-group-title">LLM</div>
      <div class="settings-section">
        <div class="settings-label">Provider</div>
        <select class="settings-input" id="s-provider">
          <option value="anthropic" ${saved.provider === 'anthropic' ? 'selected' : ''}>Anthropic</option>
          <option value="openai" ${saved.provider === 'openai' ? 'selected' : ''}>OpenAI</option>
        </select>
      </div>
      <div class="settings-section">
        <div class="settings-label">API Key</div>
        <input class="settings-input" id="s-apikey" type="text" placeholder="sk-..." value="${saved.apiKey || ''}">
      </div>
      <div class="settings-section">
        <div class="settings-label">Model</div>
        <input class="settings-input" id="s-model" type="text" placeholder="claude-sonnet-4-20250514" value="${saved.model || ''}">
      </div>
      <div class="settings-section">
        <div class="settings-label">Base URL (optional)</div>
        <input class="settings-input" id="s-baseurl" type="text" placeholder="https://api.anthropic.com" value="${saved.baseUrl || ''}">
      </div>
      <div class="settings-divider"></div>
      <div class="settings-group-title">Voice</div>
      <div class="settings-section">
        <label class="settings-toggle"><input type="checkbox" id="s-voice" ${saved.voice ? 'checked' : ''}> Enable voice (Web Speech API free, or ElevenLabs premium)</label>
        <div class="settings-hint">Without API key: uses browser's built-in speech recognition. Hold mic button = push-to-talk.</div>
      </div>
      <div class="settings-section">
        <div class="settings-label">ElevenLabs API Key (optional, for premium voice)</div>
        <input class="settings-input" id="s-elkey" type="text" placeholder="xi-..." value="${saved.elevenLabsKey || ''}">
      </div>
      <div class="settings-section">
        <div class="settings-label">Voice ID</div>
        <input class="settings-input" id="s-elvoice" type="text" placeholder="JBFqnCBsd6RMkjVDRZzb" value="${saved.elevenLabsVoice || ''}">
      </div>
      <button class="settings-save" id="s-save">Save & Apply</button>
    </div>`
    body.querySelector('#s-save').addEventListener('click', () => {
      const settings = {
        provider: body.querySelector('#s-provider').value,
        apiKey: body.querySelector('#s-apikey').value,
        model: body.querySelector('#s-model').value,
        baseUrl: body.querySelector('#s-baseurl').value,
        voice: body.querySelector('#s-voice').checked,
        elevenLabsKey: body.querySelector('#s-elkey').value,
        elevenLabsVoice: body.querySelector('#s-elvoice').value,
      }
      localStorage.setItem('fluid-settings', JSON.stringify(settings))
      Agent.configure(settings.provider, settings.apiKey, settings.model, settings.baseUrl)
      // Init persistence if this is the first configure
      const ai = Agent.getAi()
      if (ai) VFS.init(ai).then(() => WindowManager.loadApps(ai))
      if (settings.voice) Voice?.enable()
      else Voice?.disable()
      Agent.startProactiveLoop()
      showActivity('Settings saved')
    })
  }

  function showActivity(text) {
    const stream = document.getElementById('activity-stream')
    if (!stream) return
    const item = document.createElement('div')
    item.className = 'activity-item'
    item.innerHTML = `<div class="activity-dot"></div><span>${text}</span>`
    stream.appendChild(item)
    setTimeout(() => { if (item.parentNode) item.remove() }, 5000)
  }

  // --- Dock ---
  function updateDock() {
    const container = document.getElementById('dock-running')
    if (!container) return
    container.innerHTML = ''

    // Show installed generative apps in dock
    for (const [name, app] of installedApps) {
      const item = document.createElement('div')
      item.className = 'dock-item dock-app'
      item.title = name
      item.textContent = app.icon
      // Check if already open
      let isOpen = false
      windows.forEach(w => { if (w.type === 'app' && w.data?.name === name) isOpen = true })
      if (isOpen) {
        const dot = document.createElement('div')
        dot.className = 'dock-running-dot'
        item.appendChild(dot)
      }
      item.addEventListener('click', () => openApp(name))
      container.appendChild(item)
    }

    // Show other running windows
    windows.forEach((w, id) => {
      if (['finder', 'terminal', 'settings', 'music', 'video', 'browser', 'app'].includes(w.type) && !w.minimized) return
      const item = document.createElement('div')
      item.className = 'dock-item' + (w.minimized ? ' minimized' : '')
      item.title = w.el.querySelector('.window-title')?.textContent || w.type
      const icons = { editor: '📝', taskmanager: '📋', plan: '📌', image: '🖼️', finder: '📁', terminal: '⬛', settings: '⚙️', music: '🎵', video: '🎬', browser: '🌐' }
      item.textContent = icons[w.type] || '🗔'
      if (!w.minimized) {
        const dot = document.createElement('div')
        dot.className = 'dock-running-dot'
        item.appendChild(dot)
      }
      item.addEventListener('click', () => {
        if (w.minimized) unminimize(id)
        else focus(id)
      })
      container.appendChild(item)
    })
  }

  // --- Music Player ---
  let musicId = null
  const musicState = {
    playlist: [
      { title: 'Midnight Drive', artist: 'Synthwave FM', color: '#60a5fa' },
      { title: 'Neon Lights', artist: 'Retro Wave', color: '#a78bfa' },
      { title: 'Ocean Breeze', artist: 'Lo-Fi Beats', color: '#34d399' },
      { title: 'City Rain', artist: 'Ambient Works', color: '#f472b6' },
      { title: 'Starlight', artist: 'Chillhop', color: '#fbbf24' },
    ],
    current: 0,
    playing: false,
    elapsed: 0,
    timer: null,
  }
  // Set durations from synth
  musicState.playlist.forEach((t, i) => { t.duration = Math.floor(AudioSynth.getDuration(i)) })

  function musicPlay(s) {
    clearInterval(s.timer)
    s.playing = true
    AudioSynth.play(s.current, s.elapsed, () => {
      // Auto-next
      s.current = (s.current + 1) % s.playlist.length
      s.elapsed = 0
      musicPlay(s)
      musicRerender()
    })
    s.timer = setInterval(() => {
      s.elapsed += 1
      if (s.elapsed >= s.playlist[s.current].duration) {
        s.current = (s.current + 1) % s.playlist.length
        s.elapsed = 0
      }
      musicRerender()
    }, 1000)
  }

  function musicPause(s) {
    clearInterval(s.timer)
    s.playing = false
    AudioSynth.stop()
  }

  function musicRerender() {
    if (!musicId || !windows.has(musicId)) return
    const w = windows.get(musicId)
    renderMusic(w, w.el.querySelector('.window-body'))
  }

  function openMusic() {
    if (musicId && windows.has(musicId)) { focus(musicId); return musicId }
    musicId = create({ type: 'music', title: 'Music', x: 200, y: 100, width: 340, height: 420 })
    return musicId
  }

  function renderMusic(w, body) {
    const s = musicState
    const track = s.playlist[s.current]
    const pct = track.duration > 0 ? (s.elapsed / track.duration * 100) : 0
    const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

    body.innerHTML = `<div class="music-player">
      <div class="music-art" style="background: linear-gradient(135deg, ${track.color}33, ${track.color}11)">
        <div class="music-art-icon" style="color: ${track.color}">${s.playing ? '♫' : '♪'}</div>
      </div>
      <div class="music-info">
        <div class="music-title">${track.title}</div>
        <div class="music-artist">${track.artist}</div>
      </div>
      <div class="music-progress">
        <div class="music-bar"><div class="music-bar-fill" style="width:${pct}%;background:${track.color}"></div></div>
        <div class="music-times"><span>${fmt(s.elapsed)}</span><span>${fmt(track.duration)}</span></div>
      </div>
      <div class="music-controls">
        <button class="music-btn" id="music-prev">⏮</button>
        <button class="music-btn music-play" id="music-toggle">${s.playing ? '⏸' : '▶'}</button>
        <button class="music-btn" id="music-next">⏭</button>
      </div>
      <div class="music-list">${s.playlist.map((t, i) => `
        <div class="music-track ${i === s.current ? 'active' : ''}" data-idx="${i}">
          <span class="music-track-dot" style="background:${t.color}"></span>
          <span class="music-track-title">${t.title}</span>
          <span class="music-track-artist">${t.artist}</span>
          <span class="music-track-dur">${fmt(t.duration)}</span>
        </div>`).join('')}
      </div>
    </div>`

    body.querySelector('#music-toggle').addEventListener('click', () => {
      if (s.playing) musicPause(s)
      else musicPlay(s)
      renderMusic(w, body)
    })
    body.querySelector('#music-prev').addEventListener('click', () => {
      musicPause(s)
      s.current = (s.current - 1 + s.playlist.length) % s.playlist.length
      s.elapsed = 0
      renderMusic(w, body)
    })
    body.querySelector('#music-next').addEventListener('click', () => {
      musicPause(s)
      s.current = (s.current + 1) % s.playlist.length
      s.elapsed = 0
      renderMusic(w, body)
    })
    body.querySelectorAll('.music-track').forEach(el => {
      el.addEventListener('click', () => {
        musicPause(s)
        s.current = parseInt(el.dataset.idx)
        s.elapsed = 0
        musicPlay(s)
        renderMusic(w, body)
      })
    })
  }

  // Agent music control via custom event
  window.addEventListener('music-control', (e) => {
    const { action, track } = e.detail
    const s = musicState
    if (track != null && track >= 0 && track < s.playlist.length) {
      musicPause(s)
      s.current = track; s.elapsed = 0
    }
    if (action === 'play' || action === 'open') {
      if (!s.playing) musicPlay(s)
    } else if (action === 'pause') {
      musicPause(s)
    } else if (action === 'next') {
      musicPause(s)
      s.current = (s.current + 1) % s.playlist.length; s.elapsed = 0
    } else if (action === 'prev') {
      musicPause(s)
      s.current = (s.current - 1 + s.playlist.length) % s.playlist.length; s.elapsed = 0
    }
    musicRerender()
  })

  // --- Video Player ---
  function openVideo(url, title) {
    const id = create({ type: 'video', title: title || 'Video Player', x: 180, y: 80, width: 560, height: 400, data: { url: url || '' } })
    return id
  }

  function renderVideo(w, body) {
    const url = w.data?.url || ''
    if (url) {
      // Detect YouTube and embed
      const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]+)/)
      if (ytMatch) {
        body.innerHTML = `<div class="video-player"><iframe src="https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen style="width:100%;height:100%;border:none"></iframe></div>`
      } else {
        body.innerHTML = `<div class="video-player"><video src="${url}" controls autoplay style="width:100%;height:100%;object-fit:contain"></video></div>`
      }
    } else {
      // Empty state with URL input
      body.innerHTML = `<div class="video-empty">
        <div class="video-empty-icon">🎬</div>
        <div class="video-empty-text">Drop a video URL to play</div>
        <div class="video-url-bar">
          <input class="video-url-input" placeholder="Paste video URL..." />
          <button class="video-url-go">▶</button>
        </div>
        <div class="video-samples">
          <div class="video-sample" data-url="https://www.youtube.com/embed/dQw4w9WgXcQ">Sample: Rick Astley</div>
          <div class="video-sample" data-url="https://www.youtube.com/embed/jNQXAC9IVRw">Sample: First YouTube Video</div>
        </div>
      </div>`
      const input = body.querySelector('.video-url-input')
      const go = () => {
        const v = input.value.trim()
        if (v) { w.data = { ...w.data, url: v }; renderVideo(w, body) }
      }
      body.querySelector('.video-url-go').addEventListener('click', go)
      input.addEventListener('keydown', e => { if (e.key === 'Enter') go() })
      body.querySelectorAll('.video-sample').forEach(el => {
        el.addEventListener('click', () => { w.data = { ...w.data, url: el.dataset.url }; renderVideo(w, body) })
      })
    }
  }

  // --- Browser ---
  function openBrowser(url) {
    const id = create({ type: 'browser', title: 'Browser', x: 160, y: 60, width: 640, height: 460, data: { url: url || '' } })
    return id
  }

  function renderBrowser(w, body) {
    const url = w.data?.url || ''
    const displayUrl = url || 'about:blank'

    body.innerHTML = `<div class="browser-window">
      <div class="browser-toolbar">
        <button class="browser-nav-btn" id="browser-back">◀</button>
        <button class="browser-nav-btn" id="browser-fwd">▶</button>
        <button class="browser-nav-btn" id="browser-reload">↻</button>
        <div class="browser-url-bar">
          <input class="browser-url-input" value="${displayUrl}" />
        </div>
      </div>
      <div class="browser-content">${url
        ? `<iframe src="${url}" style="width:100%;height:100%;border:none" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>`
        : `<div class="browser-home">
            <div class="browser-home-logo">🌐</div>
            <div class="browser-home-title">FluidOS Browser</div>
            <div class="browser-bookmarks">
              <div class="browser-bookmark" data-url="https://en.wikipedia.org">Wikipedia</div>
              <div class="browser-bookmark" data-url="https://news.ycombinator.com">Hacker News</div>
              <div class="browser-bookmark" data-url="https://github.com">GitHub</div>
              <div class="browser-bookmark" data-url="https://developer.mozilla.org">MDN</div>
            </div>
          </div>`
      }</div>
    </div>`

    const urlInput = body.querySelector('.browser-url-input')
    const navigate = (newUrl) => {
      let u = newUrl.trim()
      if (u && !u.match(/^https?:\/\//)) u = 'https://' + u
      w.data = { ...w.data, url: u }
      w.el.querySelector('.window-title').textContent = u ? new URL(u).hostname : 'Browser'
      renderBrowser(w, body)
    }
    urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') navigate(urlInput.value) })
    body.querySelector('#browser-reload')?.addEventListener('click', () => {
      if (w.data?.url) renderBrowser(w, body)
    })
    body.querySelector('#browser-back')?.addEventListener('click', () => {
      w.data = { ...w.data, url: '' }; renderBrowser(w, body)
    })
    body.querySelectorAll('.browser-bookmark').forEach(el => {
      el.addEventListener('click', () => navigate(el.dataset.url))
    })
  }

  // ── Map ──
  let mapId = null

  function openMap(lat, lng, zoom) {
    if (mapId && windows.has(mapId)) { focus(mapId); return mapId }
    mapId = create({ type: 'map', title: 'Map', x: 120, y: 50, width: 560, height: 420, data: { lat: lat || 39.9042, lng: lng || 116.4074, zoom: zoom || 12 } })
    updateDock()
    return mapId
  }

  function renderMap(w, body) {
    const { lat, lng, zoom } = w.data || { lat: 39.9042, lng: 116.4074, zoom: 12 }
    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #map { width: 100%; height: 100%; }
.search-bar { position: absolute; top: 10px; left: 50px; right: 50px; z-index: 1000; }
.search-bar input { width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(22,27,38,0.9); color: #e2e8f0; font-size: 13px; backdrop-filter: blur(8px); outline: none; }
.search-bar input:focus { border-color: #60a5fa; }
.coords { position: absolute; bottom: 8px; left: 8px; z-index: 1000; background: rgba(22,27,38,0.85); color: #94a3b8; padding: 4px 8px; border-radius: 6px; font-size: 11px; backdrop-filter: blur(8px); }
</style></head><body>
<div class="search-bar"><input id="search" placeholder="Search location..." /></div>
<div id="map"></div>
<div class="coords" id="coords">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
<script>
var map = L.map('map', { zoomControl: false }).setView([${lat}, ${lng}], ${zoom});
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap',
  maxZoom: 19
}).addTo(map);
var marker = L.marker([${lat}, ${lng}]).addTo(map);
map.on('mousemove', function(e) {
  document.getElementById('coords').textContent = e.latlng.lat.toFixed(4) + ', ' + e.latlng.lng.toFixed(4);
});
map.on('click', function(e) {
  marker.setLatLng(e.latlng);
});
document.getElementById('search').addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  var q = this.value.trim();
  if (!q) return;
  fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(q))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data && data.length > 0) {
        var lat = parseFloat(data[0].lat), lon = parseFloat(data[0].lon);
        map.setView([lat, lon], 14);
        marker.setLatLng([lat, lon]);
        marker.bindPopup(data[0].display_name).openPopup();
      }
    });
});
<\/script></body></html>`
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'width:100%;height:100%;border:none'
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    iframe.srcdoc = doc
    body.innerHTML = ''
    body.appendChild(iframe)
  }

  // Agent browser control
  window.addEventListener('browser-control', (e) => {
    const { action, url } = e.detail
    // Find or create browser window
    let bw = null
    for (const [, w] of windows) { if (w.type === 'browser') { bw = w; break } }
    if (!bw) {
      const id = openBrowser(action === 'navigate' ? url : '')
      return
    }
    if (action === 'navigate' && url) {
      let u = url.trim()
      if (!u.match(/^https?:\/\//)) u = 'https://' + u
      bw.data = { ...bw.data, url: u }
      bw.el.querySelector('.window-title').textContent = new URL(u).hostname
      renderBrowser(bw, bw.el.querySelector('.window-body'))
    } else if (action === 'back') {
      bw.data = { ...bw.data, url: '' }
      bw.el.querySelector('.window-title').textContent = 'Browser'
      renderBrowser(bw, bw.el.querySelector('.window-body'))
    }
  })

  // Agent video control
  window.addEventListener('video-control', (e) => {
    const { action } = e.detail
    for (const [, w] of windows) {
      if (w.type !== 'video') continue
      const video = w.el.querySelector('video')
      if (!video) continue
      if (action === 'play') video.play()
      else if (action === 'pause') video.pause()
      else if (action === 'fullscreen') video.requestFullscreen?.().catch(() => {})
    }
  })

  // --- Generative App ---
  const installedApps = new Map()
  let _ai = null

  // Persist apps via agentic glue
  async function saveApps() {
    if (!_ai) return
    const obj = {}
    for (const [k, v] of installedApps) obj[k] = v
    await _ai.save('apps', obj)
  }
  async function loadApps(ai) {
    _ai = ai
    if (!ai) return
    const saved = await ai.load('apps')
    if (saved) {
      for (const [k, v] of Object.entries(saved)) installedApps.set(k, v)
    }
  }

  function openApp(name, html, css, js, opts = {}) {
    if (html) {
      installedApps.set(name, { html, css: css || '', js: js || '', icon: opts.icon || '💻', width: opts.width || 420, height: opts.height || 360, description: opts.description || '' })
      saveApps()
    }
    const app = installedApps.get(name)
    if (!app) return null
    const id = create({ type: 'app', title: name, x: 150, y: 80, width: app.width, height: app.height, data: { name, html: app.html, css: app.css, js: app.js } })
    updateDock()
    return id
  }

  function renderApp(w, body) {
    const { html, css, js } = w.data || {}
    // Sandboxed iframe with generated content
    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #e0e0e0; overflow: hidden; }
button { cursor: pointer; }
input, select, textarea { font-family: inherit; }
${css}
</style></head><body>${html}<script>${js}<\/script></body></html>`
    // Use srcdoc for inline content — allows external CDN loads without blob origin issues
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'width:100%;height:100%;border:none'
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    iframe.srcdoc = doc
    body.innerHTML = ''
    body.appendChild(iframe)
  }

  function getInstalledApps() {
    return Array.from(installedApps.entries()).map(([name, app]) => ({ name, icon: app.icon, description: app.description || '' }))
  }

  function uninstallApp(name) {
    if (!installedApps.has(name)) return false
    installedApps.delete(name)
    saveApps()
    updateDock()
    return true
  }

  // Update dock when windows change
  const origClose = close
  const _close = (id) => {
    if (id === musicId) { musicPause(musicState); musicId = null }
    origClose(id); updateDock(); saveSession()
  }

  // ── Session persistence ──
  let _sessionAi = null
  let _sessionTimer = null

  function saveSession() {
    if (!_sessionAi) return
    clearTimeout(_sessionTimer)
    _sessionTimer = setTimeout(() => {
      const snapshot = []
      for (const [id, w] of windows) {
        const el = w.el
        if (el.classList.contains('closing')) continue
        snapshot.push({
          type: w.type,
          title: el.querySelector('.window-title')?.textContent || w.type,
          x: parseInt(el.style.left) || 0,
          y: parseInt(el.style.top) || 0,
          width: parseInt(el.style.width) || 500,
          height: parseInt(el.style.height) || 350,
          focused: el.classList.contains('focused'),
          minimized: el.classList.contains('minimized'),
          data: w.data || {},
        })
      }
      _sessionAi.save('session', snapshot)
    }, 500)
  }

  async function restoreSession(ai) {
    _sessionAi = ai
    if (!ai) return false
    const snapshot = await ai.load('session')
    if (!snapshot || !Array.isArray(snapshot) || snapshot.length === 0) return false

    let focusId = null
    for (const win of snapshot) {
      let id = null
      try {
        switch (win.type) {
          case 'finder': id = create({ type: 'finder', title: win.title, x: win.x, y: win.y, width: win.width, height: win.height, data: win.data }); break
          case 'terminal': id = create({ type: 'terminal', title: 'Terminal', x: win.x, y: win.y, width: win.width, height: win.height }); break
          case 'editor': if (win.data?.path && VFS.isFile(win.data.path)) id = create({ type: 'editor', title: win.title, x: win.x, y: win.y, width: win.width, height: win.height, data: win.data }); break
          case 'settings': id = create({ type: 'settings', title: 'Settings', x: win.x, y: win.y, width: win.width, height: win.height }); settingsId = id; break
          case 'browser': id = create({ type: 'browser', title: win.title, x: win.x, y: win.y, width: win.width, height: win.height, data: win.data }); break
          case 'map': id = create({ type: 'map', title: 'Map', x: win.x, y: win.y, width: win.width, height: win.height, data: win.data }); mapId = id; break
          case 'music': id = create({ type: 'music', title: 'Music', x: win.x, y: win.y, width: win.width, height: win.height }); musicId = id; break
          case 'app': if (win.data?.name && installedApps.has(win.data.name)) id = create({ type: 'app', title: win.title, x: win.x, y: win.y, width: win.width, height: win.height, data: win.data }); break
          // Skip transient types: plan, taskmanager, video, image
        }
      } catch (e) { /* skip broken windows */ }
      if (id && win.minimized) minimize(id)
      if (id && win.focused) focusId = id
    }
    if (focusId) focus(focusId)
    updateDock()
    return true
  }

  // Hook into drag/resize end to save session
  document.addEventListener('mouseup', () => { if (_sessionAi) saveSession() })

  return { create, close: _close, focus, minimize, unminimize, toggleFullscreen, openFinder, openTerminal, openEditor, openPlan, updatePlan, openImage, openSettings, openMusic, openVideo, openBrowser, openMap, openApp, uninstallApp, getInstalledApps, openTaskManager, addTask, updateTask, updateDock, windows, getState, closeByTitle, focusByTitle, loadApps, restoreSession, saveSession, getFocused() { for (const [id, w] of windows) { if (w.el.classList.contains('focused')) return id } return null } }
})()
