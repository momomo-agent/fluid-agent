// app-registry.js — Unified App Registry
// All apps (builtin, user, ephemeral) register here with a manifest.
// Rendering is dispatched through the registry instead of switch-case.

const AppRegistry = (() => {
  const _apps = new Map()  // id → manifest

  /**
   * Register an app manifest.
   * @param {object} manifest
   * @param {string} manifest.id - unique app id (e.g. 'finder', 'terminal', 'user-weather')
   * @param {string} manifest.name - display name
   * @param {string} [manifest.icon='💻'] - emoji or URL
   * @param {boolean} [manifest.sandboxed=true] - false = direct DOM, true = iframe
   * @param {string|object} [manifest.size='medium'] - 'small'|'medium'|'large' or {width,height}
   * @param {boolean} [manifest.singleton=false] - only one instance allowed
   * @param {string[]} [manifest.permissions=[]] - system capabilities this app can access
   * @param {boolean} [manifest.builtin=false]
   * @param {boolean} [manifest.ephemeral=false] - true = destroyed on window close
   * @param {function} [manifest.render] - render(body, ctx) for sandboxed=false apps
   * @param {function} [manifest.onAction] - action handler for sandboxed=false apps
   * @param {string} [manifest.html] - for sandboxed=true apps
   * @param {string} [manifest.css] - for sandboxed=true apps
   * @param {string} [manifest.js] - for sandboxed=true apps
   * @param {string} [manifest.description]
   * @param {string} [manifest.category='system'|'user'|'ephemeral']
   * @param {string} [manifest.view] - view entry: local filename or URL
   * @param {string} [manifest.data] - data file name (reactive state JSON)
   * @param {string} [manifest.actions] - actions file name (declarative action list)
   * @param {string} [manifest._appPath] - VFS directory path (set by scanVFS)
   */
  function register(manifest) {
    if (!manifest.id) throw new Error('App manifest must have an id')
    _apps.set(manifest.id, {
      icon: '💻',
      sandboxed: true,
      size: 'medium',
      singleton: false,
      permissions: [],
      builtin: false,
      ephemeral: false,
      ...manifest,
    })
  }

  function get(id) {
    return _apps.get(id)
  }

  function has(id) {
    return _apps.has(id)
  }

  function unregister(id) {
    const app = _apps.get(id)
    if (!app) return false
    if (app.builtin) return false
    _apps.delete(id)
    return true
  }

  function list(filter) {
    const all = [..._apps.values()]
    return filter ? all.filter(filter) : all
  }

  // Apps visible in Launchpad
  function launchpadApps() {
    return list(a => !a.ephemeral && a.showInLaunchpad !== false)
  }

  // Resolve size to {width, height}
  const SIZES = {
    small:  { width: 420, height: 360 },
    medium: { width: 600, height: 460 },
    large:  { width: 780, height: 520 },
  }

  function resolveSize(app) {
    if (typeof app.size === 'string') return SIZES[app.size] || SIZES.medium
    if (typeof app.size === 'object') return { width: app.size.width || 500, height: app.size.height || 350 }
    return SIZES.medium
  }

  // Scan a VFS directory for app manifests
  function scanVFS(basePath) {
    if (typeof VFS === 'undefined') return
    const dirs = VFS.ls(basePath)
    if (!dirs) return
    for (const entry of dirs) {
      if (entry.type !== 'dir') continue
      const appDir = `${basePath}/${entry.name}`
      const manifestPath = `${appDir}/manifest.json`
      if (VFS.isFile(manifestPath)) {
        try {
          const manifest = JSON.parse(VFS.readFile(manifestPath))
          manifest._appPath = appDir // store resolved directory
          // Don't overwrite builtin apps that already have render functions
          const existing = _apps.get(manifest.id)
          if (existing && existing.render && !manifest.view) {
            // Merge manifest fields but keep the render function
            _apps.set(manifest.id, { ...manifest, render: existing.render })
          } else {
            register(manifest)
          }
        } catch (e) {
          console.warn(`AppRegistry: bad manifest at ${manifestPath}`, e)
        }
      }
    }
  }

  // Watch VFS for app changes (new installs, updates, removals)
  function watchVFS() {
    if (typeof VFS === 'undefined') return
    const appPaths = ['/system/apps', '/home/user/apps', '/tmp/apps']
    VFS.on((event, path) => {
      for (const base of appPaths) {
        if (path.startsWith(base + '/') && path.endsWith('/manifest.json')) {
          if (event === 'rm') {
            // Extract app id from path
            const parts = path.split('/')
            const appId = parts[parts.length - 2]
            const app = _apps.get(appId)
            if (app && !app.builtin) _apps.delete(appId)
          } else {
            // Re-scan the specific app
            const parts = path.split('/')
            const appDir = parts.slice(0, -1).join('/')
            const appId = parts[parts.length - 2]
            try {
              const manifest = JSON.parse(VFS.readFile(path))
              manifest._appPath = appDir
              const existing = _apps.get(manifest.id || appId)
              if (existing && existing.render && !manifest.view) {
                _apps.set(manifest.id || appId, { ...manifest, render: existing.render })
              } else {
                register({ id: appId, ...manifest })
              }
            } catch (e) { /* ignore bad manifest */ }
          }
        }
      }
    })
  }

  return { register, get, has, unregister, list, launchpadApps, resolveSize, scanVFS, watchVFS, SIZES }
})()
