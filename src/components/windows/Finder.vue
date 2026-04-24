<script setup>
import { ref, computed } from 'vue'
import { useVFSStore } from '../../stores/vfs'

const props = defineProps({ win: Object })
const vfs = useVFSStore()
const currentPath = ref(props.win?.data?.path || '/home/user')

const entries = computed(() => vfs.ls(currentPath.value))

function navigate(name, type) {
  if (type === 'dir') {
    currentPath.value = currentPath.value === '/' ? `/${name}` : `${currentPath.value}/${name}`
  }
}

function goUp() {
  const parts = currentPath.value.split('/').filter(Boolean)
  parts.pop()
  currentPath.value = '/' + parts.join('/')
}
</script>

<template>
  <div class="finder">
    <div class="finder-toolbar">
      <button @click="goUp">←</button>
      <span class="finder-path">{{ currentPath }}</span>
    </div>
    <div class="finder-list">
      <div
        v-for="entry in entries"
        :key="entry.name"
        class="finder-item"
        @dblclick="navigate(entry.name, entry.type)"
      >
        <span class="finder-icon">{{ entry.type === 'dir' ? '📁' : '📄' }}</span>
        <span class="finder-name">{{ entry.name }}</span>
      </div>
      <div v-if="entries.length === 0" class="finder-empty">Empty folder</div>
    </div>
  </div>
</template>

<style scoped>
.finder { display: flex; flex-direction: column; height: 100%; }
.finder-toolbar { padding: 8px 12px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid rgba(0,0,0,0.06); }
.finder-toolbar button { background: none; border: none; cursor: pointer; font-size: 16px; }
.finder-path { font-size: 12px; color: var(--text-dim); }
.finder-list { flex: 1; overflow-y: auto; padding: 8px; }
.finder-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; cursor: default; }
.finder-item:hover { background: rgba(0,0,0,0.04); }
.finder-icon { font-size: 20px; }
.finder-name { font-size: 13px; }
.finder-empty { padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px; }
</style>
