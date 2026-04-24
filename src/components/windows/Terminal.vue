<script setup>
import { ref } from 'vue'

const history = ref([])
const input = ref('')

function execute() {
  const cmd = input.value.trim()
  if (!cmd) return
  history.value.push({ type: 'input', text: `$ ${cmd}` })
  // Simple built-in commands
  if (cmd === 'clear') { history.value = [] }
  else if (cmd === 'help') { history.value.push({ type: 'output', text: 'Available: clear, help, echo, date, whoami' }) }
  else if (cmd === 'date') { history.value.push({ type: 'output', text: new Date().toString() }) }
  else if (cmd === 'whoami') { history.value.push({ type: 'output', text: 'user@fluid-os' }) }
  else if (cmd.startsWith('echo ')) { history.value.push({ type: 'output', text: cmd.slice(5) }) }
  else { history.value.push({ type: 'output', text: `command not found: ${cmd}` }) }
  input.value = ''
}
</script>

<template>
  <div class="terminal">
    <div class="terminal-output">
      <div v-for="(line, i) in history" :key="i" :class="['terminal-line', line.type]">
        {{ line.text }}
      </div>
    </div>
    <div class="terminal-input-row">
      <span class="terminal-prompt">$</span>
      <input v-model="input" class="terminal-input" @keydown.enter="execute" autofocus />
    </div>
  </div>
</template>

<style scoped>
.terminal { display: flex; flex-direction: column; height: 100%; background: #1e1e1e; color: #d4d4d4; font-family: 'SF Mono', 'Menlo', monospace; font-size: 13px; }
.terminal-output { flex: 1; overflow-y: auto; padding: 12px; }
.terminal-line { white-space: pre-wrap; line-height: 1.5; }
.terminal-line.input { color: #569cd6; }
.terminal-line.output { color: #d4d4d4; }
.terminal-input-row { display: flex; align-items: center; padding: 8px 12px; border-top: 1px solid #333; }
.terminal-prompt { color: #569cd6; margin-right: 8px; }
.terminal-input { flex: 1; background: none; border: none; color: #d4d4d4; font-family: inherit; font-size: inherit; outline: none; }
</style>
