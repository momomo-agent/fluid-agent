<script setup>
import { ref, reactive, onMounted, onUnmounted, computed } from 'vue'
import { useEventBus } from '../../composables/useEventBus'

const props = defineProps({ win: Object })
const bus = useEventBus()

const state = reactive({
  playlist: [
    { title: 'Midnight Drive', artist: 'Synthwave FM', color: '#60a5fa', duration: 128 },
    { title: 'Neon Lights', artist: 'Retro Wave', color: '#a78bfa', duration: 110 },
    { title: 'Ocean Breeze', artist: 'Lo-Fi Beats', color: '#34d399', duration: 171 },
    { title: 'City Rain', artist: 'Ambient Works', color: '#f472b6', duration: 154 },
    { title: 'Starlight', artist: 'Chillhop', color: '#fbbf24', duration: 118 },
  ],
  current: 0,
  playing: false,
  elapsed: 0,
})

let timer = null
let audioEl = null
let audioCtx = null
let synthNodes = []

const track = computed(() => state.playlist[state.current])
const progress = computed(() => track.value?.duration > 0 ? (state.elapsed / track.value.duration * 100) : 0)

function fmt(sec) {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
}

function play() {
  clearInterval(timer)
  state.playing = true
  const t = track.value
  if (t.url) {
    if (!audioEl) audioEl = new Audio()
    audioEl.src = t.url.replace(/^http:\/\//, 'https://')
    audioEl.currentTime = state.elapsed
    audioEl.play().catch(() => {})
    audioEl.onended = () => next()
    audioEl.onloadedmetadata = () => {
      if (!t._durSet) { t.duration = Math.floor(audioEl.duration) || t.duration || 180; t._durSet = true }
    }
    timer = setInterval(() => { state.elapsed = Math.floor(audioEl.currentTime || state.elapsed) }, 1000)
  } else {
    // Synth playback
    playSynth(state.current, state.elapsed)
    timer = setInterval(() => {
      state.elapsed += 1
      if (state.elapsed >= t.duration) next()
    }, 1000)
  }
  bus.emit('music.stateChange', { playing: true, current: t, playlistCount: state.playlist.length })
}

function pause() {
  clearInterval(timer)
  state.playing = false
  if (audioEl) audioEl.pause()
  stopSynth()
  bus.emit('music.stateChange', { playing: false, current: track.value, playlistCount: state.playlist.length })
}

function next() {
  pause()
  state.current = (state.current + 1) % state.playlist.length
  state.elapsed = 0
  play()
}

function prev() {
  pause()
  state.current = (state.current - 1 + state.playlist.length) % state.playlist.length
  state.elapsed = 0
  play()
}

function toggle() {
  if (state.playing) pause()
  else play()
}

function selectTrack(idx) {
  pause()
  state.current = idx
  state.elapsed = 0
  play()
}

// Synth engine (simplified Web Audio)
const NOTES = { C3:130.81, D3:146.83, E3:164.81, F3:174.61, G3:196, A3:220, B3:246.94, C4:261.63, D4:293.66, E4:329.63, F4:349.23, G4:392, A4:440, B4:493.88, C5:523.25, D5:587.33, E5:659.25, G5:783.99 }
const TRACKS_DEF = [
  { melody:['E4','G4','A4','B4','A4','G4','E4','D4','E4','G4','A4','G4','E4','D4','C4','D4'], bass:['C3','C3','A3','A3','F3','F3','G3','G3'], tempo:120, wave:'sine', filterFreq:800 },
  { melody:['C5','E4','G4','C5','E5','C5','G4','E4','D5','B4','G4','D4','B4','G4','D4','G4'], bass:['C3','C3','G3','G3','D3','D3','G3','G3'], tempo:140, wave:'square', filterFreq:1200 },
  { melody:['G4','A4','B4','D5','B4','A4','G4','E4','D4','E4','G4','A4','G4','E4','D4','E4'], bass:['G3','G3','E3','E3','C3','C3','D3','D3'], tempo:90, wave:'triangle', filterFreq:600 },
  { melody:['A4','C5','E5','A4','G4','E4','C4','D4','E4','A4','G4','F4','E4','D4','C4','E4'], bass:['A3','A3','F3','F3','C3','C3','E3','E3'], tempo:100, wave:'sawtooth', filterFreq:900 },
  { melody:['C4','E4','G4','C5','G4','E4','C4','G4','A4','C5','E5','C5','A4','G4','E4','C4'], bass:['C3','C3','A3','A3','F3','F3','G3','G3'], tempo:130, wave:'triangle', filterFreq:1500 },
]

function stopSynth() {
  synthNodes.forEach(n => { try { n.stop?.(); n.disconnect?.() } catch {} })
  synthNodes = []
}

function playSynth(trackIdx, startAt = 0) {
  stopSynth()
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  if (audioCtx.state === 'suspended') audioCtx.resume()
  const ac = audioCtx
  const def = TRACKS_DEF[trackIdx % TRACKS_DEF.length]
  if (!def) return
  const beatDur = 60 / def.tempo
  const master = ac.createGain(); master.gain.value = 0.25; master.connect(ac.destination)
  const filter = ac.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = def.filterFreq; filter.connect(master)
  const now = ac.currentTime; const startTime = now - startAt
  for (let loop = 0; loop < 4; loop++) {
    def.melody.forEach((note, i) => {
      const t = (loop * def.melody.length + i) * beatDur; const ns = startTime + t
      if (ns < now) return
      const osc = ac.createOscillator(); const env = ac.createGain()
      osc.type = def.wave; osc.frequency.value = NOTES[note] || 440
      env.gain.setValueAtTime(0, ns); env.gain.linearRampToValueAtTime(0.35, ns + 0.05); env.gain.exponentialRampToValueAtTime(0.01, ns + beatDur * 0.9)
      osc.connect(env); env.connect(filter); osc.start(ns); osc.stop(ns + beatDur); synthNodes.push(osc)
    })
  }
}

// EventBus controls
function onMusicControl({ action, track: trackIdx }) {
  if (trackIdx != null && trackIdx >= 0 && trackIdx < state.playlist.length) {
    pause(); state.current = trackIdx; state.elapsed = 0
  }
  if (action === 'play' || action === 'open') { if (!state.playing) play() }
  else if (action === 'pause') pause()
  else if (action === 'next') next()
  else if (action === 'prev') prev()
}

function onAddTrack({ title, artist, url, artwork }) {
  state.playlist.push({ title: title || 'Unknown', artist: artist || 'Unknown', url, artwork, color: '#60a5fa', duration: 180 })
}

onMounted(() => {
  bus.on('music.control', onMusicControl)
  bus.on('music.addTrack', onAddTrack)
})

onUnmounted(() => {
  pause()
  bus.off('music.control', onMusicControl)
  bus.off('music.addTrack', onAddTrack)
})
</script>

<template>
  <div class="music-player">
    <div class="music-art" :style="{ background: `linear-gradient(135deg, ${track?.color || '#60a5fa'}33, ${track?.color || '#60a5fa'}11)` }">
      <img v-if="track?.artwork" :src="track.artwork" class="music-art-img" alt="" />
      <div v-else class="music-art-icon" :style="{ color: track?.color || '#60a5fa' }">{{ state.playing ? '♫' : '♪' }}</div>
    </div>
    <div class="music-info">
      <div class="music-title">{{ track?.title }}</div>
      <div class="music-artist">{{ track?.artist }}</div>
    </div>
    <div class="music-progress">
      <div class="music-bar"><div class="music-bar-fill" :style="{ width: progress + '%', background: track?.color }" /></div>
      <div class="music-times"><span>{{ fmt(state.elapsed) }}</span><span>{{ fmt(track?.duration || 0) }}</span></div>
    </div>
    <div class="music-controls">
      <button class="music-btn" @click="prev">⏮</button>
      <button class="music-btn music-play" @click="toggle">{{ state.playing ? '⏸' : '▶' }}</button>
      <button class="music-btn" @click="next">⏭</button>
    </div>
    <div class="music-list">
      <div
        v-for="(t, i) in state.playlist" :key="i"
        class="music-track" :class="{ active: i === state.current }"
        @click="selectTrack(i)"
      >
        <img v-if="t.artwork" :src="t.artwork" class="music-track-thumb" alt="" />
        <span v-else class="music-track-dot" :style="{ background: t.color || '#60a5fa' }" />
        <span class="music-track-title">{{ t.title }}</span>
        <span class="music-track-artist">{{ t.artist }}</span>
        <span class="music-track-dur">{{ fmt(t.duration) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.music-player { display: flex; flex-direction: column; height: 100%; padding: 16px; gap: 12px; }
.music-art { height: 120px; border-radius: 12px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.music-art-img { width: 100%; height: 100%; object-fit: cover; }
.music-art-icon { font-size: 48px; }
.music-info { text-align: center; }
.music-title { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.music-artist { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
.music-progress { }
.music-bar { height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; }
.music-bar-fill { height: 100%; border-radius: 2px; transition: width 0.3s linear; }
.music-times { display: flex; justify-content: space-between; font-size: 10px; color: var(--text-muted); margin-top: 4px; }
.music-controls { display: flex; justify-content: center; gap: 16px; }
.music-btn { background: none; border: none; color: var(--text-secondary); font-size: 20px; cursor: pointer; padding: 4px 8px; border-radius: 8px; }
.music-btn:hover { background: rgba(255,255,255,0.06); }
.music-play { font-size: 28px; }
.music-list { flex: 1; overflow-y: auto; }
.music-track { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 12px; }
.music-track:hover { background: rgba(255,255,255,0.04); }
.music-track.active { background: rgba(96,165,250,0.12); }
.music-track-thumb { width: 28px; height: 28px; border-radius: 4px; object-fit: cover; }
.music-track-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.music-track-title { flex: 1; color: var(--text-primary); }
.music-track-artist { color: var(--text-muted); }
.music-track-dur { color: var(--text-muted); font-size: 11px; }
</style>
