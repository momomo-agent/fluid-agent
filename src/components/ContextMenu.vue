<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const visible = ref(false)
const x = ref(0)
const y = ref(0)
const items = ref([])

function show(event, menuItems) {
  event.preventDefault()
  x.value = event.clientX
  y.value = event.clientY
  items.value = menuItems
  visible.value = true
}

function hide() {
  visible.value = false
  items.value = []
}

function onItemClick(item) {
  if (item.action) item.action()
  hide()
}

function onGlobalClick() {
  if (visible.value) hide()
}

function onContextMenu(e) {
  // Default context menu items based on target
  const target = e.target
  const menuItems = []

  // Desktop area
  if (target.id === 'desktop-area' || target.closest('#desktop-area') && !target.closest('.window')) {
    menuItems.push(
      { label: 'New File', icon: '📄', action: () => window._contextActions?.newFile?.() },
      { label: 'New Folder', icon: '📁', action: () => window._contextActions?.newFolder?.() },
      { type: 'separator' },
      { label: 'Tile Windows', icon: '🪟', action: () => window._contextActions?.tileWindows?.() },
      { type: 'separator' },
      { label: 'Change Wallpaper', icon: '🎨', action: () => window._contextActions?.changeWallpaper?.() },
    )
  }

  if (menuItems.length > 0) {
    show(e, menuItems)
  }
}

onMounted(() => {
  document.addEventListener('click', onGlobalClick)
  document.addEventListener('contextmenu', onContextMenu)
})

onUnmounted(() => {
  document.removeEventListener('click', onGlobalClick)
  document.removeEventListener('contextmenu', onContextMenu)
})

// Expose show/hide for programmatic use
defineExpose({ show, hide })
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="context-menu"
      :style="{ left: x + 'px', top: y + 'px' }"
    >
      <template v-for="(item, i) in items" :key="i">
        <div v-if="item.type === 'separator'" class="context-separator" />
        <div
          v-else
          class="context-item"
          :class="{ disabled: item.disabled }"
          @click="onItemClick(item)"
        >
          <span v-if="item.icon" class="context-icon">{{ item.icon }}</span>
          <span class="context-label">{{ item.label }}</span>
          <span v-if="item.shortcut" class="context-shortcut">{{ item.shortcut }}</span>
        </div>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 100000;
  min-width: 180px;
  background: rgba(30, 30, 40, 0.95);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
.context-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: #e0e0e0;
  transition: background 0.1s;
}
.context-item:hover { background: rgba(59, 130, 246, 0.2); }
.context-item.disabled { opacity: 0.4; pointer-events: none; }
.context-icon { font-size: 14px; width: 20px; text-align: center; }
.context-label { flex: 1; }
.context-shortcut { font-size: 11px; color: #888; }
.context-separator { height: 1px; background: rgba(255, 255, 255, 0.08); margin: 4px 8px; }
</style>
