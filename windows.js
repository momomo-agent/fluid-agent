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
    })
    document.addEventListener('mouseup', () => { dragStart = null })

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
          const result = await Shell.execAsync(cmd)
          if (result === '\x1bclear') {
            output.innerHTML = ''
          } else if (result) {
            appendOutput(output, result, result.includes('not found') || result.includes('No such') ? 'error' : 'output')
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
      <div class="settings-section">
        <div class="settings-label">Voice</div>
        <label class="settings-toggle"><input type="checkbox" id="s-voice" ${saved.voice ? 'checked' : ''}> Enable voice input/output</label>
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
      }
      localStorage.setItem('fluid-settings', JSON.stringify(settings))
      Agent.configure(settings.provider, settings.apiKey, settings.model, settings.baseUrl)
      if (settings.voice) Voice?.enable()
      else Voice?.disable()
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
    windows.forEach((w, id) => {
      // Skip pinned app types
      if (['finder', 'terminal', 'settings'].includes(w.type) && !w.minimized) return
      const item = document.createElement('div')
      item.className = 'dock-item' + (w.minimized ? ' minimized' : '')
      item.title = w.el.querySelector('.window-title')?.textContent || w.type
      const icons = { editor: '📝', taskmanager: '📋', plan: '📌', image: '🖼️', finder: '📁', terminal: '⬛', settings: '⚙️' }
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

  // Update dock when windows change
  const origClose = close
  // Patch close to update dock
  const _close = (id) => { origClose(id); updateDock() }

  return { create, close: _close, focus, minimize, unminimize, toggleFullscreen, openFinder, openTerminal, openEditor, openPlan, updatePlan, openImage, openSettings, openTaskManager, addTask, updateTask, updateDock, windows, getState, closeByTitle, focusByTitle }
})()
