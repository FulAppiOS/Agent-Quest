/**
 * Per-key FIFO for async work: tasks submitted under the same key run one
 * after another in submission order, tasks under different keys run freely.
 * Used to keep a session file's discovery and incremental updates ordered
 * even though each one awaits its own I/O (meta.json, settings.json). A
 * rejected task is reported to its caller but never blocks the next one.
 */
export function serializeByKey(): <T>(key: string, task: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const prev = tails.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(task);
    const settled = next.catch(() => undefined);
    tails.set(key, settled);
    void settled.then(() => {
      if (tails.get(key) === settled) tails.delete(key);
    });
    return next;
  };
}
