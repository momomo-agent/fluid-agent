<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAgentStore } from '../stores/agent'
import { useDispatcherStore } from '../stores/dispatcher'
import { EventBus } from '../composables/useEventBus'

const agentStore = useAgentStore()
const dispatcher = useDispatcherStore()
const time = ref('')
const activity = ref('')
const hoverExpanded = ref(false)
let activityTimer = null
let hoverLeaveTimer = null

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

const taskDetail = computed(() => agentStore.blackboard.currentTask)

const activeWorkers = computed(() => {
  return [...dispatcher.workers.values()].filter(w => w.status === 'running')
})

const suspendedWorkers = computed(() => {
  return [...dispatcher.workers.values()].filter(w => w.status === 'suspended')
})

const pendingCount = computed(() => dispatcher.pending.length)

function onIslandEnter() {
  clearTimeout(hoverLeaveTimer)
  hoverExpanded.value = true
}

function onIslandLeave() {
  hoverLeaveTimer = setTimeout(() => { hoverExpanded.value = false }, 300)
}

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
      <div
        v-if="currentTask"
        class="task-island"
        @mouseenter="onIslandEnter"
        @mouseleave="onIslandLeave"
      >
        <div class="spinner" />
        <span class="island-goal">{{ currentTask }}</span>
        <!-- Hover panel -->
        <div v-if="hoverExpanded" class="island-panel" @mouseenter="onIslandEnter" @mouseleave="onIslandLeave">
          <div class="island-panel-section">
            <div class="island-panel-label">Current Task</div>
            <div class="island-panel-value">{{ taskDetail?.goal || 'N/A' }}</div>
          </div>
          <div v-if="taskDetail?.steps?.length" class="island-panel-section">
            <div class="island-panel-label">Progress</div>
            <div class="island-panel-value">
              {{ taskDetail.steps.filter(s => s.status === 'done').length }} / {{ taskDetail.steps.length }} steps
            </div>
          </div>
          <div class="island-panel-section">
            <div class="island-panel-label">Active Workers</div>
            <div class="island-panel-value">{{ activeWorkers.length }}</div>
          </div>
          <div v-if="suspendedWorkers.length" class="island-panel-section">
            <div class="island-panel-label">Suspended</div>
            <div class="island-panel-value">{{ suspendedWorkers.length }}</div>
          </div>
          <div v-if="pendingCount" class="island-panel-section">
            <div class="island-panel-label">Queued</div>
            <div class="island-panel-value">{{ pendingCount }} task{{ pendingCount > 1 ? 's' : '' }}</div>
          </div>
        </div>
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
.task-island { display: flex; align-items: center; gap: 6px; padding: 2px 12px; border-radius: 12px; background: rgba(96,165,250,0.12); font-size: 11px; color: #60a5fa; position: relative; cursor: default; }
.spinner { width: 10px; height: 10px; border: 2px solid rgba(96,165,250,0.3); border-top-color: #60a5fa; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.island-goal { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.activity-text { font-size: 11px; color: var(--text-muted); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.island-panel {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: 6px;
  background: rgba(30, 30, 40, 0.95);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  padding: 10px 14px;
  min-width: 180px;
  z-index: 9999;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}
.island-panel-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
}
.island-panel-section + .island-panel-section {
  border-top: 1px solid rgba(255,255,255,0.05);
}
.island-panel-label {
  font-size: 11px;
  color: rgba(255,255,255,0.5);
}
.island-panel-value {
  font-size: 11px;
  color: var(--text-primary);
  font-weight: 500;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
