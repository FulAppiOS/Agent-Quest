import * as Phaser from 'phaser';
import { eventBridge } from '../EventBridge';
import { Building } from '../entities/Building';
import { HeroSprite } from '../entities/HeroSprite';
import { BUILDING_DEFS, VILLAGE_GATE, WORLD_WIDTH, WORLD_HEIGHT, getBuildingForActivity } from '../data/building-layout';
import { TerrainRenderer } from '../terrain/TerrainRenderer';
import { renderMapConfig } from '../terrain/MapConfigRenderer';
import { ensureAssetsLoaded } from '../data/asset-loader';
import { buildRoadNetworkFromPaths, resetRoadNetwork } from '../data/road-network';
import { NpcSprite } from '../entities/NpcSprite';
import type { AgentState } from '../../types/agent';
import type { AssetManifest, MapConfig, BuildingPosition, NpcPlacement } from '../../editor/types/map';
import { SERVER_URL as API_BASE } from '../../config';
import { getActiveTheme, rebaseSavedScale } from '../themes/registry';

/** Set `cam.zoom` to `newZoom` while keeping the world point currently
 * under screen coordinates (sx, sy) pinned to the same screen spot.
 * Without this, Phaser's setZoom() zooms around the camera's center and
 * the map appears to slide while zooming. */
function zoomAroundPointer(cam: Phaser.Cameras.Scene2D.Camera, sx: number, sy: number, newZoom: number): void {
  const before = cam.getWorldPoint(sx, sy);
  cam.setZoom(newZoom);
  const after = cam.getWorldPoint(sx, sy);
  cam.scrollX += before.x - after.x;
  cam.scrollY += before.y - after.y;
}

/** Hide agents idle for longer than this from the Phaser scene (kept in PartyBar). */
const IDLE_HIDE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Grid spacing between heroes at the same building. */
const GRID_SPACING_X = 40;
const GRID_SPACING_Y = 35;

export class VillageScene extends Phaser.Scene {
  private buildings: Building[] = [];
  private heroes = new Map<string, HeroSprite>();
  private onAgentsUpdated: ((agents: unknown) => void) | null = null;

  /** Tracks which hero IDs are at each building, in arrival order. */
  private buildingSlots = new Map<string, string[]>();

  /** Tracks which building each hero is currently assigned to. */
  private heroBuildingMap = new Map<string, string>();

  /** Atmospheric effects */
  private nightOverlay: Phaser.GameObjects.Graphics | null = null;
  private rainEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private rainEmitZone: Phaser.Geom.Rectangle | null = null;
  private rainSplashEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private rainSplashZone: Phaser.Geom.Rectangle | null = null;
  private rainDarkenOverlay: Phaser.GameObjects.Graphics | null = null;
  private lightningTimer: Phaser.Time.TimerEvent | null = null;
  private onNightToggle: ((on: unknown) => void) | null = null;
  private onRainToggle: ((on: unknown) => void) | null = null;

  /** Decorative NPCs placed via the map editor. */
  private editorNpcs: NpcSprite[] = [];

  /** Hero sprite scale — overridden by MapConfig settings if available. */
  /** Hero sprite scale — defaults to the active theme's baseline (0.5 for
   * Tiny Swords / CC0 edition). MapConfig-saved overrides are rebased
   * through `rebaseSavedScale` so they're stored once against the Tiny
   * Swords baseline and render proportionally under any theme. */
  private heroScale = getActiveTheme().heroScale;

  /** Spawn point used for new heroes. Overridden by MapConfig.spawn when present. */
  private heroSpawn: { x: number; y: number } = { x: VILLAGE_GATE.x, y: VILLAGE_GATE.y };

  /** True once bootstrapWorld() has finished spawning buildings. */
  private buildingsReady = false;

  /** Agent updates received before buildings were ready — replayed once ready. */
  private pendingAgentUpdate: AgentState[] | null = null;

  constructor() {
    super({ key: 'VillageScene' });
  }

  create(): void {
    // Out-of-map background: black so the area beyond world bounds reads as
    // empty space instead of a green field. The actual map fills the world
    // rect with its own ground layer (procedural or MapConfig tileset), so
    // this colour is only visible past the map edges or during zoom-out.
    this.cameras.main.setBackgroundColor('#000000');

    // Signal React that the village is up so it can reveal the HTML overlays
    // (TopBar, PartyBar, etc.) that should stay hidden during the BootScene.
    eventBridge.emit('village:ready');

    // Try to load a user-saved map from the editor; fall back to the procedural
    // terrain if none exists or the request fails. This is fire-and-forget —
    // the rest of create() (input, overlays, listeners) doesn't depend on it.
    void this.bootstrapWorld();

    // Set world bounds and fit the village into the viewport, then center the
    // map inside it. Anchoring on the world center (rather than a hardcoded
    // point near the gate) keeps the map visually centred regardless of the
    // fitted zoom level.
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.fitCamera();
    this.cameras.main.centerToBounds();

    // Re-fit when the browser/window resizes. Re-centering on bounds after
    // the zoom change keeps the map anchored in the middle of the new
    // viewport instead of drifting to the top-left.
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.cameras.main.setViewport(0, 0, gameSize.width, gameSize.height);
      this.fitCamera();
      this.cameras.main.centerToBounds();
    });

    // Drag to pan (mouse + touch, with threshold to avoid interfering with building clicks)
    let dragStartX = 0;
    let dragStartY = 0;
    let isDragging = false;
    let pinchStartDist = 0;
    let pinchStartZoom = 0;

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      dragStartX = pointer.x;
      dragStartY = pointer.y;
      isDragging = false;
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return;
      // Skip if two fingers are touching (pinch gesture)
      if (this.input.pointer1.isDown && this.input.pointer2.isDown) return;

      const dx = pointer.x - dragStartX;
      const dy = pointer.y - dragStartY;
      if (!isDragging && Math.abs(dx) + Math.abs(dy) > 8) {
        isDragging = true;
      }
      if (isDragging) {
        const cam = this.cameras.main;
        cam.scrollX -= (pointer.x - pointer.prevPosition.x) / cam.zoom;
        cam.scrollY -= (pointer.y - pointer.prevPosition.y) / cam.zoom;
      }
    });

    // Mouse wheel to zoom — anchored on the pointer. We capture the world
    // point under the cursor before changing zoom and then shift scroll so
    // that same world point lines up under the cursor afterwards; without
    // this the camera zooms around its current center, which feels like the
    // map is locked to the top-left corner while the viewport scales.
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _gameObjects: unknown[], _deltaX: number, deltaY: number) => {
      const cam = this.cameras.main;
      const newZoom = Phaser.Math.Clamp(cam.zoom - deltaY * 0.001, this.minZoom(), 1.5);
      zoomAroundPointer(cam, pointer.x, pointer.y, newZoom);
    });

    // Pinch to zoom (touch) — anchored on the midpoint between the two
    // pointers, same rationale as the wheel handler.
    this.input.addPointer(1); // enable second pointer for multi-touch
    this.events.on('update', () => {
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      if (p1.isDown && p2.isDown) {
        const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        if (pinchStartDist === 0) {
          pinchStartDist = dist;
          pinchStartZoom = this.cameras.main.zoom;
        } else {
          const scale = dist / pinchStartDist;
          const newZoom = Phaser.Math.Clamp(pinchStartZoom * scale, this.minZoom(), 1.5);
          const mx = (p1.x + p2.x) / 2;
          const my = (p1.y + p2.y) / 2;
          zoomAroundPointer(this.cameras.main, mx, my, newZoom);
        }
      } else {
        pinchStartDist = 0;
      }
    });

    // --- Night overlay ---
    this.nightOverlay = this.add.graphics();
    this.nightOverlay.fillStyle(0x000040, 0.35);
    // Pad beyond world bounds so the overlay still covers the screen when the
    // camera is zoomed out far enough to see past the map edges.
    this.nightOverlay.fillRect(-WORLD_WIDTH, -WORLD_HEIGHT, WORLD_WIDTH * 3, WORLD_HEIGHT * 3);
    // Depth must exceed the maximum Y-sorted sprite depth (~WORLD_HEIGHT) so
     // buildings and decorations placed near the bottom of the map stay covered.
    this.nightOverlay.setDepth(5000);
    this.nightOverlay.setVisible(false);

    this.onNightToggle = (on: unknown) => {
      try { if (!this.sys.isActive()) return; } catch { return; }
      this.nightOverlay?.setVisible(on as boolean);
    };
    eventBridge.on('effect:night:toggle', this.onNightToggle);

    // --- Rain particle emitter ---
    // Short thin raindrop texture with a soft gradient — small streaks feel
    // more natural than long lines.
    if (!this.textures.exists('raindrop')) {
      const canvasTex = this.textures.createCanvas('raindrop', 2, 7);
      if (canvasTex) {
        const ctx = canvasTex.getContext();
        const grad = ctx.createLinearGradient(0, 0, 0, 7);
        grad.addColorStop(0, 'rgba(210, 225, 245, 0.0)');
        grad.addColorStop(0.5, 'rgba(210, 225, 245, 0.7)');
        grad.addColorStop(1, 'rgba(230, 240, 255, 0.9)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 2, 7);
        canvasTex.refresh();
      }
    }

    // Ground splash texture — small bright dot that fades out
    if (!this.textures.exists('rainsplash')) {
      const splashTex = this.textures.createCanvas('rainsplash', 6, 6);
      if (splashTex) {
        const ctx = splashTex.getContext();
        const g = ctx.createRadialGradient(3, 3, 0, 3, 3, 3);
        g.addColorStop(0, 'rgba(220, 235, 255, 0.9)');
        g.addColorStop(1, 'rgba(220, 235, 255, 0.0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 6, 6);
        splashTex.refresh();
      }
    }

    // Emit above the current camera worldView; the Rectangle object is mutated
    // each frame so the rain always covers whatever portion of the map the
    // player is looking at (rain stays in world space, but tracks the camera).
    this.rainEmitZone = new Phaser.Geom.Rectangle(0, 0, WORLD_WIDTH, 1);
    // Drops fall across the entire viewport — lifespan calibrated to cover the
    // full visible height at typical zoom without dying prematurely.
    this.rainEmitter = this.add.particles(0, 0, 'raindrop', {
      emitZone: { source: this.rainEmitZone as unknown as Phaser.Types.GameObjects.Particles.RandomZoneSource, type: 'random' },
      speedY: { min: 650, max: 900 },
      speedX: { min: 70, max: 130 },
      lifespan: 2500,
      alpha: { start: 0.8, end: 0.7 },
      scale: { min: 0.7, max: 1.1 },
      rotate: 8,
      quantity: 7,
      frequency: 10,
      emitting: false,
    });
    this.rainEmitter.setDepth(5001);

    // Ground splashes — short-lived puffs emitted across the viewport floor.
    this.rainSplashZone = new Phaser.Geom.Rectangle(0, 0, WORLD_WIDTH, 1);
    this.rainSplashEmitter = this.add.particles(0, 0, 'rainsplash', {
      emitZone: { source: this.rainSplashZone as unknown as Phaser.Types.GameObjects.Particles.RandomZoneSource, type: 'random' },
      speedY: { min: -30, max: -10 },
      lifespan: 350,
      alpha: { start: 0.6, end: 0 },
      scale: { start: 0.4, end: 1.1 },
      quantity: 2,
      frequency: 45,
      emitting: false,
    });
    this.rainSplashEmitter.setDepth(5000);

    // Storm darkening overlay — activates with rain, independent from night mode.
    this.rainDarkenOverlay = this.add.graphics();
    this.rainDarkenOverlay.fillStyle(0x1a2a3a, 0.30);
    this.rainDarkenOverlay.fillRect(-WORLD_WIDTH, -WORLD_HEIGHT, WORLD_WIDTH * 3, WORLD_HEIGHT * 3);
    this.rainDarkenOverlay.setDepth(4997);
    this.rainDarkenOverlay.setVisible(false);

    // Keep emit zones aligned with the current camera worldView, but clamped
    // to the world bounds so rain doesn't fall outside the map when zoomed out.
    this.events.on('update', () => {
      if (this.rainEmitZone !== null) {
        const view = this.cameras.main.worldView;
        const margin = 80;
        // Drops drift right (~speedX.max * lifespan) after spawn — pull xEnd
        // back so drifted drops still die inside the world bounds.
        const driftCompensation = 325;
        const xStart = Math.max(0, view.x - margin);
        const xEnd = Math.min(WORLD_WIDTH - driftCompensation, view.x + view.width + margin);
        this.rainEmitZone.setTo(xStart, view.y - margin, Math.max(0, xEnd - xStart), 1);
      }
      if (this.rainSplashZone !== null) {
        const view = this.cameras.main.worldView;
        const bandTop = view.y + view.height * 0.72;
        const bandHeight = view.height * 0.26;
        const xStart = Math.max(0, view.x);
        const xEnd = Math.min(WORLD_WIDTH, view.x + view.width);
        this.rainSplashZone.setTo(xStart, bandTop, Math.max(0, xEnd - xStart), bandHeight);
      }
    });

    this.onRainToggle = (on: unknown) => {
      try { if (!this.sys.isActive()) return; } catch { return; }
      if (on as boolean) {
        this.rainEmitter?.start();
        this.rainSplashEmitter?.start();
        this.rainDarkenOverlay?.setVisible(true);
        this.scheduleLightning();
      } else {
        this.rainEmitter?.stop();
        this.rainSplashEmitter?.stop();
        this.rainDarkenOverlay?.setVisible(false);
        this.lightningTimer?.remove();
        this.lightningTimer = null;
      }
    };
    eventBridge.on('effect:rain:toggle', this.onRainToggle);

    // Listen for agent updates from React
    this.onAgentsUpdated = (agents: unknown) => {
      try { if (!this.sys.isActive()) return; } catch { return; }
      this.handleAgentUpdate(agents as AgentState[]);
    };
    eventBridge.on('agents:updated', this.onAgentsUpdated);

    const cleanup = () => {
      if (this.onAgentsUpdated !== null) {
        eventBridge.off('agents:updated', this.onAgentsUpdated);
        this.onAgentsUpdated = null;
      }
      if (this.onNightToggle !== null) {
        eventBridge.off('effect:night:toggle', this.onNightToggle);
        this.onNightToggle = null;
      }
      if (this.onRainToggle !== null) {
        eventBridge.off('effect:rain:toggle', this.onRainToggle);
        this.onRainToggle = null;
      }
      this.lightningTimer?.remove();
      this.lightningTimer = null;
      for (const hero of this.heroes.values()) {
        hero.destroy();
      }
      this.heroes.clear();
      this.buildings = [];
      this.buildingSlots.clear();
      this.heroBuildingMap.clear();
      for (const npc of this.editorNpcs) npc.destroy();
      this.editorNpcs = [];
    };
    this.events.on('shutdown', cleanup);
    this.events.on('destroy', cleanup);
  }

  // ---------------------------------------------------------------------------
  // World bootstrap — prefer saved MapConfig, fall back to procedural terrain
  // ---------------------------------------------------------------------------

  private async bootstrapWorld(): Promise<void> {
    let mapConfig: MapConfig | null = null;
    let manifest: AssetManifest | null = null;
    let mapStatus: number | string = 'n/a';
    let manifestStatus: number | string = 'n/a';
    let fetchError: unknown = null;
    try {
      const mapRes = await fetch(`${API_BASE}/api/map`);
      mapStatus = mapRes.status;
      if (mapRes.status === 200) {
        mapConfig = await mapRes.json() as MapConfig;

        // Single-theme project — the server lazy-migrates legacy ids to
        // 'tiny-swords-cc0' on load, so no runtime switch is possible.
        const activeTheme = getActiveTheme().id;

        // Fetch the asset manifest for the (now aligned) theme so
        // decorations/buildings referenced by mapConfig resolve correctly.
        const manRes = await fetch(`${API_BASE}/api/assets/manifest?theme=${encodeURIComponent(activeTheme)}`);
        manifestStatus = manRes.status;
        if (manRes.ok) manifest = await manRes.json() as AssetManifest;
      }
    } catch (err) {
      fetchError = err;
    }

    console.log('[VillageScene] bootstrapWorld', {
      mapStatus,
      manifestStatus,
      mapConfigLoaded: mapConfig !== null,
      manifestLoaded: manifest !== null,
      terrainTiles: mapConfig ? Object.keys(mapConfig.terrain ?? {}).length : 0,
      buildings: mapConfig?.buildings?.length ?? 0,
      mapName: mapConfig?.meta?.name,
      fetchError: fetchError ? String(fetchError) : null,
    });

    try { if (!this.sys.isActive()) return; } catch { return; }

    if (mapConfig !== null && manifest !== null) {
      console.log('[VillageScene] rendering SAVED map from /api/map');
      await ensureAssetsLoaded(this, manifest, mapConfig);
      try { if (!this.sys.isActive()) return; } catch { return; }
      renderMapConfig(this, mapConfig, manifest);
      this.spawnBuildings(mapConfig.buildings);

      // Build road network from editor paths so heroes follow painted roads
      buildRoadNetworkFromPaths(mapConfig.paths, mapConfig.buildings);

      // Apply hero scale from map settings
      if (mapConfig.settings?.heroScale) {
        this.heroScale = rebaseSavedScale(mapConfig.settings.heroScale);
      }

      // Always reassign so a reload of a slot without spawn reverts cleanly
      this.heroSpawn = mapConfig.spawn
        ? { x: mapConfig.spawn.x, y: mapConfig.spawn.y }
        : { x: VILLAGE_GATE.x, y: VILLAGE_GATE.y };

      // Spawn editor-placed decorative NPCs
      if (mapConfig.npcs && mapConfig.npcs.length > 0) {
        this.spawnEditorNpcs(mapConfig.npcs);
      }
    } else {
      console.warn('[VillageScene] FALLBACK → procedural TerrainRenderer', {
        reason: mapConfig === null ? 'mapConfig is null' : 'manifest is null',
        mapStatus,
        manifestStatus,
      });
      new TerrainRenderer(this).render();
      this.spawnBuildings(null);
      resetRoadNetwork();
    }

    // Buildings are now spawned — process any buffered agent updates
    this.buildingsReady = true;
    if (this.pendingAgentUpdate !== null) {
      const pending = this.pendingAgentUpdate;
      this.pendingAgentUpdate = null;
      this.handleAgentUpdate(pending);
    }
  }

  /** Calculate zoom so the village area (~1100×700 centred at 1400,780) fills the viewport. */
  private fitCamera(): void {
    const cam = this.cameras.main;
    const villageW = 1100;
    const villageH = 700;
    const zoomX = cam.width / villageW;
    const zoomY = cam.height / villageH;
    cam.setZoom(Phaser.Math.Clamp(Math.min(zoomX, zoomY) * 0.85, this.minZoom(), 1.5));
  }

  /** Lower zoom bound: the larger of the two viewport/world ratios, so the
   * world always fully covers the viewport — zooming out past this would
   * expose the canvas background past the tile grid, which the user has
   * asked to avoid. */
  private minZoom(): number {
    const cam = this.cameras.main;
    if (WORLD_WIDTH <= 0 || WORLD_HEIGHT <= 0) return 0.35;
    return Math.max(cam.width / WORLD_WIDTH, cam.height / WORLD_HEIGHT);
  }

  /** Queue the next lightning strike at a random interval while rain is on. */
  private scheduleLightning(): void {
    this.lightningTimer?.remove();
    const delay = Phaser.Math.Between(5000, 13000);
    this.lightningTimer = this.time.delayedCall(delay, () => {
      this.triggerLightning();
      // Reschedule only if rain is still active.
      if (this.rainDarkenOverlay?.visible === true) this.scheduleLightning();
    });
  }

  /** Fire a bright camera flash, occasionally followed by a dimmer afterflash. */
  private triggerLightning(): void {
    try { if (!this.sys.isActive()) return; } catch { return; }
    const cam = this.cameras.main;
    cam.flash(140, 225, 232, 255, true);
    if (Math.random() < 0.55) {
      this.time.delayedCall(180, () => {
        try { if (!this.sys.isActive()) return; } catch { return; }
        cam.flash(90, 200, 215, 255, true);
      });
    }
  }

  private spawnBuildings(overrides: BuildingPosition[] | null): void {
    for (const def of BUILDING_DEFS) {
      const override = overrides?.find((p) => p.id === def.id);
      const resolved = override !== undefined
        ? { ...def, x: override.x, y: override.y }
        : def;
      this.buildings.push(new Building(this, resolved));
    }
  }

  private spawnEditorNpcs(npcs: NpcPlacement[]): void {
    for (const npc of npcs) {
      const sprite = new NpcSprite(
        this,
        npc.unit,
        npc.color,
        npc.x,
        npc.y,
        npc.wanderRadius,
        Math.floor(Math.random() * 10000),
        rebaseSavedScale(npc.scale),
      );
      this.editorNpcs.push(sprite);
    }
  }

  // ---------------------------------------------------------------------------
  // Grid position calculation
  // ---------------------------------------------------------------------------

  private calcGridPositions(doorX: number, doorY: number, count: number): Array<{ x: number; y: number }> {
    if (count === 0) return [];
    if (count === 1) return [{ x: doorX, y: doorY }];

    const cols = Math.ceil(Math.sqrt(count));
    const positions: Array<{ x: number; y: number }> = [];
    const offsetX = ((cols - 1) * GRID_SPACING_X) / 2;

    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions.push({
        x: doorX - offsetX + col * GRID_SPACING_X,
        y: doorY + row * GRID_SPACING_Y,
      });
    }
    return positions;
  }

  // ---------------------------------------------------------------------------
  // Slot management
  // ---------------------------------------------------------------------------

  private addToSlot(buildingId: string, heroId: string): void {
    let slots = this.buildingSlots.get(buildingId);
    if (slots === undefined) {
      slots = [];
      this.buildingSlots.set(buildingId, slots);
    }
    if (!slots.includes(heroId)) {
      slots.push(heroId);
    }
    this.heroBuildingMap.set(heroId, buildingId);
  }

  private removeFromSlot(heroId: string): string | undefined {
    const oldBuildingId = this.heroBuildingMap.get(heroId);
    if (oldBuildingId !== undefined) {
      const slots = this.buildingSlots.get(oldBuildingId);
      if (slots !== undefined) {
        const idx = slots.indexOf(heroId);
        if (idx !== -1) slots.splice(idx, 1);
      }
      this.heroBuildingMap.delete(heroId);
    }
    return oldBuildingId;
  }

  private repositionBuilding(buildingId: string): void {
    const slots = this.buildingSlots.get(buildingId);
    if (slots === undefined || slots.length === 0) return;

    const buildingDef = BUILDING_DEFS.find((b) => b.id === buildingId);
    if (buildingDef === undefined) return;

    const building = this.buildings.find((b) => b.def.id === buildingId);
    const doorX = building?.doorX ?? buildingDef.x;
    const doorY = building?.doorY ?? buildingDef.y + 60;

    const positions = this.calcGridPositions(doorX, doorY, slots.length);

    for (let i = 0; i < slots.length; i++) {
      const hero = this.heroes.get(slots[i]!);
      if (hero === undefined) continue;
      const pos = positions[i]!;

      hero.gridBaseX = pos.x;
      hero.gridBaseY = pos.y;
      hero.moveTo(pos.x, pos.y, hero.currentActivity);
    }
  }

  // ---------------------------------------------------------------------------
  // Agent update handler
  // ---------------------------------------------------------------------------

  private handleAgentUpdate(agents: AgentState[]): void {
    // Defer processing until buildings are spawned — otherwise heroes walk
    // to the hardcoded BUILDING_DEFS positions instead of the map overrides.
    if (!this.buildingsReady) {
      this.pendingAgentUpdate = agents;
      return;
    }

    const now = Date.now();

    // Show active + idle-recent (< 2h), hide completed/error and idle > 2h
    const visible = agents.filter((a) => {
      if (a.status === 'completed' || a.status === 'error') return false;
      if (a.status === 'idle' && now - a.lastEvent > IDLE_HIDE_THRESHOLD_MS) return false;
      return true;
    });

    // Remove heroes no longer visible
    for (const [id, hero] of this.heroes) {
      if (!visible.some((a) => a.id === id)) {
        const oldBuilding = this.removeFromSlot(id);
        hero.destroy();
        this.heroes.delete(id);
        if (oldBuilding !== undefined) {
          this.repositionBuilding(oldBuilding);
        }
      }
    }

    // Track which buildings need repositioning
    const buildingsToReposition = new Set<string>();

    for (const agent of visible) {
      const existing = this.heroes.get(agent.id);
      const buildingDef = getBuildingForActivity(agent.currentActivity);

      if (existing === undefined) {
        // New hero: spawn at configured spawn point then assign to building
        const hero = new HeroSprite(
          this,
          agent.id,
          agent.name,
          agent.heroClass,
          agent.heroColor,
          this.heroSpawn.x,
          this.heroSpawn.y,
          agent.id.startsWith('agent-'),
        );
        hero.setHeroScale(this.heroScale);
        hero.setActivity(agent.currentActivity);
        hero.setStatus(agent.status);
        hero.setErrorTimestamp(agent.lastErrorAt);
        hero.updateDetail(agent.currentFile, agent.currentCommand);
        hero.updateTask(agent.currentTask);
        this.heroes.set(agent.id, hero);
        this.addToSlot(buildingDef.id, agent.id);
        buildingsToReposition.add(buildingDef.id);
      } else {
        // Always update detail text (file/command changes even without activity change)
        existing.updateDetail(agent.currentFile, agent.currentCommand);
        existing.updateTask(agent.currentTask);
        existing.setStatus(agent.status);
        existing.setErrorTimestamp(agent.lastErrorAt);

        const currentBuildingId = this.heroBuildingMap.get(agent.id);

        if (currentBuildingId !== buildingDef.id) {
          // Hero changed building — update activity before repositioning
          existing.setActivity(agent.currentActivity);
          const oldBuilding = this.removeFromSlot(agent.id);
          this.addToSlot(buildingDef.id, agent.id);

          if (oldBuilding !== undefined) {
            buildingsToReposition.add(oldBuilding);
          }
          buildingsToReposition.add(buildingDef.id);
        } else if (existing.currentActivity !== agent.currentActivity) {
          // Same building, different activity — update label
          existing.setActivity(agent.currentActivity);
        }
      }
    }

    for (const buildingId of buildingsToReposition) {
      this.repositionBuilding(buildingId);
    }
  }
}
