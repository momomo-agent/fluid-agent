// dynamicapp.js — DynamicApp Runtime
// Agent-driven reactive windows backed by VFS state files.
// Worker writes files → window auto-updates. No new API to learn.

const DynamicApp = (() => {
  const BASE = '/system/dynamic-apps'
  const _watchers = new Map() // appId → { winId, dispose }

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
  function create(id, { title, icon, object, actions, view } = {}) {
    const p = paths(id)
    VFS.mkdir(p.dir)
    VFS.writeFile(p.meta, JSON.stringify({
      id, title: title || id, icon: icon || '⚡',
      createdAt: new Date().toISOString(),
    }, null, 2))
    VFS.writeFile(p.object, JSON.stringify(object || {}, null, 2))
    VFS.writeFile(p.actions, JSON.stringify(actions || [], null, 2))
    if (view) VFS.writeFile(p.view, JSON.stringify(view, null, 2))

    // Register as ephemeral app and open
    const meta = readJSON(p.meta)
    AppRegistry.register({
      id: `dapp-${id}`, name: meta.title, icon: meta.icon,
      sandboxed: false, ephemeral: true, builtin: false,
      showInLaunchpad: false,
      size: 'medium',
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

    if (!AppRegistry.has(`dapp-${id}`)) {
      AppRegistry.register({
        id: `dapp-${id}`, name: meta.title, icon: meta.icon,
        sandboxed: false, ephemeral: true, builtin: false,
        showInLaunchpad: false,
        size: 'medium',
        render: (w, body) => renderDynamicApp(id, w, body),
      })
    }
    const winId = WindowManager.openApp(`dapp-${id}`)
    startWatching(id, winId)
    return { id, winId }
  }

  // Close and clean up
  function close(id) {
    stopWatching(id)
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

    body.innerHTML = ''
    body.classList.add('dapp-body')

    // Object section — render key-value pairs or custom view
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
        // Emit action event for the agent to handle
        if (typeof EventBus !== 'undefined') {
          EventBus.emit('dynamicapp.action', { appId, actionId: action.id, params: action.params || {} })
        }
      })
      el.appendChild(btn)
    }
  }

  // ── VFS Watching ──

  function startWatching(id, winId) {
    stopWatching(id) // clean up any existing watcher
    const p = paths(id)
    const watchPaths = [p.object, p.actions, p.view]

    // VFS.on doesn't return dispose, so we track the handler
    const handler = (event, path) => {
      if (watchPaths.includes(path)) {
        // Re-render the window
        const w = WindowManager.windows.get(winId)
        if (w) {
          const body = w.el.querySelector('.window-body')
          if (body) renderDynamicApp(id, w, body)
        }
      }
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

  return { create, open, close, destroy, list, paths, readJSON, renderDynamicApp, BASE }
})()
