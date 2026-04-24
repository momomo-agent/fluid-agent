<script setup>
import { ref, nextTick, onMounted, onUnmounted, computed } from 'vue'
import { useAgent } from '../composables/useAgent'
import { useAgentStore } from '../stores/agent'
import { useSettingsStore } from '../stores/settings'
import { EventBus } from '../composables/useEventBus'

const agent = useAgent()
const agentStore = useAgentStore()
const settings = useSettingsStore()

const messages = ref([])
const input = ref('')
const chatStream = ref(null)
const streamingText = ref('')
const isComposing = ref(false)

const isConfigured = computed(() => settings.isConfigured())

onMounted(() => {
  // Welcome message
  if (isConfigured.value) {
    messages.value.push({ role: 'assistant', content: "Hey! I'm Fluid Agent — part companion, part OS. Ask me anything, or tell me to do something." })
  } else {
    messages.value.push({ role: 'assistant', content: "Welcome to Fluid Agent OS! Open Settings to add your API key and get started." })
  }

  EventBus.on('chat.stream', onStream)
  EventBus.on('chat.assistant', onAssistant)
  EventBus.on('chat.send', onExternalSend)
})

onUnmounted(() => {
  EventBus.off('chat.stream', onStream)
  EventBus.off('chat.assistant', onAssistant)
  EventBus.off('chat.send', onExternalSend)
})

function onStream(text) {
  streamingText.value = text
  nextTick(scrollToBottom)
}

function onAssistant(text) {
  streamingText.value = ''
  if (text) {
    messages.value.push({ role: 'assistant', content: text })
    nextTick(scrollToBottom)
  }
}

function onExternalSend(text) {
  if (text) send(text)
}

async function send(text) {
  const msg = text || input.value.trim()
  if (!msg) return
  input.value = ''
  messages.value.push({ role: 'user', content: msg })
  await nextTick()
  scrollToBottom()

  if (!isConfigured.value) {
    messages.value.push({ role: 'assistant', content: 'Please configure your API key in Settings first.' })
    return
  }

  try {
    await agent.chat(msg)
  } catch (e) {
    messages.value.push({ role: 'assistant', content: `Error: ${e.message}` })
  }
}

function scrollToBottom() {
  if (chatStream.value) chatStream.value.scrollTop = chatStream.value.scrollHeight
}

function handleKeydown(e) {
  if (isComposing.value) return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

// Simple markdown rendering for chat
function renderContent(text) {
  if (!text) return ''
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="chat-code">$2</pre>')
    .replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>')
  return html
}
</script>

<template>
  <div id="chat-panel">
    <div class="chat-header">
      <span class="chat-title">Chat</span>
      <span v-if="!isConfigured" class="chat-status">⚠ Not configured</span>
    </div>
    <div ref="chatStream" class="chat-stream">
      <div
        v-for="(msg, i) in messages"
        :key="i"
        class="chat-bubble"
        :class="msg.role === 'user' ? 'user' : 'agent'"
      >
        <div class="bubble-content" v-html="renderContent(msg.content)" />
      </div>
      <!-- Streaming indicator -->
      <div v-if="streamingText" class="chat-bubble agent streaming">
        <div class="bubble-content" v-html="renderContent(streamingText)" />
      </div>
    </div>
    <div class="chat-input-area">
      <textarea
        v-model="input"
        placeholder="Ask anything..."
        rows="1"
        @keydown="handleKeydown"
        @compositionstart="isComposing = true"
        @compositionend="isComposing = false"
      />
      <button class="send-btn" @click="send()">↑</button>
    </div>
  </div>
</template>
