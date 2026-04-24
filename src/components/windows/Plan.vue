<script setup>
import { computed } from 'vue'
const props = defineProps({ win: Object })
const steps = computed(() => props.win.data?.steps || [])
</script>
<template>
  <div class="plan">
    <div v-for="(step, i) in steps" :key="i" class="plan-step" :class="step.status">
      <span class="plan-icon">{{ step.status === 'done' ? '✓' : step.status === 'running' ? '◉' : '○' }}</span>
      <span class="plan-text">{{ step.text }}</span>
    </div>
    <div v-if="steps.length === 0" class="plan-empty">No plan yet</div>
  </div>
</template>
<style scoped>
.plan { padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.plan-step { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 8px; font-size: 13px; }
.plan-step.done { color: #2a8; }
.plan-step.running { color: var(--accent); font-weight: 600; }
.plan-step.pending { color: var(--text-muted); }
.plan-icon { font-size: 14px; width: 20px; text-align: center; }
.plan-empty { padding: 20px; text-align: center; color: var(--text-muted); }
</style>
