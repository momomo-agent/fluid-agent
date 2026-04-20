/* windows.js — macOS-style window manager */
const WindowManager = (() => {
  let nextId = 1
  let topZ = 100
  const windows = new Map()
  const area = () => document.getElementById('desktop-area')

  // --- Centralized drag/resize state (one document listener, not per-window) ---
  let _activeDrag = null   // { el, id, offsetX, offsetY }
  let _activeResize = null // { el, startX, startY, startW, startH }

  // --- Disable iframe pointer events during drag/resize to prevent gesture theft ---
  function disableIframePointers() {
    document.querySelectorAll('.window-body iframe').forEach(f => f.style.pointerEvents = 'none')
  }
  function enableIframePointers() {
    document.querySelectorAll('.window-body iframe').forEach(f => f.style.pointerEvents = '')
  }

  document.addEventListener('mousemove', e => {
    if (_activeDrag) {
      const d = _activeDrag
      const areaEl = document.getElementById('desktop-area')
      const areaRect = areaEl?.getBoundingClientRect() || { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }
      let nx = e.clientX - d.offsetX
      let ny = e.clientY - d.offsetY
      nx = Math.max(-(d.el.offsetWidth - 100), Math.min(nx, areaRect.width - 100))
      ny = Math.max(0, Math.min(ny, areaRect.height - 40))
      d.el.style.left = nx + 'px'
      d.el.style.top = ny + 'px'
      if (window._snapHelpers) {
        const zone = window._snapHelpers.getSnapZone(e.clientX, e.clientY)
        window._snapHelpers.showSnapPreview(zone)
      }
    }
    if (_activeResize) {
      const r = _activeResize
      r.el.style.width = Math.max(300, r.startW + e.clientX - r.startX) + 'px'
      r.el.style.height = Math.max(200, r.startH + e.clientY - r.startY) + 'px'
    }
  })

  document.addEventListener('mouseup', e => {
    if (_activeDrag) {
      const body = _activeDrag.el.querySelector('.window-body')
      if (body) body.style.pointerEvents = ''
      if (window._snapHelpers) {
        const zone = window._snapHelpers.getSnapZone(e.clientX, e.clientY)
        if (zone) window._snapHelpers.applySnap(zone, _activeDrag.el)
        window._snapHelpers.hideSnapPreview()
      }
      // Update normalized position
      const win = windows.get(_activeDrag.id)
      if (win) win._norm = readNorm(_activeDrag.el)
      _activeDrag = null
      enableIframePointers()
    }
    if (_activeResize) {
      const body = _activeResize.el.querySelector('.window-body')
      if (body) body.style.pointerEvents = ''
      // Update normalized size
      const resId = _activeResize.el.id
      const win = windows.get(resId)
      if (win) win._norm = readNorm(_activeResize.el)
      _activeResize = null
      enableIframePointers()
    }
  })

  // --- Normalized coordinate helpers ---
  // All window positions/sizes stored as 0-1 ratios relative to desktop-area
  function getAreaSize() {
    const el = document.getElementById('desktop-area')
    return { w: el?.clientWidth || 800, h: el?.clientHeight || 600 }
  }
  function toPx(norm) {
    const { w, h } = getAreaSize()
    return { x: norm.x * w, y: norm.y * h, width: norm.width * w, height: norm.height * h }
  }
  function toNorm(px) {
    const { w, h } = getAreaSize()
    return { x: px.x / w, y: px.y / h, width: px.width / w, height: px.height / h }
  }
  function applyPx(el, norm) {
    const px = toPx(norm)
    el.style.left = px.x + 'px'
    el.style.top = px.y + 'px'
    el.style.width = px.width + 'px'
    el.style.height = px.height + 'px'
  }
  function readNorm(el) {
    return toNorm({ x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight })
  }

  // Reflow all windows on desktop-area resize
  let _reflowRaf = null
  const _resizeObserver = new ResizeObserver(() => {
    // Debounce with rAF to ensure layout is settled
    if (_reflowRaf) cancelAnimationFrame(_reflowRaf)
    _reflowRaf = requestAnimationFrame(() => {
      _reflowRaf = null
      for (const [, win] of windows) {
        if (win.el.classList.contains('minimized') || win.el.classList.contains('fullscreen')) continue
        if (!win._norm) win._norm = readNorm(win.el)
        applyPx(win.el, win._norm)
      }
    })
  })
  // Observe once area exists
  function _observeArea() {
    const el = document.getElementById('desktop-area')
    if (el) _resizeObserver.observe(el)
    else requestAnimationFrame(_observeArea)
  }
  _observeArea()

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
    w.className = `window window-${type}`
    w.id = id
    const { w: areaW, h: areaH } = getAreaSize()
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
    // Store normalized and apply px
    const norm = toNorm({ x: cx, y: cy, width: ww, height: wh })
    applyPx(w, norm)
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
    titlebar.addEventListener('mousedown', e => {
      if (e.target.classList.contains('window-dot')) return
      _activeDrag = { el: w, id, offsetX: e.clientX - w.offsetLeft, offsetY: e.clientY - w.offsetTop }
      disableIframePointers()
      focus(id)
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
        { label: 'Tile Left', action: () => { const win = windows.get(id); if (win) { win._norm = { x: 0, y: 0, width: 0.5, height: 1 }; applyPx(w, win._norm) } } },
        { label: 'Tile Right', action: () => { const win = windows.get(id); if (win) { win._norm = { x: 0.5, y: 0, width: 0.5, height: 1 }; applyPx(w, win._norm) } } },
        '---',
        { label: 'Close', action: () => _close(id) },
      ])
    })

    // Resize
    const resizeHandle = w.querySelector('.window-resize')
    resizeHandle.addEventListener('mousedown', e => {
      e.stopPropagation()
      e.preventDefault()
      _activeResize = { el: w, startX: e.clientX, startY: e.clientY, startW: w.offsetWidth, startH: w.offsetHeight }
      disableIframePointers()
      const body = w.querySelector('.window-body')
      if (body) body.style.pointerEvents = 'none'
    })

    area().appendChild(w)
    const winObj = { id, type, el: w, data: data || {}, _norm: norm }
    windows.set(id, winObj)

    // Render content
    renderWindow(winObj)
    focus(id)
    updateDock()
    saveSession()
    EventBus.emit('window.opened', { id, type, title: title || type })
    return id
  }

  function close(id) {
    const w = windows.get(id)
    if (!w) return
    const title = w.el.querySelector('.window-title')?.textContent || w.type
    EventBus.emit('user.action', { type: 'window.close', window: w.type, title })
    EventBus.emit('window.closed', { id, type: w.type, title })
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
    EventBus.emit('user.action', { type: 'window.focus', window: w.type, title: w.el.querySelector('.window-title')?.textContent || w.type })
    EventBus.emit('window.focused', { id, type: w.type })
  }

  function minimize(id) {
    const w = windows.get(id)
    if (!w) return
    EventBus.emit('user.action', { type: 'window.minimize', window: w.type })
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
      w._norm = w._restore.norm
      w.el.classList.remove('fullscreen')
      w.fullscreen = false
    } else {
      // Save and go fullscreen
      w._restore = { left: w.el.style.left, top: w.el.style.top, width: w.el.style.width, height: w.el.style.height, norm: w._norm }
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
    // Try AppRegistry first (unified path)
    if (typeof AppRegistry !== 'undefined' && AppRegistry.has(w.type)) {
      const app = AppRegistry.get(w.type)
      if (app.sandboxed) {
        renderSandboxedApp(body, app, w)
      } else if (app.render) {
        app.render(w, body)
      }
      return
    }
    // Legacy fallback
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
      case 'launchpad': renderLaunchpad(w, body); break
    }
  }

  // Render sandboxed app via iframe srcdoc
  function renderSandboxedApp(body, app, w) {
    const html = app.html || ''
    const css = app.css || ''
    const js = app.js || ''
    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #e0e0e0; overflow: hidden; }
button { cursor: pointer; }
input, select, textarea { font-family: inherit; }
${css}
</style>${APP_BRIDGE_SCRIPT}</head><body>${html}<script>${js}<\/script></body></html>`
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'width:100%;height:100%;border:none'
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    iframe.srcdoc = doc
    body.innerHTML = ''
    body.appendChild(iframe)
  }

  // ── Finder ──
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
          WindowManager.openMusic()
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
    medium: { width: 600, height: 460 },
    large:  { width: 780, height: 520 },
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
    const ds = typeof Dispatcher !== 'undefined' ? Dispatcher.getState() : { running: [], pending: [] }
    const ss = typeof Scheduler !== 'undefined' ? Scheduler.getState() : { running: [], pending: [], completed: [], freeSlots: 3 }

    // Intent state
    const intents = typeof IntentState !== 'undefined' ? IntentState.all() : []
    const activeIntents = intents.filter(i => i.status === 'active')

    body.innerHTML = `<div class="tm-layout">
      <div class="tm-tabs">
        <button class="tm-tab ${currentView === 'detail' ? 'active' : ''}" data-view="detail">Tasks</button>
        <button class="tm-tab ${currentView === 'log' ? 'active' : ''}" data-view="log">Log${selected?.log.length ? ` · ${selected.log.length}` : ''}</button>
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
        <div class="tm-log-body">${selected?.log.length ? selected.log.map((l, i) => `<div class="tm-log-entry"><span class="tm-log-idx">${i + 1}</span><span class="tm-log-text">${l}</span></div>`).join('') : '<div class="tm-empty">No logs yet</div>'}</div>
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
        const norm = w._norm || readNorm(w.el)
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
        playing: musicState.playing,
        current: musicState.playlist[musicState.current] ? {
          title: musicState.playlist[musicState.current].title,
          artist: musicState.playlist[musicState.current].artist,
          elapsed: musicState.elapsed,
          duration: musicState.playlist[musicState.current].duration,
        } : null,
        playlistCount: musicState.playlist.length,
      },
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
  let launchpadId = null
  function openLaunchpad() {
    if (launchpadId && windows.has(launchpadId)) { focus(launchpadId); return launchpadId }
    launchpadId = create({ type: 'launchpad', title: 'Launchpad', width: 520, height: 420 })
    return launchpadId
  }

  function renderLaunchpad(w, body) {
    // Build app list from AppRegistry if available, else hardcoded
    let all
    if (typeof AppRegistry !== 'undefined') {
      const openers = {
        finder: () => openFinder('/home/user'),
        terminal: () => openTerminal(),
        browser: () => openBrowser(),
        music: () => openMusic(),
        video: () => openVideo(),
        map: () => openMap(),
        settings: () => openSettings(),
      }
      all = AppRegistry.launchpadApps()
        .map(a => ({
          name: a.name, icon: a.icon,
          action: openers[a.id] || (() => openApp(a.id)),
          custom: !a.builtin,
        }))
      // Add user-installed apps not yet in registry
      for (const [name, app] of installedApps) {
        if (!AppRegistry.has(name)) {
          all.push({ name, icon: app.icon || '💻', action: () => openApp(name), custom: true })
        }
      }
    } else {
      const builtIn = [
        { name: 'Finder', icon: '📁', action: () => openFinder('/home/user') },
        { name: 'Terminal', icon: '⬛', action: () => openTerminal() },
        { name: 'Browser', icon: '🌐', action: () => openBrowser() },
        { name: 'Music', icon: '🎵', action: () => openMusic() },
        { name: 'Video', icon: '🎬', action: () => openVideo() },
        { name: 'Map', icon: '🗺️', action: () => openMap() },
        { name: 'Settings', icon: '⚙️', action: () => openSettings() },
      ]
      const custom = Array.from(installedApps.entries()).map(([name, app]) => ({
        name, icon: app.icon || '💻', action: () => openApp(name), custom: true
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
    if (settingsId && windows.has(settingsId)) { focus(settingsId); return settingsId }
    settingsId = create({ type: 'settings', title: 'Settings', width: 600, height: 460 })
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

    // Hide separator when dock-running is empty
    const sep = document.querySelector('.dock-separator')
    if (sep) sep.style.display = container.children.length ? '' : 'none'
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
    const track = s.playlist[s.current]
    EventBus.emit('music.stateChange', { playing: true, current: track, playlistCount: s.playlist.length })
    if (track.url) {
      // External URL track — use Audio element
      if (!s._audio) s._audio = new Audio()
      // Force HTTPS to avoid Mixed Content errors (NetEase CDN supports HTTPS)
      s._audio.src = track.url.replace(/^http:\/\//, 'https://')
      s._audio.currentTime = s.elapsed
      s._audio.play().catch(() => {})
      s._audio.onended = () => {
        s.current = (s.current + 1) % s.playlist.length
        s.elapsed = 0
        musicPlay(s)
        musicRerender()
      }
      s._audio.onloadedmetadata = () => {
        if (!track._durationSet) {
          track.duration = Math.floor(s._audio.duration) || track.duration || 180
          track._durationSet = true
          musicRerender()
        }
      }
      s.timer = setInterval(() => {
        s.elapsed = Math.floor(s._audio.currentTime || s.elapsed)
        musicRerender()
      }, 1000)
    } else {
      // Synth track
      AudioSynth.play(s.current, s.elapsed, () => {
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
  }

  function musicPause(s) {
    clearInterval(s.timer)
    s.playing = false
    if (s._audio) { s._audio.pause() }
    AudioSynth.stop()
    EventBus.emit('music.stateChange', { playing: false, current: s.playlist[s.current], playlistCount: s.playlist.length })
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

    const artHtml = track.artwork
      ? `<img src="${track.artwork}" class="music-art-img" alt="">`
      : `<div class="music-art-icon" style="color: ${track.color || '#60a5fa'}">${s.playing ? '♫' : '♪'}</div>`

    body.innerHTML = `<div class="music-player">
      <div class="music-art" style="background: linear-gradient(135deg, ${track.color || '#60a5fa'}33, ${track.color || '#60a5fa'}11)">
        ${artHtml}
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
          ${t.artwork ? `<img src="${t.artwork}" class="music-track-thumb" alt="">` : `<span class="music-track-dot" style="background:${t.color || '#60a5fa'}"></span>`}
          <span class="music-track-title">${t.title}</span>
          <span class="music-track-artist">${t.artist}</span>
          <span class="music-track-dur">${fmt(t.duration)}</span>
        </div>`).join('')}
      </div>
    </div>`

    body.querySelector('#music-toggle').addEventListener('click', () => {
      const wasPlaying = s.playing
      if (wasPlaying) musicPause(s)
      else musicPlay(s)
      EventBus.emit('user.action', { type: wasPlaying ? 'music.pause' : 'music.play', track: s.playlist[s.current]?.title })
      renderMusic(w, body)
    })
    body.querySelector('#music-prev').addEventListener('click', () => {
      musicPause(s)
      s.current = (s.current - 1 + s.playlist.length) % s.playlist.length
      s.elapsed = 0
      EventBus.emit('user.action', { type: 'music.prev', track: s.playlist[s.current]?.title })
      renderMusic(w, body)
    })
    body.querySelector('#music-next').addEventListener('click', () => {
      musicPause(s)
      s.current = (s.current + 1) % s.playlist.length
      s.elapsed = 0
      EventBus.emit('user.action', { type: 'music.next', track: s.playlist[s.current]?.title })
      renderMusic(w, body)
    })
    body.querySelectorAll('.music-track').forEach(el => {
      el.addEventListener('click', () => {
        musicPause(s)
        s.current = parseInt(el.dataset.idx)
        s.elapsed = 0
        musicPlay(s)
        EventBus.emit('user.action', { type: 'music.play', track: s.playlist[s.current]?.title })
        renderMusic(w, body)
      })
    })
  }

  // Agent music control via EventBus
  EventBus.on('music.control', ({ action, track }) => {
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
    const id = create({ type: 'video', title: title || 'Video Player', ...SIZE.large, data: { url: url || '' } })
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
    const id = create({ type: 'browser', title: 'Browser', width: 900, height: 580, data: { url: url || '' } })
    return id
  }

  function renderBrowser(w, body) {
    const url = w.data?.url || ''
    const displayUrl = w.data?.displayUrl || url || 'about:blank'
    // Proxy external URLs to strip X-Frame-Options/CSP headers
    const proxyUrl = url ? `https://proxy.link2web.site/frame?url=${encodeURIComponent(url)}` : ''

    body.innerHTML = `<div class="browser-window">
      <div class="browser-toolbar">
        <button class="browser-nav-btn" id="browser-back">◀</button>
        <button class="browser-nav-btn" id="browser-fwd">▶</button>
        <button class="browser-nav-btn" id="browser-reload">↻</button>
        <div class="browser-url-bar">
          <input class="browser-url-input" value="${displayUrl}" />
        </div>
      </div>
      <div class="browser-content">${proxyUrl
        ? `<iframe src="${proxyUrl}" style="width:100%;height:100%;border:none" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>`
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
      w.data = { ...w.data, url: u, displayUrl: u }
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
    mapId = create({ type: 'map', title: 'Map', ...SIZE.large, data: { lat: lat || 39.9042, lng: lng || 116.4074, zoom: zoom || 12, markers: [], route: null } })
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

  // Agent browser control via EventBus
  EventBus.on('browser.control', ({ action, url }) => {
    let bw = null
    for (const [, w] of windows) { if (w.type === 'browser') { bw = w; break } }
    if (!bw) {
      openBrowser(action === 'navigate' ? url : '')
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

  // Agent video control via EventBus
  EventBus.on('video.control', ({ action }) => {
    for (const [, w] of windows) {
      if (w.type !== 'video') continue
      const video = w.el.querySelector('video')
      if (!video) continue
      if (action === 'play') video.play()
      else if (action === 'pause') video.pause()
      else if (action === 'fullscreen') video.requestFullscreen?.().catch(() => {})
    }
  })

  // --- EventBus: window.open handler ---
  EventBus.on('window.open', ({ type, ...opts }) => {
    switch (type) {
      case 'finder': openFinder(opts.path || '/home/user'); break
      case 'editor': openEditor(opts.path); break
      case 'terminal': openTerminal(); break
      case 'browser': openBrowser(opts.url); break
      case 'music': openMusic(); break
      case 'video': openVideo(opts.url, opts.title); break
      case 'map': openMap(opts.lat, opts.lng, opts.zoom); break
      case 'image': openImage(opts.src, opts.title); break
      case 'settings': openSettings(); break
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
      for (const [k, v] of Object.entries(saved)) {
        installedApps.set(k, v)
        // Sync to AppRegistry
        if (typeof AppRegistry !== 'undefined') {
          AppRegistry.register({
            id: k, name: k, icon: v.icon || '💻',
            sandboxed: true, builtin: false, ephemeral: false,
            size: { width: v.width || 420, height: v.height || 360 },
            html: v.html, css: v.css || '', js: v.js || '',
            description: v.description || '',
          })
        }
      }
    }
  }

  function openApp(name, html, css, js, opts = {}) {
    if (html) {
      installedApps.set(name, { html, css: css || '', js: js || '', icon: opts.icon || '💻', width: opts.width || 420, height: opts.height || 360, description: opts.description || '' })
      saveApps()
      // Register in AppRegistry
      if (typeof AppRegistry !== 'undefined') {
        AppRegistry.register({
          id: name, name, icon: opts.icon || '💻',
          sandboxed: true, builtin: false, ephemeral: false,
          size: { width: opts.width || 420, height: opts.height || 360 },
          html, css: css || '', js: js || '',
          description: opts.description || '',
        })
      }
    }
    const app = installedApps.get(name)
    if (!app) {
      // Try AppRegistry for registry-only apps
      if (typeof AppRegistry !== 'undefined' && AppRegistry.has(name)) {
        const regApp = AppRegistry.get(name)
        const sz = AppRegistry.resolveSize(regApp)
        const id = create({ type: name, title: regApp.name, width: sz.width, height: sz.height, data: {} })
        updateDock()
        return id
      }
      return null
    }
    const id = create({ type: 'app', title: name, width: app.width || SIZE.small.width, height: app.height || SIZE.small.height, data: { name, html: app.html, css: app.css, js: app.js } })
    updateDock()
    return id
  }

  // ── App Bridge: allows apps to call system tools via postMessage ──
  const APP_BRIDGE_SCRIPT = `
<script>
window.fluidOS = {
  setWallpaper: (opts) => window.fluidOS._call('set_wallpaper', opts),
  playMusic: (opts) => window.fluidOS._call('music', { action: 'play', ...opts }),
  notify: (msg) => window.fluidOS._call('notify', { message: msg }),
  openFile: (path) => window.fluidOS._call('open_file', { path }),
  _call: (tool, params) => {
    const id = Math.random().toString(36).slice(2)
    parent.postMessage({ type: 'fluidOS.tool', id, tool, params }, '*')
    return new Promise((resolve) => {
      const handler = (e) => {
        if (e.data?.type === 'fluidOS.result' && e.data.id === id) {
          window.removeEventListener('message', handler)
          resolve(e.data.result)
        }
      }
      window.addEventListener('message', handler)
      setTimeout(() => { window.removeEventListener('message', handler); resolve({ error: 'timeout' }) }, 10000)
    })
  }
}
<\/script>`

  // Listen for bridge calls from app iframes
  window.addEventListener('message', async (e) => {
    if (e.data?.type !== 'fluidOS.tool') return
    const { id, tool, params } = e.data
    const handler = _appBridgeHandlers[tool]
    const result = handler ? await handler(params) : { error: `Unknown bridge tool: ${tool}` }
    e.source?.postMessage({ type: 'fluidOS.result', id, result }, '*')
  })

  // Allowed tools for app bridge (subset of full tool set)
  const _appBridgeHandlers = {}
  function registerBridgeHandler(name, fn) { _appBridgeHandlers[name] = fn }

  // Built-in bridge handlers (system-level, no agent context needed)
  _appBridgeHandlers.set_wallpaper = ({ css, url, preset }) => {
    const el = document.getElementById('desktop-wallpaper')
    if (!el) return { error: 'No wallpaper element' }
    if (url) {
      el.style.background = `url(${url}) center/cover no-repeat`
    } else if (css) {
      el.style.background = css
    } else if (preset) {
      const presets = {
        aurora: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
        sunset: 'linear-gradient(135deg, #ff6b6b 0%, #ffa07a 30%, #ffd700 60%, #ff4500 100%)',
        ocean: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
        forest: 'linear-gradient(135deg, #134e5e 0%, #71b280 50%, #d4fc79 100%)',
        lavender: 'linear-gradient(135deg, #e8f0fe 0%, #f0e6ff 30%, #e6f7f0 60%, #fef3e0 100%)',
        midnight: 'linear-gradient(135deg, #0a0a2e 0%, #1a1a4e 40%, #2d1b69 70%, #0a0a2e 100%)',
        rose: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 50%, #ff9a9e 100%)',
        sky: 'radial-gradient(ellipse at 20% 50%, rgba(120,180,255,0.25) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(200,150,255,0.2) 0%, transparent 50%), radial-gradient(ellipse at 50% 80%, rgba(100,220,200,0.15) 0%, transparent 50%), linear-gradient(135deg, #e8f0fe 0%, #f0e6ff 30%, #e6f7f0 60%, #fef3e0 100%)',
      }
      el.style.background = presets[preset] || presets.sky
      if (!presets[preset]) return { error: `Unknown preset. Available: ${Object.keys(presets).join(', ')}` }
    }
    return { success: true }
  }

  _appBridgeHandlers.notify = ({ message }) => {
    // Show a toast/notification
    const toast = document.createElement('div')
    toast.className = 'app-bridge-toast'
    toast.textContent = message
    toast.style.cssText = 'position:fixed;top:40px;right:20px;background:rgba(30,30,60,0.95);color:#fff;padding:12px 20px;border-radius:10px;font-size:13px;z-index:99999;backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.1);animation:fadeInOut 3s forwards'
    document.body.appendChild(toast)
    setTimeout(() => toast.remove(), 3000)
    return { success: true }
  }

  function renderApp(w, body) {
    const { html, css, js } = w.data || {}
    // Sandboxed iframe with generated content + bridge
    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #e0e0e0; overflow: hidden; }
button { cursor: pointer; }
input, select, textarea { font-family: inherit; }
${css}
</style>${APP_BRIDGE_SCRIPT}</head><body>${html}<script>${js}<\/script></body></html>`
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
        const norm = w._norm || readNorm(el)
        snapshot.push({
          type: w.type,
          title: el.querySelector('.window-title')?.textContent || w.type,
          nx: norm.x,
          ny: norm.y,
          nw: norm.width,
          nh: norm.height,
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

    const { w: areaW, h: areaH } = getAreaSize()
    let focusId = null
    for (const win of snapshot) {
      // Support both normalized (nx/ny/nw/nh) and legacy px (x/y/width/height)
      let x, y, width, height
      if (win.nx !== undefined) {
        x = win.nx * areaW; y = win.ny * areaH
        width = win.nw * areaW; height = win.nh * areaH
      } else {
        x = win.x; y = win.y; width = win.width; height = win.height
      }
      let id = null
      try {
        switch (win.type) {
          case 'finder': id = create({ type: 'finder', title: win.title, x, y, width, height, data: win.data }); break
          case 'terminal': id = create({ type: 'terminal', title: 'Terminal', x, y, width, height }); break
          case 'editor': if (win.data?.path && VFS.isFile(win.data.path)) id = create({ type: 'editor', title: win.title, x, y, width, height, data: win.data }); break
          case 'settings': id = create({ type: 'settings', title: 'Settings', x, y, width, height }); settingsId = id; break
          case 'browser': id = create({ type: 'browser', title: win.title, x, y, width, height, data: win.data }); break
          case 'map': id = create({ type: 'map', title: 'Map', x, y, width, height, data: win.data }); mapId = id; break
          case 'music': id = create({ type: 'music', title: 'Music', x, y, width, height }); musicId = id; break
          case 'app': if (win.data?.name && installedApps.has(win.data.name)) id = create({ type: 'app', title: win.title, x, y, width, height, data: win.data }); break
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
    // Accept normalized (0-1) or px (>1)
    const { w: aW, h: aH } = getAreaSize()
    const px_x = x <= 1 ? x * aW : x
    const px_y = y <= 1 ? y * aH : y
    w.el.style.left = px_x + 'px'
    w.el.style.top = px_y + 'px'
    w._norm = readNorm(w.el)
    return true
  }

  function resizeWindow(title, width, height) {
    const id = findByTitle(title)
    if (!id) return false
    const w = windows.get(id)
    if (!w) return false
    const { w: aW, h: aH } = getAreaSize()
    if (width) w.el.style.width = (width <= 1 ? width * aW : width) + 'px'
    if (height) w.el.style.height = (height <= 1 ? height * aH : height) + 'px'
    w._norm = readNorm(w.el)
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
    const ids = [...windows.keys()].filter(id => {
      const w = windows.get(id)
      return w && !w.el.classList.contains('minimized')
    })
    if (ids.length === 0) return false
    const n = ids.length
    if (layout === 'horizontal') {
      ids.forEach((id, i) => {
        const win = windows.get(id)
        const norm = { x: i / n, y: 0, width: 1 / n, height: 1 }
        win._norm = norm
        applyPx(win.el, norm)
      })
    } else if (layout === 'grid') {
      const cols = Math.ceil(Math.sqrt(n))
      const rows = Math.ceil(n / cols)
      ids.forEach((id, i) => {
        const win = windows.get(id)
        const col = i % cols
        const row = Math.floor(i / cols)
        const norm = { x: col / cols, y: row / rows, width: 1 / cols, height: 1 / rows }
        win._norm = norm
        applyPx(win.el, norm)
      })
    } else {
      // vertical (default)
      ids.forEach((id, i) => {
        const win = windows.get(id)
        const norm = { x: 0, y: i / n, width: 1, height: 1 / n }
        win._norm = norm
        applyPx(win.el, norm)
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

  function musicAddTrack({ title, artist, style, url, artwork }) {
    if (!title) return { error: 'title is required' }
    if (url) {
      // External URL track
      const entry = { title: title || 'Untitled', artist: artist || 'Unknown', color: '#60a5fa', duration: 180, url, artwork }
      musicState.playlist.push(entry)
      const idx = musicState.playlist.length - 1
      musicRerender()
      return { index: idx }
    }
    // Synth track (existing behavior)
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

  // ── Register builtin apps with AppRegistry ──
  if (typeof AppRegistry !== 'undefined') {
    AppRegistry.register({ id: 'finder', name: 'Finder', icon: '📁', sandboxed: false, size: 'medium', builtin: true, permissions: ['vfs'], render: renderFinder })
    AppRegistry.register({ id: 'terminal', name: 'Terminal', icon: '⬛', sandboxed: false, size: 'medium', builtin: true, permissions: ['vfs', 'shell'], render: renderTerminal })
    AppRegistry.register({ id: 'editor', name: 'Editor', icon: '📝', sandboxed: false, size: 'medium', builtin: true, permissions: ['vfs'], render: renderEditor })
    AppRegistry.register({ id: 'plan', name: 'Plan', icon: '📋', sandboxed: false, size: 'small', builtin: true, render: renderPlan })
    AppRegistry.register({ id: 'settings', name: 'Settings', icon: '⚙️', sandboxed: false, size: 'medium', singleton: true, builtin: true, render: renderSettings })
    AppRegistry.register({ id: 'music', name: 'Music', icon: '🎵', sandboxed: false, size: 'small', singleton: true, builtin: true, render: renderMusic })
    AppRegistry.register({ id: 'video', name: 'Video', icon: '🎬', sandboxed: false, size: 'large', builtin: true, render: renderVideo })
    AppRegistry.register({ id: 'browser', name: 'Browser', icon: '🌐', sandboxed: false, size: 'large', builtin: true, render: renderBrowser })
    AppRegistry.register({ id: 'map', name: 'Map', icon: '🗺️', sandboxed: false, size: 'large', singleton: true, builtin: true, render: renderMap })
    AppRegistry.register({ id: 'launchpad', name: 'Launchpad', icon: '🚀', sandboxed: false, size: { width: 520, height: 420 }, singleton: true, builtin: true, showInLaunchpad: false, render: renderLaunchpad })
    AppRegistry.register({ id: 'taskmanager', name: 'Task Manager', icon: '📊', sandboxed: false, size: 'medium', singleton: true, builtin: true, render: () => renderTaskManager() })
  }

  return { create, close: _close, focus, minimize, unminimize, toggleFullscreen, openLaunchpad, openFinder, openTerminal, openEditor, openPlan, updatePlan, openImage, openSettings, openMusic, openVideo, openBrowser, openMap, openApp, uninstallApp, getInstalledApps, openTaskManager, addTask, updateTask, updateDock, windows, getState, closeByTitle, focusByTitle, loadApps, restoreSession, saveSession, mapAddMarker, mapClearMarkers, mapShowRoute, mapClearRoute, moveWindow, resizeWindow, minimizeByTitle, maximizeByTitle, unminimizeByTitle, tileWindows, musicAddTrack, registerBridgeHandler, renderSandboxedApp, getTaskHistory() { return taskHistory }, getFocused() { for (const [id, w] of windows) { if (w.el.classList.contains('focused')) return id } return null } }
})()
