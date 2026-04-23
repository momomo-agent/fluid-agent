// app-runtime.js — Unified App Runtime
// Handles view loading (iframe srcdoc or URL), bridge injection via postMessage,
// VFS data watcher, and action executor (local mutate + worker dispatch).

const AppRuntime = (() => {
  const _instances = new Map() // winId → { appId, appPath, manifest, watcher, iframe }

  /**
   * Render an app that has a `view` field in its manifest.
   * Called from renderWindow when manifest.view exists.
   * @param {HTMLElement} body - .window-body element
   * @param {object} manifest - app manifest (must have .view)
   * @param {string} appPath - VFS directory path (e.g. /tmp/apps/weather)
   * @param {object} w - window object from WindowManager
   */
  function render(body, manifest, appPath, w) {
    // Clean up previous instance for this window
    _cleanup(w.id)

    const viewEntry = manifest.view
    const dataEntry = manifest.data
    const actionsEntry = manifest.actions

    // Resolve paths relative to appPath
    const dataPath = dataEntry ? `${appPath}/${dataEntry}` : null
    const actionsPath = actionsEntry ? `${appPath}/${actionsEntry}` : null

    // Read initial data and actions
    const data = dataPath ? _readJSON(dataPath) || {} : {}
    const actions = actionsPath ? _readJSON(actionsPath) || [] : []

    // Determine if view is a URL or local file
    const isURL = typeof viewEntry === 'string' && /^https?:\/\//.test(viewEntry)

    body.innerHTML = ''
    body.style.padding = '0'
    body.style.display = 'flex'
    body.style.flexDirection = 'column'

    const iframe = document.createElement('iframe')
    iframe.className = 'app-runtime-frame'
    iframe.style.cssText = 'width:100%;flex:1;border:none;background:transparent;min-height:0;'
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')

    if (isURL) {
      // External URL — load via src
      iframe.src = viewEntry
    } else {
      // Local VFS file — read and inject as srcdoc
      const viewPath = `${appPath}/${viewEntry}`
      const viewHtml = VFS.readFile(viewPath) || '<p>View not found</p>'
      iframe.srcdoc = _buildSrcdoc(viewHtml, data, actions, manifest.id)
    }

    body.appendChild(iframe)

    // Render action buttons below iframe (same style as DynamicApp)
    if (actions.length > 0) {
      const actionsBar = document.createElement('div')
      actionsBar.className = 'dapp-actions'
      actionsBar.style.cssText = 'flex-shrink:0;'
      for (const action of actions) {
        const btn = document.createElement('button')
        btn.className = 'dapp-action-btn'
        btn.textContent = action.label || action.id
        if (action.icon) btn.textContent = `${action.icon} ${btn.textContent}`
        if (action.style === 'danger') btn.classList.add('dapp-danger')
        if (action.style === 'primary') btn.classList.add('dapp-primary')
        btn.addEventListener('click', () => {
          _executeAction(action.id, action.params || {}, manifest, appPath, dataPath, actionsPath)
        })
        actionsBar.appendChild(btn)
      }
      body.appendChild(actionsBar)
    }

    // Set up bridge message listener
    const msgHandler = _createBridgeHandler(iframe, manifest, appPath, dataPath, actionsPath, w)
    window.addEventListener('message', msgHandler)

    // Set up VFS watcher for data file changes
    let vfsHandler = null
    if (dataPath || actionsPath) {
      vfsHandler = _createVFSWatcher(iframe, dataPath, actionsPath, manifest, appPath, w)
      VFS.on(vfsHandler)
    }

    // Track instance for cleanup
    _instances.set(w.id, {
      appId: manifest.id, appPath, manifest,
      iframe, msgHandler, vfsHandler,
    })

    // Clean up when iframe is removed from DOM
    const observer = new MutationObserver(() => {
      if (!body.contains(iframe)) {
        _cleanup(w.id)
        observer.disconnect()
      }
    })
    observer.observe(body, { childList: true })
  }

  // ── Build srcdoc with bridge injection ──

  function _buildSrcdoc(html, data, actions, appId) {
    const bridgeScript = `
<script>
(function() {
  var _data = ${JSON.stringify(data)};
  var _actions = ${JSON.stringify(actions)};
  var _listeners = [];

  window.__app = {
    get data() { return _data; },
    get actions() { return _actions; },
    dispatch: function(actionId, params) {
      window.parent.postMessage({
        type: 'app-runtime-dispatch',
        appId: ${JSON.stringify(appId)},
        actionId: actionId,
        params: params || {}
      }, '*');
    },
    onDataUpdate: function(cb) { _listeners.push(cb); }
  };

  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'app-runtime-data') {
      _data = e.data.data;
      for (var i = 0; i < _listeners.length; i++) _listeners[i](_data);
    }
    if (e.data && e.data.type === 'app-runtime-actions') {
      _actions = e.data.actions;
    }
  });
})();
<\/script>`

    // PLACEHOLDER_CONTINUE_SRCDOC
    if (html.includes('<html') || html.includes('<HTML')) {
      // Full HTML doc — inject bridge before </head>
      if (html.includes('</head>')) {
        return html.replace('</head>', bridgeScript + '</head>')
      }
      // No </head> — inject before </html> or at end
      if (html.includes('</html>')) {
        return html.replace('</html>', bridgeScript + '</html>')
      }
      return html + bridgeScript
    }
    // Fragment — wrap in full document
    return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #e0e0e0; background: transparent; line-height: 1.5; }
a { color: #7eb8ff; }
</style>
${bridgeScript}
</head><body>${html}</body></html>`
  }

  // ── Bridge handler: receives dispatch calls from iframe ──

  function _createBridgeHandler(iframe, manifest, appPath, dataPath, actionsPath, w) {
    return function(e) {
      if (e.source !== iframe.contentWindow) return
      if (e.data?.type === 'app-runtime-dispatch') {
        _executeAction(e.data.actionId, e.data.params, manifest, appPath, dataPath, actionsPath)
      }
    }
  }

  // ── Action executor ──

  function _executeAction(actionId, params, manifest, appPath, dataPath, actionsPath) {
    // Read current actions list
    const actions = actionsPath ? _readJSON(actionsPath) || [] : []
    const actionDef = actions.find(a => a.id === actionId)
    if (!actionDef) {
      console.warn(`[AppRuntime] Action "${actionId}" not found for app "${manifest.id}"`)
      return
    }

    if (actionDef.handler === 'local' && actionDef.mutate && dataPath) {
      // Local mutate: evaluate expressions against current data
      const data = _readJSON(dataPath) || {}
      const newData = { ...data }
      for (const [key, expr] of Object.entries(actionDef.mutate)) {
        try {
          // Build a function that has access to all data fields + params
          const fn = new Function(...Object.keys(data), ...Object.keys(params || {}), `return (${expr})`)
          newData[key] = fn(...Object.values(data), ...Object.values(params || {}))
        } catch (err) {
          console.warn(`[AppRuntime] Mutate error for "${key}":`, err)
        }
      }
      VFS.writeFile(dataPath, JSON.stringify(newData, null, 2))
      // VFS watcher will push the update to the iframe
    } else {
      // Default: dispatch as intent (same pipeline as user chat)
      const data = dataPath ? _readJSON(dataPath) || {} : {}
      const label = actionDef.label || actionId
      const appName = manifest.name || manifest.id
      const dataSnippet = JSON.stringify(data).slice(0, 500)
      const paramStr = params && Object.keys(params).length ? ` with ${JSON.stringify(params)}` : ''
      const goal = `User clicked "${label}"${paramStr} in ${appName} app. Current data: ${dataSnippet}. App path: ${appPath}`

      if (typeof IntentState !== 'undefined') {
        IntentState.create(goal)
      } else if (typeof EventBus !== 'undefined') {
        // Fallback if IntentState not loaded
        EventBus.emit('app-runtime.action', {
          appId: manifest.id, actionId, params: params || {},
          appPath, dataPath, actionsPath,
        })
      }
    }
  }

  // ── VFS watcher: push data/actions changes to iframe ──

  function _createVFSWatcher(iframe, dataPath, actionsPath, manifest, appPath, w) {
    return function(event, path) {
      if (path !== dataPath && path !== actionsPath) return
      if (!iframe.contentWindow) return

      if (path === dataPath) {
        const newData = _readJSON(dataPath) || {}
        iframe.contentWindow.postMessage({ type: 'app-runtime-data', data: newData }, '*')
      }
      if (path === actionsPath) {
        const newActions = _readJSON(actionsPath) || []
        iframe.contentWindow.postMessage({ type: 'app-runtime-actions', actions: newActions }, '*')
      }
    }
  }

  // ── Cleanup ──

  function _cleanup(winId) {
    const inst = _instances.get(winId)
    if (!inst) return
    if (inst.msgHandler) window.removeEventListener('message', inst.msgHandler)
    if (inst.vfsHandler) VFS.off(inst.vfsHandler)
    _instances.delete(winId)
  }

  // ── Helpers ──

  function _readJSON(path) {
    try {
      const raw = VFS.readFile(path)
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  }

  /**
   * Check if a manifest uses the new unified view system.
   */
  function hasView(manifest) {
    return !!(manifest && manifest.view)
  }

  return { render, hasView, _cleanup }
})()
