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

  function renderWindow(w) {
    const body = w.el.querySelector('.window-body')
    switch (w.type) {
      case 'finder': renderFinder(w, body); break
      case 'terminal': renderTerminal(w, body); break
      case 'editor': renderEditor(w, body); break
      case 'plan': renderPlan(w, body); break
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

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const cmd = input.value
        appendOutput(output, `user@fluid:${Shell.getCwd()}$ ${cmd}`, '')
        if (cmd.trim()) {
          const result = Shell.exec(cmd)
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

  // Refresh all finder windows when FS changes
  VFS.on((event, path) => {
    windows.forEach(w => {
      if (w.type === 'finder') {
        renderFinder(w, w.el.querySelector('.window-body'))
      }
    })
  })

  return { create, close, focus, openFinder, openTerminal, openEditor, openPlan, updatePlan, windows }
})()
