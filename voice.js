/* voice.js — Voice I/O: ElevenLabs (premium) or Web Speech API (free fallback) */
const Voice = (() => {
  let enabled = false
  let voice = null // agentic-voice instance
  let listening = false
  let recognition = null // Web Speech API fallback
  let mode = 'none' // 'elevenlabs' | 'webspeech' | 'none'

  function getSettings() {
    return window._settingsCache || {}
  }

  function initElevenLabs() {
    const s = getSettings()
    if (!s.elevenLabsKey) return null
    if (voice) return voice
    try {
      voice = AgenticVoice.createVoice({
        tts: {
          provider: 'elevenlabs',
          apiKey: s.elevenLabsKey,
          voice: s.elevenLabsVoice || 'JBFqnCBsd6RMkjVDRZzb',
          model: 'eleven_turbo_v2_5',
        },
        stt: {
          provider: 'elevenlabs',
          apiKey: s.elevenLabsKey,
          model: 'scribe_v1',
          mode: 'whisper',
        },
      })
      voice.on('transcript', onTranscript)
      voice.on('error', err => console.warn('[Voice EL]', err))
      mode = 'elevenlabs'
      return voice
    } catch (e) {
      console.warn('[Voice] ElevenLabs init failed:', e)
      return null
    }
  }

  function initWebSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return null
    if (recognition) return recognition
    recognition = new SR()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-US'

    let finalTranscript = ''
    let interimDiv = null

    recognition.onstart = () => {
      finalTranscript = ''
      // Show interim indicator
      interimDiv = document.getElementById('voice-interim')
      if (interimDiv) interimDiv.style.display = 'block'
    }

    recognition.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalTranscript += e.results[i][0].transcript
        } else {
          interim += e.results[i][0].transcript
        }
      }
      // Show interim text
      if (interimDiv) interimDiv.textContent = interim || finalTranscript || '...'
    }

    recognition.onend = () => {
      if (interimDiv) { interimDiv.style.display = 'none'; interimDiv.textContent = '' }
      if (finalTranscript.trim()) {
        onTranscript(finalTranscript.trim())
      }
      listening = false
      updateBtn()
    }

    recognition.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.warn('[Voice WebSpeech]', e.error)
      }
      listening = false
      updateBtn()
    }

    mode = 'webspeech'
    return recognition
  }

  function init() {
    // Try ElevenLabs first, fall back to Web Speech API
    if (initElevenLabs()) return 'elevenlabs'
    if (initWebSpeech()) return 'webspeech'
    return 'none'
  }

  function onTranscript(text) {
    const input = document.getElementById('chat-input')
    if (input && text) {
      input.value = text
      document.getElementById('chat-send')?.click()
    }
  }

  function updateBtn() {
    const btn = document.getElementById('voice-btn')
    if (!btn) return
    btn.classList.toggle('listening', listening)
  }

  function enable() {
    enabled = true
    init()
    const btn = document.getElementById('voice-btn')
    if (btn) btn.style.display = 'flex'
  }

  function disable() {
    enabled = false
    stopListening()
    const btn = document.getElementById('voice-btn')
    if (btn) btn.style.display = 'none'
  }

  function startListening() {
    const m = init()
    if (m === 'none') { WindowManager.openSettings(); return }
    listening = true
    updateBtn()
    if (mode === 'elevenlabs' && voice) {
      voice.startListening()
    } else if (mode === 'webspeech' && recognition) {
      try { recognition.start() } catch (e) { /* already started */ }
    }
  }

  function stopListening() {
    listening = false
    updateBtn()
    if (mode === 'elevenlabs' && voice) {
      voice.stopListening()
    } else if (mode === 'webspeech' && recognition) {
      try { recognition.stop() } catch (e) {}
    }
  }

  function toggleListening() {
    if (listening) stopListening()
    else startListening()
  }

  async function speak(text) {
    if (!enabled) return
    if (mode === 'elevenlabs' && voice) {
      try { await voice.speak(text) } catch (e) { console.warn('[Voice TTS]', e) }
      return
    }
    // Web Speech TTS fallback
    if ('speechSynthesis' in window) {
      const utter = new SpeechSynthesisUtterance(text)
      utter.rate = 1.0
      utter.pitch = 1.0
      window.speechSynthesis.speak(utter)
    }
  }

  function isEnabled() { return enabled }
  function isListening() { return listening }
  function getMode() { return mode }

  return { enable, disable, startListening, stopListening, toggleListening, speak, isEnabled, isListening, getMode }
})()
