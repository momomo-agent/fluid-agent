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

  // Initialize default filesystem
  function init() {
    mkdir('/home/user')
    mkdir('/home/user/Desktop')
    mkdir('/home/user/Documents')
    mkdir('/home/user/Downloads')
    mkdir('/tmp')
    mkdir('/tmp/apps')
    mkdir('/system')
    mkdir('/system/skills')
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
