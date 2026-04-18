/**
 * agentic — 给 AI 造身体
 *
 * 统一入口，一个 class 访问所有能力。每个能力可独立配置 provider。
 *
 * Usage:
 *   // 默认实例（后续 configure）
 *   import { ai } from 'agentic'
 *   ai.configure({ llm: { provider: 'anthropic', apiKey: 'sk-...' } })
 *   await ai.think('hello')
 *
 *   // 自定义实例，每个能力独立配置
 *   import { Agentic } from 'agentic'
 *   const ai = new Agentic({
 *     llm:   { provider: 'anthropic', apiKey: 'sk-ant-...' },
 *     tts:   { provider: 'elevenlabs', apiKey: 'el-...' },
 *     stt:   { provider: 'sensevoice', baseUrl: 'http://localhost:18906' },
 *     embed: { provider: 'local', baseUrl: 'http://localhost:9877' },
 *   })
 *
 *   // 简单场景：顶层配置作为所有能力的 fallback
 *   const ai = new Agentic({ provider: 'openai', apiKey: 'sk-...' })
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else if (typeof define === 'function' && define.amd) define(factory)
  else root.Agentic = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const _cache = {}
  function load(name) {
    if (_cache[name] !== undefined) return _cache[name]
    // Browser: check global scope for pre-loaded UMD modules
    // Convention: 'agentic-core' → AgenticCore, 'agentic-store' → AgenticStore, etc.
    if (typeof window !== 'undefined') {
      const globalName = name.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join('')
      if (window[globalName]) { _cache[name] = window[globalName]; return _cache[name] }
    }
    try {
      if (typeof require === 'function') _cache[name] = require(name)
      else _cache[name] = null
    } catch { _cache[name] = null }
    return _cache[name]
  }

  // ── WebSocket connection manager ─────────────────────────────

  const WS = typeof WebSocket !== 'undefined' ? WebSocket
    : (typeof require === 'function' ? (() => { try { return require('ws') } catch { return null } })() : null)

  function createWsConnection(serviceUrl) {
    const wsUrl = serviceUrl.replace(/^http/, 'ws').replace(/\/+$/, '')
    let ws = null
    let connected = false
    let connectPromise = null
    const pending = new Map() // reqId → { resolve, reject, chunks, onDelta }
    let reqCounter = 0

    function connect() {
      if (connectPromise) return connectPromise
      connectPromise = new Promise((resolve, reject) => {
        if (!WS) return reject(new Error('WebSocket not available'))
        ws = new WS(wsUrl)

        ws.onopen = () => {
          connected = true
          connectPromise = null
          resolve(ws)
        }

        ws.onmessage = (event) => {
          let msg
          try { msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString()) } catch { return }

          if (msg._reqId && pending.has(msg._reqId)) {
            const req = pending.get(msg._reqId)
            if (msg.type === 'rpc_result') {
              req.resolve(msg.result)
              pending.delete(msg._reqId)
            } else if (msg.type === 'rpc_error') {
              req.reject(new Error(msg.error || 'RPC error'))
              pending.delete(msg._reqId)
            } else if (msg.type === 'chat_delta') {
              req.chunks.push(msg.text || '')
              if (req.onDelta) req.onDelta(msg.text || '')
            } else if (msg.type === 'chat_end') {
              req.resolve(msg.text || req.chunks.join(''))
              pending.delete(msg._reqId)
            } else if (msg.type === 'chat_error' || msg.type === 'error') {
              req.reject(new Error(msg.error || 'Unknown error'))
              pending.delete(msg._reqId)
            }
          } else if (msg.type === 'chat_delta' || msg.type === 'chat_end' || msg.type === 'chat_error') {
            // Legacy: no _reqId, match to the single pending request
            const first = pending.values().next().value
            if (!first) return
            const reqId = pending.keys().next().value
            if (msg.type === 'chat_delta') {
              first.chunks.push(msg.text || '')
              if (first.onDelta) first.onDelta(msg.text || '')
            } else if (msg.type === 'chat_end') {
              first.resolve(msg.text || first.chunks.join(''))
              pending.delete(reqId)
            } else if (msg.type === 'chat_error') {
              first.reject(new Error(msg.error || 'Unknown error'))
              pending.delete(reqId)
            }
          }
        }

        ws.onerror = (err) => {
          if (!connected) {
            connectPromise = null
            reject(err)
          }
        }

        ws.onclose = () => {
          connected = false
          connectPromise = null
          // Reject all pending
          for (const [id, req] of pending) {
            req.reject(new Error('WebSocket closed'))
          }
          pending.clear()
        }
      })
      return connectPromise
    }

    async function chat(messages, options = {}) {
      if (!connected || !ws || ws.readyState !== 1) await connect()
      const reqId = `r_${++reqCounter}_${Date.now()}`

      return new Promise((resolve, reject) => {
        pending.set(reqId, { resolve, reject, chunks: [], onDelta: options.emit })
        ws.send(JSON.stringify({
          type: 'think',
          _reqId: reqId,
          messages,
          options: { tools: options.tools, prefer: options.prefer },
        }))
      })
    }

    function close() {
      if (ws) { ws.close(); ws = null }
      connected = false
      connectPromise = null
    }

    async function rpc(method, params = {}) {
      if (!connected || !ws || ws.readyState !== 1) await connect()
      const reqId = `r_${++reqCounter}_${Date.now()}`

      return new Promise((resolve, reject) => {
        pending.set(reqId, {
          resolve, reject, chunks: [],
          onDelta: null,
          _rpc: true,
        })
        ws.send(JSON.stringify({ type: 'rpc', _reqId: reqId, method, params }))
      })
    }

    return { connect, chat, rpc, close, get connected() { return connected } }
  }

  // ── Agentic class ────────────────────────────────────────────────

  class Agentic {
    /**
     * @param {object} opts
     * @param {string} [opts.serviceUrl] — agentic-service URL for voice fallback + admin
     * @param {string} [opts.apiKey]     — API key for provider
     * @param {string} [opts.model]
     * @param {string} [opts.baseUrl]    — provider base URL (point to service for OpenAI-compatible)
     * @param {string} [opts.provider]
     * @param {string} [opts.system]
     * @param {object} [opts.tts]
     * @param {object} [opts.stt]
     * @param {object} [opts.memory]
     * @param {object} [opts.store]
     * @param {object} [opts.embed]
     * @param {object} [opts.sense]
     * @param {object} [opts.act]
     * @param {object} [opts.render]
     * @param {object} [opts.fs]
     * @param {object} [opts.shell]
     */
    constructor(opts = {}) {
      this._opts = opts
      this._i = {} // lazy instances
      this._serviceUrl = opts.serviceUrl ? opts.serviceUrl.replace(/\/+$/, '') : null
      this._ws = this._serviceUrl ? createWsConnection(this._serviceUrl) : null

      // Per-capability config — only capabilities that may need their own provider
      // Top-level provider/apiKey/baseUrl/model serves as default for everything
      this._cfg = {}
      for (const cap of ['llm', 'tts', 'stt', 'embed']) {
        this._cfg[cap] = opts[cap] || {}
      }
    }

    /** Resolve a config key for a capability, falling back to top-level opts */
    _cfgFor(cap, key) {
      return this._cfg[cap]?.[key] ?? this._opts[key]
    }

    /** Get full resolved config for a capability */
    _cfgAll(cap) {
      return {
        provider: this._cfgFor(cap, 'provider'),
        apiKey: this._cfgFor(cap, 'apiKey'),
        baseUrl: this._cfgFor(cap, 'baseUrl'),
        model: this._cfgFor(cap, 'model'),
        ...this._cfg[cap],
      }
    }

    _get(key, init) {
      if (!this._i[key]) this._i[key] = init()
      return this._i[key]
    }

    _need(pkg) {
      const m = load(pkg)
      if (!m) throw new Error(`${pkg} not installed — run: npm install ${pkg}`)
      return m
    }

    // ════════════════════════════════════════════════════════════════
    // THINK — serviceUrl → WebSocket to service, otherwise → core direct
    // ════════════════════════════════════════════════════════════════

    async think(input, opts = {}) {
      // Route: serviceUrl → WebSocket, otherwise → core direct
      if (this._ws) {
        const messages = opts.history
          ? [...opts.history, { role: 'user', content: input }]
          : [{ role: 'user', content: input }]
        if (opts.system) messages.unshift({ role: 'system', content: opts.system })
        return this._ws.chat(messages, { tools: opts.tools, emit: opts.emit, prefer: opts.prefer })
      }

      const core = this._need('agentic-core')
      const ask = core.agenticAsk || core

      // Resolve prefer → provider/baseUrl/apiKey/model overrides
      const pref = opts.prefer
      const prefObj = pref && typeof pref === 'object' ? pref : null

      const config = {
        provider: prefObj?.provider || opts.provider || this._cfgFor('llm', 'provider'),
        baseUrl: prefObj?.baseUrl || opts.baseUrl || this._cfgFor('llm', 'baseUrl'),
        apiKey: prefObj?.key || opts.apiKey || this._cfgFor('llm', 'apiKey'),
        model: prefObj?.model || opts.model || this._cfgFor('llm', 'model'),
        system: opts.system || this._opts.system,
        stream: opts.stream || false,
        proxyUrl: opts.proxyUrl || this._opts.proxyUrl,
      }

      if (opts.tools) config.tools = opts.tools
      if (opts.images) config.images = opts.images
      if (opts.audio) config.audio = opts.audio
      if (opts.history) config.history = opts.history
      if (opts.schema) config.schema = opts.schema
      if (opts.emit) config.emit = opts.emit

      const emit = opts.emit || (() => {})
      const result = await ask(input, config, emit)
      if (typeof result === 'string') return result
      if (result?.answer != null) return result.answer
      if (result?.content != null) return typeof result.content === 'string' ? result.content : result.content.map(b => b.text || '').join('')
      return result
    }

    // Note: no `tools` or `stream()` here. Tools and streaming belong to Claw.
    // Agentic is a capability dispatcher — createClaw(), think(), speak(), etc.
    // think() is for simple one-shot Q&A. For agentic tool loops, use createClaw().

    // ════════════════════════════════════════════════════════════════
    // STEP — single-turn LLM call, caller controls tool loop
    // ════════════════════════════════════════════════════════════════

    async step(messages, opts = {}) {
      const core = this._need('agentic-core')
      if (!core.agenticStep) throw new Error('agentic-core does not support step() — update to latest version')

      const config = {
        provider: opts.provider || this._cfgFor('llm', 'provider'),
        baseUrl: opts.baseUrl || this._cfgFor('llm', 'baseUrl'),
        apiKey: opts.apiKey || this._cfgFor('llm', 'apiKey'),
        model: opts.model || this._cfgFor('llm', 'model'),
        system: opts.system || this._opts.system,
        stream: opts.stream || false,
        proxyUrl: opts.proxyUrl || this._opts.proxyUrl,
        emit: opts.emit,
      }
      if (opts.tools) config.tools = opts.tools
      if (opts.signal) config.signal = opts.signal

      return core.agenticStep(messages, config)
    }

    // Helper: build tool result messages after executing tools
    buildToolResults(toolCalls, results) {
      const core = this._need('agentic-core')
      if (core.buildToolResults) return core.buildToolResults(toolCalls, results)
      // Fallback
      return toolCalls.map((tc, i) => {
        const r = results[i]
        const content = r.error ? JSON.stringify({ error: r.error }) : JSON.stringify(r.output ?? r)
        return { role: 'tool', tool_call_id: tc.id, content }
      })
    }

    // ════════════════════════════════════════════════════════════════
    // SPEAK — agentic-voice TTS, delegates to core for network
    // ════════════════════════════════════════════════════════════════

    _core() {
      return load('agentic-core')
    }

    _tts() {
      return this._get('tts', () => {
        const v = this._need('agentic-voice')
        const c = this._cfgAll('tts')
        return v.createTTS({
          provider: c.provider || 'openai',
          baseUrl: c.baseUrl,
          apiKey: c.apiKey,
          voice: c.voice, model: c.model,
          core: this._core(),
        })
      })
    }

    _hasVoice() { return !!load('agentic-voice') }

    async speak(text, opts) {
      if (this._ws) {
        const result = await this._ws.rpc('speak', { text, options: opts })
        // result.audio is base64
        if (typeof Buffer !== 'undefined') return Buffer.from(result.audio, 'base64')
        const bin = atob(result.audio)
        const arr = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
        return arr.buffer
      }
      return this._tts().fetchAudio(text, opts)
    }

    async speakAloud(text, opts) { return this._tts().speak(text, opts) }
    async speakStream(stream, opts) { return this._tts().speakStream(stream, opts) }
    async timestamps(text, opts) { return this._tts().timestamps(text, opts) }
    stopSpeaking() { if (this._i.tts) this._i.tts.stop() }

    // ════════════════════════════════════════════════════════════════
    // LISTEN — agentic-voice STT, delegates to core for network
    // ════════════════════════════════════════════════════════════════

    _stt() {
      return this._get('stt', () => {
        const v = this._need('agentic-voice')
        const c = this._cfgAll('stt')
        return v.createSTT({
          provider: c.provider || 'openai',
          baseUrl: c.baseUrl,
          apiKey: c.apiKey,
          model: c.model,
          core: this._core(),
        })
      })
    }

    async listen(audio, opts) {
      if (this._ws) {
        const b64 = typeof audio === 'string' ? audio
          : (typeof Buffer !== 'undefined' && Buffer.isBuffer(audio)) ? audio.toString('base64')
          : _toBase64(audio)
        const result = await this._ws.rpc('listen', { audio: b64, options: opts })
        return result.text
      }
      return this._stt().transcribe(audio, opts)
    }

    async listenWithTimestamps(audio, opts) { return this._stt().transcribeWithTimestamps(audio, opts) }
    startListening(onResult, onError) { return this._stt().startListening(onResult, onError) }
    stopListening() { if (this._i.stt) this._i.stt.stopListening() }

    // ════════════════════════════════════════════════════════════════
    // SEE — agentic-core + images
    // ════════════════════════════════════════════════════════════════

    async see(image, prompt = '描述这张图片', opts = {}) {
      const b64 = typeof image === 'string' ? image : _toBase64(image)
      if (this._ws) {
        const messages = [{ role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
        ]}]
        const result = await this._ws.rpc('see', { messages, options: opts })
        return result.text
      }
      return this.think(prompt, { ...opts, images: [{ url: `data:image/jpeg;base64,${b64}` }] })
    }

    // ════════════════════════════════════════════════════════════════
    // CONVERSE — listen → think → speak
    // ════════════════════════════════════════════════════════════════

    async converse(audio, opts = {}) {
      const transcript = await this.listen(audio)
      const result = await this.think(transcript, opts)
      const answer = typeof result === 'string' ? result : result.answer || ''
      const audioOut = await this.speak(answer)
      return { text: answer, audio: audioOut, transcript }
    }

    // ════════════════════════════════════════════════════════════════
    // REMEMBER / RECALL — agentic-memory
    // ════════════════════════════════════════════════════════════════

    _mem() {
      return this._get('mem', () => this._need('agentic-memory').createMemory({ knowledge: true, ...this._opts.memory }))
    }

    async remember(text, meta = {}) {
      const id = meta.id || `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      await this._mem().learn(id, text, meta)
      return id
    }

    async recall(query, opts) { return this._mem().recall(query, opts) }
    async addMessage(role, content) { return this._mem().add(role, content) }

    // ════════════════════════════════════════════════════════════════
    // SAVE / LOAD — agentic-store
    // ════════════════════════════════════════════════════════════════

    async _store() {
      if (!this._i.store) {
        const storeOpts = this._opts.store || {}
        // Accept a pre-created store instance
        if (storeOpts.instance) {
          this._i.store = storeOpts.instance
        } else {
          const mod = this._need('agentic-store')
          const name = storeOpts.name || 'agentic'
          const s = await mod.createStore(name, storeOpts)
          this._i.store = s
        }
      }
      return this._i.store
    }

    async save(key, value) { const s = await this._store(); return s.set(key, value) }
    async load(key) { const s = await this._store(); return s.get(key) }
    async has(key) { const s = await this._store(); return s.has(key) }
    async keys() { const s = await this._store(); return s.keys() }
    async deleteKey(key) { const s = await this._store(); return s.delete(key) }
    async query(sql, params) { const s = await this._store(); return s.all(sql, params) }
    async sql(sql, params) { const s = await this._store(); return s.run(sql, params) }
    async exec(sql, params) { const s = await this._store(); return s.exec(sql, params) }

    // ════════════════════════════════════════════════════════════════
    // EMBED — agentic-embed
    // ════════════════════════════════════════════════════════════════

    _embedLib() { return this._need('agentic-embed') }

    async _embedIndex() {
      return this._get('embedIndex', async () => {
        const mod = this._embedLib()
        return mod.create({ ...this._opts.embed })
      })
    }

    async embed(text) {
      if (this._ws) {
        const result = await this._ws.rpc('embed', { text: Array.isArray(text) ? text[0] : text })
        return result.embedding
      }
      return this._embedLib().localEmbed(Array.isArray(text) ? text : [text])[0]
    }
    async index(id, text, meta) { const idx = await this._embedIndex(); return idx.add(id, text, meta) }
    async indexMany(docs) { const idx = await this._embedIndex(); return idx.addMany(docs) }
    async search(query, opts) { const idx = await this._embedIndex(); return idx.search(query, opts) }

    // ════════════════════════════════════════════════════════════════
    // PERCEIVE — agentic-sense
    // ════════════════════════════════════════════════════════════════

    _sense() {
      return this._get('sense', () => new (this._need('agentic-sense').AgenticSense)())
    }

    async perceive(frame) { return this._sense().detect(frame) }

    // ════════════════════════════════════════════════════════════════
    // DECIDE / ACT — agentic-act
    // ════════════════════════════════════════════════════════════════

    _act() {
      const o = this._opts
      return this._get('act', () => new (this._need('agentic-act').AgenticAct)({
        apiKey: o.apiKey, model: o.model, baseUrl: o.baseUrl, provider: o.provider,
      }))
    }

    async decide(input) { return this._act().decide(input) }
    async act(input) { return this._act().run(input) }

    // ════════════════════════════════════════════════════════════════
    // RENDER — agentic-render
    // ════════════════════════════════════════════════════════════════

    createRenderer(target, opts) {
      const mod = this._need('agentic-render')
      return mod.createRenderer(target, opts)
    }

    // ════════════════════════════════════════════════════════════════
    // FILESYSTEM — agentic-filesystem
    // ════════════════════════════════════════════════════════════════

    _fs() {
      return this._get('fs', () => {
        const mod = this._need('agentic-filesystem')
        const o = this._opts.fs || {}
        const Backend = o.backend === 'memory' ? mod.MemoryStorage
          : (mod.NodeFsBackend || mod.MemoryStorage)
        return new mod.AgenticFileSystem(Backend ? new Backend(o) : undefined)
      })
    }

    async readFile(path) { const r = await this._fs().read(path); return r?.content !== undefined ? r.content : r }
    async writeFile(path, content) { return this._fs().write(path, content) }
    async deleteFile(path) { return this._fs().delete(path) }
    async ls(prefix) { const r = await this._fs().ls(prefix); return Array.isArray(r) ? r.map(e => e?.name || e) : r }
    async tree(prefix) { return this._fs().tree(prefix) }
    async grep(pattern, opts) { return this._fs().grep(pattern, opts) }
    async semanticGrep(query) { return this._fs().semanticGrep(query) }

    // ════════════════════════════════════════════════════════════════
    // RUN — agentic-shell
    // ════════════════════════════════════════════════════════════════

    _shell() {
      return this._get('shell', () => new (this._need('agentic-shell').AgenticShell)(this._fs()))
    }

    async run(command) { return this._shell().exec(command) }

    // ════════════════════════════════════════════════════════════════
    // SPATIAL — agentic-spatial
    // ════════════════════════════════════════════════════════════════

    async reconstructSpace(images, opts = {}) {
      const o = this._opts
      return this._need('agentic-spatial').reconstructSpace({
        images, apiKey: o.apiKey, model: o.model,
        baseUrl: o.baseUrl, provider: o.provider, ...opts,
      })
    }

    createSpatialSession(opts = {}) {
      const o = this._opts
      return new (this._need('agentic-spatial').SpatialSession)({
        apiKey: o.apiKey, model: o.model,
        baseUrl: o.baseUrl, provider: o.provider, ...opts,
      })
    }

    // ════════════════════════════════════════════════════════════════
    // CLAW — agentic-claw agent runtime
    // ════════════════════════════════════════════════════════════════

    createClaw(opts = {}) {
      const clawMod = this._need('agentic-claw')
      const o = this._opts
      return clawMod.createClaw({
        apiKey: o.apiKey, provider: o.provider,
        baseUrl: o.baseUrl, model: o.model,
        systemPrompt: o.system,
        ...opts,
      })
    }

    // ════════════════════════════════════════════════════════════════
    // ADMIN — agentic-service management (requires serviceUrl → WS)
    // ════════════════════════════════════════════════════════════════

    get admin() {
      if (!this._ws) return null
      const rpc = (method, params) => this._ws.rpc(method, params)
      return this._get('admin', () => ({
        health: () => rpc('health'),
        status: () => rpc('status'),
        perf: () => rpc('perf'),
        config: (newConfig) => newConfig ? rpc('config.set', newConfig) : rpc('config.get'),
        devices: () => rpc('devices'),
        models: () => rpc('models'),
        engines: () => rpc('engines'),
        queueStats: () => rpc('queue.stats'),
        assignments: (updates) => updates ? rpc('assignments.set', updates) : rpc('assignments.get'),
        addToPool: (model) => rpc('pool.add', model),
        removeFromPool: (id) => rpc('pool.remove', { id }),
      }))
    }

    // ════════════════════════════════════════════════════════════════
    // DISCOVERY + LIFECYCLE
    // ════════════════════════════════════════════════════════════════

    capabilities() {
      const has = name => !!load(name)
      const ws = !!this._ws
      return {
        think: ws || has('agentic-core'),
        speak: ws || has('agentic-voice'),
        listen: ws || has('agentic-voice'),
        see: ws || has('agentic-core'),
        converse: (ws || has('agentic-core')) && (ws || has('agentic-voice')),
        remember: has('agentic-memory'), recall: has('agentic-memory'),
        save: has('agentic-store'), load: has('agentic-store'),
        embed: ws || has('agentic-embed'), search: has('agentic-embed'),
        perceive: has('agentic-sense'),
        decide: has('agentic-act'), act: has('agentic-act'),
        render: has('agentic-render'),
        readFile: has('agentic-filesystem'),
        run: has('agentic-shell'),
        spatial: has('agentic-spatial'),
        claw: has('agentic-claw'),
        admin: ws,
      }
    }

    /** Reconfigure this instance (merges into existing config) */
    configure(opts = {}) {
      Object.assign(this._opts, opts)
      for (const cap of ['llm', 'tts', 'stt', 'embed']) {
        if (opts[cap]) this._cfg[cap] = { ...this._cfg[cap], ...opts[cap] }
      }
      if (opts.serviceUrl) {
        this._serviceUrl = opts.serviceUrl.replace(/\/+$/, '')
        if (this._ws) this._ws.close()
        this._ws = createWsConnection(this._serviceUrl)
      }
      // Clear cached instances so they pick up new config
      this._i = {}
      return this
    }

    /** URL of connected agentic-service, or null */
    get serviceUrl() { return this._serviceUrl }

    destroy() {
      if (this._ws) { this._ws.close(); this._ws = null }
      for (const inst of Object.values(this._i)) {
        if (inst?.destroy) inst.destroy()
        else if (inst?.close) inst.close()
        else if (inst?.stopListening) inst.stopListening()
      }
      this._i = {}
    }
  }

  function _toBase64(input) {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) return input.toString('base64')
    if (input instanceof ArrayBuffer) {
      const b = new Uint8Array(input); let s = ''
      for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
      return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64')
    }
    return String(input)
  }

  const ai = new Agentic()
  return { Agentic, ai }
})
