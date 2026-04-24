import { useCapabilitiesStore } from '../stores/capabilities.js'
import { EventBus } from './useEventBus.js'

export function registerCapabilities() {
  const caps = useCapabilitiesStore()

  // ── Core: always available ──

  caps.register('fs', {
    description: 'File system operations: write, read, list, or mkdir',
    icon: '📁', category: 'Core', alwaysAvailable: true,
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['write', 'read', 'list', 'mkdir'] }, path: { type: 'string' }, content: { type: 'string' } }, required: ['action', 'path'] },
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
    description: 'Open a built-in app: finder, editor, terminal, image, browser, map, music',
    icon: '🪟', category: 'Window & Desktop',
    schema: { type: 'object', properties: { target: { type: 'string', enum: ['finder', 'editor', 'terminal', 'image', 'browser', 'map', 'music'] }, path: { type: 'string' }, url: { type: 'string' }, src: { type: 'string' }, title: { type: 'string' } }, required: ['target'] },
    handler: ({ target, path, url, src, title }, ctx) => {
      ctx.EventBus.emit('window.open', { type: target, path, url, src, title })
      ctx.showActivity(`Opened ${target}`)
      return { success: true }
    }
  })

  caps.register('window', {
    description: 'Window management: close, minimize, maximize, focus, list, tile',
    icon: '🖥️', category: 'Window & Desktop',
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['close', 'minimize', 'maximize', 'focus', 'list', 'tile'] }, title: { type: 'string' } }, required: ['action'] },
    handler: ({ action, title }, ctx) => {
      const wm = ctx.WindowManager
      switch (action) {
        case 'close': wm.closeByTitle(title); ctx.showActivity(`Closed: ${title}`); break
        case 'minimize': { const w = wm.windowList.find(w => w.title === title); if (w) wm.minimize(w.id); break }
        case 'maximize': { const w = wm.windowList.find(w => w.title === title); if (w) wm.toggleMaximize(w.id); break }
        case 'focus': { const w = wm.windowList.find(w => w.title === title); if (w) wm.focus(w.id); break }
        case 'list': return { windows: wm.windowList.map(w => ({ id: w.id, title: w.title, type: w.type })) }
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
      ctx.EventBus.emit('wallpaper.change', { css, url, preset })
      ctx.showActivity('🎨 Wallpaper changed')
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
    description: 'Control the active browser page: snapshot, click, type, extract, eval',
    icon: '🕹️', category: 'Web',
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['snapshot', 'click', 'type', 'extract', 'eval'] }, ref: { type: 'string' }, text: { type: 'string' }, code: { type: 'string' } }, required: ['action'] },
    handler: ({ action, ref, text, code }, ctx) => {
      // Simplified — full implementation would use iframe postMessage
      return { error: 'Browser control not yet implemented in Vue version' }
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

  // ── Maps ──

  caps.register('map', {
    description: 'Map operations: open, add markers, show routes, clear',
    icon: '🗺️', category: 'Maps',
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['open', 'marker', 'clear_markers', 'route', 'clear_route'] }, lat: { type: 'number' }, lng: { type: 'number' }, label: { type: 'string' }, color: { type: 'string' }, zoom: { type: 'number' } }, required: ['action'] },
    handler: ({ action, lat, lng, label, color, zoom }, ctx) => {
      ctx.EventBus.emit('window.open', { type: 'map', lat, lng, zoom })
      if (action === 'marker') ctx.EventBus.emit('map.marker', { lat, lng, label, color })
      else if (action === 'clear_markers') ctx.EventBus.emit('map.clearMarkers')
      else if (action === 'route') ctx.EventBus.emit('map.route', arguments[0])
      else if (action === 'clear_route') ctx.EventBus.emit('map.clearRoute')
      return { success: true }
    }
  })

  // ── Apps & Skills ──

  caps.register('app', {
    description: 'Manage generative apps: create, update, uninstall, list',
    icon: '💻', category: 'Apps', alwaysAvailable: true,
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['create', 'update', 'uninstall', 'list'] }, name: { type: 'string' }, html: { type: 'string' }, css: { type: 'string' }, js: { type: 'string' }, icon: { type: 'string' }, width: { type: 'number' }, height: { type: 'number' } }, required: ['action'] },
    handler: ({ action, name, html, css, js, icon, width, height }, ctx) => {
      const { VFS, showActivity } = ctx
      switch (action) {
        case 'create': case 'update': {
          const appDir = `/home/user/apps/${name}`
          VFS.mkdir(appDir)
          const manifest = { id: name, name, icon: icon || '💻', size: { width: width || 420, height: height || 360 } }
          VFS.writeFile(`${appDir}/manifest.json`, JSON.stringify(manifest, null, 2))
          if (html) VFS.writeFile(`${appDir}/index.html`, html)
          if (css) VFS.writeFile(`${appDir}/style.css`, css)
          if (js) VFS.writeFile(`${appDir}/script.js`, js)
          ctx.EventBus.emit('window.open', { type: 'dynamicapp', data: { name, appDir } })
          showActivity(`💻 ${action === 'create' ? 'Created' : 'Updated'} app: ${name}`)
          return { success: true }
        }
        case 'uninstall': {
          const appDir = `/home/user/apps/${name}`
          if (VFS.isDir(appDir)) VFS.rm(appDir, true)
          showActivity(`🗑️ Uninstalled: ${name}`)
          return { success: true }
        }
        case 'list': {
          const dirs = VFS.ls('/home/user/apps')
          return { apps: (dirs || []).filter(d => d.type === 'dir').map(d => ({ name: d.name })) }
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
