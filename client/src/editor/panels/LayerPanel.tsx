import { editorBridge } from '../EditorBridge';
import { editorStore, useEditorStore } from '../state/editor-store';
import type { EraseScope, Layer, PathStyle } from '../types/editor-events';

const LAYERS: Array<{ key: Layer; label: string }> = [
  { key: 'terrain',     label: 'Terrain' },
  { key: 'paths',       label: 'Paths' },
  { key: 'decorations', label: 'Decorations' },
  { key: 'buildings',   label: 'Buildings' },
];

const PATH_STYLES: PathStyle[] = ['main', 'secondary', 'trail', 'plaza'];

const ERASE_SCOPES: EraseScope[] = ['all', 'terrain', 'decorations', 'paths'];

export function LayerPanel() {
  const layers = useEditorStore((s) => s.layers);
  const pathBrush = useEditorStore((s) => s.pathBrush);
  const paintTile = useEditorStore((s) => s.paintTile);
  const tool = useEditorStore((s) => s.tool);

  const onToggle = (layer: Layer) => {
    const next = !layers[layer];
    editorStore.toggleLayer(layer, next);
    editorBridge.emit('ed:layer:toggle', { layer, visible: next });
  };

  const onPathStyle = (style: PathStyle) => {
    editorStore.setPathBrush(style, pathBrush.width);
    editorBridge.emit('ed:path:style', { style, width: pathBrush.width });
  };

  const onPathWidth = (w: number) => {
    editorStore.setPathBrush(pathBrush.style, w);
    editorBridge.emit('ed:path:style', { style: pathBrush.style, width: w });
  };

  const onWalkable = (v: boolean) => {
    editorStore.setPaintTile(paintTile.tile, v);
    editorBridge.emit('ed:tile:set', { tile: paintTile.tile, walkable: v });
  };

  const onEraseScope = (scope: EraseScope) => {
    editorBridge.emit('ed:erase:scope', scope);
  };

  const onClear = (what: 'clear-terrain' | 'clear-decorations' | 'clear-paths' | 'reset-buildings') => {
    if (confirm(`Are you sure you want to run "${what}"?`)) {
      editorBridge.emit('ed:action', what);
    }
  };

  return (
    <div className="editor-layers">
      <div className="editor-palette-header">Layers</div>
      {LAYERS.map((l) => (
        <div key={l.key} className="editor-row">
          <label>
            <input
              type="checkbox"
              checked={layers[l.key]}
              onChange={() => onToggle(l.key)}
            /> {l.label}
          </label>
        </div>
      ))}

      <div className="editor-palette-header" style={{ marginTop: 6 }}>Path Brush</div>
      <div className="editor-row">
        <label>Style</label>
        <select value={pathBrush.style} onChange={(e) => onPathStyle(e.target.value as PathStyle)}>
          {PATH_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="editor-row">
        <label>Width {pathBrush.width}</label>
        <input
          type="range"
          min={16}
          max={80}
          step={1}
          value={pathBrush.width}
          onChange={(e) => onPathWidth(parseInt(e.target.value, 10))}
        />
      </div>

      <div className="editor-palette-header" style={{ marginTop: 6 }}>Paint Brush</div>
      <div className="editor-row">
        <label>
          <input type="checkbox" checked={paintTile.walkable} onChange={(e) => onWalkable(e.target.checked)} />
          {' '}Walkable
        </label>
      </div>

      {tool === 'erase' && (
        <>
          <div className="editor-palette-header" style={{ marginTop: 6 }}>Erase Scope</div>
          <div className="editor-row">
            <select
              defaultValue="all"
              onChange={(e) => onEraseScope(e.target.value as EraseScope)}
              style={{ flex: 1 }}
            >
              {ERASE_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </>
      )}

      <div className="editor-palette-header" style={{ marginTop: 6 }}>Clear</div>
      <button className="editor-btn" onClick={() => onClear('clear-terrain')}>Clear terrain</button>
      <button className="editor-btn" onClick={() => onClear('clear-decorations')}>Clear decorations</button>
      <button className="editor-btn" onClick={() => onClear('clear-paths')}>Clear paths</button>
      <button className="editor-btn" onClick={() => onClear('reset-buildings')}>Reset buildings</button>
    </div>
  );
}
