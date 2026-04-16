# Fluid Agent — Roadmap

## Phase 1: Claw + 记忆（当前）
- [ ] agent 记忆系统：MEMORY.md / lessons 存在 VFS，Finder 可见
- [ ] Skill 管理：`/system/skills/` 目录，agent 自己读写
- [ ] Tool 管理：agent 自己写脚本到 `/system/tools/`，自进化
- [ ] 对话上下文持续化（长期记忆，不只是截断）

## Phase 2: UI 打磨
- [ ] Settings 页面完善
- [ ] 整体视觉打磨，demo 级体验
- [ ] 交互细节优化

## Phase 3: 真实世界接入
- [ ] Shell 接真实后端（WebSocket + xterm.js）
- [ ] VFS 映射真实文件系统（File System Access API）
- [ ] agentic-service 集成（本地模型推理）
- [ ] agentic-store 后端扩展（IndexedDB → SQLite / HTTP）

## Phase 4: Electron 打包
- [ ] Electron 壳 + node-pty + 真实 FS
- [ ] 签名公证分发（复用 Paw 经验）
- [ ] Web 版独立部署（fluid-agent.momomo.dev）

## Phase 5: Visual Talk 融合
- [ ] 探索 Fluid Agent × Visual Talk 的交汇点
- [ ] 传统隐喻 ↔ 纯意图驱动的渐进过渡

---

*2026-04-16 确立*
