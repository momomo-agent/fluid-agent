<script setup>
import { ref, computed, onMounted } from 'vue'
import { useWindowsStore } from '../stores/windows'

const props = defineProps({
  win: { type: Object, required: true }
})

const store = useWindowsStore()
const isFocused = computed(() => store.focusedId === props.win.id)

// --- Drag ---
const dragging = ref(false)
let dragStart = { x: 0, y: 0, winX: 0, winY: 0 }

function onTitleMouseDown(e) {
  if (e.target.closest('.window-dot')) return
  dragging.value = true
  dragStart = { x: e.clientX, y: e.clientY, winX: props.win.x, winY: props.win.y }
  store.focus(props.win.id)
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}

function onDragMove(e) {
  if (!dragging.value) return
  const dx = e.clientX - dragStart.x
  const dy = e.clientY - dragStart.y
  store.move(props.win.id, dragStart.winX + dx, dragStart.winY + dy)
}

function onDragEnd() {
  dragging.value = false
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
}

// --- Resize ---
const resizing = ref(false)
let resizeStart = { x: 0, y: 0, w: 0, h: 0 }

function onResizeMouseDown(e) {
  e.stopPropagation()
  resizing.value = true
  resizeStart = { x: e.clientX, y: e.clientY, w: props.win.width, h: props.win.height }
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
}

function onResizeMove(e) {
  if (!resizing.value) return
  const dw = e.clientX - resizeStart.x
  const dh = e.clientY - resizeStart.y
  store.resize(props.win.id, resizeStart.w + dw, resizeStart.h + dh)
}

function onResizeEnd() {
  resizing.value = false
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
}

function onWindowClick() {
  store.focus(props.win.id)
}

const style = computed(() => ({
  left: `${props.win.x}px`,
  top: `${props.win.y}px`,
  width: `${props.win.width}px`,
  height: `${props.win.height}px`,
  zIndex: props.win.zIndex,
  display: props.win.minimized ? 'none' : 'flex'
}))
</script>

<template>
  <div
    class="window"
    :class="{ focused: isFocused, 'window-terminal': win.type === 'terminal' }"
    :style="style"
    @mousedown="onWindowClick"
  >
    <!-- Title bar -->
    <div class="window-titlebar" @mousedown="onTitleMouseDown">
      <div class="window-dots">
        <span class="window-dot close" @click.stop="store.close(win.id)" />
        <span class="window-dot minimize" @click.stop="store.minimize(win.id)" />
        <span class="window-dot maximize" @click.stop="store.toggleMaximize(win.id)" />
      </div>
      <span class="window-title">{{ win.title }}</span>
    </div>

    <!-- Body -->
    <div class="window-body">
      <slot />
    </div>

    <!-- Resize handle -->
    <div class="window-resize" @mousedown="onResizeMouseDown" />
  </div>
</template>
