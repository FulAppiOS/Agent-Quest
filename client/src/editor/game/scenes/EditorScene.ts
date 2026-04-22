import * as Phaser from 'phaser';
import { editorBridge } from '../../EditorBridge';
import type {
  DecorationBrushPayload,
  EditorAction,
  EditorStats,
  EraseScope,
  Layer,
  LayerTogglePayload,
  NpcBrushPayload,
  PaintTilePayload,
  PathBrushPayload,
  PathStyle,
  Selection,
  ToolName,
} from '../../types/editor-events';
import type {
  AssetManifest,
  DecorationInstance,
  MapConfig,
  MapSettings,
  NpcPlacement,
  PathSegment,
  SlotInfo,
  TileRef,
  TilesetManifest,
} from '../../types/map';
import { TILE_SIZE } from '../../types/map';
import { cellKey, distPointToPolyline, worldToCell } from '../../utils/geometry';
import { makeDecorationId, makeNpcId, makePathId } from '../../utils/ids';
import { VILLAGE_GATE } from '../../../game/data/building-layout';
import { SERVER_URL } from '../../../config';
import { getActiveThemeId } from '../../../game/themes/registry';

interface InitData {
  manifest: AssetManifest;
  initialMap: MapConfig;
  slotInfo: SlotInfo[];
  activeSlot: number;
}

type EventName =
  | 'ed:tool:set' | 'ed:tile:set' | 'ed:decoration:set' | 'ed:path:style'
  | 'ed:erase:scope' | 'ed:layer:toggle' | 'ed:grid:toggle' | 'ed:action'
  | 'ed:zoom' | 'ed:delete:selected'
  | 'ed:npc:set' | 'ed:slot:load' | 'ed:settings:update'
  | 'ed:decoration:scale' | 'ed:npc:update'
  | 'ed:spawn:clear';

const SPAWN_PICK_RADIUS = 48;

type HandlerRef = { event: EventName; fn: (...args: unknown[]) => void };

const PATH_COLORS: Record<PathStyle, { fill: number; stroke: number }> = {
  main:      { fill: 0x7A6548, stroke: 0x4A3A24 },
  secondary: { fill: 0x8A7858, stroke: 0x5A4A2C },
  trail:     { fill: 0x5C4A30, stroke: 0x3A2A18 },
  plaza:     { fill: 0x7A6548, stroke: 0x4A3A24 },
};

const PATH_PICK_TOLERANCE = 32;
/** When drawing a path, snap the new vertex onto an existing vertex within this radius. */
const PATH_SNAP_RADIUS = 22;
const DECO_PICK_RADIUS = 60;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2.5;

/** Set `cam.zoom` to `newZoom` while keeping the world point currently
 * under screen coordinates (sx, sy) pinned to the same screen spot.
 * Phaser's setZoom() zooms around the camera's center; without this
 * helper a wheel-zoom visually slides the map toward the top-left. */
function zoomAroundPointer(cam: Phaser.Cameras.Scene2D.Camera, sx: number, sy: number, newZoom: number): void {
  const before = cam.getWorldPoint(sx, sy);
  cam.setZoom(newZoom);
  const after = cam.getWorldPoint(sx, sy);
  cam.scrollX += before.x - after.x;
  cam.scrollY += before.y - after.y;
}

export class EditorScene extends Phaser.Scene {
  private manifest!: AssetManifest;
  private mapConfig!: MapConfig;

  // UI state
  private tool: ToolName = 'paint';
  private paintBrush: PaintTilePayload = { tile: null, walkable: true };
  private decorationBrush: DecorationBrushPayload | null = null;
  private npcBrush: NpcBrushPayload | null = null;
  private pathBrush: PathBrushPayload = { style: 'main', width: 56 };
  private eraseScope: EraseScope = 'all';
  private layers: Record<Layer, boolean> = { terrain: true, decorations: true, paths: true, buildings: true };
  private gridVisible = true;
  private currentSlot = 1;

  // Runtime
  private selection: Selection | null = null;
  private currentPathPoints: Array<{ x: number; y: number }> | null = null;
  private pathPreview: Phaser.GameObjects.Graphics | null = null;
  private dirty = false;
  private dragBuildingId: string | null = null;
  private dragOffset = { x: 0, y: 0 };
  private panActive = false;
  private panStart = { x: 0, y: 0 };
  private cameraStart = { x: 0, y: 0 };
  /** Last position where a decoration was drag-placed — prevents overlap. */
  private lastDecoPlace = { x: -9999, y: -9999 };

  // Containers
  private terrainContainer!: Phaser.GameObjects.Container;
  private pathContainer!: Phaser.GameObjects.Container;
  private decorationContainer!: Phaser.GameObjects.Container;
  private npcContainer!: Phaser.GameObjects.Container;
  private buildingContainer!: Phaser.GameObjects.Container;
  private spawnContainer!: Phaser.GameObjects.Container;
  private gridGraphics!: Phaser.GameObjects.Graphics;
  private selectionOverlay!: Phaser.GameObjects.Graphics;
  private hoverOverlay!: Phaser.GameObjects.Graphics;
  private hoveredId: string | null = null;
  private baseGround: Phaser.GameObjects.TileSprite | null = null;

  // Lookup maps
  private terrainSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private decorationSprites = new Map<string, Phaser.GameObjects.Sprite | Phaser.GameObjects.Image>();
  private npcSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private npcRadiusGraphics = new Map<string, Phaser.GameObjects.Graphics>();
  private pathGraphics = new Map<string, Phaser.GameObjects.Graphics>();
  private buildingImages = new Map<string, Phaser.GameObjects.Image>();

  // Bridge handlers (for cleanup)
  private handlers: HandlerRef[] = [];

  // Debounce for stats
  private statsTimer: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super({ key: 'EditorScene' });
  }

  init(data: InitData): void {
    this.manifest = data.manifest;
    this.mapConfig = data.initialMap;
    this.currentSlot = data.activeSlot;
    // Ensure new fields exist on older map formats
    if (!this.mapConfig.npcs) this.mapConfig.npcs = [];
    if (!this.mapConfig.settings) this.mapConfig.settings = { heroScale: 0.50 };
  }

  create(): void {
    // Out-of-map background: black. Matches the VillageScene so switching
    // between editor and runtime views doesn't flash a different colour
    // beyond the world rect.
    this.cameras.main.setBackgroundColor('#000000');
    this.cameras.main.setBounds(-200, -200, this.mapConfig.world.width + 400, this.mapConfig.world.height + 400);

    // Disable browser context menu so right-click can pan the camera
    this.game.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.terrainContainer = this.add.container(0, 0).setDepth(-500);
    this.pathContainer = this.add.container(0, 0).setDepth(-400);
    this.decorationContainer = this.add.container(0, 0).setDepth(0);
    this.npcContainer = this.add.container(0, 0).setDepth(0);
    this.buildingContainer = this.add.container(0, 0).setDepth(0);
    this.spawnContainer = this.add.container(0, 0).setDepth(4800);
    this.gridGraphics = this.add.graphics().setDepth(5000);
    this.hoverOverlay = this.add.graphics().setDepth(5001);
    this.selectionOverlay = this.add.graphics().setDepth(5002);

    this.renderAll();
    this.drawGrid();

    this.setupInput();
    this.setupCamera();
    this.setupBridgeHandlers();

    // Fit initial view
    this.fitToViewport();

    // Notify React ready (and replay stats)
    editorBridge.emit('ed:ready', { manifest: this.manifest });
    this.emitStats();
    editorBridge.emit('ed:dirty', false);
    editorBridge.emit('ed:settings:loaded', this.mapConfig.settings ?? { heroScale: 0.50 });
    void this.refreshSlotInfo();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.onShutdown, this);
  }

  // ----------------------------- Rendering -----------------------------

  private renderAll(): void {
    // Clear
    for (const s of this.terrainSprites.values()) s.destroy();
    this.terrainSprites.clear();
    for (const s of this.decorationSprites.values()) s.destroy();
    this.decorationSprites.clear();
    for (const s of this.npcSprites.values()) s.destroy();
    this.npcSprites.clear();
    for (const g of this.npcRadiusGraphics.values()) g.destroy();
    this.npcRadiusGraphics.clear();
    for (const g of this.pathGraphics.values()) g.destroy();
    this.pathGraphics.clear();
    for (const i of this.buildingImages.values()) i.destroy();
    this.buildingImages.clear();
    if (this.baseGround !== null) { this.baseGround.destroy(); this.baseGround = null; }
    this.terrainContainer.removeAll(true);
    this.pathContainer.removeAll(true);
    this.decorationContainer.removeAll(true);
    this.npcContainer.removeAll(true);
    this.buildingContainer.removeAll(true);
    this.spawnContainer.removeAll(true);

    // Base ground
    const baseSet = this.findTileset(this.mapConfig.baseTileset) ?? this.manifest.tilesets[0];
    if (baseSet !== undefined && this.textures.exists(baseSet.key)) {
      this.baseGround = this.add.tileSprite(
        this.mapConfig.world.width / 2,
        this.mapConfig.world.height / 2,
        this.mapConfig.world.width,
        this.mapConfig.world.height,
        baseSet.key,
        0,
      ).setDepth(-1000);
    }

    // Terrain cells
    for (const [key, cell] of Object.entries(this.mapConfig.terrain)) {
      const parts = key.split(',');
      const a = parts[0];
      const b = parts[1];
      if (a === undefined || b === undefined) continue;
      const col = parseInt(a, 10);
      const row = parseInt(b, 10);
      if (Number.isNaN(col) || Number.isNaN(row)) continue;
      this.placeTerrainSprite(col, row, cell.tile);
    }

    // Paths
    for (const p of this.mapConfig.paths) {
      this.drawPath(p);
    }

    // Decorations
    for (const d of this.mapConfig.decorations) {
      this.placeDecorationSprite(d);
    }

    // NPCs
    for (const npc of this.mapConfig.npcs ?? []) {
      this.placeNpcSprite(npc);
    }

    // Buildings
    for (const b of this.mapConfig.buildings) {
      this.placeBuildingSprite(b.id, b.x, b.y);
    }

    // Spawn marker (always visible, dimmed when using the fallback)
    this.renderSpawnMarker();

    this.applyLayerVisibility();
  }

  private getSpawnPosition(): { x: number; y: number; isSet: boolean } {
    const s = this.mapConfig.spawn;
    if (s !== undefined) return { x: s.x, y: s.y, isSet: true };
    return { x: VILLAGE_GATE.x, y: VILLAGE_GATE.y, isSet: false };
  }

  private renderSpawnMarker(): void {
    this.spawnContainer.removeAll(true);
    const { x, y, isSet } = this.getSpawnPosition();
    const alpha = isSet ? 1.0 : 0.45;
    const fill = isSet ? 0xE8C466 : 0x888888;
    const stroke = isSet ? 0x3B2A10 : 0x222222;

    const g = this.add.graphics();
    g.setAlpha(alpha);
    // Pole
    g.lineStyle(3, stroke, 1);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y - 46);
    g.strokePath();
    // Flag (triangle pointing right)
    g.fillStyle(fill, 1);
    g.lineStyle(2, stroke, 1);
    g.beginPath();
    g.moveTo(x + 1, y - 46);
    g.lineTo(x + 24, y - 38);
    g.lineTo(x + 1, y - 30);
    g.closePath();
    g.fillPath();
    g.strokePath();
    // Base ring
    g.fillStyle(fill, 1);
    g.fillCircle(x, y, 5);
    g.lineStyle(2, stroke, 1);
    g.strokeCircle(x, y, 5);

    const label = this.add.text(x, y + 10, isSet ? 'SPAWN' : 'SPAWN (default)', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: isSet ? '#F5E4B0' : '#BBBBBB',
      stroke: '#000000',
      strokeThickness: 3,
    });
    label.setOrigin(0.5, 0);
    label.setAlpha(alpha);

    this.spawnContainer.add(g);
    this.spawnContainer.add(label);
  }

  private placeTerrainSprite(col: number, row: number, tile: TileRef): void {
    const key = cellKey(col, row);
    const existing = this.terrainSprites.get(key);
    if (existing !== undefined) { existing.destroy(); this.terrainSprites.delete(key); }
    if (!this.textures.exists(tile.set)) return;
    const sprite = this.add.sprite(
      col * TILE_SIZE + TILE_SIZE / 2,
      row * TILE_SIZE + TILE_SIZE / 2,
      tile.set,
      tile.frame,
    );
    sprite.setDepth(-900 + row);
    this.terrainContainer.add(sprite);
    this.terrainSprites.set(key, sprite);
  }

  private placeDecorationSprite(d: DecorationInstance): void {
    if (!this.textures.exists(d.textureKey)) return;
    const needsSprite = d.frame !== undefined || d.animated === true;
    const obj: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image = needsSprite
      ? this.add.sprite(d.x, d.y, d.textureKey, d.frame ?? 0)
      : this.add.image(d.x, d.y, d.textureKey, d.frame ?? 0);
    obj.setScale(d.scale);
    obj.setDepth(d.depth ?? d.y);
    if (d.tint !== undefined) obj.setTint(d.tint);
    if (d.animated === true && obj instanceof Phaser.GameObjects.Sprite) {
      const animKey = `${d.textureKey}:${d.animation ?? 'idle'}`;
      if (this.anims.exists(animKey)) obj.play(animKey);
    }
    obj.setData('decorationId', d.id);
    this.decorationContainer.add(obj);
    this.decorationSprites.set(d.id, obj);
  }

  private placeNpcSprite(npc: NpcPlacement): void {
    // Look up the concrete texture key from the manifest — under CC0 the
    // key is `cc0-${color}-${unit}-idle`, not `${color}-${unit}-idle`.
    const npcEntry = this.manifest.npcSprites.find(
      (s) => s.unit === npc.unit && s.color === npc.color,
    );
    const idleKey = npcEntry?.idleKey ?? `${npc.color}-${npc.unit}-idle`;
    if (!this.textures.exists(idleKey)) return;

    // Register idle animation if it doesn't exist yet. Prefer explicit
    // frame indices from the manifest (combined-sheet themes like CC0);
    // otherwise fall back to a contiguous 0..frameCount-1 range.
    const animKey = `anim-${idleKey}`;
    if (!this.anims.exists(animKey)) {
      const frameSpec = npcEntry?.idleFrameIndices !== undefined
        ? { frames: npcEntry.idleFrameIndices }
        : { start: 0, end: Math.max(0, (this.textures.get(idleKey).frameTotal - 1) - 1) };
      this.anims.create({
        key: animKey,
        frames: this.anims.generateFrameNumbers(idleKey, frameSpec),
        frameRate: 8,
        repeat: -1,
      });
    }

    const sprite = this.add.sprite(npc.x, npc.y, idleKey);
    sprite.setScale(npc.scale);
    sprite.setDepth(npc.y);
    sprite.setData('npcId', npc.id);
    sprite.play(animKey);
    this.npcContainer.add(sprite);
    this.npcSprites.set(npc.id, sprite);

    // Draw wander radius circle
    if (npc.wanderRadius > 0) {
      const g = this.add.graphics();
      g.lineStyle(1, 0xC4A35A, 0.3);
      g.strokeCircle(npc.x, npc.y, npc.wanderRadius);
      this.npcContainer.add(g);
      this.npcRadiusGraphics.set(npc.id, g);
    }
  }

  private placeBuildingSprite(id: string, x: number, y: number): void {
    const key = `building-${id}`;
    const def = this.manifest.protectedBuildings.find((b) => b.id === id);
    if (def === undefined) return;
    if (!this.textures.exists(key)) return;
    const img = this.add.image(x, y, key);
    img.setOrigin(0.5, 1);
    img.setScale(def.defaultScale);
    img.setDepth(y);
    img.setData('buildingId', id);
    img.setData('buildingLabel', def.label);
    this.buildingContainer.add(img);
    this.buildingImages.set(id, img);
  }

  private drawPath(p: PathSegment): void {
    const existing = this.pathGraphics.get(p.id);
    if (existing !== undefined) { existing.destroy(); this.pathGraphics.delete(p.id); }
    if (p.points.length < 2) return;

    const colors = PATH_COLORS[p.style];
    const g = this.add.graphics();
    const first = p.points[0];
    if (first === undefined) return;

    // Stroke (wider border) then fill (narrower)
    g.lineStyle(p.width + 3, colors.stroke, 1);
    g.beginPath();
    g.moveTo(first.x, first.y);
    for (let i = 1; i < p.points.length; i++) {
      const pt = p.points[i];
      if (pt !== undefined) g.lineTo(pt.x, pt.y);
    }
    g.strokePath();

    g.lineStyle(p.width, colors.fill, 1);
    g.beginPath();
    g.moveTo(first.x, first.y);
    for (let i = 1; i < p.points.length; i++) {
      const pt = p.points[i];
      if (pt !== undefined) g.lineTo(pt.x, pt.y);
    }
    g.strokePath();

    g.setData('pathId', p.id);
    this.pathContainer.add(g);
    this.pathGraphics.set(p.id, g);
  }

  private drawGrid(): void {
    this.gridGraphics.clear();
    if (!this.gridVisible) return;
    this.gridGraphics.lineStyle(1, 0xFFFFFF, 0.1);
    const w = this.mapConfig.world.width;
    const h = this.mapConfig.world.height;
    for (let x = 0; x <= w; x += TILE_SIZE) {
      this.gridGraphics.moveTo(x, 0);
      this.gridGraphics.lineTo(x, h);
    }
    for (let y = 0; y <= h; y += TILE_SIZE) {
      this.gridGraphics.moveTo(0, y);
      this.gridGraphics.lineTo(w, y);
    }
    this.gridGraphics.strokePath();
  }

  private applyLayerVisibility(): void {
    this.terrainContainer.setVisible(this.layers.terrain);
    if (this.baseGround !== null) this.baseGround.setVisible(this.layers.terrain);
    this.decorationContainer.setVisible(this.layers.decorations);
    this.npcContainer.setVisible(this.layers.decorations);
    this.pathContainer.setVisible(this.layers.paths);
    this.buildingContainer.setVisible(this.layers.buildings);
  }

  // ----------------------------- Camera -----------------------------

  private setupCamera(): void {
    this.cameras.main.setZoom(0.6);
    // Wheel zoom is anchored on the pointer: capture the world point under
    // the cursor, apply the new zoom, then shift scroll so that world point
    // stays under the cursor. Otherwise Phaser zooms around the camera
    // center and the map appears to drift toward the top-left corner.
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _go: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      const cur = cam.zoom;
      const next = Phaser.Math.Clamp(dy > 0 ? cur / 1.1 : cur * 1.1, this.minZoom(), MAX_ZOOM);
      zoomAroundPointer(cam, pointer.x, pointer.y, next);
    });

    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.currentPathPoints !== null) {
        this.currentPathPoints = null;
        if (this.pathPreview !== null) this.pathPreview.clear();
      }
    });
    this.input.keyboard?.on('keydown-ENTER', () => {
      if (this.tool === 'path') this.commitPath();
    });
    this.input.keyboard?.on('keydown-DELETE', () => {
      if (this.selection !== null) this.deleteSelection();
    });
    this.input.keyboard?.on('keydown-BACKSPACE', () => {
      if (this.selection !== null) this.deleteSelection();
    });

    // Scale shortcuts [ and ]
    this.input.keyboard?.on('keydown-OPEN_BRACKET', () => {
      if (this.selection?.kind === 'decoration') {
        this.updateDecorationScale(this.selection.id, -0.1);
      } else if (this.selection?.kind === 'npc') {
        this.updateNpcScale(this.selection.id, -0.05);
      }
    });
    this.input.keyboard?.on('keydown-CLOSED_BRACKET', () => {
      if (this.selection?.kind === 'decoration') {
        this.updateDecorationScale(this.selection.id, 0.1);
      } else if (this.selection?.kind === 'npc') {
        this.updateNpcScale(this.selection.id, 0.05);
      }
    });
    // F for fill terrain
    this.input.keyboard?.on('keydown-F', () => {
      if (this.tool === 'paint' && this.paintBrush.tile !== null) {
        void this.handleAction('fill-terrain');
      }
    });

    // Pan with SPACE
    const spaceKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    spaceKey?.on('down', () => { this.panActive = true; });
    spaceKey?.on('up', () => { this.panActive = false; });
  }

  /** Smallest zoom that still fits the whole world into the viewport.
   * Also acts as the hard floor for user-driven zoom-out: zooming below
   * this would reveal empty space past the map edge, which the user
   * doesn't want now that out-of-map is solid black. */
  private minZoom(): number {
    const cam = this.cameras.main;
    const w = this.mapConfig.world.width;
    const h = this.mapConfig.world.height;
    if (w <= 0 || h <= 0) return MIN_ZOOM;
    return Math.min(cam.width / w, cam.height / h);
  }

  private fitToViewport(): void {
    const cam = this.cameras.main;
    // Fit exactly to the world bounds (no extra margin) — matches the
    // minimum-zoom clamp so "fit" and "max zoom-out" land in the same spot.
    const zoom = Phaser.Math.Clamp(this.minZoom(), MIN_ZOOM, MAX_ZOOM);
    cam.setZoom(zoom);
    cam.centerOn(this.mapConfig.world.width / 2, this.mapConfig.world.height / 2);
  }

  // ----------------------------- Input handling -----------------------------

  private setupInput(): void {
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);
  }

  private isPanPointer(p: Phaser.Input.Pointer): boolean {
    // Right mouse button, middle mouse button, or SPACE+any button
    if (p.rightButtonDown()) return true;
    if (p.middleButtonDown()) return true;
    if (this.panActive && p.primaryDown) return true;
    return false;
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (this.isPanPointer(p)) {
      this.panStart = { x: p.x, y: p.y };
      const cam = this.cameras.main;
      this.cameraStart = { x: cam.scrollX, y: cam.scrollY };
      return;
    }

    const world = this.cameras.main.getWorldPoint(p.x, p.y);

    switch (this.tool) {
      case 'paint': this.applyPaint(world.x, world.y); break;
      case 'erase': this.applyErase(world.x, world.y); break;
      case 'decoration': this.placeDecoration(world.x, world.y); break;
      case 'path': this.addPathPoint(world.x, world.y, p); break;
      case 'move-building': this.startBuildingDrag(world.x, world.y); break;
      case 'select': this.applySelect(world.x, world.y); break;
      case 'npc': this.placeNpc(world.x, world.y); break;
      case 'spawn': this.placeSpawn(world.x, world.y); break;
    }
  }

  // ----------------------------- Tool: spawn -----------------------------

  private placeSpawn(wx: number, wy: number): void {
    if (wx < 0 || wy < 0 || wx > this.mapConfig.world.width || wy > this.mapConfig.world.height) return;
    this.mapConfig.spawn = { x: wx, y: wy };
    this.renderSpawnMarker();
    this.markDirty();
    // Refresh selection if spawn was currently selected
    if (this.selection?.kind === 'spawn') {
      this.selection = { kind: 'spawn', x: wx, y: wy, isSet: true };
      editorBridge.emit('ed:selected', this.selection);
      this.drawSelectionHighlight();
    }
  }

  private clearSpawn(): void {
    if (this.mapConfig.spawn === undefined) return;
    this.mapConfig.spawn = undefined;
    this.renderSpawnMarker();
    this.markDirty();
    if (this.selection?.kind === 'spawn') {
      const { x, y } = this.getSpawnPosition();
      this.selection = { kind: 'spawn', x, y, isSet: false };
      editorBridge.emit('ed:selected', this.selection);
      this.drawSelectionHighlight();
    }
  }

  private hitSpawn(wx: number, wy: number): boolean {
    const { x, y } = this.getSpawnPosition();
    // Hit box around the pole & flag (slightly generous)
    const dx = wx - x;
    const dy = wy - (y - 25);
    return dx * dx + dy * dy <= SPAWN_PICK_RADIUS * SPAWN_PICK_RADIUS;
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    // Pan dragging (right-click, middle-click, or SPACE+click)
    if (p.isDown && (p.rightButtonDown() || this.panActive || p.middleButtonDown())) {
      const dx = (p.x - this.panStart.x) / this.cameras.main.zoom;
      const dy = (p.y - this.panStart.y) / this.cameras.main.zoom;
      this.cameras.main.setScroll(this.cameraStart.x - dx, this.cameraStart.y - dy);
      return;
    }

    const world = this.cameras.main.getWorldPoint(p.x, p.y);

    if (p.isDown && p.primaryDown) {
      if (this.tool === 'paint') this.applyPaint(world.x, world.y);
      else if (this.tool === 'erase') this.applyErase(world.x, world.y);
      else if (this.tool === 'decoration') this.dragPlaceDecoration(world.x, world.y);
      else if (this.tool === 'move-building' && this.dragBuildingId !== null) {
        this.moveBuildingDrag(world.x, world.y);
      }
    }

    if (this.tool === 'path' && this.currentPathPoints !== null) {
      this.updatePathPreview(world.x, world.y);
    }

    // Hover highlight for select and erase tools
    if (this.tool === 'select' || this.tool === 'erase') {
      this.updateHoverHighlight(world.x, world.y);
    }
  }

  private onPointerUp(_p: Phaser.Input.Pointer): void {
    if (this.tool === 'move-building' && this.dragBuildingId !== null) {
      this.endBuildingDrag();
    }
    // Reset drag-place tracker so the next click always places
    this.lastDecoPlace = { x: -9999, y: -9999 };
  }

  // ----------------------------- Tool: paint -----------------------------

  private applyPaint(wx: number, wy: number): void {
    if (this.paintBrush.tile === null) return;
    if (wx < 0 || wy < 0 || wx > this.mapConfig.world.width || wy > this.mapConfig.world.height) return;
    const { col, row } = worldToCell(wx, wy);
    const key = cellKey(col, row);
    const tile = this.paintBrush.tile;

    const existing = this.mapConfig.terrain[key];
    if (existing !== undefined
        && existing.tile.set === tile.set
        && existing.tile.frame === tile.frame
        && existing.walkable === this.paintBrush.walkable) {
      return;
    }

    this.mapConfig.terrain[key] = { tile: { set: tile.set, frame: tile.frame }, walkable: this.paintBrush.walkable };
    this.placeTerrainSprite(col, row, tile);
    this.markDirty();
  }

  // ----------------------------- Tool: erase -----------------------------

  private applyErase(wx: number, wy: number): void {
    if (wx < 0 || wy < 0) return;
    const scope = this.eraseScope;

    if (scope === 'terrain' || scope === 'all') {
      const { col, row } = worldToCell(wx, wy);
      const key = cellKey(col, row);
      if (this.mapConfig.terrain[key] !== undefined) {
        delete this.mapConfig.terrain[key];
        const spr = this.terrainSprites.get(key);
        if (spr !== undefined) { spr.destroy(); this.terrainSprites.delete(key); }
        this.markDirty();
        if (scope === 'terrain') return;
      }
    }

    if (scope === 'decorations' || scope === 'all') {
      const hit = this.hitDecoration(wx, wy);
      if (hit !== null) {
        this.removeDecoration(hit);
        this.markDirty();
        if (scope === 'decorations') return;
      }
    }

    if (scope === 'paths' || scope === 'all') {
      const hit = this.hitPath(wx, wy);
      if (hit !== null) {
        this.removePath(hit);
        this.markDirty();
      }
    }
  }

  private removeDecoration(id: string): void {
    this.mapConfig.decorations = this.mapConfig.decorations.filter((d) => d.id !== id);
    const s = this.decorationSprites.get(id);
    if (s !== undefined) { s.destroy(); this.decorationSprites.delete(id); }
  }

  private removePath(id: string): void {
    this.mapConfig.paths = this.mapConfig.paths.filter((p) => p.id !== id);
    const g = this.pathGraphics.get(id);
    if (g !== undefined) { g.destroy(); this.pathGraphics.delete(id); }
  }

  // ----------------------------- Tool: decoration -----------------------------

  /** Minimum distance between drag-placed decorations (pixels). */
  private static readonly DECO_DRAG_MIN_DIST = 40;

  private placeDecoration(wx: number, wy: number): void {
    if (this.decorationBrush === null) return;
    if (wx < 0 || wy < 0 || wx > this.mapConfig.world.width || wy > this.mapConfig.world.height) return;
    const instance: DecorationInstance = {
      id: makeDecorationId(),
      textureKey: this.decorationBrush.key,
      frame: this.decorationBrush.frame,
      x: wx,
      y: wy,
      scale: this.decorationBrush.scale,
      animated: this.decorationBrush.animated,
      animation: this.decorationBrush.animation,
    };
    this.mapConfig.decorations.push(instance);
    this.placeDecorationSprite(instance);
    this.lastDecoPlace = { x: wx, y: wy };
    this.markDirty();
  }

  /** Place decoration while dragging — enforces minimum spacing to avoid overlap. */
  private dragPlaceDecoration(wx: number, wy: number): void {
    if (this.decorationBrush === null) return;
    const dx = wx - this.lastDecoPlace.x;
    const dy = wy - this.lastDecoPlace.y;
    if (dx * dx + dy * dy < EditorScene.DECO_DRAG_MIN_DIST * EditorScene.DECO_DRAG_MIN_DIST) return;
    this.placeDecoration(wx, wy);
  }

  // ----------------------------- Tool: npc -----------------------------

  private placeNpc(wx: number, wy: number): void {
    if (wx < 0 || wy < 0 || wx > this.mapConfig.world.width || wy > this.mapConfig.world.height) return;
    if (this.npcBrush === null) return;
    const npc: NpcPlacement = {
      id: makeNpcId(),
      unit: this.npcBrush.unit,
      color: this.npcBrush.color,
      x: wx,
      y: wy,
      scale: this.npcBrush.scale,
      wanderRadius: this.npcBrush.wanderRadius,
    };
    if (!this.mapConfig.npcs) this.mapConfig.npcs = [];
    this.mapConfig.npcs.push(npc);
    this.placeNpcSprite(npc);
    this.markDirty();
  }

  // ----------------------------- Tool: path -----------------------------

  /**
   * If (wx, wy) is within PATH_SNAP_RADIUS of an existing path vertex (from
   * any committed path or the in-progress path), return that vertex position.
   * This keeps the routing graph connected — heroes reuse waypoints instead
   * of running between near-but-disjoint paths.
   */
  private snapToExistingPathVertex(wx: number, wy: number): { x: number; y: number; snapped: boolean } {
    let best: { x: number; y: number; distSq: number } | null = null;
    const limitSq = PATH_SNAP_RADIUS * PATH_SNAP_RADIUS;
    for (const path of this.mapConfig.paths) {
      for (const pt of path.points) {
        const dx = wx - pt.x;
        const dy = wy - pt.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= limitSq && (best === null || d2 < best.distSq)) {
          best = { x: pt.x, y: pt.y, distSq: d2 };
        }
      }
    }
    // Allow snapping onto the first vertex of the in-progress path so users can close loops
    if (this.currentPathPoints !== null && this.currentPathPoints.length >= 2) {
      const first = this.currentPathPoints[0]!;
      const dx = wx - first.x;
      const dy = wy - first.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= limitSq && (best === null || d2 < best.distSq)) {
        best = { x: first.x, y: first.y, distSq: d2 };
      }
    }
    if (best !== null) return { x: best.x, y: best.y, snapped: true };
    return { x: wx, y: wy, snapped: false };
  }

  private addPathPoint(wx: number, wy: number, p: Phaser.Input.Pointer): void {
    // Double-click detection via timer on pointer
    const isDouble = p.getDuration() !== undefined && p.downTime - (p.upTime || 0) < 300 && this.currentPathPoints !== null && this.currentPathPoints.length >= 2;

    const snap = this.snapToExistingPathVertex(wx, wy);

    if (this.currentPathPoints === null) {
      this.currentPathPoints = [{ x: snap.x, y: snap.y }];
      if (this.pathPreview === null) {
        this.pathPreview = this.add.graphics().setDepth(6000);
      }
      this.pathPreview.clear();
    } else {
      this.currentPathPoints.push({ x: snap.x, y: snap.y });
      if (isDouble) {
        this.commitPath();
        return;
      }
    }
    this.renderPathPreview();
  }

  private updatePathPreview(wx: number, wy: number): void {
    if (this.currentPathPoints === null || this.currentPathPoints.length === 0) return;
    const snap = this.snapToExistingPathVertex(wx, wy);
    this.renderPathPreview({ x: snap.x, y: snap.y, snapped: snap.snapped });
  }

  private renderPathPreview(ghost?: { x: number; y: number; snapped?: boolean }): void {
    if (this.pathPreview === null || this.currentPathPoints === null) return;
    this.pathPreview.clear();
    const first = this.currentPathPoints[0];
    if (first === undefined) return;
    const colors = PATH_COLORS[this.pathBrush.style];
    this.pathPreview.lineStyle(this.pathBrush.width, colors.fill, 0.6);
    this.pathPreview.beginPath();
    this.pathPreview.moveTo(first.x, first.y);
    for (let i = 1; i < this.currentPathPoints.length; i++) {
      const pt = this.currentPathPoints[i];
      if (pt !== undefined) this.pathPreview.lineTo(pt.x, pt.y);
    }
    if (ghost !== undefined) {
      this.pathPreview.lineTo(ghost.x, ghost.y);
    }
    this.pathPreview.strokePath();

    // Draw vertex dots
    for (const pt of this.currentPathPoints) {
      this.pathPreview.fillStyle(0xC4A35A, 0.9);
      this.pathPreview.fillCircle(pt.x, pt.y, 4);
    }

    // Highlight the snap target if the ghost cursor is snapping
    if (ghost !== undefined && ghost.snapped === true) {
      this.pathPreview.lineStyle(2, 0xE8C466, 1);
      this.pathPreview.strokeCircle(ghost.x, ghost.y, PATH_SNAP_RADIUS / 2);
    }
  }

  private commitPath(): void {
    if (this.currentPathPoints === null || this.currentPathPoints.length < 2) {
      this.currentPathPoints = null;
      if (this.pathPreview !== null) this.pathPreview.clear();
      return;
    }
    const segment: PathSegment = {
      id: makePathId(),
      points: this.currentPathPoints.slice(),
      width: this.pathBrush.width,
      style: this.pathBrush.style,
    };
    this.mapConfig.paths.push(segment);
    this.drawPath(segment);
    this.currentPathPoints = null;
    if (this.pathPreview !== null) this.pathPreview.clear();
    this.markDirty();
  }

  // ----------------------------- Tool: move-building -----------------------------

  private startBuildingDrag(wx: number, wy: number): void {
    let hit: string | null = null;
    for (const [id, img] of this.buildingImages) {
      const b = img.getBounds();
      if (b.contains(wx, wy)) { hit = id; break; }
    }
    if (hit === null) return;
    this.dragBuildingId = hit;
    const img = this.buildingImages.get(hit);
    if (img !== undefined) {
      this.dragOffset = { x: wx - img.x, y: wy - img.y };
    }
  }

  private moveBuildingDrag(wx: number, wy: number): void {
    if (this.dragBuildingId === null) return;
    const img = this.buildingImages.get(this.dragBuildingId);
    if (img === undefined) return;
    const nx = wx - this.dragOffset.x;
    const ny = wy - this.dragOffset.y;
    img.setPosition(nx, ny);
    img.setDepth(ny);
  }

  private endBuildingDrag(): void {
    if (this.dragBuildingId === null) return;
    const img = this.buildingImages.get(this.dragBuildingId);
    if (img !== undefined) {
      const b = this.mapConfig.buildings.find((x) => x.id === this.dragBuildingId);
      if (b !== undefined) {
        b.x = img.x;
        b.y = img.y;
      }
      this.markDirty();
    }
    this.dragBuildingId = null;
  }

  // ----------------------------- Tool: select -----------------------------

  private applySelect(wx: number, wy: number): void {
    // Spawn marker takes priority — it sits on top of everything
    if (this.hitSpawn(wx, wy)) {
      const { x, y, isSet } = this.getSpawnPosition();
      this.selection = { kind: 'spawn', x, y, isSet };
      editorBridge.emit('ed:selected', this.selection);
      this.drawSelectionHighlight();
      return;
    }

    // Priority: buildings > decorations > paths
    for (const [id, img] of this.buildingImages) {
      if (img.getBounds().contains(wx, wy)) {
        const def = this.manifest.protectedBuildings.find((b) => b.id === id);
        this.selection = {
          kind: 'building',
          id,
          label: def?.label ?? id,
          x: img.x,
          y: img.y,
        };
        editorBridge.emit('ed:selected', this.selection);
        this.drawSelectionHighlight();
        return;
      }
    }

    const decoId = this.hitDecoration(wx, wy);
    if (decoId !== null) {
      const d = this.mapConfig.decorations.find((x) => x.id === decoId);
      if (d !== undefined) {
        this.selection = {
          kind: 'decoration',
          id: d.id,
          textureKey: d.textureKey,
          x: d.x,
          y: d.y,
          scale: d.scale,
        };
        editorBridge.emit('ed:selected', this.selection);
        this.drawSelectionHighlight();
        return;
      }
    }

    const npcId = this.hitNpc(wx, wy);
    if (npcId !== null) {
      const npc = (this.mapConfig.npcs ?? []).find((n) => n.id === npcId);
      if (npc !== undefined) {
        this.selection = {
          kind: 'npc',
          id: npc.id,
          unit: npc.unit,
          color: npc.color,
          x: npc.x,
          y: npc.y,
          scale: npc.scale,
          wanderRadius: npc.wanderRadius,
        };
        editorBridge.emit('ed:selected', this.selection);
        this.drawSelectionHighlight();
        return;
      }
    }

    const pathId = this.hitPath(wx, wy);
    if (pathId !== null) {
      const p = this.mapConfig.paths.find((x) => x.id === pathId);
      if (p !== undefined) {
        this.selection = {
          kind: 'path',
          id: p.id,
          pointCount: p.points.length,
          width: p.width,
          style: p.style,
        };
        editorBridge.emit('ed:selected', this.selection);
        this.drawSelectionHighlight();
        return;
      }
    }

    // Click empty space → deselect
    this.selection = null;
    editorBridge.emit('ed:selected', null);
    this.selectionOverlay.clear();
  }

  private drawSelectionHighlight(): void {
    this.selectionOverlay.clear();
    if (this.selection === null) return;
    this.selectionOverlay.lineStyle(2, 0xC4A35A, 0.9);
    if (this.selection.kind === 'decoration') {
      const img = this.decorationSprites.get(this.selection.id);
      if (img !== undefined) {
        const b = img.getBounds();
        this.selectionOverlay.strokeRect(b.x, b.y, b.width, b.height);
      }
    } else if (this.selection.kind === 'building') {
      const img = this.buildingImages.get(this.selection.id);
      if (img !== undefined) {
        const b = img.getBounds();
        this.selectionOverlay.strokeRect(b.x, b.y, b.width, b.height);
      }
    } else if (this.selection.kind === 'npc') {
      const sprite = this.npcSprites.get(this.selection.id);
      if (sprite !== undefined) {
        const b = sprite.getBounds();
        this.selectionOverlay.strokeRect(b.x, b.y, b.width, b.height);
      }
    } else if (this.selection.kind === 'path') {
      const selId = this.selection.id;
      const p = this.mapConfig.paths.find((x) => x.id === selId);
      if (p !== undefined && p.points.length >= 2) {
        const first = p.points[0];
        if (first === undefined) return;
        this.selectionOverlay.beginPath();
        this.selectionOverlay.moveTo(first.x, first.y);
        for (let i = 1; i < p.points.length; i++) {
          const pt = p.points[i];
          if (pt !== undefined) this.selectionOverlay.lineTo(pt.x, pt.y);
        }
        this.selectionOverlay.strokePath();
      }
    } else if (this.selection.kind === 'spawn') {
      const { x, y } = this.getSpawnPosition();
      this.selectionOverlay.strokeRect(x - 28, y - 52, 56, 68);
    }
  }

  // ----------------------------- Hover highlight -----------------------------

  private updateHoverHighlight(wx: number, wy: number): void {
    // Find what's under the cursor (same priority as select: spawn > buildings > decorations > npcs > paths)
    let hitId: string | null = null;

    if (this.hitSpawn(wx, wy)) {
      hitId = 's:spawn';
    }

    if (hitId === null) for (const [id, img] of this.buildingImages) {
      if (img.getBounds().contains(wx, wy)) { hitId = `b:${id}`; break; }
    }

    if (hitId === null) {
      const decoId = this.hitDecoration(wx, wy);
      if (decoId !== null) hitId = `d:${decoId}`;
    }

    if (hitId === null) {
      const npcId = this.hitNpc(wx, wy);
      if (npcId !== null) hitId = `n:${npcId}`;
    }

    if (hitId === null) {
      const pathId = this.hitPath(wx, wy);
      if (pathId !== null) hitId = `p:${pathId}`;
    }

    // Skip redraw if same element
    if (hitId === this.hoveredId) return;
    this.hoveredId = hitId;
    this.hoverOverlay.clear();

    if (hitId === null) {
      this.game.canvas.style.cursor = 'default';
      return;
    }

    this.game.canvas.style.cursor = 'pointer';
    this.hoverOverlay.lineStyle(2, 0xFFFFFF, 0.5);

    const kind = hitId[0];
    const id = hitId.slice(2);

    if (kind === 'b') {
      const img = this.buildingImages.get(id);
      if (img !== undefined) {
        const b = img.getBounds();
        this.hoverOverlay.strokeRect(b.x, b.y, b.width, b.height);
      }
    } else if (kind === 'd') {
      const img = this.decorationSprites.get(id);
      if (img !== undefined) {
        const b = img.getBounds();
        this.hoverOverlay.strokeRect(b.x - 4, b.y - 4, b.width + 8, b.height + 8);
      }
    } else if (kind === 'n') {
      const sprite = this.npcSprites.get(id);
      if (sprite !== undefined) {
        const b = sprite.getBounds();
        this.hoverOverlay.strokeRect(b.x - 4, b.y - 4, b.width + 8, b.height + 8);
      }
    } else if (kind === 's') {
      const { x, y } = this.getSpawnPosition();
      this.hoverOverlay.strokeRect(x - 28, y - 52, 56, 68);
    } else if (kind === 'p') {
      const path = this.mapConfig.paths.find((x) => x.id === id);
      if (path !== undefined && path.points.length >= 2) {
        const first = path.points[0];
        if (first !== undefined) {
          this.hoverOverlay.beginPath();
          this.hoverOverlay.moveTo(first.x, first.y);
          for (let i = 1; i < path.points.length; i++) {
            const pt = path.points[i];
            if (pt !== undefined) this.hoverOverlay.lineTo(pt.x, pt.y);
          }
          this.hoverOverlay.strokePath();
        }
      }
    }
  }

  // ----------------------------- Hit-testing -----------------------------

  private hitDecoration(wx: number, wy: number): string | null {
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const d of this.mapConfig.decorations) {
      const img = this.decorationSprites.get(d.id);
      if (img === undefined) continue;
      // Use expanded bounds for easier picking
      const b = img.getBounds();
      const pad = Math.max(20, DECO_PICK_RADIUS - Math.max(b.width, b.height) / 2);
      const expanded = new Phaser.Geom.Rectangle(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
      if (expanded.contains(wx, wy)) {
        const dx = wx - d.x;
        const dy = wy - d.y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          bestId = d.id;
        }
      }
    }
    return bestId;
  }

  private hitNpc(wx: number, wy: number): string | null {
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const npc of this.mapConfig.npcs ?? []) {
      const sprite = this.npcSprites.get(npc.id);
      if (sprite === undefined) continue;
      const b = sprite.getBounds();
      const pad = Math.max(20, DECO_PICK_RADIUS - Math.max(b.width, b.height) / 2);
      const expanded = new Phaser.Geom.Rectangle(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
      if (expanded.contains(wx, wy)) {
        const dx = wx - npc.x;
        const dy = wy - npc.y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          bestId = npc.id;
        }
      }
    }
    return bestId;
  }

  private hitPath(wx: number, wy: number): string | null {
    let bestId: string | null = null;
    let bestDist = PATH_PICK_TOLERANCE;
    for (const p of this.mapConfig.paths) {
      const d = distPointToPolyline(wx, wy, p.points);
      if (d < bestDist + p.width / 2) {
        bestDist = d;
        bestId = p.id;
      }
    }
    return bestId;
  }

  // ----------------------------- Actions -----------------------------

  private async handleAction(action: EditorAction): Promise<void> {
    switch (action) {
      case 'save': await this.saveMap(); break;
      case 'load-current': await this.loadCurrent(); break;
      case 'load-default': await this.loadDefault(); break;
      case 'clear-terrain':
        this.mapConfig.terrain = {};
        for (const s of this.terrainSprites.values()) s.destroy();
        this.terrainSprites.clear();
        this.markDirty();
        break;
      case 'clear-decorations':
        this.mapConfig.decorations = [];
        for (const s of this.decorationSprites.values()) s.destroy();
        this.decorationSprites.clear();
        this.markDirty();
        break;
      case 'clear-paths':
        this.mapConfig.paths = [];
        for (const g of this.pathGraphics.values()) g.destroy();
        this.pathGraphics.clear();
        this.markDirty();
        break;
      case 'clear-npcs':
        this.mapConfig.npcs = [];
        for (const s of this.npcSprites.values()) s.destroy();
        this.npcSprites.clear();
        for (const g of this.npcRadiusGraphics.values()) g.destroy();
        this.npcRadiusGraphics.clear();
        this.markDirty();
        break;
      case 'fill-terrain': {
        if (this.paintBrush.tile === null) break;
        const cols = Math.ceil(this.mapConfig.world.width / TILE_SIZE);
        const rows = Math.ceil(this.mapConfig.world.height / TILE_SIZE);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const key = cellKey(c, r);
            this.mapConfig.terrain[key] = {
              tile: { set: this.paintBrush.tile.set, frame: this.paintBrush.tile.frame },
              walkable: this.paintBrush.walkable,
            };
          }
        }
        this.renderAll();
        this.drawGrid();
        this.markDirty();
        break;
      }
      case 'set-active': {
        await fetch(`${SERVER_URL}/api/map/active`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slot: this.currentSlot }),
        });
        await this.refreshSlotInfo();
        break;
      }
      case 'reset-buildings':
        await this.resetBuildings();
        break;
      case 'reset-all':
        await this.loadDefault();
        break;
    }
  }

  /** Remove decorations, NPCs, paths, and terrain cells that are out of world bounds. */
  private pruneOutOfBounds(): void {
    const w = this.mapConfig.world.width;
    const h = this.mapConfig.world.height;

    // Decorations
    const badDecos: string[] = [];
    this.mapConfig.decorations = this.mapConfig.decorations.filter((d) => {
      if (d.x < 0 || d.x > w || d.y < 0 || d.y > h) { badDecos.push(d.id); return false; }
      return true;
    });
    for (const id of badDecos) {
      const spr = this.decorationSprites.get(id);
      if (spr !== undefined) { spr.destroy(); this.decorationSprites.delete(id); }
    }

    // NPCs
    const badNpcs: string[] = [];
    if (this.mapConfig.npcs) {
      this.mapConfig.npcs = this.mapConfig.npcs.filter((n) => {
        if (n.x < 0 || n.x > w || n.y < 0 || n.y > h) { badNpcs.push(n.id); return false; }
        return true;
      });
      for (const id of badNpcs) {
        const spr = this.npcSprites.get(id);
        if (spr !== undefined) { spr.destroy(); this.npcSprites.delete(id); }
        const rg = this.npcRadiusGraphics.get(id);
        if (rg !== undefined) { rg.destroy(); this.npcRadiusGraphics.delete(id); }
      }
    }

    // Paths — remove points out of bounds, drop paths with < 2 valid points
    this.mapConfig.paths = this.mapConfig.paths.filter((p) => {
      p.points = p.points.filter((pt) => pt.x >= 0 && pt.x <= w && pt.y >= 0 && pt.y <= h);
      if (p.points.length < 2) {
        const g = this.pathGraphics.get(p.id);
        if (g !== undefined) { g.destroy(); this.pathGraphics.delete(p.id); }
        return false;
      }
      return true;
    });

    // Spawn — clear if out of bounds so validator accepts the save
    if (this.mapConfig.spawn !== undefined) {
      const s = this.mapConfig.spawn;
      if (s.x < 0 || s.x > w || s.y < 0 || s.y > h) {
        this.mapConfig.spawn = undefined;
      }
    }

    // Terrain — remove cells outside grid
    const maxCol = Math.ceil(w / TILE_SIZE);
    const maxRow = Math.ceil(h / TILE_SIZE);
    for (const key of Object.keys(this.mapConfig.terrain)) {
      const parts = key.split(',');
      const col = parseInt(parts[0] ?? '', 10);
      const row = parseInt(parts[1] ?? '', 10);
      if (col < 0 || col >= maxCol || row < 0 || row >= maxRow) {
        delete this.mapConfig.terrain[key];
        const spr = this.terrainSprites.get(key);
        if (spr !== undefined) { spr.destroy(); this.terrainSprites.delete(key); }
      }
    }
  }

  private async saveMap(): Promise<void> {
    try {
      this.pruneOutOfBounds();
      this.mapConfig.meta.updatedAt = Date.now();
      // Stamp the save with the active theme so a later load can check
      // compatibility and prompt a switch when needed.
      this.mapConfig.settings.theme = getActiveThemeId();
      const res = await fetch(`${SERVER_URL}/api/map/${this.currentSlot}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.mapConfig),
      });
      if (!res.ok) {
        const text = await res.text();
        editorBridge.emit('ed:save:error', `HTTP ${res.status}: ${text}`);
        return;
      }
      const body = (await res.json()) as { ok: boolean; updatedAt?: number; error?: string };
      if (body.ok === false) {
        editorBridge.emit('ed:save:error', body.error ?? 'unknown error');
        return;
      }
      this.dirty = false;
      editorBridge.emit('ed:saved', { updatedAt: body.updatedAt ?? Date.now() });
      editorBridge.emit('ed:dirty', false);
      void this.refreshSlotInfo();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      editorBridge.emit('ed:save:error', msg);
    }
  }

  private async loadCurrent(): Promise<void> {
    await this.loadSlot(this.currentSlot);
  }

  private async loadSlot(slot: number): Promise<void> {
    try {
      const res = await fetch(`${SERVER_URL}/api/map/${slot}`);
      if (res.status === 204) {
        // Empty slot — load template, or default if no template
        const tRes = await fetch(`${SERVER_URL}/api/map/template`);
        if (tRes.status === 200) {
          this.mapConfig = (await tRes.json()) as MapConfig;
        } else {
          const dRes = await fetch(`${SERVER_URL}/api/map/default`);
          this.mapConfig = (await dRes.json()) as MapConfig;
        }
      } else {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.mapConfig = (await res.json()) as MapConfig;
      }
      // Ensure new fields exist on older map formats
      if (!this.mapConfig.npcs) this.mapConfig.npcs = [];
      if (!this.mapConfig.settings) this.mapConfig.settings = { heroScale: 0.50 };
      this.currentSlot = slot;
      this.renderAll();
      this.drawGrid();
      this.selection = null;
      editorBridge.emit('ed:selected', null);
      this.selectionOverlay.clear();
      this.dirty = false;
      editorBridge.emit('ed:dirty', false);
      this.emitStats();
      editorBridge.emit('ed:settings:loaded', this.mapConfig.settings);
      void this.refreshSlotInfo();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      editorBridge.emit('ed:save:error', msg);
    }
  }

  private async loadDefault(): Promise<void> {
    try {
      const res = await fetch(`${SERVER_URL}/api/map/default`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.mapConfig = (await res.json()) as MapConfig;
      if (!this.mapConfig.npcs) this.mapConfig.npcs = [];
      if (!this.mapConfig.settings) this.mapConfig.settings = { heroScale: 0.50 };
      this.renderAll();
      this.drawGrid();
      this.selection = null;
      editorBridge.emit('ed:selected', null);
      this.selectionOverlay.clear();
      this.markDirty();
      editorBridge.emit('ed:settings:loaded', this.mapConfig.settings);
      void this.refreshSlotInfo();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      editorBridge.emit('ed:save:error', msg);
    }
  }

  private async resetBuildings(): Promise<void> {
    try {
      const res = await fetch(`${SERVER_URL}/api/map/default`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const def = (await res.json()) as MapConfig;
      this.mapConfig.buildings = def.buildings;
      for (const i of this.buildingImages.values()) i.destroy();
      this.buildingImages.clear();
      for (const b of this.mapConfig.buildings) {
        this.placeBuildingSprite(b.id, b.x, b.y);
      }
      this.markDirty();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      editorBridge.emit('ed:save:error', msg);
    }
  }

  private deleteSelection(): void {
    if (this.selection === null) return;
    if (this.selection.kind === 'decoration') {
      this.removeDecoration(this.selection.id);
      this.selection = null;
      this.selectionOverlay.clear();
      editorBridge.emit('ed:selected', null);
      this.markDirty();
    } else if (this.selection.kind === 'npc') {
      this.removeNpc(this.selection.id);
      this.selection = null;
      this.selectionOverlay.clear();
      editorBridge.emit('ed:selected', null);
      this.markDirty();
    } else if (this.selection.kind === 'path') {
      this.removePath(this.selection.id);
      this.selection = null;
      this.selectionOverlay.clear();
      editorBridge.emit('ed:selected', null);
      this.markDirty();
    } else if (this.selection.kind === 'spawn') {
      // Delete on spawn marker resets to default (clears the spawn field)
      this.clearSpawn();
    }
    // Buildings cannot be deleted.
  }

  private removeNpc(id: string): void {
    this.mapConfig.npcs = (this.mapConfig.npcs ?? []).filter((n) => n.id !== id);
    const s = this.npcSprites.get(id);
    if (s !== undefined) { s.destroy(); this.npcSprites.delete(id); }
    const g = this.npcRadiusGraphics.get(id);
    if (g !== undefined) { g.destroy(); this.npcRadiusGraphics.delete(id); }
  }

  // ----------------------------- Bridge wiring -----------------------------

  private setupBridgeHandlers(): void {
    const register = (event: EventName, fn: (...args: unknown[]) => void): void => {
      editorBridge.on(event, fn);
      this.handlers.push({ event, fn });
    };

    register('ed:tool:set', (t: unknown) => {
      this.tool = t as ToolName;
      // Clear in-progress path when switching away from path tool
      if (this.tool !== 'path' && this.currentPathPoints !== null) {
        this.currentPathPoints = null;
        if (this.pathPreview !== null) this.pathPreview.clear();
      }
      // Clear hover highlight when switching tools
      this.hoverOverlay.clear();
      this.hoveredId = null;
      this.game.canvas.style.cursor = 'default';
    });
    register('ed:tile:set', (payload: unknown) => {
      const p = payload as PaintTilePayload;
      this.paintBrush = p;
    });
    register('ed:decoration:set', (payload: unknown) => {
      this.decorationBrush = payload as DecorationBrushPayload;
    });
    register('ed:path:style', (payload: unknown) => {
      this.pathBrush = payload as PathBrushPayload;
    });
    register('ed:erase:scope', (s: unknown) => {
      this.eraseScope = s as EraseScope;
    });
    register('ed:layer:toggle', (payload: unknown) => {
      const p = payload as LayerTogglePayload;
      this.layers[p.layer] = p.visible;
      this.applyLayerVisibility();
    });
    register('ed:grid:toggle', (visible: unknown) => {
      this.gridVisible = Boolean(visible);
      this.drawGrid();
    });
    register('ed:action', (action: unknown) => {
      void this.handleAction(action as EditorAction);
    });
    register('ed:zoom', (dir: unknown) => {
      const cam = this.cameras.main;
      if (dir === 'fit') { this.fitToViewport(); return; }
      // UI-button zoom anchors on the viewport center, not the cursor — the
      // user's pointer is over the zoom button in the top-left, not over
      // the content they want to keep fixed. Wheel-zoom keeps pointer-anchor
      // behaviour because there the cursor *is* on the content.
      const factor = dir === 'in' ? 1.15 : dir === 'out' ? 1 / 1.15 : 1;
      if (factor === 1) return;
      const next = Phaser.Math.Clamp(cam.zoom * factor, this.minZoom(), MAX_ZOOM);
      zoomAroundPointer(cam, cam.width / 2, cam.height / 2, next);
    });
    register('ed:delete:selected', () => {
      this.deleteSelection();
    });
    register('ed:npc:set', (payload: unknown) => {
      this.npcBrush = payload as NpcBrushPayload;
    });
    register('ed:slot:load', (slot: unknown) => {
      void this.loadSlot(slot as number);
    });
    register('ed:settings:update', (settings: unknown) => {
      const s = settings as MapSettings;
      this.mapConfig.settings = { ...(this.mapConfig.settings ?? { heroScale: 0.50 }), ...s };
      this.markDirty();
    });
    register('ed:decoration:scale', (payload: unknown) => {
      const p = payload as { id: string; scale: number };
      const deco = this.mapConfig.decorations.find((d) => d.id === p.id);
      if (deco !== undefined) {
        deco.scale = p.scale;
        const img = this.decorationSprites.get(p.id);
        if (img !== undefined) img.setScale(p.scale);
        this.markDirty();
        // Update selection if this decoration is selected
        if (this.selection?.kind === 'decoration' && this.selection.id === p.id) {
          this.selection = { ...this.selection, scale: p.scale };
          editorBridge.emit('ed:selected', this.selection);
          this.drawSelectionHighlight();
        }
      }
    });
    register('ed:spawn:clear', () => {
      this.clearSpawn();
    });
    register('ed:npc:update', (payload: unknown) => {
      const p = payload as Partial<NpcPlacement> & { id: string };
      const npc = (this.mapConfig.npcs ?? []).find((n) => n.id === p.id);
      if (npc !== undefined) {
        if (p.scale !== undefined) npc.scale = p.scale;
        if (p.wanderRadius !== undefined) npc.wanderRadius = p.wanderRadius;
        if (p.x !== undefined) npc.x = p.x;
        if (p.y !== undefined) npc.y = p.y;
        if (p.unit !== undefined) npc.unit = p.unit;
        if (p.color !== undefined) npc.color = p.color;
        // Re-render this NPC
        const oldSprite = this.npcSprites.get(p.id);
        if (oldSprite !== undefined) { oldSprite.destroy(); this.npcSprites.delete(p.id); }
        const oldG = this.npcRadiusGraphics.get(p.id);
        if (oldG !== undefined) { oldG.destroy(); this.npcRadiusGraphics.delete(p.id); }
        this.placeNpcSprite(npc);
        this.markDirty();
        // Update selection if this NPC is selected
        if (this.selection?.kind === 'npc' && this.selection.id === p.id) {
          this.selection = { kind: 'npc', ...npc };
          editorBridge.emit('ed:selected', this.selection);
          this.drawSelectionHighlight();
        }
      }
    });
  }

  private onShutdown = (): void => {
    for (const h of this.handlers) editorBridge.off(h.event, h.fn);
    this.handlers = [];
  };

  // ----------------------------- Helpers -----------------------------

  private findTileset(key: string): TilesetManifest | undefined {
    return this.manifest.tilesets.find((t) => t.key === key);
  }

  private markDirty(): void {
    if (!this.dirty) {
      this.dirty = true;
      editorBridge.emit('ed:dirty', true);
    }
    this.scheduleStats();
  }

  private scheduleStats(): void {
    if (this.statsTimer !== null) this.statsTimer.remove(false);
    this.statsTimer = this.time.delayedCall(100, () => this.emitStats());
  }

  private emitStats(): void {
    const stats: EditorStats = {
      terrainCells: Object.keys(this.mapConfig.terrain).length,
      decorations: this.mapConfig.decorations.length,
      paths: this.mapConfig.paths.length,
      buildings: this.mapConfig.buildings.length,
      npcs: this.mapConfig.npcs?.length ?? 0,
    };
    editorBridge.emit('ed:state:update', stats);
  }

  private async refreshSlotInfo(): Promise<void> {
    try {
      const res = await fetch(`${SERVER_URL}/api/map/slots`);
      if (res.ok) {
        const info = (await res.json()) as SlotInfo[];
        editorBridge.emit('ed:slots:updated', info);
      }
    } catch { /* ignore */ }
  }

  private updateDecorationScale(id: string, delta: number): void {
    const deco = this.mapConfig.decorations.find((d) => d.id === id);
    if (deco === undefined) return;
    const newScale = Math.max(0.05, deco.scale + delta);
    deco.scale = newScale;
    const img = this.decorationSprites.get(id);
    if (img !== undefined) img.setScale(newScale);
    this.markDirty();
    if (this.selection?.kind === 'decoration' && this.selection.id === id) {
      this.selection = { ...this.selection, scale: newScale };
      editorBridge.emit('ed:selected', this.selection);
      this.drawSelectionHighlight();
    }
  }

  private updateNpcScale(id: string, delta: number): void {
    const npc = (this.mapConfig.npcs ?? []).find((n) => n.id === id);
    if (npc === undefined) return;
    const newScale = Math.max(0.05, npc.scale + delta);
    npc.scale = newScale;
    const sprite = this.npcSprites.get(id);
    if (sprite !== undefined) sprite.setScale(newScale);
    this.markDirty();
    if (this.selection?.kind === 'npc' && this.selection.id === id) {
      this.selection = { ...this.selection, scale: newScale };
      editorBridge.emit('ed:selected', this.selection);
      this.drawSelectionHighlight();
    }
  }
}
