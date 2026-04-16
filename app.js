/* app.js — Bootstrap and wire everything together */
;(function() {
  'use strict'

  // ── API Key Modal ──
  const modal = document.getElementById('api-modal')
  const providerSelect = document.getElementById('provider-select')
  const apiKeyInput = document.getElementById('api-key-input')
  const modelInput = document.getElementById('model-input')
  const baseurlInput = document.getElementById('baseurl-input')
  const apiKeySubmit = document.getElementById('api-key-submit')

  // Check localStorage
  const savedProvider = localStorage.getItem('fluid-provider')
  const savedKey = localStorage.getItem('fluid-apikey')
  const savedModel = localStorage.getItem('fluid-model')
  const savedBaseUrl = localStorage.getItem('fluid-baseurl')
  if (savedProvider && savedKey) {
    modal.classList.add('hidden')
    boot(savedProvider, savedKey, savedModel, savedBaseUrl)
  }

  apiKeySubmit.addEventListener('click', () => {
    const provider = providerSelect.value
    const key = apiKeyInput.value.trim()
    const model = modelInput.value.trim()
    const baseUrl = baseurlInput.value.trim()
    if (!key) return
    localStorage.setItem('fluid-provider', provider)
    localStorage.setItem('fluid-apikey', key)
    if (model) localStorage.setItem('fluid-model', model)
    else localStorage.removeItem('fluid-model')
    if (baseUrl) localStorage.setItem('fluid-baseurl', baseUrl)
    else localStorage.removeItem('fluid-baseurl')
    modal.classList.add('hidden')
    boot(provider, key, model, baseUrl)
  })

  apiKeyInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') apiKeySubmit.click()
  })

  function boot(provider, apiKey, model, baseUrl) {
    Agent.configure(provider, apiKey, model, baseUrl)
    document.getElementById('app').style.display = 'flex'

    // Open initial Finder window
    WindowManager.openFinder('/home/user/Desktop')

    // Welcome message
    const container = document.getElementById('chat-messages')
    const bubble = document.createElement('div')
    bubble.className = 'chat-bubble agent'
    bubble.textContent = "Hey! I'm Fluid Agent — I am this OS. Ask me to create files, write code, organize your desktop, or just chat. You can interrupt me anytime."
    container.appendChild(bubble)

    // Wire chat input
    const chatInput = document.getElementById('chat-input')
    const chatSend = document.getElementById('chat-send')
    let isComposing = false
    chatInput.addEventListener('compositionstart', () => { isComposing = true })
    chatInput.addEventListener('compositionend', () => { isComposing = false })

    function sendMessage() {
      const text = chatInput.value.trim()
      if (!text) return
      chatInput.value = ''
      chatInput.style.height = 'auto'
      Agent.chat(text)
    }

    chatSend.addEventListener('click', sendMessage)
    chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
        e.preventDefault()
        sendMessage()
      }
    })

    // Auto-resize textarea
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto'
      chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px'
    })

    // Dock clicks
    document.querySelectorAll('.dock-item').forEach(item => {
      item.addEventListener('click', () => {
        const app = item.dataset.app
        switch (app) {
          case 'finder': WindowManager.openFinder('/home/user'); break
          case 'terminal': WindowManager.openTerminal(); break
          case 'editor': WindowManager.openEditor('/home/user/Documents/readme.txt'); break
        }
      })
    })
  }
})()
