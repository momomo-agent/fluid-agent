<script setup>
import { useSettingsStore } from '../../stores/settings'

const settings = useSettingsStore()
</script>

<template>
  <div class="settings">
    <div class="settings-group">
      <label>Provider</label>
      <select v-model="settings.provider">
        <option value="anthropic">Anthropic</option>
        <option value="openai">OpenAI</option>
      </select>
    </div>
    <div class="settings-group">
      <label>API Key</label>
      <input v-model="settings.apiKey" type="text" placeholder="sk-..." />
    </div>
    <div class="settings-group">
      <label>Model</label>
      <input v-model="settings.model" type="text" placeholder="claude-sonnet-4-6" />
    </div>
    <div class="settings-group">
      <label>Base URL (optional)</label>
      <input v-model="settings.baseUrl" type="text" placeholder="https://api.anthropic.com" />
    </div>
    <div class="settings-group">
      <label class="checkbox-label">
        <input v-model="settings.useProxy" type="checkbox" />
        Use CORS Proxy
      </label>
    </div>
    <div class="settings-group">
      <label>Tavily API Key</label>
      <input v-model="settings.tavilyKey" type="text" placeholder="tvly-..." />
    </div>
    <div class="settings-status" :class="{ configured: settings.isConfigured() }">
      {{ settings.isConfigured() ? '✓ Configured' : '⚠ API key required' }}
    </div>
  </div>
</template>

<style scoped>
.settings { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
.settings-group { display: flex; flex-direction: column; gap: 4px; }
.settings-group label { font-size: 12px; font-weight: 600; color: var(--text-dim); }
.settings-group input[type="text"], .settings-group select {
  padding: 8px 10px; border: 1px solid rgba(0,0,0,0.1); border-radius: 6px;
  font-size: 13px; background: rgba(255,255,255,0.6); outline: none;
}
.settings-group input:focus, .settings-group select:focus { border-color: var(--accent); }
.checkbox-label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.settings-status { padding: 8px 12px; border-radius: 6px; font-size: 12px; text-align: center; background: rgba(255,100,100,0.1); color: #c44; }
.settings-status.configured { background: rgba(40,200,64,0.1); color: #2a8; }
</style>
