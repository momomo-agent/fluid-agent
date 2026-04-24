import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const useSettingsStore = defineStore('settings', () => {
  const provider = ref('anthropic')
  const apiKey = ref('')
  const model = ref('claude-sonnet-4-6')
  const baseUrl = ref('')
  const useProxy = ref(true)
  const tavilyKey = ref('')
  const tmdbKey = ref('')
  const voiceEnabled = ref(false)
  const voiceId = ref('')

  // Persistence via localStorage (simple, no IndexedDB needed for settings)
  const STORAGE_KEY = 'fluid-settings'

  function load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const s = JSON.parse(saved)
        if (s.provider) provider.value = s.provider
        if (s.apiKey) apiKey.value = s.apiKey
        if (s.model) model.value = s.model
        if (s.baseUrl) baseUrl.value = s.baseUrl
        if (s.useProxy !== undefined) useProxy.value = s.useProxy
        if (s.tavilyKey) tavilyKey.value = s.tavilyKey
        if (s.tmdbKey) tmdbKey.value = s.tmdbKey
        if (s.voiceEnabled !== undefined) voiceEnabled.value = s.voiceEnabled
        if (s.voiceId) voiceId.value = s.voiceId
      }
    } catch {}
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      provider: provider.value,
      apiKey: apiKey.value,
      model: model.value,
      baseUrl: baseUrl.value,
      useProxy: useProxy.value,
      tavilyKey: tavilyKey.value,
      tmdbKey: tmdbKey.value,
      voiceEnabled: voiceEnabled.value,
      voiceId: voiceId.value
    }))
  }

  // Auto-save on changes
  watch([provider, apiKey, model, baseUrl, useProxy, tavilyKey, tmdbKey, voiceEnabled, voiceId], save, { deep: true })

  // Computed proxy URL
  function getProxyUrl() {
    if (!useProxy.value) return undefined
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      return location.origin + '/api/proxy'
    }
    return 'https://proxy.link2web.site'
  }

  const isConfigured = () => !!(provider.value && apiKey.value)

  load()

  return {
    provider, apiKey, model, baseUrl, useProxy,
    tavilyKey, tmdbKey, voiceEnabled, voiceId,
    load, save, getProxyUrl, isConfigured
  }
})
