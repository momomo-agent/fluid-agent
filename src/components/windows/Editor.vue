<script setup>
import { ref, computed, onMounted } from 'vue'
import { useVFSStore } from '../../stores/vfs'

const props = defineProps({ win: Object })
const vfs = useVFSStore()

const path = computed(() => props.win?.data?.path || '')
const isMd = computed(() => path.value.endsWith('.md') || path.value.endsWith('.markdown'))
const content = ref('')
const mode = ref('preview') // 'edit' | 'preview'
const textareaEl = ref(null)

onMounted(() => {
  content.value = vfs.readFile(path.value) || ''
  if (!isMd.value) mode.value = 'edit'
})

let saveTimer = null
function onInput() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    vfs.writeFile(path.value, content.value)
  }, 500)
}

function save() {
  vfs.writeFile(path.value, content.value)
}

function toggleMode() {
  mode.value = mode.value === 'preview' ? 'edit' : 'preview'
  if (mode.value === 'edit') {
    setTimeout(() => textareaEl.value?.focus(), 50)
  }
}

function onKeydown(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    save()
  }
}

// Simple markdown to HTML
function renderMd(src) {
  let html = escapeHtml(src)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre class="md-code"><code>${code.trim()}</code></pre>`)
  html = html.replace(/^(#{1,6})\s+(.+)$/gm, (_, h, text) => `<div class="md-h md-h${h.length}">${text}</div>`)
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  html = html.replace(/`([^`]+)`/g, '<code class="md-inline">$1</code>')
  html = html.replace(/^[-*+]\s+(.+)$/gm, '<div class="md-li">• $1</div>')
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="md-link">$1</a>')
  html = html.replace(/\n\n/g, '<div class="md-blank"></div>')
  html = html.replace(/\n/g, '<br>')
  return html
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
</script>

<template>
  <div class="editor-body">
    <div class="editor-toolbar">
      <span class="editor-filename">{{ path.split('/').pop() }}</span>
      <button v-if="isMd" class="editor-toggle" @click="toggleMode">
        {{ mode === 'preview' ? 'Edit' : 'Preview' }}
      </button>
    </div>
    <div v-if="isMd && mode === 'preview'" class="editor-preview md-body" v-html="renderMd(content)" @dblclick="toggleMode" />
    <textarea
      v-show="mode === 'edit'"
      ref="textareaEl"
      v-model="content"
      class="editor-textarea"
      @input="onInput"
      @keydown="onKeydown"
    />
  </div>
</template>

<style scoped>
.editor-body { display: flex; flex-direction: column; height: 100%; }
.editor-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.editor-filename { font-size: 12px; color: var(--text-muted); }
.editor-toggle { background: none; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: var(--text-secondary); cursor: pointer; padding: 3px 10px; font-size: 11px; }
.editor-toggle:hover { background: rgba(255,255,255,0.06); }
.editor-preview { flex: 1; overflow-y: auto; padding: 16px; font-size: 13px; line-height: 1.6; color: var(--text-primary); }
.editor-textarea { flex: 1; width: 100%; border: none; background: transparent; color: var(--text-primary); font-family: 'SF Mono', 'Menlo', monospace; font-size: 13px; line-height: 1.6; padding: 12px; resize: none; outline: none; box-sizing: border-box; }
.md-body :deep(.md-h) { font-weight: 700; margin: 8px 0 4px; }
.md-body :deep(.md-h1) { font-size: 20px; }
.md-body :deep(.md-h2) { font-size: 17px; }
.md-body :deep(.md-h3) { font-size: 15px; }
.md-body :deep(.md-code) { background: rgba(0,0,0,0.3); padding: 8px 12px; border-radius: 6px; font-size: 12px; overflow-x: auto; display: block; margin: 8px 0; }
.md-body :deep(.md-inline) { background: rgba(0,0,0,0.2); padding: 1px 5px; border-radius: 3px; font-size: 12px; }
.md-body :deep(.md-li) { padding-left: 12px; }
.md-body :deep(.md-link) { color: #60a5fa; }
.md-body :deep(.md-blank) { height: 8px; }
</style>
