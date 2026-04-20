# Intent State Architecture — Spec

## Problem
Talker currently does both chat + scheduling decisions via action blocks. This causes:
- Duplicate tasks (same intent dispatched multiple times)
- No understanding of intent continuity (follow-ups create new tasks instead of steering)
- Talker prompt overloaded with scheduling rules

## Design

### New Module: `IntentState`
A persistent, observable intent registry stored in VFS at `/system/intents.json`.

```js
{
  "intents": {
    "music-1": {
      "id": "music-1",
      "goal": "找到并播放周杰伦的歌",
      "status": "active",        // active | done | cancelled
      "messages": [              // user messages that shaped this intent
        "找一下周杰伦的歌",
        "播放一下",
        "声音大一点"
      ],
      "createdAt": 1713600000000,
      "updatedAt": 1713600120000
    }
  },
  "version": 1
}
```

### Talker's New Role
Talker outputs a structured intent update (not action blocks):

```json
{
  "reply": "好的，找周杰伦的歌",
  "intents": [
    {
      "id": null,
      "action": "create",
      "goal": "找到并播放周杰伦的歌"
    }
  ]
}
```

Or for follow-ups:
```json
{
  "reply": "调大声一点",
  "intents": [
    {
      "id": "music-1",
      "action": "update",
      "goal": "播放周杰伦的歌，音量调大"
    }
  ]
}
```

Intent actions: `create`, `update`, `cancel`, `done`

### Dispatcher's New Role
Dispatcher watches IntentState changes and maps them to scheduling decisions:
- `create` → Scheduler.enqueue (new worker)
- `update` → Scheduler.steer (existing worker) or re-plan steps
- `cancel` → Scheduler.abort
- `done` → Scheduler.cleanup

Dispatcher also maintains `intentId → workerId` mapping.

### Data Flow
```
User msg → Talker (chat + intent extraction) → IntentState (VFS)
                                                     ↓ (watch)
                                               Dispatcher (scheduling decisions)
                                                     ↓
                                               Scheduler (execution)
                                                     ↓
                                               Worker (tools)
```

### What Changes
1. `intent-state.js` — new module, manages `/system/intents.json`
2. `agent.js` — Talker outputs intent updates instead of action blocks
3. `dispatcher.js` — watches IntentState, maps changes to scheduling
4. `intent-queue.js` — removed (replaced by IntentState)
5. Talker system prompt — simplified, no scheduling rules, just intent extraction

### What Stays
- `scheduler.js` — unchanged (still manages slots, retry, preemption)
- `checkpoint-store.js` — unchanged
- Worker loop — unchanged
- EventBus — unchanged
