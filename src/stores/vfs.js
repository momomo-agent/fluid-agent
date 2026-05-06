import { defineStore } from 'pinia'
import { reactive, watch } from 'vue'

const STORAGE_KEY = 'fluid-vfs'
let _saveTimer = null

// In-memory virtual filesystem with localStorage persistence
export const useVFSStore = defineStore('vfs', () => {
  const tree = reactive({})
  const listeners = []

  function on(fn) { listeners.push(fn); return fn }
  function off(fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1) }
  function emit(event, path) { listeners.forEach(fn => fn(event, path)) }

  function _resolve(path) {
    const parts = path.split('/').filter(Boolean)
    let node = tree
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]] || typeof node[parts[i]] !== 'object' || node[parts[i]].__file) return null
      node = node[parts[i]]
    }
    return { parent: node, name: parts[parts.length - 1] }
  }

  function mkdir(path) {
    const parts = path.split('/').filter(Boolean)
    let node = tree
    for (const p of parts) {
      if (!node[p]) node[p] = {}
      else if (node[p].__file) return false
      node = node[p]
    }
    emit('mkdir', normPath(path))
    _scheduleSave()
    return true
  }

  function writeFile(path, content) {
    const parts = path.split('/').filter(Boolean)
    let node = tree
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]]) node[parts[i]] = {}
      node = node[parts[i]]
    }
    node[parts[parts.length - 1]] = { __file: true, content, modified: Date.now() }
    emit('write', normPath(path))
    _scheduleSave()
    return true
  }

  function readFile(path) {
    const r = _resolve(path)
    if (!r) return null
    const f = r.parent[r.name]
    return f?.__file ? f.content : null
  }

  function isFile(path) {
    const r = _resolve(path)
    if (!r) return false
    return !!r.parent[r.name]?.__file
  }

  function isDir(path) {
    const parts = path.split('/').filter(Boolean)
    let node = tree
    for (const p of parts) {
      if (!node[p] || node[p].__file) return false
      node = node[p]
    }
    return true
  }

  function exists(path) {
    return isFile(path) || isDir(path)
  }

  function ls(path) {
    const parts = path.split('/').filter(Boolean)
    let node = tree
    for (const p of parts) {
      if (!node[p] || node[p].__file) return []
      node = node[p]
    }
    return Object.entries(node)
      .filter(([k]) => !k.startsWith('__'))
      .map(([name, val]) => ({
        name,
        type: val.__file ? 'file' : 'dir',
        size: val.__file ? (val.content?.length || 0) : 0
      }))
  }

  function rm(path, recursive = false) {
    const r = _resolve(path)
    if (!r) return false
    const target = r.parent[r.name]
    if (!target) return false
    if (!target.__file && !recursive) return false
    delete r.parent[r.name]
    emit('rm', normPath(path))
    _scheduleSave()
    return true
  }

  function cp(src, dst) {
    src = normPath(src); dst = normPath(dst)
    const content = readFile(src)
    if (content === null) return false
    return writeFile(dst, content)
  }

  function mv(src, dst) {
    if (cp(src, dst)) { rm(src); return true }
    return false
  }

  function grep(path, pattern) {
    path = normPath(path)
    const content = readFile(path)
    if (!content) return []
    return content.split('\n')
      .map((line, i) => ({ line: i + 1, text: line }))
      .filter(l => l.text.includes(pattern))
  }

  function normPath(p) {
    return '/' + p.split('/').filter(Boolean).join('/')
  }

  function find(basePath, query) {
    const results = []
    function scan(path) {
      const entries = ls(path) || []
      for (const e of entries) {
        const full = path === '/' ? `/${e.name}` : `${path}/${e.name}`
        if (!query || e.name.includes(query)) results.push(full)
        if (e.type === 'dir' && results.length < 200) scan(full)
      }
    }
    scan(basePath)
    return results
  }

  // ── Persistence ──

  function serialize() {
    function nodeToObj(node) {
      if (node.__file) return { t: 'f', c: node.content }
      const ch = {}
      for (const [k, v] of Object.entries(node)) {
        if (k.startsWith('__')) continue
        ch[k] = nodeToObj(v)
      }
      return { t: 'd', ch }
    }
    return nodeToObj(tree)
  }

  function deserialize(data) {
    function objToNode(obj) {
      if (obj.t === 'f') return { __file: true, content: obj.c || '', modified: Date.now() }
      const dir = {}
      if (obj.ch) {
        for (const [k, v] of Object.entries(obj.ch)) {
          dir[k] = objToNode(v)
        }
      }
      return dir
    }
    const restored = objToNode(data)
    // Clear tree and copy restored data
    for (const k of Object.keys(tree)) delete tree[k]
    for (const [k, v] of Object.entries(restored)) tree[k] = v
    return true
  }

  function save() {
    try {
      const data = serialize()
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch (e) {
      console.warn('[VFS] Save failed:', e)
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw)
        return deserialize(data)
      }
    } catch (e) {
      console.warn('[VFS] Load failed:', e)
    }
    return false
  }

  function _scheduleSave() {
    clearTimeout(_saveTimer)
    _saveTimer = setTimeout(save, 1000)
  }

  // Initialize default filesystem
  function createDefaults() {
    mkdir('/home/user')
    mkdir('/home/user/Desktop')
    mkdir('/home/user/Desktop/projects')
    mkdir('/home/user/Documents')
    mkdir('/home/user/Downloads')
    mkdir('/home/user/apps')
    mkdir('/tmp')
    mkdir('/tmp/apps')
    mkdir('/system')
    mkdir('/system/memory')
    mkdir('/system/skills')
    mkdir('/system/tools')
    mkdir('/system/apps')
    mkdir('/system/dynamic-apps')
    mkdir('/proc')
    mkdir('/proc/workers')
    mkdir('/proc/scheduler')

    // Default files
    writeFile('/home/user/Documents/readme.txt',
      'Welcome to Fluid Agent OS\n\nThis is a virtual operating system powered by AI.\nThe agent can create files, open windows, and execute commands.\nTry chatting with the agent!\n')
    writeFile('/home/user/Desktop/hello.txt', 'Hello from Fluid Agent!\n')
    writeFile('/home/user/Desktop/notes.md', '# Notes\n\n- Fluid Agent is an AI-native OS\n- The AI doesn\'t just run apps — it IS the OS\n- Windows are the agent\'s expressions\n')
    writeFile('/home/user/Documents/ideas.txt', 'Project Ideas:\n\n1. A weather dashboard\n2. A markdown previewer\n3. A simple game\n')

    // System files
    writeFile('/system/memory/MEMORY.md', '# Agent Memory\n\nThis is where I store what I learn about you and our conversations.\n\n## About You\n\n*(I\'ll fill this in as we talk)*\n\n## Preferences\n\n## Lessons Learned\n')
    writeFile('/system/memory/context.md', '# Session Context\n\n## Recent Topics\n\n## Active Projects\n')
    writeFile('/system/SOUL.md', '# Soul\n\nI am the Fluid Agent — an AI that IS the operating system.\nI have memory, I learn, I grow. I\'m not just answering questions — I\'m building a workspace with you.\n\n## Personality\n- Helpful but opinionated\n- I remember what matters\n- I create tools when I need them\n')

    // Built-in app manifests
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
    for (const app of BUILTIN_APPS) {
      mkdir(`/system/apps/${app.id}`)
      writeFile(`/system/apps/${app.id}/manifest.json`, JSON.stringify({ ...app, builtin: true }, null, 2))
    }
  }

  function init() {
    const restored = load()
    if (!restored) {
      createDefaults()
    } else {
      // Ensure critical dirs exist even after restore
      if (!isDir('/system/apps')) createDefaults()
      if (!isDir('/home/user/apps')) mkdir('/home/user/apps')
      if (!isDir('/tmp/apps')) mkdir('/tmp/apps')
      if (!isDir('/system/dynamic-apps')) mkdir('/system/dynamic-apps')
      if (!isDir('/proc')) mkdir('/proc')
      if (!isDir('/proc/workers')) mkdir('/proc/workers')
      if (!isDir('/proc/scheduler')) mkdir('/proc/scheduler')
    }
  }

  function reset() {
    for (const k of Object.keys(tree)) delete tree[k]
    localStorage.removeItem(STORAGE_KEY)
    createDefaults()
  }

  init()

  return {
    tree, mkdir, writeFile, readFile, isFile, isDir, exists, ls, rm,
    cp, mv, grep, normPath, find, on, off,
    save, load, reset, serialize, deserialize
  }
})
