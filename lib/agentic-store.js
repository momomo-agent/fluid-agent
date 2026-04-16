/**
 * agentic-store — Key-value persistence for agentic apps
 * SQLite-first. Browser (sql.js/WASM) + Node.js (better-sqlite3).
 *
 * Usage:
 *   import { createStore } from 'agentic-store'
 *
 *   const store = await createStore('my-app')
 *   await store.set('key', { any: 'data' })
 *   const data = await store.get('key')
 *   await store.delete('key')
 *   await store.keys()
 *   await store.clear()
 *
 * Also exposes raw SQL for advanced use:
 *   store.exec('CREATE TABLE IF NOT EXISTS items (id TEXT, data JSON)')
 *   store.run('INSERT INTO items VALUES (?, ?)', [id, json])
 *   store.all('SELECT * FROM items WHERE id = ?', [id])
 *
 * Backends:
 *   'sqlite-wasm' — Browser (sql.js), persists to IndexedDB
 *   'sqlite-native' — Node.js (better-sqlite3), persists to file
 *   'sqlite-memory' — In-memory SQLite (testing)
 *   'ls' — localStorage fallback (no SQLite available)
 *   'mem' — Plain JS Map (last resort)
 *   'custom' — Bring your own { get, set, delete, keys, clear, has }
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else if (typeof define === 'function' && define.amd) define(factory)
  else root.AgenticStore = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const KV_TABLE = '_kv'
  const KV_DDL = `CREATE TABLE IF NOT EXISTS ${KV_TABLE} (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)`

  // ── SQLite WASM backend (browser, sql.js) ────────────────────────

  function sqliteWasmBackend(name) {
    let db = null
    let SQL = null
    const IDB_KEY = 'agentic-store-' + name

    async function _idbLoad() {
      return new Promise((resolve) => {
        try {
          const req = indexedDB.open(IDB_KEY, 1)
          req.onupgradeneeded = () => req.result.createObjectStore('db')
          req.onsuccess = () => {
            const tx = req.result.transaction('db', 'readonly')
            const get = tx.objectStore('db').get('data')
            get.onsuccess = () => { req.result.close(); resolve(get.result || null) }
            get.onerror = () => { req.result.close(); resolve(null) }
          }
          req.onerror = () => resolve(null)
        } catch { resolve(null) }
      })
    }

    async function _idbSave() {
      if (!db) return
      const data = db.export()
      return new Promise((resolve) => {
        try {
          const req = indexedDB.open(IDB_KEY, 1)
          req.onupgradeneeded = () => req.result.createObjectStore('db')
          req.onsuccess = () => {
            const tx = req.result.transaction('db', 'readwrite')
            tx.objectStore('db').put(data, 'data')
            tx.oncomplete = () => { req.result.close(); resolve() }
            tx.onerror = () => { req.result.close(); resolve() }
          }
          req.onerror = () => resolve()
        } catch { resolve() }
      })
    }

    let _saveTimer = null
    function _debounceSave() {
      if (_saveTimer) clearTimeout(_saveTimer)
      _saveTimer = setTimeout(() => { _idbSave(); _saveTimer = null }, 300)
    }

    return {
      async init() {
        if (!SQL) {
          // sql.js must be loaded externally (CDN or bundled)
          if (typeof initSqlJs === 'function') {
            SQL = await initSqlJs()
          } else if (typeof root !== 'undefined' && root.initSqlJs) {
            SQL = await root.initSqlJs()
          } else {
            throw new Error('sql.js not found. Load it via <script src="https://sql.js.org/dist/sql-wasm.js"> or import.')
          }
        }
        const saved = await _idbLoad()
        db = saved ? new SQL.Database(saved) : new SQL.Database()
        db.run(KV_DDL)
      },
      exec(sql, params) { db.run(sql, params); _debounceSave() },
      run(sql, params) { db.run(sql, params); _debounceSave() },
      all(sql, params) {
        const stmt = db.prepare(sql)
        if (params) stmt.bind(params)
        const rows = []
        while (stmt.step()) rows.push(stmt.getAsObject())
        stmt.free()
        return rows
      },
      get(sql, params) {
        const rows = this.all(sql, params)
        return rows.length > 0 ? rows[0] : undefined
      },

      // KV convenience
      async kvGet(key) {
        const row = this.get(`SELECT value FROM ${KV_TABLE} WHERE key = ?`, [key])
        if (!row) return undefined
        try { return JSON.parse(row.value) } catch { return row.value }
      },
      async kvSet(key, value) {
        this.run(
          `INSERT OR REPLACE INTO ${KV_TABLE} (key, value, updated_at) VALUES (?, ?, ?)`,
          [key, JSON.stringify(value), Date.now()]
        )
      },
      async kvDelete(key) { this.run(`DELETE FROM ${KV_TABLE} WHERE key = ?`, [key]) },
      async kvKeys() { return this.all(`SELECT key FROM ${KV_TABLE}`).map(r => r.key) },
      async kvClear() { this.run(`DELETE FROM ${KV_TABLE}`) },
      async kvHas(key) {
        const row = this.get(`SELECT 1 FROM ${KV_TABLE} WHERE key = ?`, [key])
        return !!row
      },
      async flush() { await _idbSave() },
      async close() {
        if (_saveTimer) { clearTimeout(_saveTimer); await _idbSave() }
        if (db) { db.close(); db = null }
      },
    }
  }

  // ── SQLite native backend (Node.js, better-sqlite3) ──────────────

  function sqliteNativeBackend(filePath) {
    let db = null

    return {
      async init() {
        const Database = require('better-sqlite3')
        const path = require('path')
        const fs = require('fs')
        // Ensure directory exists
        const dir = path.dirname(filePath)
        fs.mkdirSync(dir, { recursive: true })
        db = new Database(filePath)
        db.pragma('journal_mode = WAL')
        db.exec(KV_DDL)
      },
      exec(sql, params) { params ? db.prepare(sql).run(...(Array.isArray(params) ? params : [params])) : db.exec(sql) },
      run(sql, params) { db.prepare(sql).run(...(Array.isArray(params) ? params : [])) },
      all(sql, params) { return db.prepare(sql).all(...(Array.isArray(params) ? params : [])) },
      get(sql, params) { return db.prepare(sql).get(...(Array.isArray(params) ? params : [])) },

      // KV convenience
      async kvGet(key) {
        const row = db.prepare(`SELECT value FROM ${KV_TABLE} WHERE key = ?`).get(key)
        if (!row) return undefined
        try { return JSON.parse(row.value) } catch { return row.value }
      },
      async kvSet(key, value) {
        db.prepare(`INSERT OR REPLACE INTO ${KV_TABLE} (key, value, updated_at) VALUES (?, ?, ?)`)
          .run(key, JSON.stringify(value), Date.now())
      },
      async kvDelete(key) { db.prepare(`DELETE FROM ${KV_TABLE} WHERE key = ?`).run(key) },
      async kvKeys() { return db.prepare(`SELECT key FROM ${KV_TABLE}`).all().map(r => r.key) },
      async kvClear() { db.prepare(`DELETE FROM ${KV_TABLE}`).run() },
      async kvHas(key) { return !!db.prepare(`SELECT 1 FROM ${KV_TABLE} WHERE key = ?`).get(key) },
      async flush() {},
      async close() { if (db) { db.close(); db = null } },
    }
  }

  // ── SQLite in-memory backend (testing) ───────────────────────────

  function sqliteMemoryBackend() {
    let db = null

    return {
      async init() {
        // Try better-sqlite3 (Node.js)
        try {
          const Database = require('better-sqlite3')
          db = new Database(':memory:')
          db.exec(KV_DDL)
          return
        } catch { /* not available */ }
        // Try sql.js (browser/WASM)
        try {
          let SQL
          if (typeof initSqlJs === 'function') SQL = await initSqlJs()
          else if (typeof globalThis !== 'undefined' && globalThis.initSqlJs) SQL = await globalThis.initSqlJs()
          if (SQL) { db = new SQL.Database(); db.run(KV_DDL); return }
        } catch { /* not available */ }
        throw new Error('No SQLite engine found (need better-sqlite3 or sql.js)')
      },
      exec(sql, params) {
        if (db.exec && !db.prepare) { db.run(sql, params) } // sql.js
        else { params ? db.prepare(sql).run(...(Array.isArray(params) ? params : [params])) : db.exec(sql) }
      },
      run(sql, params) { this.exec(sql, params) },
      all(sql, params) {
        if (db.prepare && db.prepare(sql).all) {
          return db.prepare(sql).all(...(Array.isArray(params) ? params : []))
        }
        // sql.js path
        const stmt = db.prepare(sql)
        if (params) stmt.bind(params)
        const rows = []
        while (stmt.step()) rows.push(stmt.getAsObject())
        stmt.free()
        return rows
      },
      get(sql, params) {
        const rows = this.all(sql, params)
        return rows.length > 0 ? rows[0] : undefined
      },
      async kvGet(key) {
        const row = this.get(`SELECT value FROM ${KV_TABLE} WHERE key = ?`, [key])
        if (!row) return undefined
        try { return JSON.parse(row.value) } catch { return row.value }
      },
      async kvSet(key, value) {
        this.run(
          `INSERT OR REPLACE INTO ${KV_TABLE} (key, value, updated_at) VALUES (?, ?, ?)`,
          [key, JSON.stringify(value), Date.now()]
        )
      },
      async kvDelete(key) { this.run(`DELETE FROM ${KV_TABLE} WHERE key = ?`, [key]) },
      async kvKeys() { return this.all(`SELECT key FROM ${KV_TABLE}`).map(r => r.key) },
      async kvClear() { this.run(`DELETE FROM ${KV_TABLE}`) },
      async kvHas(key) { return !!this.get(`SELECT 1 FROM ${KV_TABLE} WHERE key = ?`, [key]) },
      async flush() {},
      async close() { if (db) { db.close(); db = null } },
    }
  }

  // ── File system backend (Node.js, zero deps) ─────────────────────

  function fsBackend(dir) {
    const fs = require('fs')
    const path = require('path')
    fs.mkdirSync(dir, { recursive: true })
    function fp(key) { return path.join(dir, encodeURIComponent(key) + '.json') }
    return {
      async init() {},
      async kvGet(key) { try { return JSON.parse(fs.readFileSync(fp(key), 'utf8')) } catch { return undefined } },
      async kvSet(key, value) { fs.writeFileSync(fp(key), JSON.stringify(value)) },
      async kvDelete(key) { try { fs.unlinkSync(fp(key)) } catch {} },
      async kvKeys() { try { return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => decodeURIComponent(f.slice(0, -5))) } catch { return [] } },
      async kvClear() { try { for (const f of fs.readdirSync(dir)) { if (f.endsWith('.json')) fs.unlinkSync(path.join(dir, f)) } } catch {} },
      async kvHas(key) { return fs.existsSync(fp(key)) },
      async flush() {},
      async close() {},
    }
  }

  // ── IndexedDB kv backend (browser, no sql.js needed) ──────────────

  function idbBackend(dbName) {
    const STORE_NAME = 'kv'
    let _db = null

    function open() {
      if (_db) return Promise.resolve(_db)
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName, 1)
        req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME)
        req.onsuccess = () => { _db = req.result; resolve(_db) }
        req.onerror = () => reject(req.error)
      })
    }
    function tx(mode) { return open().then(db => db.transaction(STORE_NAME, mode).objectStore(STORE_NAME)) }
    function wrap(req) { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) }) }

    return {
      async init() { await open() },
      async kvGet(key) { return wrap((await tx('readonly')).get(key)) },
      async kvSet(key, value) { await wrap((await tx('readwrite')).put(value, key)) },
      async kvDelete(key) { await wrap((await tx('readwrite')).delete(key)) },
      async kvKeys() { return wrap((await tx('readonly')).getAllKeys()) },
      async kvClear() { await wrap((await tx('readwrite')).clear()) },
      async kvHas(key) { return (await wrap((await tx('readonly')).count(key))) > 0 },
      async flush() {},
      async close() { if (_db) { _db.close(); _db = null } },
    }
  }

  // ── localStorage fallback (no SQLite) ────────────────────────────

  function lsBackend(prefix) {
    const pfx = prefix + ':'
    return {
      async init() {},
      async kvGet(key) {
        try {
          const raw = localStorage.getItem(pfx + key)
          return raw != null ? JSON.parse(raw) : undefined
        } catch { return undefined }
      },
      async kvSet(key, value) { localStorage.setItem(pfx + key, JSON.stringify(value)) },
      async kvDelete(key) { localStorage.removeItem(pfx + key) },
      async kvKeys() {
        const result = []
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (k.startsWith(pfx)) result.push(k.slice(pfx.length))
        }
        return result
      },
      async kvClear() {
        const toRemove = []
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (k.startsWith(pfx)) toRemove.push(k)
        }
        toRemove.forEach(k => localStorage.removeItem(k))
      },
      async kvHas(key) { return localStorage.getItem(pfx + key) != null },
      async flush() {},
      async close() {},
    }
  }

  // ── In-memory fallback ───────────────────────────────────────────

  function memBackend() {
    const data = new Map()
    return {
      async init() {},
      async kvGet(key) { return data.has(key) ? structuredClone(data.get(key)) : undefined },
      async kvSet(key, value) { data.set(key, structuredClone(value)) },
      async kvDelete(key) { data.delete(key) },
      async kvKeys() { return [...data.keys()] },
      async kvClear() { data.clear() },
      async kvHas(key) { return data.has(key) },
      async flush() {},
      async close() { data.clear() },
    }
  }

  // ── Factory ──────────────────────────────────────────────────────

  function detectBackend() {
    // Node.js — try better-sqlite3 first, then plain fs
    if (typeof require !== 'undefined') {
      try { require('better-sqlite3'); return 'sqlite-native' } catch {}
      try { require('fs'); return 'fs' } catch {}
    }
    // Browser — try sql.js
    if (typeof initSqlJs === 'function' ||
        (typeof globalThis !== 'undefined' && globalThis.initSqlJs)) {
      return 'sqlite-wasm'
    }
    // Browser — IndexedDB kv (no sql.js needed)
    if (typeof indexedDB !== 'undefined') {
      return 'idb'
    }
    // localStorage
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('__agentic_store_probe__', '1')
        localStorage.removeItem('__agentic_store_probe__')
        return 'ls'
      } catch {}
    }
    return 'mem'
  }

  /**
   * Create a namespaced key-value store.
   * Returns a Promise (async init for SQLite WASM).
   *
   * @param {string} name - Namespace
   * @param {object} [opts] - Options
   * @param {string} [opts.backend] - Force backend
   * @param {string} [opts.path] - File path for sqlite-native
   * @param {object} [opts.custom] - Custom backend
   * @returns {Promise<object>} Store
   */
  async function createStore(name, opts = {}) {
    // Custom backend
    if (opts.custom) {
      const c = opts.custom
      if (c.init) await c.init()
      return {
        get: (k) => c.kvGet ? c.kvGet(k) : c.get(k),
        set: (k, v) => c.kvSet ? c.kvSet(k, v) : c.set(k, v),
        delete: (k) => c.kvDelete ? c.kvDelete(k) : c.delete(k),
        keys: () => c.kvKeys ? c.kvKeys() : c.keys(),
        clear: () => c.kvClear ? c.kvClear() : c.clear(),
        has: (k) => c.kvHas ? c.kvHas(k) : c.has(k),
        flush: () => c.flush ? c.flush() : Promise.resolve(),
        close: () => c.close ? c.close() : Promise.resolve(),
        // Raw SQL if available
        exec: c.exec ? (sql, p) => c.exec(sql, p) : undefined,
        run: c.run ? (sql, p) => c.run(sql, p) : undefined,
        all: c.all ? (sql, p) => c.all(sql, p) : undefined,
        sql: c.get && c.exec ? (sql, p) => c.get(sql, p) : undefined,
        get backend() { return 'custom' },
      }
    }

    const backendType = opts.backend || detectBackend()
    let b

    switch (backendType) {
      case 'sqlite-wasm':
        b = sqliteWasmBackend(name)
        break
      case 'sqlite-native': {
        const filePath = opts.path || require('path').join(
          require('os').homedir(), '.agentic-store', name + '.db'
        )
        b = sqliteNativeBackend(filePath)
        break
      }
      case 'sqlite-memory':
        b = sqliteMemoryBackend()
        break
      case 'idb':
        b = idbBackend('agentic-store-' + name)
        break
      case 'fs': {
        const dir = opts.dir || require('path').join(
          require('os').homedir(), '.agentic-store', name
        )
        b = fsBackend(dir)
        break
      }
      case 'ls':
        b = lsBackend('agentic-store-' + name)
        break
      case 'mem':
        b = memBackend()
        break
      default:
        throw new Error(`Unknown backend: ${backendType}`)
    }

    await b.init()

    const store = {
      // KV API (always available)
      get: (k) => b.kvGet(k),
      set: (k, v) => b.kvSet(k, v),
      delete: (k) => b.kvDelete(k),
      keys: () => b.kvKeys(),
      clear: () => b.kvClear(),
      has: (k) => b.kvHas(k),
      flush: () => b.flush(),
      close: () => b.close(),
      get backend() { return backendType },
    }

    // Raw SQL (only for SQLite backends)
    if (b.exec) {
      store.exec = (sql, params) => b.exec(sql, params)
      store.run = (sql, params) => b.run(sql, params)
      store.all = (sql, params) => b.all(sql, params)
      store.sql = (sql, params) => b.get(sql, params)
    }

    return store
  }

  return { createStore }
})
