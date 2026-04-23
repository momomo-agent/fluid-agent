#!/usr/bin/env node
// DynamicApp E2E Test — runs in Node.js with minimal DOM stubs
// Tests: create → render → action dispatch → data update → IntentState routing

const fs = require('fs')
const vm = require('vm')

// ── Minimal DOM stubs ──
class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.className = ''; this.textContent = ''
    this._innerHTML = ''; this.style = new Proxy({}, { set: () => true, get: () => '' })
    this._attrs = {}; this._listeners = {}; this.parentNode = null
    this.sandbox = { contains: v => (this._attrs.sandbox || '').includes(v) }
    this.srcdoc = ''; this.contentWindow = null
  }
  get innerHTML() { return this._innerHTML }
  set innerHTML(v) { this._innerHTML = v; this.children = [] }
  setAttribute(k, v) { this._attrs[k] = v; if (k === 'sandbox') this.sandbox = { contains: s => v.includes(s) } }
  getAttribute(k) { return this._attrs[k] }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c }
  querySelector(sel) {
    const cls = sel.startsWith('.') ? sel.slice(1) : null
    for (const c of this.children) {
      if (cls && (c.className || '').includes(cls)) return c
      const f = c.querySelector?.(sel); if (f) return f
    }
    return null
  }
  querySelectorAll(sel) {
    const cls = sel.startsWith('.') ? sel.slice(1) : null
    const r = []
    const walk = el => { if (cls && (el.className || '').includes(cls)) r.push(el); (el.children || []).forEach(walk) }
    walk(this); return r
  }
  contains(el) { return this === el || this.children.some(c => c.contains(el)) }
  addEventListener(ev, fn) { this._listeners[ev] = (this._listeners[ev] || []); this._listeners[ev].push(fn) }
  removeEventListener(ev, fn) { if (this._listeners[ev]) this._listeners[ev] = this._listeners[ev].filter(f => f !== fn) }
  click() { (this._listeners.click || []).forEach(fn => fn()) }
  get classList() {
    const s = this
    return {
      add(c) { if (!(s.className || '').includes(c)) s.className += (s.className ? ' ' : '') + c },
      remove(c) { s.className = (s.className || '').replace(c, '').trim() },
    }
  }
}

const document = { createElement(tag) { return new Element(tag) } }

// ── VFS stub ──
const _vfs = {}
const _vfsListeners = []
const VFS = {
  readFile(p) { return _vfs[p] || null },
  writeFile(p, c) { _vfs[p] = c; _vfsListeners.forEach(fn => fn('write', p)) },
  mkdir(p) { _vfs[p] = '__dir__' },
  isFile(p) { return _vfs[p] !== undefined && _vfs[p] !== '__dir__' },
  isDir(p) { return _vfs[p] === '__dir__' },
  ls(p) {
    const prefix = p.endsWith('/') ? p : p + '/'
    const entries = new Map()
    for (const k of Object.keys(_vfs)) {
      if (!k.startsWith(prefix)) continue
      const rest = k.slice(prefix.length), name = rest.split('/')[0]
      if (!name) continue
      entries.set(name, { name, type: rest.includes('/') ? 'dir' : 'file' })
    }
    return [...entries.values()]
  },
  rm(p) { delete _vfs[p] },
  on(fn) { _vfsListeners.push(fn) },
  off(fn) { const i = _vfsListeners.indexOf(fn); if (i >= 0) _vfsListeners.splice(i, 1) },
}

const EventBus = { emit() {}, on() {} }
const _apps = new Map()
const AppRegistry = {
  register(a) { _apps.set(a.id, a) }, unregister(id) { _apps.delete(id) },
  has(id) { return _apps.has(id) }, get(id) { return _apps.get(id) },
}
let _nextWinId = 1
const _windows = new Map()
const WindowManager = {
  windows: _windows,
  openApp(type) {
    const id = _nextWinId++
    const body = new Element('div'); body.className = 'window-body'
    const el = new Element('div'); el.appendChild(body)
    _windows.set(id, { id, type, el })
    return id
  },
}
const _intents = []
const IntentState = { create(goal) { _intents.push(goal); return { id: `intent-${_intents.length}`, goal } } }

// ── Load DynamicApp in vm ──
const code = fs.readFileSync(__dirname + '/../dynamicapp.js', 'utf8')
const sandbox = {
  document, window: { addEventListener() {}, removeEventListener() {} },
  VFS, EventBus, AppRegistry, WindowManager, IntentState,
  MutationObserver: class { observe() {} disconnect() {} },
  ResizeObserver: class { observe() {} disconnect() {} },
  console, JSON, Map, Set, Array, Object, Date, Math, Error, TypeError,
  parseInt, parseFloat, isNaN, isFinite, undefined, Function,
}
const ctx = vm.createContext(sandbox)
vm.runInContext(code.replace('const DynamicApp =', 'var DynamicApp ='), ctx)
const DynamicApp = ctx.DynamicApp
if (!DynamicApp) { console.error('DynamicApp not defined'); process.exit(1) }

// Helper: create app and manually trigger render (WindowManager stub doesn't call renderWindow)
function createAndRender(id, opts) {
  const res = DynamicApp.create(id, opts)
  const w = _windows.get(res.winId)
  const body = w.el.querySelector('.window-body')
  DynamicApp.renderDynamicApp(id, w, body)
  return { ...res, w, body }
}

// ── Test runner ──
let passed = 0, failed = 0
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`) }
  else { failed++; console.log(`  ✗ ${msg}`) }
}

// ── Tests ──

console.log('\n1. Create + VFS state')
{
  const { id, winId } = createAndRender('counter', {
    title: 'Counter', icon: '🔢',
    object: { count: 0 },
    actions: [
      { id: 'increment', label: '+1', handler: 'local', mutate: { count: 'count + 1' } },
      { id: 'reset', label: 'Reset', handler: 'worker' },
    ],
  })
  assert(id === 'counter', 'returns id')
  assert(typeof winId === 'number', 'returns winId')
  const meta = JSON.parse(VFS.readFile('/system/dynamic-apps/counter/meta.json'))
  assert(meta.title === 'Counter', 'meta.json title')
  const obj = JSON.parse(VFS.readFile('/system/dynamic-apps/counter/object.json'))
  assert(obj.count === 0, 'object.json initial data')
  const acts = JSON.parse(VFS.readFile('/system/dynamic-apps/counter/actions.json'))
  assert(acts.length === 2, 'actions.json has 2 actions')
}

console.log('\n2. Template rendering (key-value)')
{
  const w = _windows.get(1)
  const body = w.el.querySelector('.window-body')
  assert(body.querySelector('.dapp-object') !== null, 'renders dapp-object')
  assert(body.querySelector('.dapp-actions') !== null, 'renders dapp-actions')
  const btns = body.querySelectorAll('.dapp-action-btn')
  assert(btns.length === 2, `renders 2 buttons (got ${btns.length})`)
}

console.log('\n3. Local mutate action (+1)')
{
  const w = _windows.get(1)
  const body = w.el.querySelector('.window-body')
  const btns = body.querySelectorAll('.dapp-action-btn')
  _intents.length = 0

  btns[0].click()
  const obj = JSON.parse(VFS.readFile('/system/dynamic-apps/counter/object.json'))
  assert(obj.count === 1, 'count → 1')
  assert(_intents.length === 0, 'no IntentState for local mutate')

  btns[0].click()
  const obj2 = JSON.parse(VFS.readFile('/system/dynamic-apps/counter/object.json'))
  assert(obj2.count === 2, 'count → 2')
}

console.log('\n4. Worker action → IntentState')
{
  const w = _windows.get(1)
  const body = w.el.querySelector('.window-body')
  // Re-render to pick up updated data
  DynamicApp.renderDynamicApp('counter', w, body)
  const btns = body.querySelectorAll('.dapp-action-btn')
  _intents.length = 0

  btns[1].click() // Reset (handler: 'worker')
  assert(_intents.length === 1, 'IntentState.create called')
  assert(_intents[0].includes('Reset'), 'intent mentions "Reset"')
  assert(_intents[0].includes('Counter'), 'intent mentions "Counter"')
}

console.log('\n5. Custom HTML view')
{
  const { body } = createAndRender('html-app', {
    title: 'HTML App',
    object: { value: 42 },
    actions: [{ id: 'go', label: 'Go', handler: 'worker' }],
  })
  DynamicApp.update('html-app', { html: '<div>test</div>' })
  // Re-render with HTML
  const w = _windows.get(2)
  DynamicApp.renderDynamicApp('html-app', w, body)

  const iframe = body.querySelector('.dapp-custom-frame')
  assert(iframe !== null, 'renders iframe')
  assert(iframe.srcdoc.includes('window.__object'), 'injects __object')
  assert(iframe.srcdoc.includes('window.__app'), 'injects __app bridge')
  assert(iframe.srcdoc.includes('triggerAction'), 'injects triggerAction')
  assert(iframe.srcdoc.includes('onDataUpdate'), 'injects onDataUpdate')
}

console.log('\n6. Update data')
{
  DynamicApp.update('counter', { object: { count: 99 } })
  const obj = JSON.parse(VFS.readFile('/system/dynamic-apps/counter/object.json'))
  assert(obj.count === 99, 'update writes new data')
}

console.log('\n7. Template views')
{
  // Table
  const { body: tb } = createAndRender('tbl', {
    title: 'Table',
    object: { columns: ['A', 'B'], rows: [{ A: 1, B: 2 }] },
    view: { template: 'table' },
  })
  // renderObject uses innerHTML for templates, check the object child's innerHTML
  const tobj = tb.querySelector('.dapp-object')
  assert(tobj && tobj.innerHTML.includes('dapp-table'), 'table template renders')

  // List
  const { body: lb } = createAndRender('lst', {
    title: 'List',
    object: { items: ['x', 'y', 'z'] },
    view: { template: 'list' },
  })
  const lobj = lb.querySelector('.dapp-object')
  assert(lobj && lobj.innerHTML.includes('dapp-list'), 'list template renders')
  assert(lobj && lobj.innerHTML.includes('dapp-list-item'), 'list has items')

  // Markdown
  const { body: mb } = createAndRender('mdown', {
    title: 'MD',
    object: { content: 'hello' },
    view: { template: 'markdown' },
  })
  const mobj = mb.querySelector('.dapp-object')
  assert(mobj && mobj.innerHTML.includes('dapp-markdown'), 'markdown template renders')
}

console.log('\n8. List / Close / Destroy')
{
  const list = DynamicApp.list()
  assert(list.length >= 3, `list returns ${list.length} apps`)

  DynamicApp.close('html-app')
  assert(!AppRegistry.has('dapp-html-app'), 'close unregisters')

  DynamicApp.destroy('counter')
  assert(!VFS.isFile('/system/dynamic-apps/counter/meta.json'), 'destroy removes files')

  DynamicApp.destroy('tbl')
  DynamicApp.destroy('lst')
  DynamicApp.destroy('mdown')
}

// ── Summary ──
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
