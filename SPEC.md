# Fluid Agent — Spec

## 概念
纯浏览器端的虚拟 OS + 双脑 Agent。用户随时能对话、随时能打断、agent 随时能操作虚拟桌面。

## 布局
- 左侧：虚拟桌面（可拖拽窗口系统）
- 右侧：对话面板（永远在线的 Talker）

## 双脑架构

### Talker（对话脑）
- 收到用户消息 → 立刻 streaming 回复
- context：对话历史 + 当前任务状态摘要（从 Blackboard 读）
- 回复时同时输出 structured action：
  - `none` — 纯聊天
  - `execute` — 启动新任务给 Worker
  - `redirect` — 改变当前任务方向
  - `abort` — 取消当前任务
- 不执行工具，不做耗时操作

### Worker（执行脑）
- 收到 Talker 指令后步骤式执行
- 每步开始前检查 Blackboard.directive
- 支持 abort / redirect / pause
- 执行完每步写入 Blackboard.completedSteps

### Blackboard（共享状态）
```js
{
  currentTask: { goal, steps: [], currentStep, status },
  directive: null | "abort" | { type: "redirect", detail: "..." },
  completedSteps: [],
  workerLog: [],        // Worker 的执行日志，Talker 可读
  messages: []          // 对话历史
}
```

## 虚拟桌面

### 窗口系统
- 可拖拽、可调整大小、可最小化/关闭
- 窗口有 z-index 层级（点击置顶）
- 窗口类型：Finder / Terminal / TextEditor / Browser

### 窗口类型

**Finder**
- 显示虚拟文件系统的目录结构
- 图标视图（文件夹/文件图标）
- 双击文件夹进入，双击文件用 TextEditor 打开
- 路径栏显示当前路径

**Terminal**
- 命令行界面，用 agentic-shell 执行命令
- 支持基本命令：ls, cd, cat, echo, mkdir, touch, rm, cp, mv, grep, find, head, tail, wc
- 命令历史（上下箭头）

**TextEditor**
- 打开文件显示内容
- 可编辑，保存回虚拟文件系统
- 语法高亮（可选，不是必须）

**Browser**（可选，v2）
- 模拟网页浏览器
- 显示简单 HTML 内容

## Worker 工具定义

Worker 的 LLM 调用带以下 tools：

```js
tools: [
  { name: "open_finder", params: { path: string } },
  { name: "create_file", params: { path: string, content: string } },
  { name: "open_file", params: { path: string } },
  { name: "run_command", params: { command: string } },
  { name: "open_terminal", params: {} },
  { name: "close_window", params: { windowId: string } },
  { name: "read_file", params: { path: string } },
  { name: "list_directory", params: { path: string } },
]
```

## 技术栈
- 纯 HTML + CSS + JS，单个 index.html（或极少文件）
- agentic 胶水库（UMD，浏览器直接 `<script>` 引入）
  - agentic-core：LLM 调用（streaming + AbortController）
  - agentic-filesystem：虚拟文件系统
  - agentic-shell：虚拟 shell
- 用户输入 API key，直连 Anthropic/OpenAI
- 零构建，零后端

## 视觉风格
- macOS 风格窗口（圆角、标题栏、红黄绿按钮）
- 深色主题
- 对话面板简洁，类 iMessage 气泡

## 初始状态
- 虚拟文件系统预置一些文件：
  - /home/user/Desktop/
  - /home/user/Documents/
  - /home/user/Downloads/
  - /home/user/Documents/readme.txt（欢迎文件）
- 桌面打开一个 Finder 窗口（~/Desktop）
- 对话面板显示欢迎消息

## MVP 范围（v1）
1. 窗口系统（拖拽、层级、关闭）
2. Finder（浏览文件系统）
3. Terminal（执行命令）
4. TextEditor（查看/编辑文件）
5. Talker（即时对话 + streaming）
6. Worker（步骤式执行 + 工具调用）
7. 转向机制（abort + redirect）
8. API key 输入（首次使用）
