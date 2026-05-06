import { defineStore } from 'pinia'
import { reactive } from 'vue'

// In-memory virtual filesystem
export const useVFSStore = defineStore('vfs', () => {
  const tree = reactive({})

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
    return true
  }

  // Initialize default filesystem with content (aligned with legacy)
  function init() {
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
  }

  init()

  function normPath(p) {
    return '/' + p.split('/').filter(Boolean).join('/')
  }

  function find(basePath, query) {
    const results = []
    function scan(path) {
      const entries = ls(path) || []
      for (const e of entries) {
        const full = path === '/' ? `/${e.name}` : `${path}/${e.name}`
        results.push(full)
        if (e.type === 'dir' && results.length < 200) scan(full)
      }
    }
    scan(basePath)
    return results
  }

  return { tree, mkdir, writeFile, readFile, isFile, isDir, ls, rm, init, normPath, find }
})
