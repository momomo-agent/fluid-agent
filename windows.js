/* windows.js — macOS-style window manager */
const WindowManager = (() => {
  let nextId = 1
  let topZ = 100
  const windows = new Map()
  const area = () => document.getElementById('desktop-area')

  // --- Smart window placement: find least-overlapping position ---
  function findBestPosition(ww, wh, areaW, areaH) {
    const existing = []
    for (const [, win] of windows) {
      if (win.el.classList.contains('minimized') || win.el.classList.contains('fullscreen')) continue
      existing.push({
        x: win.el.offsetLeft, y: win.el.offsetTop,
        w: win.el.offsetWidth, h: win.el.offsetHeight
      })
    }
    if (existing.length === 0) {
      // Center first window
      return { x: Math.max(20, (areaW - ww) / 2), y: Math.max(20, (areaH - wh) / 3) }
    }
    // Try candidate positions: grid + offsets from existing windows
    const candidates = []
    const step = 60
    for (let gx = 20; gx <= areaW - ww; gx += step) {
      for (let gy = 20; gy <= areaH - wh; gy += step) {
        candidates.push({ x: gx, y: gy })
      }
    }
    // Also try positions offset from existing windows
    for (const e of existing) {
      candidates.push({ x: e.x + e.w + 20, y: e.y })
      candidates.push({ x: e.x, y: e.y + e.h + 20 })
      candidates.push({ x: e.x + 30, y: e.y + 30 })
    }
    let best = { x: Math.max(40, (areaW - ww) / 2), y: Math.max(40, (areaH - wh) / 3) }
    let bestScore = -Infinity
    for (const c of candidates) {
      if (c.x < 0 || c.y < 0 || c.x + ww > areaW || c.y + wh > areaH) continue
      let overlap = 0
      for (const e of existing) {
        const ox = Math.max(0, Math.min(c.x + ww, e.x + e.w) - Math.max(c.x, e.x))
        const oy = Math.max(0, Math.min(c.y + wh, e.y + e.h) - Math.max(c.y, e.y))
        overlap += ox * oy
      }
      // Bias toward center: penalize distance from center
      const cx = areaW / 2, cy = areaH / 2.5
      const dist = Math.sqrt(Math.pow(c.x + ww/2 - cx, 2) + Math.pow(c.y + wh/2 - cy, 2))
      const score = -overlap - dist * 0.3
      if (score > bestScore) { bestScore = score; best = c }
    }
    return best
  }

  function create({ type, title, x, y, width, height, data }) {
    const id = 'win-' + nextId++
    const w = document.createElement('div')
    w.className = 'window'
    w.id = id
    const desktopArea = document.getElementById('desktop-area')
    const areaW = desktopArea?.clientWidth || 800
    const areaH = desktopArea?.clientHeight || 600
    const ww = width || 500
    const wh = height || 350
    let cx, cy
    if (x !== undefined && y !== undefined) {
      cx = x; cy = y
    } else {
      const pos = findBestPosition(ww, wh, areaW, areaH)
      cx = pos.x; cy = pos.y
    }
    // Clamp to desktop bounds
    cx = Math.max(0, Math.min(cx, areaW - Math.min(ww, areaW)))
    cy = Math.max(0, Math.min(cy, areaH - Math.min(wh, areaH)))
    w.style.left = cx + 'px'
    w.style.top = cy + 'px'
    w.style.width = ww + 'px'
    w.style.height = wh + 'px'
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
      // Block inner content from stealing events during drag
      const body = w.querySelector('.window-body')
      if (body) body.style.pointerEvents = 'none'
    })
    titlebar.addEventListener('contextmenu', e => {
      e.preventDefault()
      e.stopPropagation()
      if (!window.showContextMenu) return
      const wData = windows.get(id)
      const isFs = w.classList.contains('fullscreen')
      const isMin = wData?.minimized
      window.showContextMenu(e.clientX, e.clientY, [
        { label: isFs ? 'Exit Fullscreen' : 'Fullscreen', action: () => toggleFullscreen(id) },
        { label: 'Minimize', action: () => minimize(id) },
        '---',
        { label: 'Tile Left', action: () => { const a = document.getElementById('desktop-area'); const h = a.offsetHeight; Object.assign(w.style, { left: '0', top: '0', width: a.offsetWidth/2+'px', height: h+'px' }) } },
        { label: 'Tile Right', action: () => { const a = document.getElementById('desktop-area'); const h = a.offsetHeight; Object.assign(w.style, { left: a.offsetWidth/2+'px', top: '0', width: a.offsetWidth/2+'px', height: h+'px' }) } },
        '---',
        { label: 'Close', action: () => _close(id) },
      ])
    })
    document.addEventListener('mousemove', e => {
      if (!dragStart) return
      const area = document.getElementById('desktop-area')
      const areaRect = area?.getBoundingClientRect() || { left: 0, top: 0, right: 800, bottom: 600 }
      let nx = e.clientX - dragStart.x
      let ny = e.clientY - dragStart.y
      // Keep at least 100px visible horizontally and titlebar visible vertically
      nx = Math.max(-(w.offsetWidth - 100), Math.min(nx, areaRect.width - 100))
      ny = Math.max(0, Math.min(ny, areaRect.height - 40))
      w.style.left = nx + 'px'
      w.style.top = ny + 'px'
      // Snap preview
      if (window._snapHelpers) {
        const zone = window._snapHelpers.getSnapZone(e.clientX, e.clientY)
        window._snapHelpers.showSnapPreview(zone)
      }
    })
    document.addEventListener('mouseup', (e) => {
      if (dragStart) {
        const body = w.querySelector('.window-body')
        if (body) body.style.pointerEvents = ''
        if (window._snapHelpers) {
          const zone = window._snapHelpers.getSnapZone(e.clientX, e.clientY)
          if (zone) window._snapHelpers.applySnap(zone, w)
          window._snapHelpers.hideSnapPreview()
        }
      }
      dragStart = null
    })

    // Resize
    const resizeHandle = w.querySelector('.window-resize')
    let resizeStart = null
    const winBody = w.querySelector('.window-body')
    resizeHandle.addEventListener('mousedown', e => {
      e.stopPropagation()
      e.preventDefault()
      resizeStart = { x: e.clientX, y: e.clientY, w: w.offsetWidth, h: w.offsetHeight }
      // Block inner content (map/iframe) from stealing events
      if (winBody) winBody.style.pointerEvents = 'none'
    })
    document.addEventListener('mousemove', e => {
      if (!resizeStart) return
      w.style.width = Math.max(300, resizeStart.w + e.clientX - resizeStart.x) + 'px'
      w.style.height = Math.max(200, resizeStart.h + e.clientY - resizeStart.y) + 'px'
    })
    document.addEventListener('mouseup', () => {
      if (resizeStart && winBody) winBody.style.pointerEvents = ''
      resizeStart = null
    })

    desktopArea.appendChild(w)
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
      el.addEventListener('contextmenu', (ev) => {
        const name = el.dataset.path
        if (name === '..') return
        ev.preventDefault()
        ev.stopPropagation()
        if (!window.showContextMenu) return
        const type = el.dataset.type
        const fullPath = VFS.normPath(path + '/' + name)
        const items = []
        if (type === 'dir') {
          items.push({ label: 'Open', action: () => { w.data.path = fullPath; w.el.querySelector('.window-title').textContent = name; renderFinder(w, body) } })
        } else {
          items.push({ label: 'Open', action: () => openEditor(fullPath) })
        }
        items.push({ label: 'Copy Path', action: () => navigator.clipboard?.writeText(fullPath) })
        items.push('---')
        items.push({ label: 'Rename', action: () => {
          const newName = prompt('Rename to:', name)
          if (newName && newName !== name) {
            const content = VFS.readFile(fullPath)
            const newPath = VFS.normPath(path + '/' + newName)
            if (content != null) { VFS.writeFile(newPath, content); VFS.rm(fullPath) }
            else if (VFS.isDir(fullPath)) { VFS.mkdir(newPath); VFS.rm(fullPath) }
            renderFinder(w, body)
          }
        }})
        items.push({ label: 'Delete', action: () => {
          if (confirm(`Delete ${name}?`)) { VFS.rm(fullPath); renderFinder(w, body) }
        }})
        window.showContextMenu(ev.clientX, ev.clientY, items)
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
  // ── Lightweight Markdown parser ──
  function parseMd(src) {
    let html = escapeHtml(src)
    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre class="md-code-block"><code>${code.trim()}</code></pre>`)
    // Headings
    html = html.replace(/^(#{1,6})\s+(.+)$/gm, (_, h, text) => {
      const level = h.length
      return `<div class="md-h md-h${level}">${text}</div>`
    })
    // Blockquote
    html = html.replace(/^&gt;\s?(.+)$/gm, '<div class="md-blockquote">$1</div>')
    // Horizontal rule
    html = html.replace(/^(---|\.{3}|\*\*\*)$/gm, '<hr class="md-hr">')
    // Bold + italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')
    // Strikethrough
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>')
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="md-link">$1</a>')
    // Images
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<span class="md-image">🖼 $1</span>')
    // Unordered list
    html = html.replace(/^(\s*)[-*+]\s+(.+)$/gm, (_, indent, text) => {
      const depth = Math.floor(indent.length / 2)
      return `<div class="md-li" style="padding-left:${12 + depth * 16}px">• ${text}</div>`
    })
    // Ordered list
    html = html.replace(/^(\s*)(\d+)\.\s+(.+)$/gm, (_, indent, num, text) => {
      const depth = Math.floor(indent.length / 2)
      return `<div class="md-li" style="padding-left:${12 + depth * 16}px">${num}. ${text}</div>`
    })
    // Checkbox
    html = html.replace(/\[x\]/gi, '<span class="md-check done">☑</span>')
    html = html.replace(/\[ \]/g, '<span class="md-check">☐</span>')
    // Paragraphs (double newline)
    html = html.replace(/\n\n/g, '<div class="md-blank"></div>')
    html = html.replace(/\n/g, '<br>')
    return html
  }

  function renderEditor(w, body) {
    const path = w.data.path || ''
    const content = VFS.readFile(path) || ''
    const isMd = path.endsWith('.md') || path.endsWith('.markdown')

    body.innerHTML = `<div class="editor-body">
      <div class="editor-toolbar">
        <span class="editor-filename">${path.split('/').pop()}</span>
        ${isMd ? '<button class="editor-toggle" data-mode="preview">Edit</button>' : ''}
      </div>
      ${isMd ? `<div class="editor-preview md-body">${parseMd(content)}</div>` : ''}
      <textarea class="editor-textarea ${isMd ? 'hidden' : ''}">${escapeHtml(content)}</textarea>
    </div>`

    const textarea = body.querySelector('.editor-textarea')
    const preview = body.querySelector('.editor-preview')
    const toggle = body.querySelector('.editor-toggle')
    let mode = isMd ? 'preview' : 'edit'

    if (toggle) {
      toggle.addEventListener('click', () => {
        if (mode === 'preview') {
          mode = 'edit'
          textarea.classList.remove('hidden')
          if (preview) preview.classList.add('hidden')
          toggle.textContent = 'Preview'
          toggle.dataset.mode = 'edit'
          textarea.focus()
        } else {
          mode = 'preview'
          textarea.classList.add('hidden')
          if (preview) {
            preview.innerHTML = parseMd(textarea.value)
            preview.classList.remove('hidden')
          }
          toggle.textContent = 'Edit'
          toggle.dataset.mode = 'preview'
        }
      })
    }

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
        if (preview && mode === 'preview') preview.innerHTML = parseMd(textarea.value)
      }
    })

    // Double-click preview to edit
    if (preview) {
      preview.addEventListener('dblclick', () => {
        if (toggle) toggle.click()
      })
    }
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
  // Standard window sizes
  const SIZE = {
    small:  { width: 420, height: 360 },
    medium: { width: 560, height: 400 },
    large:  { width: 640, height: 460 },
  }

  function openFinder(path) {
    return create({ type: 'finder', title: path.split('/').pop() || '/', ...SIZE.medium, data: { path } })
  }

  function openTerminal() {
    return create({ type: 'terminal', title: 'Terminal', ...SIZE.medium })
  }

  function openEditor(path) {
    return create({ type: 'editor', title: path.split('/').pop(), ...SIZE.medium, data: { path } })
  }

  function openPlan(goal, steps) {
    return create({ type: 'plan', title: 'Plan', ...SIZE.small, data: { goal, steps } })
  }

  let taskManagerId = null
  const taskHistory = [] // { id, goal, steps, status, log, startTime }

  function openTaskManager() {
    if (taskManagerId && windows.has(taskManagerId)) {
      focus(taskManagerId)
      return taskManagerId
    }
    taskManagerId = create({ type: 'taskmanager', title: 'Task Manager', ...SIZE.medium })
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
            <span class="tm-step-icon">${s.status === 'done' ? '✓' : s.status === 'running' ? '▶' : s.status === 'aborted' ? '✕' : s.status === 'error' ? '✕' : '○'}</span>
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
    const areaEl = document.getElementById('desktop-area')
    return {
      desktop: { width: areaEl?.clientWidth || 0, height: areaEl?.clientHeight || 0 },
      windows: [...windows.values()].map(w => ({
        id: w.id,
        type: w.type,
        title: w.el.querySelector('.window-title')?.textContent || w.type,
        focused: w.el.classList.contains('focused'),
        minimized: w.el.classList.contains('minimized'),
        fullscreen: w.el.classList.contains('fullscreen'),
        x: w.el.offsetLeft,
        y: w.el.offsetTop,
        width: w.el.offsetWidth,
        height: w.el.offsetHeight,
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
    settingsId = create({ type: 'settings', title: 'Settings', ...SIZE.small })
    return settingsId
  }

  function renderSettings(w, body) {
    const store = window._store
    const savedP = store ? store.get('settings') : Promise.resolve(null)
    savedP.then(saved => {
    saved = saved || {}
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
      <div class="settings-group-title">Web</div>
      <div class="settings-section">
        <div class="settings-label">Tavily API Key (for web search)</div>
        <input class="settings-input" id="s-tavily" type="text" placeholder="tvly-..." value="${saved.tavilyKey || ''}">
      </div>
      <div class="settings-divider"></div>
      <div class="settings-group-title">Movies</div>
      <div class="settings-section">
        <div class="settings-label">TMDB API Key (for movie/TV search)</div>
        <input class="settings-input" id="s-tmdb" type="text" placeholder="TMDB v3 API key" value="${saved.tmdbKey || ''}">
        <div class="settings-hint">Free at themoviedb.org</div>
      </div>
      <div class="settings-divider"></div>
      <div class="settings-group-title">Image Generation</div>
      <div class="settings-section">
        <div class="settings-label">Image API Base URL</div>
        <input class="settings-input" id="s-imgbase" type="text" placeholder="https://api.openai.com" value="${saved.imageBaseUrl || ''}">
      </div>
      <div class="settings-section">
        <div class="settings-label">Image API Key</div>
        <input class="settings-input" id="s-imgkey" type="text" placeholder="sk-..." value="${saved.imageApiKey || ''}">
      </div>
      <div class="settings-section">
        <div class="settings-label">Image Model</div>
        <input class="settings-input" id="s-imgmodel" type="text" placeholder="dall-e-3" value="${saved.imageModel || ''}">
      </div>
      <div class="settings-divider"></div>
      <div class="settings-group-title">Voice</div>
      <div class="settings-section">
        <label class="settings-toggle"><input type="checkbox" id="s-voice" ${saved.voice ? 'checked' : ''}> Enable voice (Web Speech API free, or ElevenLabs premium)</label>
        <div class="settings-hint">Without API key: uses browser's built-in speech recognition. Hold mic button = push-to-talk.</div>
      </div>
      <div class="settings-section">
        <div class="settings-label">ElevenLabs API Key (optional, for premium voice)</div>
        <input class="settings-input" id="s-elkey" type="text" placeholder="sk_..." value="${saved.elevenLabsKey || ''}">
      </div>
      <div class="settings-section">
        <div class="settings-label">Voice</div>
        <select class="settings-input" id="s-elvoice" style="height:36px">
          <option value="">Enter API key to load voices...</option>
        </select>
        <div id="s-elvoice-preview" style="margin-top:6px"></div>
      </div>
      <button class="settings-save" id="s-save">Save & Apply</button>
    </div>`

    // --- ElevenLabs voice picker ---
    const elKeyInput = body.querySelector('#s-elkey')
    const elVoiceSelect = body.querySelector('#s-elvoice')
    const elPreview = body.querySelector('#s-elvoice-preview')
    let voicesCache = null

    async function loadVoices(apiKey) {
      if (!apiKey) {
        elVoiceSelect.innerHTML = '<option value="">Enter API key to load voices...</option>'
        elPreview.innerHTML = ''
        return
      }
      elVoiceSelect.innerHTML = '<option value="">Loading voices...</option>'
      try {
        const res = await fetch('https://api.elevenlabs.io/v1/voices', {
          headers: { 'xi-api-key': apiKey }
        })
        if (!res.ok) throw new Error(res.status)
        const data = await res.json()
        voicesCache = data.voices || []
        elVoiceSelect.innerHTML = voicesCache.map(v => {
          const labels = v.labels ? Object.values(v.labels).filter(Boolean).join(', ') : ''
          return `<option value="${v.voice_id}" ${v.voice_id === (saved.elevenLabsVoice || '') ? 'selected' : ''}>${v.name}${labels ? ' — ' + labels : ''}</option>`
        }).join('')
        if (!voicesCache.length) elVoiceSelect.innerHTML = '<option value="">No voices found</option>'
        updatePreview()
      } catch (e) {
        elVoiceSelect.innerHTML = '<option value="">Failed to load voices</option>'
        elPreview.innerHTML = ''
      }
    }

    function updatePreview() {
      const id = elVoiceSelect.value
      const voice = voicesCache?.find(v => v.voice_id === id)
      if (voice) {
        const labels = voice.labels ? Object.entries(voice.labels).map(([k,v]) => `${k}: ${v}`).join(' · ') : ''
        elPreview.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">${labels || voice.category || ''}</span>`
      } else elPreview.innerHTML = ''
    }

    elVoiceSelect.addEventListener('change', updatePreview)
    // Debounced key input → reload voices
    let keyTimer = null
    elKeyInput.addEventListener('input', () => {
      clearTimeout(keyTimer)
      keyTimer = setTimeout(() => loadVoices(elKeyInput.value.trim()), 600)
    })
    // Load on open if key exists
    if (saved.elevenLabsKey) loadVoices(saved.elevenLabsKey)

    body.querySelector('#s-save').addEventListener('click', async () => {
      const settings = {
        provider: body.querySelector('#s-provider').value,
        apiKey: body.querySelector('#s-apikey').value,
        model: body.querySelector('#s-model').value,
        baseUrl: body.querySelector('#s-baseurl').value,
        voice: body.querySelector('#s-voice').checked,
        tavilyKey: body.querySelector('#s-tavily').value,
        tmdbKey: body.querySelector('#s-tmdb').value,
        imageBaseUrl: body.querySelector('#s-imgbase').value,
        imageApiKey: body.querySelector('#s-imgkey').value,
        imageModel: body.querySelector('#s-imgmodel').value,
        elevenLabsKey: body.querySelector('#s-elkey').value,
        elevenLabsVoice: body.querySelector('#s-elvoice').value,
      }
      if (store) await store.set('settings', settings)
      window._settingsCache = settings
      Agent.configure(settings.provider, settings.apiKey, settings.model, settings.baseUrl, store)
      if (settings.voice) Voice?.enable()
      else Voice?.disable()
      Agent.startProactiveLoop()
      showActivity('Settings saved')
    })
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

    // Update running dots on pinned dock items
    const pinnedItems = document.querySelectorAll('.dock-pinned .dock-item')
    const runningTypes = new Set()
    windows.forEach(w => { runningTypes.add(w.type) })
    pinnedItems.forEach(item => {
      const app = item.dataset.app
      item.querySelector('.dock-running-dot')?.remove()
      // Map dock app names to window types
      const typeMap = { finder: 'finder', terminal: 'terminal', browser: 'browser', music: 'music', video: 'video', map: 'map', settings: 'settings' }
      const wType = typeMap[app]
      if (wType && runningTypes.has(wType)) {
        const dot = document.createElement('div')
        dot.className = 'dock-running-dot'
        item.appendChild(dot)
      }
    })

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
      if (['finder', 'terminal', 'settings', 'music', 'video', 'browser', 'map', 'app'].includes(w.type) && !w.minimized) return
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
    musicId = create({ type: 'music', title: 'Music', ...SIZE.small })
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
    const id = create({ type: 'video', title: title || 'Video Player', ...SIZE.medium, data: { url: url || '' } })
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
    const id = create({ type: 'browser', title: 'Browser', ...SIZE.large, data: { url: url || '' } })
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
    mapId = create({ type: 'map', title: 'Map', ...SIZE.medium, data: { lat: lat || 39.9042, lng: lng || 116.4074, zoom: zoom || 12, markers: [], route: null } })
    updateDock()
    return mapId
  }

  // External API for agent to control map
  function mapAddMarker(lat, lng, label, color) {
    const w = mapId && windows.get(mapId)
    if (!w) return false
    if (!w.data.markers) w.data.markers = []
    w.data.markers.push({ lat, lng, label: label || '', color: color || 'blue' })
    const iframe = w.el.querySelector('.window-body iframe')
    if (iframe?.contentWindow?.addMarker) iframe.contentWindow.addMarker(lat, lng, label, color)
    return true
  }

  function mapClearMarkers() {
    const w = mapId && windows.get(mapId)
    if (!w) return false
    w.data.markers = []
    const iframe = w.el.querySelector('.window-body iframe')
    if (iframe?.contentWindow?.clearMarkers) iframe.contentWindow.clearMarkers()
    return true
  }

  function mapShowRoute(from, to) {
    const w = mapId && windows.get(mapId)
    if (!w) return false
    w.data.route = { from, to }
    const iframe = w.el.querySelector('.window-body iframe')
    if (iframe?.contentWindow?.showRoute) iframe.contentWindow.showRoute(from, to)
    return true
  }

  function mapClearRoute() {
    const w = mapId && windows.get(mapId)
    if (!w) return false
    w.data.route = null
    const iframe = w.el.querySelector('.window-body iframe')
    if (iframe?.contentWindow?.clearRoute) iframe.contentWindow.clearRoute()
    return true
  }

  function renderMap(w, body) {
    const { lat, lng, zoom, markers, route } = w.data || { lat: 39.9042, lng: 116.4074, zoom: 12, markers: [], route: null }
    const markersJson = JSON.stringify(markers || [])
    const routeJson = JSON.stringify(route || null)
    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #map { width: 100%; height: 100%; }
.search-bar { position: absolute; top: 10px; left: 50px; right: 10px; z-index: 1000; display: flex; gap: 6px; }
.search-bar input { flex: 1; padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(22,27,38,0.9); color: #e2e8f0; font-size: 13px; backdrop-filter: blur(8px); outline: none; }
.search-bar input:focus { border-color: #60a5fa; }
.search-bar button { padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(22,27,38,0.9); color: #94a3b8; font-size: 13px; cursor: pointer; backdrop-filter: blur(8px); }
.search-bar button:hover { background: rgba(40,50,70,0.9); color: #e2e8f0; }
.coords { position: absolute; bottom: 8px; left: 8px; z-index: 1000; background: rgba(22,27,38,0.85); color: #94a3b8; padding: 4px 8px; border-radius: 6px; font-size: 11px; backdrop-filter: blur(8px); }
.marker-count { position: absolute; bottom: 8px; right: 8px; z-index: 1000; background: rgba(22,27,38,0.85); color: #94a3b8; padding: 4px 8px; border-radius: 6px; font-size: 11px; backdrop-filter: blur(8px); }
</style></head><body>
<div class="search-bar">
  <input id="search" placeholder="Search location..." />
  <button id="btn-pin" title="Drop pin at center">📍</button>
  <button id="btn-clear" title="Clear all markers">🗑</button>
</div>
<div id="map"></div>
<div class="coords" id="coords">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
<div class="marker-count" id="marker-count"></div>
<script>
var map = L.map('map', { zoomControl: false }).setView([${lat}, ${lng}], ${zoom});
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '\u00a9 OpenStreetMap', maxZoom: 19
}).addTo(map);

var markers = [];
var routeLine = null;
var markerColors = {
  red: '#ef4444', blue: '#3b82f6', green: '#22c55e', orange: '#f97316',
  purple: '#a855f7', pink: '#ec4899', yellow: '#eab308'
};

function makeIcon(color) {
  var c = markerColors[color] || markerColors.blue;
  return L.divIcon({
    className: '',
    html: '<div style="width:24px;height:24px;border-radius:50% 50% 50% 0;background:'+c+';transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>',
    iconSize: [24, 24], iconAnchor: [12, 24], popupAnchor: [0, -24]
  });
}

function addMarker(lat, lng, label, color) {
  var m = L.marker([lat, lng], { icon: makeIcon(color || 'blue') }).addTo(map);
  if (label) m.bindPopup(label);
  markers.push(m);
  updateCount();
  return m;
}

function clearMarkers() {
  markers.forEach(function(m) { map.removeLayer(m); });
  markers = [];
  updateCount();
}

function updateCount() {
  var el = document.getElementById('marker-count');
  el.textContent = markers.length > 0 ? markers.length + ' pin' + (markers.length > 1 ? 's' : '') : '';
}

function showRoute(from, to) {
  clearRoute();
  // Use OSRM for routing
  var url = 'https://router.project-osrm.org/route/v1/driving/' +
    from.lng + ',' + from.lat + ';' + to.lng + ',' + to.lat +
    '?overview=full&geometries=geojson';
  fetch(url).then(function(r) { return r.json(); }).then(function(data) {
    if (data.routes && data.routes.length > 0) {
      var coords = data.routes[0].geometry.coordinates.map(function(c) { return [c[1], c[0]]; });
      routeLine = L.polyline(coords, { color: '#3b82f6', weight: 4, opacity: 0.8 }).addTo(map);
      map.fitBounds(routeLine.getBounds(), { padding: [40, 40] });
      // Show distance and duration
      var dist = data.routes[0].distance;
      var dur = data.routes[0].duration;
      var distStr = dist > 1000 ? (dist/1000).toFixed(1) + ' km' : Math.round(dist) + ' m';
      var durStr = dur > 3600 ? Math.floor(dur/3600) + 'h ' + Math.round((dur%3600)/60) + 'min' : Math.round(dur/60) + ' min';
      routeLine.bindPopup(distStr + ' \u00b7 ' + durStr).openPopup();
    }
  }).catch(function() {});
}

function clearRoute() {
  if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
}

// Load initial markers
var initMarkers = ${markersJson};
initMarkers.forEach(function(m) { addMarker(m.lat, m.lng, m.label, m.color); });

// Load initial route
var initRoute = ${routeJson};
if (initRoute) showRoute(initRoute.from, initRoute.to);

// Click to add marker
map.on('click', function(e) {
  addMarker(e.latlng.lat, e.latlng.lng, '', 'blue');
});

map.on('mousemove', function(e) {
  document.getElementById('coords').textContent = e.latlng.lat.toFixed(4) + ', ' + e.latlng.lng.toFixed(4);
});

// Pin button: drop at center
document.getElementById('btn-pin').addEventListener('click', function() {
  var c = map.getCenter();
  addMarker(c.lat, c.lng, 'Pin', 'red');
});

// Clear button
document.getElementById('btn-clear').addEventListener('click', function() {
  clearMarkers();
  clearRoute();
});

// Search
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
        addMarker(lat, lon, data[0].display_name, 'red');
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
  let _store = null

  // Persist apps via store
  async function saveApps() {
    if (!_store) return
    const obj = {}
    for (const [k, v] of installedApps) obj[k] = v
    await _store.set('apps', obj)
  }
  async function loadApps(store) {
    _store = store
    if (!store) return
    const saved = await store.get('apps')
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
    const id = create({ type: 'app', title: name, width: app.width || SIZE.small.width, height: app.height || SIZE.small.height, data: { name, html: app.html, css: app.css, js: app.js } })
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
  let _sessionStore = null
  let _sessionTimer = null

  function saveSession() {
    if (!_sessionStore) return
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
      _sessionStore.set('session', snapshot)
    }, 500)
  }

  async function restoreSession(store) {
    _sessionStore = store
    if (!store) return false
    const snapshot = await store.get('session')
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
  document.addEventListener('mouseup', () => { if (_sessionStore) saveSession() })

  // --- Programmatic window manipulation ---
  function findByTitle(title) {
    const t = title.toLowerCase()
    for (const [id, w] of windows) {
      const wTitle = w.el.querySelector('.window-title')?.textContent?.toLowerCase() || ''
      const wType = (w.type || '').toLowerCase()
      if (wTitle.includes(t) || wType.includes(t)) return id
    }
    return null
  }

  function moveWindow(title, x, y) {
    const id = findByTitle(title)
    if (!id) return false
    const w = windows.get(id)
    if (!w) return false
    w.el.style.left = x + 'px'
    w.el.style.top = y + 'px'
    return true
  }

  function resizeWindow(title, width, height) {
    const id = findByTitle(title)
    if (!id) return false
    const w = windows.get(id)
    if (!w) return false
    if (width) w.el.style.width = width + 'px'
    if (height) w.el.style.height = height + 'px'
    return true
  }

  function minimizeByTitle(title) {
    const id = findByTitle(title)
    if (!id) return false
    minimize(id)
    return true
  }

  function maximizeByTitle(title) {
    const id = findByTitle(title)
    if (!id) return false
    toggleFullscreen(id)
    return true
  }

  function unminimizeByTitle(title) {
    const id = findByTitle(title)
    if (!id) return false
    unminimize(id)
    return true
  }

  function tileWindows(layout) {
    const area = document.getElementById('desktop-area')
    const aW = area?.clientWidth || 800
    const aH = area?.clientHeight || 600
    const ids = [...windows.keys()].filter(id => {
      const w = windows.get(id)
      return w && !w.el.classList.contains('minimized')
    })
    if (ids.length === 0) return false
    if (layout === 'horizontal') {
      const w = Math.floor(aW / ids.length)
      ids.forEach((id, i) => {
        const win = windows.get(id)
        win.el.style.left = (i * w) + 'px'
        win.el.style.top = '0px'
        win.el.style.width = w + 'px'
        win.el.style.height = aH + 'px'
      })
    } else if (layout === 'grid') {
      const cols = Math.ceil(Math.sqrt(ids.length))
      const rows = Math.ceil(ids.length / cols)
      const cw = Math.floor(aW / cols)
      const ch = Math.floor(aH / rows)
      ids.forEach((id, i) => {
        const win = windows.get(id)
        const col = i % cols
        const row = Math.floor(i / cols)
        win.el.style.left = (col * cw) + 'px'
        win.el.style.top = (row * ch) + 'px'
        win.el.style.width = cw + 'px'
        win.el.style.height = ch + 'px'
      })
    } else {
      // vertical (default)
      const h = Math.floor(aH / ids.length)
      ids.forEach((id, i) => {
        const win = windows.get(id)
        win.el.style.left = '0px'
        win.el.style.top = (i * h) + 'px'
        win.el.style.width = aW + 'px'
        win.el.style.height = h + 'px'
      })
    }
    return true
  }

  // --- Music: add track dynamically ---
  const SYNTH_STYLES = {
    dreamy:   { wave: 'sine',     filterFreq: 800,  attack: 0.05, release: 0.3,  tempo: 110, colors: ['#60a5fa','#818cf8','#a78bfa'] },
    bright:   { wave: 'square',   filterFreq: 1200, attack: 0.01, release: 0.15, tempo: 135, colors: ['#fbbf24','#f59e0b','#fb923c'] },
    gentle:   { wave: 'triangle', filterFreq: 600,  attack: 0.1,  release: 0.5,  tempo: 85,  colors: ['#34d399','#6ee7b7','#a7f3d0'] },
    moody:    { wave: 'sawtooth', filterFreq: 900,  attack: 0.02, release: 0.25, tempo: 95,  colors: ['#f472b6','#e879f9','#c084fc'] },
    playful:  { wave: 'triangle', filterFreq: 1500, attack: 0.01, release: 0.2,  tempo: 130, colors: ['#38bdf8','#22d3ee','#2dd4bf'] },
  }
  const SCALE_NOTES = ['C4','D4','E4','F4','G4','A4','B4','C5','D5','E5']
  const BASS_NOTES = ['C3','D3','E3','F3','G3','A3']

  function generateMelody(len) {
    const m = []; for (let i = 0; i < len; i++) m.push(SCALE_NOTES[Math.floor(Math.random() * SCALE_NOTES.length)])
    return m
  }
  function generateBass(len) {
    const b = []; for (let i = 0; i < len; i++) b.push(BASS_NOTES[Math.floor(Math.random() * BASS_NOTES.length)])
    return b
  }

  function musicAddTrack({ title, artist, style }) {
    if (!title) return { error: 'title is required' }
    const s = SYNTH_STYLES[style] || SYNTH_STYLES.dreamy
    const trackDef = {
      melody: generateMelody(16),
      bass: generateBass(8),
      tempo: s.tempo + Math.floor(Math.random() * 20 - 10),
      wave: s.wave, filterFreq: s.filterFreq, attack: s.attack, release: s.release,
    }
    const synthIdx = AudioSynth.addTrack(trackDef)
    const color = s.colors[Math.floor(Math.random() * s.colors.length)]
    const entry = { title: title || 'Untitled', artist: artist || 'FluidOS', color, duration: Math.floor(AudioSynth.getDuration(synthIdx)) }
    musicState.playlist.push(entry)
    const idx = musicState.playlist.length - 1
    musicRerender()
    return { index: idx }
  }

  return { create, close: _close, focus, minimize, unminimize, toggleFullscreen, openFinder, openTerminal, openEditor, openPlan, updatePlan, openImage, openSettings, openMusic, openVideo, openBrowser, openMap, openApp, uninstallApp, getInstalledApps, openTaskManager, addTask, updateTask, updateDock, windows, getState, closeByTitle, focusByTitle, loadApps, restoreSession, saveSession, mapAddMarker, mapClearMarkers, mapShowRoute, mapClearRoute, moveWindow, resizeWindow, minimizeByTitle, maximizeByTitle, unminimizeByTitle, tileWindows, musicAddTrack, getTaskHistory() { return taskHistory }, getFocused() { for (const [id, w] of windows) { if (w.el.classList.contains('focused')) return id } return null } }
})()
