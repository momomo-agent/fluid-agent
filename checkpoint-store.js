/* checkpoint-store.js — Turn-level checkpoint persistence via agentic-store
 *
 * Saves Worker state after every turn for:
 *   - Crash recovery (resume from last checkpoint)
 *   - Cross-session continuity (close browser, reopen, continue)
 *   - Time-travel debugging (replay decisions)
 */
const CheckpointStore = (() => {
  let _store = null  // agentic-store instance
  const TABLE = 'checkpoints'
  const DDL = `CREATE TABLE IF NOT EXISTS ${TABLE} (
    worker_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (worker_id, turn_index)
  )`
  const META_TABLE = 'checkpoint_meta'
  const META_DDL = `CREATE TABLE IF NOT EXISTS ${META_TABLE} (
    worker_id TEXT PRIMARY KEY,
    task TEXT,
    status TEXT,
    turn_count INTEGER,
    updated_at INTEGER
  )`

  async function init(store) {
    _store = store
    if (_store.exec) {
      _store.exec(DDL)
      _store.exec(META_DDL)
    }
  }

  // Save a checkpoint after a turn
  async function save(workerId, turnIndex, checkpoint) {
    if (!_store) return

    if (_store.exec) {
      // SQLite path — structured storage
      _store.run(
        `INSERT OR REPLACE INTO ${TABLE} (worker_id, turn_index, data, created_at) VALUES (?, ?, ?, ?)`,
        [workerId, turnIndex, JSON.stringify(checkpoint), Date.now()]
      )
      _store.run(
        `INSERT OR REPLACE INTO ${META_TABLE} (worker_id, task, status, turn_count, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [workerId, checkpoint.task || '', checkpoint.status || 'running', turnIndex, Date.now()]
      )
    } else {
      // KV fallback
      await _store.set(`cp:${workerId}:${turnIndex}`, checkpoint)
      await _store.set(`cp:${workerId}:latest`, { turnIndex, ...checkpoint })
    }
  }

  // Restore latest checkpoint for a Worker
  async function restoreLatest(workerId) {
    if (!_store) return null

    if (_store.exec) {
      const row = _store.all(
        `SELECT data FROM ${TABLE} WHERE worker_id = ? ORDER BY turn_index DESC LIMIT 1`,
        [workerId]
      )
      if (row && row.length > 0) return JSON.parse(row[0].data)
      return null
    } else {
      return await _store.get(`cp:${workerId}:latest`)
    }
  }

  // Restore checkpoint at specific turn
  async function restoreAt(workerId, turnIndex) {
    if (!_store) return null

    if (_store.exec) {
      const row = _store.all(
        `SELECT data FROM ${TABLE} WHERE worker_id = ? AND turn_index = ?`,
        [workerId, turnIndex]
      )
      if (row && row.length > 0) return JSON.parse(row[0].data)
      return null
    } else {
      return await _store.get(`cp:${workerId}:${turnIndex}`)
    }
  }

  // List all unfinished Workers (for resume on page load)
  async function listUnfinished() {
    if (!_store) return []

    if (_store.exec) {
      return _store.all(
        `SELECT worker_id, task, status, turn_count, updated_at FROM ${META_TABLE} WHERE status IN ('running', 'suspended') ORDER BY updated_at DESC`
      ) || []
    } else {
      // KV fallback: scan keys
      const keys = await _store.keys()
      const latestKeys = keys.filter(k => k.startsWith('cp:') && k.endsWith(':latest'))
      const results = []
      for (const key of latestKeys) {
        const cp = await _store.get(key)
        if (cp && (cp.status === 'running' || cp.status === 'suspended')) {
          results.push(cp)
        }
      }
      return results
    }
  }

  // Mark a Worker as finished (won't show in listUnfinished)
  async function markDone(workerId, status = 'done') {
    if (!_store) return

    if (_store.exec) {
      _store.run(
        `UPDATE ${META_TABLE} SET status = ?, updated_at = ? WHERE worker_id = ?`,
        [status, Date.now(), workerId]
      )
    } else {
      const cp = await _store.get(`cp:${workerId}:latest`)
      if (cp) {
        cp.status = status
        await _store.set(`cp:${workerId}:latest`, cp)
      }
    }
  }

  // Garbage collection: remove old finished checkpoints
  async function gc(keepDays = 7) {
    if (!_store || !_store.exec) return

    const cutoff = Date.now() - keepDays * 86400_000
    // Get finished workers older than cutoff
    const old = _store.all(
      `SELECT worker_id FROM ${META_TABLE} WHERE status IN ('done', 'error', 'aborted') AND updated_at < ?`,
      [cutoff]
    ) || []

    for (const { worker_id } of old) {
      _store.run(`DELETE FROM ${TABLE} WHERE worker_id = ?`, [worker_id])
      _store.run(`DELETE FROM ${META_TABLE} WHERE worker_id = ?`, [worker_id])
    }
  }

  // Build checkpoint data from current Worker state
  function buildCheckpoint(worker, dispatcherState) {
    return {
      workerId: worker.id,
      task: worker.task,
      status: worker.status,
      turnIndex: worker.turnCount,
      timestamp: Date.now(),

      // Worker state (enough to resume execution)
      worker: {
        messages: worker.messages || [],
        tools: worker.tools || [],
        system: worker.system || '',
        steps: worker.steps || [],
        completedSteps: worker.completedSteps || [],
      },

      // Dispatcher state (enough to resume scheduling)
      dispatcher: {
        intentQueue: dispatcherState.intentQueue || [],
        workers: dispatcherState.workers || [],
        decisionLog: (dispatcherState.decisionLog || []).slice(-10),
      },

      // Metrics
      meta: {
        totalTokens: worker.totalTokens || 0,
        toolCallCount: worker.toolCallCount || 0,
        elapsed: Date.now() - (worker.createdAt || Date.now()),
      },
    }
  }

  return { init, save, restoreLatest, restoreAt, listUnfinished, markDone, gc, buildCheckpoint }
})()
