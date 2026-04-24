/* wm-core.js — Window Manager core: lifecycle, drag, resize, focus, normalize */
const WindowManager = (() => {
  let nextId = 1
  let topZ = 100
  const windows = new Map()
  const area = () => document.getElementById('desktop-area')

  // --- Renderer registry (populated by wm-builtins.js, wm-media.js, wm-apps.js) ---
  const _renderers = {}
  function _registerRenderer(type, fn) { _renderers[type] = fn }

  // --- Centralized drag/resize state ---
  let _activeDrag = null
  let _activeResize = null

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
      const win = windows.get(_activeDrag.id)
      if (win) win._norm = readNorm(_activeDrag.el)
      _activeDrag = null
      enableIframePointers()
    }
    if (_activeResize) {
      const body = _activeResize.el.querySelector('.window-body')
      if (body) body.style.pointerEvents = ''
      const resId = _activeResize.el.id
      const win = windows.get(resId)
      if (win) win._norm = readNorm(_activeResize.el)
      _activeResize = null
      enableIframePointers()
    }
  })

  // --- Normalized coordinate helpers ---
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
    const { w, h } = getAreaSize()
    return {
      x: parseFloat(el.style.left) / w,
      y: parseFloat(el.style.top) / h,
      width: parseFloat(el.style.width) / w,
      height: parseFloat(el.style.height) / h,
    }
  }

  // Reflow all windows on resize
  let _resizeTimer
  function _observeArea() {
    window.addEventListener('resize', () => {
      clearTimeout(_resizeTimer)
      _resizeTimer = setTimeout(() => {
        for (const [, w] of windows) {
          if (w._norm) applyPx(w.el, w._norm)
        }
      }, 100)
    })
  }
  _observeArea()

  function findBestPosition(ww, wh, areaW, areaH) {
    const existing = [...windows.values()].map(w => ({
      x: parseFloat(w.el.style.left), y: parseFloat(w.el.style.top),
      w: parseFloat(w.el.style.width), h: parseFloat(w.el.style.height),
    }))
    if (existing.length === 0) {
      return { x: Math.max(20, (areaW - ww) / 2), y: Math.max(20, (areaH - wh) / 3) }
    }
    let bestX = 40, bestY = 40, minOverlap = Infinity
    for (let attempt = 0; attempt < 20; attempt++) {
      const cx = 30 + Math.random() * Math.max(0, areaW - ww - 60)
      const cy = 30 + Math.random() * Math.max(0, areaH - wh - 60)
      let overlap = 0
      for (const e of existing) {
        const ox = Math.max(0, Math.min(cx + ww, e.x + e.w) - Math.max(cx, e.x))
        const oy = Math.max(0, Math.min(cy + wh, e.y + e.h) - Math.max(cy, e.y))
        overlap += ox * oy
      }
      if (overlap < minOverlap) { minOverlap = overlap; bestX = cx; bestY = cy }
      if (overlap === 0) break
    }
    return { x: bestX, y: bestY }
  }

  // --- Window lifecycle ---
  function create({ type, title, x, y, width, height, data }) {
    const id = `win-${nextId++}`
    const { w: areaW, h: areaH } = getAreaSize()

    // Resolve size from AppRegistry
    let ww = width || 600, wh = height || 460
    if (typeof AppRegistry !== 'undefined') {
      const appDef = AppRegistry.get(type)
      if (appDef) {
        const resolved = AppRegistry.resolveSize(appDef)
        ww = width || resolved.width
        wh = height || resolved.height
      }
    }

    const pos = (x != null && y != null) ? { x, y } : findBestPosition(ww, wh, areaW, areaH)

    const el = document.createElement('div')
    el.className = 'window focused'
    el.id = id
    el.style.cssText = `left:${pos.x}px;top:${pos.y}px;width:${ww}px;height:${wh}px;z-index:${++topZ}`

    // Title bar
    const tb = document.createElement('div')
    tb.className = 'title-bar'
    const dots = document.createElement('div')
    dots.className = 'window-dots'
    dots.innerHTML = '<span class="dot dot-close"></span><span class="dot dot-min"></span><span class="dot dot-max"></span>'
    const titleSpan = document.createElement('span')
    titleSpan.className = 'window-title'
    titleSpan.textContent = title || type
    tb.append(dots, titleSpan)

    // Body
    const body = document.createElement('div')
    body.className = 'window-body'

    // Resize handle
    const rh = document.createElement('div')
    rh.className = 'resize-handle'

    el.append(tb, body, rh)
    area().appendChild(el)

    // Store normalized position
    const norm = readNorm(el)

    const w = { el, type, title: title || type, data: data || {}, _norm: norm }
    windows.set(id, w)

    // Render content via registry
    renderWindow(w)

    // Focus
    windows.forEach((ww, wid) => { if (wid !== id) ww.el.classList.remove('focused') })

    // Dot handlers
    dots.querySelector('.dot-close').onclick = e => { e.stopPropagation(); _close(id) }
    dots.querySelector('.dot-min').onclick = e => { e.stopPropagation(); minimize(id) }
    dots.querySelector('.dot-max').onclick = e => { e.stopPropagation(); toggleFullscreen(id) }

    // Drag
    tb.addEventListener('mousedown', e => {
      if (e.target.classList.contains('dot') || e.target.closest('.dot')) return
      focus(id)
      const rect = el.getBoundingClientRect()
      const areaRect = area().getBoundingClientRect()
      _activeDrag = { el, id, offsetX: e.clientX - (rect.left - areaRect.left), offsetY: e.clientY - (rect.top - areaRect.top) }
      body.style.pointerEvents = 'none'
      disableIframePointers()
    })

    // Resize
    rh.addEventListener('mousedown', e => {
      e.stopPropagation()
      focus(id)
      _activeResize = { el, startX: e.clientX, startY: e.clientY, startW: el.offsetWidth, startH: el.offsetHeight }
      body.style.pointerEvents = 'none'
      disableIframePointers()
    })

    // Click to focus
    el.addEventListener('mousedown', () => focus(id))

    // Update dock
    updateDock()
    EventBus.emit('window:created', { id, type, title: w.title })
    return id
  }

  function _close(id) {
    const w = windows.get(id)
    if (!w) return
    w.el.remove()
    windows.delete(id)
    updateDock()
    EventBus.emit('window:closed', { id, type: w.type, title: w.title })
  }

  function focus(id) {
    const w = windows.get(id)
    if (!w) return
    windows.forEach(ww => ww.el.classList.remove('focused'))
    w.el.classList.add('focused')
    w.el.style.zIndex = ++topZ
    EventBus.emit('window:focused', { id, type: w.type, title: w.title })
  }

  function minimize(id) {
    const w = windows.get(id)
    if (!w) return
    w.el.classList.add('minimized')
    w.el.classList.remove('focused')
    updateDock()
  }

  function unminimize(id) {
    const w = windows.get(id)
    if (!w) return
    w.el.classList.remove('minimized')
    focus(id)
    updateDock()
  }

  function toggleFullscreen(id) {
    const w = windows.get(id)
    if (!w) return
    if (w.el.classList.contains('fullscreen')) {
      w.el.classList.remove('fullscreen')
      if (w._norm) applyPx(w.el, w._norm)
    } else {
      w._norm = readNorm(w.el)
      w.el.classList.add('fullscreen')
      w.el.style.left = '0'; w.el.style.top = '0'
      w.el.style.width = '100%'; w.el.style.height = '100%'
    }
  }

  // --- Render dispatch ---
  function renderWindow(w) {
    const body = w.el.querySelector('.window-body')
    if (!body) return
    const renderer = _renderers[w.type]
    if (renderer) {
      renderer(w, body)
    } else if (typeof AppRuntime !== 'undefined' && AppRuntime.canRender && AppRuntime.canRender(w.type)) {
      const _app = AppRegistry.get(w.type)
      AppRuntime.render(body, _app, _app._appPath, w)
    } else {
      body.innerHTML = `<div style="padding:20px;color:var(--text-muted)">Unknown window type: ${w.type}</div>`
    }
  }

  // --- Sandboxed app rendering (used by AppRuntime) ---
  function renderSandboxedApp(body, app, w) {
    body.innerHTML = ''
    const iframe = document.createElement('iframe')
    iframe.sandbox = 'allow-scripts allow-same-origin'
    iframe.style.cssText = 'width:100%;height:100%;border:none;background:transparent;'
    const html = `<!DOCTYPE html><html><head><style>
      body { margin:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #e0e0e0; background: transparent; }
      ${app.css || ''}
    </style></head><body>${app.html || ''}
    <script>
      window.__object = ${JSON.stringify(app.data || {})};
      window.__app = {
        data: window.__object,
        dispatch: (id, params) => window.parent.postMessage({ type: 'app-action', appId: '${w.type}', actionId: id, params }, '*'),
        onDataUpdate: (cb) => { window.__onDataUpdate = cb },
      };
      window.triggerAction = window.__app.dispatch;
      window.onDataUpdate = window.__app.onDataUpdate;
      ${app.js || ''}
    </script></body></html>`
    iframe.srcdoc = html
    body.appendChild(iframe)
  }

  // --- Dock ---
  function updateDock() {
    const dock = document.getElementById('dock')
    if (!dock) return
    const items = [...windows.values()]
    dock.innerHTML = items.map(w => {
      const icon = _getIcon(w.type)
      const min = w.el.classList.contains('minimized') ? ' dock-minimized' : ''
      const foc = w.el.classList.contains('focused') ? ' dock-focused' : ''
      return `<div class="dock-item${min}${foc}" data-id="${w.el.id}" title="${w.title}">${icon}</div>`
    }).join('')
    dock.querySelectorAll('.dock-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id
        const w = windows.get(id)
        if (w?.el.classList.contains('minimized')) unminimize(id)
        else focus(id)
      })
    })
  }

  function _getIcon(type) {
    if (typeof AppRegistry !== 'undefined') {
      const app = AppRegistry.get(type)
      if (app?.icon) return app.icon
    }
    const icons = { finder: '📁', terminal: '⬛', editor: '📝', plan: '📋', settings: '⚙️', image: '🖼️', music: '🎵', video: '🎬', browser: '🌐', map: '🗺️', launchpad: '🚀', taskmanager: '📊' }
    return icons[type] || '💻'
  }

  // --- State ---
  function getState() {
    return [...windows.entries()].map(([id, w]) => ({
      id, type: w.type, title: w.title,
      minimized: w.el.classList.contains('minimized'),
      focused: w.el.classList.contains('focused'),
    }))
  }

  // --- Shared internal state for other wm-*.js files ---
  // Standard window sizes
  const SIZE = {
    small:  { width: 420, height: 360 },
    medium: { width: 600, height: 460 },
    large:  { width: 780, height: 520 },
  }

  const _internal = {
    windows, area, getAreaSize, toPx, toNorm, applyPx, readNorm,
    findBestPosition, renderWindow, _getIcon, updateDock, SIZE,
    get topZ() { return topZ }, set topZ(v) { topZ = v },
    get nextId() { return nextId }, set nextId(v) { nextId = v },
  }

  return {
    // Core
    create, close: _close, focus, minimize, unminimize, toggleFullscreen,
    updateDock, windows, getState, renderSandboxedApp,
    // Registry
    _registerRenderer, _internal,
  }
})()
