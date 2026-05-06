<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useWindowsStore } from '../stores/windows'
import { EventBus } from '../composables/useEventBus'
import Window from './Window.vue'
import Finder from './windows/Finder.vue'
import Terminal from './windows/Terminal.vue'
import Settings from './windows/Settings.vue'
import Editor from './windows/Editor.vue'
import Browser from './windows/Browser.vue'
import Music from './windows/Music.vue'
import Video from './windows/Video.vue'
import MapView from './windows/Map.vue'
import Launchpad from './windows/Launchpad.vue'
import Spotlight from './windows/Spotlight.vue'
import DynamicApp from './windows/DynamicApp.vue'
import ImageViewer from './windows/ImageViewer.vue'
import TaskManager from './windows/TaskManager.vue'

const store = useWindowsStore()
const wallpaperStyle = ref('')

const PRESETS = {
  midnight: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)',
  ocean: 'linear-gradient(135deg, #141e30, #243b55)',
  sunset: 'linear-gradient(135deg, #1a0533, #4a1942, #c84b31)',
  forest: 'linear-gradient(135deg, #0d1b0e, #1a3a2a, #2d5a3f)',
  aurora: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)',
  default: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0d0d2b 100%)'
}

function onWallpaperChange({ css, url, preset }) {
  if (preset && PRESETS[preset]) {
    wallpaperStyle.value = `background: ${PRESETS[preset]}`
  } else if (url) {
    wallpaperStyle.value = `background: url(${url}) center/cover no-repeat`
  } else if (css) {
    wallpaperStyle.value = `background: ${css}`
  }
  localStorage.setItem('fluid-wallpaper', wallpaperStyle.value)
}

onMounted(() => {
  const saved = localStorage.getItem('fluid-wallpaper')
  if (saved) wallpaperStyle.value = saved
  EventBus.on('wallpaper.change', onWallpaperChange)
})
onUnmounted(() => {
  EventBus.off('wallpaper.change', onWallpaperChange)
})

const renderers = {
  finder: Finder,
  terminal: Terminal,
  settings: Settings,
  editor: Editor,
  browser: Browser,
  music: Music,
  video: Video,
  map: MapView,
  launchpad: Launchpad,
  spotlight: Spotlight,
  dynamicapp: DynamicApp,
  image: ImageViewer,
  taskmanager: TaskManager,
}

function getRenderer(type) {
  return renderers[type] || null
}
</script>

<template>
  <div id="desktop-area" :style="wallpaperStyle">
    <Window
      v-for="win in store.windowList"
      :key="win.id"
      :win="win"
    >
      <component
        v-if="getRenderer(win.type)"
        :is="getRenderer(win.type)"
        :win="win"
      />
      <div v-else class="unknown-window">
        <p>{{ win.type }}</p>
      </div>
    </Window>
  </div>
</template>

<style scoped>
#desktop-area {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0d0d2b 100%);
  transition: background 0.5s ease;
}
.unknown-window {
  padding: 20px;
  color: var(--text-muted);
  text-align: center;
}
</style>
