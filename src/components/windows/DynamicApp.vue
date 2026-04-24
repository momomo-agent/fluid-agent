<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useVFSStore } from '../../stores/vfs'
import { useEventBus } from '../../composables/useEventBus'

const props = defineProps({ win: Object })
const vfs = useVFSStore()
const bus = useEventBus()
const iframeEl = ref(null)

const appDir = computed(() => props.win?.data?.appDir || '')
const appId = computed(() => props.win?.data?.id || props.win?.data?.name || '')

function buildDoc() {
  if (!appDir.value) return '<html><body><p>No app loaded</p></body></html>'
  const html = vfs.readFile(`${appDir.value}/index.html`) || vfs.readFile(`${appDir.value}/view.html`) || '<p>No view</p>'
  const css = vfs.readFile(`${appDir.value}/style.css`) || ''
  const js = vfs.readFile(`${appDir.value}/script.js`) || ''
  const data = vfs.readFile(`${appDir.value}/data.json`) || '{}'

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#e2e8f0;background:#1a1b2e}${css}</style>
</head><body>
${html}
<script>
window.__appData = ${data};
try { ${js} } catch(e) { console.error('[DynamicApp]', e) }
<\/script></body></html>`
}

function onUpdate({ id }) {
  if (id === appId.value && iframeEl.value) {
    iframeEl.value.srcdoc = buildDoc()
  }
}

onMounted(() => {
  bus.on('dynamicapp.update', onUpdate)
})
</script>

<template>
  <div class="dynamic-app">
    <iframe ref="iframeEl" :srcdoc="buildDoc()" sandbox="allow-scripts" />
  </div>
</template>

<style scoped>
.dynamic-app { width: 100%; height: 100%; }
.dynamic-app iframe { width: 100%; height: 100%; border: none; }
</style>
