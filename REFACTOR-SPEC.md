# FluidOS Vite + Vue 3 Refactor Spec

## Goal
Rewrite FluidOS from vanilla JS (IIFE + global variables + script tags) to Vite + Vue 3 Composition API.

## Current Architecture
- 29 JS files loaded via `<script>` tags in index.html
- Global variables everywhere (WM, Agent, EventBus, VFS, etc.)
- IIFE modules with manual exports to window
- No build step (except UMD bundles in lib/)
- Cache busting via manual `?v=N` query params
- ~9000 lines of JS

## Target Architecture
- Vite 6 dev server + build
- Vue 3 with Composition API (`<script setup>`)
- ES modules (import/export)
- Pinia for global state (replaces window globals)
- Single-file components (.vue) for UI
- Composables for reusable logic

## Module Mapping

### Stores (Pinia)
- `stores/agent.js` — AI agent state (messages, currentTask, blackboard)
- `stores/windows.js` — window manager state (windows Map, topZ, focused)
- `stores/settings.js` — user settings (apiKey, model, provider, etc.)
- `stores/vfs.js` — virtual filesystem
- `stores/capabilities.js` — registered tools/capabilities

### Composables
- `composables/useAgent.js` — agent chat, think, tool execution (from agent.js)
- `composables/useWindowManager.js` — create/close/focus/minimize/resize windows (from wm-core.js)
- `composables/useEventBus.js` — mitt-based event bus (from eventbus.js)
- `composables/useVFS.js` — virtual filesystem operations (from fs.js)
- `composables/useShell.js` — shell command execution (from shell.js)
- `composables/useVoice.js` — TTS/STT (from voice.js)
- `composables/useCapabilities.js` — tool registration (from register-capabilities.js + capabilities.js)
- `composables/useDock.js` — dock state and updates

### Components
- `App.vue` — root layout (menu bar + desktop + chat panel + dock)
- `components/MenuBar.vue` — top menu bar
- `components/Desktop.vue` — desktop area with windows
- `components/Window.vue` — draggable/resizable window frame
- `components/Dock.vue` — bottom dock bar
- `components/ChatPanel.vue` — right-side chat panel
- `components/ChatBubble.vue` — individual message bubble
- `components/TaskManager.vue` — task manager with Conductor tab
- `components/ConductorTab.vue` — conductor visualization
- `components/Settings.vue` — settings panel
- `components/Finder.vue` — file manager
- `components/Terminal.vue` — terminal emulator
- `components/Editor.vue` — text editor
- `components/MusicPlayer.vue` — music player
- `components/VideoPlayer.vue` — video player
- `components/Browser.vue` — embedded browser
- `components/MapView.vue` — map component
- `components/Launchpad.vue` — app launcher grid
- `components/DynamicApp.vue` — sandboxed iframe app renderer
- `components/Spotlight.vue` — search overlay

## Key Decisions
1. **agentic library**: import directly from monorepo packages via npm workspace or relative path, not UMD bundles
2. **Window system**: Vue component with v-for over windows store, CSS transforms for position/size
3. **Drag/resize**: composable with pointer events, not library
4. **EventBus**: replace with Pinia actions + mitt for cross-component events
5. **VFS**: keep in-memory implementation, wrap in Pinia store
6. **AppRuntime**: sandboxed iframe stays, but managed by Vue component
7. **serve.js CORS proxy**: keep as Vite proxy config in vite.config.js

## Migration Strategy
1. Scaffold Vite + Vue 3 project in the same directory
2. Move existing files to `legacy/` subdirectory
3. Create stores and composables first (logic layer)
4. Build components one by one, starting with layout (App → Desktop → Window → Dock)
5. Port each window type renderer as a Vue component
6. Wire up agent + chat panel last
7. Verify feature parity with legacy version

## Non-Goals (keep as-is)
- agentic library internals (just import them)
- AgenticStore (IndexedDB persistence)
- Audio synthesis (audio-synth.js)
