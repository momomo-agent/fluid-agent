import { ref } from 'vue'
import { getAgenticShell } from '../lib/agentic.js'
import { useVFSStore } from '../stores/vfs.js'

let _shell = null
const cwd = ref('/home/user')
const history = ref([])

function getShell() {
  if (_shell) return _shell
  const vfs = useVFSStore()
  const AgenticShellBrowser = getAgenticShell()
  if (!AgenticShellBrowser) return null

  const vfsAdapter = {
    async read(path) {
      const c = vfs.readFile(path)
      if (c === null) throw new Error(`ENOENT: ${path}`)
      return c
    },
    async write(path, content) {
      vfs.mkdir(path.split('/').slice(0, -1).join('/') || '/')
      vfs.writeFile(path, content)
    },
    async ls(path) {
      const items = vfs.ls(path)
      if (!items) return []
      return items.map(f => ({ name: f.name, type: f.type, size: f.type === 'file' ? (f.content?.length || 0) : 0 }))
    },
    async delete(path) { vfs.rm(path) },
    async mkdir(path) { vfs.mkdir(path) },
    async exists(path) { return vfs.isFile(path) || vfs.isDir(path) },
    async grep(pattern, path, opts) {
      const re = new RegExp(pattern)
      const results = []
      const check = (fp) => {
        const content = vfs.readFile(fp)
        if (!content) return
        content.split('\n').forEach((line, i) => {
          if (re.test(line)) results.push({ file: fp, line: i + 1, content: line })
        })
      }
      if (vfs.isFile(path)) check(path)
      return results
    }
  }

  _shell = AgenticShellBrowser.createBrowserShell(vfsAdapter)
  _shell.exec('cd /home/user').catch(() => {})
  return _shell
}

export function useShell() {
  async function execAsync(command) {
    const shell = getShell()
    if (!shell) {
      // Fallback: basic built-in commands
      return execBuiltin(command)
    }
    history.value.push(command)
    const r = await shell.exec(command)
    cwd.value = shell.getCwd()
    return r.output
  }

  function getCwd() {
    const shell = getShell()
    return shell ? shell.getCwd() : cwd.value
  }

  function getHistory() { return history.value }

  function cd(path) {
    const shell = getShell()
    if (shell) {
      shell.exec(`cd ${path}`).then(() => { cwd.value = shell.getCwd() })
    }
  }

  return { execAsync, getCwd, getHistory, cd, cwd }
}

function execBuiltin(command) {
  const cmd = command.trim()
  if (cmd === 'clear') return '\x1bclear'
  if (cmd === 'help') return 'Available: clear, help, echo, date, whoami, pwd, ls'
  if (cmd === 'date') return new Date().toString()
  if (cmd === 'whoami') return 'user@fluid-os'
  if (cmd === 'pwd') return '/home/user'
  if (cmd.startsWith('echo ')) return cmd.slice(5)
  return `command not found: ${cmd}`
}
