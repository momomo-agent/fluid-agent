<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useWindowsStore } from './stores/windows'
import { useSettingsStore } from './stores/settings'
import { useAgent } from './composables/useAgent'
import { registerCapabilities } from './composables/useCapabilities'
import { EventBus } from './composables/useEventBus'
import MenuBar from './components/MenuBar.vue'
import Desktop from './components/Desktop.vue'
import ChatPanel from './components/ChatPanel.vue'
import Dock from './components/Dock.vue'

const windows = useWindowsStore()
const settings = useSettingsStore()
const agent = useAgent()

const SIZES = {
  finder: { width: 650, height: 420 },
  terminal: { width: 580, height: 380 },
  settings: { width: 560, height: 460 },
  editor: { width: 600, height: 450 },
  browser: { width: 900, height: 580 },
  music: { width: 340, height: 480 },
  video: { width: 700, height: 460 },
  map: { width: 700, height: 500 },
  launchpad: { width: 520, height: 420 },
  spotlight: { width: 500, height: 60 },
  dynamicapp: { width: 420, height: 360 },
  image: { width: 600, height: 450 },
  taskmanager: { width: 650, height: 420 },
}

const TITLES = {
  finder: 'Finder', terminal: 'Terminal', settings: 'Settings',
  editor: 'Editor', browser: 'Browser', music: 'Music',
  video: 'Video', map: 'Map', launchpad: 'Launchpad',
  spotlight: 'Search', taskmanager: 'Task Manager', image: 'Image',
}

// Singleton window types
const SINGLETONS = new Set(['settings', 'music', 'map', 'launchpad', 'taskmanager'])

function openWindow(opts) {
  const type = opts.type
  // Singleton check
  if (SINGLETONS.has(type)) {
    const existing = windows.findByType(type)
    if (existing) { windows.focus(existing.id); return }
  }
  const size = SIZES[type] || { width: 500, height: 400 }
  const title = opts.title || TITLES[type] || type
  windows.create({ type, title, ...size, data: opts.data || opts })
}

onMounted(() => {
  // Register all capabilities
  registerCapabilities()

  // Configure agent if settings exist
  if (settings.isConfigured()) {
    agent.configure()
    agent.loadSkills()
    agent.startProactiveLoop()
  }

  // Open default window
  openWindow({ type: 'finder', data: { path: '/home/user/Desktop' } })

  // If not configured, also open settings
  if (!settings.isConfigured()) {
    openWindow({ type: 'settings' })
  }

  // Listen for window open events
  EventBus.on('app.open', openWindow)
  EventBus.on('window.open', openWindow)

  // Keyboard shortcuts
  document.addEventListener('keydown', onGlobalKeydown)
})

onUnmounted(() => {
  EventBus.off('app.open', openWindow)
  EventBus.off('window.open', openWindow)
  document.removeEventListener('keydown', onGlobalKeydown)
  agent.stopProactiveLoop()
})

function onGlobalKeydown(e) {
  // Cmd/Ctrl+Space → Spotlight
  if ((e.metaKey || e.ctrlKey) && e.code === 'Space') {
    e.preventDefault()
    const existing = windows.findByType('spotlight')
    if (existing) windows.close(existing.id)
    else openWindow({ type: 'spotlight' })
    return
  }
  // Cmd/Ctrl+K → focus chat
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    document.querySelector('#chat-panel textarea')?.focus()
    return
  }
  // Escape → close focused window
  if (e.key === 'Escape') {
    const spotWin = windows.findByType('spotlight')
    if (spotWin) { windows.close(spotWin.id); return }
    if (windows.focusedId) windows.close(windows.focusedId)
  }
}
</script>

<template>
  <div id="fluid-os">
    <MenuBar />
    <div id="main-area">
      <Desktop />
      <ChatPanel />
    </div>
    <Dock />
  </div>
</template>

<style scoped>
#fluid-os {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-desktop);
}
#main-area {
  flex: 1;
  display: flex;
  overflow: hidden;
}
</style>
