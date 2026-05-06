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
const voiceInterim = ref('')

const isConfigured = computed(() => settings.isConfigured())
const activityText = ref('')
const toolCalls = ref([])
const showToolCalls = ref(false)

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
  EventBus.on('voice.interim', onVoiceInterim)
  EventBus.on('voice.final', onVoiceFinal)
  EventBus.on('activity', onActivity)
  EventBus.on('tool.call', onToolCall)
})

onUnmounted(() => {
  EventBus.off('chat.stream', onStream)
  EventBus.off('chat.assistant', onAssistant)
  EventBus.off('chat.send', onExternalSend)
  EventBus.off('voice.interim', onVoiceInterim)
  EventBus.off('voice.final', onVoiceFinal)
  EventBus.off('activity', onActivity)
  EventBus.off('tool.call', onToolCall)
})

function onStream(text) {
  streamingText.value = text
  nextTick(scrollToBottom)
}

function onAssistant(text) {
  streamingText.value = ''
  activityText.value = ''
  // Attach collected tool calls to the message
  const msgToolCalls = toolCalls.value.length > 0 ? [...toolCalls.value] : null
  toolCalls.value = []
  if (text) {
    messages.value.push({ role: 'assistant', content: text, toolCalls: msgToolCalls })
    nextTick(scrollToBottom)
  }
}

function onActivity(text) {
  activityText.value = text
  nextTick(scrollToBottom)
}

function onToolCall(call) {
  toolCalls.value.push(call)
  nextTick(scrollToBottom)
}

function toggleToolCalls(idx) {
  const msg = messages.value[idx]
  if (msg) msg._showTools = !msg._showTools
}

function onExternalSend(text) {
  if (text) send(text)
}

function onVoiceInterim(text) {
  voiceInterim.value = text
  nextTick(scrollToBottom)
}

function onVoiceFinal(text) {
  voiceInterim.value = ''
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

// ── Markdown rendering (migrated from legacy) ──

function _inlineMarkdown(text) {
  return text
    // Markdown images: ![alt](url)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="chat-media-img" loading="lazy" />')
    // Links: [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="chat-link" target="_blank" rel="noopener">$1</a>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

function _blockMarkdown(line) {
  // Headers
  if (/^###\s/.test(line)) return `<strong>${_inlineMarkdown(line.slice(4))}</strong>`
  if (/^##\s/.test(line)) return `<strong>${_inlineMarkdown(line.slice(3))}</strong>`
  if (/^#\s/.test(line)) return `<strong style="font-size:1.1em">${_inlineMarkdown(line.slice(2))}</strong>`
  // Unordered list
  if (/^\s*[-*]\s/.test(line)) return `<div class="chat-list-item">• ${_inlineMarkdown(line.replace(/^\s*[-*]\s/, ''))}</div>`
  // Ordered list
  if (/^\s*\d+\.\s/.test(line)) {
    const match = line.match(/^(\s*\d+\.)\s(.*)/)
    return `<div class="chat-list-item">${match[1]} ${_inlineMarkdown(match[2])}</div>`
  }
  return _inlineMarkdown(line)
}

function _renderMediaUrl(url) {
  const imgExts = /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?[^\s]*)?$/i
  const audioExts = /\.(mp3|wav|ogg|m4a|aac|flac)(\?[^\s]*)?$/i
  const videoExts = /\.(mp4|webm|mov|mkv)(\?[^\s]*)?$/i

  if (imgExts.test(url) || url.includes('image.tmdb.org')) {
    return `<img src="${url}" class="chat-media-img" loading="lazy" />`
  }
  if (audioExts.test(url)) {
    return `<audio src="${url}" controls preload="metadata" class="chat-media-audio"></audio>`
  }
  if (videoExts.test(url)) {
    return `<video src="${url}" controls preload="metadata" class="chat-media-video"></video>`
  }
  return null
}

function renderContent(text) {
  if (!text) return ''

  // Escape HTML
  let escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // Extract code blocks first (protect from further processing)
  const codeBlocks = []
  escaped = escaped.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length
    codeBlocks.push(`<pre class="chat-code"><code>${code}</code></pre>`)
    return `%%CODEBLOCK_${idx}%%`
  })

  // Process line by line for tables, lists, headers
  const lines = escaped.split('\n')
  const out = []
  let i = 0

  while (i < lines.length) {
    // Table detection: line has |, next line is separator |---|---|
    if (lines[i].includes('|') && i + 1 < lines.length && /^[\s|:-]+$/.test(lines[i + 1])) {
      const headers = lines[i].split('|').map(c => c.trim()).filter(Boolean)
      i += 2 // skip header + separator
      const rows = []
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(lines[i].split('|').map(c => c.trim()).filter(Boolean))
        i++
      }
      let table = '<table class="chat-table"><thead><tr>'
      headers.forEach(h => { table += `<th>${_inlineMarkdown(h)}</th>` })
      table += '</tr></thead><tbody>'
      rows.forEach(r => {
        table += '<tr>'
        r.forEach(c => { table += `<td>${_inlineMarkdown(c)}</td>` })
        table += '</tr>'
      })
      table += '</tbody></table>'
      out.push(`<div class="chat-table-wrap">${table}</div>`)
    } else {
      out.push(_blockMarkdown(lines[i]))
      i++
    }
  }

  let html = out.join('<br>')

  // Restore code blocks
  codeBlocks.forEach((block, idx) => {
    html = html.replace(`%%CODEBLOCK_${idx}%%`, block)
  })

  // Auto-render media URLs (bare URLs not already in links/images)
  html = html.replace(/(https?:\/\/[^\s<>"']+)/g, (match) => {
    // Skip if already inside an href or src attribute
    const media = _renderMediaUrl(match)
    if (media) return media
    return match
  })

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
        <!-- Tool calls (collapsible) -->
        <div v-if="msg.toolCalls && msg.toolCalls.length" class="tool-calls-section">
          <button class="tool-calls-toggle" @click="toggleToolCalls(i)">
            🔧 {{ msg.toolCalls.length }} tool{{ msg.toolCalls.length > 1 ? 's' : '' }} used
            <span>{{ msg._showTools ? '▼' : '▶' }}</span>
          </button>
          <div v-if="msg._showTools" class="tool-calls-list">
            <div v-for="(tc, j) in msg.toolCalls" :key="j" class="tool-call-item">
              <span class="tool-name">{{ tc.name }}</span>
              <span class="tool-input">{{ tc.input }}</span>
            </div>
          </div>
        </div>
      </div>
      <!-- Streaming indicator -->
      <div v-if="streamingText" class="chat-bubble agent streaming">
        <div class="bubble-content" v-html="renderContent(streamingText)" />
        <span class="typing-cursor">▊</span>
      </div>
      <!-- Activity indicator -->
      <div v-if="activityText && !streamingText" class="chat-activity">
        <span class="activity-dot"></span>
        {{ activityText }}
      </div>
      <!-- Tool calls in progress -->
      <div v-if="toolCalls.length && !streamingText" class="chat-bubble agent tool-progress">
        <div v-for="(tc, j) in toolCalls" :key="j" class="tool-call-item">
          🔧 <span class="tool-name">{{ tc.name }}</span>
        </div>
      </div>
      <!-- Voice interim -->
      <div v-if="voiceInterim" class="chat-bubble user voice-interim">
        <div class="bubble-content">🎙️ {{ voiceInterim }}</div>
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

<style scoped>
.chat-table-wrap {
  overflow-x: auto;
  margin: 4px 0;
}
.chat-table {
  border-collapse: collapse;
  font-size: 0.85em;
  width: 100%;
}
.chat-table th, .chat-table td {
  border: 1px solid rgba(255,255,255,0.15);
  padding: 4px 8px;
  text-align: left;
}
.chat-table th {
  background: rgba(255,255,255,0.05);
  font-weight: 600;
}
.chat-list-item {
  padding-left: 12px;
}
.chat-link {
  color: #7eb8ff;
  text-decoration: none;
}
.chat-link:hover {
  text-decoration: underline;
}
.chat-media-img {
  max-width: 100%;
  border-radius: 8px;
  margin: 4px 0;
}
.chat-media-audio {
  width: 100%;
  margin: 4px 0;
}
.chat-media-video {
  max-width: 100%;
  border-radius: 8px;
  margin: 4px 0;
}
.typing-cursor {
  animation: blink 1s step-end infinite;
  opacity: 0.7;
}
@keyframes blink {
  50% { opacity: 0; }
}
.chat-activity {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  font-size: 0.8em;
  color: rgba(255,255,255,0.5);
}
.activity-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #7eb8ff;
  animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
.tool-calls-section {
  margin-top: 4px;
}
.tool-calls-toggle {
  background: none;
  border: none;
  color: rgba(255,255,255,0.5);
  font-size: 0.75em;
  cursor: pointer;
  padding: 2px 0;
}
.tool-calls-toggle:hover {
  color: rgba(255,255,255,0.8);
}
.tool-calls-list {
  margin-top: 4px;
  padding-left: 8px;
  border-left: 2px solid rgba(255,255,255,0.1);
}
.tool-call-item {
  font-size: 0.75em;
  color: rgba(255,255,255,0.5);
  padding: 2px 0;
}
.tool-name {
  font-weight: 600;
  color: rgba(255,255,255,0.7);
}
.tool-input {
  margin-left: 6px;
  opacity: 0.6;
  font-family: monospace;
  font-size: 0.9em;
}
.tool-progress {
  opacity: 0.7;
}
</style>
