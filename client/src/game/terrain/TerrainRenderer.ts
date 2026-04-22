import * as Phaser from 'phaser';
import { WORLD_WIDTH, WORLD_HEIGHT, BUILDING_DEFS, VILLAGE_GATE, PLAZA, NPC_VILLAGE, CITY_CLEAR } from '../data/building-layout';
import { getRoadSegments } from '../data/road-network';
import { addCrispText } from '../text';
import { getActiveTheme } from '../themes/registry';

function createRng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const TILE = 32;
const PLAZA_RX = 95, PLAZA_RY = 70;

// Forest lake west of the village (aesthetic, outside the city clearing)
const LAKE_CX = 640, LAKE_CY = 920, LAKE_RX = 140, LAKE_RY = 85;
// Small forest pond NE
const POND_CX = 2090, POND_CY = 420, POND_RX = 70, POND_RY = 42;

const ROAD_W_MAIN = 56;
const ROAD_W_SEC = 38;

export class TerrainRenderer {
  private scene: Phaser.Scene;
  private rng: () => number;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.rng = createRng(1337);
  }

  render(): void {
    this.genTex();
    this.layGrass();
    this.layGrassVariation();
    this.drawForestFloor();
    this.drawLake();
    this.drawPond();
    this.drawNpcVillageGround();
    this.layRoads();
    this.layPlaza();
    this.layYards();
    this.drawDecor();
    this.placeRocks();
    this.placeBushes();
    this.placeStumps();
    this.drawDecorativeHouses();
    this.drawNpcVillageHouses();
    this.drawFences();
    this.drawShadows();
    this.drawForestTrees();
    this.drawGate();
    this.drawSignposts();
    this.addFx();
  }

  // --- helpers ---------------------------------------------------------

  private rand(a: number, b: number) { return a + this.rng() * (b - a); }
  private randInt(a: number, b: number) { return Math.floor(this.rand(a, b + 1)); }
  private pick<T>(a: readonly T[]): T { return a[Math.floor(this.rng() * a.length)] as T; }

  /** Deterministic low-frequency noise in ~[-1, 1] used to wobble the clearing edges. */
  private edgeNoise(x: number, y: number): number {
    return (
      Math.sin(x * 0.013 + 1.7) * 0.6 +
      Math.cos(y * 0.015 - 0.9) * 0.5 +
      Math.sin((x + y) * 0.006 + 3.1) * 0.35
    ) / 1.45;
  }

  /**
   * True when the point lies outside the village clearings — i.e. in the forest.
   * The clearing is pushed slightly outward (perturbCity > 1) so a clean grass
   * ring separates the village from the dense trees.
   */
  private inForest(x: number, y: number): boolean {
    for (const b of BUILDING_DEFS) {
      if (Math.abs(x - b.x) < 100 && Math.abs(y - b.y) < 100) return false;
    }
    if (Math.hypot(x - VILLAGE_GATE.x, y - VILLAGE_GATE.y) < 80) return false;

    const dxC = (x - CITY_CLEAR.x) / CITY_CLEAR.rx;
    const dyC = (y - CITY_CLEAR.y) / CITY_CLEAR.ry;
    const rCity = dxC * dxC + dyC * dyC;
    const perturbCity = 1.12 + this.edgeNoise(x, y) * 0.05;
    if (rCity < perturbCity) return false;

    const dxN = (x - NPC_VILLAGE.x) / NPC_VILLAGE.radius;
    const dyN = (y - NPC_VILLAGE.y) / (NPC_VILLAGE.radius * 0.85);
    const rNpc = dxN * dxN + dyN * dyN;
    const perturbNpc = 1.1 + this.edgeNoise(x + 331, y - 217) * 0.08;
    if (rNpc < perturbNpc) return false;

    return true;
  }

  private onRoad(x: number, y: number, pad = 0): boolean {
    for (const seg of getRoadSegments()) {
      const hw = (seg.main ? ROAD_W_MAIN : ROAD_W_SEC) / 2 + pad;
      if (distToSegment(x, y, seg.a.x, seg.a.y, seg.b.x, seg.b.y) < hw) return true;
    }
    return false;
  }

  private canPlace(x: number, y: number, m = 30): boolean {
    for (const b of BUILDING_DEFS) if (Math.abs(x - b.x) < 75 + m && Math.abs(y - b.y) < 80 + m) return false;
    if (Math.hypot(x - VILLAGE_GATE.x, y - VILLAGE_GATE.y) < 70) return false;
    if (((x - LAKE_CX) / (LAKE_RX + m)) ** 2 + ((y - LAKE_CY) / (LAKE_RY + m)) ** 2 < 1) return false;
    if (((x - POND_CX) / (POND_RX + m)) ** 2 + ((y - POND_CY) / (POND_RY + m)) ** 2 < 1) return false;
    if (((x - PLAZA.x) / (PLAZA_RX + m)) ** 2 + ((y - PLAZA.y) / (PLAZA_RY + m)) ** 2 < 1) return false;
    if (this.onRoad(x, y, Math.max(0, m - 10))) return false;
    return x > 30 && x < WORLD_WIDTH - 30 && y > 30 && y < WORLD_HEIGHT - 30;
  }

  // --- textures --------------------------------------------------------

  private genTex(): void {
    this.mkTile('tile-grass',       101, [[58,110,44,.40],[52,98,38,.20],[66,122,50,.15],[45,88,32,.12],[72,139,56,.08],[40,80,28,.05]]);
    this.mkTile('tile-grass-dark',  106, [[44,84,34,.45],[38,74,28,.25],[52,98,40,.15],[34,66,24,.10],[60,110,46,.05]]);
    this.mkTile('tile-grass-light', 107, [[72,136,54,.45],[80,146,62,.25],[64,122,48,.15],[88,158,66,.10],[56,108,42,.05]]);
    this.mkTile('tile-dirt',        102, [[139,115,85,.35],[126,104,76,.20],[156,132,98,.15],[112,94,68,.12],[100,84,60,.08],[170,148,110,.05],[130,130,120,.05]]);
    this.mkTile('tile-cobble',      103, [[122,101,72,.30],[110,90,64,.20],[140,118,86,.15],[92,78,58,.15],[156,134,102,.10],[80,68,50,.10]]);
    this.mkTile('tile-forest',      105, [[28,52,22,.45],[34,66,28,.25],[44,84,34,.15],[22,44,16,.10],[50,96,38,.05]]);
    if (!this.scene.textures.exists('px')) {
      const c = document.createElement('canvas'); c.width = 8; c.height = 8;
      const x = c.getContext('2d');
      if (x) { x.fillStyle = '#fff'; x.beginPath(); x.arc(4, 4, 3, 0, Math.PI * 2); x.fill(); }
      this.scene.textures.addCanvas('px', c);
    }
  }

  private mkTile(key: string, seed: number, pal: number[][]): void {
    if (this.scene.textures.exists(key)) return;
    const rng = createRng(seed);
    const c = document.createElement('canvas'); c.width = TILE; c.height = TILE;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(TILE, TILE); const d = img.data;
    const th: { r: number; g: number; b: number; t: number }[] = []; let acc = 0;
    for (const p of pal) { acc += p[3]!; th.push({ r: p[0]!, g: p[1]!, b: p[2]!, t: acc }); }
    for (let i = 0; i < TILE * TILE; i++) {
      const rv = rng(); let cr = th[0]!.r, cg = th[0]!.g, cb = th[0]!.b;
      for (const t of th) { if (rv < t.t) { cr = t.r; cg = t.g; cb = t.b; break; } }
      const idx = i * 4; d[idx] = cr; d[idx + 1] = cg; d[idx + 2] = cb; d[idx + 3] = 255;
    }
    ctx.putImageData(img, 0, 0); this.scene.textures.addCanvas(key, c);
  }

  // --- ground ----------------------------------------------------------

  private layGrass(): void {
    // Prefer the active theme's terrain tileset; fall back to the
    // procedural noise tile if the theme has no terrain section or its
    // texture failed to load.
    const terrain = getActiveTheme().terrain;
    const themeReady = terrain !== undefined && this.scene.textures.exists(terrain.tilesetKey);
    const key = themeReady ? terrain.tilesetKey : 'tile-grass';
    const frame = themeReady ? terrain.grassFrame : undefined;
    this.scene.add.tileSprite(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, key, frame as number | undefined)
      .setDepth(-2);
  }

  private layGrassVariation(): void {
    const g = this.scene.add.graphics(); g.setDepth(-1.9);
    for (let i = 0; i < 80; i++) {
      const x = this.rand(80, WORLD_WIDTH - 80), y = this.rand(80, WORLD_HEIGHT - 80);
      if (this.inForest(x, y)) continue;
      const rx = this.rand(45, 120), ry = this.rand(25, 70);
      const darker = this.rng() < 0.5;
      g.fillStyle(darker ? 0x3A6A28 : 0x5A9A46, darker ? 0.18 : 0.14);
      g.fillEllipse(x, y, rx * 2, ry * 2);
    }
  }

  /** Soft dark forest floor — covers only the "forest" zone, outside the village. */
  private drawForestFloor(): void {
    const g = this.scene.add.graphics(); g.setDepth(-1.85);
    const step = 26;
    g.fillStyle(0x2E4828, 0.55);
    for (let y = 0; y < WORLD_HEIGHT; y += step) {
      let runStart = -1;
      for (let x = 0; x < WORLD_WIDTH; x += step) {
        if (this.inForest(x, y)) {
          if (runStart < 0) runStart = x;
        } else if (runStart >= 0) {
          g.fillRect(runStart, y, x - runStart, step);
          runStart = -1;
        }
      }
      if (runStart >= 0) g.fillRect(runStart, y, WORLD_WIDTH - runStart, step);
    }
  }

  // --- water -----------------------------------------------------------

  private drawLake(): void {
    const g = this.scene.add.graphics(); g.setDepth(0.3);
    g.fillStyle(0x3A5A22, 0.55); g.fillEllipse(LAKE_CX, LAKE_CY, LAKE_RX * 2, LAKE_RY * 2);
    g.fillStyle(0x4A6B2A, 0.35); g.fillEllipse(LAKE_CX + 4, LAKE_CY - 2, LAKE_RX * 2 - 10, LAKE_RY * 2 - 8);
    g.fillStyle(0x3E8C84, 0.92); g.fillEllipse(LAKE_CX, LAKE_CY, LAKE_RX * 2 - 34, LAKE_RY * 2 - 22);
    g.fillStyle(0x4DA79E, 0.95); g.fillEllipse(LAKE_CX, LAKE_CY, LAKE_RX * 2 - 44, LAKE_RY * 2 - 30);
    g.fillStyle(0x6FC1B8, 0.45); g.fillEllipse(LAKE_CX - 22, LAKE_CY - 12, LAKE_RX - 30, LAKE_RY - 40);
    g.fillStyle(0xA8DCD5, 0.35); g.fillEllipse(LAKE_CX - 34, LAKE_CY - 20, 28, 10);
    g.lineStyle(1.2, 0xB6E3DC, 0.5);
    for (let i = 0; i < 5; i++) {
      const rx = LAKE_RX - 55 - i * 15, ry = LAKE_RY - 38 - i * 8;
      if (rx <= 8 || ry <= 4) continue;
      g.strokeEllipse(LAKE_CX + this.rand(-4, 4), LAKE_CY + this.rand(-3, 3), rx * 2, ry * 2);
    }
    for (const [rx, ry] of [[-100, -25], [-110, 10], [-95, 45], [-55, 62], [-15, 68], [30, 62], [70, 45], [100, 20], [110, -15], [85, -40], [40, -55], [-15, -55]] as const) {
      const bx = LAKE_CX + rx, by = LAKE_CY + ry;
      for (let k = 0; k < this.randInt(3, 5); k++) {
        const sx = bx + this.rand(-5, 5), sy = by + this.rand(-3, 3);
        const tx = sx + this.rand(-2, 2), ty = sy - this.rand(10, 18);
        g.lineStyle(1.5, 0x4A7A30, 0.85); g.lineBetween(sx, sy, tx, ty);
        g.fillStyle(0x6B5B30, 0.9); g.fillCircle(tx, ty, 1.6);
      }
    }
    if (this.scene.textures.exists('rock-1')) {
      for (const [ox, oy] of [[-55, -8], [30, -25], [62, 18], [-28, 30]] as const) {
        this.scene.add.image(LAKE_CX + ox, LAKE_CY + oy, `rock-${this.randInt(1, 4)}`)
          .setScale(this.rand(0.3, 0.5)).setTint(0x9CC8C2).setDepth(0.32);
      }
    }
  }

  private drawPond(): void {
    const g = this.scene.add.graphics(); g.setDepth(0.28);
    g.fillStyle(0x3A5A22, 0.5); g.fillEllipse(POND_CX, POND_CY, POND_RX * 2 + 12, POND_RY * 2 + 8);
    g.fillStyle(0x3E8C84, 0.9); g.fillEllipse(POND_CX, POND_CY, POND_RX * 2 - 12, POND_RY * 2 - 10);
    g.fillStyle(0x4DA79E, 0.9); g.fillEllipse(POND_CX - 2, POND_CY - 1, POND_RX * 2 - 24, POND_RY * 2 - 18);
    g.fillStyle(0x6FC1B8, 0.5); g.fillEllipse(POND_CX - 10, POND_CY - 6, POND_RX - 18, POND_RY - 22);
    g.lineStyle(1, 0xB6E3DC, 0.4);
    g.strokeEllipse(POND_CX, POND_CY, POND_RX * 2 - 38, POND_RY * 2 - 24);
  }

  // --- roads -----------------------------------------------------------

  private layRoads(): void {
    const segs = getRoadSegments();

    // Collect junction points (where segments meet) with their widest road width
    const junctions = new Map<string, { x: number; y: number; w: number }>();
    for (const s of segs) {
      const w = s.main ? ROAD_W_MAIN : ROAD_W_SEC;
      for (const pt of [s.a, s.b]) {
        const k = `${pt.x},${pt.y}`;
        const prev = junctions.get(k);
        junctions.set(k, { x: pt.x, y: pt.y, w: Math.max(prev?.w ?? 0, w) });
      }
    }

    // --- Layer 0: Shadow (wider, dark, soft) ---
    const gShadow = this.scene.add.graphics().setDepth(-0.01);
    gShadow.fillStyle(0x2A2018, 0.30);
    for (const s of segs) {
      const w = (s.main ? ROAD_W_MAIN : ROAD_W_SEC) + 12;
      this.strokeThickLine(gShadow, s.a.x, s.a.y, s.b.x, s.b.y, w);
    }
    for (const j of junctions.values()) gShadow.fillCircle(j.x, j.y, (j.w + 12) / 2);

    // --- Layer 1: Outer fill (base stone colour) ---
    const gBase = this.scene.add.graphics().setDepth(0);
    gBase.fillStyle(0x8A7656, 0.95);
    for (const s of segs) {
      this.strokeThickLine(gBase, s.a.x, s.a.y, s.b.x, s.b.y, s.main ? ROAD_W_MAIN : ROAD_W_SEC);
    }
    for (const j of junctions.values()) gBase.fillCircle(j.x, j.y, j.w / 2);

    // --- Layer 2: Inner lighter fill (gives bevel/depth) ---
    const gInner = this.scene.add.graphics().setDepth(0.003);
    gInner.fillStyle(0x9E8E6C, 0.55);
    for (const s of segs) {
      const w = (s.main ? ROAD_W_MAIN : ROAD_W_SEC) - 10;
      this.strokeThickLine(gInner, s.a.x, s.a.y, s.b.x, s.b.y, w);
    }
    for (const j of junctions.values()) gInner.fillCircle(j.x, j.y, Math.max(4, (j.w - 10) / 2));

    // --- Layer 3: Cobblestone pattern ---
    const gStone = this.scene.add.graphics().setDepth(0.006);
    this.drawCobblestones(gStone, segs);

    // --- Layer 4: Border lines ---
    const gBorder = this.scene.add.graphics().setDepth(0.02);
    gBorder.lineStyle(1.8, 0x5A4A2A, 0.45);
    for (const s of segs) {
      const w = s.main ? ROAD_W_MAIN : ROAD_W_SEC;
      const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
      const len = Math.hypot(dx, dy); if (len === 0) continue;
      const nx = -dy / len, ny = dx / len, hw = w / 2;
      gBorder.lineBetween(s.a.x + nx * hw, s.a.y + ny * hw, s.b.x + nx * hw, s.b.y + ny * hw);
      gBorder.lineBetween(s.a.x - nx * hw, s.a.y - ny * hw, s.b.x - nx * hw, s.b.y - ny * hw);
    }

    // --- Layer 5: Edge grass tufts (softens the road-to-grass transition) ---
    const gEdge = this.scene.add.graphics().setDepth(0.025);
    for (const s of segs) {
      const w = s.main ? ROAD_W_MAIN : ROAD_W_SEC;
      const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
      const len = Math.hypot(dx, dy); if (len < 30) continue;
      const nx = -dy / len, ny = dx / len, hw = w / 2;
      const step = 12;
      for (let d = 6; d < len - 6; d += step + this.rand(-2, 2)) {
        for (const side of [-1, 1] as const) {
          if (this.rng() < 0.35) continue;
          const t = d / len;
          const bx = s.a.x + dx * t + nx * side * (hw + this.rand(-2, 3));
          const by = s.a.y + dy * t + ny * side * (hw + this.rand(-2, 3));
          const bladeCount = this.randInt(2, 4);
          for (let b = 0; b < bladeCount; b++) {
            const gx = bx + this.rand(-3, 3), gy = by + this.rand(-2, 2);
            const tipX = gx + this.rand(-3, 3), tipY = gy - this.rand(3, 7);
            gEdge.lineStyle(1, this.pick([0x4A8A2E, 0x3A7A22, 0x5A9A3A] as const), 0.6);
            gEdge.lineBetween(gx, gy, tipX, tipY);
          }
        }
      }
    }

    // --- Layer 6: Scattered pebbles on main roads ---
    const gPeb = this.scene.add.graphics().setDepth(0.03);
    for (const s of segs) {
      if (!s.main) continue;
      const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
      for (let d = 14; d < len - 14; d += this.rand(18, 30)) {
        const t = d / len;
        const px = s.a.x + (s.b.x - s.a.x) * t + this.rand(-8, 8);
        const py = s.a.y + (s.b.y - s.a.y) * t + this.rand(-8, 8);
        if (!this.onRoad(px, py, -6)) continue;
        gPeb.fillStyle(this.pick([0x6A5A3A, 0x7A6A48, 0x5A4A2E] as const), 0.4);
        gPeb.fillCircle(px, py, this.rand(1.2, 2.5));
      }
    }

    this.drawForestTrail();
  }

  /** Draw a cobblestone pattern along road segments using small rectangles. */
  private drawCobblestones(g: Phaser.GameObjects.Graphics, segs: Array<{ a: { x: number; y: number }; b: { x: number; y: number }; main: boolean }>): void {
    const stoneColors = [0x7A6A4A, 0x8A7A58, 0x6E5E3E, 0x96866A, 0x847454] as const;
    const groutColor = 0x5A4A2E;

    for (const s of segs) {
      const w = s.main ? ROAD_W_MAIN : ROAD_W_SEC;
      const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
      const len = Math.hypot(dx, dy); if (len < 20) continue;
      const ux = dx / len, uy = dy / len;  // unit along road
      const nx = -uy, ny = ux;             // unit perpendicular

      const stoneStep = 10;
      const rows = Math.max(1, Math.floor((w - 12) / stoneStep));
      const halfRows = (rows - 1) / 2;

      for (let d = 6; d < len - 6; d += stoneStep) {
        // Alternate row offset for brick-like pattern
        const rowShift = (Math.floor(d / stoneStep) % 2 === 0) ? 0 : stoneStep / 2;
        for (let r = 0; r < rows; r++) {
          const across = (r - halfRows) * stoneStep + rowShift * 0.3;
          const t = d / len;
          const cx = s.a.x + dx * t + nx * across + this.rand(-0.8, 0.8);
          const cy = s.a.y + dy * t + ny * across + this.rand(-0.8, 0.8);

          if (!this.onRoad(cx, cy, -5)) continue;

          const sw = this.rand(5, 8), sh = this.rand(4, 6.5);
          // Stone fill
          g.fillStyle(this.pick(stoneColors), 0.3);
          g.fillRect(cx - sw / 2, cy - sh / 2, sw, sh);
          // Grout line
          g.lineStyle(0.5, groutColor, 0.18);
          g.strokeRect(cx - sw / 2, cy - sh / 2, sw, sh);
        }
      }
    }
  }

  private strokeThickLine(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number, w: number): void {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy); if (len === 0) return;
    const nx = -dy / len, ny = dx / len;
    const hw = w / 2;
    g.fillPoints([
      new Phaser.Math.Vector2(x1 + nx * hw, y1 + ny * hw),
      new Phaser.Math.Vector2(x2 + nx * hw, y2 + ny * hw),
      new Phaser.Math.Vector2(x2 - nx * hw, y2 - ny * hw),
      new Phaser.Math.Vector2(x1 - nx * hw, y1 - ny * hw),
    ], true);
  }

  private drawForestTrail(): void {
    // Curvy dirt trail from the city's SE edge out to the NPC hamlet (decorative).
    const start = { x: 1850, y: 1130 };
    const mid1 = { x: 2050, y: 1200 };
    const mid2 = { x: 2230, y: 1340 };
    const end = NPC_VILLAGE;
    const pts: { x: number; y: number }[] = [];
    for (let t = 0; t <= 1.0001; t += 0.04) {
      // Quadratic-ish chain of two segments
      const p1 = this.lerpP(start, mid1, t);
      const p2 = this.lerpP(mid1, mid2, t);
      const p3 = this.lerpP(mid2, end, t);
      const q1 = this.lerpP(p1, p2, t);
      const q2 = this.lerpP(p2, p3, t);
      pts.push(this.lerpP(q1, q2, t));
    }
    const g = this.scene.add.graphics(); g.setDepth(-0.01);
    g.fillStyle(0x5C4A30, 0.65);
    for (let i = 0; i < pts.length - 1; i++) {
      this.strokeThickLine(g, pts[i]!.x, pts[i]!.y, pts[i + 1]!.x, pts[i + 1]!.y, 26);
    }
    g.fillStyle(0x7A6548, 0.55);
    for (let i = 0; i < pts.length - 1; i++) {
      this.strokeThickLine(g, pts[i]!.x, pts[i]!.y, pts[i + 1]!.x, pts[i + 1]!.y, 18);
    }
  }

  private lerpP(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  // --- plaza & yards ---------------------------------------------------

  private layPlaza(): void {
    const g = this.scene.add.graphics(); g.setDepth(0.05);
    const { x: cx, y: cy } = PLAZA;
    g.fillStyle(0x7A6548, 0.9); g.fillEllipse(cx, cy, PLAZA_RX * 2, PLAZA_RY * 2);
    g.fillStyle(0x8B7A5A, 0.35); g.fillEllipse(cx, cy, PLAZA_RX * 1.2, PLAZA_RY * 1.2);
    g.fillStyle(0x5C4E3A, 0.3);
    for (let ring = 1; ring < 5; ring++) {
      const r = ring * 0.22, cnt = 10 + ring * 6;
      for (let j = 0; j < cnt; j++) {
        const a = (j / cnt) * Math.PI * 2 + ring * 0.5;
        g.fillRect(cx + Math.cos(a) * PLAZA_RX * r - 2, cy + Math.sin(a) * PLAZA_RY * r - 1.5, 4, 3);
      }
    }
    g.lineStyle(2, 0x5C4E3A, 0.45); g.strokeEllipse(cx, cy, PLAZA_RX * 2, PLAZA_RY * 2);
    // Fountain
    g.fillStyle(0x5A5A6A, 0.9); g.fillCircle(cx, cy, 22);
    g.fillStyle(0x6A6A7A, 0.75); g.fillCircle(cx, cy, 18);
    g.fillStyle(0x2255AA, 0.75); g.fillCircle(cx, cy, 13);
    g.fillStyle(0x4488DD, 0.5); g.fillCircle(cx - 3, cy - 3, 7);
    g.fillStyle(0x88CCFF, 0.4); g.fillCircle(cx - 4, cy - 4, 3);
    g.fillStyle(0x5A5A6A, 0.95); g.fillCircle(cx, cy, 4.5);
  }

  private layYards(): void {
    for (const b of BUILDING_DEFS) {
      const yw = 58, yh = 30, yy = b.y + 72;
      this.scene.add.tileSprite(b.x, yy, yw, yh, 'tile-cobble').setDepth(0.02);
      const g = this.scene.add.graphics(); g.setDepth(0.03);
      g.lineStyle(1, 0x5C4E3A, 0.35);
      g.strokeRect(b.x - yw / 2, yy - yh / 2, yw, yh);
    }
  }

  // --- decorations -----------------------------------------------------

  private drawDecor(): void {
    const g = this.scene.add.graphics(); g.setDepth(0.5);
    const fc = [0xCC3333, 0xDDCC33, 0x4466CC, 0xEEEEDD, 0xDD6699, 0xFF8844] as const;
    for (let i = 0; i < 90; i++) {
      const x = this.rand(70, WORLD_WIDTH - 70), y = this.rand(70, WORLD_HEIGHT - 70);
      if (this.inForest(x, y) || !this.canPlace(x, y, 5)) continue;
      const c = this.pick(fc);
      for (let j = 0; j < this.randInt(3, 6); j++) {
        const fx = x + this.rand(-10, 10), fy = y + this.rand(-8, 8);
        g.lineStyle(1, 0x2A6A1A, 0.5); g.lineBetween(fx, fy + 1, fx, fy + 5);
        g.fillStyle(c, 0.85); g.fillCircle(fx, fy, this.rand(1.5, 3));
      }
    }
    for (let i = 0; i < 160; i++) {
      const x = this.rand(60, WORLD_WIDTH - 60), y = this.rand(60, WORLD_HEIGHT - 60);
      if (this.inForest(x, y) || this.onRoad(x, y, 6)) continue;
      g.lineStyle(1, this.pick([0x2D5E22, 0x1B4A15, 0x3F7F30] as const), 0.55);
      for (let j = 0; j < this.randInt(3, 5); j++) {
        const bx = x + this.rand(-4, 4);
        g.lineBetween(bx, y, bx + this.rand(-3, 3), y - this.rand(4, 10));
      }
    }
  }

  private placeRocks(): void {
    if (!this.scene.textures.exists('rock-1')) return;
    const placed: Array<{ x: number; y: number }> = [];
    const tooClose = (x: number, y: number, d = 32) => placed.some(p => Math.abs(p.x - x) < d && Math.abs(p.y - y) < d);

    // Rocks along roads (inside city)
    for (const s of getRoadSegments()) {
      const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
      const len = Math.hypot(dx, dy); if (len === 0) continue;
      const nx = -dy / len, ny = dx / len;
      const hw = (s.main ? ROAD_W_MAIN : ROAD_W_SEC) / 2;
      const step = s.main ? 90 : 120;
      for (let d = 30; d < len - 30; d += step + this.rand(-15, 15)) {
        for (const side of [-1, 1] as const) {
          if (this.rng() < 0.4) continue;
          const off = hw + this.rand(10, 18);
          const t = d / len;
          const rx = s.a.x + dx * t + nx * side * off;
          const ry = s.a.y + dy * t + ny * side * off;
          if (this.onRoad(rx, ry, -4) || !this.canPlace(rx, ry, 4) || tooClose(rx, ry) || this.inForest(rx, ry)) continue;
          const rock = this.scene.add.image(rx, ry, `rock-${this.randInt(1, 4)}`)
            .setScale(this.rand(0.35, 0.6));
          rock.setDepth(ry + rock.displayHeight * 0.5);
          placed.push({ x: rx, y: ry });
        }
      }
    }
    // Interior scatter (light — village is tidy)
    for (let i = 0; i < 16; i++) {
      const x = this.rand(100, WORLD_WIDTH - 100), y = this.rand(100, WORLD_HEIGHT - 100);
      if (this.inForest(x, y) || !this.canPlace(x, y, 12) || tooClose(x, y, 50)) continue;
      const rock = this.scene.add.image(x, y, `rock-${this.randInt(1, 4)}`)
        .setScale(this.rand(0.4, 0.75));
      rock.setDepth(y + rock.displayHeight * 0.5);
      placed.push({ x, y });
    }
    // Forest boulders — sparse, just enough to punctuate the tree cover
    for (let i = 0; i < 40; i++) {
      const x = this.rand(30, WORLD_WIDTH - 30), y = this.rand(30, WORLD_HEIGHT - 30);
      if (!this.inForest(x, y) || tooClose(x, y, 70)) continue;
      const rock = this.scene.add.image(x, y, `rock-${this.randInt(1, 4)}`)
        .setScale(this.rand(0.55, 1.0))
        .setTint(0x9AA59C);
      rock.setDepth(y + rock.displayHeight * 0.5);
      placed.push({ x, y });
    }
  }

  private placeBushes(): void {
    if (!this.scene.textures.exists('bush-1')) return;
    const placed: Array<{ x: number; y: number }> = [];
    const tooClose = (x: number, y: number, d = 55) => placed.some(p => Math.abs(p.x - x) < d && Math.abs(p.y - y) < d);

    for (const b of BUILDING_DEFS) {
      for (let j = 0; j < this.randInt(2, 4); j++) {
        const side = this.rng() > 0.5 ? -1 : 1;
        const bx = b.x + side * this.rand(56, 90), by = b.y + this.rand(18, 60);
        if (this.onRoad(bx, by, 4) || tooClose(bx, by, 50) || this.inForest(bx, by)) continue;
        const bush = this.scene.add.sprite(bx, by, `bush-${this.randInt(1, 4)}`, 0)
          .setScale(this.rand(0.35, 0.55));
        bush.setDepth(by + bush.displayHeight * 0.5);
        placed.push({ x: bx, y: by });
      }
    }
    for (let i = 0; i < 80; i++) {
      const x = this.rand(90, WORLD_WIDTH - 90), y = this.rand(90, WORLD_HEIGHT - 90);
      if (this.inForest(x, y) || !this.canPlace(x, y, 18) || tooClose(x, y)) continue;
      const bush = this.scene.add.sprite(x, y, `bush-${this.randInt(1, 4)}`, 0)
        .setScale(this.rand(0.35, 0.6));
      bush.setDepth(y + bush.displayHeight * 0.5);
      placed.push({ x, y });
    }
    // Forest-floor bushes — only outside the village, sparse
    for (let i = 0; i < 130; i++) {
      const x = this.rand(30, WORLD_WIDTH - 30), y = this.rand(30, WORLD_HEIGHT - 30);
      if (!this.inForest(x, y) || tooClose(x, y, 65)) continue;
      const bush = this.scene.add.sprite(x, y, `bush-${this.randInt(1, 4)}`, 0)
        .setScale(this.rand(0.45, 0.75));
      bush.setDepth(y + bush.displayHeight * 0.5);
      placed.push({ x, y });
    }
  }

  private placeStumps(): void {
    if (!this.scene.textures.exists('stump-1')) return;
    // Stumps only in the forest — keeps the village clean.
    for (let i = 0; i < 14; i++) {
      const x = this.rand(30, WORLD_WIDTH - 30), y = this.rand(30, WORLD_HEIGHT - 30);
      if (!this.inForest(x, y)) continue;
      const key = `stump-${this.randInt(1, 4)}`;
      const stump = this.scene.add.image(x, y, key)
        .setScale(this.rand(0.28, 0.42));
      stump.setDepth(y + stump.displayHeight * 0.5);
    }
  }

  // --- decorative small houses -----------------------------------------

  private drawDecorativeHouses(): void {
    const colors = ['blue', 'yellow', 'red', 'blue', 'yellow'] as const;
    const kinds = ['house1', 'house2', 'house3'] as const;
    const placed: Array<{ x: number; y: number }> = [];
    const tooClose = (x: number, y: number, d = 130) => placed.some(p => Math.hypot(p.x - x, p.y - y) < d);

    let attempts = 0, placed_n = 0;
    while (placed_n < 12 && attempts < 500) {
      attempts++;
      const x = this.rand(180, WORLD_WIDTH - 180);
      const y = this.rand(180, WORLD_HEIGHT - 260);
      if (Math.hypot(x - NPC_VILLAGE.x, y - NPC_VILLAGE.y) < NPC_VILLAGE.radius + 80) continue;
      if (this.inForest(x, y) || !this.canPlace(x, y, 40)) continue;
      if (tooClose(x, y)) continue;
      const color = this.pick(colors);
      const kind = this.pick(kinds);
      const key = `house-${color}-${kind}`;
      if (!this.scene.textures.exists(key)) continue;
      const scale = this.rand(0.30, 0.40);
      const img = this.scene.add.image(x, y, key).setScale(scale);
      img.setDepth(y + img.displayHeight / 2 - 2);
      placed.push({ x, y });
      placed_n++;
      this.scene.add.tileSprite(x, y + img.displayHeight / 2 + 8, 38, 16, 'tile-cobble').setDepth(0.02);
    }

    const towerSpots = [
      { x: 1250, y: 680, c: 'blue' },
      { x: 1620, y: 680, c: 'yellow' },
    ];
    for (const t of towerSpots) {
      if (this.inForest(t.x, t.y) || !this.canPlace(t.x, t.y, 40)) continue;
      const key = `house-${t.c}-tower`;
      if (!this.scene.textures.exists(key)) continue;
      const img = this.scene.add.image(t.x, t.y, key).setScale(0.34);
      img.setDepth(t.y + img.displayHeight / 2 - 2);
    }
  }

  // --- NPC village (purple hamlet) -------------------------------------

  private drawNpcVillageGround(): void {
    const { x: cx, y: cy } = NPC_VILLAGE;
    const g = this.scene.add.graphics(); g.setDepth(-0.05);
    g.fillStyle(0x6C5A3A, 0.55);
    g.fillEllipse(cx, cy, NPC_VILLAGE.radius * 2, NPC_VILLAGE.radius * 1.5);
    g.fillStyle(0x8B7A5A, 0.35);
    g.fillEllipse(cx + 10, cy - 4, NPC_VILLAGE.radius * 1.6, NPC_VILLAGE.radius * 1.1);
    // small fountain-ish center
    g.fillStyle(0x5A5A6A, 0.85); g.fillCircle(cx, cy, 14);
    g.fillStyle(0x8B5AD8, 0.7); g.fillCircle(cx, cy, 9);
    g.fillStyle(0xBA88EE, 0.5); g.fillCircle(cx - 2, cy - 2, 4);
  }

  private drawNpcVillageHouses(): void {
    const { x: cx, y: cy } = NPC_VILLAGE;
    const houseSpots: Array<{ dx: number; dy: number; kind: 'house1' | 'house2' | 'house3' | 'tower' }> = [
      { dx: -100, dy: -30, kind: 'house1' },
      { dx: -30,  dy: -70, kind: 'house2' },
      { dx: 60,   dy: -45, kind: 'house3' },
      { dx: 115,  dy: 25,  kind: 'house1' },
      { dx: 20,   dy: 70,  kind: 'house2' },
      { dx: -85,  dy: 65,  kind: 'house3' },
      { dx: 40,   dy: -110,kind: 'tower' },
    ];
    for (const s of houseSpots) {
      const key = `house-purple-${s.kind}`;
      if (!this.scene.textures.exists(key)) continue;
      const x = cx + s.dx, y = cy + s.dy;
      const scale = s.kind === 'tower' ? 0.34 : this.rand(0.28, 0.38);
      const img = this.scene.add.image(x, y, key).setScale(scale);
      img.setDepth(y + img.displayHeight / 2 - 2);
    }
    // signpost
    const sx = cx - NPC_VILLAGE.radius + 30, sy = cy + 60;
    const p = this.scene.add.graphics(); p.setDepth(sy + 0.5);
    p.fillStyle(0x6B4E2E, 0.95); p.fillRect(sx - 1.5, sy - 18, 3, 22);
    p.fillStyle(0x8B7A5A, 0.95); p.fillRect(sx - 22, sy - 14, 44, 10);
    p.lineStyle(1, 0x3A2A18, 0.8); p.strokeRect(sx - 22, sy - 14, 44, 10);
    addCrispText(this.scene, sx, sy - 9, 'Mossvale', { fontSize: '10px', color: '#F5E6C8', fontFamily: 'monospace' }).setOrigin(0.5).setDepth(sy + 0.6);
  }

  // --- shadows ---------------------------------------------------------

  private drawShadows(): void {
    const g = this.scene.add.graphics(); g.setDepth(1.9);
    for (const b of BUILDING_DEFS) {
      g.fillStyle(0x1A2A10, 0.2);
      g.fillEllipse(b.x + 8, b.y + 55, 95 * b.scale, 26 * b.scale);
    }
  }

  // --- forest trees ----------------------------------------------------

  private drawForestTrees(): void {
    const useSprites = this.scene.textures.exists('tree-1');
    const placed: Array<{ x: number; y: number }> = [];
    const tooClose = (x: number, y: number, d = 70) => placed.some(p => Math.hypot(p.x - x, p.y - y) < d);
    const nearWater = (x: number, y: number) =>
      Math.hypot(x - LAKE_CX, y - LAKE_CY) < LAKE_RX + 30 ||
      Math.hypot(x - POND_CX, y - POND_CY) < POND_RX + 25;
    const nearTrail = (x: number, y: number) =>
      distToSegment(x, y, 1850, 1130, 2050, 1200) < 30 ||
      distToSegment(x, y, 2050, 1200, 2230, 1340) < 30 ||
      distToSegment(x, y, 2230, 1340, NPC_VILLAGE.x, NPC_VILLAGE.y) < 30;

    // Forest trees — only outside the village clearings.
    // Lowered density + larger min-distance for a cleaner, less busy look.
    for (let i = 0; i < 900; i++) {
      const x = this.rand(10, WORLD_WIDTH - 10), y = this.rand(10, WORLD_HEIGHT - 10);
      if (!this.inForest(x, y)) continue;
      if (nearWater(x, y)) continue;
      if (nearTrail(x, y)) continue;
      if (tooClose(x, y, this.rand(62, 88))) continue;
      this.drawOneTree(x, y, useSprites, this.rand(0.5, 0.95));
      placed.push({ x, y });
    }
  }

  private drawOneTree(x: number, y: number, useSprites: boolean, scale: number): void {
    if (useSprites) {
      const k = `tree-${this.randInt(1, 4)}`;
      // CC0 trees are single-frame textures (sliced from Tree.png by
      // postLoadHook) so we fall into the frame-0 branch below. The
      // multi-frame path is kept for future themes that ship animated
      // sway sheets — picking a random frame gives each tree a unique pose.
      const tex = this.scene.textures.get(k);
      const frameCount = tex.getFrameNames().length;
      const frame = frameCount > 1 ? this.randInt(0, frameCount - 1) : 0;
      const img = this.scene.add.sprite(x, y, k, frame).setScale(scale);
      img.setDepth(y + img.displayHeight / 2 - 2);
    } else {
      const g = this.scene.add.graphics();
      g.setDepth(y + 50 * scale);
      this.oak(g, x, y, scale);
    }
  }

  private oak(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number): void {
    g.fillStyle(0x1A3A12, 0.2); g.fillEllipse(x + 3, y + 5 * s, 32 * s, 11 * s);
    g.fillStyle(0x5C3A1E, 1); g.fillRect(x - 3 * s, y - 14 * s, 6 * s, 20 * s);
    g.fillStyle(0x1B5E20, 1); g.fillCircle(x - 6 * s, y - 18 * s, 12 * s);
    g.fillStyle(0x2E7D32, 1); g.fillCircle(x + 5 * s, y - 20 * s, 11 * s);
    g.fillStyle(0x388E3C, 1); g.fillCircle(x, y - 26 * s, 10 * s);
    g.fillStyle(0x4CAF50, 0.35); g.fillCircle(x - 3 * s, y - 28 * s, 5 * s);
  }

  // --- gate & fences ---------------------------------------------------

  private drawGate(): void {
    const g = this.scene.add.graphics(); g.setDepth(1);
    const gx = VILLAGE_GATE.x, gy = VILLAGE_GATE.y;
    g.fillStyle(0x6A6A7A, 0.85); g.fillRect(gx - 58, gy - 26, 16, 40); g.fillRect(gx + 42, gy - 26, 16, 40);
    g.fillStyle(0x8A8A9A, 0.75); g.fillRect(gx - 60, gy - 30, 20, 8); g.fillRect(gx + 40, gy - 30, 20, 8);
    g.fillStyle(0x5A5A6A, 0.9); g.fillRect(gx - 60, gy + 12, 20, 6); g.fillRect(gx + 40, gy + 12, 20, 6);
    g.lineStyle(4, 0x6B4E2E, 0.85); g.beginPath(); g.arc(gx, gy - 20, 44, Math.PI, 0, false); g.strokePath();
    g.fillStyle(0xC4A35A, 0.75); g.fillCircle(gx - 8, gy - 4, 3); g.fillCircle(gx + 8, gy - 4, 3);
    addCrispText(this.scene, gx, gy - 36, 'Village Gate', {
      fontSize: '14px', color: '#C4A35A', fontFamily: 'monospace', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(1);
  }

  private drawFences(): void {
    const g = this.scene.add.graphics(); g.setDepth(0.2);
    // All positions chosen to sit inside the city clearing, off roads, for consistent rendering.
    const spots: Array<{ x: number; y: number; w: number; h: number }> = [
      { x: 1090, y: 700, w: 90, h: 6 },
      { x: 1280, y: 900, w: 120, h: 6 },
      { x: 1600, y: 900, w: 120, h: 6 },
      { x: 1260, y: 540, w: 90, h: 6 },
    ];
    for (const s of spots) {
      if (this.inForest(s.x, s.y) || this.onRoad(s.x, s.y, 10)) continue;
      g.fillStyle(0x6B4E2E, 0.85); g.fillRect(s.x - s.w / 2, s.y, s.w, s.h);
      g.fillStyle(0x5C3A1E, 0.9);
      for (let dx = -s.w / 2; dx <= s.w / 2; dx += 14) {
        g.fillRect(s.x + dx, s.y - 8, 3, 14);
      }
    }
  }

  private drawSignposts(): void {
    const spots = [
      { x: 1400, y: 1120, label: 'Welcome' },
      { x: PLAZA.x + 120, y: PLAZA.y - 10, label: 'Plaza' },
    ];
    for (const s of spots) {
      if (this.onRoad(s.x, s.y, 8)) continue;
      const g = this.scene.add.graphics(); g.setDepth(s.y + 0.5);
      g.fillStyle(0x6B4E2E, 0.95); g.fillRect(s.x - 1.5, s.y - 18, 3, 22);
      g.fillStyle(0x8B7A5A, 0.95); g.fillRect(s.x - 22, s.y - 14, 44, 10);
      g.lineStyle(1, 0x3A2A18, 0.8); g.strokeRect(s.x - 22, s.y - 14, 44, 10);
      addCrispText(this.scene, s.x, s.y - 9, s.label, { fontSize: '10px', color: '#F5E6C8', fontFamily: 'monospace' })
        .setOrigin(0.5).setDepth(s.y + 0.6);
    }
  }

  // --- FX --------------------------------------------------------------

  private addFx(): void {
    const forge = BUILDING_DEFS.find(b => b.id === 'forge');
    if (forge) {
      this.scene.add.particles(forge.x + 5, forge.y - 55, 'px', {
        x: { min: -8, max: 8 }, speed: { min: 4, max: 12 }, angle: { min: 260, max: 280 },
        scale: { start: 0.35, end: 0.05 }, alpha: { start: 0.3, end: 0 },
        tint: [0x888888, 0x666666, 0x999999], lifespan: 3500, frequency: 300, quantity: 1, gravityY: -10,
      }).setDepth(4);
    }

    const { x: cx, y: cy } = PLAZA;
    this.scene.add.particles(cx, cy - 8, 'px', {
      x: { min: -3, max: 3 }, speed: { min: 6, max: 16 }, angle: { min: 240, max: 300 },
      scale: { start: 0.15, end: 0 }, alpha: { start: 0.5, end: 0 },
      tint: [0x4488DD, 0x88CCFF, 0x66AAEE], lifespan: 1500, frequency: 180, quantity: 1, gravityY: 15,
    }).setDepth(4);

    const chapel = BUILDING_DEFS.find(b => b.id === 'chapel');
    if (chapel) {
      this.scene.add.particles(chapel.x, chapel.y - 30, 'px', {
        x: { min: -4, max: 4 }, speed: { min: 2, max: 6 }, angle: { min: 260, max: 280 },
        scale: { start: 0.2, end: 0 }, alpha: { start: 0.45, end: 0 },
        tint: [0xFFE082, 0xFFD54F, 0xFFB300], lifespan: 1200, frequency: 240, quantity: 1, gravityY: -12,
      }).setDepth(4);
    }

    const alch = BUILDING_DEFS.find(b => b.id === 'alchemist');
    if (alch) {
      this.scene.add.particles(alch.x - 5, alch.y - 40, 'px', {
        x: { min: -5, max: 5 }, speed: { min: 3, max: 8 }, angle: { min: 250, max: 290 },
        scale: { start: 0.22, end: 0 }, alpha: { start: 0.4, end: 0 },
        tint: [0x88FF66, 0x66DD88, 0x44BB99], lifespan: 2200, frequency: 350, quantity: 1, gravityY: -8,
      }).setDepth(4);
    }
  }
}
