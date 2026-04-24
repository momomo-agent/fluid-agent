import { ref } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { getAgenticVoice } from '../lib/agentic.js'
import { EventBus } from './useEventBus.js'

const enabled = ref(false)
const listening = ref(false)
const mode = ref('none') // 'elevenlabs' | 'webspeech' | 'none'

let voice = null
let recognition = null

export function useVoice() {
  const settings = useSettingsStore()

  function initElevenLabs() {
    const AgenticVoice = getAgenticVoice()
    if (!AgenticVoice || !settings.voiceId) return null
    if (voice) return voice
    try {
      voice = AgenticVoice.createVoice({
        tts: { provider: 'elevenlabs', apiKey: settings.voiceId, voice: settings.voiceId || 'JBFqnCBsd6RMkjVDRZzb', model: 'eleven_turbo_v2_5' },
        stt: { provider: 'elevenlabs', apiKey: settings.voiceId, model: 'scribe_v1', mode: 'whisper' },
      })
      voice.on('transcript', onTranscript)
      mode.value = 'elevenlabs'
      return voice
    } catch { return null }
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
    recognition.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript
      }
    }
    recognition.onend = () => {
      if (finalTranscript.trim()) onTranscript(finalTranscript.trim())
      finalTranscript = ''
      listening.value = false
    }
    recognition.onerror = () => { listening.value = false }
    mode.value = 'webspeech'
    return recognition
  }

  function init() {
    if (initElevenLabs()) return 'elevenlabs'
    if (initWebSpeech()) return 'webspeech'
    return 'none'
  }

  function onTranscript(text) {
    EventBus.emit('chat.send', text)
  }

  function enable() {
    enabled.value = true
    init()
  }

  function disable() {
    enabled.value = false
    stopListening()
  }

  function startListening() {
    if (init() === 'none') return
    listening.value = true
    if (mode.value === 'elevenlabs' && voice) voice.startListening()
    else if (mode.value === 'webspeech' && recognition) {
      try { recognition.start() } catch {}
    }
  }

  function stopListening() {
    listening.value = false
    if (mode.value === 'elevenlabs' && voice) voice.stopListening()
    else if (mode.value === 'webspeech' && recognition) {
      try { recognition.stop() } catch {}
    }
  }

  async function speak(text) {
    if (!enabled.value) return
    if (mode.value === 'elevenlabs' && voice) {
      try { await voice.speak(text) } catch {}
      return
    }
    if ('speechSynthesis' in window) {
      const utter = new SpeechSynthesisUtterance(text)
      window.speechSynthesis.speak(utter)
    }
  }

  // Listen for speak events
  EventBus.on('voice.speak', (text) => speak(text))

  return { enabled, listening, mode, enable, disable, startListening, stopListening, speak }
}
