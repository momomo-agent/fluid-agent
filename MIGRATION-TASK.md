# FluidOS Vue 3 Migration — Full Feature Parity Task

## Context
FluidOS is being rewritten from vanilla JS to Vite + Vue 3 Composition API.
The scaffold is done (src/ directory). Legacy code is in legacy/ directory.
ALL features and logic from legacy must be ported to the Vue 3 architecture.

## Project Location
`/Users/kenefe/LOCAL/momo-agent/projects/fluid-agent/`

## What's Already Done (src/)
- `src/main.js` — Vite entry, creates Pinia
- `src/App.vue` — root layout (MenuBar + Desktop + ChatPanel + Dock)
- `src/stores/windows.js` — window CRUD, drag, resize, focus, minimize, maximize
- `src/stores/settings.js` — API key, model, provider, proxy config (localStorage)
- `src/stores/vfs.js` — in-memory virtual filesystem
- `src/composables/useEventBus.js` — mitt-based event bus
- `src/components/Window.vue` — draggable/resizable window frame
- `src/components/Desktop.vue` — renders windows with v-for
- `src/components/Dock.vue` — pinned apps + running windows
- `src/components/MenuBar.vue` — clock
- `src/components/ChatPanel.vue` — basic message list + input
- `src/components/windows/Finder.vue` — file browser
- `src/components/windows/Terminal.vue` — basic terminal
- `src/components/windows/Settings.vue` — settings form
- `src/styles/main.css` — full CSS port

## What Needs to Be Ported

### 1. Agent System (legacy/agent.js — 1537 lines) → src/composables/useAgent.js + src/stores/agent.js
This is the most critical piece. Port ALL of:
- `configure(provider, apiKey, model, baseUrl, storeInstance)` — init agentic AI
- `chat()` function with streaming (emit callback mode) — the main chat loop
- `think()` function — legacy stream+emit mode support
- Tool execution loop (agenticAsk with tool_use rounds)
- Blackboard state (currentTask, steps, status)
- Conductor integration (bridge conductor events to EventBus)
- Proactive loop (setInterval that checks if agent should speak)
- Chat queue (_chatQueue with batching)
- Message history management (summarization when > threshold)
- Worker execution (_executeWorker with tool calls)
- Capability/tool registration and loading
- Stream rendering (markdown parsing, code blocks, tool call display)
- `showActivity()` — status bar updates
- `notify()` — desktop notifications
- Resume task functionality

**IMPORTANT**: The agentic library is in `legacy/lib/agentic.bundle.js` (UMD). For the Vue version, copy it to `src/lib/agentic.bundle.js` and import it. The bundle exposes: `AgenticCore` (chat/ask), `AgenticConductor` (intent dispatch), `AgenticStore` (IndexedDB persistence), `AgenticVoice` (TTS/STT). Use them via:
```js
import '../lib/agentic.bundle.js'
// Then access window.AgenticCore, window.AgenticConductor, etc.
```
Or better: keep the UMD bundle in public/ and load via index.html script tag, then access globals.

### 2. Capabilities (legacy/register-capabilities.js — 545 lines) → src/composables/useCapabilities.js
Port ALL 19 built-in capabilities:
- filesystem (write/read/list/mkdir)
- shell (run command)
- step_done (mark step complete)
- set_plan (execution plan)
- task_complete (signal completion)
- load_tools (dynamic tool loading)
- open_app (finder/editor/terminal/image/browser/map/music)
- window_manager (close/move/resize/minimize/maximize/focus/list/tile)
- set_wallpaper (preset/gradient/URL)
- music (play/pause/next/prev/add)
- video (play/pause/fullscreen)
- browser (open URL)
- browser_control (snapshot/click/type/extract/eval)
- web_search (Tavily)
- web_fetch (fetch URL content)
- map (open/marker/route/clear)
- generative_app (create/update/uninstall/list — legacy HTML/CSS/JS apps)
- custom_tool (create/list/read/delete)
- dynamic_app (open/update/close/destroy/list — VFS-based apps with manifest)

### 3. Window Builtins (legacy/wm-builtins.js — 1144 lines) → src/components/windows/*.vue
Port ALL window type renderers as Vue components:
- `Finder.vue` — file manager with sidebar, icon/list view, breadcrumb, drag-drop (ENHANCE existing stub)
- `Terminal.vue` — terminal with command history, tab completion (ENHANCE existing stub)
- `Editor.vue` — text editor with syntax highlighting, save
- `Plan.vue` — execution plan display (steps with checkmarks)
- `Settings.vue` — full settings panel with all fields (ENHANCE existing stub)
- `ImageViewer.vue` — image display
- `Launchpad.vue` — app grid launcher
- `TaskManager.vue` — task manager with tabs (Conductor, Processes, History)
- `ConductorTab.vue` — conductor visualization (intent cards, worker status, dependencies)

### 4. Media Players (legacy/wm-media.js — 630 lines) → src/components/windows/MusicPlayer.vue + VideoPlayer.vue
- Music player: playlist, play/pause/next/prev, progress bar, album art, synth tracks
- Video player: URL playback, controls, fullscreen
- Audio synthesis (legacy/audio-synth.js — 193 lines) — generate synth music tracks

### 5. Dynamic Apps (legacy/dynamicapp.js — 426 lines + legacy/app-runtime.js — 278 lines + legacy/app-registry.js — 148 lines)
→ src/composables/useDynamicApps.js + src/components/windows/DynamicApp.vue
- AppRegistry: register/unregister/list/get apps
- AppRuntime: render sandboxed iframe apps, VFS data watcher, action executor, bridge (postMessage)
- DynamicApp: create from manifest (VFS-based) or legacy HTML/CSS/JS
- App bridge: fluidOS.setWallpaper, playMusic, notify, openFile from iframe

### 6. App Initialization (legacy/app.js — 619 lines) → src/App.vue (enhance)
- Boot sequence: create store → load settings → configure agent → restore session
- Dynamic Island (task status in menu bar with hover panel)
- Keyboard shortcuts (Cmd+K spotlight, Cmd+T terminal, etc.)
- Context menu on dock items
- Session save/restore (window positions via AgenticStore)
- Wallpaper management (presets, gradients, custom)

### 7. Browser Window (from capabilities) → src/components/windows/Browser.vue
- URL bar, navigation, content display
- Browser control (snapshot, click, type — Playwright-like)

### 8. Map Window → src/components/windows/MapView.vue
- Leaflet or simple map display
- Markers, routes

### 9. Voice (legacy/voice.js — 177 lines) → src/composables/useVoice.js
- Text-to-speech (Web Speech API or ElevenLabs)
- Speech-to-text
- Voice input button in chat

### 10. Skills System (legacy/skills.js — 304 lines) → src/composables/useSkills.js
- Custom skill creation/loading from VFS
- Skill manifest format
- Tool registration from skills

### 11. Spotlight Search → src/components/Spotlight.vue
- Cmd+K overlay
- Search files, apps, commands
- Quick actions

## Architecture Rules
1. Every piece of state goes in a Pinia store
2. Every piece of logic goes in a composable
3. Every UI element is a Vue component with `<script setup>`
4. Use `import` / `export`, no globals (except agentic library which is UMD)
5. EventBus (mitt) for cross-component events that don't fit in stores
6. CSS stays in main.css for global styles, scoped `<style>` for component-specific

## Testing
After porting, the app must:
1. `npm run build` without errors
2. Dev server starts and shows the full OS UI
3. All dock apps open their respective windows
4. Settings saves and persists API key
5. Chat sends messages and gets AI responses (with streaming)
6. Conductor tab shows intent/worker status
7. Dynamic apps can be created and rendered in sandboxed iframes
8. File manager navigates VFS
9. Terminal executes basic commands
10. Window drag, resize, minimize, maximize, close all work
11. Session save/restore works
12. Keyboard shortcuts work

## File References
All legacy source is in `legacy/` directory. Read each file carefully before porting.
The agentic UMD bundles are in `legacy/lib/`.
