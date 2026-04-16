/* shell.js — AgenticShell powered by agentic-shell, backed by VFS */
const Shell = (() => {
  // VFS adapter: bridges AgenticShell's fs interface to our VFS
  const vfsAdapter = {
    async read(path) {
      const c = VFS.readFile(path)
      if (c === null) throw new Error(`ENOENT: ${path}`)
      return c
    },
    async write(path, content) {
      VFS.mkdir(path.split('/').slice(0, -1).join('/') || '/')
      VFS.writeFile(path, content)
    },
    async ls(path) {
      const items = VFS.ls(path)
      if (!items) return []
      return items.map(f => ({ name: f.name, type: f.type, size: f.type === 'file' ? (f.content?.length || 0) : 0 }))
    },
    async delete(path) { VFS.rm(path) },
    async mkdir(path) { VFS.mkdir(path) },
    async exists(path) { return VFS.exists(path) },
    async grep(pattern, path, opts) {
      const re = new RegExp(pattern)
      const results = []
      const check = (fp) => {
        const content = VFS.readFile(fp)
        if (!content) return
        content.split('\n').forEach((line, i) => { if (re.test(line)) results.push({ file: fp, line: i + 1, content: line }) })
      }
      if (VFS.isFile(path)) { check(path) }
      else if (opts?.recursive) { VFS.find(path, null).forEach(fp => { if (VFS.isFile(fp)) check(fp) }) }
      return results
    }
  }

  const agShell = AgenticShellBrowser.createBrowserShell(vfsAdapter)
  agShell.exec('cd /home/user').catch(() => {})

  // Sync wrapper (AgenticShell is async, Shell API is sync)
  function exec(command) {
    // Run async but return last result synchronously via a trick:
    // We use a shared result variable updated by the promise
    let output = ''
    const p = agShell.exec(command).then(r => { output = r.output }).catch(e => { output = `Error: ${e.message}` })
    // For terminal display, we return a promise-like that resolves
    return p.then ? p.then(r => output) : output
  }

  function getCwd() {
    return agShell.getCwd()
  }

  // Async exec for agent worker tools
  async function execAsync(command) {
    const r = await agShell.exec(command)
    return r.output
  }

  return { exec, execAsync, getCwd, _shell: agShell }
})()
