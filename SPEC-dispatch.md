# Fluid Agent — 调度系统 Spec

## 概述

三角色 LLM 架构，类比 OS 进程调度：

```
用户消息 → Talker（shell，面向用户）
              ↓ 调度意图
         Dispatcher（kernel scheduler，面向 Worker）
              ↓ 调度指令
         Worker 1, 2, 3...（进程，面向 OS）
```

## 角色定义

### Talker（对话脑）
- **职责**：回复用户 + 表达调度意图
- **特性**：streaming，永远不阻塞，首 token < 500ms
- **输入**：用户消息 + 对话历史 + Dispatcher 状态摘要
- **输出**：自然语言回复 + JSON action block（调度意图）
- **不做**：不执行工具，不等待 Worker，不做调度决策

Talker 的 action block 是"意图"不是"指令"——它表达"我觉得应该怎么做"，Dispatcher 决定"实际怎么做"。

```json
{"action": "execute", "task": "写一篇关于AI的文章", "steps": ["调研", "写大纲", "写正文"], "priority": 1}
{"action": "steer", "target": "auto", "instruction": "字体改大一点"}
{"action": "abort", "target": "all"}
{"action": "none"}
```

`target` 可以是 Worker ID 或 `"auto"`（让 Dispatcher 判断）。

### Dispatcher（调度脑）
- **职责**：管理 Worker 生命周期，turn 级调度
- **特性**：异步，不阻塞 Talker，context 短（只看摘要）
- **触发时机**：
  1. Talker 输出新意图
  2. Worker 完成一个 turn（检查点）
  3. Worker 报错或完成
- **输入**：Talker 意图 + 所有 Worker 状态摘要 + blackboard
- **输出**：调度指令（JSON）

```json
{"action": "new", "task": "...", "steps": [...], "priority": 1}
{"action": "steer", "workerId": 1, "instruction": "..."}
{"action": "preempt", "workerId": 2, "reason": "urgent task incoming"}
{"action": "resume", "workerId": 2}
{"action": "abort", "workerId": 1}
{"action": "reorder", "order": [3, 1, 2]}
{"action": "noop"}
```

Dispatcher 的 prompt context：

```
Workers:
  #1 "写文章" — running, turn 3/?, last tool: fs.write, elapsed: 12s
  #2 "查天气" — suspended, turn 1/?, reason: preempted by #3
  #3 "改字体" — ready, priority: 0 (urgent)

Queue: [#2 (suspended), #4 "播放音乐" (pending)]

Talker intent: {"action": "execute", "task": "打开 finder"}

Decide what to do.
```

### Worker（执行脑）
- **职责**：执行单个任务，调用工具
- **特性**：turn 循环（不是一次 ai.think 跑到底）
- **每个 turn**：一次 LLM 调用 → 可能调一个或多个 tool → 返回结果
- **turn 之间**：Dispatcher 检查点（可暂停、转向、终止）

## Turn 循环

```
Worker 启动
  ↓
loop:
  ├─ Dispatcher.beforeTurn(workerId) → 检查是否有指令
  │    ├─ suspend → 暂停，让出 slot
  │    ├─ steer → 注入新 instruction 到 messages
  │    ├─ abort → 终止
  │    └─ continue → 正常执行
  ├─ LLM 调用（单 turn，带 tools）
  ├─ 执行 tool（如果有）
  ├─ 更新 Worker 状态 → blackboard
  ├─ Dispatcher.afterTurn(workerId, result)
  │    ├─ 判断是否需要调整其他 Worker
  │    └─ 判断是否触发 Dispatcher LLM（有冲突/新意图时才调）
  └─ Worker 自己判断是否 done
       ├─ done → 报告结果，释放 slot
       └─ not done → 继续 loop
```

## Worker 状态机

```
pending → ready → running ⇄ suspended
                    ↓
              done / error / aborted
```

- **pending**：在队列里等 slot
- **ready**：slot 空了，准备执行
- **running**：正在执行 turn
- **suspended**：被 Dispatcher 暂停（保留 context，可恢复）
- **done/error/aborted**：终态

## Blackboard（共享状态）

```js
{
  workers: Map<id, {
    id, task, steps, status,
    turnCount, lastTool, lastResult,
    messages: [],        // Worker 的完整对话历史（用于恢复）
    priority, createdAt, elapsed
  }>,
  queue: [],             // pending workers
  slots: Map<slotIdx, workerId>,
  maxSlots: 3,
  
  // Talker ↔ Dispatcher 通信
  pendingIntents: [],    // Talker 产生的意图，Dispatcher 消费
  dispatcherState: {},   // Dispatcher 的状态摘要，Talker 读取
  
  // 全局
  messages: [],          // 对话历史
}
```

## Dispatcher 触发策略

所有调度决策统一走 LLM，不分快慢路径。简单场景（abort、单 Worker 无冲突）LLM 也能秒判，不需要维护两套逻辑。

触发时机：
- Talker 输出新意图
- Worker 完成一个 turn（检查点）
- Worker 报错或完成

## Talker 看到的 Dispatcher 状态

注入 Talker system prompt：

```
DISPATCH STATE:
- Workers: #1 "写文章"(running, turn 3, writing intro) | #2 "查天气"(suspended)
- Queue: 1 pending
- Slots: 2/3 used
- Last action: preempted #2 for urgent #3
```

Talker 据此回复用户："文章正在写，天气查询暂时排在后面，等文章写完就查。"

## 与 agentic-core 的关系

agentic-core 新增 `step()` 接口——单 turn 执行，调用方控制 tool 循环：

```js
// 新接口：单 turn，不自动循环
const turn = await ai.step(messages, { tools, system })
// turn = {
//   type: 'text' | 'tool_use',
//   text: '...',                    // LLM 文本回复
//   toolCalls: [{name, input}],     // 需要执行的 tool calls（调用方执行）
//   messages: [...]                 // 更新后的 messages（含 assistant 回复）
//   done: boolean                   // LLM 没有 tool_use = 认为完成
// }

// 调用方执行 tool
const toolResults = await executeTools(turn.toolCalls)
messages.push(...toolResults)

// → Dispatcher 检查点 ←
// Dispatcher 决定：继续 / steer / suspend / abort

const nextTurn = await ai.step(messages, { tools, system })
```

`step()` = `think()` 但 maxTurns: 1。发一次请求，拿到 LLM 回复，有 tool_use 就返回给调用方而不自己执行。

原有 `think()` 接口不变，内部可以基于 `step()` 重构。

## 实现优先级

1. **Worker turn 循环**（方案 B，自己管理 tool 循环）
2. **Dispatcher 快速路径**（规则，处理 abort/simple cases）
3. **Talker action block 扩展**（加 priority、target 字段）
4. **Blackboard 重构**（从单任务 → 多 Worker 状态）
5. **Dispatcher LLM 慢速路径**（多 Worker 冲突时触发）
6. **UI 反馈**（Dynamic Island 显示多 Worker 状态）

## 不做的事

- 不做 Worker 间通信（v1 Worker 互相独立）
- 不做自动依赖推断（用户或 Talker 显式指定）
- 不做 Worker 迁移（一个 Worker 绑定一个 slot 直到结束）
