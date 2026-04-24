<script setup>
import { ref, onMounted } from 'vue'
import { useEventBus } from '../../composables/useEventBus'

const props = defineProps({ win: Object })
const bus = useEventBus()

const url = ref(props.win?.data?.url || '')
const displayUrl = ref(url.value || 'about:blank')
const fetchedContent = ref('')
const isLoading = ref(false)
const urlInput = ref(null)

const bookmarks = [
  { name: 'Wikipedia', url: 'https://en.wikipedia.org' },
  { name: 'Hacker News', url: 'https://news.ycombinator.com' },
  { name: 'GitHub', url: 'https://github.com' },
  { name: 'MDN', url: 'https://developer.mozilla.org' },
]

onMounted(() => {
  if (url.value) navigate(url.value)
  bus.on('browser.control', onBrowserControl)
})

function onBrowserControl({ action, url: newUrl }) {
  if (action === 'navigate' && newUrl) navigate(newUrl)
  else if (action === 'back') goHome()
}

async function navigate(newUrl) {
  let u = newUrl.trim()
  if (u && !u.match(/^https?:\/\//)) u = 'https://' + u
  url.value = u
  displayUrl.value = u
  fetchedContent.value = ''
  isLoading.value = true

  try {
    const res = await fetch(`https://proxy.link2web.site?url=${encodeURIComponent(u)}&mode=llm`, {
      headers: { 'Accept': 'text/plain' }
    })
    const text = await res.text()
    // Convert markdown-ish to simple HTML
    fetchedContent.value = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#60a5fa">$1</a>')
      .replace(/\n/g, '<br>')
  } catch (e) {
    fetchedContent.value = `<div style="color:#f87171">Error: ${e.message}</div>`
  }
  isLoading.value = false
}

function goHome() {
  url.value = ''
  displayUrl.value = 'about:blank'
  fetchedContent.value = ''
  isLoading.value = false
}

function onUrlKeydown(e) {
  if (e.key === 'Enter') navigate(displayUrl.value)
}
</script>

<template>
  <div class="browser-window">
    <div class="browser-toolbar">
      <button class="browser-nav-btn" @click="goHome">◀</button>
      <button class="browser-nav-btn" @click="url && navigate(url)">↻</button>
      <div class="browser-url-bar">
        <input ref="urlInput" v-model="displayUrl" class="browser-url-input" @keydown="onUrlKeydown" />
      </div>
    </div>
    <div class="browser-content">
      <div v-if="!url" class="browser-home">
        <div class="browser-home-logo">🌐</div>
        <div class="browser-home-title">FluidOS Browser</div>
        <div class="browser-bookmarks">
          <div v-for="b in bookmarks" :key="b.url" class="browser-bookmark" @click="navigate(b.url)">{{ b.name }}</div>
        </div>
      </div>
      <div v-else-if="isLoading" class="browser-loading">Loading...</div>
      <div v-else-if="fetchedContent" class="browser-fetched" v-html="fetchedContent" />
      <div v-else class="browser-loading">Failed to load</div>
    </div>
  </div>
</template>

<style scoped>
.browser-window { display: flex; flex-direction: column; height: 100%; }
.browser-toolbar { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.browser-nav-btn { background: none; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: var(--text-secondary); cursor: pointer; padding: 3px 8px; font-size: 13px; }
.browser-nav-btn:hover { background: rgba(255,255,255,0.06); }
.browser-url-bar { flex: 1; }
.browser-url-input { width: 100%; padding: 5px 10px; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; background: rgba(255,255,255,0.04); color: var(--text-primary); font-size: 12px; outline: none; box-sizing: border-box; }
.browser-url-input:focus { border-color: #60a5fa; }
.browser-content { flex: 1; overflow-y: auto; }
.browser-home { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 16px; }
.browser-home-logo { font-size: 48px; }
.browser-home-title { font-size: 18px; color: var(--text-primary); font-weight: 500; }
.browser-bookmarks { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.browser-bookmark { padding: 6px 14px; border-radius: 8px; background: rgba(255,255,255,0.06); color: var(--text-secondary); font-size: 13px; cursor: pointer; }
.browser-bookmark:hover { background: rgba(255,255,255,0.1); color: var(--text-primary); }
.browser-loading { padding: 40px; text-align: center; color: var(--text-muted); }
.browser-fetched { padding: 16px; font-size: 13px; line-height: 1.6; color: var(--text-primary); }
</style>
