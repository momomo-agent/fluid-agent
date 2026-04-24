<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAgentStore } from '../stores/agent'
import { EventBus } from '../composables/useEventBus'

const agentStore = useAgentStore()
const time = ref('')
const activity = ref('')
let activityTimer = null

function updateClock() {
  const now = new Date()
  const date = now.toLocaleDateString([], { month: 'short', day: 'numeric', weekday: 'short' })
  const t = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  time.value = `${date}  ${t}`
}

const currentTask = computed(() => {
  const ct = agentStore.blackboard.currentTask
  if (ct && ct.status === 'running') return ct.goal?.slice(0, 30) || 'Working...'
  return null
})

function onActivity(text) {
  activity.value = text
  clearTimeout(activityTimer)
  activityTimer = setTimeout(() => { activity.value = '' }, 4000)
}

let clockTimer
onMounted(() => {
  updateClock()
  clockTimer = setInterval(updateClock, 30000)
  EventBus.on('activity', onActivity)
})
onUnmounted(() => {
  clearInterval(clockTimer)
  EventBus.off('activity', onActivity)
})
</script>

<template>
  <div id="menu-bar">
    <div class="menu-left">
      <span class="menu-logo">✦</span>
      <span class="menu-app-name">FluidOS</span>
    </div>
    <div class="menu-center">
      <div v-if="currentTask" class="task-island">
        <div class="spinner" />
        <span class="island-goal">{{ currentTask }}</span>
      </div>
      <div v-else-if="activity" class="activity-text">{{ activity }}</div>
    </div>
    <div class="menu-right">
      <span class="menu-clock">{{ time }}</span>
    </div>
  </div>
</template>

<style scoped>
.menu-center { flex: 1; display: flex; justify-content: center; align-items: center; }
.task-island { display: flex; align-items: center; gap: 6px; padding: 2px 12px; border-radius: 12px; background: rgba(96,165,250,0.12); font-size: 11px; color: #60a5fa; }
.spinner { width: 10px; height: 10px; border: 2px solid rgba(96,165,250,0.3); border-top-color: #60a5fa; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.island-goal { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.activity-text { font-size: 11px; color: var(--text-muted); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
