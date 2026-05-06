<script setup>
import { ref, computed, onMounted } from 'vue'
import { useWindowsStore } from '../stores/windows'

const props = defineProps({
  win: { type: Object, required: true }
})

const store = useWindowsStore()
const isFocused = computed(() => store.focusedId === props.win.id)
const snapZone = ref(null)

// --- Drag ---
const dragging = ref(false)
let dragStart = { x: 0, y: 0, winX: 0, winY: 0 }

function disableIframePointers() {
  document.querySelectorAll('.window-body iframe').forEach(f => f.style.pointerEvents = 'none')
}
function enableIframePointers() {
  document.querySelectorAll('.window-body iframe').forEach(f => f.style.pointerEvents = '')
}

function getSnapZone(clientX, clientY) {
  const threshold = 20
  const w = window.innerWidth
  const h = window.innerHeight
  const atLeft = clientX < threshold
  const atRight = clientX > w - threshold
  const atTop = clientY < threshold
  const atBottom = clientY > h - threshold

  if (atTop && atLeft) return 'top-left'
  if (atTop && atRight) return 'top-right'
  if (atBottom && atLeft) return 'bottom-left'
  if (atBottom && atRight) return 'bottom-right'
  if (atLeft) return 'left'
  if (atRight) return 'right'
  if (atTop) return 'top'
  return null
}

function onTitleMouseDown(e) {
  if (e.target.closest('.window-dot')) return
  dragging.value = true
  dragStart = { x: e.clientX, y: e.clientY, winX: props.win.x, winY: props.win.y }
  store.focus(props.win.id)
  disableIframePointers()
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}

function onDragMove(e) {
  if (!dragging.value) return
  const dx = e.clientX - dragStart.x
  const dy = e.clientY - dragStart.y
  store.move(props.win.id, dragStart.winX + dx, dragStart.winY + dy)
  snapZone.value = getSnapZone(e.clientX, e.clientY)
}

function onDragEnd(e) {
  dragging.value = false
  enableIframePointers()
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)

  // Apply snap if in a zone
  if (snapZone.value) {
    store.snapWindow(props.win.id, snapZone.value)
    snapZone.value = null
  }
}

// --- Resize ---
const resizing = ref(false)
let resizeStart = { x: 0, y: 0, w: 0, h: 0 }

function onResizeMouseDown(e) {
  e.stopPropagation()
  resizing.value = true
  resizeStart = { x: e.clientX, y: e.clientY, w: props.win.width, h: props.win.height }
  disableIframePointers()
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
  enableIframePointers()
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
    :class="{ focused: isFocused, 'window-terminal': win.type === 'terminal', dragging: dragging, resizing: resizing }"
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

    <!-- Snap preview overlay -->
    <Teleport to="body">
      <div v-if="snapZone" class="snap-preview" :class="`snap-${snapZone}`" />
    </Teleport>
  </div>
</template>

<style scoped>
.snap-preview {
  position: fixed;
  background: rgba(100, 150, 255, 0.15);
  border: 2px solid rgba(100, 150, 255, 0.4);
  border-radius: 8px;
  z-index: 99999;
  pointer-events: none;
  transition: all 0.15s ease;
}
.snap-left { top: 0; left: 0; width: 50%; height: 100%; }
.snap-right { top: 0; right: 0; width: 50%; height: 100%; }
.snap-top { top: 0; left: 0; width: 100%; height: 50%; }
.snap-bottom { bottom: 0; left: 0; width: 100%; height: 50%; }
.snap-top-left { top: 0; left: 0; width: 50%; height: 50%; }
.snap-top-right { top: 0; right: 0; width: 50%; height: 50%; }
.snap-bottom-left { bottom: 0; left: 0; width: 50%; height: 50%; }
.snap-bottom-right { bottom: 0; right: 0; width: 50%; height: 50%; }
</style>
