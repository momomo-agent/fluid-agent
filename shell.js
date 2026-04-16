/* shell.js — Lightweight virtual shell */
const Shell = (() => {
  let cwd = '/home/user'
  const history = []

  function resolvePath(p) {
    if (p.startsWith('~')) p = '/home/user' + p.slice(1)
    if (!p.startsWith('/')) p = cwd + '/' + p
    return VFS.normPath(p)
  }

  function exec(input) {
    input = input.trim()
    if (!input) return ''
    history.push(input)

    // Parse pipes
    if (input.includes('|')) {
      const parts = input.split('|').map(s => s.trim())
      let output = ''
      for (const part of parts) {
        output = execSingle(part, output)
      }
      return output
    }
    return execSingle(input)
  }

  function execSingle(input, stdin = '') {
    const tokens = tokenize(input)
    if (tokens.length === 0) return ''
    const cmd = tokens[0]
    const args = tokens.slice(1)

    switch (cmd) {
      case 'pwd': return cwd
      case 'cd': return cmdCd(args)
      case 'ls': return cmdLs(args)
      case 'cat': return cmdCat(args, stdin)
      case 'echo': return args.join(' ')
      case 'mkdir': return cmdMkdir(args)
      case 'touch': return cmdTouch(args)
      case 'rm': return cmdRm(args)
      case 'cp': return cmdCp(args)
      case 'mv': return cmdMv(args)
      case 'head': return cmdHead(args, stdin)
      case 'tail': return cmdTail(args, stdin)
      case 'wc': return cmdWc(args, stdin)
      case 'grep': return cmdGrep(args, stdin)
      case 'find': return cmdFind(args)
      case 'clear': return '\x1bclear'
      case 'whoami': return 'user'
      case 'date': return new Date().toLocaleString()
      case 'uname': return 'FluidOS 1.0'
      default: return `${cmd}: command not found`
    }
  }

  function tokenize(input) {
    const tokens = []
    let current = ''
    let inQuote = null
    for (const ch of input) {
      if (inQuote) {
        if (ch === inQuote) { inQuote = null; continue }
        current += ch
      } else if (ch === '"' || ch === "'") {
        inQuote = ch
      } else if (ch === ' ' || ch === '\t') {
        if (current) { tokens.push(current); current = '' }
      } else {
        current += ch
      }
    }
    if (current) tokens.push(current)
    return tokens
  }

  function cmdCd(args) {
    const target = args[0] || '/home/user'
    const path = resolvePath(target)
    if (!VFS.isDir(path)) return `cd: ${target}: No such directory`
    cwd = path
    return ''
  }

  function cmdLs(args) {
    const flags = args.filter(a => a.startsWith('-'))
    const target = args.find(a => !a.startsWith('-')) || '.'
    const path = resolvePath(target)
    const items = VFS.ls(path)
    if (!items) return `ls: ${target}: No such directory`
    if (items.length === 0) return ''
    const long = flags.includes('-l') || flags.includes('-la')
    if (long) {
      return items.map(i => {
        const type = i.type === 'dir' ? 'd' : '-'
        const size = String(i.size).padStart(6)
        return `${type}rw-r--r--  ${size}  ${i.name}${i.type === 'dir' ? '/' : ''}`
      }).join('\n')
    }
    return items.map(i => i.name + (i.type === 'dir' ? '/' : '')).join('  ')
  }

  function cmdCat(args, stdin) {
    if (args.length === 0 && stdin) return stdin
    return args.map(a => {
      const content = VFS.readFile(resolvePath(a))
      return content !== null ? content : `cat: ${a}: No such file`
    }).join('\n')
  }

  function cmdMkdir(args) {
    for (const a of args) {
      if (a === '-p') continue
      VFS.mkdir(resolvePath(a))
    }
    return ''
  }

  function cmdTouch(args) {
    for (const a of args) {
      const path = resolvePath(a)
      if (!VFS.exists(path)) VFS.writeFile(path, '')
    }
    return ''
  }

  function cmdRm(args) {
    const files = args.filter(a => !a.startsWith('-'))
    for (const f of files) VFS.rm(resolvePath(f))
    return ''
  }

  function cmdCp(args) {
    if (args.length < 2) return 'cp: missing operand'
    VFS.cp(resolvePath(args[0]), resolvePath(args[1]))
    return ''
  }

  function cmdMv(args) {
    if (args.length < 2) return 'mv: missing operand'
    VFS.mv(resolvePath(args[0]), resolvePath(args[1]))
    return ''
  }

  function cmdHead(args, stdin) {
    let n = 10
    const ni = args.indexOf('-n')
    if (ni !== -1) n = parseInt(args[ni + 1]) || 10
    const file = args.find(a => !a.startsWith('-') && !/^\d+$/.test(a))
    const text = file ? (VFS.readFile(resolvePath(file)) || '') : stdin
    return text.split('\n').slice(0, n).join('\n')
  }

  function cmdTail(args, stdin) {
    let n = 10
    const ni = args.indexOf('-n')
    if (ni !== -1) n = parseInt(args[ni + 1]) || 10
    const file = args.find(a => !a.startsWith('-') && !/^\d+$/.test(a))
    const text = file ? (VFS.readFile(resolvePath(file)) || '') : stdin
    return text.split('\n').slice(-n).join('\n')
  }

  function cmdWc(args, stdin) {
    const file = args.find(a => !a.startsWith('-'))
    const text = file ? (VFS.readFile(resolvePath(file)) || '') : stdin
    const lines = text ? text.split('\n').length : 0
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0
    const chars = text ? text.length : 0
    return `  ${lines}  ${words}  ${chars}`
  }

  function cmdGrep(args, stdin) {
    if (args.length === 0) return 'grep: missing pattern'
    const pattern = args[0]
    const file = args[1]
    if (file) {
      const results = VFS.grep(resolvePath(file), pattern)
      return results.map(r => `${r.line}:${r.text}`).join('\n')
    }
    if (stdin) {
      return stdin.split('\n').filter(l => l.includes(pattern)).join('\n')
    }
    return ''
  }

  function cmdFind(args) {
    const dir = args[0] || '.'
    const ni = args.indexOf('-name')
    const pattern = ni !== -1 ? args[ni + 1] : ''
    if (!pattern) return VFS.find(resolvePath(dir), '').join('\n')
    return VFS.find(resolvePath(dir), pattern).join('\n')
  }

  return { exec, getCwd: () => cwd, getHistory: () => history, resolvePath }
})()
