# Fluid Agent — 愿景

## 一句话
AI 不是跑在 OS 上的 app，AI 就是 OS 本身。

## 定位
给所有人提前体验未来 Agent OS 的产品。用传统桌面隐喻降低认知门槛，但内核是 AI-native 的。Visual Talk 是终态愿景（纯意图驱动），Fluid Agent 是通往那里的桥梁，两者最终融合。

## 架构三层

```
OS 层（窗口、文件系统、shell）
  → Claw 层（记忆、skill、tool、自进化）
    → 模型层（agentic-service 本地 + 云端 fallback）
```

## 核心理念

- **VFS = 记忆载体**：agent 的 MEMORY.md、lessons、图谱全部存在文件系统里，用户能在 Finder 里看到 agent 的"大脑"，完全透明
- **Skill = 文件系统目录**：`/system/skills/xxx/SKILL.md`，agent 自己读、自己学、自己写新 skill，用户也能手动编辑
- **Tool = 自进化**：agent 发现需要新能力，自己写脚本存到 `/system/tools/`，下次就能用
- **Shell 接真实后端**：web 版走 WebSocket，Electron 版走 node-pty，从沙盒变成真实生产力
- **agentic-service 集成**：本地模型推理，零 API 成本，隐私安全

## 两条产品线

- **Web 版**：传播和体验入口，File System Access API 做轻量本地访问
- **Electron 版**：深度生产力，真实文件系统 + 真实 shell + 本地模型

store 抽象层让两条线共享同一套代码。

## 与 OpenClaw 的关系
架构同构（OS→Claw→模型），但面向终端用户，有可视化桌面。用户能看到 agent 在想什么、记住了什么、学会了什么。

---

*2026-04-16 kenefe & momo 确立*
