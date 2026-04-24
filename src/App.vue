<script setup>
import { onMounted } from 'vue'
import { useWindowsStore } from './stores/windows'
import { EventBus } from './composables/useEventBus'
import MenuBar from './components/MenuBar.vue'
import Desktop from './components/Desktop.vue'
import ChatPanel from './components/ChatPanel.vue'
import Dock from './components/Dock.vue'

const windows = useWindowsStore()

// Open default Finder window
onMounted(() => {
  windows.create({ type: 'finder', title: 'Desktop', width: 600, height: 400, data: { path: '/home/user/Desktop' } })
})

// Handle app.open events from Dock
EventBus.on('app.open', ({ type }) => {
  const sizes = {
    finder: { width: 600, height: 400 },
    terminal: { width: 580, height: 380 },
    settings: { width: 420, height: 480 },
    browser: { width: 800, height: 600 },
    music: { width: 340, height: 480 },
    video: { width: 640, height: 420 },
    map: { width: 600, height: 450 },
    launchpad: { width: 700, height: 500 },
    spotlight: { width: 500, height: 60 }
  }
  const titles = {
    finder: 'Finder', terminal: 'Terminal', settings: 'Settings',
    browser: 'Browser', music: 'Music', video: 'Video',
    map: 'Map', launchpad: 'Launchpad', spotlight: 'Search'
  }
  const s = sizes[type] || { width: 500, height: 400 }
  windows.create({ type, title: titles[type] || type, ...s })
})
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
