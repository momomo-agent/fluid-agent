import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/main.css'

const app = createApp(App)
app.use(createPinia())

// Cache settings for global access (used by capabilities)
import { useSettingsStore } from './stores/settings'
const settings = useSettingsStore()
window._settingsCache = settings

app.mount('#app')
