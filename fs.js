/* fs.js — In-memory virtual filesystem */
const VFS = (() => {
  // Node: { name, type: 'dir'|'file', children: Map, content: string, created: number }
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
      if (!node.children.has(p)) {
        node.children.set(p, makeDir(p))
      }
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
    return false // skip dir copy for now
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
        for (const [name, child] of node.children) {
          walk(child, currentPath + '/' + name)
        }
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

  // Initialize default structure
  mkdir('/home/user/Desktop')
  mkdir('/home/user/Documents')
  mkdir('/home/user/Downloads')
  writeFile('/home/user/Documents/readme.txt',
    'Welcome to Fluid Agent OS\n\nThis is a virtual operating system powered by AI.\nThe agent can create files, open windows, and execute commands.\nTry chatting with the agent on the right panel!\n\nTip: You can interrupt the agent at any time — it will respond immediately.\n')
  writeFile('/home/user/Desktop/hello.txt', 'Hello from Fluid Agent!\n')

  return { resolve, mkdir, writeFile, readFile, ls, exists, isDir, isFile, rm, cp, mv, find, grep, normPath, on }
})()
