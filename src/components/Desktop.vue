<script setup>
import { useWindowsStore } from '../stores/windows'
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
  <div id="desktop-area">
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
}
.unknown-window {
  padding: 20px;
  color: var(--text-muted);
  text-align: center;
}
</style>
