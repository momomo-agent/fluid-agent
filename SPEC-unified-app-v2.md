# Unified App Architecture v2

## 核心变更（vs v1）

1. **manifest 声明入口，不靠文件名约定** — view/data/actions 的文件名由 manifest 指定
2. **view 支持 URL** — `"view": "https://..."` 直接 iframe src 加载
3. **html/css/js 不再分离** — view 是一个完整 HTML 文件（自带 style 和 script）
4. **DynamicApp 消失** — 统一为 App，reactive state 是所有 App 的标配
5. **actions 是声明式列表** — 不是 JS 代码，runtime 负责执行

## App Bundle 格式

manifest.json 是唯一入口，声明所有文件引用：

```json
{
  "id": "weather",
  "name": "Weather",
  "icon": "🌤️",
  "size": "medium",
  "view": "weather-ui.html",
  "data": "state.json",
  "actions": "actions.json",
  "permissions": ["network"],
  "sandboxed": true,
  "ephemeral": false
}
```

- `view` — 本地文件名 或 URL（`https://...`）
- `data` — 状态文件名（可选，默认无 reactive state）
- `actions` — 动作列表文件名（可选）
- 文件名随意，manifest 指定就行

## 三种 App（不变）

| | 内置 | 用户 | 临时 |
|---|---|---|---|
| 路径 | /system/apps/{id}/ | /home/user/apps/{id}/ | /tmp/apps/{id}/ |
| 持久化 | 随系统 | IndexedDB | 不持久化 |
| Launchpad | 始终显示 | 显示 | 不显示 |
| 关窗口 | 实例销毁 | 实例销毁 | 实例+文件都销毁 |
| sandboxed | 默认 false | 默认 true | 默认 true |

## data.json（reactive state）

任意 JSON。agent 或 action executor 写入，runtime watch 变化后通过 bridge 推给 view。

```json
{
  "city": "Beijing",
  "temp": 22,
  "condition": "sunny",
  "forecast": [...]
}
```

## actions.json（声明式）

```json
[
  { "id": "refresh", "label": "Refresh", "icon": "🔄", "handler": "worker" },
  { "id": "changeCity", "label": "Change City", "icon": "🏙️", "handler": "worker", "params": { "city": "string" } },
  { "id": "toggleUnit", "label": "°C/°F", "icon": "🌡️", "handler": "local", "mutate": { "unit": "$unit === 'C' ? 'F' : 'C'" } }
]
```

- `handler: "local"` — runtime 直接执行 mutate 表达式，改 data
- `handler: "worker"` — 发给 agent/worker 处理
- actions 可以被 agent 动态更新（改 actions.json）

## view.html

一个完整的 HTML 文件，通过 bridge 访问 data 和 dispatch action：

```html
<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: system-ui; background: #1a1a2e; color: #e0e0e0; }
  /* ... all styles inline ... */
</style>
</head>
<body>
  <div id="app"></div>
  <script>
    // Bridge API (runtime 注入到 iframe)
    // window.__app.data    — 当前 data 快照
    // window.__app.actions — 当前 actions 列表
    // window.__app.dispatch(actionId, params) — 触发 action
    // window.__app.onDataUpdate(callback)     — data 变化回调

    function render(data) {
      document.getElementById('app').innerHTML = `
        <h1>${data.city}</h1>
        <p>${data.temp}° ${data.condition}</p>
      `
    }

    render(window.__app.data)
    window.__app.onDataUpdate(render)
  </script>
</body>
</html>
```

## App Runtime

每个打开的 app 窗口有一个 runtime 实例：

```
Loader: read manifest → resolve view/data/actions paths
Watcher: observe data file changes in VFS
Action Executor: interpret action definitions → mutate data or call worker
Bridge: postMessage 双向通信 (runtime ↔ view iframe)
```

### 渲染流程

```
open app
  → read manifest.json
  → resolve view entry
    → local file? → read content → iframe srcdoc
    → URL? → iframe src
  → read data entry → inject as window.__app.data
  → read actions entry → inject as window.__app.actions
  → setup bridge (postMessage)
  → setup watcher on data file
    → data changed → bridge.pushData(newData) → view re-renders
```

### Action 执行流程

```
view calls dispatch(actionId, params)
  → bridge → runtime
  → find action definition in actions.json
  → handler === "local"?
    → evaluate mutate expression → write data file → watcher triggers → view updates
  → handler === "worker"?
    → send to agent/worker → worker processes → writes data file → same update cycle
```

## 内置 App 迁移

内置 app（finder, terminal, editor, settings...）目前用 `sandboxed: false` + 直接 render 函数。

迁移策略：保持 render 函数不变，但统一注册格式。manifest 里没有 `view` 字段的 app 走旧的 render 函数路径。有 `view` 字段的走新的 iframe + bridge 路径。

这样可以渐进迁移，不需要一次重写所有内置 app。

## Agent 创建 App 的流程

```
agent 收到用户请求 "做个天气 app"
  → 写 /tmp/apps/weather/manifest.json
  → 写 /tmp/apps/weather/state.json (初始数据)
  → 写 /tmp/apps/weather/actions.json
  → 写 /tmp/apps/weather/weather-ui.html (view)
  → AppRegistry 自动发现 → 打开窗口
```

Agent 更新 app 状态 = 直接改 data 文件，view 自动响应。

## 实现步骤

### Step 1: 统一 AppRegistry
- manifest 新增 `view`/`data`/`actions` 字段
- scanVFS 读 manifest 时解析这三个入口
- 没有 view 字段 → 走旧 render 函数（向后兼容）
- 有 view 字段 → 走新 iframe + bridge 路径

### Step 2: App Runtime + Bridge
- 新建 `app-runtime.js`（替代 dynamicapp.js 的职责）
- Loader: 读 manifest → 解析入口 → 加载文件
- Watcher: VFS watch data 文件变化
- Bridge: postMessage 协议（`window.__app.*`）
- Action Executor: local mutate + worker dispatch

### Step 3: 渲染统一
- `renderWindow` 检查 manifest 有无 view 字段
- 有 → `renderAppView(body, manifest, appPath)`
- 无 → 走旧的 `app.render(w, body)` 或 switch-case
- view 是 URL → iframe src
- view 是本地文件 → 读 VFS → iframe srcdoc（注入 bridge script + data + actions）

### Step 4: 迁移 DynamicApp
- DynamicApp.create → 改为写标准 manifest + data + actions + view 到 /tmp/apps/
- DynamicApp.update → 改为写 data 文件
- DynamicApp.open → 改为 WindowManager.openApp
- 最终删除 dynamicapp.js

### Step 5: Agent 工具更新
- `app` capability 的 create action 支持新格式
- Worker prompt 更新：教它写 manifest + data + actions + view 四个文件
- 删除旧的 html/css/js 分离参数

## 不变的

- 窗口管理（create/close/focus/minimize/resize/drag）
- 窗口 chrome（titlebar、dots、resize handle）
- session 持久化（IndexedDB）
- 内置 app 的 render 函数（渐进迁移）
- Dock、Launchpad、Spotlight
