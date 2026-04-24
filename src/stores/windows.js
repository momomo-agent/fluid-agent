import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

let _nextId = 1
let _topZ = 100

export const useWindowsStore = defineStore('windows', () => {
  const windows = ref(new Map())
  const focusedId = ref(null)

  const windowList = computed(() => [...windows.value.values()])
  const focusedWindow = computed(() => focusedId.value ? windows.value.get(focusedId.value) : null)

  function create(opts) {
    const id = `win-${_nextId++}`
    const { type, title, width = 600, height = 400, x, y, data = {}, component } = opts

    // Find position if not specified
    const pos = (x != null && y != null) ? { x, y } : _findPosition(width, height)

    const win = {
      id, type, title: title || type,
      x: pos.x, y: pos.y, width, height,
      zIndex: ++_topZ,
      minimized: false, maximized: false,
      data, component,
      // Normalized coords (0-1)
      nx: 0, ny: 0, nw: 0, nh: 0
    }
    _updateNorm(win)
    windows.value.set(id, win)
    focusedId.value = id
    return id
  }

  function close(id) {
    windows.value.delete(id)
    if (focusedId.value === id) {
      // Focus the topmost remaining window
      const sorted = [...windows.value.values()].sort((a, b) => b.zIndex - a.zIndex)
      focusedId.value = sorted[0]?.id || null
    }
  }

  function focus(id) {
    const win = windows.value.get(id)
    if (!win) return
    win.zIndex = ++_topZ
    if (win.minimized) win.minimized = false
    focusedId.value = id
  }

  function minimize(id) {
    const win = windows.value.get(id)
    if (!win) return
    win.minimized = true
    if (focusedId.value === id) {
      const sorted = [...windows.value.values()]
        .filter(w => !w.minimized && w.id !== id)
        .sort((a, b) => b.zIndex - a.zIndex)
      focusedId.value = sorted[0]?.id || null
    }
  }

  function toggleMaximize(id) {
    const win = windows.value.get(id)
    if (!win) return
    if (win.maximized) {
      // Restore
      win.x = win._restoreX ?? win.x
      win.y = win._restoreY ?? win.y
      win.width = win._restoreW ?? win.width
      win.height = win._restoreH ?? win.height
      win.maximized = false
    } else {
      // Save and maximize
      win._restoreX = win.x
      win._restoreY = win.y
      win._restoreW = win.width
      win._restoreH = win.height
      win.x = 0
      win.y = 0
      const area = _getArea()
      win.width = area.w
      win.height = area.h
      win.maximized = true
    }
    _updateNorm(win)
  }

  function move(id, x, y) {
    const win = windows.value.get(id)
    if (!win) return
    win.x = x
    win.y = y
    _updateNorm(win)
  }

  function resize(id, width, height) {
    const win = windows.value.get(id)
    if (!win) return
    win.width = Math.max(200, width)
    win.height = Math.max(150, height)
    _updateNorm(win)
  }

  function findByType(type) {
    return [...windows.value.values()].find(w => w.type === type)
  }

  function closeByTitle(title) {
    for (const [id, w] of windows.value) {
      if (w.title === title) { close(id); return true }
    }
    return false
  }

  // --- Internal helpers ---
  function _getArea() {
    const el = document.getElementById('desktop-area')
    return { w: el?.clientWidth || 800, h: el?.clientHeight || 600 }
  }

  function _updateNorm(win) {
    const { w, h } = _getArea()
    win.nx = win.x / w
    win.ny = win.y / h
    win.nw = win.width / w
    win.nh = win.height / h
  }

  function _findPosition(ww, wh) {
    const { w, h } = _getArea()
    const existing = [...windows.value.values()]
    // Cascade from top-left
    let x = 40 + (existing.length % 8) * 30
    let y = 40 + (existing.length % 8) * 30
    // Clamp
    x = Math.min(x, w - ww - 20)
    y = Math.min(y, h - wh - 20)
    return { x: Math.max(0, x), y: Math.max(0, y) }
  }

  return {
    windows, focusedId, windowList, focusedWindow,
    create, close, focus, minimize, toggleMaximize,
    move, resize, findByType, closeByTitle
  }
})
