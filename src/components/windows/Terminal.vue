<script setup>
import { ref, nextTick, onMounted } from 'vue'
import { useShell } from '../../composables/useShell'
import { useEventBus } from '../../composables/useEventBus'

const props = defineProps({ win: Object })
const shell = useShell()
const bus = useEventBus()

const lines = ref([{ text: 'FluidOS Terminal v2.0\nType "help" for available commands.\n', cls: 'output' }])
const input = ref('')
const histIdx = ref(-1)
const outputEl = ref(null)
const inputEl = ref(null)
const composing = ref(false)

function prompt() {
  return `user@fluid:${shell.getCwd()}$ `
}

function appendLine(text, cls = 'output') {
  lines.value.push({ text, cls })
  nextTick(() => {
    if (outputEl.value) outputEl.value.scrollTop = outputEl.value.scrollHeight
  })
}

async function execute() {
  const cmd = input.value
  input.value = ''
  histIdx.value = -1
  appendLine(`${prompt()}${cmd}`, '')

  if (!cmd.trim()) return

  // Special terminal commands
  const trimmed = cmd.trim()
  if (trimmed === 'clear') { lines.value = []; return }

  const sayMatch = trimmed.match(/^say\s+(.+)$/i)
  if (sayMatch) {
    bus.emit('voice.speak', sayMatch[1])
    appendLine(`Speaking: "${sayMatch[1]}"`, 'output')
    return
  }

  if (trimmed.match(/^play(\s+\d+)?$/i)) {
    const m = trimmed.match(/^play(?:\s+(\d+))?$/i)
    const idx = m[1] != null ? parseInt(m[1]) : null
    bus.emit('window.open', { type: 'music' })
    bus.emit('music.control', { action: 'play', track: idx })
    appendLine(idx != null ? `Playing track ${idx}` : 'Playing music', 'output')
    return
  }
  if (trimmed === 'pause' || trimmed === 'stop') {
    bus.emit('music.control', { action: 'pause' })
    appendLine('Music paused', 'output')
    return
  }
  if (trimmed === 'next') {
    bus.emit('music.control', { action: 'next' })
    appendLine('Next track', 'output')
    return
  }

  try {
    const result = await shell.execAsync(cmd)
    if (result === '\x1bclear') lines.value = []
    else if (result) {
      const cls = (result.includes('not found') || result.includes('No such')) ? 'error' : 'output'
      appendLine(result, cls)
    }
  } catch (e) {
    appendLine(`Error: ${e.message}`, 'error')
  }
}

function onKeydown(e) {
  if (composing.value) return
  if (e.key === 'Enter') {
    e.preventDefault()
    execute()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    const hist = shell.getHistory()
    if (histIdx.value < hist.length - 1) {
      histIdx.value++
      input.value = hist[hist.length - 1 - histIdx.value]
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (histIdx.value > 0) {
      histIdx.value--
      input.value = shell.getHistory()[shell.getHistory().length - 1 - histIdx.value]
    } else {
      histIdx.value = -1
      input.value = ''
    }
  }
}

function focusInput() {
  inputEl.value?.focus()
}

onMounted(() => {
  nextTick(() => inputEl.value?.focus())
})
</script>

<template>
  <div class="terminal" @click="focusInput">
    <div ref="outputEl" class="terminal-output">
      <div v-for="(line, i) in lines" :key="i" :class="['terminal-line', line.cls]">{{ line.text }}</div>
    </div>
    <div class="terminal-input-row">
      <span class="terminal-prompt">{{ prompt() }}</span>
      <input
        ref="inputEl"
        v-model="input"
        class="terminal-input"
        @keydown="onKeydown"
        @compositionstart="composing = true"
        @compositionend="composing = false"
        autofocus
      />
    </div>
  </div>
</template>

<style scoped>
.terminal { display: flex; flex-direction: column; height: 100%; background: #1a1b26; color: #a9b1d6; font-family: 'SF Mono', 'Menlo', 'Consolas', monospace; font-size: 13px; }
.terminal-output { flex: 1; overflow-y: auto; padding: 12px; }
.terminal-line { white-space: pre-wrap; line-height: 1.5; }
.terminal-line.error { color: #f7768e; }
.terminal-line.output { color: #a9b1d6; }
.terminal-input-row { display: flex; align-items: center; padding: 8px 12px; border-top: 1px solid rgba(255,255,255,0.06); }
.terminal-prompt { color: #7aa2f7; margin-right: 4px; white-space: nowrap; font-size: 12px; }
.terminal-input { flex: 1; background: none; border: none; color: #a9b1d6; font-family: inherit; font-size: inherit; outline: none; }
</style>
