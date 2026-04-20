# Unified App Architecture v1

## 核心模型

每个 app 窗口 = 三个文件的投影：

```
{app-path}/
  manifest.json   ← 元信息（id, name, icon, sandboxed, permissions, size）
  object.json     ← 数据/状态
  actions.json    ← 用户可执行的操作
  view.html       ← 界面（内置模板 / LLM 生成 / 用户自写）
```

Runtime: object 或 actions 变了 → 重新渲染 view。用户触发 action → 修改 object → view 跟着变。

App 的运行时就是 LLM。足够 AI native。

## 三种 App

| | 内置 | 用户 | 临时 |
|---|---|---|---|
| 路径 | /system/apps/{id}/ | /home/user/apps/{id}/ | /tmp/apps/{id}/ |
| 持久化 | 随系统 | IndexedDB | 不持久化 |
| Launchpad | 始终显示 | 显示 | 不显示 |
| 关窗口 | 实例销毁 | 实例销毁 | 实例+文件都销毁 |
| 谁创建 | 预装 | Worker/用户 | Worker |
| sandboxed | 默认 false | 默认 true | 默认 true |
| view 来源 | 手写模板 | LLM 生成 | LLM 生成 |

## manifest.json

```json
{
  "id": "finder",
  "name": "Finder",
  "icon": "📁",
  "sandboxed": false,
  "size": "medium",
  "singleton": false,
  "permissions": ["vfs", "shell"],
  "builtin": true,
  "ephemeral": false
}
```

## object.json（示例：finder）

```json
{
  "path": "/home/user",
  "files": [
    { "name": "documents", "type": "dir" },
    { "name": "hello.txt", "type": "file", "size": 42 }
  ],
  "selected": null,
  "viewMode": "list"
}
```

## actions.json（示例：finder）

```json
{
  "actions": [
    { "id": "open", "label": "Open", "icon": "📂" },
    { "id": "delete", "label": "Delete", "icon": "🗑️" },
    { "id": "rename", "label": "Rename", "icon": "✏️" },
    { "id": "newFile", "label": "New File", "icon": "📄" },
    { "id": "newFolder", "label": "New Folder", "icon": "📁" }
  ]
}
```

## 渲染流程

```
AppRegistry.get(type)
  → sandboxed?
    → true:  iframe srcdoc, view.html + object.json 注入
    → false: render(body, { object, actions, VFS, Shell, ... })

VFS.watch(appPath + '/object.json', () => re-render)
VFS.watch(appPath + '/actions.json', () => re-render)
```

## Action 执行

用户点击 action → 两种路径：
1. 前端逻辑：直接修改 object.json（如 finder 切目录）
2. 后端逻辑：发给 Worker 处理（如"深入分析"）

action 定义里可以标记 `"handler": "local"` 或 `"handler": "worker"`。

## AppRegistry

```js
const AppRegistry = {
  _apps: new Map(),

  register(manifest) {
    this._apps.set(manifest.id, { ...manifest })
  },

  get(id) { return this._apps.get(id) },

  list(filter) {
    return [...this._apps.values()].filter(filter || (() => true))
  },

  unregister(id) {
    const app = this._apps.get(id)
    if (app?.builtin) return false
    this._apps.delete(id)
    return true
  },

  // 扫描 VFS 目录自动注册
  scan(basePath) {
    const dirs = VFS.ls(basePath)
    if (!dirs) return
    for (const entry of dirs) {
      if (entry.type !== 'dir') continue
      const manifestPath = `${basePath}/${entry.name}/manifest.json`
      if (VFS.isFile(manifestPath)) {
        const manifest = VFS.readFile(manifestPath)
        this.register(manifest)
      }
    }
  }
}

// 启动时扫描
AppRegistry.scan('/system/apps')
AppRegistry.scan('/home/user/apps')
```

## 窗口实例

每个打开的窗口对应一个运行时实例：

```js
{
  windowId: 'win-42',
  appId: 'finder',
  instancePath: '/run/apps/win-42/',  // 运行时状态副本
  // /run/apps/win-42/object.json ← 这个窗口的实时状态
  // /run/apps/win-42/actions.json
}
```

内置 app 的 object.json 是运行时生成的（如 finder 打开时根据 path 生成文件列表）。
用户/临时 app 的 object.json 由 Worker 写入。

## 实现计划

### Phase 1: AppRegistry + 渲染统一
1. 新建 `app-registry.js`
2. 内置 app 注册（manifest + render 函数引用）
3. `renderWindow` 改成查 registry
4. 用户 app 走 registry 注册

### Phase 2: 文件协议
1. VFS watch 机制
2. object.json / actions.json / view.html 三文件协议
3. 内置 app 的 render 函数改成读 object.json 驱动
4. 临时 app 支持

### Phase 3: LLM 生成 view
1. Worker 只写 object + actions，view 由 LLM 生成
2. view 模板缓存
3. 快线/慢线分离（状态机 vs LLM 调用）

## 不变的

- 窗口管理（create/close/focus/minimize/resize）
- 窗口 chrome（titlebar、dots、resize handle）
- session 持久化
- bridge postMessage 协议（sandboxed app 用）
