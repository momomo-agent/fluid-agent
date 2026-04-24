import mitt from 'mitt'

const emitter = mitt()

export function useEventBus() {
  return {
    on: emitter.on,
    off: emitter.off,
    emit: emitter.emit,
    all: emitter.all
  }
}

// Global singleton for non-component code
export const EventBus = emitter
