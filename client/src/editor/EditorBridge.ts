/**
 * Dedicated EventEmitter between the Editor UI (React) and the Phaser EditorScene.
 * Kept separate from the main `eventBridge` to avoid coupling editor events with
 * agent/simulation events.
 *
 * Events — React → Scene:
 *   ed:tool:set           (tool: ToolName)
 *   ed:tile:set           (payload: { tile: TileRef | null; walkable: boolean })
 *   ed:decoration:set     (payload: { key: string; frame?: number; scale: number })
 *   ed:path:style         (payload: { style: PathStyle; width: number })
 *   ed:erase:scope        (scope: EraseScope)
 *   ed:layer:toggle       (payload: { layer: Layer; visible: boolean })
 *   ed:grid:toggle        (visible: boolean)
 *   ed:action             (action: EditorAction)
 *   ed:zoom               (direction: 'in' | 'out' | 'fit')
 *   ed:delete:selected    ()
 *   ed:npc:set            (payload: NpcBrushPayload)
 *   ed:slot:load          (slot: number)
 *   ed:settings:update    (settings: MapSettings)
 *
 * Events — Scene → React:
 *   ed:ready              (payload: { manifest: AssetManifest })
 *   ed:state:update       (payload: { terrainCells, decorations, paths, buildings, npcs })
 *   ed:selected           (payload: Selection | null)
 *   ed:saved              (payload: { updatedAt: number })
 *   ed:save:error         (message: string)
 *   ed:dirty              (dirty: boolean)
 *   ed:slots:updated      (slotInfo: SlotInfo[])
 *   ed:asset:errors       (payload: GroupedMissingAssets)  — emitted once at
 *                         boot if any texture failed to load. Sticky so React
 *                         panels that mount after the scene still receive it.
 */

type Listener = (...args: unknown[]) => void;

const STICKY_EVENTS = new Set<string>([
  'ed:ready',
  'ed:state:update',
  'ed:dirty',
  'ed:slots:updated',
  'ed:asset:errors',
]);

class EditorBridge {
  private listeners = new Map<string, Set<Listener>>();
  private lastArgs = new Map<string, unknown[]>();

  on(event: string, fn: Listener): void {
    let set = this.listeners.get(event);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);

    if (STICKY_EVENTS.has(event)) {
      const last = this.lastArgs.get(event);
      if (last !== undefined) {
        queueMicrotask(() => fn(...last));
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
      for (const fn of Array.from(set)) fn(...args);
    }
  }

  reset(): void {
    this.listeners.clear();
    this.lastArgs.clear();
  }
}

export const editorBridge = new EditorBridge();
