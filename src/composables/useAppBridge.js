/**
 * App Bridge — exposes fluidOS API to sandboxed iframe apps via postMessage.
 * Iframe apps can call: window.parent.postMessage({ type: 'fluidOS', method, params }, '*')
 * Supported methods: setWallpaper, notify, openFile, openApp, readFile, writeFile
 */
import { EventBus } from './useEventBus.js'
import { useVFSStore } from '../stores/vfs.js'

let _initialized = false

export function initAppBridge() {
  if (_initialized) return
  _initialized = true

  window.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'fluidOS') return

    const { method, params, callId } = e.data
    const source = e.source

    function reply(result) {
      if (source && callId) {
        source.postMessage({ type: 'fluidOS.reply', callId, result }, '*')
      }
    }

    const vfs = useVFSStore()

    switch (method) {
      case 'setWallpaper': {
        EventBus.emit('wallpaper.change', params || {})
        reply({ success: true })
        break
      }
      case 'notify': {
        EventBus.emit('notify', { text: params?.message || params?.text || '', type: params?.type || 'info' })
        reply({ success: true })
        break
      }
      case 'openFile': {
        const path = params?.path
        if (!path) { reply({ error: 'path required' }); break }
        if (vfs.isFile(path)) {
          const ext = path.split('.').pop()?.toLowerCase()
          if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
            EventBus.emit('window.open', { type: 'image', data: { path } })
          } else {
            EventBus.emit('window.open', { type: 'editor', data: { path } })
          }
          reply({ success: true })
        } else {
          reply({ error: `File not found: ${path}` })
        }
        break
      }
      case 'openApp': {
        EventBus.emit('app.open', { type: params?.type || params?.id, data: params?.data })
        reply({ success: true })
        break
      }
      case 'readFile': {
        const content = vfs.readFile(params?.path)
        reply(content !== null ? { content } : { error: 'Not found' })
        break
      }
      case 'writeFile': {
        if (!params?.path) { reply({ error: 'path required' }); break }
        vfs.writeFile(params.path, params.content || '')
        reply({ success: true })
        break
      }
      case 'ls': {
        const items = vfs.ls(params?.path || '/')
        reply({ items: items || [] })
        break
      }
      default:
        reply({ error: `Unknown method: ${method}` })
    }
  })
}
