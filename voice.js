/* voice.js — Voice I/O via agentic-voice (ElevenLabs STT + TTS) */
const Voice = (() => {
  let enabled = false
  let voice = null
  let listening = false

  function getSettings() {
    return JSON.parse(localStorage.getItem('fluid-settings') || '{}')
  }

  function init() {
    const s = getSettings()
    if (!s.elevenLabsKey) return null
    if (voice) return voice
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
      },
    })
    voice.on('transcript', text => {
      const input = document.getElementById('chat-input')
      if (input && text) {
        input.value = text
        // Auto-send
        document.getElementById('chat-send')?.click()
      }
    })
    voice.on('error', err => console.warn('[Voice]', err))
    return voice
  }

  function enable() {
    enabled = true
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
    const v = init()
    if (!v) { WindowManager.openSettings(); return }
    listening = true
    const btn = document.getElementById('voice-btn')
    if (btn) btn.classList.add('listening')
    v.startListening()
  }

  function stopListening() {
    listening = false
    const btn = document.getElementById('voice-btn')
    if (btn) btn.classList.remove('listening')
    if (voice) voice.stopListening()
  }

  function toggleListening() {
    if (listening) stopListening()
    else startListening()
  }

  async function speak(text) {
    if (!enabled) return
    const v = init()
    if (!v) return
    try { await v.speak(text) } catch (e) { console.warn('[Voice TTS]', e) }
  }

  function isEnabled() { return enabled }
  function isListening() { return listening }

  return { enable, disable, startListening, stopListening, toggleListening, speak, isEnabled, isListening }
})()
