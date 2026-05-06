import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useVFSStore } from './vfs.js'

// Standard window sizes
const SIZES = {
  small: { width: 420, height: 360 },
  medium: { width: 600, height: 460 },
  large: { width: 780, height: 520 },
}

export const useAppRegistryStore = defineStore('appRegistry', () => {
  const apps = ref(new Map())

  /**
   * Register an app manifest.
   */
  function register(manifest) {
    if (!manifest.id) throw new Error('App manifest must have an id')
    apps.value.set(manifest.id, {
      icon: '💻',
      sandboxed: true,
      size: 'medium',
      singleton: false,
      permissions: [],
      builtin: false,
      ephemeral: false,
      showInLaunchpad: true,
      ...manifest,
    })
  }

  function get(id) { return apps.value.get(id) }
  function has(id) { return apps.value.has(id) }

  function unregister(id) {
    const app = apps.value.get(id)
    if (!app) return false
    if (app.builtin) return false
    apps.value.delete(id)
    return true
  }

  function list(filter) {
    const all = [...apps.value.values()]
    return filter ? all.filter(filter) : all
  }

  function launchpadApps() {
    return list(a => !a.ephemeral && a.showInLaunchpad !== false)
  }

  function resolveSize(app) {
    if (typeof app.size === 'string') return SIZES[app.size] || SIZES.medium
    if (typeof app.size === 'object') return { width: app.size.width || 500, height: app.size.height || 350 }
    return SIZES.medium
  }

  /**
   * Scan a VFS directory for app manifests
   */
  function scanVFS(basePath) {
    const vfs = useVFSStore()
    const dirs = vfs.ls(basePath)
    if (!dirs) return
    for (const entry of dirs) {
      if (entry.type !== 'dir') continue
      const appDir = `${basePath}/${entry.name}`
      const manifestPath = `${appDir}/manifest.json`
      if (vfs.isFile(manifestPath)) {
        try {
          const manifest = JSON.parse(vfs.readFile(manifestPath))
          manifest._appPath = appDir
          const existing = apps.value.get(manifest.id)
          if (existing && existing.builtin) {
            // Merge manifest fields but keep builtin flag
            apps.value.set(manifest.id, { ...manifest, builtin: true, _appPath: appDir })
          } else {
            register({ ...manifest, _appPath: appDir })
          }
        } catch (e) {
          console.warn(`AppRegistry: bad manifest at ${manifestPath}`, e)
        }
      }
    }
  }

  /**
   * Watch VFS for app changes (new installs, updates, removals)
   */
  function watchVFS() {
    const vfs = useVFSStore()
    const appPaths = ['/system/apps', '/home/user/apps', '/tmp/apps']
    vfs.on((event, path) => {
      for (const base of appPaths) {
        if (path.startsWith(base + '/') && path.endsWith('/manifest.json')) {
          if (event === 'rm') {
            const parts = path.split('/')
            const appId = parts[parts.length - 2]
            const app = apps.value.get(appId)
            if (app && !app.builtin) apps.value.delete(appId)
          } else {
            const parts = path.split('/')
            const appDir = parts.slice(0, -1).join('/')
            const appId = parts[parts.length - 2]
            try {
              const manifest = JSON.parse(vfs.readFile(path))
              manifest._appPath = appDir
              register({ id: appId, ...manifest })
            } catch {}
          }
        }
      }
    })
  }

  /**
   * Initialize: scan all app directories and start watching
   */
  function init() {
    scanVFS('/system/apps')
    scanVFS('/home/user/apps')
    scanVFS('/tmp/apps')
    watchVFS()
  }

  return {
    apps, register, get, has, unregister, list,
    launchpadApps, resolveSize, scanVFS, watchVFS, init,
    SIZES
  }
})
