/**
 * agentic-voice — Speech for AI apps
 * TTS (text-to-speech) + STT (speech-to-text) in one library.
 * Zero dependencies. Browser + Node.js.
 *
 * Usage:
 *   const voice = AgenticVoice.createVoice({
 *     tts: { baseUrl: 'https://api.openai.com', apiKey: 'sk-...', voice: 'alloy' },
 *     stt: { mode: 'browser' },  // or 'whisper'
 *   })
 *
 *   // Text-to-Speech
 *   await voice.speak('Hello world')
 *   voice.stop()
 *
 *   // Speech-to-Text (push-to-talk)
 *   voice.startListening()
 *   voice.stopListening()  // → emits 'transcript' event
 *
 *   // Playback progress (0-1)
 *   voice.on('progress', ({ progress, duration, elapsed }) => ...)
 *
 *   // Word-level timestamps
 *   const { words, duration } = await voice.timestamps('Hello world')
 *
 *   // Fetch audio without playing
 *   const buffer = await voice.fetchAudio('Hello world')
 *   const result = await voice.playBuffer(buffer)
 *
 *   // Events
 *   voice.on('transcript', text => console.log(text))
 *   voice.on('speaking', playing => ...)
 *   voice.on('progress', ({ progress, duration, elapsed }) => ...)
 *   voice.on('error', err => ...)
 *
 * Browser:
 *   <script src="agentic-voice.js"></script>
 *   const voice = AgenticVoice.createVoice({ ... })
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else if (typeof define === 'function' && define.amd) define(factory)
  else root.AgenticVoice = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  // ── Event emitter ────────────────────────────────────────────────

  function createEmitter() {
    const listeners = {}
    return {
      on(event, fn) {
        if (!listeners[event]) listeners[event] = []
        listeners[event].push(fn)
        return this
      },
      off(event, fn) {
        if (!listeners[event]) return this
        listeners[event] = listeners[event].filter(f => f !== fn)
        return this
      },
      emit(event, ...args) {
        if (listeners[event]) {
          for (const fn of listeners[event]) {
            try { fn(...args) } catch (e) { console.error('[voice]', e) }
          }
        }
      }
    }
  }

  // ── webm→wav conversion (browser) ───────────────────────────────

  async function webmToWav(blob) {
    const ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)()
    const arrayBuffer = await blob.arrayBuffer()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    const samples = audioBuffer.getChannelData(0)
    const sampleRate = audioBuffer.sampleRate
    const buffer = new ArrayBuffer(44 + samples.length * 2)
    const view = new DataView(buffer)
    const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)) }
    writeStr(0, 'RIFF')
    view.setUint32(4, 36 + samples.length * 2, true)
    writeStr(8, 'WAVE')
    writeStr(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeStr(36, 'data')
    view.setUint32(40, samples.length * 2, true)
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]))
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    }
    ctx.close()
    return new Blob([buffer], { type: 'audio/wav' })
  }

  // ── URL helpers ──────────────────────────────────────────────────

  function cleanUrl(url) {
    return (url || '').trim().replace(/\/+$/, '').replace(/\/v1$/, '')
  }

  // ── TTS Engine ───────────────────────────────────────────────────

  function createTTS(config = {}) {
    const {
      provider = 'openai',
      baseUrl = 'https://api.openai.com',
      apiKey = '',
      model = 'tts-1',
      voice = 'alloy',
      format = 'mp3',
      proxyUrl = null,
    } = config

    let audioCtx = null
    let currentSource = null
    let generation = 0
    let progressRAF = null

    // Observable state
    let _progress = 0
    let _duration = 0
    let _onProgress = null   // callback: ({ progress, duration, elapsed }) => void
    let _onEnd = null         // callback: () => void

    function getAudioCtx() {
      if (!audioCtx) audioCtx = new (globalThis.AudioContext || globalThis.webkitAudioContext)()
      return audioCtx
    }

    function stopProgressLoop() {
      if (progressRAF) {
        cancelAnimationFrame(progressRAF)
        progressRAF = null
      }
    }

    function resetPlaybackState() {
      stopProgressLoop()
      _progress = 0
      _duration = 0
    }

    /**
     * Fetch TTS audio as ArrayBuffer without playing.
     * Returns null on failure.
     */
    async function fetchAudio(text, opts = {}) {
      if (!text?.trim()) return null
      if (!apiKey && !opts.apiKey) return null

      const currentProvider = opts.provider || provider

      // ElevenLabs
      if (currentProvider === 'elevenlabs') {
        const voiceId = opts.voice || voice
        const modelId = opts.model || model || 'eleven_turbo_v2_5'
        const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`
        
        const headers = {
          'xi-api-key': opts.apiKey || apiKey,
          'Content-Type': 'application/json',
        }

        const body = JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          }
        })

        let res, lastErr
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            res = await fetch(url, { method: 'POST', headers, body })
            break
          } catch (err) {
            lastErr = err
            if (attempt < 2) await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
          }
        }
        if (!res) throw lastErr
        if (!res.ok) throw new Error(`ElevenLabs TTS failed: ${res.status} ${res.statusText}`)

        const arrayBuffer = await res.arrayBuffer()
        if (arrayBuffer.byteLength === 0) return null
        return arrayBuffer
      }

      // OpenAI (default)
      const base = cleanUrl(opts.baseUrl || baseUrl)
      const url = `${base}/v1/audio/speech`
      const targetUrl = proxyUrl ? proxyUrl : url
      const headers = {
        'Authorization': `Bearer ${opts.apiKey || apiKey}`,
        'Content-Type': 'application/json',
      }
      if (proxyUrl) headers['X-Target-URL'] = url

      const body = JSON.stringify({
        model: opts.model || model,
        voice: opts.voice || voice,
        input: text,
        response_format: opts.format || format,
      })

      let res, lastErr
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          res = await fetch(targetUrl, { method: 'POST', headers, body })
          break
        } catch (err) {
          lastErr = err
          if (attempt < 2) await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
        }
      }
      if (!res) throw lastErr
      if (!res.ok) throw new Error(`TTS failed: ${res.status} ${res.statusText}`)

      const arrayBuffer = await res.arrayBuffer()
      if (arrayBuffer.byteLength === 0) return null
      return arrayBuffer
    }

    /**
     * Play an already-fetched audio ArrayBuffer.
     * Returns { duration } on success, null on cancel/failure.
     * Emits progress events via _onProgress callback.
     */
    async function playBuffer(arrayBuffer) {
      const gen = ++generation

      // Stop previous
      stop()
      resetPlaybackState()

      // Validate arrayBuffer
      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        console.error('[TTS] Invalid arrayBuffer')
        return null
      }

      console.log('[TTS] Playing buffer, size:', arrayBuffer.byteLength)

      // Use Audio element directly (skip AudioContext)
      const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' })
      const blobUrl = URL.createObjectURL(blob)
      const audio = new Audio()
      audio.src = blobUrl

      return new Promise(resolve => {
        audio.onloadedmetadata = () => {
          _duration = audio.duration
        }
        audio.ontimeupdate = () => {
          if (audio.duration > 0) {
            _progress = audio.currentTime / audio.duration
            _onProgress?.({ progress: _progress, duration: audio.duration, elapsed: audio.currentTime })
          }
        }
        audio.onended = () => {
          URL.revokeObjectURL(blobUrl)
          _progress = 1
          _onProgress?.({ progress: 1, duration: _duration, elapsed: _duration })
          currentSource = null
          _onEnd?.()
          resolve({ duration: _duration })
        }
        audio.onerror = (e) => {
          console.error('[TTS] Audio error:', audio.error)
          URL.revokeObjectURL(blobUrl)
          currentSource = null
          _onEnd?.()
          resolve(null)
        }
        currentSource = audio
        audio.play().catch(e => {
          console.error('[TTS] Play failed:', e)
          URL.revokeObjectURL(blobUrl)
          resolve(null)
        })
      })
    }

    /**
     * Fetch + play in one call (original API).
     */
    async function speak(text, opts = {}) {
      if (!text?.trim()) return false
      if (!apiKey && !opts.apiKey) throw new Error('TTS apiKey required')

      const gen = ++generation
      stop()
      resetPlaybackState()

      const currentProvider = opts.provider || provider

      // ElevenLabs - direct play
      if (currentProvider === 'elevenlabs') {
        const voiceId = opts.voice || voice
        const modelId = opts.model || model || 'eleven_turbo_v2_5'
        const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`
        
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'xi-api-key': opts.apiKey || apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            model_id: modelId,
            voice_settings: { stability: 0.5, similarity_boost: 0.75 }
          })
        })

        console.log('[TTS] Fetch response:', res.status, res.ok)
        if (!res.ok) return false
        const arrayBuffer = await res.arrayBuffer()
        console.log('[TTS] Got arrayBuffer:', arrayBuffer.byteLength, 'bytes')

        const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' })
        const blobUrl = URL.createObjectURL(blob)
        console.log('[TTS] Created blob URL:', blobUrl)
        const audio = new Audio()
        audio.src = blobUrl
        console.log('[TTS] Audio element created, src set')

        return new Promise(resolve => {
          audio.onended = () => {
            console.log('[TTS] Audio ended')
            URL.revokeObjectURL(blobUrl)
            currentSource = null
            _onEnd?.()
            resolve(true)
          }
          audio.onerror = (e) => {
            console.error('[TTS] Audio error:', audio.error)
            URL.revokeObjectURL(blobUrl)
            resolve(false)
          }
          currentSource = audio
          audio.play().catch(e => {
            console.error('[TTS] Play failed:', e)
            resolve(false)
          })
        })
      }

      // OpenAI - use fetchAudio + playBuffer
      const arrayBuffer = await fetchAudio(text, opts)
      if (!arrayBuffer || gen !== generation) return false
      const result = await playBuffer(arrayBuffer)
      return !!result
    }

    /**
     * Get word-level timestamps via Whisper transcription of TTS output.
     * Returns { words: [{ word, start, end }], duration } or null.
     */
    async function timestamps(text, opts = {}) {
      const arrayBuffer = await fetchAudio(text, opts)
      if (!arrayBuffer) return null

      const base = cleanUrl(opts.baseUrl || baseUrl)
      const key = opts.apiKey || apiKey
      if (!base || !key) return null

      try {
        const blob = new Blob([arrayBuffer], { type: `audio/${format}` })
        const form = new FormData()
        form.append('file', blob, `speech.${format}`)
        form.append('model', 'whisper-1')
        form.append('response_format', 'verbose_json')
        form.append('timestamp_granularities[]', 'word')

        const res = await fetch(`${base}/v1/audio/transcriptions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}` },
          body: form,
        })

        if (!res.ok) return null
        const data = await res.json()
        if (!data.words?.length) return null

        return {
          words: data.words,  // [{ word, start, end }, ...]
          duration: data.duration,
          audio: arrayBuffer,  // include buffer so caller can playBuffer() it
        }
      } catch {
        return null
      }
    }

    function stop() {
      generation++
      stopProgressLoop()
      if (currentSource) {
        try {
          if (currentSource.stop) currentSource.stop()
          else if (currentSource.pause) currentSource.pause()
        } catch {}
        currentSource = null
      }
      resetPlaybackState()
    }

    function unlock() {
      const ctx = getAudioCtx()
      if (ctx.state === 'suspended') ctx.resume()
    }

    function destroy() {
      stop()
      if (audioCtx) { try { audioCtx.close() } catch {} }
      audioCtx = null
    }

    return {
      speak,
      fetchAudio,
      playBuffer,
      timestamps,
      stop,
      unlock,
      destroy,
      /** Set progress callback: ({ progress, duration, elapsed }) => void */
      onProgress(cb) { _onProgress = cb },
      /** Set playback-end callback */
      onEnd(cb) { _onEnd = cb },
      get isSpeaking() { return !!currentSource },
      get progress() { return _progress },
      get duration() { return _duration },
      get generation() { return generation },
      bumpGeneration() { return ++generation },
    }
  }

  // ── STT Engine ───────────────────────────────────────────────────

  function createSTT(config = {}) {
    const {
      provider = 'openai',
      mode = 'browser',  // 'browser' (Web Speech API) or 'whisper'
      baseUrl = 'https://api.openai.com',
      apiKey = '',
      language = 'zh-CN',
      model = 'whisper-1',
      proxyUrl = null,
      minHoldMs = 300,
    } = config

    let mediaRecorder = null
    let webSpeechRecognition = null
    let micDownTime = 0
    let micReleased = false

    // ── Web Speech API ──

    function startWebSpeech(onResult, onError) {
      if (webSpeechRecognition) return
      const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition
      if (!SR) { onError?.(new Error('Web Speech API not supported')); return false }

      micDownTime = Date.now()
      const recognition = new SR()
      recognition.lang = language.replace('_', '-')
      recognition.interimResults = false

      recognition.onresult = e => {
        const text = e.results[0]?.[0]?.transcript?.trim()
        webSpeechRecognition = null
        if (text) onResult?.(text)
        else onError?.(new Error('No speech detected'))
      }
      recognition.onerror = e => {
        webSpeechRecognition = null
        onError?.(new Error('Recognition error: ' + e.error))
      }
      recognition.onend = () => {
        webSpeechRecognition = null
      }

      webSpeechRecognition = recognition
      recognition.start()
      return true
    }

    function stopWebSpeech() {
      if (!webSpeechRecognition) return
      const held = Date.now() - micDownTime
      if (held < minHoldMs) {
        webSpeechRecognition.abort()
        webSpeechRecognition = null
        return
      }
      webSpeechRecognition.stop()
    }

    // ── Whisper API ──

    function startWhisper(onResult, onError) {
      console.log('[STT] startWhisper called, mediaRecorder:', mediaRecorder)
      if (mediaRecorder) return false
      micDownTime = Date.now()
      micReleased = false

      if (!navigator.mediaDevices?.getUserMedia) {
        onError?.(new Error('getUserMedia not available (HTTPS required)'))
        return false
      }

      navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        console.log('[STT] Got media stream')
        if (micReleased) {
          console.log('[STT] Mic already released, stopping stream')
          stream.getTracks().forEach(t => t.stop())
          return
        }

        const chunks = []
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
        console.log('[STT] MediaRecorder created')
        
        mediaRecorder.ondataavailable = e => {
          console.log('[STT] Data available:', e.data.size, 'bytes')
          chunks.push(e.data)
        }
        
        mediaRecorder.onstop = async () => {
          console.log('[STT] MediaRecorder stopped')
          stream.getTracks().forEach(t => t.stop())
          const held = Date.now() - micDownTime
          console.log('[STT] Held for', held, 'ms')
          mediaRecorder = null

          if (held < minHoldMs) return

          const blob = new Blob(chunks, { type: 'audio/webm' })
          console.log('[STT] Created blob:', blob.size, 'bytes')
          try {
            const text = await transcribe(blob)
            console.log('[STT] Transcribe result:', text)
            if (text) onResult?.(text)
            else onError?.(new Error('No speech detected'))
          } catch (e) {
            console.error('[STT] Transcribe error:', e)
            onError?.(e)
          }
        }

        mediaRecorder.start()
        console.log('[STT] Recording started')
      }).catch(e => {
        console.error('[STT] getUserMedia error:', e)
        onError?.(new Error('Microphone unavailable: ' + e.message))
      })

      return true
    }

    function stopWhisper() {
      micReleased = true
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop()
      }
      // 立即清理，不等 onstop
      mediaRecorder = null
    }

    /**
     * Transcribe audio.
     * Browser: pass Blob (auto-converts webm→wav)
     * Node.js: pass file path (string) or Buffer
     */
    async function transcribe(input, opts = {}) {
      const currentProvider = opts.provider || provider
      const key = opts.apiKey || apiKey
      if (!key) throw new Error('STT apiKey required')

      // ElevenLabs
      if (currentProvider === 'elevenlabs') {
        const url = 'https://api.elevenlabs.io/v1/speech-to-text'
        const modelId = opts.model || 'scribe_v2'
        const isNode = typeof globalThis.window === 'undefined'
        
        if (isNode && (typeof input === 'string' || Buffer.isBuffer(input))) {
          const fs = require('fs')
          const fileData = typeof input === 'string' ? fs.readFileSync(input) : input
          const boundary = '----AgenticVoice' + Date.now().toString(36)
          const parts = []

          parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`)
          parts.push(fileData)
          parts.push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model_id"\r\n\r\n${modelId}\r\n`)
          parts.push(`--${boundary}--\r\n`)

          const body = Buffer.concat(parts.map(p => typeof p === 'string' ? Buffer.from(p) : p))

          const https = require('https')
          const parsed = new (require('url').URL)(url)
          return new Promise((resolve, reject) => {
            const req = https.request({
              hostname: parsed.hostname,
              path: parsed.pathname,
              method: 'POST',
              headers: {
                'xi-api-key': key,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length,
              },
              timeout: 30000,
            }, (res) => {
              let data = ''
              res.on('data', c => data += c)
              res.on('end', () => {
                try {
                  const result = JSON.parse(data)
                  resolve(result.text?.trim() || '')
                } catch { reject(new Error('Failed to parse ElevenLabs response')) }
              })
            })
            req.on('error', reject)
            req.on('timeout', () => { req.destroy(); reject(new Error('Transcription timeout')) })
            req.write(body)
            req.end()
          })
        }

        // Browser
        console.log('[STT] Transcribing audio blob, size:', input.size)
        const form = new FormData()
        form.append('file', input, 'audio.webm')
        form.append('model_id', modelId)

        console.log('[STT] Sending to ElevenLabs...')
        
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'xi-api-key': key },
            body: form
          })
          console.log('[STT] Response:', res.status, res.ok)
          if (!res.ok) {
            const errorText = await res.text()
            console.error('[STT] Error response:', errorText)
            throw new Error(`ElevenLabs STT failed: ${res.status}`)
          }
          const result = await res.json()
          console.log('[STT] Result:', result)
          return result.text?.trim() || ''
        } catch (e) {
          console.error('[STT] Fetch error:', e.name, e.message)
          throw e
        }
      }

      // OpenAI (default)
      const base = cleanUrl(opts.baseUrl || baseUrl)
      if (!base) throw new Error('STT baseUrl required')

      const url = `${base}/v1/audio/transcriptions`
      const headers = { 'Authorization': `Bearer ${key}` }

      // Node.js: input is file path (string) or Buffer
      const isNode = typeof globalThis.window === 'undefined'
      if (isNode && (typeof input === 'string' || Buffer.isBuffer(input))) {
        const fs = require('fs')
        const fileData = typeof input === 'string' ? fs.readFileSync(input) : input
        const boundary = '----AgenticVoice' + Date.now().toString(36)
        const parts = []

        // file part
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`)
        parts.push(fileData)
        parts.push('\r\n')

        // model part
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${opts.model || model}\r\n`)

        // language part
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${language.split('-')[0]}\r\n`)

        // response_format for timestamps
        if (opts.timestamps) {
          parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`)
          parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nword\r\n`)
        }

        parts.push(`--${boundary}--\r\n`)

        const body = Buffer.concat(parts.map(p => typeof p === 'string' ? Buffer.from(p) : p))

        const http = url.startsWith('https') ? require('https') : require('http')
        const parsed = new (require('url').URL)(url)
        return new Promise((resolve, reject) => {
          const req = http.request({
            hostname: parsed.hostname,
            port: parsed.port || (url.startsWith('https') ? 443 : 80),
            path: parsed.pathname,
            method: 'POST',
            headers: {
              ...headers,
              'Content-Type': `multipart/form-data; boundary=${boundary}`,
              'Content-Length': body.length,
            },
            timeout: 30000,
          }, (res) => {
            let data = ''
            res.on('data', c => data += c)
            res.on('end', () => {
              try {
                const result = JSON.parse(data)
                if (opts.timestamps) resolve(result)
                else resolve(result.text?.trim() || '')
              } catch { reject(new Error('Failed to parse transcription response')) }
            })
          })
          req.on('error', reject)
          req.on('timeout', () => { req.destroy(); reject(new Error('Transcription timeout')) })
          req.write(body)
          req.end()
        })
      }

      // Browser: input is Blob — convert webm→wav
      const wavBlob = await webmToWav(input)
      const form = new FormData()
      form.append('file', wavBlob, 'audio.wav')
      form.append('model', opts.model || model)
      form.append('language', language.split('-')[0])

      if (opts.timestamps) {
        form.append('response_format', 'verbose_json')
        form.append('timestamp_granularities[]', 'word')
      }

      const res = await fetch(url, { method: 'POST', headers, body: form })
      if (!res.ok) throw new Error(`Transcription failed: ${res.status}`)

      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('json')) throw new Error('Transcription service unavailable')

      const result = await res.json()
      if (opts.timestamps) return result
      return result.text?.trim() || ''
    }

    /**
     * Transcribe with word-level timestamps.
     * Returns { words: [{ word, start, end }], text, duration } or null.
     */
    async function transcribeWithTimestamps(input, opts = {}) {
      try {
        const result = await transcribe(input, { ...opts, timestamps: true })
        if (!result?.words?.length) return null
        return {
          words: result.words,
          text: result.text || '',
          duration: result.duration,
        }
      } catch {
        return null
      }
    }

    // ── Public API ──

    function startListening(onResult, onError) {
      if (mode === 'browser') return startWebSpeech(onResult, onError)
      return startWhisper(onResult, onError)
    }

    function stopListening() {
      if (mode === 'browser') stopWebSpeech()
      else stopWhisper()
    }

    function destroy() {
      stopListening()
    }

    return {
      startListening,
      stopListening,
      transcribe,
      transcribeWithTimestamps,
      destroy,
      get isListening() { return !!(mediaRecorder || webSpeechRecognition) },
    }
  }

  // ── createVoice ──────────────────────────────────────────────────

  function createVoice(options = {}) {
    const events = createEmitter()
    const tts = options.tts !== false ? createTTS(options.tts || {}) : null
    const stt = options.stt !== false ? createSTT(options.stt || {}) : null

    // Wire TTS progress/end events
    if (tts) {
      tts.onProgress(data => events.emit('progress', data))
      tts.onEnd(() => events.emit('playbackEnd'))
    }

    let _speaking = false

    const voice = {
      /** Speak text aloud */
      async speak(text, opts) {
        if (!tts) throw new Error('TTS not configured')
        if (stt?.isListening) return false

        _speaking = true
        events.emit('speaking', true)
        try {
          const result = await tts.speak(text, opts)
          return result
        } finally {
          _speaking = false
          events.emit('speaking', false)
        }
      },

      /** Fetch TTS audio without playing */
      async fetchAudio(text, opts) {
        if (!tts) throw new Error('TTS not configured')
        return tts.fetchAudio(text, opts)
      },

      /** Play an already-fetched ArrayBuffer */
      async playBuffer(arrayBuffer) {
        if (!tts) throw new Error('TTS not configured')
        _speaking = true
        events.emit('speaking', true)
        try {
          const result = await tts.playBuffer(arrayBuffer)
          return result
        } finally {
          _speaking = false
          events.emit('speaking', false)
        }
      },

      /** Get word-level timestamps for TTS output */
      async timestamps(text, opts) {
        if (!tts) throw new Error('TTS not configured')
        return tts.timestamps(text, opts)
      },

      /** Stop speaking */
      stop() {
        if (tts) tts.stop()
        _speaking = false
        events.emit('speaking', false)
      },

      /** Start listening (push-to-talk) */
      startListening() {
        if (!stt) throw new Error('STT not configured')
        if (tts) tts.stop()
        _speaking = false

        events.emit('listening', true)
        stt.startListening(
          (text) => {
            events.emit('listening', false)
            events.emit('transcript', text)
          },
          (err) => {
            events.emit('listening', false)
            events.emit('error', err)
          }
        )
      },

      /** Stop listening */
      stopListening() {
        if (stt) stt.stopListening()
        events.emit('listening', false)
      },

      /** Transcribe audio blob or file */
      async transcribe(input, opts) {
        if (!stt) throw new Error('STT not configured')
        return stt.transcribe(input, opts)
      },

      /** Transcribe with word-level timestamps */
      async transcribeWithTimestamps(input, opts) {
        if (!stt) throw new Error('STT not configured')
        return stt.transcribeWithTimestamps(input, opts)
      },

      /** Unlock audio context (call on user gesture) */
      unlock() { if (tts) tts.unlock() },

      /** Events */
      on(event, fn) { events.on(event, fn); return this },
      off(event, fn) { events.off(event, fn); return this },

      /** State */
      get isSpeaking() { return _speaking },
      get isListening() { return stt?.isListening || false },
      get progress() { return tts?.progress || 0 },
      get duration() { return tts?.duration || 0 },

      /** Cleanup */
      destroy() {
        if (tts) tts.destroy()
        if (stt) stt.destroy()
      },
    }

    return voice
  }

  return { createVoice, createTTS, createSTT }
})

