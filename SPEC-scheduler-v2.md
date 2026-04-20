# Fluid Agent — Runtime Scheduler Spec v2

> 在 SPEC-dispatch.md 基础上，新增三个核心机制：意图队列、观测-决策分离、Checkpoint 持久化。

## 1. 意图队列 + 优先级

### 问题

用户在 Worker 执行中途发消息，当前设计只有 `pendingIntents[]` 数组，没有优先级、没有去重、没有超时。

### 设计

```js
class IntentQueue {
  queue = []  // { id, intent, priority, createdAt, source }
  
  enqueue(intent, { priority = 'normal', source = 'talker' }) {
    this.queue.push({
      id: nanoid(),
      intent,        // Talker 解析出的 action block
      priority,      // 'urgent' | 'normal' | 'background'
      createdAt: Date.now(),
      source         // 'talker' | 'system' | 'worker'
    })
    this.sort()
  }
  
  sort() {
    const order = { urgent: 0, normal: 1, background: 2 }
    this.queue.sort((a, b) => 
      order[a.priority] - order[b.priority] || a.createdAt - b.createdAt
    )
  }
  
  peek() { return this.queue[0] || null }
  dequeue() { return this.queue.shift() || null }
  
  // 超时清理：normal 超过 60s 未处理降级为 background
  // urgent 超过 30s 未处理触发强制中断当前 Worker
  gc() {
    const now = Date.now()
    this.queue = this.queue.filter(item => {
      if (item.priority === 'background' && now - item.createdAt > 120_000) return false
      if (item.priority === 'normal' && now - item.createdAt > 60_000) {
        item.priority = 'background'
      }
      return true
    })
    this.sort()
  }
}
```

### 优先级规则

| 优先级 | 触发条件 | 行为 |
|--------|----------|------|
| urgent | 用户说"停"/"取消"/"改成..." | 当前 turn 结束后立即处理，可打断 Worker |
| normal | 用户发新任务 | 排队，下一个 checkpoint 时 Dispatcher 决策 |
| background | 系统事件（通知、定时任务） | 所有 Worker idle 时才处理 |

### Talker 如何标记优先级

Talker 的 action block 新增 `priority` 字段：

```json
{"action": "execute", "task": "...", "priority": "normal"}
{"action": "steer", "target": "auto", "instruction": "停下来", "priority": "urgent"}
```

Talker 判断优先级的规则（写进 system prompt）：
- 用户表达"停/取消/不要了/换一个" → urgent
- 用户发新任务但没说急 → normal
- 用户闲聊/问进度 → 不入队，Talker 直接回复

---

## 2. 观测-决策分离（Observe → Decide → Act）

### 问题

当前 Dispatcher 的 prompt 是手拼字符串，信息不完整、格式不稳定。

### 设计

Dispatcher 每次触发时，先构建结构化 Observation，再喂给 LLM 做 Decision。

```js
class Dispatcher {
  
  // Step 1: Observe — 纯数据收集，不调 LLM
  observe() {
    return {
      timestamp: Date.now(),
      
      // Worker 状态快照
      workers: Array.from(this.blackboard.workers.values()).map(w => ({
        id: w.id,
        task: w.task,
        status: w.status,          // running | suspended | pending | done
        turnCount: w.turnCount,
        maxTurns: 30,              // 护栏
        lastTool: w.lastTool,
        lastResultSummary: summarize(w.lastResult, 100),  // 最多 100 字
        elapsed: Date.now() - w.createdAt,
        stallTurns: w.stallTurns,  // 连续无产出 turn 数
        priority: w.priority
      })),
      
      // 意图队列
      intents: this.intentQueue.queue.slice(0, 5),  // 最多看 5 个
      
      // 资源状态
      resources: {
        activeSlots: this.blackboard.slots.size,
        maxSlots: this.blackboard.maxSlots,
        pendingCount: this.blackboard.queue.length
      },
      
      // 触发原因
      trigger: this.currentTrigger  // 'turn_complete' | 'new_intent' | 'error' | 'timeout'
    }
  }
  
  // Step 2: Decide — LLM 调用，输入是 Observation，输出是 Action
  async decide(observation) {
    // Fast path: 确定性规则，不调 LLM
    const fastAction = this.fastPath(observation)
    if (fastAction) return fastAction
    
    // Slow path: LLM 决策
    const prompt = this.buildDecisionPrompt(observation)
    const response = await this.ai.step([{ role: 'user', content: prompt }], {
      system: DISPATCHER_SYSTEM_PROMPT,
      tools: []  // Dispatcher 不用 tool，只输出 JSON 决策
    })
    return JSON.parse(response.text)
  }
  
  // Step 3: Act — 执行决策
  async act(decision) {
    switch (decision.action) {
      case 'continue': break
      case 'new':      await this.spawnWorker(decision); break
      case 'steer':    await this.steerWorker(decision); break
      case 'suspend':  await this.suspendWorker(decision); break
      case 'resume':   await this.resumeWorker(decision); break
      case 'abort':    await this.abortWorker(decision); break
    }
    // 记录决策日志
    this.log.push({ ...decision, observation: observation.timestamp, at: Date.now() })
  }
  
  // Fast path 规则
  fastPath(obs) {
    // 单 Worker 无新 intent → continue
    if (obs.workers.length === 1 && obs.intents.length === 0 && 
        obs.trigger === 'turn_complete' && obs.workers[0].status === 'running') {
      return { action: 'continue' }
    }
    // Worker done → 收尾
    if (obs.trigger === 'turn_complete' && obs.workers.find(w => w.status === 'done')) {
      return { action: 'cleanup', workerId: obs.workers.find(w => w.status === 'done').id }
    }
    // urgent intent + 单 Worker → 立即 steer
    if (obs.intents[0]?.priority === 'urgent' && obs.workers.length === 1) {
      return { action: 'steer', workerId: obs.workers[0].id, instruction: obs.intents[0].intent.task }
    }
    // 超过 max turn → 强制 abort
    const overLimit = obs.workers.find(w => w.turnCount >= w.maxTurns)
    if (overLimit) {
      return { action: 'abort', workerId: overLimit.id, reason: 'max_turns_exceeded' }
    }
    // stall 检测
    const stalled = obs.workers.find(w => w.stallTurns >= 5)
    if (stalled) {
      return { action: 'steer', workerId: stalled.id, instruction: '你似乎卡住了，换个方法试试' }
    }
    return null  // 需要 LLM 决策
  }
}
```

### Dispatcher System Prompt（精简版）

```
你是 Fluid OS 的调度器。你的职责是管理 Worker 的生命周期。

你会收到一个 JSON 格式的系统状态快照（Observation），你需要输出一个 JSON 格式的决策（Action）。

可用 Action：
- {"action": "continue"} — 当前 Worker 继续执行
- {"action": "new", "task": "...", "priority": "normal"} — 创建新 Worker
- {"action": "steer", "workerId": N, "instruction": "..."} — 给 Worker 注入新指令
- {"action": "suspend", "workerId": N} — 暂停 Worker
- {"action": "resume", "workerId": N} — 恢复 Worker
- {"action": "abort", "workerId": N, "reason": "..."} — 终止 Worker
- {"action": "parallel", "tasks": [...]} — 同时启动多个 Worker

决策原则：
1. 用户意图优先于系统效率
2. urgent intent 必须在 1 个 turn 内响应
3. 不确定时选 continue（保守策略）
4. 能并行就并行，但不超过 maxSlots

只输出 JSON，不要解释。
```

---

## 3. Checkpoint 持久化

### 问题

当前 Worker 状态只在内存中，页面刷新/crash 全部丢失。

### 设计

每个 turn 结束后，自动存 checkpoint。

```js
class CheckpointStore {
  constructor(storage) {
    // storage = localStorage / IndexedDB / 远程 API
    this.storage = storage
  }
  
  // 存 checkpoint
  async save(workerId, checkpoint) {
    const key = `checkpoint:${workerId}:${checkpoint.turnIndex}`
    await this.storage.set(key, checkpoint)
    // 同时更新 latest 指针
    await this.storage.set(`checkpoint:${workerId}:latest`, checkpoint)
  }
  
  // 恢复最新 checkpoint
  async restore(workerId) {
    return await this.storage.get(`checkpoint:${workerId}:latest`)
  }
  
  // 恢复到指定 turn
  async restoreTo(workerId, turnIndex) {
    return await this.storage.get(`checkpoint:${workerId}:${turnIndex}`)
  }
  
  // 列出所有 checkpoint（用于 UI 时间线）
  async list(workerId) {
    return await this.storage.keys(`checkpoint:${workerId}:*`)
  }
  
  // 清理已完成 Worker 的 checkpoint（保留最近 N 个）
  async gc(keepRecent = 10) { ... }
}
```

### Checkpoint 数据结构

```js
{
  workerId: 'w_abc123',
  turnIndex: 5,
  timestamp: 1713600000000,
  
  // Worker 完整状态（可恢复执行）
  worker: {
    task: '写一篇关于 AI 的文章',
    status: 'running',
    priority: 'normal',
    messages: [...],        // 完整对话历史（含 tool results）
    tools: ['fs', 'web'],   // 可用工具列表
    system: '...',          // system prompt
  },
  
  // Dispatcher 状态（可恢复调度）
  dispatcher: {
    intentQueue: [...],
    slots: { 0: 'w_abc123', 1: null, 2: null },
    decisionLog: [...]      // 最近 10 条决策
  },
  
  // 元数据
  meta: {
    totalTokens: 12500,
    toolCallCount: 8,
    elapsed: 45000
  }
}
```

### 恢复流程

```
页面加载
  ↓
CheckpointStore.list() → 找到未完成的 Worker
  ↓
UI 提示："上次有未完成的任务：'写文章'（进度 5/? turn），是否继续？"
  ↓
用户选择继续
  ↓
CheckpointStore.restore(workerId) → 拿到完整状态
  ↓
重建 Worker（messages + tools + system）
  ↓
Dispatcher.observe() → 正常调度循环
```

### 存储后端

| 阶段 | 后端 | 容量 | 持久性 |
|------|------|------|--------|
| v1 本地 | IndexedDB | ~50MB | 单设备 |
| v2 云端 | Supabase / R2 | 无限 | 跨设备 |

v1 用 IndexedDB 就够了——一个 checkpoint 大约 10-50KB（主要是 messages 数组），50MB 能存几百个 checkpoint。

### Context 压缩（resume 时防超 token）

Worker 被 suspend 很久后 resume，messages 可能很长。压缩策略：

```js
function compressForResume(checkpoint, maxTokens = 8000) {
  const { messages } = checkpoint.worker
  
  // 保留：system + 最近 N 条 + 关键 tool results
  const system = messages.filter(m => m.role === 'system')
  const recent = messages.slice(-10)
  
  // 中间部分压缩成摘要
  const middle = messages.slice(system.length, -10)
  if (middle.length > 0) {
    const summary = await summarizeMessages(middle)
    return [...system, { role: 'system', content: `[之前的工作摘要] ${summary}` }, ...recent]
  }
  
  return messages
}
```

---

## 集成到现有架构

### 修改 dispatcher.js

```diff
 class Dispatcher {
+  intentQueue = new IntentQueue()
+  checkpointStore = new CheckpointStore(indexedDB)
+  decisionLog = []
   
   // Talker 产生意图时调用
-  handleIntent(intent) {
-    this.blackboard.pendingIntents.push(intent)
-  }
+  handleIntent(intent, priority = 'normal') {
+    this.intentQueue.enqueue(intent, { priority, source: 'talker' })
+    // urgent 立即触发调度
+    if (priority === 'urgent') this.trigger('new_intent')
+  }
   
   // Worker turn 完成时调用
   async onTurnComplete(workerId, result) {
+    // 存 checkpoint
+    await this.checkpointStore.save(workerId, this.buildCheckpoint(workerId))
+    
+    // Observe → Decide → Act
+    const observation = this.observe()
+    const decision = await this.decide(observation)
+    await this.act(decision)
-    // 旧逻辑...
   }
 }
```

### 修改 Worker turn 循环

```diff
 while (!done) {
+  // Dispatcher checkpoint（beforeTurn）
+  const directive = await dispatcher.beforeTurn(workerId)
+  if (directive === 'suspend') { await checkpoint(); break }
+  if (directive === 'abort') { cleanup(); break }
+  if (directive.action === 'steer') { messages.push(steerMsg(directive)) }
   
   const turn = await ai.step(messages, { tools, system })
   if (turn.toolCalls.length) {
     const results = await executeTools(turn.toolCalls)
     messages.push(...ai.buildToolResults(turn.toolCalls, results))
   }
   
+  // Dispatcher checkpoint（afterTurn）
+  await dispatcher.onTurnComplete(workerId, turn)
   
   done = turn.done
 }
```

---

## 实现计划

| 阶段 | 内容 | 预计 |
|------|------|------|
| P1 | IntentQueue 类 + Talker priority 标记 | 1h |
| P2 | Dispatcher observe() + fastPath() + decide() 重构 | 2h |
| P3 | CheckpointStore + IndexedDB 后端 | 1.5h |
| P4 | Worker turn 循环集成 + resume 流程 | 2h |
| P5 | UI：未完成任务恢复提示 + Worker 状态面板 | 1.5h |

总计约 8 小时。P1-P2 是核心，做完就能跑。P3-P5 是产品化。
