/* voice.js — Voice input (STT) + output (TTS) via Web Speech API */
const Voice = (() => {
  let enabled = false
  let recognition = null
  let synth = window.speechSynthesis

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

  function startListening(onResult) {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      console.warn('Speech recognition not supported')
      return
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    recognition = new SR()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'zh-CN'

    const btn = document.getElementById('voice-btn')
    if (btn) btn.classList.add('listening')

    recognition.onresult = (e) => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join('')
      const isFinal = e.results[e.results.length - 1].isFinal
      if (onResult) onResult(transcript, isFinal)
    }

    recognition.onend = () => {
      if (btn) btn.classList.remove('listening')
      recognition = null
    }

    recognition.onerror = (e) => {
      if (btn) btn.classList.remove('listening')
      recognition = null
    }

    recognition.start()
  }

  function stopListening() {
    if (recognition) { recognition.stop(); recognition = null }
    const btn = document.getElementById('voice-btn')
    if (btn) btn.classList.remove('listening')
  }

  function speak(text) {
    if (!enabled || !synth) return
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'zh-CN'
    utterance.rate = 1.1
    synth.speak(utterance)
  }

  function isEnabled() { return enabled }

  return { enable, disable, startListening, stopListening, speak, isEnabled }
})()
