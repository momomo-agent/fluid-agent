/* wm-media.js — Media & external content: Dock, Music, Video, Browser, Map */
;(() => {
  const WM = WindowManager
  const { windows, SIZE } = WM._internal

function updateDock() {
  const container = document.getElementById('dock-running')
  if (!container) return
  container.innerHTML = ''

  // Update running dots on pinned dock items
  const pinnedItems = document.querySelectorAll('.dock-pinned .dock-item')
  const runningTypes = new Set()
  windows.forEach(w => { runningTypes.add(w.type) })
  pinnedItems.forEach(item => {
    const app = item.dataset.app
    item.querySelector('.dock-running-dot')?.remove()
    // Map dock app names to window types
    const typeMap = { finder: 'finder', terminal: 'terminal', browser: 'browser', music: 'music', video: 'video', map: 'map', settings: 'settings' }
    const wType = typeMap[app]
    if (wType && runningTypes.has(wType)) {
      const dot = document.createElement('div')
      dot.className = 'dock-running-dot'
      item.appendChild(dot)
    }
  })

  // Show installed generative apps in dock
  for (const [name, app] of installedApps) {
    const item = document.createElement('div')
    item.className = 'dock-item dock-app'
    item.title = name
    item.textContent = app.icon
    // Check if already open
    let isOpen = false
    windows.forEach(w => { if (w.type === 'app' && w.data?.name === name) isOpen = true })
    if (isOpen) {
      const dot = document.createElement('div')
      dot.className = 'dock-running-dot'
      item.appendChild(dot)
    }
    item.addEventListener('click', () => openApp(name))
    container.appendChild(item)
  }

  // Show other running windows
  windows.forEach((w, id) => {
    if (['finder', 'terminal', 'settings', 'music', 'video', 'browser', 'map', 'app'].includes(w.type) && !w.minimized) return
    const item = document.createElement('div')
    item.className = 'dock-item' + (w.minimized ? ' minimized' : '')
    item.title = w.el.querySelector('.window-title')?.textContent || w.type
    const icons = { editor: '📝', taskmanager: '📋', plan: '📌', image: '🖼️', finder: '📁', terminal: '⬛', settings: '⚙️', music: '🎵', video: '🎬', browser: '🌐' }
    item.textContent = icons[w.type] || '🗔'
    if (!w.minimized) {
      const dot = document.createElement('div')
      dot.className = 'dock-running-dot'
      item.appendChild(dot)
    }
    item.addEventListener('click', () => {
      if (w.minimized) unminimize(id)
      else WM.focus(id)
    })
    container.appendChild(item)
  })

  // Hide separator when dock-running is empty
  const sep = document.querySelector('.dock-separator')
  if (sep) sep.style.display = container.children.length ? '' : 'none'
}

// --- Music Player ---
let musicId = null
const musicState = {
  playlist: [
    { title: 'Midnight Drive', artist: 'Synthwave FM', color: '#60a5fa' },
    { title: 'Neon Lights', artist: 'Retro Wave', color: '#a78bfa' },
    { title: 'Ocean Breeze', artist: 'Lo-Fi Beats', color: '#34d399' },
    { title: 'City Rain', artist: 'Ambient Works', color: '#f472b6' },
    { title: 'Starlight', artist: 'Chillhop', color: '#fbbf24' },
  ],
  current: 0,
  playing: false,
  elapsed: 0,
  timer: null,
}
// Set durations from synth
musicState.playlist.forEach((t, i) => { t.duration = Math.floor(AudioSynth.getDuration(i)) })

function musicPlay(s) {
  clearInterval(s.timer)
  s.playing = true
  const track = s.playlist[s.current]
  EventBus.emit('music.stateChange', { playing: true, current: track, playlistCount: s.playlist.length })
  if (track.url) {
    // External URL track — use Audio element
    if (!s._audio) s._audio = new Audio()
    // Force HTTPS to avoid Mixed Content errors (NetEase CDN supports HTTPS)
    s._audio.src = track.url.replace(/^http:\/\//, 'https://')
    s._audio.currentTime = s.elapsed
    s._audio.play().catch(() => {})
    s._audio.onended = () => {
      s.current = (s.current + 1) % s.playlist.length
      s.elapsed = 0
      musicPlay(s)
      musicRerender()
    }
    s._audio.onloadedmetadata = () => {
      if (!track._durationSet) {
        track.duration = Math.floor(s._audio.duration) || track.duration || 180
        track._durationSet = true
        musicRerender()
      }
    }
    s.timer = setInterval(() => {
      s.elapsed = Math.floor(s._audio.currentTime || s.elapsed)
      musicRerender()
    }, 1000)
  } else {
    // Synth track
    AudioSynth.play(s.current, s.elapsed, () => {
      s.current = (s.current + 1) % s.playlist.length
      s.elapsed = 0
      musicPlay(s)
      musicRerender()
    })
    s.timer = setInterval(() => {
      s.elapsed += 1
      if (s.elapsed >= s.playlist[s.current].duration) {
        s.current = (s.current + 1) % s.playlist.length
        s.elapsed = 0
      }
      musicRerender()
    }, 1000)
  }
}

function musicPause(s) {
  clearInterval(s.timer)
  s.playing = false
  if (s._audio) { s._audio.pause() }
  AudioSynth.stop()
  EventBus.emit('music.stateChange', { playing: false, current: s.playlist[s.current], playlistCount: s.playlist.length })
}

function musicRerender() {
  if (!musicId || !windows.has(musicId)) return
  const w = windows.get(musicId)
  renderMusic(w, w.el.querySelector('.window-body'))
}

function openMusic() {
  if (musicId && windows.has(musicId)) { WM.focus(musicId); return musicId }
  musicId = WM.create({ type: 'music', title: 'Music', ...SIZE.small })
  return musicId
}

function renderMusic(w, body) {
  const s = musicState
  const track = s.playlist[s.current]
  const pct = track.duration > 0 ? (s.elapsed / track.duration * 100) : 0
  const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

  const artHtml = track.artwork
    ? `<img src="${track.artwork}" class="music-art-img" alt="">`
    : `<div class="music-art-icon" style="color: ${track.color || '#60a5fa'}">${s.playing ? '♫' : '♪'}</div>`

  body.innerHTML = `<div class="music-player">
    <div class="music-art" style="background: linear-gradient(135deg, ${track.color || '#60a5fa'}33, ${track.color || '#60a5fa'}11)">
      ${artHtml}
    </div>
    <div class="music-info">
      <div class="music-title">${track.title}</div>
      <div class="music-artist">${track.artist}</div>
    </div>
    <div class="music-progress">
      <div class="music-bar"><div class="music-bar-fill" style="width:${pct}%;background:${track.color}"></div></div>
      <div class="music-times"><span>${fmt(s.elapsed)}</span><span>${fmt(track.duration)}</span></div>
    </div>
    <div class="music-controls">
      <button class="music-btn" id="music-prev">⏮</button>
      <button class="music-btn music-play" id="music-toggle">${s.playing ? '⏸' : '▶'}</button>
      <button class="music-btn" id="music-next">⏭</button>
    </div>
    <div class="music-list">${s.playlist.map((t, i) => `
      <div class="music-track ${i === s.current ? 'active' : ''}" data-idx="${i}">
        ${t.artwork ? `<img src="${t.artwork}" class="music-track-thumb" alt="">` : `<span class="music-track-dot" style="background:${t.color || '#60a5fa'}"></span>`}
        <span class="music-track-title">${t.title}</span>
        <span class="music-track-artist">${t.artist}</span>
        <span class="music-track-dur">${fmt(t.duration)}</span>
      </div>`).join('')}
    </div>
  </div>`

  body.querySelector('#music-toggle').addEventListener('click', () => {
    const wasPlaying = s.playing
    if (wasPlaying) musicPause(s)
    else musicPlay(s)
    EventBus.emit('user.action', { type: wasPlaying ? 'music.pause' : 'music.play', track: s.playlist[s.current]?.title })
    renderMusic(w, body)
  })
  body.querySelector('#music-prev').addEventListener('click', () => {
    musicPause(s)
    s.current = (s.current - 1 + s.playlist.length) % s.playlist.length
    s.elapsed = 0
    EventBus.emit('user.action', { type: 'music.prev', track: s.playlist[s.current]?.title })
    renderMusic(w, body)
  })
  body.querySelector('#music-next').addEventListener('click', () => {
    musicPause(s)
    s.current = (s.current + 1) % s.playlist.length
    s.elapsed = 0
    EventBus.emit('user.action', { type: 'music.next', track: s.playlist[s.current]?.title })
    renderMusic(w, body)
  })
  body.querySelectorAll('.music-track').forEach(el => {
    el.addEventListener('click', () => {
      musicPause(s)
      s.current = parseInt(el.dataset.idx)
      s.elapsed = 0
      musicPlay(s)
      EventBus.emit('user.action', { type: 'music.play', track: s.playlist[s.current]?.title })
      renderMusic(w, body)
    })
  })
}

// Agent music control via EventBus
EventBus.on('music.control', ({ action, track }) => {
  const s = musicState
  if (track != null && track >= 0 && track < s.playlist.length) {
    musicPause(s)
    s.current = track; s.elapsed = 0
  }
  if (action === 'play' || action === 'open') {
    if (!s.playing) musicPlay(s)
  } else if (action === 'pause') {
    musicPause(s)
  } else if (action === 'next') {
    musicPause(s)
    s.current = (s.current + 1) % s.playlist.length; s.elapsed = 0
  } else if (action === 'prev') {
    musicPause(s)
    s.current = (s.current - 1 + s.playlist.length) % s.playlist.length; s.elapsed = 0
  }
  musicRerender()
})

// --- Video Player ---
function openVideo(url, title) {
  const id = WM.create({ type: 'video', title: title || 'Video Player', ...SIZE.large, data: { url: url || '' } })
  return id
}

function renderVideo(w, body) {
  const url = w.data?.url || ''
  if (url) {
    // Detect YouTube and embed
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]+)/)
    if (ytMatch) {
      body.innerHTML = `<div class="video-player"><iframe src="https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen style="width:100%;height:100%;border:none"></iframe></div>`
    } else {
      body.innerHTML = `<div class="video-player"><video src="${url}" controls autoplay style="width:100%;height:100%;object-fit:contain"></video></div>`
    }
  } else {
    // Empty state with URL input
    body.innerHTML = `<div class="video-empty">
      <div class="video-empty-icon">🎬</div>
      <div class="video-empty-text">Drop a video URL to play</div>
      <div class="video-url-bar">
        <input class="video-url-input" placeholder="Paste video URL..." />
        <button class="video-url-go">▶</button>
      </div>
      <div class="video-samples">
        <div class="video-sample" data-url="https://www.youtube.com/embed/dQw4w9WgXcQ">Sample: Rick Astley</div>
        <div class="video-sample" data-url="https://www.youtube.com/embed/jNQXAC9IVRw">Sample: First YouTube Video</div>
      </div>
    </div>`
    const input = body.querySelector('.video-url-input')
    const go = () => {
      const v = input.value.trim()
      if (v) { w.data = { ...w.data, url: v }; renderVideo(w, body) }
    }
    body.querySelector('.video-url-go').addEventListener('click', go)
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go() })
    body.querySelectorAll('.video-sample').forEach(el => {
      el.addEventListener('click', () => { w.data = { ...w.data, url: el.dataset.url }; renderVideo(w, body) })
    })
  }
}

// --- Browser ---
function openBrowser(url) {
  const id = WM.create({ type: 'browser', title: 'Browser', width: 900, height: 580, data: { url: url || '' } })
  return id
}

function renderBrowser(w, body) {
  const url = w.data?.url || ''
  const displayUrl = w.data?.displayUrl || url || 'about:blank'
  const fetchedContent = w.data?.fetchedContent || ''
  const isLoading = w.data?.isLoading || false

  body.innerHTML = `<div class="browser-window">
    <div class="browser-toolbar">
      <button class="browser-nav-btn" id="browser-back">◀</button>
      <button class="browser-nav-btn" id="browser-fwd">▶</button>
      <button class="browser-nav-btn" id="browser-reload">↻</button>
      <div class="browser-url-bar">
        <input class="browser-url-input" value="${displayUrl}" />
      </div>
    </div>
    <div class="browser-content">${url
      ? (isLoading
        ? '<div style="padding:40px;text-align:center;color:var(--text-muted)">Loading...</div>'
        : (fetchedContent
          ? `<div class="browser-fetched" style="padding:16px;overflow:auto;height:100%;font-size:13px;line-height:1.6;color:var(--text-primary)">${fetchedContent}</div>`
          : '<div style="padding:40px;text-align:center;color:var(--text-muted)">Failed to load</div>'))
      : `<div class="browser-home">
          <div class="browser-home-logo">🌐</div>
          <div class="browser-home-title">FluidOS Browser</div>
          <div class="browser-bookmarks">
            <div class="browser-bookmark" data-url="https://en.wikipedia.org">Wikipedia</div>
            <div class="browser-bookmark" data-url="https://news.ycombinator.com">Hacker News</div>
            <div class="browser-bookmark" data-url="https://github.com">GitHub</div>
            <div class="browser-bookmark" data-url="https://developer.mozilla.org">MDN</div>
          </div>
        </div>`
    }</div>
  </div>`

  const urlInput = body.querySelector('.browser-url-input')
  const navigate = async (newUrl) => {
    let u = newUrl.trim()
    if (u && !u.match(/^https?:\/\//)) u = 'https://' + u
    w.data = { ...w.data, url: u, displayUrl: u, fetchedContent: '', isLoading: true }
    w.el.querySelector('.window-title').textContent = u ? new URL(u).hostname : 'Browser'
    renderBrowser(w, body)
    // Fetch content via proxy
    try {
      const res = await fetch(`https://proxy.link2web.site?url=${encodeURIComponent(u)}&mode=llm`, { headers: { 'Accept': 'text/plain' } })
      const text = await res.text()
      // Convert markdown-ish content to simple HTML
      const html = text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#60a5fa">$1</a>')
        .replace(/\n/g, '<br>')
      w.data = { ...w.data, fetchedContent: html, isLoading: false }
      renderBrowser(w, body)
    } catch (e) {
      w.data = { ...w.data, fetchedContent: `<div style="color:#f87171">Error: ${e.message}</div>`, isLoading: false }
      renderBrowser(w, body)
    }
  }
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') navigate(urlInput.value) })
  body.querySelector('#browser-reload')?.addEventListener('click', () => {
    if (w.data?.url) navigate(w.data.url)
  })
  body.querySelector('#browser-back')?.addEventListener('click', () => {
    w.data = { ...w.data, url: '', fetchedContent: '', isLoading: false }; renderBrowser(w, body)
  })
  body.querySelectorAll('.browser-bookmark').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.url))
  })
}

// ── Map ──
let mapId = null

function openMap(lat, lng, zoom) {
  if (mapId && windows.has(mapId)) { WM.focus(mapId); return mapId }
  mapId = WM.create({ type: 'map', title: 'Map', ...SIZE.large, data: { lat: lat || 39.9042, lng: lng || 116.4074, zoom: zoom || 12, markers: [], route: null } })
  updateDock()
  return mapId
}

// External API for agent to control map
function mapAddMarker(lat, lng, label, color) {
  const w = mapId && windows.get(mapId)
  if (!w) return false
  if (!w.data.markers) w.data.markers = []
  w.data.markers.push({ lat, lng, label: label || '', color: color || 'blue' })
  const iframe = w.el.querySelector('.window-body iframe')
  if (iframe?.contentWindow?.addMarker) iframe.contentWindow.addMarker(lat, lng, label, color)
  return true
}

function mapClearMarkers() {
  const w = mapId && windows.get(mapId)
  if (!w) return false
  w.data.markers = []
  const iframe = w.el.querySelector('.window-body iframe')
  if (iframe?.contentWindow?.clearMarkers) iframe.contentWindow.clearMarkers()
  return true
}

function mapShowRoute(from, to) {
  const w = mapId && windows.get(mapId)
  if (!w) return false
  w.data.route = { from, to }
  const iframe = w.el.querySelector('.window-body iframe')
  if (iframe?.contentWindow?.showRoute) iframe.contentWindow.showRoute(from, to)
  return true
}

function mapClearRoute() {
  const w = mapId && windows.get(mapId)
  if (!w) return false
  w.data.route = null
  const iframe = w.el.querySelector('.window-body iframe')
  if (iframe?.contentWindow?.clearRoute) iframe.contentWindow.clearRoute()
  return true
}

function renderMap(w, body) {
  const { lat, lng, zoom, markers, route } = w.data || { lat: 39.9042, lng: 116.4074, zoom: 12, markers: [], route: null }
  const markersJson = JSON.stringify(markers || [])
  const routeJson = JSON.stringify(route || null)
  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #map { width: 100%; height: 100%; }
.search-bar { position: absolute; top: 10px; left: 50px; right: 10px; z-index: 1000; display: flex; gap: 6px; }
.search-bar input { flex: 1; padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(22,27,38,0.9); color: #e2e8f0; font-size: 13px; backdrop-filter: blur(8px); outline: none; }
.search-bar input:focus { border-color: #60a5fa; }
.search-bar button { padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(22,27,38,0.9); color: #94a3b8; font-size: 13px; cursor: pointer; backdrop-filter: blur(8px); }
.search-bar button:hover { background: rgba(40,50,70,0.9); color: #e2e8f0; }
.coords { position: absolute; bottom: 8px; left: 8px; z-index: 1000; background: rgba(22,27,38,0.85); color: #94a3b8; padding: 4px 8px; border-radius: 6px; font-size: 11px; backdrop-filter: blur(8px); }
.marker-count { position: absolute; bottom: 8px; right: 8px; z-index: 1000; background: rgba(22,27,38,0.85); color: #94a3b8; padding: 4px 8px; border-radius: 6px; font-size: 11px; backdrop-filter: blur(8px); }
</style></head><body>
<div class="search-bar">
<input id="search" placeholder="Search location..." />
<button id="btn-pin" title="Drop pin at center">📍</button>
<button id="btn-clear" title="Clear all markers">🗑</button>
</div>
<div id="map"></div>
<div class="coords" id="coords">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
<div class="marker-count" id="marker-count"></div>
<script>
var map = L.map('map', { zoomControl: false }).setView([${lat}, ${lng}], ${zoom});
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
attribution: '\u00a9 OpenStreetMap', maxZoom: 19
}).addTo(map);

var markers = [];
var routeLine = null;
var markerColors = {
red: '#ef4444', blue: '#3b82f6', green: '#22c55e', orange: '#f97316',
purple: '#a855f7', pink: '#ec4899', yellow: '#eab308'
};

function makeIcon(color) {
var c = markerColors[color] || markerColors.blue;
return L.divIcon({
  className: '',
  html: '<div style="width:24px;height:24px;border-radius:50% 50% 50% 0;background:'+c+';transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>',
  iconSize: [24, 24], iconAnchor: [12, 24], popupAnchor: [0, -24]
});
}

function addMarker(lat, lng, label, color) {
var m = L.marker([lat, lng], { icon: makeIcon(color || 'blue') }).addTo(map);
if (label) m.bindPopup(label);
markers.push(m);
updateCount();
return m;
}

function clearMarkers() {
markers.forEach(function(m) { map.removeLayer(m); });
markers = [];
updateCount();
}

function updateCount() {
var el = document.getElementById('marker-count');
el.textContent = markers.length > 0 ? markers.length + ' pin' + (markers.length > 1 ? 's' : '') : '';
}

function showRoute(from, to) {
clearRoute();
// Use OSRM for routing
var url = 'https://router.project-osrm.org/route/v1/driving/' +
  from.lng + ',' + from.lat + ';' + to.lng + ',' + to.lat +
  '?overview=full&geometries=geojson';
fetch(url).then(function(r) { return r.json(); }).then(function(data) {
  if (data.routes && data.routes.length > 0) {
    var coords = data.routes[0].geometry.coordinates.map(function(c) { return [c[1], c[0]]; });
    routeLine = L.polyline(coords, { color: '#3b82f6', weight: 4, opacity: 0.8 }).addTo(map);
    map.fitBounds(routeLine.getBounds(), { padding: [40, 40] });
    // Show distance and duration
    var dist = data.routes[0].distance;
    var dur = data.routes[0].duration;
    var distStr = dist > 1000 ? (dist/1000).toFixed(1) + ' km' : Math.round(dist) + ' m';
    var durStr = dur > 3600 ? Math.floor(dur/3600) + 'h ' + Math.round((dur%3600)/60) + 'min' : Math.round(dur/60) + ' min';
    routeLine.bindPopup(distStr + ' \u00b7 ' + durStr).openPopup();
  }
}).catch(function() {});
}

function clearRoute() {
if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
}

// Load initial markers
var initMarkers = ${markersJson};
initMarkers.forEach(function(m) { addMarker(m.lat, m.lng, m.label, m.color); });

// Load initial route
var initRoute = ${routeJson};
if (initRoute) showRoute(initRoute.from, initRoute.to);

// Click to add marker
map.on('click', function(e) {
addMarker(e.latlng.lat, e.latlng.lng, '', 'blue');
});

map.on('mousemove', function(e) {
document.getElementById('coords').textContent = e.latlng.lat.toFixed(4) + ', ' + e.latlng.lng.toFixed(4);
});

// Pin button: drop at center
document.getElementById('btn-pin').addEventListener('click', function() {
var c = map.getCenter();
addMarker(c.lat, c.lng, 'Pin', 'red');
});

// Clear button
document.getElementById('btn-clear').addEventListener('click', function() {
clearMarkers();
clearRoute();
});

// Search
document.getElementById('search').addEventListener('keydown', function(e) {
if (e.key !== 'Enter') return;
var q = this.value.trim();
if (!q) return;
fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(q))
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data && data.length > 0) {
      var lat = parseFloat(data[0].lat), lon = parseFloat(data[0].lon);
      map.setView([lat, lon], 14);
      addMarker(lat, lon, data[0].display_name, 'red');
    }
  });
});
<\/script></body></html>`
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'width:100%;height:100%;border:none'
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')
  iframe.srcdoc = doc
  body.innerHTML = ''
  body.appendChild(iframe)
}

// Agent browser control via EventBus
EventBus.on('browser.control', ({ action, url }) => {
  let bw = null
  for (const [, w] of windows) { if (w.type === 'browser') { bw = w; break } }
  if (!bw) {
    openBrowser(action === 'navigate' ? url : '')
    return
  }
  if (action === 'navigate' && url) {
    let u = url.trim()
    if (!u.match(/^https?:\/\//)) u = 'https://' + u
    bw.data = { ...bw.data, url: u }
    bw.el.querySelector('.window-title').textContent = new URL(u).hostname
    renderBrowser(bw, bw.el.querySelector('.window-body'))
  } else if (action === 'back') {
    bw.data = { ...bw.data, url: '' }
    bw.el.querySelector('.window-title').textContent = 'Browser'
    renderBrowser(bw, bw.el.querySelector('.window-body'))
  }
})

// Agent video control via EventBus
EventBus.on('video.control', ({ action }) => {
  for (const [, w] of windows) {
    if (w.type !== 'video') continue
    const video = w.el.querySelector('video')
    if (!video) continue
    if (action === 'play') video.play()
    else if (action === 'pause') video.pause()
    else if (action === 'fullscreen') video.requestFullscreen?.().catch(() => {})
  }
})


  // --- Register renderers ---
  WM._registerRenderer('music', renderMusic)
  WM._registerRenderer('video', renderVideo)
  WM._registerRenderer('browser', renderBrowser)
  WM._registerRenderer('map', renderMap)

  // --- Register AppRegistry ---
  if (typeof AppRegistry !== 'undefined') {
    AppRegistry.register({ id: 'music', name: 'Music', icon: '🎵', sandboxed: false, size: 'small', singleton: true, builtin: true, render: renderMusic })
    AppRegistry.register({ id: 'video', name: 'Video', icon: '🎬', sandboxed: false, size: 'large', builtin: true, render: renderVideo })
    AppRegistry.register({ id: 'browser', name: 'Browser', icon: '🌐', sandboxed: false, size: 'large', builtin: true, render: renderBrowser })
    AppRegistry.register({ id: 'map', name: 'Map', icon: '🗺️', sandboxed: false, size: 'large', singleton: true, builtin: true, render: renderMap })
  }

  // --- Expose to WindowManager ---
  // Override updateDock from core
  WM.updateDock = updateDock
  WM._internal.updateDock = updateDock
  WM._internal.musicState = musicState
  WM._internal.musicRerender = musicRerender
  WM._internal.onWindowClose = (id) => {
    if (id === musicId) { musicPause(musicState); musicId = null }
    if (id === mapId) { mapId = null }
  }
  WM.openMusic = openMusic
  WM.openVideo = openVideo
  WM.openBrowser = openBrowser
  WM.openMap = openMap
  WM.mapAddMarker = mapAddMarker
  WM.mapClearMarkers = mapClearMarkers
  WM.mapShowRoute = mapShowRoute
  WM.mapClearRoute = mapClearRoute
})()
