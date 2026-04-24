<script setup>
import { ref, computed } from 'vue'

const props = defineProps({ win: Object })
const url = ref(props.win?.data?.url || '')
const urlInput = ref('')

const isYouTube = computed(() => {
  const m = url.value.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]+)/)
  return m ? m[1] : null
})

function play(newUrl) {
  url.value = newUrl.trim()
}

function onUrlGo() {
  if (urlInput.value.trim()) play(urlInput.value.trim())
}
</script>

<template>
  <div class="video-player">
    <div v-if="url" class="video-content">
      <iframe
        v-if="isYouTube"
        :src="`https://www.youtube.com/embed/${isYouTube}?autoplay=1`"
        frameborder="0"
        allow="autoplay; encrypted-media"
        allowfullscreen
      />
      <video v-else :src="url" controls autoplay />
    </div>
    <div v-else class="video-empty">
      <div class="video-empty-icon">🎬</div>
      <div class="video-empty-text">Drop a video URL to play</div>
      <div class="video-url-bar">
        <input v-model="urlInput" class="video-url-input" placeholder="Paste video URL..." @keydown.enter="onUrlGo" />
        <button class="video-url-go" @click="onUrlGo">▶</button>
      </div>
      <div class="video-samples">
        <div class="video-sample" @click="play('https://www.youtube.com/embed/dQw4w9WgXcQ')">Sample: Rick Astley</div>
        <div class="video-sample" @click="play('https://www.youtube.com/embed/jNQXAC9IVRw')">Sample: First YouTube Video</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.video-player { display: flex; flex-direction: column; height: 100%; background: #111; }
.video-content { flex: 1; display: flex; }
.video-content iframe, .video-content video { width: 100%; height: 100%; border: none; object-fit: contain; }
.video-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }
.video-empty-icon { font-size: 48px; }
.video-empty-text { color: var(--text-muted); font-size: 14px; }
.video-url-bar { display: flex; gap: 6px; width: 80%; max-width: 400px; }
.video-url-input { flex: 1; padding: 8px 12px; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; background: rgba(255,255,255,0.04); color: var(--text-primary); font-size: 13px; outline: none; }
.video-url-input:focus { border-color: #60a5fa; }
.video-url-go { padding: 8px 14px; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; background: rgba(255,255,255,0.06); color: var(--text-secondary); cursor: pointer; font-size: 14px; }
.video-url-go:hover { background: rgba(255,255,255,0.1); }
.video-samples { display: flex; gap: 8px; margin-top: 8px; }
.video-sample { padding: 6px 12px; border-radius: 6px; background: rgba(255,255,255,0.06); color: var(--text-muted); font-size: 12px; cursor: pointer; }
.video-sample:hover { background: rgba(255,255,255,0.1); color: var(--text-secondary); }
</style>
