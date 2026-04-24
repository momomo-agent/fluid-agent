<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAgentStore } from '../../stores/agent'
import { useEventBus } from '../../composables/useEventBus'

const agentStore = useAgentStore()
const bus = useEventBus()
const activeTab = ref('tasks')

const tasks = computed(() => agentStore.taskHistory)
const currentTask = computed(() => agentStore.blackboard.currentTask)
const selectedTask = ref(null)

const selected = computed(() => {
  if (selectedTask.value) return tasks.value.find(t => t.id === selectedTask.value)
  return tasks.value[0] || null
})

function stepIcon(status) {
  if (status === 'done') return '✓'
  if (status === 'running') return '▶'
  if (status === 'error' || status === 'aborted') return '✕'
  return '○'
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

// Auto-refresh
let refreshTimer = null
const tick = ref(0)
onMounted(() => { refreshTimer = setInterval(() => tick.value++, 2000) })
onUnmounted(() => clearInterval(refreshTimer))
</script>

<template>
  <div class="tm-layout">
    <div class="tm-tabs">
      <button class="tm-tab" :class="{ active: activeTab === 'tasks' }" @click="activeTab = 'tasks'">Tasks</button>
      <button class="tm-tab" :class="{ active: activeTab === 'log' }" @click="activeTab = 'log'">
        Log{{ selected?.log?.length ? ` · ${selected.log.length}` : '' }}
      </button>
    </div>

    <!-- Tasks view -->
    <div v-if="activeTab === 'tasks'" class="tm-content" :key="tick">
      <div class="tm-list">
        <div
          v-for="t in tasks" :key="t.id"
          class="tm-item" :class="[t.status, { active: t.id === selected?.id }]"
          @click="selectedTask = t.id"
        >
          <span class="tm-status-dot" />
          <span class="tm-goal">{{ t.goal?.slice(0, 40) }}{{ t.goal?.length > 40 ? '…' : '' }}</span>
        </div>
        <div v-if="tasks.length === 0" class="tm-empty">No tasks yet</div>
      </div>
      <div class="tm-detail">
        <template v-if="selected">
          <div class="tm-detail-goal">{{ selected.goal }}</div>
          <div class="tm-steps">
            <div v-for="(s, i) in selected.steps" :key="i" class="tm-step" :class="s.status">
              <span class="tm-step-icon">{{ stepIcon(s.status) }}</span>
              <span>{{ s.text }}</span>
            </div>
          </div>
        </template>
        <div v-else class="tm-empty">Select a task</div>
      </div>
    </div>

    <!-- Log view -->
    <div v-if="activeTab === 'log'" class="tm-log-view">
      <div class="tm-log-header">{{ selected?.goal?.slice(0, 50) || 'No task selected' }}</div>
      <div class="tm-log-body">
        <div v-if="selected?.log?.length" v-for="(l, i) in selected.log" :key="i" class="tm-log-entry">
          <span class="tm-log-idx">{{ i + 1 }}</span>
          <span class="tm-log-text">{{ l }}</span>
        </div>
        <div v-else class="tm-empty">No logs yet</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tm-layout { display: flex; flex-direction: column; height: 100%; }
.tm-tabs { display: flex; border-bottom: 1px solid rgba(255,255,255,0.06); padding: 0 8px; }
.tm-tab { background: none; border: none; color: var(--text-muted); padding: 8px 12px; font-size: 12px; cursor: pointer; border-bottom: 2px solid transparent; }
.tm-tab.active { color: var(--text-primary); border-bottom-color: #60a5fa; }
.tm-content { flex: 1; display: flex; overflow: hidden; }
.tm-list { width: 200px; border-right: 1px solid rgba(255,255,255,0.06); overflow-y: auto; }
.tm-item { display: flex; align-items: center; gap: 6px; padding: 8px 10px; cursor: pointer; font-size: 12px; }
.tm-item:hover { background: rgba(255,255,255,0.04); }
.tm-item.active { background: rgba(96,165,250,0.12); }
.tm-status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; background: var(--text-muted); }
.tm-item.running .tm-status-dot { background: #60a5fa; }
.tm-item.done .tm-status-dot { background: #34d399; }
.tm-item.error .tm-status-dot { background: #f87171; }
.tm-goal { color: var(--text-secondary); }
.tm-detail { flex: 1; padding: 12px; overflow-y: auto; }
.tm-detail-goal { font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px; }
.tm-steps { display: flex; flex-direction: column; gap: 4px; }
.tm-step { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); padding: 4px 0; }
.tm-step.done { color: #34d399; }
.tm-step.running { color: #60a5fa; }
.tm-step-icon { width: 16px; text-align: center; }
.tm-empty { padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px; }
.tm-log-view { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.tm-log-header { padding: 8px 12px; font-size: 13px; font-weight: 500; color: var(--text-primary); border-bottom: 1px solid rgba(255,255,255,0.06); }
.tm-log-body { flex: 1; overflow-y: auto; padding: 8px; }
.tm-log-entry { display: flex; gap: 8px; padding: 3px 4px; font-size: 11px; font-family: monospace; }
.tm-log-idx { color: var(--text-muted); width: 24px; text-align: right; flex-shrink: 0; }
.tm-log-text { color: var(--text-secondary); }
</style>
