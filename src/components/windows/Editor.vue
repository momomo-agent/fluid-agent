<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useVFSStore } from '../../stores/vfs'

const props = defineProps({ win: Object })
const vfs = useVFSStore()

const path = computed(() => props.win?.data?.path || '')
const isMd = computed(() => path.value.endsWith('.md') || path.value.endsWith('.markdown'))
const content = ref('')
const savedContent = ref('')
const mode = ref('preview') // 'edit' | 'preview'
const textareaEl = ref(null)
const isModified = computed(() => content.value !== savedContent.value)

// Compute display title with modified marker
const displayTitle = computed(() => {
  const name = path.value.split('/').pop() || 'Untitled'
  return isModified.value ? `* ${name}` : name
})

// Line numbers
const lineNumbers = computed(() => {
  const lines = content.value.split('\n')
  return lines.map((_, i) => i + 1)
})

// Syntax highlighting
const highlightedContent = computed(() => {
  if (isMd.value && mode.value === 'preview') return ''
  return highlightSyntax(content.value, getLanguage(path.value))
})

function getLanguage(filePath) {
  if (!filePath) return 'text'
  const ext = filePath.split('.').pop()?.toLowerCase()
  const map = {
    js: 'javascript', mjs: 'javascript', jsx: 'javascript',
    ts: 'javascript', tsx: 'javascript',
    html: 'html', htm: 'html', vue: 'html', svelte: 'html',
    css: 'css', scss: 'css', less: 'css',
    json: 'json',
    md: 'markdown', markdown: 'markdown',
    py: 'python',
    sh: 'shell', bash: 'shell', zsh: 'shell',
  }
  return map[ext] || 'text'
}

function highlightSyntax(code, lang) {
  let escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  if (lang === 'javascript' || lang === 'python') {
    // Strings (single/double/template)
    escaped = escaped.replace(/(["'`])(?:(?!\1|\\).|\\.)*?\1/g, '<span class="hl-string">$&</span>')
    // Comments
    escaped = escaped.replace(/(\/\/.*$)/gm, '<span class="hl-comment">$1</span>')
    escaped = escaped.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="hl-comment">$1</span>')
    // Python comments
    if (lang === 'python') {
      escaped = escaped.replace(/(#.*$)/gm, '<span class="hl-comment">$1</span>')
    }
    // Keywords
    const jsKeywords = /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|class|extends|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|yield|null|undefined|true|false|def|self|print|lambda|elif|pass|raise|with|as|None|True|False)\b/g
    escaped = escaped.replace(jsKeywords, '<span class="hl-keyword">$1</span>')
    // Numbers
    escaped = escaped.replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-number">$1</span>')
  } else if (lang === 'html') {
    // Tags
    escaped = escaped.replace(/(&lt;\/?)([\w-]+)/g, '$1<span class="hl-keyword">$2</span>')
    // Attributes
    escaped = escaped.replace(/\s([\w-]+)=/g, ' <span class="hl-attr">$1</span>=')
    // Strings
    escaped = escaped.replace(/(["'])(?:(?!\1).)*?\1/g, '<span class="hl-string">$&</span>')
    // Comments
    escaped = escaped.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="hl-comment">$1</span>')
  } else if (lang === 'css') {
    // Selectors (simplified)
    escaped = escaped.replace(/([\w.#-]+)\s*\{/g, '<span class="hl-keyword">$1</span> {')
    // Properties
    escaped = escaped.replace(/([\w-]+)\s*:/g, '<span class="hl-attr">$1</span>:')
    // Values with units
    escaped = escaped.replace(/:\s*([\d.]+(?:px|em|rem|%|vh|vw|s|ms))/g, ': <span class="hl-number">$1</span>')
    // Colors
    escaped = escaped.replace(/(#[0-9a-fA-F]{3,8})\b/g, '<span class="hl-string">$1</span>')
    // Comments
    escaped = escaped.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="hl-comment">$1</span>')
  } else if (lang === 'json') {
    // Keys
    escaped = escaped.replace(/"([^"]+)"\s*:/g, '<span class="hl-attr">"$1"</span>:')
    // String values
    escaped = escaped.replace(/:\s*"([^"]*)"/g, ': <span class="hl-string">"$1"</span>')
    // Numbers
    escaped = escaped.replace(/:\s*(\d+\.?\d*)/g, ': <span class="hl-number">$1</span>')
    // Booleans/null
    escaped = escaped.replace(/\b(true|false|null)\b/g, '<span class="hl-keyword">$1</span>')
  }

  return escaped
}

onMounted(() => {
  content.value = vfs.readFile(path.value) || ''
  savedContent.value = content.value
  if (!isMd.value) mode.value = 'edit'
})

let saveTimer = null
function onInput() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    // Auto-save after 2s of inactivity
    save()
  }, 2000)
}

function save() {
  vfs.writeFile(path.value, content.value)
  savedContent.value = content.value
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
  // Tab key inserts spaces
  if (e.key === 'Tab') {
    e.preventDefault()
    const el = textareaEl.value
    const start = el.selectionStart
    const end = el.selectionEnd
    content.value = content.value.substring(0, start) + '  ' + content.value.substring(end)
    setTimeout(() => { el.selectionStart = el.selectionEnd = start + 2 }, 0)
  }
}

// Sync scroll between line numbers and textarea
function onScroll(e) {
  const lineNumEl = e.target.parentElement?.querySelector('.line-numbers')
  if (lineNumEl) lineNumEl.scrollTop = e.target.scrollTop
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
      <span class="editor-filename" :class="{ modified: isModified }">
        {{ displayTitle }}
      </span>
      <div class="editor-toolbar-right">
        <span v-if="isModified" class="editor-modified-badge">Modified</span>
        <button v-if="isMd" class="editor-toggle" @click="toggleMode">
          {{ mode === 'preview' ? 'Edit' : 'Preview' }}
        </button>
      </div>
    </div>
    <div v-if="isMd && mode === 'preview'" class="editor-preview md-body" v-html="renderMd(content)" @dblclick="toggleMode" />
    <div v-show="mode === 'edit'" class="editor-code-area">
      <div class="line-numbers" aria-hidden="true">
        <div v-for="n in lineNumbers" :key="n" class="line-num">{{ n }}</div>
      </div>
      <div class="editor-layers">
        <!-- Syntax highlight layer (behind textarea) -->
        <pre class="highlight-layer" v-html="highlightedContent + '\n'" />
        <!-- Editable textarea (transparent text, visible caret) -->
        <textarea
          ref="textareaEl"
          v-model="content"
          class="editor-textarea"
          spellcheck="false"
          @input="onInput"
          @keydown="onKeydown"
          @scroll="onScroll"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-body { display: flex; flex-direction: column; height: 100%; }
.editor-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.editor-filename { font-size: 12px; color: var(--text-muted); }
.editor-filename.modified { color: #fbbf24; }
.editor-toolbar-right { display: flex; align-items: center; gap: 8px; }
.editor-modified-badge { font-size: 10px; color: #fbbf24; background: rgba(251, 191, 36, 0.1); padding: 2px 6px; border-radius: 4px; }
.editor-toggle { background: none; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: var(--text-secondary); cursor: pointer; padding: 3px 10px; font-size: 11px; }
.editor-toggle:hover { background: rgba(255,255,255,0.06); }
.editor-preview { flex: 1; overflow-y: auto; padding: 16px; font-size: 13px; line-height: 1.6; color: var(--text-primary); }
.editor-code-area { flex: 1; display: flex; overflow: hidden; }
.line-numbers {
  width: 36px;
  flex-shrink: 0;
  overflow: hidden;
  padding: 12px 0;
  background: rgba(0,0,0,0.15);
  border-right: 1px solid rgba(255,255,255,0.05);
  user-select: none;
}
.line-num {
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 12px;
  line-height: 1.6;
  text-align: right;
  padding-right: 8px;
  color: rgba(255,255,255,0.25);
}
.editor-layers {
  flex: 1;
  position: relative;
  overflow: hidden;
}
.highlight-layer {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  margin: 0;
  padding: 12px;
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-y: auto;
  pointer-events: none;
}
.editor-textarea {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
  color: transparent;
  caret-color: var(--text-primary);
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 13px;
  line-height: 1.6;
  padding: 12px;
  resize: none;
  outline: none;
  box-sizing: border-box;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-y: auto;
}
/* Syntax highlight colors */
.highlight-layer :deep(.hl-keyword) { color: #c792ea; }
.highlight-layer :deep(.hl-string) { color: #c3e88d; }
.highlight-layer :deep(.hl-comment) { color: #546e7a; font-style: italic; }
.highlight-layer :deep(.hl-number) { color: #f78c6c; }
.highlight-layer :deep(.hl-attr) { color: #ffcb6b; }
/* Markdown preview styles */
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
