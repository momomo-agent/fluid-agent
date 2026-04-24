<script setup>
import { ref, reactive } from 'vue'

const playlist = reactive([])
const currentIndex = ref(-1)
const playing = ref(false)
const progress = ref(0)
let audio = null
let timer = null

function play(index) {
  if (index >= 0 && index < playlist.length) currentIndex.value = index
  if (currentIndex.value < 0 && playlist.length > 0) currentIndex.value = 0
  if (currentIndex.value < 0) return
  const track = playlist[currentIndex.value]
  if (!track.url) return
  if (audio) audio.pause()
  audio = new Audio(track.url)
  audio.play()
  playing.value = true
  audio.onended = () => next()
  timer = setInterval(() => {
    if (audio) progress.value = (audio.currentTime / audio.duration) * 100 || 0
  }, 500)
}

function pause() { if (audio) { audio.pause(); playing.value = false } }
function next() { if (currentIndex.value < playlist.length - 1) play(currentIndex.value + 1); else { playing.value = false; progress.value = 0 } }
function prev() { if (currentIndex.value > 0) play(currentIndex.value - 1) }

const current = () => currentIndex.value >= 0 ? playlist[currentIndex.value] : null
</script>
<template>
  <div class="music-player">
    <div class="music-art">{{ current()?.artwork ? '🎵' : '🎶' }}</div>
    <div class="music-info">
      <div class="music-title">{{ current()?.title || 'No track' }}</div>
      <div class="music-artist">{{ current()?.artist || '' }}</div>
    </div>
    <div class="music-progress"><div class="music-bar" :style="{ width: progress + '%' }" /></div>
    <div class="music-controls">
      <button @click="prev">⏮</button>
      <button @click="playing ? pause() : play(-1)">{{ playing ? '⏸' : '▶️' }}</button>
      <button @click="next">⏭</button>
    </div>
    <div class="music-playlist">
      <div v-for="(track, i) in playlist" :key="i" class="music-track" :class="{ active: i === currentIndex }" @click="play(i)">
        <span>{{ track.title }}</span>
        <span class="music-track-artist">{{ track.artist }}</span>
      </div>
      <div v-if="playlist.length === 0" class="music-empty">No tracks</div>
    </div>
  </div>
</template>
<style scoped>
.music-player { display: flex; flex-direction: column; height: 100%; padding: 16px; gap: 12px; background: linear-gradient(135deg, #1a1a2e, #16213e); color: white; }
.music-art { font-size: 64px; text-align: center; padding: 20px 0; }
.music-info { text-align: center; }
.music-title { font-size: 16px; font-weight: 600; }
.music-artist { font-size: 13px; opacity: 0.6; margin-top: 4px; }
.music-progress { height: 3px; background: rgba(255,255,255,0.15); border-radius: 2px; overflow: hidden; }
.music-bar { height: 100%; background: var(--accent); transition: width 0.3s; }
.music-controls { display: flex; justify-content: center; gap: 16px; }
.music-controls button { background: none; border: none; color: white; font-size: 24px; cursor: pointer; opacity: 0.8; }
.music-controls button:hover { opacity: 1; }
.music-playlist { flex: 1; overflow-y: auto; }
.music-track { padding: 8px 12px; border-radius: 6px; cursor: pointer; display: flex; justify-content: space-between; font-size: 13px; }
.music-track:hover { background: rgba(255,255,255,0.08); }
.music-track.active { background: rgba(255,255,255,0.12); }
.music-track-artist { opacity: 0.5; }
.music-empty { text-align: center; opacity: 0.4; padding: 20px; }
</style>
