<script setup>
import { computed } from 'vue'
import { useEventBus } from '../../composables/useEventBus'
import { useVFSStore } from '../../stores/vfs'

const bus = useEventBus()
const vfs = useVFSStore()

const builtinApps = [
  { id: 'finder', name: 'Finder', icon: '📁' },
  { id: 'terminal', name: 'Terminal', icon: '⬛' },
  { id: 'browser', name: 'Browser', icon: '🌐' },
  { id: 'music', name: 'Music', icon: '🎵' },
  { id: 'video', name: 'Video', icon: '🎬' },
  { id: 'map', name: 'Map', icon: '🗺️' },
  { id: 'settings', name: 'Settings', icon: '⚙️' },
]

const customApps = computed(() => {
  const dirs = vfs.ls('/home/user/apps') || []
  return dirs.filter(d => d.type === 'dir').map(d => {
    let icon = '💻'
    try {
      const manifest = vfs.readFile(`/home/user/apps/${d.name}/manifest.json`)
      if (manifest) icon = JSON.parse(manifest).icon || '💻'
    } catch {}
    return { id: d.name, name: d.name, icon, custom: true }
  })
})

const allApps = computed(() => [...builtinApps, ...customApps.value])

function openApp(app) {
  bus.emit('app.open', { type: app.id })
}
</script>

<template>
  <div class="launchpad">
    <div class="lp-grid">
      <div v-for="app in allApps" :key="app.id" class="lp-item" @click="openApp(app)">
        <div class="lp-icon">{{ app.icon }}</div>
        <div class="lp-name">{{ app.name }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.launchpad { height: 100%; overflow-y: auto; padding: 20px; }
.lp-grid { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.lp-item { width: 80px; padding: 12px 4px; text-align: center; border-radius: 12px; cursor: pointer; transition: background 0.15s; }
.lp-item:hover { background: rgba(255,255,255,0.08); }
.lp-icon { font-size: 36px; margin-bottom: 6px; }
.lp-name { font-size: 11px; color: var(--text-primary); }
</style>
