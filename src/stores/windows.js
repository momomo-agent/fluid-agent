import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

let _nextId = 1
let _topZ = 100
const SESSION_KEY = 'fluid-session'

export const useWindowsStore = defineStore('windows', () => {
  const windows = ref(new Map())
  const focusedId = ref(null)

  const windowList = computed(() => [...windows.value.values()])
  const focusedWindow = computed(() => focusedId.value ? windows.value.get(focusedId.value) : null)

  function create(opts) {
    const id = `win-${_nextId++}`
    const { type, title, width = 600, height = 400, x, y, data = {}, component } = opts

    // Find position if not specified — smart positioning to avoid overlap
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
    _saveSession()
    return id
  }

  function close(id) {
    windows.value.delete(id)
    if (focusedId.value === id) {
      const sorted = [...windows.value.values()].sort((a, b) => b.zIndex - a.zIndex)
      focusedId.value = sorted[0]?.id || null
    }
    _saveSession()
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
      win.x = win._restoreX ?? win.x
      win.y = win._restoreY ?? win.y
      win.width = win._restoreW ?? win.width
      win.height = win._restoreH ?? win.height
      win.maximized = false
    } else {
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

  // ── Tile layout ──
  function tileWindows(layout) {
    const visible = [...windows.value.values()].filter(w => !w.minimized)
    if (visible.length === 0) return false
    const n = visible.length
    if (!layout) layout = n >= 3 ? 'grid' : n === 2 ? 'horizontal' : 'horizontal'

    const { w: areaW, h: areaH } = _getArea()
    const gap = 8

    if (layout === 'horizontal') {
      visible.forEach((win, i) => {
        win.x = Math.round(i * (areaW / n) + gap / 2)
        win.y = gap / 2
        win.width = Math.round(areaW / n - gap)
        win.height = areaH - gap
        _updateNorm(win)
      })
    } else if (layout === 'grid') {
      const cols = Math.ceil(Math.sqrt(n))
      const rows = Math.ceil(n / cols)
      visible.forEach((win, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        win.x = Math.round(col * (areaW / cols) + gap / 2)
        win.y = Math.round(row * (areaH / rows) + gap / 2)
        win.width = Math.round(areaW / cols - gap)
        win.height = Math.round(areaH / rows - gap)
        _updateNorm(win)
      })
    } else {
      // vertical
      visible.forEach((win, i) => {
        win.x = gap / 2
        win.y = Math.round(i * (areaH / n) + gap / 2)
        win.width = areaW - gap
        win.height = Math.round(areaH / n - gap)
        _updateNorm(win)
      })
    }
    _saveSession()
    return true
  }

  // ── Snap zones ──
  function snapWindow(id, zone) {
    const win = windows.value.get(id)
    if (!win) return
    const { w: areaW, h: areaH } = _getArea()
    switch (zone) {
      case 'left':
        win.x = 0; win.y = 0; win.width = Math.round(areaW / 2); win.height = areaH; break
      case 'right':
        win.x = Math.round(areaW / 2); win.y = 0; win.width = Math.round(areaW / 2); win.height = areaH; break
      case 'top':
        win.x = 0; win.y = 0; win.width = areaW; win.height = Math.round(areaH / 2); break
      case 'bottom':
        win.x = 0; win.y = Math.round(areaH / 2); win.width = areaW; win.height = Math.round(areaH / 2); break
      case 'top-left':
        win.x = 0; win.y = 0; win.width = Math.round(areaW / 2); win.height = Math.round(areaH / 2); break
      case 'top-right':
        win.x = Math.round(areaW / 2); win.y = 0; win.width = Math.round(areaW / 2); win.height = Math.round(areaH / 2); break
      case 'bottom-left':
        win.x = 0; win.y = Math.round(areaH / 2); win.width = Math.round(areaW / 2); win.height = Math.round(areaH / 2); break
      case 'bottom-right':
        win.x = Math.round(areaW / 2); win.y = Math.round(areaH / 2); win.width = Math.round(areaW / 2); win.height = Math.round(areaH / 2); break
    }
    _updateNorm(win)
  }

  // ── Session persistence ──
  function _saveSession() {
    try {
      const data = [...windows.value.values()].map(w => ({
        type: w.type, title: w.title,
        x: w.x, y: w.y, width: w.width, height: w.height,
        minimized: w.minimized, maximized: w.maximized,
        data: w.data
      }))
      localStorage.setItem(SESSION_KEY, JSON.stringify(data))
    } catch {}
  }

  function restoreSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (!raw) return false
      const data = JSON.parse(raw)
      if (!Array.isArray(data) || data.length === 0) return false
      for (const w of data) {
        create({
          type: w.type, title: w.title,
          x: w.x, y: w.y, width: w.width, height: w.height,
          data: w.data || {}
        })
        // Restore minimized state
        if (w.minimized) {
          const last = [...windows.value.values()].pop()
          if (last) last.minimized = true
        }
      }
      return true
    } catch { return false }
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY)
  }

  // ── Internal helpers ──
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

  // Smart positioning: random sampling to minimize overlap (from legacy)
  function _findPosition(ww, wh) {
    const { w, h } = _getArea()
    const existing = [...windows.value.values()]

    if (existing.length === 0) {
      return { x: Math.max(20, (w - ww) / 2), y: Math.max(20, (h - wh) / 3) }
    }

    let bestX = 40, bestY = 40, minOverlap = Infinity
    for (let attempt = 0; attempt < 20; attempt++) {
      const cx = 30 + Math.random() * Math.max(0, w - ww - 60)
      const cy = 30 + Math.random() * Math.max(0, h - wh - 60)
      let overlap = 0
      for (const e of existing) {
        const ox = Math.max(0, Math.min(cx + ww, e.x + e.width) - Math.max(cx, e.x))
        const oy = Math.max(0, Math.min(cy + wh, e.y + e.height) - Math.max(cy, e.y))
        overlap += ox * oy
      }
      if (overlap < minOverlap) { minOverlap = overlap; bestX = cx; bestY = cy }
      if (overlap === 0) break
    }
    return { x: bestX, y: bestY }
  }

  return {
    windows, focusedId, windowList, focusedWindow,
    create, close, focus, minimize, toggleMaximize,
    move, resize, findByType, closeByTitle,
    tileWindows, snapWindow,
    restoreSession, clearSession
  }
})
