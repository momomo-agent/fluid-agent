<script setup>
import { ref, computed } from 'vue'
import { useSettingsStore } from '../../stores/settings'
import { useAgentStore } from '../../stores/agent'
import { useAgent } from '../../composables/useAgent'
import { useEventBus } from '../../composables/useEventBus'

const settings = useSettingsStore()
const agentStore = useAgentStore()
const agent = useAgent()
const bus = useEventBus()
const activeTab = ref('general')

const skills = computed(() => {
  return Array.from(agentStore.customSkills.entries()).map(([name, s]) => ({
    name, icon: s.icon || '🧩', description: s.description || ''
  }))
})

function save() {
  settings.save()
  agent.configure()
  agent.showActivity('Settings saved')
}

function deleteSkill(name) {
  agentStore.customSkills.delete(name)
}
</script>

<template>
  <div class="settings-layout">
    <div class="settings-sidebar">
      <div class="settings-nav" :class="{ active: activeTab === 'general' }" @click="activeTab = 'general'">General</div>
      <div class="settings-nav" :class="{ active: activeTab === 'skills' }" @click="activeTab = 'skills'">Skills</div>
      <div class="settings-nav" :class="{ active: activeTab === 'about' }" @click="activeTab = 'about'">About</div>
    </div>
    <div class="settings-content">
      <!-- General -->
      <div v-if="activeTab === 'general'" class="settings-panel">
        <div class="settings-group-title">LLM</div>
        <div class="settings-section">
          <div class="settings-label">Provider</div>
          <select v-model="settings.provider" class="settings-input">
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>
        <div class="settings-section">
          <div class="settings-label">API Key</div>
          <input v-model="settings.apiKey" class="settings-input" type="text" placeholder="sk-..." />
        </div>
        <div class="settings-section">
          <div class="settings-label">Model</div>
          <input v-model="settings.model" class="settings-input" type="text" placeholder="claude-sonnet-4-6" />
        </div>
        <div class="settings-section">
          <div class="settings-label">Base URL (optional)</div>
          <input v-model="settings.baseUrl" class="settings-input" type="text" placeholder="https://api.anthropic.com" />
        </div>
        <div class="settings-section">
          <label class="settings-toggle"><input v-model="settings.useProxy" type="checkbox" /> Use Proxy</label>
          <div class="settings-hint">Route API calls through proxy to bypass network restrictions</div>
        </div>
        <div class="settings-divider" />
        <div class="settings-group-title">Web</div>
        <div class="settings-section">
          <div class="settings-label">Tavily API Key</div>
          <input v-model="settings.tavilyKey" class="settings-input" type="text" placeholder="tvly-..." />
        </div>
        <div class="settings-divider" />
        <div class="settings-group-title">Voice</div>
        <div class="settings-section">
          <label class="settings-toggle"><input v-model="settings.voiceEnabled" type="checkbox" /> Enable Voice</label>
        </div>
        <button class="settings-save" @click="save">Save & Apply</button>
      </div>

      <!-- Skills -->
      <div v-if="activeTab === 'skills'" class="settings-panel">
        <div class="settings-group-title">Installed Skills</div>
        <div v-if="skills.length === 0" class="settings-empty">No skills installed. The agent can create skills during tasks.</div>
        <div v-for="s in skills" :key="s.name" class="settings-skill-item">
          <span class="settings-skill-name">{{ s.icon }} {{ s.name }}</span>
          <span class="settings-skill-desc">{{ s.description }}</span>
          <button class="settings-skill-del" @click="deleteSkill(s.name)">✕</button>
        </div>
      </div>

      <!-- About -->
      <div v-if="activeTab === 'about'" class="settings-panel">
        <div class="settings-group-title">Fluid Agent OS</div>
        <div class="settings-about">
          <p>A conversational AI that controls an entire desktop environment.</p>
          <p class="dim">Architecture: Talker → Conductor → Worker</p>
          <p class="dim">Version: 2.0.0 (Vue 3)</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-layout { display: flex; height: 100%; }
.settings-sidebar { width: 140px; padding: 12px 8px; border-right: 1px solid rgba(255,255,255,0.06); flex-shrink: 0; }
.settings-nav { padding: 6px 10px; border-radius: 6px; font-size: 13px; cursor: pointer; color: var(--text-secondary); margin-bottom: 2px; }
.settings-nav:hover { background: rgba(255,255,255,0.06); }
.settings-nav.active { background: rgba(96,165,250,0.15); color: var(--text-primary); }
.settings-content { flex: 1; overflow-y: auto; }
.settings-panel { padding: 16px 20px; }
.settings-group-title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.5px; margin-bottom: 8px; margin-top: 12px; }
.settings-group-title:first-child { margin-top: 0; }
.settings-section { margin-bottom: 12px; }
.settings-label { font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
.settings-input { width: 100%; padding: 7px 10px; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; background: rgba(255,255,255,0.04); color: var(--text-primary); font-size: 13px; outline: none; box-sizing: border-box; }
.settings-input:focus { border-color: #60a5fa; }
.settings-toggle { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-secondary); cursor: pointer; }
.settings-hint { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
.settings-divider { height: 1px; background: rgba(255,255,255,0.06); margin: 16px 0; }
.settings-save { margin-top: 16px; padding: 8px 20px; border-radius: 6px; border: none; background: #60a5fa; color: #fff; font-size: 13px; cursor: pointer; }
.settings-save:hover { background: #3b82f6; }
.settings-empty { font-size: 13px; color: var(--text-muted); padding: 20px 0; }
.settings-skill-item { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
.settings-skill-name { font-size: 13px; font-weight: 500; }
.settings-skill-desc { flex: 1; font-size: 12px; color: var(--text-muted); }
.settings-skill-del { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 14px; padding: 2px 6px; border-radius: 4px; }
.settings-skill-del:hover { background: rgba(248,113,113,0.2); color: #f87171; }
.settings-about p { font-size: 13px; color: var(--text-secondary); margin-bottom: 6px; }
.settings-about .dim { color: var(--text-muted); }
</style>
