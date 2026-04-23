/* wm-builtins.js — Built-in app renderers */
;(() => {
  const WM = WindowManager
  const { windows, renderWindow, updateDock, SIZE } = WM._internal

function renderFinder(w, body) {
  const path = w.data.path || '/home/user/Desktop'
  // Initialize navigation history
  if (!w.data.history) w.data.history = [path]
  if (!w.data.historyIdx) w.data.historyIdx = 0
  if (!w.data.viewMode) w.data.viewMode = 'grid'
  const items = VFS.ls(path) || []

  // Sidebar favorites
  const favorites = [
    { name: 'Desktop', path: '/home/user/Desktop', icon: '🖥️' },
    { name: 'Documents', path: '/home/user/Documents', icon: '📄' },
    { name: 'Downloads', path: '/home/user/Downloads', icon: '📥' },
  ]
  const locations = [
    { name: 'Home', path: '/home/user', icon: '🏠' },
  ]

  // Breadcrumb segments
  const segments = path === '/' ? ['/'] : path.split('/').filter(Boolean)

  body.innerHTML = `
    <div class="finder-layout">
      <div class="finder-sidebar">
        <div class="finder-sidebar-section">Favorites</div>
        ${favorites.map(f => `<div class="finder-sidebar-item ${path === f.path ? 'active' : ''}" data-path="${f.path}">${f.icon} ${f.name}</div>`).join('')}
        <div class="finder-sidebar-section">Locations</div>
        ${locations.map(f => `<div class="finder-sidebar-item ${path === f.path ? 'active' : ''}" data-path="${f.path}">${f.icon} ${f.name}</div>`).join('')}
      </div>
      <div class="finder-main">
        <div class="finder-toolbar">
          <button class="finder-nav-btn" id="finder-back" ${w.data.historyIdx <= 0 ? 'disabled' : ''}>◀</button>
          <button class="finder-nav-btn" id="finder-forward" ${w.data.historyIdx >= w.data.history.length - 1 ? 'disabled' : ''}>▶</button>
          <div class="finder-breadcrumb">
            ${path === '/' ? '<span class="finder-crumb" data-path="/">/</span>' : segments.map((seg, i) => {
              const segPath = '/' + segments.slice(0, i + 1).join('/')
              return `<span class="finder-crumb" data-path="${segPath}">${seg}</span>`
            }).join('<span class="finder-crumb-sep">/</span>')}
          </div>
          <button class="finder-view-btn" id="finder-view-toggle" title="Toggle view">${w.data.viewMode === 'grid' ? '☰' : '⊞'}</button>
        </div>
        ${w.data.viewMode === 'list' ? `
          <div class="finder-list">
            <div class="finder-list-header">
              <span class="finder-list-col finder-col-name" data-sort="name">Name</span>
              <span class="finder-list-col finder-col-size" data-sort="size">Size</span>
              <span class="finder-list-col finder-col-date" data-sort="date">Modified</span>
            </div>
            ${path !== '/' ? `<div class="finder-list-row" data-path=".." data-type="dir">
              <span class="finder-list-col finder-col-name">⬆️ ..</span>
              <span class="finder-list-col finder-col-size">—</span>
              <span class="finder-list-col finder-col-date">—</span>
            </div>` : ''}
            ${items.map(i => `
              <div class="finder-list-row ${w.data.selected === i.name ? 'finder-selected' : ''}" data-path="${i.name}" data-type="${i.type}">
                <span class="finder-list-col finder-col-name">${i.type === 'dir' ? '📁' : fileIcon(i.name)} ${i.name}</span>
                <span class="finder-list-col finder-col-size">${i.type === 'dir' ? '—' : (i.size != null ? formatSize(i.size) : '—')}</span>
                <span class="finder-list-col finder-col-date">${i.modified ? new Date(i.modified).toLocaleDateString() : '—'}</span>
              </div>
            `).join('')}
          </div>
        ` : `
          <div class="finder-grid">
            ${path !== '/' ? '<div class="finder-item" data-path=".."><div class="icon">⬆️</div><div class="name">..</div></div>' : ''}
            ${items.map(i => `
              <div class="finder-item ${w.data.selected === i.name ? 'finder-selected' : ''}" data-path="${i.name}" data-type="${i.type}">
                <div class="icon">${i.type === 'dir' ? '📁' : fileIcon(i.name)}</div>
                <div class="name">${i.name}</div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </div>
  `

  function navigateTo(newPath) {
    w.data.path = newPath
    // Update history
    w.data.history = w.data.history.slice(0, w.data.historyIdx + 1)
    w.data.history.push(newPath)
    w.data.historyIdx = w.data.history.length - 1
    w.data.selected = null
    w.el.querySelector('.window-title').textContent = newPath.split('/').pop() || '/'
    renderFinder(w, body)
  }

  // Sidebar navigation
  body.querySelectorAll('.finder-sidebar-item').forEach(el => {
    el.addEventListener('click', () => navigateTo(el.dataset.path))
  })

  // Back/Forward
  body.querySelector('#finder-back')?.addEventListener('click', () => {
    if (w.data.historyIdx > 0) {
      w.data.historyIdx--
      w.data.path = w.data.history[w.data.historyIdx]
      w.data.selected = null
      w.el.querySelector('.window-title').textContent = w.data.path.split('/').pop() || '/'
      renderFinder(w, body)
    }
  })
  body.querySelector('#finder-forward')?.addEventListener('click', () => {
    if (w.data.historyIdx < w.data.history.length - 1) {
      w.data.historyIdx++
      w.data.path = w.data.history[w.data.historyIdx]
      w.data.selected = null
      w.el.querySelector('.window-title').textContent = w.data.path.split('/').pop() || '/'
      renderFinder(w, body)
    }
  })

  // Breadcrumb navigation
  body.querySelectorAll('.finder-crumb').forEach(el => {
    el.addEventListener('click', () => navigateTo(el.dataset.path))
  })

  // View toggle
  body.querySelector('#finder-view-toggle')?.addEventListener('click', () => {
    w.data.viewMode = w.data.viewMode === 'grid' ? 'list' : 'grid'
    renderFinder(w, body)
  })

  // File items (both grid and list)
  const fileItems = body.querySelectorAll('.finder-item, .finder-list-row')
  fileItems.forEach(el => {
    // Single click = select
    el.addEventListener('click', (e) => {
      const name = el.dataset.path
      if (name === '..') return
      w.data.selected = name
      // Update selection visuals without full re-render
      fileItems.forEach(fi => fi.classList.remove('finder-selected'))
      el.classList.add('finder-selected')
    })

    // Double click = open
    el.addEventListener('dblclick', () => {
      const name = el.dataset.path
      const type = el.dataset.type
      if (name === '..') {
        const parent = path.split('/').slice(0, -1).join('/') || '/'
        navigateTo(parent)
      } else if (type === 'dir') {
        navigateTo(VFS.normPath(path + '/' + name))
      } else {
        openEditor(VFS.normPath(path + '/' + name))
      }
    })

    // Context menu
    el.addEventListener('contextmenu', (ev) => {
      const name = el.dataset.path
      if (name === '..') return
      ev.preventDefault()
      ev.stopPropagation()
      if (!window.showContextMenu) return
      const type = el.dataset.type
      const fullPath = VFS.normPath(path + '/' + name)
      const menuItems = []
      if (type === 'dir') {
        menuItems.push({ label: 'Open', action: () => navigateTo(fullPath) })
      } else {
        menuItems.push({ label: 'Open', action: () => openEditor(fullPath) })
      }
      menuItems.push({ label: 'Copy Path', action: () => navigator.clipboard?.writeText(fullPath) })
      menuItems.push('---')
      menuItems.push({ label: 'Rename', action: () => {
        const newName = prompt('Rename to:', name)
        if (newName && newName !== name) {
          const content = VFS.readFile(fullPath)
          const newPath = VFS.normPath(path + '/' + newName)
          if (content != null) { VFS.writeFile(newPath, content); VFS.rm(fullPath) }
          else if (VFS.isDir(fullPath)) { VFS.mkdir(newPath); VFS.rm(fullPath) }
          EventBus.emit('user.action', { type: 'file.rename', path: fullPath, newName })
          renderFinder(w, body)
        }
      }})
      menuItems.push({ label: 'Delete', action: () => {
        if (confirm(`Delete ${name}?`)) {
          EventBus.emit('user.action', { type: 'file.delete', path: fullPath })
          VFS.rm(fullPath)
          renderFinder(w, body)
        }
      }})
      window.showContextMenu(ev.clientX, ev.clientY, menuItems)
    })
  })

  // Sort by column headers (list view)
  body.querySelectorAll('.finder-list-col[data-sort]')?.forEach(el => {
    el.style.cursor = 'pointer'
    el.addEventListener('click', () => {
      // Simple sort toggle — just re-render for now
      // Could add w.data.sortBy / w.data.sortDir for persistent sorting
    })
  })

  // Finder background context menu
  const finderMain = body.querySelector('.finder-main')
  if (finderMain) {
    finderMain.addEventListener('contextmenu', e => {
      if (e.target.closest('.finder-list-row') || e.target.closest('.finder-item')) return
      e.preventDefault()
      e.stopPropagation()
      if (!window.showContextMenu) return
      window.showContextMenu(e.clientX, e.clientY, [
        { icon: '📄', label: 'New File', action: () => {
          const name = prompt('File name:', 'untitled.txt')
          if (name) { VFS.writeFile(VFS.normPath(path + '/' + name), ''); renderFinder(w, body) }
        }},
        { icon: '📁', label: 'New Folder', action: () => {
          const name = prompt('Folder name:', 'New Folder')
          if (name) { VFS.mkdir(VFS.normPath(path + '/' + name)); renderFinder(w, body) }
        }},
        '---',
        { icon: '📋', label: 'Copy Path', action: () => navigator.clipboard?.writeText(path) },
        { icon: '💻', label: 'Open Terminal Here', action: () => { Shell.cd(path); WindowManager.openTerminal() } },
        '---',
        { icon: w.data.viewMode === 'grid' ? '☰' : '⊞', label: w.data.viewMode === 'grid' ? 'List View' : 'Grid View', action: () => {
          w.data.viewMode = w.data.viewMode === 'grid' ? 'list' : 'grid'
          renderFinder(w, body)
        }},
      ])
    })
  }
}

function formatSize(bytes) {
  if (bytes == null) return '—'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
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

  let composing = false
  input.addEventListener('compositionstart', () => { composing = true })
  input.addEventListener('compositionend', () => { composing = false })

  async function execCommand() {
    const cmd = input.value
    input.value = ''
    histIdx = -1
    appendOutput(output, `user@fluid:${Shell.getCwd()}$ ${cmd}`, '')
    if (cmd.trim()) {
      const sayMatch = cmd.trim().match(/^say\s+(.+)$/i)
      if (sayMatch) {
        if (Voice?.isEnabled()) { appendOutput(output, `Speaking: "${sayMatch[1]}"`, 'output'); Voice.speak(sayMatch[1]) }
        else appendOutput(output, 'Voice not enabled. Enable in Settings.', 'error')
      } else if (cmd.trim() === 'listen') {
        if (Voice?.isEnabled()) { appendOutput(output, 'Listening...', 'output'); Voice.toggleListening() }
        else appendOutput(output, 'Voice not enabled. Enable in Settings.', 'error')
      } else if (cmd.trim().match(/^play(\s+\d+)?$/i)) {
        const m = cmd.trim().match(/^play(?:\s+(\d+))?$/i)
        const idx = m[1] != null ? parseInt(m[1]) : null
        WM.openMusic()
        EventBus.emit('music.control', { action: 'play', track: idx })
        appendOutput(output, idx != null ? `Playing track ${idx}` : 'Playing music', 'output')
      } else if (cmd.trim() === 'pause' || cmd.trim() === 'stop') {
        EventBus.emit('music.control', { action: 'pause' })
        appendOutput(output, 'Music paused', 'output')
      } else if (cmd.trim() === 'next') {
        EventBus.emit('music.control', { action: 'next' })
        appendOutput(output, 'Next track', 'output')
      } else {
        const result = await Shell.execAsync(cmd)
        if (result === '\x1bclear') output.innerHTML = ''
        else if (result) appendOutput(output, result, result.includes('not found') || result.includes('No such') ? 'error' : 'output')
      }
    }
    promptEl.textContent = `user@fluid:${Shell.getCwd()}$ `
    body.querySelector('.terminal-body').scrollTop = body.querySelector('.terminal-body').scrollHeight
  }

  input.addEventListener('keydown', async e => {
    if (composing) return // IME composing, don't intercept
    if (e.key === 'Enter') {
      e.preventDefault()
      await execCommand()
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

  // Terminal context menu
  body.querySelector('.terminal-body').addEventListener('contextmenu', e => {
    e.preventDefault()
    e.stopPropagation()
    if (!window.showContextMenu) return
    const sel = window.getSelection()?.toString()
    const items = []
    if (sel) items.push({ icon: '📋', label: 'Copy', action: () => navigator.clipboard?.writeText(sel) })
    items.push({ icon: '📄', label: 'Paste', action: async () => { const t = await navigator.clipboard?.readText(); if (t) input.value += t; input.focus() } })
    items.push('---')
    items.push({ icon: '🧹', label: 'Clear', action: () => { output.innerHTML = '' } })
    items.push({ icon: '🔍', label: 'Search History', action: () => {
      const hist = Shell.getHistory()
      if (hist.length) appendOutput(output, '\n--- History ---\n' + hist.slice(-20).map((h,i) => `${hist.length - 20 + i}: ${h}`).join('\n'), 'output')
      else appendOutput(output, 'No history', 'output')
    }})
    window.showContextMenu(e.clientX, e.clientY, items)
  })
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

  // Editor context menu
  body.querySelector('.editor-body').addEventListener('contextmenu', e => {
    e.preventDefault()
    e.stopPropagation()
    if (!window.showContextMenu) return
    const sel = window.getSelection()?.toString()
    const items = []
    if (sel) {
      items.push({ icon: '\u{1f4cb}', label: 'Copy', action: () => navigator.clipboard?.writeText(sel) })
      items.push({ icon: '\u{2702}', label: 'Cut', action: () => { navigator.clipboard?.writeText(sel); document.execCommand('delete') } })
    }
    items.push({ icon: '\u{1f4c4}', label: 'Paste', action: async () => {
      const t = await navigator.clipboard?.readText()
      if (t && mode === 'edit') { textarea.focus(); document.execCommand('insertText', false, t) }
    }})
    items.push('---')
    items.push({ icon: '\u{1f4be}', label: 'Save', action: () => { VFS.writeFile(path, textarea.value); if (preview && mode === 'preview') preview.innerHTML = parseMd(textarea.value) } })
    items.push({ icon: '\u{1f4c2}', label: 'Reveal in Finder', action: () => WindowManager.openFinder(path.split('/').slice(0, -1).join('/') || '/') })
    items.push({ icon: '\u{1f4cb}', label: 'Copy Path', action: () => navigator.clipboard?.writeText(path) })
    window.showContextMenu(e.clientX, e.clientY, items)
  })
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── Plan ──
function renderPlan(w, body) {
  const { goal, steps } = w.data
  const hasSteps = steps && steps.length > 0
  body.innerHTML = `
    <div class="plan-body">
      <div class="plan-goal">${goal || 'No active task'}</div>
      <div class="plan-steps">
        ${hasSteps ? steps.map((s, i) => `
          <div class="plan-step ${s.status}">
            <div class="plan-step-icon">${stepIcon(s.status)}</div>
            <div class="plan-step-text">${s.text}</div>
          </div>
        `).join('') : `<div class="plan-empty">${goal ? 'Planning...' : 'Send a message to get started'}</div>`}
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
  return WM.create({ type: 'finder', title: path.split('/').pop() || '/', ...SIZE.medium, data: { path } })
}

function openTerminal() {
  return WM.create({ type: 'terminal', title: 'Terminal', ...SIZE.medium })
}

function openEditor(path) {
  return WM.create({ type: 'editor', title: path.split('/').pop(), ...SIZE.medium, data: { path } })
}

function openPlan(goal, steps) {
  return WM.create({ type: 'plan', title: 'Plan', ...SIZE.small, data: { goal, steps } })
}

let taskManagerId = null
const taskHistory = [] // { id, goal, steps, status, log, startTime }

function openTaskManager() {
  if (taskManagerId && windows.has(taskManagerId)) {
    WM.focus(taskManagerId)
    return taskManagerId
  }
  taskManagerId = WM.create({ type: 'taskmanager', title: 'Task Manager', ...SIZE.medium })
  renderTaskManager()
  return taskManagerId
}

let _taskSeq = 0
function addTask(goal, steps) {
  const task = { id: 'task-' + Date.now() + '-' + (++_taskSeq), goal, steps: steps.map(s => ({ text: s, status: 'pending' })), status: 'running', log: [], startTime: Date.now() }
  taskHistory.unshift(task)
  if (taskHistory.length > 20) taskHistory.pop()
  openTaskManager()
  renderTaskManager(task.id)
  return task
}

function updateTask(task) {
  if (taskManagerId && windows.has(taskManagerId)) renderTaskManager(task?.id)
}

function renderTaskManager(selectedId, view) {
  const w = windows.get(taskManagerId)
  if (!w) return
  const body = w.el.querySelector('.window-body')
  const currentView = view || body.dataset.view || 'detail'
  body.dataset.view = currentView
  const sel = selectedId || taskHistory[0]?.id
  const selected = taskHistory.find(t => t.id === sel) || taskHistory[0]

  // Queue overview from Dispatcher + Scheduler
  const _ds = typeof Dispatcher !== 'undefined' ? Dispatcher.getState() : { workers: [] }
  const ds = { running: _ds.workers?.filter(w => w.status === 'running') || [], pending: _ds.workers?.filter(w => w.status === 'suspended' || w.status === 'pending') || [] }
  const ss = typeof Scheduler !== 'undefined' ? Scheduler.getState() : { slots: [], pending: [], completed: [] }

  // Intent state
  const intents = typeof IntentState !== 'undefined' ? IntentState.all() : []
  const activeIntents = intents.filter(i => i.status === 'active')

  body.innerHTML = `<div class="tm-layout">
    <div class="tm-tabs">
      <button class="tm-tab ${currentView === 'detail' ? 'active' : ''}" data-view="detail">Tasks</button>
      <button class="tm-tab ${currentView === 'log' ? 'active' : ''}" data-view="log">Log${selected?.log?.length ? ` · ${selected.log.length}` : ''}</button>
      <button class="tm-tab ${currentView === 'queue' ? 'active' : ''}" data-view="queue">Queue${ds.running.length + ds.pending.length + ss.pending.length > 0 ? ` · ${ds.running.length + ds.pending.length + ss.pending.length}` : ''}</button>
      <button class="tm-tab ${currentView === 'intents' ? 'active' : ''}" data-view="intents">Intents${activeIntents.length ? ` · ${activeIntents.length}` : ''}</button>
    </div>
    ${currentView === 'intents' ? `
    <div class="tm-intents">
      ${intents.length ? intents.sort((a, b) => b.updatedAt - a.updatedAt).map(i => {
        const statusIcon = i.status === 'active' ? '▶' : i.status === 'done' ? '✓' : i.status === 'cancelled' ? '✕' : '○'
        const age = Math.round((Date.now() - i.createdAt) / 1000)
        const ageStr = age < 60 ? age + 's' : age < 3600 ? Math.round(age / 60) + 'm' : Math.round(age / 3600) + 'h'
        const msgs = i.messages || []
        return `<div class="tm-intent-item ${i.status}">
          <div class="tm-intent-header">
            <span class="tm-intent-status">${statusIcon}</span>
            <span class="tm-intent-id">${i.id}</span>
            <span class="tm-intent-age">${ageStr}</span>
          </div>
          <div class="tm-intent-goal">${i.goal}</div>
          ${msgs.length ? `<div class="tm-intent-messages">${msgs.slice(-5).map(m => `<div class="tm-intent-msg">"${m.slice(0, 60)}${m.length > 60 ? '…' : ''}"</div>`).join('')}</div>` : ''}
          ${i.goalHistory?.length ? `<div class="tm-intent-history">${i.goalHistory.map(h => `<div class="tm-intent-prev-goal">← ${h.goal.slice(0, 50)}</div>`).join('')}</div>` : ''}
        </div>`
      }).join('') : '<div class="tm-empty">No intents yet</div>'}
    </div>` : currentView === 'queue' ? `
    <div class="tm-queue">
      ${ds.running.length ? `<div class="tm-queue-section">Running</div>${ds.running.map(r => `<div class="tm-queue-item running"><span>▶</span><span>${(r.task || '').slice(0,50)}</span></div>`).join('')}` : ''}
      ${ss.pending.length ? `<div class="tm-queue-section">Waiting (${ss.pending.length})</div>${ss.pending.map(p => `<div class="tm-queue-item pending"><span>${p.priority === 0 ? '⚡' : p.priority === 2 ? '💤' : '○'}</span><span>${(p.task || '').slice(0,50)}${p.dependsOn?.length ? ' <span style="opacity:.5;font-size:11px">⏳ waiting for #' + p.dependsOn.join(', #') + '</span>' : ''}</span></div>`).join('')}` : ''}
      ${ds.pending.length ? `<div class="tm-queue-section">Suspended</div>${ds.pending.map(p => `<div class="tm-queue-item pending"><span>⏸</span><span>${(p.task || '').slice(0,50)}</span></div>`).join('')}` : ''}
      ${!ds.running.length && !ds.pending.length && !ss.pending.length ? '<div class="tm-empty">Queue is empty</div>' : ''}
    </div>` : currentView === 'log' ? `
    <div class="tm-log-view">
      <div class="tm-log-header">${selected ? selected.goal.slice(0, 50) : 'No task selected'}</div>
      <div class="tm-log-body">${selected?.log?.length ? selected.log.map((l, i) => `<div class="tm-log-entry"><span class="tm-log-idx">${i + 1}</span><span class="tm-log-text">${l}</span></div>`).join('') : '<div class="tm-empty">No logs yet</div>'}</div>
    </div>` : `
    <div class="tm-content"><div class="tm-list">${ss.pending.length ? ss.pending.map(t => `
      <div class="tm-item pending" data-id="pending-${t.id}">
        <span class="tm-status-dot"></span>
        <span class="tm-goal">⏳ ${(t.task || '').slice(0, 36)}${(t.task || '').length > 36 ? '…' : ''}</span>
      </div>`).join('') : ''}${taskHistory.map(t => `
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
    ` : '<div class="tm-empty">Select a task</div>'}</div></div>`}
  </div>`

  body.querySelectorAll('.tm-item').forEach(el => {
    el.addEventListener('click', () => renderTaskManager(el.dataset.id, 'detail'))
  })
  body.querySelectorAll('.tm-tab').forEach(el => {
    el.addEventListener('click', () => renderTaskManager(sel, el.dataset.view))
  })
}

// Auto-refresh Task Manager on scheduler events
if (typeof EventBus !== 'undefined') {
  const _tmRefresh = () => { if (taskManagerId && windows.has(taskManagerId)) renderTaskManager() }
  EventBus.on('scheduler.enqueued', _tmRefresh)
  EventBus.on('scheduler.started', _tmRefresh)
  EventBus.on('scheduler.finished', _tmRefresh)
  EventBus.on('scheduler.paused', _tmRefresh)
  EventBus.on('scheduler.aborted', _tmRefresh)
  EventBus.on('intent.changed', _tmRefresh)
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
    windows: [...windows.values()].map(w => {
      const norm = w._norm || WM._internal.readNorm(w.el)
      return {
        id: w.id,
        type: w.type,
        title: w.el.querySelector('.window-title')?.textContent || w.type,
        focused: w.el.classList.contains('focused'),
        minimized: w.el.classList.contains('minimized'),
        fullscreen: w.el.classList.contains('fullscreen'),
        x: norm.x, y: norm.y, width: norm.width, height: norm.height,
        path: w.data?.path || null,
      }
    }),
    focusedWindow: focused ? { type: focused.type, title: focused.el.querySelector('.window-title')?.textContent, path: focused.data?.path } : null,
    music: {
      playing: WM._internal.musicState?.playing || false,
      current: WM._internal.musicState?.playlist?.[WM._internal.musicState?.currentIdx] ? {
        title: WM._internal.musicState.playlist[WM._internal.musicState.currentIdx].title,
        artist: WM._internal.musicState.playlist[WM._internal.musicState.currentIdx].artist,
        elapsed: WM._internal.musicState.elapsed,
        duration: WM._internal.musicState.playlist[WM._internal.musicState.currentIdx].duration,
      } : null,
      playlistCount: WM._internal.musicState?.playlist?.length || 0,
    },
  }
}

function closeByTitle(title) {
  for (const [id, w] of windows) {
    if (w.el.querySelector('.window-title')?.textContent === title || w.type === title) {
      WM.close(id); return true
    }
  }
  return false
}

function focusByTitle(title) {
  for (const [id, w] of windows) {
    if (w.el.querySelector('.window-title')?.textContent === title || w.type === title) {
      WM.focus(id); return true
    }
  }
  return false
}

function openImage(src, title) {
  const id = WM.create('image', { src, path: src })
  const w = windows.get(id)
  const body = w.el.querySelector('.window-body')
  w.el.querySelector('.window-title').textContent = title || src.split('/').pop()
  body.innerHTML = `<div class="image-viewer"><img src="${src}" alt="${title || ''}"></div>`
  return id
}

// --- Settings Window ---
let settingsId = null
let launchpadId = null
function openLaunchpad() {
  if (launchpadId && windows.has(launchpadId)) { WM.focus(launchpadId); return launchpadId }
  launchpadId = WM.create({ type: 'launchpad', title: 'Launchpad', width: 520, height: 420 })
  return launchpadId
}

function renderLaunchpad(w, body) {
  // Build app list from AppRegistry if available, else hardcoded
  let all
  if (typeof AppRegistry !== 'undefined') {
    const openers = {
      finder: () => openFinder('/home/user'),
      terminal: () => openTerminal(),
      browser: () => WM.openBrowser(),
      music: () => WM.openMusic(),
      video: () => WM.openVideo(),
      map: () => WM.openMap(),
      settings: () => openSettings(),
    }
    all = AppRegistry.launchpadApps()
      .map(a => ({
        name: a.name, icon: a.icon,
        action: openers[a.id] || (() => WM.openApp(a.id)),
        custom: !a.builtin,
      }))
    // Add user-installed apps not yet in registry
    for (const [name, app] of (WM._internal.installedApps || new Map())) {
      if (!AppRegistry.has(name)) {
        all.push({ name, icon: app.icon || '💻', action: () => WM.openApp(name), custom: true })
      }
    }
  } else {
    const builtIn = [
      { name: 'Finder', icon: '📁', action: () => openFinder('/home/user') },
      { name: 'Terminal', icon: '⬛', action: () => openTerminal() },
      { name: 'Browser', icon: '🌐', action: () => WM.openBrowser() },
      { name: 'Music', icon: '🎵', action: () => WM.openMusic() },
      { name: 'Video', icon: '🎬', action: () => WM.openVideo() },
      { name: 'Map', icon: '🗺️', action: () => WM.openMap() },
      { name: 'Settings', icon: '⚙️', action: () => openSettings() },
    ]
    const custom = Array.from((WM._internal.installedApps || new Map()).entries()).map(([name, app]) => ({
      name, icon: app.icon || '💻', action: () => WM.openApp(name), custom: true
    }))
    all = [...builtIn, ...custom]
  }
  body.innerHTML = `<div class="lp-grid">${all.map((a, i) => `
    <div class="lp-item" data-idx="${i}">
      <div class="lp-icon">${a.icon}</div>
      <div class="lp-name">${a.name}</div>
    </div>`).join('')}
  </div>`
  body.querySelectorAll('.lp-item').forEach(el => {
    el.addEventListener('click', () => { all[+el.dataset.idx].action(); })
  })
}

function openSettings() {
  if (settingsId && windows.has(settingsId)) { WM.focus(settingsId); return settingsId }
  settingsId = WM.create({ type: 'settings', title: 'Settings', width: 600, height: 460 })
  return settingsId
}

function renderSettings(w, body, activeTab) {
  const store = window._store
  const tab = activeTab || w._settingsTab || 'general'
  w._settingsTab = tab
  const savedP = store ? store.get('settings') : Promise.resolve(null)
  savedP.then(saved => {
  saved = saved || {}

  // --- Sidebar + Content layout ---
  const skills = Agent.getSkills ? Agent.getSkills() : []
  const apps = WindowManager.getInstalledApps()

  const sidebarHTML = `
    <div class="settings-sidebar">
      <div class="settings-nav ${tab === 'general' ? 'active' : ''}" data-tab="general">General</div>
      <div class="settings-nav ${tab === 'skills' ? 'active' : ''}" data-tab="skills">Skills</div>
      <div class="settings-nav ${tab === 'apps' ? 'active' : ''}" data-tab="apps">Apps</div>
      <div class="settings-nav ${tab === 'about' ? 'active' : ''}" data-tab="about">About</div>
    </div>`

  let contentHTML = ''

  if (tab === 'skills') {
    contentHTML = `<div class="settings-panel">
      <div class="settings-group-title">Installed Skills</div>
      ${skills.length ? skills.map(s => `
        <div class="settings-skill-item">
          <span class="settings-skill-name">${s.icon || '🧩'} ${s.name}</span>
          <span class="settings-skill-desc">${s.description || ''}</span>
          <button class="settings-skill-del" data-skill="${s.name}" title="Delete">✕</button>
        </div>`).join('') : '<div class="settings-empty">No skills installed. The agent can create skills during tasks.</div>'}
    </div>`
  } else if (tab === 'apps') {
    contentHTML = `<div class="settings-panel">
      <div class="settings-group-title">Installed Apps</div>
      ${apps.length ? apps.map(a => `
        <div class="settings-skill-item">
          <span class="settings-skill-name">${a.icon || '💻'} ${a.name}</span>
          <span class="settings-skill-desc">${a.description || ''}</span>
          <button class="settings-skill-del" data-app="${a.name}" title="Uninstall">✕</button>
        </div>`).join('') : '<div class="settings-empty">No apps installed. Ask the agent to create one!</div>'}
    </div>`
  } else if (tab === 'about') {
    contentHTML = `<div class="settings-panel">
      <div class="settings-group-title">Fluid Agent OS</div>
      <div class="settings-about-text">
        <p>A conversational AI that controls an entire desktop environment.</p>
        <p style="margin-top:8px;color:var(--text-muted)">Architecture: Talker → Dispatcher → Worker</p>
        <p style="color:var(--text-muted)">Version: 0.2.0</p>
      </div>
    </div>`
  } else {
    // General tab
    contentHTML = `<div class="settings-panel">
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
    <div class="settings-section">
      <label class="settings-toggle"><input type="checkbox" id="s-proxy" ${saved.useProxy ? 'checked' : ''}> Use Proxy (proxy.link2web.site)</label>
      <div class="settings-hint">Route API calls through proxy to bypass network restrictions</div>
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
    <div class="settings-group-title">Voice</div>
    <div class="settings-section">
      <label class="settings-toggle"><input type="checkbox" id="s-voice" ${saved.voice ? 'checked' : ''}> Enable voice (Web Speech API free, or ElevenLabs premium)</label>
      <div class="settings-hint">Without API key: uses browser built-in speech. Hold mic = push-to-talk.</div>
    </div>
    <div class="settings-section">
      <div class="settings-label">ElevenLabs API Key (optional)</div>
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
  }

  body.innerHTML = `<div class="settings-layout">${sidebarHTML}<div class="settings-content">${contentHTML}</div></div>`

  // --- Tab navigation ---
  body.querySelectorAll('.settings-nav').forEach(el => {
    el.addEventListener('click', () => renderSettings(w, body, el.dataset.tab))
  })

  // --- Skills tab: delete ---
  body.querySelectorAll('.settings-skill-del[data-skill]').forEach(el => {
    el.addEventListener('click', () => {
      if (Agent.deleteSkill) Agent.deleteSkill(el.dataset.skill)
      renderSettings(w, body, 'skills')
    })
  })

  // --- Apps tab: uninstall ---
  body.querySelectorAll('.settings-skill-del[data-app]').forEach(el => {
    el.addEventListener('click', () => {
      WindowManager.uninstallApp(el.dataset.app)
      renderSettings(w, body, 'apps')
    })
  })

  // --- General tab: ElevenLabs voice picker + save ---
  if (tab === 'general') {
    const elKeyInput = body.querySelector('#s-elkey')
    const elVoiceSelect = body.querySelector('#s-elvoice')
    const elPreview = body.querySelector('#s-elvoice-preview')
    let voicesCache = null

    async function loadVoices(apiKey) {
      if (!apiKey) { elVoiceSelect.innerHTML = '<option value="">Enter API key to load voices...</option>'; elPreview.innerHTML = ''; return }
      elVoiceSelect.innerHTML = '<option value="">Loading voices...</option>'
      try {
        const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': apiKey } })
        if (!res.ok) throw new Error(res.status)
        const data = await res.json()
        voicesCache = data.voices || []
        elVoiceSelect.innerHTML = voicesCache.map(v => {
          const labels = v.labels ? Object.values(v.labels).filter(Boolean).join(', ') : ''
          return `<option value="${v.voice_id}" ${v.voice_id === (saved.elevenLabsVoice || '') ? 'selected' : ''}>${v.name}${labels ? ' \u2014 ' + labels : ''}</option>`
        }).join('')
        if (!voicesCache.length) elVoiceSelect.innerHTML = '<option value="">No voices found</option>'
        updatePreview()
      } catch (e) { elVoiceSelect.innerHTML = '<option value="">Failed to load voices</option>'; elPreview.innerHTML = '' }
    }

    function updatePreview() {
      const id = elVoiceSelect.value
      const voice = voicesCache?.find(v => v.voice_id === id)
      if (voice) {
        const labels = voice.labels ? Object.entries(voice.labels).map(([k,v]) => `${k}: ${v}`).join(' \u00b7 ') : ''
        elPreview.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">${labels || voice.category || ''}</span> <button class="voice-preview-btn" title="Preview voice">\u25b6 Preview</button>`
        elPreview.querySelector('.voice-preview-btn')?.addEventListener('click', () => {
          const apiKey = elKeyInput.value.trim()
          if (!apiKey || !id) return
          const btn = elPreview.querySelector('.voice-preview-btn')
          btn.textContent = '\u23f3'; btn.disabled = true
          fetch('https://api.elevenlabs.io/v1/text-to-speech/' + id, {
            method: 'POST', headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: "Hello, I'm your assistant.", model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
          })
          .then(r => { if (!r.ok) throw new Error(r.status); return r.blob() })
          .then(blob => { const url = URL.createObjectURL(blob); const audio = new Audio(url); audio.play(); audio.onended = () => URL.revokeObjectURL(url); btn.textContent = '\u25b6 Preview'; btn.disabled = false })
          .catch(() => { btn.textContent = '\u25b6 Preview'; btn.disabled = false })
        })
      } else elPreview.innerHTML = ''
    }

    elVoiceSelect.addEventListener('change', updatePreview)
    let keyTimer = null
    elKeyInput.addEventListener('input', () => { clearTimeout(keyTimer); keyTimer = setTimeout(() => loadVoices(elKeyInput.value.trim()), 600) })
    if (saved.elevenLabsKey) loadVoices(saved.elevenLabsKey)

    body.querySelector('#s-save').addEventListener('click', async () => {
      const settings = {
        provider: body.querySelector('#s-provider').value,
        apiKey: body.querySelector('#s-apikey').value,
        model: body.querySelector('#s-model').value,
        baseUrl: body.querySelector('#s-baseurl').value,
        useProxy: body.querySelector('#s-proxy').checked,
        voice: body.querySelector('#s-voice').checked,
        tavilyKey: body.querySelector('#s-tavily').value,
        tmdbKey: body.querySelector('#s-tmdb').value,
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
  }
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

  // --- Register renderers ---
  WM._registerRenderer('finder', renderFinder)
  WM._registerRenderer('terminal', renderTerminal)
  WM._registerRenderer('editor', renderEditor)
  WM._registerRenderer('plan', renderPlan)
  WM._registerRenderer('settings', renderSettings)
  WM._registerRenderer('image', (w, body) => {
    body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;background:#111"><img src="${w.data.src}" style="max-width:100%;max-height:100%;object-fit:contain"></div>`
  })
  WM._registerRenderer('launchpad', renderLaunchpad)
  WM._registerRenderer('taskmanager', (w, body) => renderTaskManager())

  // --- Register AppRegistry ---
  if (typeof AppRegistry !== 'undefined') {
    AppRegistry.register({ id: 'finder', name: 'Finder', icon: '📁', sandboxed: false, size: 'medium', builtin: true, permissions: ['vfs'], render: renderFinder })
    AppRegistry.register({ id: 'terminal', name: 'Terminal', icon: '⬛', sandboxed: false, size: 'medium', builtin: true, permissions: ['vfs', 'shell'], render: renderTerminal })
    AppRegistry.register({ id: 'editor', name: 'Editor', icon: '📝', sandboxed: false, size: 'medium', builtin: true, permissions: ['vfs'], render: renderEditor })
    AppRegistry.register({ id: 'plan', name: 'Plan', icon: '📋', sandboxed: false, size: 'small', builtin: true, render: renderPlan })
    AppRegistry.register({ id: 'settings', name: 'Settings', icon: '⚙️', sandboxed: false, size: 'medium', singleton: true, builtin: true, render: renderSettings })
    AppRegistry.register({ id: 'launchpad', name: 'Launchpad', icon: '🚀', sandboxed: false, size: { width: 520, height: 420 }, singleton: true, builtin: true, showInLaunchpad: false, render: renderLaunchpad })
    AppRegistry.register({ id: 'taskmanager', name: 'Task Manager', icon: '📊', sandboxed: false, size: 'medium', singleton: true, builtin: true, render: () => renderTaskManager() })
  }

  // --- Expose to WindowManager ---
  WM.openFinder = openFinder
  WM.openTerminal = openTerminal
  WM.openEditor = openEditor
  WM.openPlan = openPlan
  WM.updatePlan = updatePlan
  WM.openImage = openImage
  WM.openSettings = openSettings
  WM.openLaunchpad = openLaunchpad
  WM.openTaskManager = openTaskManager
  WM.addTask = addTask
  WM.updateTask = updateTask
  WM.closeByTitle = closeByTitle
  WM.focusByTitle = focusByTitle
  WM.getState = getState
  WM.getTaskHistory = () => taskHistory
  WM.showActivity = showActivity
})()
