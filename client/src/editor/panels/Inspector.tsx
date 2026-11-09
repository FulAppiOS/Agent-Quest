import { editorBridge } from '../EditorBridge';
import { editorStore, useEditorStore } from '../state/editor-store';
import type { UnitColor, UnitType } from '../types/map';
import { useI18n } from '../../i18n';

// Kept as fallbacks only — the actual option lists shown in the NPC
// dropdowns are derived from the active manifest's npcSprites so themes
// that add units (e.g. CC0 goblins) or remove colors flow through without
// code changes. See the body of the npc-kind selection branch below.
const NPC_UNITS_FALLBACK: UnitType[] = ['warrior', 'archer', 'pawn'];
const NPC_COLORS_FALLBACK: UnitColor[] = ['blue', 'red', 'black', 'yellow', 'purple'];

export function Inspector() {
  const { t } = useI18n();
  const selection = useEditorStore((s) => s.selection);
  const stats = useEditorStore((s) => s.stats);
  const heroScale = useEditorStore((s) => s.heroScale);
  const manifest = useEditorStore((s) => s.manifest);

  const onDelete = () => editorBridge.emit('ed:delete:selected');

  if (selection === null) {
    return (
      <div className="editor-inspector">
        <div className="editor-palette-header">{t('editor.inspector.statistics')}</div>
        <div className="editor-stat">
          <span className="editor-stat-label">{t('editor.inspector.terrainCells')}</span>
          <span className="editor-stat-value">{stats.terrainCells}</span>
        </div>
        <div className="editor-stat">
          <span className="editor-stat-label">{t('editor.inspector.decorations')}</span>
          <span className="editor-stat-value">{stats.decorations}</span>
        </div>
        <div className="editor-stat">
          <span className="editor-stat-label">{t('editor.inspector.paths')}</span>
          <span className="editor-stat-value">{stats.paths}</span>
        </div>
        <div className="editor-stat">
          <span className="editor-stat-label">{t('editor.inspector.buildings')}</span>
          <span className="editor-stat-value">{stats.buildings}</span>
        </div>
        <div className="editor-stat">
          <span className="editor-stat-label">{t('editor.inspector.npcs')}</span>
          <span className="editor-stat-value">{stats.npcs}</span>
        </div>

        <div className="editor-palette-header" style={{ marginTop: 8 }}>{t('editor.inspector.settings')}</div>
        <div className="editor-row">
          <label>{t('editor.inspector.heroScale')}</label>
          <input
            type="range"
            min="0.15"
            max="0.60"
            step="0.01"
            value={heroScale}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              editorStore.setHeroScale(val);
              editorBridge.emit('ed:settings:update', { heroScale: val });
            }}
          />
          <span style={{ fontSize: 11 }}>{heroScale.toFixed(2)}</span>
        </div>
      </div>
    );
  }

  if (selection.kind === 'decoration') {
    return (
      <div className="editor-inspector">
        <div className="editor-palette-header">{t('editor.inspector.decoration')}</div>
        <div className="editor-inspector-label">{t('editor.inspector.id')}</div>
        <div className="editor-inspector-value" style={{ fontSize: 10 }}>{selection.id}</div>
        <div className="editor-inspector-label">{t('editor.inspector.texture')}</div>
        <div className="editor-inspector-value">{selection.textureKey}</div>
        <div className="editor-inspector-label">{t('editor.inspector.position')}</div>
        <div className="editor-inspector-value">{Math.round(selection.x)}, {Math.round(selection.y)}</div>
        <div className="editor-inspector-label">{t('editor.inspector.scale')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="range"
            min="0.1"
            max="3.0"
            step="0.1"
            value={selection.scale}
            onChange={(e) => editorBridge.emit('ed:decoration:scale', { id: selection.id, scale: parseFloat(e.target.value) })}
            style={{ flex: 1, accentColor: '#C4A35A', height: 4 }}
          />
          <span className="editor-inspector-value">{selection.scale.toFixed(2)}</span>
        </div>
        <button className="editor-btn danger" onClick={onDelete}>{t('common.delete')}</button>
      </div>
    );
  }

  if (selection.kind === 'building') {
    return (
      <div className="editor-inspector">
        <div className="editor-palette-header">{t('editor.inspector.building')}</div>
        <div className="editor-inspector-label">{t('editor.inspector.id')}</div>
        <div className="editor-inspector-value">{selection.id}</div>
        <div className="editor-inspector-label">{t('editor.inspector.label')}</div>
        <div className="editor-inspector-value">{selection.label}</div>
        <div className="editor-inspector-label">{t('editor.inspector.position')}</div>
        <div className="editor-inspector-value">{Math.round(selection.x)}, {Math.round(selection.y)}</div>
        <div style={{ fontSize: 10, color: '#888' }}>{t('editor.inspector.moveBuildingHint')}</div>
      </div>
    );
  }

  if (selection.kind === 'npc') {
    // Derive available unit/color options from the active manifest so
    // themes that introduce new unit types (e.g. CC0 goblins) appear
    // in the dropdown without code changes. Preserve manifest insertion
    // order so rows match the palette ordering.
    const npcUnits: UnitType[] = [];
    const seenUnits = new Set<UnitType>();
    const npcColors: UnitColor[] = [];
    const seenColors = new Set<UnitColor>();
    for (const s of manifest?.npcSprites ?? []) {
      if (!seenUnits.has(s.unit)) { seenUnits.add(s.unit); npcUnits.push(s.unit); }
      if (!seenColors.has(s.color)) { seenColors.add(s.color); npcColors.push(s.color); }
    }
    // Fallback for the brief pre-manifest window during boot.
    const unitOptions = npcUnits.length > 0 ? npcUnits : NPC_UNITS_FALLBACK;
    const colorOptions = npcColors.length > 0 ? npcColors : NPC_COLORS_FALLBACK;

    const onNpcChange = (updates: Partial<{ unit: UnitType; color: UnitColor; scale: number; wanderRadius: number }>) => {
      const updated = {
        id: selection.id,
        unit: updates.unit ?? selection.unit,
        color: updates.color ?? selection.color,
        x: selection.x,
        y: selection.y,
        scale: updates.scale ?? selection.scale,
        wanderRadius: updates.wanderRadius ?? selection.wanderRadius,
      };
      editorBridge.emit('ed:npc:update', updated);
    };

    return (
      <div className="editor-inspector">
        <div className="editor-palette-header">{t('editor.inspector.npc')}</div>
        <div className="editor-inspector-label">{t('editor.inspector.id')}</div>
        <div className="editor-inspector-value" style={{ fontSize: 10 }}>{selection.id}</div>

        <div className="editor-inspector-label">{t('editor.inspector.unitType')}</div>
        <select
          value={selection.unit}
          onChange={(e) => onNpcChange({ unit: e.target.value as UnitType })}
        >
          {unitOptions.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>

        <div className="editor-inspector-label">{t('editor.inspector.color')}</div>
        <select
          value={selection.color}
          onChange={(e) => onNpcChange({ color: e.target.value as UnitColor })}
        >
          {colorOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <div className="editor-inspector-label">{t('editor.inspector.position')}</div>
        <div className="editor-inspector-value">{Math.round(selection.x)}, {Math.round(selection.y)}</div>

        <div className="editor-inspector-label">{t('editor.inspector.scale')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="range"
            min="0.1"
            max="1.0"
            step="0.01"
            value={selection.scale}
            onChange={(e) => onNpcChange({ scale: parseFloat(e.target.value) })}
            style={{ flex: 1, accentColor: '#C4A35A', height: 4 }}
          />
          <span className="editor-inspector-value">{selection.scale.toFixed(2)}</span>
        </div>

        <div className="editor-inspector-label">{t('editor.inspector.wanderRadius')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="range"
            min="50"
            max="300"
            step="10"
            value={selection.wanderRadius}
            onChange={(e) => onNpcChange({ wanderRadius: parseInt(e.target.value, 10) })}
            style={{ flex: 1, accentColor: '#C4A35A', height: 4 }}
          />
          <span className="editor-inspector-value">{selection.wanderRadius}</span>
        </div>

        <button className="editor-btn danger" onClick={onDelete}>{t('common.delete')}</button>
      </div>
    );
  }

  if (selection.kind === 'spawn') {
    const onReset = () => editorBridge.emit('ed:spawn:clear');
    return (
      <div className="editor-inspector">
        <div className="editor-palette-header">{t('editor.inspector.heroSpawn')}</div>
        <div className="editor-inspector-label">{t('editor.inspector.status')}</div>
        <div className="editor-inspector-value">
          {selection.isSet ? t('editor.inspector.spawnCustom') : t('editor.inspector.spawnDefault')}
        </div>
        <div className="editor-inspector-label">{t('editor.inspector.position')}</div>
        <div className="editor-inspector-value">
          {Math.round(selection.x)}, {Math.round(selection.y)}
        </div>
        <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
          {t('editor.inspector.spawnHint')}
        </div>
        {selection.isSet && (
          <button className="editor-btn" onClick={onReset} style={{ marginTop: 8 }}>
            {t('editor.inspector.resetToDefault')}
          </button>
        )}
      </div>
    );
  }

  // path
  return (
    <div className="editor-inspector">
      <div className="editor-palette-header">{t('editor.inspector.path')}</div>
      <div className="editor-inspector-label">{t('editor.inspector.id')}</div>
      <div className="editor-inspector-value" style={{ fontSize: 10 }}>{selection.id}</div>
      <div className="editor-inspector-label">{t('editor.inspector.style')}</div>
      <div className="editor-inspector-value">{selection.style}</div>
      <div className="editor-inspector-label">{t('editor.inspector.points')}</div>
      <div className="editor-inspector-value">{selection.pointCount}</div>
      <div className="editor-inspector-label">{t('editor.inspector.width')}</div>
      <div className="editor-inspector-value">{selection.width}</div>
      <button className="editor-btn danger" onClick={onDelete}>{t('common.delete')}</button>
    </div>
  );
}
