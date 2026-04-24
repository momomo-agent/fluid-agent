<script setup>
import { ref, watch } from 'vue'
import { useVFSStore } from '../../stores/vfs'
import { useEventBus } from '../../composables/useEventBus'

const props = defineProps({ win: Object })
const vfs = useVFSStore()
const bus = useEventBus()

const query = ref('')
const results = ref([])
const selectedIdx = ref(-1)
const inputEl = ref(null)

const builtins = [
  { icon: '📁', name: 'Finder', action: () => bus.emit('app.open', { type: 'finder' }) },
  { icon: '⬛', name: 'Terminal', action: () => bus.emit('app.open', { type: 'terminal' }) },
  { icon: '🌐', name: 'Browser', action: () => bus.emit('app.open', { type: 'browser' }) },
  { icon: '⚙️', name: 'Settings', action: () => bus.emit('app.open', { type: 'settings' }) },
  { icon: '🎵', name: 'Music', action: () => bus.emit('app.open', { type: 'music' }) },
]

function search(q) {
  if (!q.trim()) { results.value = []; selectedIdx.value = -1; return }
  const lower = q.toLowerCase()
  const items = []

  // Search VFS files
  function scanDir(path) {
    const entries = vfs.ls(path) || []
    for (const e of entries) {
      const fullPath = path === '/' ? `/${e.name}` : `${path}/${e.name}`
      if (e.name.toLowerCase().includes(lower)) {
        items.push({
          icon: e.type === 'dir' ? '📁' : '📄',
          label: e.name, hint: fullPath,
          action: () => bus.emit('window.open', e.type === 'dir' ? { type: 'finder', data: { path: fullPath } } : { type: 'editor', data: { path: fullPath }, title: e.name })
        })
      }
      if (e.type === 'dir' && items.length < 20) scanDir(fullPath)
    }
  }
  scanDir('/home/user')

  // Search builtins
  for (const b of builtins) {
    if (b.name.toLowerCase().includes(lower)) {
      items.push({ icon: b.icon, label: b.name, hint: 'System', action: b.action })
    }
  }

  // Always add "Ask agent"
  items.push({ icon: '✨', label: `Ask: "${q}"`, hint: 'Chat', action: () => bus.emit('chat.send', q) })

  results.value = items.slice(0, 8)
  selectedIdx.value = -1
}

watch(query, (v) => search(v))

function onKeydown(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx.value = Math.min(selectedIdx.value + 1, results.value.length - 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx.value = Math.max(selectedIdx.value - 1, 0) }
  else if (e.key === 'Enter') {
    e.preventDefault()
    const item = selectedIdx.value >= 0 ? results.value[selectedIdx.value] : results.value[0]
    if (item) item.action()
  }
}

function selectItem(item) {
  item.action()
}
</script>

<template>
  <div class="spotlight">
    <div class="spotlight-input-row">
      <span class="spotlight-icon">🔍</span>
      <input ref="inputEl" v-model="query" class="spotlight-input" placeholder="Search..." autofocus @keydown="onKeydown" />
    </div>
    <div v-if="results.length" class="spotlight-results">
      <div
        v-for="(item, i) in results" :key="i"
        class="spotlight-item" :class="{ selected: i === selectedIdx }"
        @click="selectItem(item)"
      >
        <span class="spot-icon">{{ item.icon }}</span>
        <span class="spot-label">{{ item.label }}</span>
        <span class="spot-hint">{{ item.hint }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.spotlight { display: flex; flex-direction: column; }
.spotlight-input-row { display: flex; align-items: center; padding: 8px 12px; gap: 8px; }
.spotlight-icon { font-size: 18px; }
.spotlight-input { flex: 1; background: none; border: none; color: var(--text-primary); font-size: 16px; outline: none; }
.spotlight-results { border-top: 1px solid rgba(255,255,255,0.06); max-height: 300px; overflow-y: auto; }
.spotlight-item { display: flex; align-items: center; gap: 8px; padding: 8px 16px; cursor: pointer; }
.spotlight-item:hover, .spotlight-item.selected { background: rgba(96,165,250,0.15); }
.spot-icon { font-size: 16px; width: 24px; text-align: center; }
.spot-label { flex: 1; font-size: 13px; color: var(--text-primary); }
.spot-hint { font-size: 11px; color: var(--text-muted); }
</style>
