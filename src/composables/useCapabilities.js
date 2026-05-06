import { useCapabilitiesStore } from '../stores/capabilities.js'
import { EventBus } from './useEventBus.js'

export function registerCapabilities() {
  const caps = useCapabilitiesStore()

  // ── Core: always available ──

  caps.register('fs', {
    description: 'File system operations: write, read, list, mkdir, rm, cp, mv, grep, find, exists, stat',
    icon: '📁', category: 'Core', alwaysAvailable: true,
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['write', 'read', 'list', 'mkdir', 'rm', 'cp', 'mv', 'grep', 'find', 'exists', 'stat'] }, path: { type: 'string' }, content: { type: 'string' }, dest: { type: 'string' }, pattern: { type: 'string' }, recursive: { type: 'boolean' } }, required: ['action', 'path'] },
    handler: ({ action, path, content, dest, pattern, recursive }, ctx) => {
      const { VFS, showActivity } = ctx
      switch (action) {
        case 'write': VFS.mkdir(path.split('/').slice(0, -1).join('/')); VFS.writeFile(path, content || ''); showActivity(`Created ${path.split('/').pop()}`); return { success: true }
        case 'read': { const c = VFS.readFile(path); return c !== null ? { content: c } : { error: `Not found: ${path}` } }
        case 'list': { const items = VFS.ls(path); return items ? { items } : { error: `Not found: ${path}` } }
        case 'mkdir': VFS.mkdir(path); showActivity(`Created dir ${path}`); return { success: true }
        case 'rm': { const ok = VFS.rm(path, recursive); return ok ? { success: true } : { error: `Failed to remove: ${path}` } }
        case 'cp': { if (!dest) return { error: 'dest required' }; const ok = VFS.cp(path, dest); return ok ? { success: true } : { error: `Copy failed` } }
        case 'mv': { if (!dest) return { error: 'dest required' }; const ok = VFS.mv(path, dest); return ok ? { success: true } : { error: `Move failed` } }
        case 'grep': { if (!pattern) return { error: 'pattern required' }; const results = VFS.grep(path, pattern); return { results } }
        case 'find': { const results = VFS.find(path, pattern || ''); return { results } }
        case 'exists': { return { exists: VFS.exists(path), isFile: VFS.isFile(path), isDir: VFS.isDir(path) } }
        case 'stat': {
          if (VFS.isFile(path)) {
            const content = VFS.readFile(path)
            return { type: 'file', size: content ? content.length : 0, path }
          } else if (VFS.isDir(path)) {
            const items = VFS.ls(path) || []
            return { type: 'dir', entries: items.length, path }
          }
          return { error: `Not found: ${path}` }
        }
        default: return { error: `Unknown fs action: ${action}` }
      }
    }
  })

  caps.register('run_command', {
    description: 'Run a shell command and return output',
    icon: '⬛', category: 'Core', alwaysAvailable: true,
    schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    handler: async ({ command }, ctx) => {
      ctx.showActivity(`$ ${command}`)
      return { output: await ctx.Shell.execAsync(command) || '(no output)' }
    }
  })

  caps.register('update_progress', {
    description: 'Mark a step as done by index (0-based)',
    icon: '✅', category: 'Core', alwaysAvailable: true,
    schema: { type: 'object', properties: { step_index: { type: 'number' } }, required: ['step_index'] },
    handler: ({ step_index }, ctx) => {
      if (ctx.steps[step_index]) { ctx.steps[step_index].status = 'done'; EventBus.emit('task.update', ctx.task) }
      ctx.showActivity(`✅ Step ${step_index + 1} done`)
      return { success: true }
    }
  })

  caps.register('plan_steps', {
    description: 'Set your execution plan',
    icon: '📋', category: 'Core', alwaysAvailable: true,
    schema: { type: 'object', properties: { planned: { type: 'array', items: { type: 'string' } } }, required: ['planned'] },
    handler: ({ planned }, ctx) => {
      if (!Array.isArray(planned) || !planned.length) return { error: 'planned must be non-empty array' }
      ctx.steps.length = 0
      planned.forEach(s => ctx.steps.push({ text: s, status: 'pending' }))
      ctx.task.steps = ctx.steps
      EventBus.emit('task.update', ctx.task)
      return { success: true, steps: planned }
    }
  })

  caps.register('done', {
    description: 'Signal task completion with summary',
    icon: '🏁', category: 'Core', alwaysAvailable: true,
    schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
    handler: ({ summary }, ctx) => {
      ctx.task.status = 'done'
      ctx.blackboard.currentTask.status = 'done'
      ctx.steps.forEach(s => { if (s.status !== 'done' && s.status !== 'error') s.status = 'done' })
      EventBus.emit('task.update', ctx.task)
      return { done: true, summary }
    }
  })

  caps.register('search_tools', {
    description: 'Load tools by name. Call with exact names you need.',
    icon: '🔍', category: 'Core', alwaysAvailable: true,
    schema: { type: 'object', properties: { query: { type: 'string' }, names: { type: 'array', items: { type: 'string' } } } },
    handler: null // Wired dynamically in startWorker
  })

  // ── Window & Desktop ──

  caps.register('open', {
    description: 'Open a built-in app: finder, editor, terminal, image, browser, map, music, video, settings, launchpad',
    icon: '🪟', category: 'Window & Desktop',
    schema: { type: 'object', properties: { target: { type: 'string', enum: ['finder', 'editor', 'terminal', 'image', 'browser', 'map', 'music', 'video', 'settings', 'launchpad'] }, path: { type: 'string', description: 'For finder/editor' }, url: { type: 'string', description: 'For browser/image/video' }, src: { type: 'string', description: 'For image' }, title: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' }, zoom: { type: 'number' } }, required: ['target'] },
    handler: ({ target, path, url, src, title, lat, lng, zoom }, ctx) => {
      switch (target) {
        case 'finder': ctx.EventBus.emit('window.open', { type: 'finder', data: { path: path || '/home/user' } }); ctx.showActivity(`Finder: ${path || '/home/user'}`); break
        case 'editor': ctx.EventBus.emit('window.open', { type: 'editor', data: { path } }); ctx.showActivity(`Opened ${path ? path.split('/').pop() : 'Editor'}`); break
        case 'terminal': ctx.EventBus.emit('window.open', { type: 'terminal' }); ctx.showActivity('Opened Terminal'); break
        case 'image': ctx.EventBus.emit('window.open', { type: 'image', data: { src: src || url, title } }); ctx.showActivity(`Opened image: ${title || 'image'}`); break
        case 'browser': ctx.EventBus.emit('window.open', { type: 'browser', data: { url } }); ctx.showActivity(`🌐 Browser: ${url || 'home'}`); break
        case 'map': ctx.EventBus.emit('window.open', { type: 'map', data: { lat, lng, zoom } }); ctx.showActivity('🗺️ Map'); break
        case 'music': ctx.EventBus.emit('window.open', { type: 'music' }); ctx.showActivity('🎵 Music'); break
        case 'video': ctx.EventBus.emit('window.open', { type: 'video', data: { url, title } }); ctx.showActivity(`🎬 Video: ${title || 'player'}`); break
        case 'settings': ctx.EventBus.emit('window.open', { type: 'settings' }); ctx.showActivity('⚙️ Settings'); break
        case 'launchpad': ctx.EventBus.emit('window.open', { type: 'launchpad' }); ctx.showActivity('🚀 Launchpad'); break
        default: return { error: `Unknown target: ${target}` }
      }
      return { success: true }
    }
  })

  caps.register('window', {
    description: 'Window management: close, move, resize, minimize, maximize, restore, focus, list, tile, snap. Positions/sizes are in pixels.',
    icon: '🖥️', category: 'Window & Desktop',
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['close', 'move', 'resize', 'minimize', 'maximize', 'restore', 'focus', 'list', 'tile', 'snap'] }, title: { type: 'string', description: 'Window title' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, layout: { type: 'string', enum: ['horizontal', 'vertical', 'grid'] }, zone: { type: 'string', enum: ['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] } }, required: ['action'] },
    handler: ({ action, title, x, y, width, height, layout, zone }, ctx) => {
      const wm = ctx.WindowManager
      switch (action) {
        case 'close': wm.closeByTitle(title); ctx.showActivity(`Closed: ${title}`); break
        case 'move': {
          const w = wm.windowList.find(w => w.title === title)
          if (w && x != null && y != null) wm.move(w.id, x, y)
          ctx.showActivity(`Moved: ${title}`)
          break
        }
        case 'resize': {
          const w = wm.windowList.find(w => w.title === title)
          if (w && width != null && height != null) wm.resize(w.id, width, height)
          ctx.showActivity(`Resized: ${title}`)
          break
        }
        case 'minimize': { const w = wm.windowList.find(w => w.title === title); if (w) wm.minimize(w.id); ctx.showActivity(`Minimized: ${title}`); break }
        case 'maximize': { const w = wm.windowList.find(w => w.title === title); if (w) wm.toggleMaximize(w.id); ctx.showActivity(`Maximized: ${title}`); break }
        case 'restore': { const w = wm.windowList.find(w => w.title === title); if (w) { w.minimized = false; wm.focus(w.id) }; ctx.showActivity(`Restored: ${title}`); break }
        case 'focus': { const w = wm.windowList.find(w => w.title === title); if (w) wm.focus(w.id); ctx.showActivity(`Focused: ${title}`); break }
        case 'list': return { windows: wm.windowList.map(w => ({ id: w.id, title: w.title, type: w.type, minimized: w.minimized })) }
        case 'tile': wm.tileWindows(layout); ctx.showActivity(`Tiled: ${layout || 'auto'}`); break
        case 'snap': {
          const w = wm.windowList.find(w => w.title === title)
          if (w && zone) wm.snapWindow(w.id, zone)
          ctx.showActivity(`Snapped: ${title} → ${zone}`)
          break
        }
        default: return { error: `Unknown window action: ${action}` }
      }
      return { success: true }
    }
  })

  caps.register('set_wallpaper', {
    description: 'Change desktop wallpaper with preset, CSS gradient, or image URL',
    icon: '🎨', category: 'Window & Desktop',
    schema: { type: 'object', properties: { preset: { type: 'string', enum: ['aurora', 'sunset', 'ocean', 'forest', 'lavender', 'midnight', 'rose', 'sky'] }, css: { type: 'string' }, url: { type: 'string' } } },
    handler: ({ css, url, preset }, ctx) => {
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
      let background
      if (url) background = `url(${url}) center/cover no-repeat`
      else if (css) background = css
      else if (preset) {
        if (!presets[preset]) return { error: `Unknown preset. Available: ${Object.keys(presets).join(', ')}` }
        background = presets[preset]
      } else {
        return { error: 'Provide preset, css, or url' }
      }
      ctx.EventBus.emit('wallpaper.change', { background })
      ctx.showActivity('🎨 Wallpaper changed')
      return { success: true }
    }
  })

  caps.register('notify', {
    description: 'Show a toast notification to the user',
    icon: '🔔', category: 'Window & Desktop', alwaysAvailable: true,
    schema: { type: 'object', properties: { message: { type: 'string' }, type: { type: 'string', enum: ['info', 'success', 'warning', 'error'] } }, required: ['message'] },
    handler: ({ message, type }, ctx) => {
      ctx.EventBus.emit('notify', { text: message, type: type || 'info' })
      return { success: true }
    }
  })

  // ── Media ──

  caps.register('music', {
    description: 'Control music player: play, pause, next, prev, add, add_and_play',
    icon: '🎵', category: 'Media',
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['play', 'pause', 'next', 'prev', 'add', 'add_and_play'] }, track: { type: 'number' }, title: { type: 'string' }, artist: { type: 'string' }, url: { type: 'string' }, artwork: { type: 'string' } }, required: ['action'] },
    handler: ({ action, track, title, artist, url, artwork }, ctx) => {
      ctx.EventBus.emit('window.open', { type: 'music' })
      if (action === 'add' || action === 'add_and_play') {
        ctx.EventBus.emit('music.addTrack', { title, artist, url, artwork })
        if (action === 'add_and_play') ctx.EventBus.emit('music.control', { action: 'play', track: -1 })
        ctx.showActivity(`🎵 ${action === 'add' ? 'Added' : 'Playing'}: ${title}`)
        return { success: true }
      }
      ctx.EventBus.emit('music.control', { action, track })
      ctx.showActivity(`🎵 Music: ${action}`)
      return { success: true }
    }
  })

  caps.register('video', {
    description: 'Video player: play URL, pause, fullscreen',
    icon: '🎬', category: 'Media',
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['play', 'pause', 'fullscreen'] }, url: { type: 'string' }, title: { type: 'string' } }, required: ['action'] },
    handler: ({ action, url, title }, ctx) => {
      if (action === 'play' && url) ctx.EventBus.emit('window.open', { type: 'video', url, title })
      else ctx.EventBus.emit('video.control', { action })
      return { success: true }
    }
  })

  // ── Web & Browser ──

  caps.register('browser', {
    description: 'Browser: open URL and display fetched content',
    icon: '🌐', category: 'Web',
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['open', 'navigate', 'back'] }, url: { type: 'string' } }, required: ['action'] },
    handler: ({ action, url }, ctx) => {
      if (action === 'open') ctx.EventBus.emit('window.open', { type: 'browser', url })
      else ctx.EventBus.emit('browser.control', { action, url })
      return { success: true }
    }
  })

  caps.register('browser_control', {
    description: 'Control the active browser page (like Playwright). Actions: snapshot, click @ref, type @ref text, extract, eval, scroll, highlight, navigate, ping.',
    icon: '🕹️', category: 'Web',
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['snapshot', 'click', 'type', 'extract', 'eval', 'scroll', 'highlight', 'navigate', 'ping'] }, ref: { type: 'string' }, text: { type: 'string' }, submit: { type: 'boolean' }, selector: { type: 'string' }, code: { type: 'string' }, url: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, required: ['action'] },
    handler: ({ action, ref, text, submit, selector, code, url, x, y }, ctx) => {
      return new Promise((resolve) => {
        const iframes = document.querySelectorAll('.browser-content iframe')
        const iframe = iframes[iframes.length - 1]
        if (!iframe || !iframe.contentWindow) { resolve({ error: 'No active browser iframe' }); return }
        const id = Date.now() + Math.random()
        const timeout = setTimeout(() => { window.removeEventListener('message', handler); resolve({ error: 'Bridge timeout (5s)' }) }, 5000)
        function handler(event) {
          if (event.data?.__bridgeResponse && event.data.__id === id) {
            clearTimeout(timeout)
            window.removeEventListener('message', handler)
            resolve(event.data)
          }
        }
        window.addEventListener('message', handler)
        iframe.contentWindow.postMessage({ __bridge: true, __id: id, action, ref, text, submit, selector, code, url, x, y }, '*')
      })
    }
  })

  caps.register('web_search', {
    description: 'Search the web using Tavily',
    icon: '🔍', category: 'Web', alwaysAvailable: true,
    schema: { type: 'object', properties: { query: { type: 'string' }, search_depth: { type: 'string', enum: ['basic', 'advanced'] } }, required: ['query'] },
    handler: async ({ query, search_depth }, ctx) => {
      ctx.showActivity(`🔍 Searching: ${query.slice(0, 40)}...`)
      const key = window._settingsCache?.tavilyKey
      if (!key) return { error: 'No Tavily API key configured.' }
      try {
        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: key, query, search_depth: search_depth || 'basic', max_results: 5 })
        })
        const data = await res.json()
        return { results: (data.results || []).map(r => ({ title: r.title, url: r.url, content: r.content?.slice(0, 500) })), answer: data.answer }
      } catch (e) { return { error: `Search failed: ${e.message}` } }
    }
  })

  caps.register('web_fetch', {
    description: 'Fetch and read web page content from a URL',
    icon: '📄', category: 'Web', alwaysAvailable: true,
    schema: { type: 'object', properties: { url: { type: 'string' }, max_chars: { type: 'number' } }, required: ['url'] },
    handler: async ({ url, max_chars }, ctx) => {
      ctx.showActivity(`📄 Fetching: ${url.slice(0, 40)}...`)
      try {
        const res = await fetch(`https://proxy.link2web.site/?url=${encodeURIComponent(url)}&mode=llm`)
        const text = await res.text()
        return { content: max_chars ? text.slice(0, max_chars) : text.slice(0, 8000), url }
      } catch (e) { return { error: `Fetch failed: ${e.message}` } }
    }
  })

  // ── Extended Capabilities (lazy-loaded via search_tools) ──

  caps.register('search_music', {
    description: 'Search for songs. Returns track name, artist, album, artwork, and playable/preview URLs. For Chinese songs uses NetEase (full MP3), for international uses iTunes (30s preview). After getting results, use the music tool with action "add_and_play" to play.',
    icon: '🎵', category: 'Media',
    schema: { type: 'object', properties: { query: { type: 'string', description: 'Song, artist, or album name' }, source: { type: 'string', enum: ['auto', 'netease', 'itunes'], description: 'Music source' }, limit: { type: 'number' } }, required: ['query'] },
    handler: async ({ query, source, limit }, ctx) => {
      ctx.showActivity(`🎵 Searching: ${query}`)
      const isChinese = /[\u4e00-\u9fff]/.test(query)
      const src = source || 'auto'
      const maxResults = Math.min(limit || 5, 20)

      async function searchNetease() {
        const url = `https://music.163.com/api/cloudsearch/pc?s=${encodeURIComponent(query)}&type=1&limit=${maxResults}&offset=0`
        const res = await fetch(`https://proxy.link2web.site`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, method: 'GET', mode: 'raw' }) })
        const proxy = await res.json()
        const data = typeof proxy.body === 'string' ? JSON.parse(proxy.body) : proxy.body
        const songs = data?.result?.songs
        if (!songs?.length) return null
        return songs.map(s => {
          const dur = Math.round((s.dt || 0) / 1000), min = Math.floor(dur / 60), sec = dur % 60
          return { track: s.name, artist: (s.ar || []).map(a => a.name).join(' / '), album: s.al?.name || '', artwork: (s.al?.picUrl || '').replace('http://', 'https://'), url: `https://music.163.com/song/media/outer/url?id=${s.id}.mp3`, duration: `${min}:${sec.toString().padStart(2, '0')}` }
        })
      }

      async function searchItunes() {
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=${maxResults}`
        let data
        try { const res = await fetch(url); data = await res.json() }
        catch { const res = await fetch(`https://proxy.link2web.site`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, method: 'GET', mode: 'raw' }) }); const proxy = await res.json(); data = typeof proxy.body === 'string' ? JSON.parse(proxy.body) : proxy.body }
        return (data?.results || []).map(t => ({ track: t.trackName, artist: t.artistName, album: t.collectionName, artwork: t.artworkUrl100?.replace('100x100', '600x600'), url: t.previewUrl, genre: t.primaryGenreName }))
      }

      try {
        if (src === 'netease' || (src === 'auto' && isChinese)) {
          const results = await searchNetease()
          if (results) return { results, source: 'netease' }
          if (src === 'netease') return { results: [], message: 'No results found' }
        }
        const results = await searchItunes()
        return { results, source: 'itunes' }
      } catch (e) { return { error: `Music search failed: ${e.message}` } }
    }
  })

  caps.register('get_weather', {
    description: 'Get current weather and 3-day forecast. Use city name or coordinates.',
    icon: '⛅', category: 'Information',
    schema: { type: 'object', properties: { city: { type: 'string', description: 'City name (e.g. "北京", "Tokyo")' }, latitude: { type: 'number' }, longitude: { type: 'number' } } },
    handler: async ({ city, latitude, longitude }, ctx) => {
      ctx.showActivity(`⛅ Weather: ${city || 'location'}`)
      try {
        let lat = latitude, lon = longitude
        if (city && !lat) {
          const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`)
          const geo = await geoRes.json()
          if (!geo.results?.length) return { error: `City not found: ${city}` }
          lat = geo.results[0].latitude; lon = geo.results[0].longitude
        }
        if (!lat || !lon) return { error: 'Provide city or coordinates' }
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=3`
        const res = await fetch(url)
        const data = await res.json()
        const WMO = { 0: '☀️ Clear', 1: '🌤️ Mostly clear', 2: '⛅ Partly cloudy', 3: '☁️ Overcast', 45: '🌫️ Fog', 51: '🌦️ Light drizzle', 61: '🌧️ Rain', 71: '❄️ Snow', 80: '🌧️ Showers', 95: '⛈️ Thunderstorm' }
        return {
          location: city || `${lat}, ${lon}`,
          current: { temp: `${data.current.temperature_2m}°C`, humidity: `${data.current.relative_humidity_2m}%`, wind: `${data.current.wind_speed_10m} km/h`, condition: WMO[data.current.weather_code] || `Code ${data.current.weather_code}` },
          forecast: data.daily.time.map((d, i) => ({ date: d, high: `${data.daily.temperature_2m_max[i]}°C`, low: `${data.daily.temperature_2m_min[i]}°C`, condition: WMO[data.daily.weather_code[i]] || `Code ${data.daily.weather_code[i]}` }))
        }
      } catch (e) { return { error: `Weather failed: ${e.message}` } }
    }
  })

  caps.register('get_location', {
    description: 'Get user\'s current location (lat/lng) via browser GPS.',
    icon: '📍', category: 'Information',
    schema: { type: 'object', properties: {} },
    handler: (_, ctx) => {
      ctx.showActivity('📍 Getting location...')
      return new Promise((resolve) => {
        if (!navigator.geolocation) { resolve({ error: 'Geolocation not supported' }); return }
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }),
          (err) => resolve({ error: { 1: 'User denied location access', 2: 'Position unavailable', 3: 'Request timed out' }[err.code] || err.message }),
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
        )
      })
    }
  })

  caps.register('calculate', {
    description: 'Evaluate a math expression. Supports +, -, *, /, ^, %, Math functions.',
    icon: '🧮', category: 'Information', alwaysAvailable: true,
    schema: { type: 'object', properties: { expression: { type: 'string', description: 'Math expression (e.g. "125 * 0.85", "Math.sqrt(144)")' } }, required: ['expression'] },
    handler: ({ expression }) => {
      try {
        const safe = expression.replace(/[^0-9+\-*/().%^\s,eE]|(?:Math\.\w+)/g, (m) => {
          if (/^Math\.\w+$/.test(m)) return m
          return ''
        })
        const result = new Function(`return (${expression})`)()
        if (typeof result !== 'number' || !isFinite(result)) return { error: 'Invalid expression' }
        return { result, expression }
      } catch (e) { return { error: `Eval failed: ${e.message}` } }
    }
  })

  caps.register('get_wikipedia', {
    description: 'Get Wikipedia article summary. More precise than web_search for factual/encyclopedic queries.',
    icon: '📚', category: 'Information',
    schema: { type: 'object', properties: { query: { type: 'string', description: 'Article title or search term' }, language: { type: 'string', enum: ['en', 'zh', 'ja', 'ko', 'fr', 'de', 'es'] } }, required: ['query'] },
    handler: async ({ query, language }, ctx) => {
      ctx.showActivity(`📚 Wikipedia: ${query}`)
      const lang = language || 'en'
      try {
        const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`
        const res = await fetch(url)
        if (!res.ok) {
          const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=3&format=json`
          const sRes = await fetch(searchUrl)
          const sData = await sRes.json()
          if (sData[1]?.length) return { suggestions: sData[1], message: `No exact match. Did you mean: ${sData[1].join(', ')}?` }
          return { error: 'Article not found' }
        }
        const data = await res.json()
        return { title: data.title, extract: data.extract, thumbnail: data.thumbnail?.source, url: data.content_urls?.desktop?.page }
      } catch (e) { return { error: `Wikipedia failed: ${e.message}` } }
    }
  })

  caps.register('get_stock', {
    description: 'Get stock price and 5-day history. US (AAPL), HK (0700.HK), China A-shares (600519.SS).',
    icon: '📈', category: 'Information',
    schema: { type: 'object', properties: { symbol: { type: 'string', description: 'Stock ticker symbol' } }, required: ['symbol'] },
    handler: async ({ symbol }, ctx) => {
      ctx.showActivity(`📈 Stock: ${symbol}`)
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`
        const res = await fetch(`https://proxy.link2web.site`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, method: 'GET', mode: 'raw' }) })
        const proxy = await res.json()
        const data = typeof proxy.body === 'string' ? JSON.parse(proxy.body) : proxy.body
        const result = data?.chart?.result?.[0]
        if (!result) return { error: `No data for ${symbol}` }
        const meta = result.meta
        const quotes = result.indicators?.quote?.[0]
        return {
          symbol: meta.symbol, currency: meta.currency,
          price: meta.regularMarketPrice, previousClose: meta.previousClose,
          change: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose * 100).toFixed(2) + '%',
          history: (result.timestamp || []).map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: quotes?.close?.[i]?.toFixed(2) }))
        }
      } catch (e) { return { error: `Stock failed: ${e.message}` } }
    }
  })

  caps.register('search_movie', {
    description: 'Search movies via TMDB. Returns poster URLs, ratings, genres, overviews.',
    icon: '🎬', category: 'Information',
    schema: { type: 'object', properties: { query: { type: 'string' }, year: { type: 'number' } }, required: ['query'] },
    handler: async ({ query, year }, ctx) => {
      ctx.showActivity(`🎬 Movie: ${query}`)
      const key = window._settingsCache?.tmdbKey
      if (!key) return { error: 'TMDB API key not configured in Settings' }
      try {
        let url = `https://api.themoviedb.org/3/search/movie?api_key=${key}&query=${encodeURIComponent(query)}&language=zh-CN`
        if (year) url += `&year=${year}`
        const res = await fetch(url)
        const data = await res.json()
        return { results: (data.results || []).slice(0, 6).map(m => ({ id: m.id, title: m.title, originalTitle: m.original_title, year: m.release_date?.slice(0, 4), overview: m.overview?.slice(0, 150), rating: m.vote_average, poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null })) }
      } catch (e) { return { error: `Movie search failed: ${e.message}` } }
    }
  })

  caps.register('get_movie_detail', {
    description: 'Get detailed movie info: cast, crew, runtime, budget. Use after search_movie.',
    icon: '🎬', category: 'Information',
    schema: { type: 'object', properties: { movie_id: { type: 'number' } }, required: ['movie_id'] },
    handler: async ({ movie_id }, ctx) => {
      ctx.showActivity(`🎬 Movie detail: #${movie_id}`)
      const key = window._settingsCache?.tmdbKey
      if (!key) return { error: 'TMDB API key not configured' }
      try {
        const res = await fetch(`https://api.themoviedb.org/3/movie/${movie_id}?api_key=${key}&append_to_response=credits&language=zh-CN`)
        const m = await res.json()
        return { title: m.title, originalTitle: m.original_title, year: m.release_date?.slice(0, 4), runtime: m.runtime, genres: m.genres?.map(g => g.name), overview: m.overview, rating: m.vote_average, poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null, director: m.credits?.crew?.find(c => c.job === 'Director')?.name, cast: m.credits?.cast?.slice(0, 8).map(c => ({ name: c.name, character: c.character })) }
      } catch (e) { return { error: `Movie detail failed: ${e.message}` } }
    }
  })

  // ── Maps ──

  caps.register('map', {
    description: 'Map operations: open, add markers, show routes, clear',
    icon: '🗺️', category: 'Maps',
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['open', 'marker', 'clear_markers', 'route', 'clear_route'] }, lat: { type: 'number' }, lng: { type: 'number' }, label: { type: 'string' }, color: { type: 'string' }, zoom: { type: 'number' }, from_lat: { type: 'number' }, from_lng: { type: 'number' }, to_lat: { type: 'number' }, to_lng: { type: 'number' } }, required: ['action'] },
    handler: ({ action, lat, lng, label, color, zoom, from_lat, from_lng, to_lat, to_lng }, ctx) => {
      switch (action) {
        case 'open': ctx.EventBus.emit('window.open', { type: 'map', data: { lat, lng, zoom } }); ctx.showActivity('🗺️ Map'); break
        case 'marker': ctx.EventBus.emit('window.open', { type: 'map' }); ctx.EventBus.emit('map.marker', { lat, lng, label, color }); ctx.showActivity(`📍 Marker: ${label || `${lat}, ${lng}`}`); break
        case 'clear_markers': ctx.EventBus.emit('map.clearMarkers'); break
        case 'route': ctx.EventBus.emit('window.open', { type: 'map' }); ctx.EventBus.emit('map.route', { from: { lat: from_lat, lng: from_lng }, to: { lat: to_lat, lng: to_lng } }); ctx.showActivity('🚗 Route'); break
        case 'clear_route': ctx.EventBus.emit('map.clearRoute'); break
        default: return { error: `Unknown map action: ${action}` }
      }
      return { success: true }
    }
  })

  // ── Apps & Skills ──

  caps.register('app', {
    description: 'Manage generative apps. Write manifest.json + view HTML + data.json + actions.json to /home/user/apps/<name>/ then call create. Also supports legacy html/css/js params. Size guide: calculator~320x420, dashboard~700x500.',
    icon: '💻', category: 'Apps', alwaysAvailable: true,
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['create', 'update', 'uninstall', 'list'] }, name: { type: 'string' }, html: { type: 'string' }, css: { type: 'string' }, js: { type: 'string' }, icon: { type: 'string' }, width: { type: 'number' }, height: { type: 'number' }, description: { type: 'string' } }, required: ['action'] },
    handler: ({ action, name, html, css, js, icon, width, height, description }, ctx) => {
      const { VFS, showActivity } = ctx
      switch (action) {
        case 'create': case 'update': {
          if (!name) return { error: 'name is required' }
          const appDir = `/home/user/apps/${name}`
          VFS.mkdir(appDir)

          // Check if manifest already exists (agent wrote files via fs tool first)
          const existingManifest = VFS.isFile(`${appDir}/manifest.json`)
            ? (() => { try { return JSON.parse(VFS.readFile(`${appDir}/manifest.json`)) } catch { return null } })()
            : null

          if (existingManifest && (existingManifest.view || VFS.isFile(`${appDir}/view.html`))) {
            // New unified format: manifest+view+data+actions already written
            if (!existingManifest.id) existingManifest.id = name
            if (icon) existingManifest.icon = icon
            if (width || height) existingManifest.size = { width: width || 600, height: height || 460 }
            if (description) existingManifest.description = description
            VFS.writeFile(`${appDir}/manifest.json`, JSON.stringify(existingManifest, null, 2))
            ctx.EventBus.emit('window.open', { type: 'dynamicapp', data: { name, id: name, appDir, title: existingManifest.name || name, icon: existingManifest.icon || '💻' } })
            showActivity(`💻 ${action === 'create' ? 'Created' : 'Updated'} app: ${name}`)
            return { success: true, message: `App "${name}" ${action === 'create' ? 'created and opened' : 'updated'}` }
          }

          // Legacy path: html/css/js params or index.html in dir
          let appHtml = html, appCss = css, appJs = js
          if (!appHtml) {
            if (VFS.isFile(`${appDir}/index.html`)) appHtml = VFS.readFile(`${appDir}/index.html`)
            if (VFS.isFile(`${appDir}/style.css`)) appCss = VFS.readFile(`${appDir}/style.css`)
            if (VFS.isFile(`${appDir}/script.js`)) appJs = VFS.readFile(`${appDir}/script.js`)
            if (!appHtml) return { error: `No html provided and no index.html found at ${appDir}/. Write files first with fs tool, then call app create.` }
          }

          const manifest = { id: name, name, icon: icon || '💻', size: { width: width || 420, height: height || 360 }, description: description || '' }
          VFS.writeFile(`${appDir}/manifest.json`, JSON.stringify(manifest, null, 2))
          if (appHtml) VFS.writeFile(`${appDir}/view.html`, appHtml)
          if (appCss) VFS.writeFile(`${appDir}/style.css`, appCss)
          if (appJs) VFS.writeFile(`${appDir}/script.js`, appJs)
          ctx.EventBus.emit('window.open', { type: 'dynamicapp', data: { name, id: name, appDir, title: name, icon: icon || '💻' } })
          showActivity(`💻 ${action === 'create' ? 'Created' : 'Updated'} app: ${name}`)
          return { success: true, message: `App "${name}" ${action === 'create' ? 'created and opened' : 'updated'}` }
        }
        case 'uninstall': {
          if (!name) return { error: 'name is required' }
          const appDir = `/home/user/apps/${name}`
          if (VFS.isDir(appDir)) {
            const files = VFS.ls(appDir)
            if (files) files.forEach(f => VFS.rm(`${appDir}/${f.name}`))
            VFS.rm(appDir)
          }
          showActivity(`🗑️ Uninstalled: ${name}`)
          return { success: true }
        }
        case 'list': {
          const dirs = VFS.ls('/home/user/apps')
          const apps = []
          if (dirs) {
            for (const d of dirs) {
              if (d.type !== 'dir') continue
              const mp = `/home/user/apps/${d.name}/manifest.json`
              if (VFS.isFile(mp)) {
                try { apps.push(JSON.parse(VFS.readFile(mp))) } catch { apps.push({ name: d.name }) }
              } else {
                apps.push({ name: d.name })
              }
            }
          }
          return { apps }
        }
        default: return { error: `Unknown app action: ${action}` }
      }
    }
  })

  caps.register('skill', {
    description: 'Manage skills: create, list, read, delete',
    icon: '🧩', category: 'Apps',
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['create', 'list', 'read', 'delete'] }, name: { type: 'string' }, description: { type: 'string' }, icon: { type: 'string' }, schema: { type: 'object' }, handler: { type: 'string' } }, required: ['action'] },
    handler: null // Wired in agent.js
  })

  caps.register('dynamicapp', {
    description: 'Create and manage dynamic app windows',
    icon: '⚡', category: 'Apps', alwaysAvailable: true,
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['open', 'update', 'close', 'destroy', 'list'] }, id: { type: 'string' }, title: { type: 'string' }, icon: { type: 'string' }, object: { type: 'object' }, actions: { type: 'array' }, html: { type: 'string' } }, required: ['action'] },
    handler: ({ action, id, title, icon, object, actions, html }, ctx) => {
      const { VFS, showActivity } = ctx
      switch (action) {
        case 'open': {
          if (!id) return { error: 'id is required' }
          const appDir = `/tmp/apps/${id}`
          VFS.mkdir(appDir)
          const manifest = { id, name: title || id, icon: icon || '⚡', ephemeral: true, data: 'data.json', actions: 'actions.json' }
          if (html) manifest.view = 'view.html'
          VFS.writeFile(`${appDir}/manifest.json`, JSON.stringify(manifest, null, 2))
          VFS.writeFile(`${appDir}/data.json`, JSON.stringify(object || {}, null, 2))
          VFS.writeFile(`${appDir}/actions.json`, JSON.stringify(actions || [], null, 2))
          if (html) VFS.writeFile(`${appDir}/view.html`, html)
          ctx.EventBus.emit('window.open', { type: 'dynamicapp', data: { id, appDir, title: title || id, icon: icon || '⚡' } })
          showActivity(`⚡ Created: ${title || id}`)
          return { id }
        }
        case 'update': {
          if (!id) return { error: 'id is required' }
          const appDir = `/tmp/apps/${id}`
          if (object !== undefined) VFS.writeFile(`${appDir}/data.json`, JSON.stringify(object, null, 2))
          if (actions !== undefined) VFS.writeFile(`${appDir}/actions.json`, JSON.stringify(actions, null, 2))
          if (html !== undefined) VFS.writeFile(`${appDir}/view.html`, html)
          ctx.EventBus.emit('dynamicapp.update', { id })
          return { success: true }
        }
        case 'close': case 'destroy': {
          if (!id) return { error: 'id is required' }
          if (action === 'destroy') {
            const appDir = `/tmp/apps/${id}`
            const files = VFS.ls(appDir)
            if (files) files.forEach(f => VFS.rm(`${appDir}/${f.name}`))
            VFS.rm(appDir)
          }
          return { success: true }
        }
        case 'list': {
          const dirs = VFS.ls('/tmp/apps')
          const apps = []
          if (dirs) {
            for (const d of dirs) {
              if (d.type !== 'dir') continue
              const mp = `/tmp/apps/${d.name}/manifest.json`
              if (VFS.isFile(mp)) {
                try { apps.push(JSON.parse(VFS.readFile(mp))) } catch {}
              }
            }
          }
          return { apps }
        }
        default: return { error: `Unknown dynamicapp action: ${action}` }
      }
    }
  })

  console.log(`[Capabilities] ${caps.count()} built-in capabilities registered`)
}
