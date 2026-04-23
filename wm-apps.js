/* wm-apps.js — Dynamic/generative apps, bridge, session save/restore */
;(() => {
  const WM = WindowManager
  const { windows, renderWindow, SIZE } = WM._internal

// --- EventBus: window.open handler ---
EventBus.on('window.open', ({ type, ...opts }) => {
  switch (type) {
    case 'finder': WM.openFinder(opts.path || '/home/user'); break
    case 'editor': WM.openEditor(opts.path); break
    case 'terminal': WM.openTerminal(); break
    case 'browser': WM.openBrowser(opts.url); break
    case 'music': WM.openMusic(); break
    case 'video': WM.openVideo(opts.url, opts.title); break
    case 'map': WM.openMap(opts.lat, opts.lng, opts.zoom); break
    case 'image': WM.openImage(opts.src, opts.title); break
    case 'settings': WM.openSettings(); break
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
      const id = WM.create({ type: name, title: regApp.name, width: sz.width, height: sz.height, data: {} })
      WM.updateDock()
      return id
    }
    return null
  }
  const id = WM.create({ type: 'app', title: name, width: app.width || SIZE.small.width, height: app.height || SIZE.small.height, data: { name, html: app.html, css: app.css, js: app.js } })
  WM.updateDock()
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
  WM.updateDock()
  return true
}

// Update dock when windows change
const origClose = WM.close
const _close = (id) => {
  // Music cleanup delegated to wm-media via _internal
  if (WM._internal.onWindowClose) WM._internal.onWindowClose(id)
  origClose(id); WM.updateDock(); saveSession()
}
WM.close = _close

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
        case 'finder': id = WM.create({ type: 'finder', title: win.title, x, y, width, height, data: win.data }); break
        case 'terminal': id = WM.create({ type: 'terminal', title: 'Terminal', x, y, width, height }); break
        case 'editor': if (win.data?.path && VFS.isFile(win.data.path)) id = WM.create({ type: 'editor', title: win.title, x, y, width, height, data: win.data }); break
        case 'settings': id = WM.create({ type: 'settings', title: 'Settings', x, y, width, height }); break
        case 'browser': id = WM.create({ type: 'browser', title: win.title, x, y, width, height, data: win.data }); break
        case 'map': id = WM.create({ type: 'map', title: 'Map', x, y, width, height, data: win.data }); break
        case 'music': id = WM.create({ type: 'music', title: 'Music', x, y, width, height }); break
        case 'app': if (win.data?.name && installedApps.has(win.data.name)) id = WM.create({ type: 'app', title: win.title, x, y, width, height, data: win.data }); break
        // Skip transient types: plan, taskmanager, video, image
      }
    } catch (e) { /* skip broken windows */ }
    if (id && win.minimized) minimize(id)
    if (id && win.focused) focusId = id
  }
  if (focusId) WM.focus(focusId)
  WM.updateDock()
  return true
}

// Hook into drag/resize end to save session
document.addEventListener('mouseup', () => { if (_sessionStore) saveSession() })

// --- Programmatic window manipulation ---

  // --- Register renderer ---
  WM._registerRenderer('app', renderApp)

  // --- Expose to WindowManager ---
  WM._internal.installedApps = installedApps
  WM.openApp = openApp
  WM.getInstalledApps = getInstalledApps
  WM.uninstallApp = uninstallApp
  WM.saveSession = saveSession
  WM.loadApps = loadApps
  WM.restoreSession = restoreSession
  WM.registerBridgeHandler = registerBridgeHandler
})()
