# Fluid Agent — Roadmap

## Phase 1: Claw + 记忆（当前）
- [x] agent 记忆系统：MEMORY.md / lessons 存在 VFS，Finder 可见
- [x] Skill 管理：`/system/skills/` 目录，agent 自己读写
- [x] Tool 管理：`/system/tools/` 目录结构
- [x] agent 主动记忆：每次对话后自动判断是否需要记忆，写入 MEMORY.md
- [x] 对话上下文持续化：超过 40 条自动摘要压缩，写入 context.md，保留长期记忆
- [ ] Skill/Tool 自进化闭环：agent 自己写 skill → 注册 → 下次用

## Phase 2: UI 打磨
- [x] Settings 页面（provider/key/model/baseUrl/voice）
- [x] 地图 app（Leaflet，搜索，坐标显示）
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

*2026-04-16 确立，4/17 更新*
