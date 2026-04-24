<script setup>
import { computed } from 'vue'
import { useWindowsStore } from '../stores/windows'
import { EventBus } from '../composables/useEventBus'

const store = useWindowsStore()

const pinnedApps = [
  { id: 'launchpad', icon: '🚀', title: 'Launchpad' },
  { id: 'finder', icon: '📁', title: 'Finder' },
  { id: 'terminal', icon: '⬛', title: 'Terminal' },
  { id: 'browser', icon: '🌐', title: 'Browser' },
  { id: 'music', icon: '🎵', title: 'Music' },
  { id: 'video', icon: '🎬', title: 'Video' },
  { id: 'map', icon: '🗺️', title: 'Map' },
  { id: 'settings', icon: '⚙️', title: 'Settings' },
  { id: 'spotlight', icon: '🔍', title: 'Search' }
]

const pinnedTypes = new Set(pinnedApps.map(a => a.id))

// Running windows that aren't pinned types
const runningWindows = computed(() =>
  store.windowList.filter(w => !pinnedTypes.has(w.type) && !w.minimized)
)

function isActive(type) {
  return store.windowList.some(w => w.type === type)
}

function isFocused(type) {
  return store.windowList.some(w => w.type === type && store.focusedId === w.id)
}

function openApp(type) {
  const existing = store.findByType(type)
  if (existing) {
    store.focus(existing.id)
  } else {
    EventBus.emit('app.open', { type })
  }
}

function focusRunning(id) {
  const win = store.windows.get(id)
  if (win?.minimized) store.focus(id)
  else store.focus(id)
}
</script>

<template>
  <div id="dock">
    <div class="dock-pinned">
      <div
        v-for="app in pinnedApps"
        :key="app.id"
        class="dock-item"
        :class="{ 'dock-active': isActive(app.id), 'dock-focused': isFocused(app.id) }"
        :title="app.title"
        @click="openApp(app.id)"
      >
        {{ app.icon }}
      </div>
    </div>
    <div v-if="runningWindows.length" class="dock-separator" />
    <div class="dock-running">
      <div
        v-for="win in runningWindows"
        :key="win.id"
        class="dock-item dock-app"
        :class="{ 'dock-focused': store.focusedId === win.id }"
        :title="win.title"
        @click="focusRunning(win.id)"
      >
        {{ win.data?.icon || '⚡' }}
      </div>
    </div>
  </div>
</template>
