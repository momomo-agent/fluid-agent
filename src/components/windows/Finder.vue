<script setup>
import { ref, computed, watch } from 'vue'
import { useVFSStore } from '../../stores/vfs'
import { useEventBus } from '../../composables/useEventBus'

const props = defineProps({ win: Object })
const vfs = useVFSStore()
const bus = useEventBus()

const currentPath = ref(props.win?.data?.path || '/home/user/Desktop')
const history = ref([currentPath.value])
const historyIdx = ref(0)
const viewMode = ref('grid')
const selected = ref(null)

const entries = computed(() => vfs.ls(currentPath.value) || [])
const segments = computed(() => {
  if (currentPath.value === '/') return ['/']
  return currentPath.value.split('/').filter(Boolean)
})

const favorites = [
  { name: 'Desktop', path: '/home/user/Desktop', icon: '🖥️' },
  { name: 'Documents', path: '/home/user/Documents', icon: '📄' },
  { name: 'Downloads', path: '/home/user/Downloads', icon: '📥' },
]
const locations = [
  { name: 'Home', path: '/home/user', icon: '🏠' },
]

function fileIcon(name) {
  if (name.endsWith('.txt') || name.endsWith('.md')) return '📄'
  if (name.endsWith('.js')) return '🟨'
  if (name.endsWith('.html')) return '🌐'
  if (name.endsWith('.css')) return '🎨'
  if (name.endsWith('.json')) return '📋'
  if (name.endsWith('.py')) return '🐍'
  return '📄'
}

function formatSize(bytes) {
  if (bytes == null) return '—'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function navigateTo(path) {
  history.value = history.value.slice(0, historyIdx.value + 1)
  history.value.push(path)
  historyIdx.value = history.value.length - 1
  currentPath.value = path
  selected.value = null
}

function goBack() {
  if (historyIdx.value > 0) {
    historyIdx.value--
    currentPath.value = history.value[historyIdx.value]
    selected.value = null
  }
}

function goForward() {
  if (historyIdx.value < history.value.length - 1) {
    historyIdx.value++
    currentPath.value = history.value[historyIdx.value]
    selected.value = null
  }
}

function goUp() {
  const parts = currentPath.value.split('/').filter(Boolean)
  parts.pop()
  navigateTo('/' + parts.join('/') || '/')
}

function segmentPath(index) {
  return '/' + segments.value.slice(0, index + 1).join('/')
}

function selectItem(name) {
  selected.value = name
}

function openItem(name, type) {
  if (name === '..') {
    goUp()
  } else if (type === 'dir') {
    const newPath = currentPath.value === '/' ? `/${name}` : `${currentPath.value}/${name}`
    navigateTo(newPath)
  } else {
    const filePath = currentPath.value === '/' ? `/${name}` : `${currentPath.value}/${name}`
    bus.emit('window.open', { type: 'editor', path: filePath, title: name })
  }
}

function toggleView() {
  viewMode.value = viewMode.value === 'grid' ? 'list' : 'grid'
}
</script>

<template>
  <div class="finder">
    <div class="finder-layout">
      <div class="finder-sidebar">
        <div class="finder-sidebar-section">Favorites</div>
        <div
          v-for="f in favorites" :key="f.path"
          class="finder-sidebar-item"
          :class="{ active: currentPath === f.path }"
          @click="navigateTo(f.path)"
        >{{ f.icon }} {{ f.name }}</div>
        <div class="finder-sidebar-section">Locations</div>
        <div
          v-for="l in locations" :key="l.path"
          class="finder-sidebar-item"
          :class="{ active: currentPath === l.path }"
          @click="navigateTo(l.path)"
        >{{ l.icon }} {{ l.name }}</div>
      </div>
      <div class="finder-main">
        <div class="finder-toolbar">
          <button class="finder-nav-btn" :disabled="historyIdx <= 0" @click="goBack">◀</button>
          <button class="finder-nav-btn" :disabled="historyIdx >= history.length - 1" @click="goForward">▶</button>
          <div class="finder-breadcrumb">
            <span
              v-for="(seg, i) in segments" :key="i"
              class="finder-crumb"
              @click="navigateTo(segmentPath(i))"
            >{{ seg }}</span>
          </div>
          <button class="finder-view-btn" @click="toggleView">{{ viewMode === 'grid' ? '☰' : '⊞' }}</button>
        </div>

        <!-- Grid View -->
        <div v-if="viewMode === 'grid'" class="finder-grid">
          <div v-if="currentPath !== '/'" class="finder-item" @dblclick="goUp">
            <div class="icon">⬆️</div><div class="name">..</div>
          </div>
          <div
            v-for="entry in entries" :key="entry.name"
            class="finder-item"
            :class="{ 'finder-selected': selected === entry.name }"
            @click="selectItem(entry.name)"
            @dblclick="openItem(entry.name, entry.type)"
          >
            <div class="icon">{{ entry.type === 'dir' ? '📁' : fileIcon(entry.name) }}</div>
            <div class="name">{{ entry.name }}</div>
          </div>
          <div v-if="entries.length === 0 && currentPath === '/'" class="finder-empty">Empty folder</div>
        </div>

        <!-- List View -->
        <div v-else class="finder-list-view">
          <div class="finder-list-header">
            <span class="finder-col-name">Name</span>
            <span class="finder-col-size">Size</span>
          </div>
          <div v-if="currentPath !== '/'" class="finder-list-row" @dblclick="goUp">
            <span class="finder-col-name">⬆️ ..</span>
            <span class="finder-col-size">—</span>
          </div>
          <div
            v-for="entry in entries" :key="entry.name"
            class="finder-list-row"
            :class="{ 'finder-selected': selected === entry.name }"
            @click="selectItem(entry.name)"
            @dblclick="openItem(entry.name, entry.type)"
          >
            <span class="finder-col-name">{{ entry.type === 'dir' ? '📁' : fileIcon(entry.name) }} {{ entry.name }}</span>
            <span class="finder-col-size">{{ entry.type === 'dir' ? '—' : formatSize(entry.size) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.finder { display: flex; flex-direction: column; height: 100%; }
.finder-layout { display: flex; flex: 1; overflow: hidden; }
.finder-sidebar { width: 160px; padding: 8px; border-right: 1px solid rgba(255,255,255,0.06); overflow-y: auto; flex-shrink: 0; }
.finder-sidebar-section { font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; padding: 8px 8px 4px; letter-spacing: 0.5px; }
.finder-sidebar-item { padding: 5px 8px; border-radius: 6px; font-size: 12px; cursor: default; color: var(--text-secondary); }
.finder-sidebar-item:hover { background: rgba(255,255,255,0.06); }
.finder-sidebar-item.active { background: rgba(96,165,250,0.15); color: var(--text-primary); }
.finder-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.finder-toolbar { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.finder-nav-btn { background: none; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: var(--text-secondary); cursor: pointer; padding: 2px 8px; font-size: 12px; }
.finder-nav-btn:disabled { opacity: 0.3; cursor: default; }
.finder-nav-btn:hover:not(:disabled) { background: rgba(255,255,255,0.06); }
.finder-breadcrumb { flex: 1; display: flex; align-items: center; gap: 2px; font-size: 12px; color: var(--text-muted); overflow: hidden; }
.finder-crumb { cursor: pointer; padding: 2px 4px; border-radius: 3px; white-space: nowrap; }
.finder-crumb:hover { background: rgba(255,255,255,0.06); color: var(--text-primary); }
.finder-crumb + .finder-crumb::before { content: '/'; margin-right: 2px; opacity: 0.4; }
.finder-view-btn { background: none; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: var(--text-secondary); cursor: pointer; padding: 2px 6px; font-size: 14px; }
.finder-grid { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-wrap: wrap; align-content: flex-start; gap: 4px; }
.finder-item { width: 80px; padding: 8px 4px; text-align: center; border-radius: 6px; cursor: default; }
.finder-item:hover { background: rgba(255,255,255,0.06); }
.finder-item.finder-selected { background: rgba(96,165,250,0.2); }
.finder-item .icon { font-size: 32px; margin-bottom: 4px; }
.finder-item .name { font-size: 11px; color: var(--text-primary); word-break: break-all; line-height: 1.3; }
.finder-list-view { flex: 1; overflow-y: auto; }
.finder-list-header { display: flex; padding: 6px 12px; font-size: 11px; font-weight: 600; color: var(--text-muted); border-bottom: 1px solid rgba(255,255,255,0.06); }
.finder-list-row { display: flex; padding: 5px 12px; font-size: 12px; cursor: default; border-bottom: 1px solid rgba(255,255,255,0.03); }
.finder-list-row:hover { background: rgba(255,255,255,0.04); }
.finder-list-row.finder-selected { background: rgba(96,165,250,0.15); }
.finder-col-name { flex: 1; color: var(--text-primary); }
.finder-col-size { width: 80px; text-align: right; color: var(--text-muted); }
.finder-empty { padding: 40px; text-align: center; color: var(--text-muted); font-size: 13px; }
</style>
