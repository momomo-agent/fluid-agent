// register-capabilities.js — Register all built-in capabilities
// Each capability declares itself: what it does, its schema, and its handler.
// Agent discovers capabilities through the registry, not hardcoded lists.

;(() => {
  // Helper: needs showActivity, VFS, Shell, WindowManager, EventBus at call time
  // Handlers receive a context object with these dependencies

  // ── Core: always available ──

  Capabilities.register('fs', {
    description: 'File system operations: write, read, list, or mkdir files/directories',
    icon: '📁',
    category: 'Core',
    alwaysAvailable: true,
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['write', 'read', 'list', 'mkdir'], description: 'write=create/overwrite file, read=read file, list=list directory, mkdir=create directory' }, path: { type: 'string' }, content: { type: 'string', description: 'File content (for write)' } }, required: ['action', 'path'] },
    handler: ({ action, path, content }, ctx) => {
      const { VFS, showActivity } = ctx
      switch (action) {
        case 'write': VFS.mkdir(path.split('/').slice(0, -1).join('/')); VFS.writeFile(path, content); showActivity(`Created ${path.split('/').pop()}`); return { success: true }
        case 'read': { const c = VFS.readFile(path); return c !== null ? { content: c } : { error: `Not found: ${path}` } }
        case 'list': { const items = VFS.ls(path); return items ? { items } : { error: `Not found: ${path}` } }
        case 'mkdir': VFS.mkdir(path); showActivity(`Created dir ${path}`); return { success: true }
        default: return { error: `Unknown fs action: ${action}` }
      }
    }
  })

  Capabilities.register('run_command', {
    description: 'Run a shell command and return output',
    icon: '⬛',
    category: 'Core',
    alwaysAvailable: true,
    schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    handler: async ({ command }, ctx) => {
      ctx.showActivity(`$ ${command}`)
      return { output: await ctx.Shell.execAsync(command) || '(no output)' }
    }
  })

  Capabilities.register('update_progress', {
    description: 'Mark a step as done by index (0-based)',
    icon: '✅',
    category: 'Core',
    alwaysAvailable: true,
    schema: { type: 'object', properties: { step_index: { type: 'number' } }, required: ['step_index'] },
    handler: ({ step_index }, ctx) => {
      if (ctx.steps[step_index]) { ctx.steps[step_index].status = 'done'; ctx.WindowManager.updateTask(ctx.task) }
      ctx.showActivity(`✅ Step ${step_index + 1} done`)
      return { success: true }
    }
  })

  Capabilities.register('plan_steps', {
    description: 'Set your execution plan (call first if no steps provided)',
    icon: '📋',
    category: 'Core',
    alwaysAvailable: true,
    schema: { type: 'object', properties: { planned: { type: 'array', items: { type: 'string' } } }, required: ['planned'] },
    handler: ({ planned }, ctx) => {
      if (!Array.isArray(planned) || !planned.length) return { error: 'planned must be non-empty array of strings' }
      ctx.steps.length = 0
      planned.forEach(s => ctx.steps.push({ text: s, status: 'pending' }))
      ctx.task.steps = ctx.steps
      ctx.WindowManager.updateTask(ctx.task)
      return { success: true, steps: planned }
    }
  })

  Capabilities.register('done', {
    description: 'Signal task completion with summary',
    icon: '🏁',
    category: 'Core',
    alwaysAvailable: true,
    schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
    handler: async ({ summary }, ctx) => {
      ctx.task.status = 'done'
      ctx.blackboard.currentTask.status = 'done'
      ctx.steps.forEach(s => { if (s.status !== 'done' && s.status !== 'error') s.status = 'done' })
      ctx.WindowManager.updateTask(ctx.task)
      return { done: true, summary }
    }
  })

  Capabilities.register('search_tools', {
    description: 'Load tools by name. All tools are listed in the system prompt — call this with the exact names you need. Tools stay loaded for the rest of this task.',
    icon: '🔍',
    category: 'Core',
    alwaysAvailable: true,
    schema: { type: 'object', properties: { query: { type: 'string' }, names: { type: 'array', items: { type: 'string' } } } },
    handler: null // Special: wired up dynamically in startWorker
  })

  // ── Window & Desktop ──

  Capabilities.register('open', {
    description: 'Open a built-in app: finder, editor, terminal, image, browser, map, music',
    icon: '🪟',
    category: 'Window & Desktop',
    schema: { type: 'object', properties: { target: { type: 'string', enum: ['finder', 'editor', 'terminal', 'image', 'browser', 'map', 'music'] }, path: { type: 'string', description: 'For finder/editor' }, url: { type: 'string', description: 'For browser/image' }, src: { type: 'string', description: 'For image' }, title: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' }, zoom: { type: 'number' } }, required: ['target'] },
    handler: ({ target, path, url, src, title, lat, lng, zoom }, ctx) => {
      const { EventBus, showActivity } = ctx
      switch (target) {
        case 'finder': EventBus.emit('window.open', { type: 'finder', path }); showActivity(`Finder: ${path}`); break
        case 'editor': EventBus.emit('window.open', { type: 'editor', path }); showActivity(`Opened ${path.split('/').pop()}`); break
        case 'terminal': EventBus.emit('window.open', { type: 'terminal' }); showActivity('Opened Terminal'); break
        case 'image': EventBus.emit('window.open', { type: 'image', src: src || url, title }); showActivity(`Opened image: ${title || 'image'}`); break
        case 'browser': EventBus.emit('window.open', { type: 'browser', url }); showActivity(`🌐 Browser: ${url || 'home'}`); break
        case 'map': EventBus.emit('window.open', { type: 'map', lat, lng, zoom }); showActivity(`🗺️ Map`); break
        case 'music': EventBus.emit('window.open', { type: 'music' }); showActivity('🎵 Music'); break
        default: return { error: `Unknown target: ${target}` }
      }
      return { success: true }
    }
  })

  Capabilities.register('window', {
    description: 'Window management: close, move, resize, minimize, maximize, restore, focus, list, tile. Positions/sizes are normalized 0-1 (fraction of desktop).',
    icon: '🖥️',
    category: 'Window & Desktop',
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['close', 'move', 'resize', 'minimize', 'maximize', 'restore', 'focus', 'list', 'tile'] }, title: { type: 'string', description: 'Window title (for most actions)' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, layout: { type: 'string', enum: ['grid', 'horizontal', 'vertical'] } }, required: ['action'] },
    handler: ({ action, title, x, y, width, height, layout }, ctx) => {
      const { WindowManager, showActivity } = ctx
      switch (action) {
        case 'close': WindowManager.closeByTitle(title); showActivity(`Closed: ${title}`); break
        case 'move': WindowManager.moveWindow(title, x, y); showActivity(`Moved: ${title}`); break
        case 'resize': WindowManager.resizeWindow(title, width, height); showActivity(`Resized: ${title}`); break
        case 'minimize': WindowManager.minimizeByTitle(title); showActivity(`Minimized: ${title}`); break
        case 'maximize': WindowManager.maximizeByTitle(title); showActivity(`Maximized: ${title}`); break
        case 'restore': WindowManager.unminimizeByTitle(title); showActivity(`Restored: ${title}`); break
        case 'focus': WindowManager.focusByTitle(title); showActivity(`Focused: ${title}`); break
        case 'list': { const wins = []; for (const [id, w] of WindowManager.getState()) wins.push({ id, title: w.title || w.type, type: w.type, minimized: w.el?.classList.contains('minimized') }); return { windows: wins } }
        case 'tile': WindowManager.tileWindows(layout || 'grid'); showActivity(`Tiled: ${layout || 'grid'}`); break
        default: return { error: `Unknown window action: ${action}` }
      }
      return { success: true }
    }
  })

  Capabilities.register('set_wallpaper', {
    description: 'Change desktop wallpaper with preset, CSS gradient, or image URL',
    icon: '🎨',
    category: 'Window & Desktop',
    schema: { type: 'object', properties: { preset: { type: 'string', enum: ['aurora', 'sunset', 'ocean', 'forest', 'lavender', 'midnight', 'rose', 'sky'] }, css: { type: 'string' }, url: { type: 'string' } } },
    handler: ({ css, url, preset }, ctx) => {
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
      ctx.showActivity(`🎨 Wallpaper changed`)
      return { success: true }
    }
  })

  // ── Media ──

  Capabilities.register('music', {
    description: 'Control music player. Actions: play, pause, next, prev, add (add track), add_and_play. For add: provide title, artist, and optionally url (MP3) and artwork. If no url, a synth track is generated.',
    icon: '🎵',
    category: 'Media',
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['play', 'pause', 'next', 'prev', 'add', 'add_and_play'] }, track: { type: 'number' }, title: { type: 'string' }, artist: { type: 'string' }, style: { type: 'string', enum: ['dreamy', 'bright', 'gentle', 'moody', 'playful'] }, url: { type: 'string' }, artwork: { type: 'string' } }, required: ['action'] },
    handler: ({ action, track, title, artist, style, url, artwork }, ctx) => {
      ctx.EventBus.emit('window.open', { type: 'music' })
      if (action === 'add') {
        const result = ctx.WindowManager.musicAddTrack({ title, artist, style, url, artwork })
        if (result.error) return result
        ctx.showActivity(`🎵 Added: ${title}`)
        return { success: true, trackIndex: result.index, message: `Added "${title}" to playlist` }
      }
      if (action === 'add_and_play') {
        const result = ctx.WindowManager.musicAddTrack({ title, artist, style, url, artwork })
        if (result.error) return result
        ctx.EventBus.emit('music.control', { action: 'play', track: result.index })
        ctx.showActivity(`🎵 Playing: ${title}`)
        return { success: true, trackIndex: result.index }
      }
      ctx.EventBus.emit('music.control', { action, track })
      ctx.showActivity(`🎵 Music: ${action}${track != null ? ' #' + track : ''}`)
      return { success: true }
    }
  })

  Capabilities.register('video', {
    description: 'Video player: play URL, pause, fullscreen',
    icon: '🎬',
    category: 'Media',
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['play', 'pause', 'fullscreen'] }, url: { type: 'string' }, title: { type: 'string' } }, required: ['action'] },
    handler: ({ action, url, title }, ctx) => {
      switch (action) {
        case 'play': if (url) { ctx.EventBus.emit('window.open', { type: 'video', url, title }); ctx.showActivity(`🎬 Video: ${title || 'player'}`) } else { ctx.EventBus.emit('video.control', { action: 'play' }) }; break
        case 'pause': ctx.EventBus.emit('video.control', { action: 'pause' }); break
        case 'fullscreen': ctx.EventBus.emit('video.control', { action: 'fullscreen' }); break
        default: return { error: `Unknown video action: ${action}` }
      }
      return { success: true }
    }
  })

  // ── Web & Browser ──

  Capabilities.register('browser', {
    description: 'Browser control: open, navigate to URL, go back',
    icon: '🌐',
    category: 'Web',
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['open', 'navigate', 'back'] }, url: { type: 'string' } }, required: ['action'] },
    handler: ({ action, url }, ctx) => {
      switch (action) {
        case 'open': ctx.EventBus.emit('window.open', { type: 'browser', url }); ctx.showActivity(`🌐 Browser: ${url || 'home'}`); break
        case 'navigate': ctx.EventBus.emit('browser.control', { action: 'navigate', url }); ctx.showActivity(`🌐 Navigate: ${url}`); break
        case 'back': ctx.EventBus.emit('browser.control', { action: 'back' }); break
        default: return { error: `Unknown browser action: ${action}` }
      }
      return { success: true }
    }
  })

  Capabilities.register('browser_control', {
    description: 'Control the active browser page (like Playwright). Actions: snapshot, click @ref, type @ref text, extract, eval, scroll, highlight, navigate, ping.',
    icon: '🕹️',
    category: 'Web',
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

  Capabilities.register('web_search', {
    description: 'Search the web using Tavily for real-world facts and current events',
    icon: '🔍',
    category: 'Web',
    schema: { type: 'object', properties: { query: { type: 'string' }, search_depth: { type: 'string', enum: ['basic', 'advanced'] } }, required: ['query'] },
    handler: async ({ query, search_depth }, ctx) => {
      ctx.showActivity(`🔍 Searching: ${query.slice(0, 40)}...`)
      const settings = window._store ? (await window._store.get('settings')) || {} : {}
      const key = settings.tavilyKey
      if (!key) return { error: 'No Tavily API key configured. Open Settings to add one.' }
      try {
        const res = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: key, query, search_depth: search_depth || 'basic', max_results: 5 }) })
        const data = await res.json()
        return { results: (data.results || []).map(r => ({ title: r.title, url: r.url, content: r.content?.slice(0, 500) })), answer: data.answer }
      } catch (e) { return { error: `Search failed: ${e.message}` } }
    }
  })

  Capabilities.register('web_fetch', {
    description: 'Fetch and read web page content from a URL',
    icon: '📄',
    category: 'Web',
    schema: { type: 'object', properties: { url: { type: 'string' }, max_chars: { type: 'number' } }, required: ['url'] },
    handler: async ({ url, max_chars }, ctx) => {
      ctx.showActivity(`📄 Fetching: ${url.slice(0, 40)}...`)
      try {
        const proxyUrl = 'https://proxy.link2web.site'
        const res = await fetch(`${proxyUrl}/?url=${encodeURIComponent(url)}&mode=llm`)
        const text = await res.text()
        return { content: max_chars ? text.slice(0, max_chars) : text.slice(0, 8000), url }
      } catch (e) { return { error: `Fetch failed: ${e.message}` } }
    }
  })

  // ── Maps ──

  Capabilities.register('map', {
    description: 'Map operations: open, add markers, show routes, clear',
    icon: '🗺️',
    category: 'Maps',
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['open', 'marker', 'clear_markers', 'route', 'clear_route'] }, lat: { type: 'number' }, lng: { type: 'number' }, label: { type: 'string' }, color: { type: 'string' }, zoom: { type: 'number' }, from_lat: { type: 'number' }, from_lng: { type: 'number' }, to_lat: { type: 'number' }, to_lng: { type: 'number' } }, required: ['action'] },
    handler: ({ action, lat, lng, label, color, zoom, from_lat, from_lng, to_lat, to_lng }, ctx) => {
      const { WindowManager, EventBus, showActivity } = ctx
      switch (action) {
        case 'open': EventBus.emit('window.open', { type: 'map', lat, lng, zoom }); showActivity(`🗺️ Map`); break
        case 'marker': EventBus.emit('window.open', { type: 'map' }); WindowManager.mapAddMarker(lat, lng, label, color); showActivity(`📍 Marker: ${label || `${lat}, ${lng}`}`); break
        case 'clear_markers': WindowManager.mapClearMarkers(); break
        case 'route': EventBus.emit('window.open', { type: 'map' }); WindowManager.mapShowRoute({ lat: from_lat, lng: from_lng }, { lat: to_lat, lng: to_lng }); showActivity(`🚗 Route`); break
        case 'clear_route': WindowManager.mapClearRoute(); break
        default: return { error: `Unknown map action: ${action}` }
      }
      return { success: true }
    }
  })

  // ── Apps & Skills ──

  Capabilities.register('app', {
    description: 'Manage generative apps. Preferred: write files to /home/user/apps/<name>/ then call create with just name. Size guide: calculator~320x420, dashboard~700x500.',
    icon: '💻',
    category: 'Apps',
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['create', 'update', 'uninstall', 'list'] }, name: { type: 'string' }, html: { type: 'string' }, css: { type: 'string' }, js: { type: 'string' }, icon: { type: 'string' }, width: { type: 'number' }, height: { type: 'number' }, description: { type: 'string' } }, required: ['action'] },
    handler: ({ action, name, html, css, js, icon, width, height, description }, ctx) => {
      const { VFS, WindowManager, showActivity } = ctx
      switch (action) {
        case 'create': case 'update': {
          let appHtml = html, appCss = css, appJs = js
          const appDir = `/home/user/apps/${name}`
          if (!appHtml) {
            if (VFS.isFile(`${appDir}/index.html`)) appHtml = VFS.readFile(`${appDir}/index.html`)
            if (VFS.isFile(`${appDir}/style.css`)) appCss = VFS.readFile(`${appDir}/style.css`)
            if (VFS.isFile(`${appDir}/script.js`)) appJs = VFS.readFile(`${appDir}/script.js`)
            if (!appHtml) return { error: `No html provided and no index.html found at ${appDir}/. Write files first with fs tool, then call app create.` }
          }
          // Write manifest.json to VFS
          VFS.mkdir(appDir)
          const manifest = { id: name, name, icon: icon || '💻', sandboxed: true, size: { width: width || 420, height: height || 360 }, description: description || '' }
          VFS.writeFile(`${appDir}/manifest.json`, JSON.stringify(manifest, null, 2))
          if (appHtml) VFS.writeFile(`${appDir}/index.html`, appHtml)
          if (appCss) VFS.writeFile(`${appDir}/style.css`, appCss)
          if (appJs) VFS.writeFile(`${appDir}/script.js`, appJs)
          WindowManager.openApp(name, appHtml, appCss || '', appJs || '', { icon, width, height, description })
          showActivity(`💻 ${action === 'create' ? 'Created' : 'Updated'} app: ${name}`)
          return { success: true, message: `App "${name}" ${action === 'create' ? 'created and opened' : 'updated'}` }
        }
        case 'uninstall': {
          const ok = WindowManager.uninstallApp?.(name)
          if (typeof AppRegistry !== 'undefined') AppRegistry.unregister(name)
          // Clean up VFS
          const appDir = `/home/user/apps/${name}`
          if (VFS.isDir(appDir)) {
            const files = VFS.ls(appDir)
            if (files) files.forEach(f => VFS.rm(`${appDir}/${f.name}`))
            VFS.rm(appDir)
          }
          if (ok) { showActivity(`🗑️ Uninstalled: ${name}`); return { success: true } }
          return { error: `App "${name}" not found` }
        }
        case 'list': {
          if (typeof AppRegistry !== 'undefined') {
            return { apps: AppRegistry.list(a => !a.builtin && !a.ephemeral).map(a => ({ name: a.name, icon: a.icon, description: a.description || '' })) }
          }
          return { apps: WindowManager.getInstalledApps() }
        }
        default: return { error: `Unknown app action: ${action}` }
      }
    }
  })

  Capabilities.register('skill', {
    description: 'Manage skills (self-evolving tools): create, list, read, delete. Skills persist across sessions.',
    icon: '🧩',
    category: 'Apps',
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['create', 'list', 'read', 'delete'] }, name: { type: 'string' }, description: { type: 'string' }, icon: { type: 'string' }, schema: { type: 'object' }, handler: { type: 'string', description: 'JS function body. Receives (params, VFS, Shell, WindowManager).' } }, required: ['action'] },
    handler: null // Special: wired up in agent.js (needs customSkills + parseSkillMd)
  })

  Capabilities.register('dynamicapp', {
    description: 'Create and manage dynamic workbench windows. The agent writes state files and the window auto-updates. Use open to create/reopen, list to see all, close to dismiss, destroy to delete.',
    icon: '⚡',
    category: 'Apps',
    alwaysAvailable: true,
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['open', 'close', 'destroy', 'list'] }, id: { type: 'string', description: 'App id (used as directory name)' }, title: { type: 'string' }, icon: { type: 'string' }, object: { type: 'object', description: 'Initial data object' }, actions: { type: 'array', description: 'Action buttons [{id, label, icon?, style?}]' }, view: { type: 'object', description: 'View config {template: "table"|"list"|"markdown"}' } }, required: ['action'] },
    handler: ({ action, id, title, icon, object, actions, view }, ctx) => {
      switch (action) {
        case 'open': {
          if (!id) return { error: 'id is required' }
          // If already exists, reopen; otherwise create
          const p = DynamicApp.paths(id)
          if (VFS.isFile(p.meta)) return DynamicApp.open(id)
          return DynamicApp.create(id, { title, icon, object, actions, view })
        }
        case 'close': return id ? DynamicApp.close(id) : { error: 'id is required' }
        case 'destroy': return id ? DynamicApp.destroy(id) : { error: 'id is required' }
        case 'list': return { apps: DynamicApp.list() }
        default: return { error: `Unknown dynamicapp action: ${action}` }
      }
    }
  })

  // ── Knowledge ──
  // These are registered but handlers are null — they get wired up by ExternalSkills or agent.js

  console.log(`[Capabilities] ${Capabilities.count()} built-in capabilities registered`)
})()
