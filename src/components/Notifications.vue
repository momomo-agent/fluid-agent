<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { EventBus } from '../composables/useEventBus'

const notifications = ref([])
let nextId = 0

function notify(text, { type = 'info', duration = 4000 } = {}) {
  const id = nextId++
  notifications.value.push({ id, text, type })
  setTimeout(() => dismiss(id), duration)
}

function dismiss(id) {
  const idx = notifications.value.findIndex(n => n.id === id)
  if (idx >= 0) notifications.value.splice(idx, 1)
}

function onNotify(data) {
  if (typeof data === 'string') notify(data)
  else notify(data.text || data.message, data)
}

onMounted(() => {
  EventBus.on('notify', onNotify)
  EventBus.on('toast', onNotify)
})

onUnmounted(() => {
  EventBus.off('notify', onNotify)
  EventBus.off('toast', onNotify)
})
</script>

<template>
  <Teleport to="body">
    <div class="notification-container">
      <TransitionGroup name="notif">
        <div
          v-for="n in notifications"
          :key="n.id"
          class="notification"
          :class="`notif-${n.type}`"
          @click="dismiss(n.id)"
        >
          {{ n.text }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.notification-container {
  position: fixed;
  top: 36px;
  right: 16px;
  z-index: 100001;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}
.notification {
  pointer-events: auto;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
  color: #e0e0e0;
  background: rgba(30, 30, 40, 0.92);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  max-width: 320px;
  word-break: break-word;
}
.notif-success { border-left: 3px solid #34d399; }
.notif-error { border-left: 3px solid #ef4444; }
.notif-warning { border-left: 3px solid #fbbf24; }
.notif-info { border-left: 3px solid #60a5fa; }

.notif-enter-active { transition: all 0.3s ease; }
.notif-leave-active { transition: all 0.2s ease; }
.notif-enter-from { opacity: 0; transform: translateX(30px); }
.notif-leave-to { opacity: 0; transform: translateX(30px); }
</style>
