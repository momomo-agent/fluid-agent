/* audio-synth.js — Procedural music generator using Web Audio API */
const AudioSynth = (() => {
  let ctx = null
  let currentNodes = []
  let playing = false
  let onEndCallback = null

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  }

  // Note frequencies
  const NOTES = {
    C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
    C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
    C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99,
  }

  // Track definitions — each has melody, chords, tempo, and synth style
  const TRACKS = [
    {
      // Midnight Drive — dreamy synth
      melody: ['E4','G4','A4','B4','A4','G4','E4','D4','E4','G4','A4','G4','E4','D4','C4','D4'],
      bass: ['C3','C3','A3','A3','F3','F3','G3','G3'],
      tempo: 120, wave: 'sine', filterFreq: 800, attack: 0.05, release: 0.3,
    },
    {
      // Neon Lights — bright arpeggios
      melody: ['C5','E4','G4','C5','E5','C5','G4','E4','D5','B4','G4','D4','B4','G4','D4','G4'],
      bass: ['C3','C3','G3','G3','D3','D3','G3','G3'],
      tempo: 140, wave: 'square', filterFreq: 1200, attack: 0.01, release: 0.15,
    },
    {
      // Ocean Breeze — gentle pad
      melody: ['G4','A4','B4','D5','B4','A4','G4','E4','D4','E4','G4','A4','G4','E4','D4','E4'],
      bass: ['G3','G3','E3','E3','C3','C3','D3','D3'],
      tempo: 90, wave: 'triangle', filterFreq: 600, attack: 0.1, release: 0.5,
    },
    {
      // City Rain — moody minor
      melody: ['A4','C5','E5','A4','G4','E4','C4','D4','E4','A4','G4','F4','E4','D4','C4','E4'],
      bass: ['A3','A3','F3','F3','C3','C3','E3','E3'],
      tempo: 100, wave: 'sawtooth', filterFreq: 900, attack: 0.02, release: 0.25,
    },
    {
      // Starlight — playful bounce
      melody: ['C4','E4','G4','C5','G4','E4','C4','G4','A4','C5','E5','C5','A4','G4','E4','C4'],
      bass: ['C3','C3','A3','A3','F3','F3','G3','G3'],
      tempo: 130, wave: 'triangle', filterFreq: 1500, attack: 0.01, release: 0.2,
    },
  ]

  function stop() {
    playing = false
    currentNodes.forEach(n => { try { n.stop?.(); n.disconnect?.() } catch {} })
    currentNodes = []
  }

  function play(trackIndex, startAt = 0, onEnd) {
    stop()
    const ac = getCtx()
    const track = TRACKS[trackIndex % TRACKS.length]
    if (!track) return
    playing = true
    onEndCallback = onEnd

    const beatDur = 60 / track.tempo
    const totalBeats = track.melody.length * 4 // loop 4 times
    const totalDuration = totalBeats * beatDur

    // Master gain
    const master = ac.createGain()
    master.gain.value = 0.3
    master.connect(ac.destination)

    // Low-pass filter
    const filter = ac.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = track.filterFreq
    filter.connect(master)

    // Reverb via delay
    const delay = ac.createDelay()
    delay.delayTime.value = beatDur * 0.75
    const delayGain = ac.createGain()
    delayGain.gain.value = 0.2
    delay.connect(delayGain)
    delayGain.connect(filter)

    const now = ac.currentTime
    const startTime = now - startAt

    // Melody
    for (let loop = 0; loop < 4; loop++) {
      track.melody.forEach((note, i) => {
        const t = (loop * track.melody.length + i) * beatDur
        const noteStart = startTime + t
        if (noteStart < now) return // skip past notes

        const osc = ac.createOscillator()
        const env = ac.createGain()
        osc.type = track.wave
        osc.frequency.value = NOTES[note] || 440
        env.gain.setValueAtTime(0, noteStart)
        env.gain.linearRampToValueAtTime(0.4, noteStart + track.attack)
        env.gain.exponentialRampToValueAtTime(0.01, noteStart + beatDur * 0.9)
        osc.connect(env)
        env.connect(filter)
        env.connect(delay)
        osc.start(noteStart)
        osc.stop(noteStart + beatDur)
        currentNodes.push(osc)
      })
    }

    // Bass
    for (let loop = 0; loop < 4; loop++) {
      track.bass.forEach((note, i) => {
        const t = (loop * track.bass.length + i) * beatDur * 2
        const noteStart = startTime + t
        if (noteStart < now) return

        const osc = ac.createOscillator()
        const env = ac.createGain()
        osc.type = 'sine'
        osc.frequency.value = NOTES[note] || 130
        env.gain.setValueAtTime(0, noteStart)
        env.gain.linearRampToValueAtTime(0.25, noteStart + 0.05)
        env.gain.exponentialRampToValueAtTime(0.01, noteStart + beatDur * 1.8)
        osc.connect(env)
        env.connect(master)
        osc.start(noteStart)
        osc.stop(noteStart + beatDur * 2)
        currentNodes.push(osc)
      })
    }

    // Hi-hat (noise bursts)
    for (let loop = 0; loop < 4; loop++) {
      for (let i = 0; i < track.melody.length; i++) {
        if (i % 2 !== 0) continue
        const t = (loop * track.melody.length + i) * beatDur
        const noteStart = startTime + t
        if (noteStart < now) continue

        const bufferSize = ac.sampleRate * 0.05
        const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate)
        const data = buffer.getChannelData(0)
        for (let j = 0; j < bufferSize; j++) data[j] = Math.random() * 2 - 1
        const noise = ac.createBufferSource()
        noise.buffer = buffer
        const noiseGain = ac.createGain()
        noiseGain.gain.setValueAtTime(0.08, noteStart)
        noiseGain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.05)
        const hipass = ac.createBiquadFilter()
        hipass.type = 'highpass'
        hipass.frequency.value = 8000
        noise.connect(hipass)
        hipass.connect(noiseGain)
        noiseGain.connect(master)
        noise.start(noteStart)
        noise.stop(noteStart + 0.05)
        currentNodes.push(noise)
      }
    }

    // Schedule end
    const endTime = (startTime + totalDuration - now) * 1000
    if (endTime > 0) {
      setTimeout(() => { if (playing) onEndCallback?.() }, endTime)
    }

    return totalDuration
  }

  function getDuration(trackIndex) {
    const track = TRACKS[trackIndex % TRACKS.length]
    if (!track) return 0
    return (track.melody.length * 4 * 60) / track.tempo
  }

  function isPlaying() { return playing }

  function addTrack(def) {
    // def: { melody, bass, tempo, wave, filterFreq, attack, release }
    TRACKS.push(def)
    return TRACKS.length - 1
  }

  return { play, stop, getDuration, isPlaying, TRACKS, addTrack }
})()
