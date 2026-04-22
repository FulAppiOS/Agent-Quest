import { useState } from 'react';
import { editorBridge } from '../EditorBridge';
import { editorStore, useEditorStore } from '../state/editor-store';
import type { DecorationManifest, NpcSpriteManifest, TilesetManifest, UnitColor, UnitType } from '../types/map';
import { TileTree } from './TileTree';
import { DecorationDetail } from './DecorationDetail';

// NPC unit/color rows are derived per-render from the active manifest in
// the NpcPalette sub-component so themes that introduce new units
// (CC0 goblins) or drop colors flow through without editing this file.

export function TilePalette() {
  const manifest = useEditorStore((s) => s.manifest);
  const tilesetTab = useEditorStore((s) => s.tilesetTab);
  const decoGroup = useEditorStore((s) => s.decorationGroup);
  const paintTile = useEditorStore((s) => s.paintTile);
  const decorationBrush = useEditorStore((s) => s.decorationBrush);
  const activeTool = useEditorStore((s) => s.tool);
  const npcBrush = useEditorStore((s) => s.npcBrush);
  const [terrainExpanded, setTerrainExpanded] = useState(true);
  const [decorationsExpanded, setDecorationsExpanded] = useState(true);

  if (manifest === null) {
    return (
      <div className="editor-tile-palette">
        <div className="editor-palette-header">Palette</div>
        <div style={{ color: '#888', fontSize: 11 }}>Loading assets...</div>
      </div>
    );
  }

  // --- NPC palette ---
  if (activeTool === 'npc') {
    return <NpcPalette manifest={manifest} npcBrush={npcBrush} />;
  }

  // --- Terrain + Decoration palette ---
  const tileset = manifest.tilesets.find((t) => t.key === tilesetTab) ?? manifest.tilesets[0];
  const selectedFolder = decoGroup;
  const decorations = manifest.decorations.filter((d) => {
    const segs = d.folderPath !== undefined && d.folderPath.length > 0 ? d.folderPath : [d.group];
    return segs.join('/') === selectedFolder;
  });
  const selectedDecoration = decorationBrush !== null
    ? manifest.decorations.find((d) => d.key === decorationBrush.key)
    : undefined;

  const onTileClick = (set: TilesetManifest, frame: number) => {
    const tile = { set: set.key, frame };
    editorStore.setTool('paint');
    editorStore.setPaintTile(tile, paintTile.walkable);
    editorBridge.emit('ed:tool:set', 'paint');
    editorBridge.emit('ed:tile:set', { tile, walkable: paintTile.walkable });
  };

  const currentDecoScale = decorationBrush?.scale ?? 0.5;

  const onDecoClick = (d: DecorationManifest, frame?: number) => {
    // Keep current slider scale if brush is already set, otherwise use asset default
    const scale = decorationBrush !== null ? currentDecoScale : d.defaultScale;
    // Preserve Animate toggle + animation choice when re-clicking a different
    // frame of the same deco; reset them when switching to a different deco.
    const sameDeco = decorationBrush !== null && decorationBrush.key === d.key;
    const payload = {
      key: d.key,
      frame,
      scale,
      animated: sameDeco ? (decorationBrush.animated ?? false) : false,
      animation: sameDeco ? decorationBrush.animation : d.animations?.[0]?.name ?? 'idle',
    };
    editorStore.setTool('decoration');
    editorStore.setDecorationBrush(payload);
    editorBridge.emit('ed:tool:set', 'decoration');
    editorBridge.emit('ed:decoration:set', payload);
  };

  const onDecoScaleChange = (val: number) => {
    if (decorationBrush === null) return;
    const payload = { ...decorationBrush, scale: val };
    editorStore.setDecorationBrush(payload);
    editorBridge.emit('ed:decoration:set', payload);
  };

  const tileCount = tileset !== undefined ? tileset.columns * tileset.rows : 0;
  const tiles: number[] = [];
  for (let i = 0; i < tileCount; i++) tiles.push(i);

  return (
    <div className="editor-tile-palette">
      <button
        type="button"
        className="editor-palette-header editor-palette-header-toggle"
        aria-expanded={terrainExpanded}
        onClick={() => setTerrainExpanded((v) => !v)}
      >
        <span className="editor-palette-caret">{terrainExpanded ? '\u25BE' : '\u25B8'}</span>
        Terrain Tileset
      </button>
      {terrainExpanded && (
        <>
          <div className="editor-palette-tabs">
            {manifest.tilesets.map((t) => (
              <button
                key={t.key}
                className={`editor-palette-tab${t.key === tilesetTab ? ' active' : ''}`}
                onClick={() => editorStore.setTilesetTab(t.key)}
              >
                {t.label.replace('Terrain \u2014 ', '')}
              </button>
            ))}
          </div>

          {tileset !== undefined && (
            <div className="editor-palette-tile-grid">
              {tiles.map((frame) => {
                const col = frame % tileset.columns;
                const row = Math.floor(frame / tileset.columns);
                const active =
                  paintTile.tile?.set === tileset.key && paintTile.tile.frame === frame;
                // Display 64px tile scaled down to 32px. So scale background by 0.5.
                const bgSize = `${tileset.columns * 32}px ${tileset.rows * 32}px`;
                const bgPos = `-${col * 32}px -${row * 32}px`;
                return (
                  <div
                    key={frame}
                    className={`editor-palette-tile${active ? ' active' : ''}`}
                    style={{
                      backgroundImage: `url(${tileset.path})`,
                      backgroundSize: bgSize,
                      backgroundPosition: bgPos,
                    }}
                    title={`Frame ${frame}`}
                    onClick={() => onTileClick(tileset, frame)}
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="editor-palette-section">
        <button
          type="button"
          className="editor-palette-header editor-palette-header-toggle"
          aria-expanded={decorationsExpanded}
          onClick={() => setDecorationsExpanded((v) => !v)}
        >
          <span className="editor-palette-caret">{decorationsExpanded ? '\u25BE' : '\u25B8'}</span>
          Decorations
        </button>
        {decorationsExpanded && (
          <>
            <div className="editor-palette-decorations-layout">
              <TileTree
                decorations={manifest.decorations}
                selected={selectedFolder}
                onSelect={(key) => editorStore.setDecorationGroup(key)}
              />
              <div className="editor-palette-decorations-grid">
                {selectedFolder === '' && (
                  <p className="editor-palette-hint">Select a folder on the left to see assets.</p>
                )}
                {selectedFolder !== '' && decorations.length === 0 && (
                  <p className="editor-palette-hint">No assets in this folder.</p>
                )}
                {decorations.map((d) => {
                  const hasFrames = d.frameWidth !== undefined && d.frameHeight !== undefined && d.frameWidth > 0 && d.frameHeight > 0;
                  if (!hasFrames) {
                    const active = decorationBrush?.key === d.key && decorationBrush.frame === undefined;
                    return (
                      <button
                        key={d.key}
                        className={`editor-palette-deco${active ? ' active' : ''}`}
                        title={d.label}
                        onClick={() => onDecoClick(d)}
                      >
                        <img src={d.path} alt={d.label} />
                      </button>
                    );
                  }
                  return <DecoFrames key={d.key} deco={d} decorationBrush={decorationBrush} onDecoClick={onDecoClick} />;
                })}
              </div>
            </div>
            {decorationBrush !== null && (
              <div className="editor-row" style={{ marginTop: 4 }}>
                <label>Scale</label>
                <input
                  type="range"
                  min="0.1"
                  max="3.0"
                  step="0.05"
                  value={currentDecoScale}
                  onChange={(e) => onDecoScaleChange(parseFloat(e.target.value))}
                />
                <span style={{ fontSize: 11, minWidth: 32, textAlign: 'right' }}>{currentDecoScale.toFixed(2)}</span>
              </div>
            )}
            {decorationBrush !== null && selectedDecoration !== undefined && (
              <DecorationDetail decoration={selectedDecoration} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// --- Decoration frames sub-component ---
interface DecoFramesProps {
  deco: DecorationManifest;
  decorationBrush: { key: string; frame?: number; scale: number } | null;
  onDecoClick: (d: DecorationManifest, frame?: number) => void;
}

function DecoFrames({ deco, decorationBrush, onDecoClick }: DecoFramesProps) {
  const fw = deco.frameWidth ?? 0;
  const fh = deco.frameHeight ?? 0;
  if (fw === 0 || fh === 0) return null;

  // Preview strategy:
  //   - Sheet has an "idle" anim → show just that contiguous range (the
  //     animation preview) on a single virtual row.
  //   - Sheet is frame-picker only (no animations, e.g. Tree/Bridge atlas)
  //     → show every frame so the user can pick any cell of the atlas.
  // Multi-row atlases map frame index → (col, row) via sheetColumns so
  // frames past column N render with the correct background-position Y.
  const totalFrames = deco.frameCount ?? 0;
  const sheetCols = deco.sheetColumns ?? totalFrames;
  const idle = deco.animations?.find((a) => a.name === 'idle');
  const hasAnims = (deco.animations?.length ?? 0) > 0;

  const startFrame = idle?.start ?? 0;
  const frames: number[] = [];
  if (idle !== undefined) {
    for (let i = startFrame; i <= idle.end; i++) frames.push(i);
  } else if (!hasAnims && totalFrames > 0) {
    for (let i = 0; i < totalFrames; i++) frames.push(i);
  } else {
    // Animated sheet without an explicit idle — fall back to first row.
    const count = Math.min(totalFrames > 0 ? totalFrames : sheetCols, sheetCols || 8);
    for (let i = 0; i < count; i++) frames.push(i);
  }

  const cellSize = 48;
  const scale = Math.min(cellSize / fw, cellSize / fh);
  const sheetRows = sheetCols > 0 ? Math.max(1, Math.ceil(totalFrames / sheetCols)) : 1;
  const bgW = sheetCols * fw * scale;
  const bgH = sheetRows * fh * scale;

  return (
    <>
      {frames.map((frameIdx) => {
        const active = decorationBrush?.key === deco.key && decorationBrush.frame === frameIdx;
        const col = sheetCols > 0 ? frameIdx % sheetCols : 0;
        const row = sheetCols > 0 ? Math.floor(frameIdx / sheetCols) : 0;
        const bgPosX = -(col * fw * scale);
        const bgPosY = -(row * fh * scale);
        return (
          <button
            key={`${deco.key}-f${frameIdx}`}
            className={`editor-palette-deco${active ? ' active' : ''}`}
            title={`${deco.label} #${frameIdx}`}
            onClick={() => onDecoClick(deco, frameIdx)}
            style={{
              overflow: 'hidden',
              width: cellSize,
              minHeight: cellSize,
              position: 'relative',
            }}
          >
            <div
              style={{
                width: fw * scale,
                height: fh * scale,
                backgroundImage: `url(${deco.path})`,
                backgroundSize: `${bgW}px ${bgH}px`,
                backgroundPosition: `${bgPosX}px ${bgPosY}px`,
                backgroundRepeat: 'no-repeat',
                imageRendering: 'pixelated',
              }}
            />
          </button>
        );
      })}
    </>
  );
}

// --- NPC Palette sub-component ---
interface NpcPaletteProps {
  manifest: { npcSprites: import('../types/map').NpcSpriteManifest[] };
  npcBrush: { unit: UnitType; color: UnitColor; scale: number; wanderRadius: number } | null;
}

function NpcPalette({ manifest, npcBrush }: NpcPaletteProps) {
  const currentScale = npcBrush?.scale ?? 0.28;
  const currentWander = npcBrush?.wanderRadius ?? 120;

  // Derive the distinct unit types and colors present in the active
  // manifest, preserving manifest insertion order. This makes the palette
  // rows match whatever the theme exposes — v2 emits 4 knight units; CC0
  // emits 4 knights + 3 goblins; future themes flow through automatically.
  const npcUnits: UnitType[] = [];
  const seenUnits = new Set<UnitType>();
  const npcColors: UnitColor[] = [];
  const seenColors = new Set<UnitColor>();
  for (const s of manifest.npcSprites) {
    if (!seenUnits.has(s.unit)) { seenUnits.add(s.unit); npcUnits.push(s.unit); }
    if (!seenColors.has(s.color)) { seenColors.add(s.color); npcColors.push(s.color); }
  }

  const findSprite = (unit: UnitType, color: UnitColor): NpcSpriteManifest | undefined => {
    return manifest.npcSprites.find((s) => s.unit === unit && s.color === color);
  };

  const onNpcSelect = (unit: UnitType, color: UnitColor) => {
    const brush = { unit, color, scale: currentScale, wanderRadius: currentWander };
    editorStore.setNpcBrush(brush);
    editorBridge.emit('ed:npc:set', brush);
  };

  const onScaleChange = (val: number) => {
    if (npcBrush === null) return;
    const brush = { ...npcBrush, scale: val };
    editorStore.setNpcBrush(brush);
    editorBridge.emit('ed:npc:set', brush);
  };

  const onWanderChange = (val: number) => {
    if (npcBrush === null) return;
    const brush = { ...npcBrush, wanderRadius: val };
    editorStore.setNpcBrush(brush);
    editorBridge.emit('ed:npc:set', brush);
  };

  return (
    <div className="editor-tile-palette">
      <div className="editor-palette-header">NPC Units</div>

      {npcUnits.map((unit) => (
        <div key={unit}>
          <div style={{ fontSize: 10, color: '#888', textTransform: 'capitalize', marginBottom: 2, marginTop: 6 }}>
            {unit}
          </div>
          <div className="editor-npc-grid">
            {npcColors.map((color) => {
              const sprite = findSprite(unit, color);
              const active = npcBrush?.unit === unit && npcBrush?.color === color;
              const imgPath = sprite?.idlePath;

              // Show first frame of the idle spritesheet
              const fw = sprite?.frameWidth ?? 192;
              const fh = sprite?.frameHeight ?? 192;
              const displaySize = 40;
              const scale = displaySize / Math.max(fw, fh);

              return (
                <button
                  key={`${unit}-${color}`}
                  className={`editor-npc-cell${active ? ' active' : ''}`}
                  title={`${color} ${unit}`}
                  onClick={() => onNpcSelect(unit, color)}
                >
                  {imgPath !== undefined ? (
                    <div
                      style={{
                        width: displaySize,
                        height: displaySize,
                        backgroundImage: `url(${imgPath})`,
                        backgroundSize: `auto ${fh * scale}px`,
                        backgroundPosition: '0px 0px',
                        backgroundRepeat: 'no-repeat',
                        imageRendering: 'pixelated',
                      }}
                    />
                  ) : (
                    <div style={{ width: displaySize, height: displaySize, background: 'rgba(255,255,255,0.05)' }} />
                  )}
                  <span>{color}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="editor-palette-section" style={{ marginTop: 8 }}>
        <div className="editor-palette-header">Brush Settings</div>
        <div className="editor-row" style={{ marginTop: 4 }}>
          <label>Scale</label>
          <input
            type="range"
            min="0.1"
            max="1.0"
            step="0.01"
            value={currentScale}
            onChange={(e) => onScaleChange(parseFloat(e.target.value))}
          />
          <span style={{ fontSize: 11, minWidth: 32, textAlign: 'right' }}>{currentScale.toFixed(2)}</span>
        </div>
        <div className="editor-row" style={{ marginTop: 4 }}>
          <label>Wander</label>
          <input
            type="range"
            min="50"
            max="300"
            step="10"
            value={currentWander}
            onChange={(e) => onWanderChange(parseInt(e.target.value, 10))}
          />
          <span style={{ fontSize: 11, minWidth: 32, textAlign: 'right' }}>{currentWander}</span>
        </div>
      </div>
    </div>
  );
}
