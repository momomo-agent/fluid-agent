// dynamicapp.js — DynamicApp Runtime
// Agent-driven reactive windows backed by VFS state files.
// Worker writes files → window auto-updates. No new API to learn.

const DynamicApp = (() => {
  const BASE = '/system/dynamic-apps'
  const _watchers = new Map() // appId → { winId, dispose }
  const _viewCache = new Map() // appId → compiled HTML string

  function paths(id) {
    const dir = `${BASE}/${id}`
    return {
      dir,
      meta: `${dir}/meta.json`,
      object: `${dir}/object.json`,
      actions: `${dir}/actions.json`,
      view: `${dir}/view.json`,
    }
  }

  // Read and parse a JSON file from VFS, return null on failure
  function readJSON(path) {
    try {
      const raw = VFS.readFile(path)
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  }

  // Create a DynamicApp: write state files + open window
  function create(id, { title, icon, object, actions, view, size } = {}) {
    const p = paths(id)
    VFS.mkdir(p.dir)
    VFS.writeFile(p.meta, JSON.stringify({
      id, title: title || id, icon: icon || '⚡',
      createdAt: new Date().toISOString(),
    }, null, 2))
    VFS.writeFile(p.object, JSON.stringify(object || {}, null, 2))
    VFS.writeFile(p.actions, JSON.stringify(actions || [], null, 2))
    if (view) VFS.writeFile(p.view, JSON.stringify(view, null, 2))

    // Auto-size: small for simple data, medium for complex
    const appSize = size || _autoSize(object, actions)

    // Register as ephemeral app and open
    const meta = readJSON(p.meta)
    AppRegistry.register({
      id: `dapp-${id}`, name: meta.title, icon: meta.icon,
      sandboxed: false, ephemeral: true, builtin: false,
      showInLaunchpad: false,
      size: appSize,
      render: (w, body) => renderDynamicApp(id, w, body),
    })
    const winId = WindowManager.openApp(`dapp-${id}`)
    startWatching(id, winId)
    return { id, winId }
  }

  // Open an existing DynamicApp (re-open window)
  function open(id) {
    const p = paths(id)
    const meta = readJSON(p.meta)
    if (!meta) return { error: `DynamicApp "${id}" not found` }

    const object = readJSON(p.object) || {}
    const actions = readJSON(p.actions) || []

    if (!AppRegistry.has(`dapp-${id}`)) {
      AppRegistry.register({
        id: `dapp-${id}`, name: meta.title, icon: meta.icon,
        sandboxed: false, ephemeral: true, builtin: false,
        showInLaunchpad: false,
        size: _autoSize(object, actions),
        render: (w, body) => renderDynamicApp(id, w, body),
      })
    }
    const winId = WindowManager.openApp(`dapp-${id}`)
    startWatching(id, winId)
    return { id, winId }
  }

  // Update an existing DynamicApp's state files
  function update(id, { object, actions, view, html } = {}) {
    const p = paths(id)
    if (!VFS.isFile(p.meta)) return { error: `DynamicApp "${id}" not found` }
    if (object !== undefined) VFS.writeFile(p.object, JSON.stringify(object, null, 2))
    if (actions !== undefined) VFS.writeFile(p.actions, JSON.stringify(actions, null, 2))
    if (view !== undefined) VFS.writeFile(p.view, JSON.stringify(view, null, 2))
    if (html !== undefined) {
      VFS.writeFile(p.dir + '/view.html', html)
      _viewCache.delete(id) // invalidate cache
    }
    return { success: true, id }
  }

  // Close and clean up
  function close(id) {
    stopWatching(id)
    _viewCache.delete(id)
    AppRegistry.unregister(`dapp-${id}`)
    // Don't delete VFS files — they persist for re-opening
    return { success: true }
  }

  // Destroy: close + delete VFS files
  function destroy(id) {
    close(id)
    const p = paths(id)
    for (const key of ['meta', 'object', 'actions', 'view']) {
      if (VFS.isFile(p[key])) VFS.rm(p[key])
    }
    const htmlPath = p.dir + '/view.html'
    if (VFS.isFile(htmlPath)) VFS.rm(htmlPath)
    if (VFS.isDir(p.dir)) VFS.rm(p.dir)
    return { success: true }
  }

  // List all DynamicApps
  function list() {
    const dirs = VFS.ls(BASE)
    if (!dirs) return []
    return dirs.filter(d => d.type === 'dir').map(d => {
      const meta = readJSON(`${BASE}/${d.name}/meta.json`)
      return meta || { id: d.name, title: d.name }
    })
  }

  // ── Rendering ──

  function renderDynamicApp(id, w, body) {
    const p = paths(id)
    const meta = readJSON(p.meta) || { title: id }
    const object = readJSON(p.object) || {}
    const actions = readJSON(p.actions) || []
    const view = readJSON(p.view)
    const htmlPath = p.dir + '/view.html'
    const customHtml = VFS.isFile(htmlPath) ? VFS.readFile(htmlPath) : null

    body.innerHTML = ''
    body.classList.add('dapp-body')

    // Custom HTML view — sandboxed iframe with object data injected
    if (customHtml) {
      renderCustomView(body, customHtml, object, actions, id)
      return
    }

    // Object section — render key-value pairs or template view
    const objectEl = document.createElement('div')
    objectEl.className = 'dapp-object'
    renderObject(objectEl, object, view)
    body.appendChild(objectEl)

    // Actions section
    if (actions.length > 0) {
      const actionsEl = document.createElement('div')
      actionsEl.className = 'dapp-actions'
      renderActions(actionsEl, actions, id)
      body.appendChild(actionsEl)
    }
  }

  // Render custom HTML view in a sandboxed iframe
  function renderCustomView(body, html, object, actions, appId) {
    // Inject object data and action bridge into the HTML
    const injection = `
<script>
  window.__object = ${JSON.stringify(object)};
  window.__actions = ${JSON.stringify(actions)};
  window.__appId = ${JSON.stringify(appId)};
  // Action bridge: call triggerAction(actionId, params) to emit to parent
  function triggerAction(actionId, params) {
    window.parent.postMessage({ type: 'dapp-action', appId: window.__appId, actionId, params: params || {} }, '*');
  }
  // Also expose as window.__app for consistency with AppRuntime bridge
  window.__app = {
    get data() { return window.__object; },
    get actions() { return window.__actions; },
    dispatch: triggerAction,
    onDataUpdate: function(cb) { window.__onDataUpdateCbs = window.__onDataUpdateCbs || []; window.__onDataUpdateCbs.push(cb); }
  };
  // Listen for data updates from parent (smart re-render)
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'dapp-update' && e.data.object) {
      window.__object = e.data.object;
      if (typeof onDataUpdate === 'function') onDataUpdate(window.__object);
      (window.__onDataUpdateCbs || []).forEach(cb => cb(window.__object));
    }
  });
  // Notify parent of height changes for auto-resize
  const _ro = new ResizeObserver(() => {
    window.parent.postMessage({ type: 'dapp-resize', height: document.body.scrollHeight }, '*');
  });
  _ro.observe(document.body);
</script>`

    // Build full HTML document
    const fullHtml = html.includes('<html') ? html.replace('</head>', injection + '</head>') :
      `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #e0e0e0; background: transparent; padding: 16px; line-height: 1.5; }
  a { color: #7eb8ff; }
</style>
${injection}
</head><body>${html}</body></html>`

    const iframe = document.createElement('iframe')
    iframe.className = 'dapp-custom-frame'
    iframe.sandbox = 'allow-scripts allow-same-origin'
    iframe.srcdoc = fullHtml
    iframe.style.cssText = 'width:100%;border:none;flex:1;min-height:200px;background:transparent;'

    // Listen for messages from iframe
    const msgHandler = (e) => {
      if (e.source !== iframe.contentWindow) return
      if (e.data?.type === 'dapp-action') {
        _dispatchAction(e.data.appId, e.data.actionId, e.data.params || {})
      } else if (e.data?.type === 'dapp-resize') {
        iframe.style.height = Math.min(e.data.height + 20, 800) + 'px'
      }
    }
    window.addEventListener('message', msgHandler)

    // Clean up listener when body is cleared
    const observer = new MutationObserver(() => {
      if (!body.contains(iframe)) {
        window.removeEventListener('message', msgHandler)
        observer.disconnect()
      }
    })
    observer.observe(body, { childList: true })

    body.style.padding = '0'
    body.appendChild(iframe)
  }

  function renderObject(el, object, view) {
    // If view specifies a template, use it
    if (view?.template === 'markdown' && object.content) {
      el.innerHTML = `<div class="dapp-markdown">${escapeHtml(object.content).replace(/\n/g, '<br>')}</div>`
      return
    }
    if (view?.template === 'table' && Array.isArray(object.rows)) {
      renderTable(el, object)
      return
    }
    if (view?.template === 'list' && Array.isArray(object.items)) {
      el.innerHTML = `<div class="dapp-list">${object.items.map(item =>
        `<div class="dapp-list-item">${typeof item === 'string' ? escapeHtml(item) : escapeHtml(item.text || JSON.stringify(item))}</div>`
      ).join('')}</div>`
      return
    }

    // Default: render as key-value cards
    if (object.title) {
      el.innerHTML += `<div class="dapp-title">${escapeHtml(object.title)}</div>`
    }
    if (object.description) {
      el.innerHTML += `<div class="dapp-desc">${escapeHtml(object.description)}</div>`
    }
    // Render remaining fields as cards
    const skip = new Set(['title', 'description'])
    const fields = Object.entries(object).filter(([k]) => !skip.has(k))
    if (fields.length > 0) {
      const grid = document.createElement('div')
      grid.className = 'dapp-fields'
      for (const [key, value] of fields) {
        const card = document.createElement('div')
        card.className = 'dapp-field'
        card.innerHTML = `<div class="dapp-field-key">${escapeHtml(key)}</div><div class="dapp-field-value">${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : String(value))}</div>`
        grid.appendChild(card)
      }
      el.appendChild(grid)
    }
    if (!object.title && fields.length === 0) {
      el.innerHTML = `<div class="dapp-empty">No data yet</div>`
    }
  }

  function renderTable(el, object) {
    const cols = object.columns || (object.rows[0] ? Object.keys(object.rows[0]) : [])
    el.innerHTML = `<table class="dapp-table">
      <thead><tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
      <tbody>${object.rows.map(row =>
        `<tr>${cols.map(c => `<td>${escapeHtml(String(row[c] ?? ''))}</td>`).join('')}</tr>`
      ).join('')}</tbody>
    </table>`
  }

  function renderActions(el, actions, appId) {
    for (const action of actions) {
      const btn = document.createElement('button')
      btn.className = 'dapp-action-btn'
      btn.textContent = action.label || action.id
      if (action.icon) btn.textContent = `${action.icon} ${btn.textContent}`
      if (action.style === 'danger') btn.classList.add('dapp-danger')
      if (action.style === 'primary') btn.classList.add('dapp-primary')
      btn.addEventListener('click', () => {
        _dispatchAction(appId, action.id, action.params || {})
      })
      el.appendChild(btn)
    }
  }

  // ── VFS Watching ──

  function startWatching(id, winId) {
    stopWatching(id) // clean up any existing watcher
    const p = paths(id)
    const watchPaths = [p.object, p.actions, p.view, p.dir + '/view.html']

    // VFS.on doesn't return dispose, so we track the handler
    const handler = (event, path) => {
      if (!watchPaths.includes(path)) return
      const w = WindowManager.windows.get(winId)
      if (!w) return
      const body = w.el.querySelector('.window-body')
      if (!body) return

      // Smart update: if custom HTML iframe exists and only object.json changed,
      // push new data via postMessage instead of rebuilding the iframe
      const iframe = body.querySelector('.dapp-custom-frame')
      if (iframe && path === p.object) {
        const newObject = readJSON(p.object) || {}
        iframe.contentWindow?.postMessage({ type: 'dapp-update', object: newObject }, '*')
        return
      }

      // Full re-render for view.html changes, actions changes, or non-iframe views
      renderDynamicApp(id, w, body)
    }
    VFS.on(handler)
    _watchers.set(id, { winId, handler })
  }

  function stopWatching(id) {
    const w = _watchers.get(id)
    if (w) {
      VFS.off(w.handler)
      _watchers.delete(id)
    }
  }

  // ── Helpers ──

  function escapeHtml(str) {
    const div = document.createElement('div')
    div.textContent = str
    return div.innerHTML
  }

  // ── Action dispatch (unified with IntentState) ──

  // Auto-determine window size based on content complexity
  function _autoSize(object, actions) {
    const keys = Object.keys(object || {})
    const numActions = (actions || []).length
    // Large: many fields or table-like data
    if (keys.length > 8 || (keys.length > 0 && Array.isArray(Object.values(object)[0]))) return 'large'
    // Small: few fields, few actions
    if (keys.length <= 4 && numActions <= 3) return 'small'
    return 'medium'
  }

  function _dispatchAction(appId, actionId, params) {
    // Read action definition to check for local mutate
    const p = paths(appId)
    const actions = readJSON(p.actions) || []
    const actionDef = actions.find(a => a.id === actionId)

    if (actionDef?.handler === 'local' && actionDef.mutate) {
      // Local mutate: update object.json directly, VFS watcher pushes to iframe
      const object = readJSON(p.object) || {}
      const newObject = { ...object }
      for (const [key, expr] of Object.entries(actionDef.mutate)) {
        try {
          const fn = new Function(...Object.keys(object), ...Object.keys(params || {}), `return (${expr})`)
          newObject[key] = fn(...Object.values(object), ...Object.values(params || {}))
        } catch (err) {
          console.warn(`[DynamicApp] Mutate error for "${key}":`, err)
        }
      }
      VFS.writeFile(p.object, JSON.stringify(newObject, null, 2))
    } else {
      // Route to IntentState → Dispatcher → Worker (same as AppRuntime)
      const meta = readJSON(p.meta) || { title: appId }
      const object = readJSON(p.object) || {}
      const label = actionDef?.label || actionId
      const dataSnippet = JSON.stringify(object).slice(0, 500)
      const paramStr = params && Object.keys(params).length ? ` with ${JSON.stringify(params)}` : ''
      const goal = `User clicked "${label}"${paramStr} in ${meta.title} app. Current data: ${dataSnippet}.`

      if (typeof IntentState !== 'undefined') {
        IntentState.create(goal)
      } else if (typeof EventBus !== 'undefined') {
        EventBus.emit('dynamicapp.action', { appId, actionId, params })
      }
    }
  }

  return { create, open, close, destroy, update, list, paths, readJSON, renderDynamicApp, BASE }
})()
