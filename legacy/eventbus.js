/* eventbus.js — Unified pub/sub + request/reply communication layer */
const EventBus = (() => {
  const listeners = Object.create(null)

  function on(event, handler) {
    (listeners[event] ||= []).push(handler)
    return () => { listeners[event] = listeners[event].filter(h => h !== handler) }
  }

  function emit(event, data) {
    const arr = listeners[event]
    if (arr) { if (typeof arr.forEach !== 'function') { console.error('EventBus: listeners[' + event + '] is not an array:', typeof arr, arr); return } arr.forEach(h => h(data)) }
    const wild = listeners['*']
    if (wild) { if (typeof wild.forEach !== 'function') { console.error('EventBus: listeners[*] is not an array:', typeof wild, wild); return } wild.forEach(h => h(event, data)) }
  }

  function once(event, handler) {
    const unsub = on(event, (data) => { unsub(); handler(data) })
  }

  // Request/reply pattern
  function request(event, data) {
    return new Promise((resolve) => {
      emit(event, { ...data, reply: resolve })
    })
  }

  return { on, emit, once, request }
})()
