/* wm-layout.js — Window layout operations + music track management */
;(() => {
  const WM = WindowManager
  const { windows, getAreaSize, applyPx, readNorm } = WM._internal

function findByTitle(title) {
  const t = title.toLowerCase()
  for (const [id, w] of windows) {
    const wTitle = w.el.querySelector('.window-title')?.textContent?.toLowerCase() || ''
    const wType = (w.type || '').toLowerCase()
    if (wTitle.includes(t) || wType.includes(t)) return id
  }
  return null
}

function moveWindow(title, x, y) {
  const id = findByTitle(title)
  if (!id) return false
  const w = windows.get(id)
  if (!w) return false
  // Accept normalized (0-1) or px (>1)
  const { w: aW, h: aH } = getAreaSize()
  const px_x = x <= 1 ? x * aW : x
  const px_y = y <= 1 ? y * aH : y
  w.el.style.left = px_x + 'px'
  w.el.style.top = px_y + 'px'
  w._norm = readNorm(w.el)
  return true
}

function resizeWindow(title, width, height) {
  const id = findByTitle(title)
  if (!id) return false
  const w = windows.get(id)
  if (!w) return false
  const { w: aW, h: aH } = getAreaSize()
  if (width) w.el.style.width = (width <= 1 ? width * aW : width) + 'px'
  if (height) w.el.style.height = (height <= 1 ? height * aH : height) + 'px'
  w._norm = readNorm(w.el)
  return true
}

function minimizeByTitle(title) {
  const id = findByTitle(title)
  if (!id) return false
  minimize(id)
  return true
}

function maximizeByTitle(title) {
  const id = findByTitle(title)
  if (!id) return false
  toggleFullscreen(id)
  return true
}

function unminimizeByTitle(title) {
  const id = findByTitle(title)
  if (!id) return false
  unminimize(id)
  return true
}

function tileWindows(layout) {
  const ids = [...windows.keys()].filter(id => {
    const w = windows.get(id)
    return w && !w.el.classList.contains('minimized')
  })
  if (ids.length === 0) return false
  const n = ids.length
  // Auto-select layout: grid for 3+, horizontal for 2, single for 1
  if (!layout) layout = n >= 3 ? 'grid' : n === 2 ? 'horizontal' : 'horizontal'
  const gap = 8 // px gap between windows
  const { w: areaW, h: areaH } = getAreaSize()
  const gapNormX = gap / areaW
  const gapNormY = gap / areaH
  if (layout === 'horizontal') {
    ids.forEach((id, i) => {
      const win = windows.get(id)
      const norm = { x: i / n + gapNormX / 2, y: gapNormY / 2, width: 1 / n - gapNormX, height: 1 - gapNormY }
      win._norm = norm
      applyPx(win.el, norm)
    })
  } else if (layout === 'grid') {
    const cols = Math.ceil(Math.sqrt(n))
    const rows = Math.ceil(n / cols)
    ids.forEach((id, i) => {
      const win = windows.get(id)
      const col = i % cols
      const row = Math.floor(i / cols)
      const norm = { x: col / cols + gapNormX / 2, y: row / rows + gapNormY / 2, width: 1 / cols - gapNormX, height: 1 / rows - gapNormY }
      win._norm = norm
      applyPx(win.el, norm)
    })
  } else {
    // vertical
    ids.forEach((id, i) => {
      const win = windows.get(id)
      const norm = { x: gapNormX / 2, y: i / n + gapNormY / 2, width: 1 - gapNormX, height: 1 / n - gapNormY }
      win._norm = norm
      applyPx(win.el, norm)
    })
  }
  return true
}

// --- Music: add track dynamically ---
const SYNTH_STYLES = {
  dreamy:   { wave: 'sine',     filterFreq: 800,  attack: 0.05, release: 0.3,  tempo: 110, colors: ['#60a5fa','#818cf8','#a78bfa'] },
  bright:   { wave: 'square',   filterFreq: 1200, attack: 0.01, release: 0.15, tempo: 135, colors: ['#fbbf24','#f59e0b','#fb923c'] },
  gentle:   { wave: 'triangle', filterFreq: 600,  attack: 0.1,  release: 0.5,  tempo: 85,  colors: ['#34d399','#6ee7b7','#a7f3d0'] },
  moody:    { wave: 'sawtooth', filterFreq: 900,  attack: 0.02, release: 0.25, tempo: 95,  colors: ['#f472b6','#e879f9','#c084fc'] },
  playful:  { wave: 'triangle', filterFreq: 1500, attack: 0.01, release: 0.2,  tempo: 130, colors: ['#38bdf8','#22d3ee','#2dd4bf'] },
}
const SCALE_NOTES = ['C4','D4','E4','F4','G4','A4','B4','C5','D5','E5']
const BASS_NOTES = ['C3','D3','E3','F3','G3','A3']

function generateMelody(len) {
  const m = []; for (let i = 0; i < len; i++) m.push(SCALE_NOTES[Math.floor(Math.random() * SCALE_NOTES.length)])
  return m
}
function generateBass(len) {
  const b = []; for (let i = 0; i < len; i++) b.push(BASS_NOTES[Math.floor(Math.random() * BASS_NOTES.length)])
  return b
}

function musicAddTrack({ title, artist, style, url, artwork }) {
  if (!title) return { error: 'title is required' }
  if (url) {
    // External URL track
    const entry = { title: title || 'Untitled', artist: artist || 'Unknown', color: '#60a5fa', duration: 180, url, artwork }
    WM._internal.musicState.playlist.push(entry)
    const idx = WM._internal.musicState.playlist.length - 1
    WM._internal.musicRerender()
    return { index: idx }
  }
  // Synth track (existing behavior)
  const s = SYNTH_STYLES[style] || SYNTH_STYLES.dreamy
  const trackDef = {
    melody: generateMelody(16),
    bass: generateBass(8),
    tempo: s.tempo + Math.floor(Math.random() * 20 - 10),
    wave: s.wave, filterFreq: s.filterFreq, attack: s.attack, release: s.release,
  }
  const synthIdx = AudioSynth.addTrack(trackDef)
  const color = s.colors[Math.floor(Math.random() * s.colors.length)]
  const entry = { title: title || 'Untitled', artist: artist || 'FluidOS', color, duration: Math.floor(AudioSynth.getDuration(synthIdx)) }
  WM._internal.musicState.playlist.push(entry)
  const idx = WM._internal.musicState.playlist.length - 1
  WM._internal.musicRerender()
  return { index: idx }
}

  // --- Expose to WindowManager ---
  WM.moveWindow = moveWindow
  WM.resizeWindow = resizeWindow
  WM.minimizeByTitle = minimizeByTitle
  WM.maximizeByTitle = maximizeByTitle
  WM.unminimizeByTitle = unminimizeByTitle
  WM.tileWindows = tileWindows
  WM.musicAddTrack = musicAddTrack
  WM.getFocused = () => { for (const [id, w] of windows) { if (w.el.classList.contains('focused')) return id } return null }
})()
