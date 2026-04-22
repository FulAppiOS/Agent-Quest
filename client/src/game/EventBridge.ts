type Listener = (...args: unknown[]) => void;

/** Events whose last payload is replayed to new subscribers (fixes React↔Phaser boot race). */
const STICKY_EVENTS = new Set(['ws:connected', 'ws:disconnected', 'agents:updated']);

class EventBridge {
  private listeners = new Map<string, Set<Listener>>();
  private lastArgs = new Map<string, unknown[]>();

  on(event: string, fn: Listener): void {
    let set = this.listeners.get(event);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);

    // Replay the last emit to late subscribers of sticky events.
    // Deferred via queueMicrotask so the replay fires AFTER the current call
    // stack (e.g. Phaser scene.create()) completes and the scene status is
    // set to RUNNING — preventing isActive() from returning false mid-create.
    if (STICKY_EVENTS.has(event)) {
      const last = this.lastArgs.get(event);
      if (last !== undefined) {
        const args = last;
        queueMicrotask(() => fn(...args));
      }
    }
  }

  off(event: string, fn: Listener): void {
    this.listeners.get(event)?.delete(fn);
  }

  emit(event: string, ...args: unknown[]): void {
    if (STICKY_EVENTS.has(event)) {
      this.lastArgs.set(event, args);
    }
    const set = this.listeners.get(event);
    if (set !== undefined) {
      for (const fn of set) {
        fn(...args);
      }
    }
  }
}

export const eventBridge = new EventBridge();
