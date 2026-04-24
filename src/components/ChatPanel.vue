<script setup>
import { ref, nextTick, watch } from 'vue'

const messages = ref([])
const input = ref('')
const chatStream = ref(null)

const emit = defineEmits(['send'])

async function send() {
  const text = input.value.trim()
  if (!text) return
  messages.value.push({ role: 'user', content: text })
  input.value = ''
  await nextTick()
  scrollToBottom()
  emit('send', text)
}

function addAssistant(content) {
  messages.value.push({ role: 'assistant', content })
  nextTick(scrollToBottom)
}

function scrollToBottom() {
  if (chatStream.value) {
    chatStream.value.scrollTop = chatStream.value.scrollHeight
  }
}

function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

defineExpose({ addAssistant, messages })
</script>

<template>
  <div id="chat-panel">
    <div class="chat-header">
      <span class="chat-title">Chat</span>
    </div>
    <div ref="chatStream" class="chat-stream">
      <div
        v-for="(msg, i) in messages"
        :key="i"
        class="chat-bubble"
        :class="msg.role"
      >
        <div class="bubble-content" v-html="msg.content" />
      </div>
    </div>
    <div class="chat-input-area">
      <textarea
        v-model="input"
        placeholder="Ask anything..."
        rows="1"
        @keydown="handleKeydown"
      />
      <button class="send-btn" @click="send">↑</button>
    </div>
  </div>
</template>
