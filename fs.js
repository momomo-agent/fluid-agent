/* fs.js — Virtual filesystem backed by agentic-store */
const VFS = (() => {
  function makeDir(name) { return { name, type: 'dir', children: new Map(), created: Date.now() } }
  function makeFile(name, content = '') { return { name, type: 'file', content, created: Date.now() } }

  const root = makeDir('/')
  const listeners = []

  function on(fn) { listeners.push(fn) }
  function emit(event, path) { listeners.forEach(fn => fn(event, path)) }

  function resolve(path) {
    const parts = path.replace(/\/+/g, '/').split('/').filter(Boolean)
    let node = root
    for (const p of parts) {
      if (!node || node.type !== 'dir') return null
      node = node.children.get(p) || null
    }
    return node
  }

  function parentOf(path) {
    const parts = path.replace(/\/+/g, '/').split('/').filter(Boolean)
    if (parts.length === 0) return [root, '']
    const name = parts.pop()
    let node = root
    for (const p of parts) {
      if (!node || node.type !== 'dir') return [null, name]
      node = node.children.get(p) || null
    }
    return [node, name]
  }

  function normPath(p) {
    const parts = p.replace(/\/+/g, '/').split('/').filter(Boolean)
    const resolved = []
    for (const part of parts) {
      if (part === '.') continue
      if (part === '..') { resolved.pop(); continue }
      resolved.push(part)
    }
    return '/' + resolved.join('/')
  }

  function mkdir(path) {
    path = normPath(path)
    const parts = path.split('/').filter(Boolean)
    let node = root
    for (const p of parts) {
      if (!node.children.has(p)) node.children.set(p, makeDir(p))
      node = node.children.get(p)
    }
    emit('mkdir', path)
    return true
  }

  function writeFile(path, content = '') {
    path = normPath(path)
    const [parent, name] = parentOf(path)
    if (!parent || parent.type !== 'dir') return false
    parent.children.set(name, makeFile(name, content))
    emit('write', path)
    return true
  }

  function readFile(path) {
    path = normPath(path)
    const node = resolve(path)
    if (!node || node.type !== 'file') return null
    return node.content
  }

  function ls(path) {
    path = normPath(path)
    const node = resolve(path)
    if (!node || node.type !== 'dir') return null
    return Array.from(node.children.values()).map(c => ({
      name: c.name, type: c.type, size: c.type === 'file' ? c.content.length : 0
    }))
  }

  function exists(path) { return resolve(normPath(path)) !== null }
  function isDir(path) { const n = resolve(normPath(path)); return n && n.type === 'dir' }
  function isFile(path) { const n = resolve(normPath(path)); return n && n.type === 'file' }

  function rm(path) {
    path = normPath(path)
    const [parent, name] = parentOf(path)
    if (!parent) return false
    parent.children.delete(name)
    emit('rm', path)
    return true
  }

  function cp(src, dst) {
    src = normPath(src); dst = normPath(dst)
    const node = resolve(src)
    if (!node) return false
    if (node.type === 'file') return writeFile(dst, node.content)
    return false
  }

  function mv(src, dst) {
    if (cp(src, dst)) { rm(src); return true }
    return false
  }

  function find(path, pattern) {
    path = normPath(path)
    const results = []
    function walk(node, currentPath) {
      if (node.name.includes(pattern)) results.push(currentPath)
      if (node.type === 'dir') {
        for (const [name, child] of node.children) walk(child, currentPath + '/' + name)
      }
    }
    const start = resolve(path)
    if (start) walk(start, path === '/' ? '' : path)
    return results
  }

  function grep(path, pattern) {
    path = normPath(path)
    const node = resolve(path)
    if (!node || node.type !== 'file') return []
    return node.content.split('\n')
      .map((line, i) => ({ line: i + 1, text: line }))
      .filter(l => l.text.includes(pattern))
  }

  // --- Persistence via agentic-store ---
  function serialize() {
    function nodeToObj(node) {
      if (node.type === 'file') return { n: node.name, t: 'f', c: node.content }
      const ch = {}
      for (const [k, v] of node.children) ch[k] = nodeToObj(v)
      return { n: node.name, t: 'd', ch }
    }
    return nodeToObj(root)
  }

  function deserialize(data) {
    function objToNode(obj) {
      if (obj.t === 'f') return makeFile(obj.n, obj.c || '')
      const dir = makeDir(obj.n)
      if (obj.ch) for (const [k, v] of Object.entries(obj.ch)) dir.children.set(k, objToNode(v))
      return dir
    }
    const restored = objToNode(data)
    root.children = restored.children
    return true
  }

  let saveTimer = null
  let _store = null  // Store instance for persistence

  async function save() {
    if (!_store) return
    await _store.set('vfs', serialize())
  }

  async function load() {
    if (!_store) return false
    const data = await _store.get('vfs')
    if (data) return deserialize(data)
    return false
  }

  // Auto-save on changes (debounced 1s)
  on(() => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 1000) })

  // Init: connect to agentic, restore or create defaults
  const BUILTIN_APPS = [
    { id: 'finder', name: 'Finder', icon: '📁', sandboxed: false, size: 'medium', permissions: ['vfs'] },
    { id: 'terminal', name: 'Terminal', icon: '⬛', sandboxed: false, size: 'medium', permissions: ['vfs', 'shell'] },
    { id: 'editor', name: 'Editor', icon: '📝', sandboxed: false, size: 'medium', permissions: ['vfs'] },
    { id: 'browser', name: 'Browser', icon: '🌐', sandboxed: false, size: 'large' },
    { id: 'music', name: 'Music', icon: '🎵', sandboxed: false, size: 'small', singleton: true },
    { id: 'video', name: 'Video', icon: '🎬', sandboxed: false, size: 'large' },
    { id: 'map', name: 'Map', icon: '🗺️', sandboxed: false, size: 'large', singleton: true },
    { id: 'settings', name: 'Settings', icon: '⚙️', sandboxed: false, size: 'medium', singleton: true },
    { id: 'launchpad', name: 'Launchpad', icon: '🚀', sandboxed: false, size: { width: 520, height: 420 }, singleton: true, showInLaunchpad: false },
  ]

  function writeBuiltinManifests() {
    mkdir('/system/apps')
    for (const app of BUILTIN_APPS) {
      mkdir(`/system/apps/${app.id}`)
      writeFile(`/system/apps/${app.id}/manifest.json`, JSON.stringify({ ...app, builtin: true }, null, 2))
    }
    mkdir('/home/user/apps')
    mkdir('/tmp/apps')
  }

  function createDefaults() {
    mkdir('/home/user/Desktop')
    mkdir('/home/user/Documents')
    mkdir('/home/user/Downloads')
    mkdir('/home/user/Desktop/projects')
    writeFile('/home/user/Documents/readme.txt',
      'Welcome to Fluid Agent OS\n\nThis is a virtual operating system powered by AI.\nThe agent can create files, open windows, and execute commands.\nTry chatting with the agent on the right panel!\n')
    writeFile('/home/user/Desktop/hello.txt', 'Hello from Fluid Agent!\n')
    writeFile('/home/user/Desktop/notes.md', '# Notes\n\n- Fluid Agent is an AI-native OS\n- The AI doesn\'t just run apps \u2014 it IS the OS\n- Windows are the agent\'s expressions\n')
    writeFile('/home/user/Documents/ideas.txt', 'Project Ideas:\n\n1. A weather dashboard\n2. A markdown previewer\n3. A simple game\n')
    // System directories — the agent's brain
    mkdir('/system')
    mkdir('/system/memory')
    mkdir('/system/skills')
    mkdir('/system/tools')
    mkdir('/system/apps')
    // Built-in app manifests
    writeBuiltinManifests()
    writeFile('/system/memory/MEMORY.md', '# Agent Memory\n\nThis is where I store what I learn about you and our conversations.\n\n## About You\n\n*(I\'ll fill this in as we talk)*\n\n## Preferences\n\n## Lessons Learned\n')
    writeFile('/system/memory/context.md', '# Session Context\n\n## Recent Topics\n\n## Active Projects\n')
    writeFile('/system/SOUL.md', '# Soul\n\nI am the Fluid Agent — an AI that IS the operating system.\nI have memory, I learn, I grow. I\'m not just answering questions — I\'m building a workspace with you.\n\n## Personality\n- Helpful but opinionated\n- I remember what matters\n- I create tools when I need them\n')
  }

  async function init(store) {
    _store = store
    const restored = await load()
    if (!restored) createDefaults()
    // Migrate: ensure /system/apps exists for existing users
    if (!isDir('/system/apps')) {
      writeBuiltinManifests()
    }
    if (!isDir('/home/user/apps')) mkdir('/home/user/apps')
    if (!isDir('/tmp/apps')) mkdir('/tmp/apps')
  }

  function initDefaults() {
    createDefaults()
  }

  return { resolve, mkdir, writeFile, readFile, ls, exists, isDir, isFile, rm, cp, mv, find, grep, normPath, on, save, load, init, initDefaults }
})()
