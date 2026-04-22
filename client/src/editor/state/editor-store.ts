/**
 * Minimal external store for the Editor UI, consumed via useSyncExternalStore.
 * Keeps React panels reactive without adding a state-management dependency.
 */
import { useSyncExternalStore } from 'react';
import type {
  DecorationBrushPayload,
  EditorStats,
  Layer,
  NpcBrushPayload,
  PaintTilePayload,
  PathBrushPayload,
  PathStyle,
  Selection,
  ToolName,
} from '../types/editor-events';
import type { AssetManifest, SlotInfo, TileRef } from '../types/map';
import type { GroupedMissingAssets } from '../../game/data/asset-diagnostics';

export interface EditorUIState {
  tool: ToolName;
  paintTile: PaintTilePayload;
  decorationBrush: DecorationBrushPayload | null;
  pathBrush: PathBrushPayload;
  layers: Record<Layer, boolean>;
  gridVisible: boolean;
  stats: EditorStats;
  selection: Selection | null;
  saving: boolean;
  lastSavedAt: number | null;
  saveError: string | null;
  dirty: boolean;
  manifest: AssetManifest | null;
  tilesetTab: string; // active tileset key in palette (e.g. "terrain-color1")
  /** Active decoration group — matches DecorationManifest.group for the
   * currently selected palette tab. Empty string means "use the first
   * group present in the active theme's manifest". */
  decorationGroup: string;
  currentSlot: number;         // 1-5, default 1
  activeSlot: number;          // which slot is live in dashboard, default 1
  slotInfo: SlotInfo[];        // metadata for all 5 slots
  npcBrush: NpcBrushPayload | null;  // current NPC brush
  heroScale: number;           // from MapSettings, default 0.50
  /** Null when every texture loaded; otherwise categorised summary for
   * the non-blocking asset-warning banner. */
  assetErrors: GroupedMissingAssets | null;
  /** User-dismissed the banner — keep the error in state (for debugging)
   * but stop showing the banner until reload. */
  assetErrorsDismissed: boolean;
}

const initialState: EditorUIState = {
  tool: 'paint',
  paintTile: { tile: null, walkable: true },
  decorationBrush: null,
  pathBrush: { style: 'main', width: 56 },
  layers: { terrain: true, decorations: true, paths: true, buildings: true },
  gridVisible: true,
  stats: { terrainCells: 0, decorations: 0, paths: 0, buildings: 0, npcs: 0 },
  selection: null,
  saving: false,
  lastSavedAt: null,
  saveError: null,
  dirty: false,
  manifest: null,
  tilesetTab: 'terrain-color1',
  decorationGroup: '',
  currentSlot: 1,
  activeSlot: 1,
  slotInfo: [
    { slot: 1, name: 'Slot 1', updatedAt: null, isEmpty: true, isActive: true },
    { slot: 2, name: 'Slot 2', updatedAt: null, isEmpty: true, isActive: false },
    { slot: 3, name: 'Slot 3', updatedAt: null, isEmpty: true, isActive: false },
    { slot: 4, name: 'Slot 4', updatedAt: null, isEmpty: true, isActive: false },
    { slot: 5, name: 'Slot 5', updatedAt: null, isEmpty: true, isActive: false },
  ],
  npcBrush: null,
  heroScale: 0.50,
  assetErrors: null,
  assetErrorsDismissed: false,
};

type Listener = () => void;

class EditorStore {
  private state: EditorUIState = initialState;
  private listeners = new Set<Listener>();

  get = (): EditorUIState => this.state;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  set(partial: Partial<EditorUIState>): void {
    this.state = { ...this.state, ...partial };
    for (const l of Array.from(this.listeners)) l();
  }

  setTool(tool: ToolName): void { this.set({ tool }); }
  setPaintTile(tile: TileRef | null, walkable: boolean): void {
    this.set({ paintTile: { tile, walkable } });
  }
  setDecorationBrush(brush: DecorationBrushPayload | null): void {
    this.set({ decorationBrush: brush });
  }
  setPathBrush(style: PathStyle, width: number): void {
    this.set({ pathBrush: { style, width } });
  }
  toggleLayer(layer: Layer, visible: boolean): void {
    this.set({ layers: { ...this.state.layers, [layer]: visible } });
  }
  setGrid(visible: boolean): void { this.set({ gridVisible: visible }); }
  setStats(stats: EditorStats): void { this.set({ stats }); }
  setSelection(sel: Selection | null): void { this.set({ selection: sel }); }
  setSaving(saving: boolean): void { this.set({ saving }); }
  setSaved(ts: number): void {
    this.set({ saving: false, lastSavedAt: ts, saveError: null, dirty: false });
  }
  setSaveError(msg: string): void { this.set({ saving: false, saveError: msg }); }
  setDirty(dirty: boolean): void { this.set({ dirty }); }
  setManifest(manifest: AssetManifest): void {
    const firstTileset = manifest.tilesets[0]?.key ?? 'terrain-color1';
    this.set({ manifest, tilesetTab: firstTileset });
  }
  setTilesetTab(key: string): void { this.set({ tilesetTab: key }); }
  setDecorationGroup(group: string): void { this.set({ decorationGroup: group }); }
  setCurrentSlot(slot: number): void { this.set({ currentSlot: slot }); }
  setActiveSlot(slot: number): void { this.set({ activeSlot: slot }); }
  setSlotInfo(info: SlotInfo[]): void { this.set({ slotInfo: info }); }
  setNpcBrush(brush: NpcBrushPayload | null): void { this.set({ npcBrush: brush }); }
  setHeroScale(scale: number): void { this.set({ heroScale: scale }); }
  setAssetErrors(errors: GroupedMissingAssets | null): void { this.set({ assetErrors: errors }); }
  dismissAssetErrors(): void { this.set({ assetErrorsDismissed: true }); }
}

export const editorStore = new EditorStore();

export function useEditorStore<T>(selector: (s: EditorUIState) => T): T {
  return useSyncExternalStore(
    editorStore.subscribe,
    () => selector(editorStore.get()),
    () => selector(editorStore.get()),
  );
}
