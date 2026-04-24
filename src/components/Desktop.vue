<script setup>
import { useWindowsStore } from '../stores/windows'
import Window from './Window.vue'
import Finder from './windows/Finder.vue'
import Terminal from './windows/Terminal.vue'
import Settings from './windows/Settings.vue'

const store = useWindowsStore()

const renderers = {
  finder: Finder,
  terminal: Terminal,
  settings: Settings
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
