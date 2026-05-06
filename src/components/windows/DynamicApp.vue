<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useVFSStore } from '../../stores/vfs'
import { EventBus } from '../../composables/useEventBus'

const props = defineProps({ win: Object })
const vfs = useVFSStore()
const iframeEl = ref(null)
const objectData = ref({})
const actionsData = ref([])
const viewMode = ref('auto') // 'auto' | 'custom' | 'object'

const appDir = computed(() => props.win?.data?.appDir || '')
const appId = computed(() => props.win?.data?.id || props.win?.data?.name || '')

// ── Read state files ──
function readJSON(path) {
  try {
    const raw = vfs.readFile(path)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function loadState() {
  if (!appDir.value) return
  objectData.value = readJSON(`${appDir.value}/data.json`) || readJSON(`${appDir.value}/object.json`) || {}
  actionsData.value = readJSON(`${appDir.value}/actions.json`) || []

  // Determine view mode
  const hasCustomHtml = vfs.isFile(`${appDir.value}/view.html`) || vfs.isFile(`${appDir.value}/index.html`)
  viewMode.value = hasCustomHtml ? 'custom' : 'object'
}

// ── Custom HTML view (iframe) ──
function buildSrcdoc() {
  if (!appDir.value) return '<html><body><p>No app loaded</p></body></html>'
  const html = vfs.readFile(`${appDir.value}/view.html`) || vfs.readFile(`${appDir.value}/index.html`) || '<p>No view</p>'
  const css = vfs.readFile(`${appDir.value}/style.css`) || ''
  const js = vfs.readFile(`${appDir.value}/script.js`) || ''
  const data = JSON.stringify(objectData.value)
  const actions = JSON.stringify(actionsData.value)

  const bridgeScript = `
<script>
(function() {
  var _data = ${data};
  var _actions = ${actions};
  var _listeners = [];

  window.__object = _data;
  window.__actions = _actions;
  window.__appId = ${JSON.stringify(appId.value)};

  window.__app = {
    get data() { return _data; },
    get actions() { return _actions; },
    dispatch: function(actionId, params) {
      window.parent.postMessage({
        type: 'dapp-action', appId: window.__appId,
        actionId: actionId, params: params || {}
      }, '*');
    },
    onDataUpdate: function(cb) { _listeners.push(cb); }
  };

  window.triggerAction = window.__app.dispatch;

  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'dapp-update' && e.data.object) {
      _data = e.data.object;
      window.__object = _data;
      if (typeof onDataUpdate === 'function') onDataUpdate(_data);
      _listeners.forEach(function(cb) { cb(_data); });
    }
  });

  var _ro = new ResizeObserver(function() {
    window.parent.postMessage({ type: 'dapp-resize', height: document.body.scrollHeight }, '*');
  });
  _ro.observe(document.body);
})();
<\/script>`

  if (html.includes('<html') || html.includes('<HTML')) {
    if (html.includes('</head>')) {
      return html.replace('</head>', `<style>${css}</style>${bridgeScript}</head>`)
    }
    return html + `<style>${css}</style>${bridgeScript}`
  }

  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #e0e0e0; background: transparent; padding: 16px; line-height: 1.5; }
a { color: #7eb8ff; }
${css}
</style>
${bridgeScript}
</head><body>${html}
<script>try { ${js} } catch(e) { console.error('[DynamicApp]', e) }<\/script>
</body></html>`
}

// ── Object auto-rendering ──
const objectHtml = computed(() => {
  const obj = objectData.value
  if (!obj || Object.keys(obj).length === 0) return '<div class="dapp-empty">No data yet</div>'

  const entries = Object.entries(obj).filter(([k]) => k !== 'title' && k !== 'description')

  let html = ''
  if (obj.title) html += `<div class="dapp-title">${escapeHtml(obj.title)}</div>`
  if (obj.description) html += `<div class="dapp-desc">${escapeHtml(obj.description)}</div>`

  // Markdown template
  if (obj.content && typeof obj.content === 'string') {
    html += `<div class="dapp-markdown">${escapeHtml(obj.content).replace(/\n/g, '<br>')}</div>`
    return html
  }

  // List template
  if (Array.isArray(obj.items)) {
    html += `<div class="dapp-list">${obj.items.map(item =>
      `<div class="dapp-list-item">${typeof item === 'string' ? escapeHtml(item) : escapeHtml(item.text || JSON.stringify(item))}</div>`
    ).join('')}</div>`
    return html
  }

  // Auto-detect array → table
  const arrayEntry = entries.find(([, v]) => Array.isArray(v) && v.length > 0 && typeof v[0] === 'object')
  if (arrayEntry) {
    const rows = arrayEntry[1]
    const cols = Object.keys(rows[0])
    html += `<table class="dapp-table"><thead><tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>`
    for (const row of rows) {
      html += `<tr>${cols.map(c => `<td>${escapeHtml(String(row[c] ?? ''))}</td>`).join('')}</tr>`
    }
    html += '</tbody></table>'
    return html
  }

  // Hero mode: single short field
  const fields = entries.filter(([k]) => !['title', 'description'].includes(k))
  if (fields.length === 1) {
    const [key, value] = fields[0]
    const strVal = String(value)
    if (strVal.length <= 20 && typeof value !== 'object') {
      html += `<div class="dapp-hero"><div class="dapp-hero-value">${escapeHtml(strVal)}</div><div class="dapp-hero-label">${escapeHtml(key)}</div></div>`
      return html
    }
  }

  // Grid cards
  if (fields.length > 0) {
    html += '<div class="dapp-fields">'
    for (const [key, value] of fields) {
      html += `<div class="dapp-field"><div class="dapp-field-key">${escapeHtml(key)}</div><div class="dapp-field-value">${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : String(value))}</div></div>`
    }
    html += '</div>'
  }

  if (!obj.title && fields.length === 0) {
    html = '<div class="dapp-empty">No data yet</div>'
  }
  return html
})

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Actions ──
function dispatchAction(actionId, params = {}) {
  const actionDef = actionsData.value.find(a => a.id === actionId)

  if (actionDef?.handler === 'local' && actionDef.mutate) {
    // Local mutate
    const obj = { ...objectData.value }
    for (const [key, expr] of Object.entries(actionDef.mutate)) {
      try {
        const fn = new Function(...Object.keys(objectData.value), ...Object.keys(params), `return (${expr})`)
        obj[key] = fn(...Object.values(objectData.value), ...Object.values(params))
      } catch (err) {
        console.warn(`[DynamicApp] Mutate error for "${key}":`, err)
      }
    }
    vfs.writeFile(`${appDir.value}/data.json`, JSON.stringify(obj, null, 2))
  } else {
    // Dispatch as intent via EventBus
    const label = actionDef?.label || actionId
    const dataSnippet = JSON.stringify(objectData.value).slice(0, 500)
    const paramStr = params && Object.keys(params).length ? ` with ${JSON.stringify(params)}` : ''
    const goal = `User clicked "${label}"${paramStr} in ${props.win.title} app. Current data: ${dataSnippet}.`
    EventBus.emit('dynamicapp.action', { appId: appId.value, actionId, params, goal })
  }
}

// ── VFS watching ──
let vfsHandler = null

function onVFSChange(event, path) {
  if (!appDir.value || !path.startsWith(appDir.value)) return

  const filename = path.split('/').pop()
  if (filename === 'data.json' || filename === 'object.json') {
    const newData = readJSON(path) || {}
    objectData.value = newData
    // Smart update: push to iframe via postMessage instead of rebuilding
    if (viewMode.value === 'custom' && iframeEl.value?.contentWindow) {
      iframeEl.value.contentWindow.postMessage({ type: 'dapp-update', object: newData }, '*')
      return
    }
  }
  if (filename === 'actions.json') {
    actionsData.value = readJSON(path) || []
  }
  if (filename === 'view.html' || filename === 'index.html') {
    viewMode.value = 'custom'
    nextTick(() => {
      if (iframeEl.value) iframeEl.value.srcdoc = buildSrcdoc()
    })
  }
}

// ── Message handler for iframe ──
function onMessage(e) {
  if (!iframeEl.value || e.source !== iframeEl.value.contentWindow) return
  if (e.data?.type === 'dapp-action') {
    dispatchAction(e.data.actionId, e.data.params || {})
  } else if (e.data?.type === 'dapp-resize') {
    // Auto-resize iframe height
    if (iframeEl.value) {
      iframeEl.value.style.height = Math.min(e.data.height + 20, 800) + 'px'
    }
  }
}

// ── EventBus update handler ──
function onDynamicAppUpdate({ id }) {
  if (id === appId.value) loadState()
}

onMounted(() => {
  loadState()
  vfsHandler = vfs.on(onVFSChange)
  window.addEventListener('message', onMessage)
  EventBus.on('dynamicapp.update', onDynamicAppUpdate)
})

onUnmounted(() => {
  if (vfsHandler) vfs.off(vfsHandler)
  window.removeEventListener('message', onMessage)
  EventBus.off('dynamicapp.update', onDynamicAppUpdate)
})
</script>

<template>
  <div class="dynamic-app">
    <!-- Custom HTML view -->
    <template v-if="viewMode === 'custom'">
      <iframe
        ref="iframeEl"
        :srcdoc="buildSrcdoc()"
        sandbox="allow-scripts allow-same-origin"
        class="dapp-iframe"
      />
    </template>

    <!-- Auto-rendered object view -->
    <template v-else>
      <div class="dapp-object" v-html="objectHtml" />
    </template>

    <!-- Action buttons -->
    <div v-if="actionsData.length > 0" class="dapp-actions">
      <button
        v-for="action in actionsData"
        :key="action.id"
        class="dapp-action-btn"
        :class="{ 'dapp-danger': action.style === 'danger', 'dapp-primary': action.style === 'primary' }"
        @click="dispatchAction(action.id, action.params || {})"
      >
        {{ action.icon ? `${action.icon} ` : '' }}{{ action.label || action.id }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.dynamic-app {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dapp-iframe {
  width: 100%;
  flex: 1;
  border: none;
  min-height: 200px;
  background: transparent;
}
.dapp-object {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
}
.dapp-actions {
  flex-shrink: 0;
  padding: 8px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dapp-action-btn {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: #e0e0e0;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}
.dapp-action-btn:hover { background: rgba(255, 255, 255, 0.1); }
.dapp-primary { background: rgba(59, 130, 246, 0.2); border-color: rgba(59, 130, 246, 0.3); }
.dapp-primary:hover { background: rgba(59, 130, 246, 0.3); }
.dapp-danger { background: rgba(239, 68, 68, 0.2); border-color: rgba(239, 68, 68, 0.3); }
.dapp-danger:hover { background: rgba(239, 68, 68, 0.3); }
</style>

<style>
/* Global styles for object rendering (v-html) */
.dapp-title { font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #f0f0f0; }
.dapp-desc { font-size: 14px; color: #a0a0a0; margin-bottom: 12px; }
.dapp-hero { text-align: center; padding: 32px 16px; }
.dapp-hero-value { font-size: 48px; font-weight: 700; color: #60a5fa; }
.dapp-hero-label { font-size: 14px; color: #888; margin-top: 8px; text-transform: capitalize; }
.dapp-fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
.dapp-field { background: rgba(255,255,255,0.03); border-radius: 8px; padding: 12px; border: 1px solid rgba(255,255,255,0.06); }
.dapp-field-key { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
.dapp-field-value { font-size: 16px; font-weight: 500; color: #e0e0e0; word-break: break-word; }
.dapp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.dapp-table th { text-align: left; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); color: #888; font-weight: 500; }
.dapp-table td { padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.04); color: #d0d0d0; }
.dapp-table tr:hover td { background: rgba(255,255,255,0.02); }
.dapp-empty { text-align: center; padding: 40px; color: #666; font-style: italic; }
</style>
