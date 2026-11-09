import { editorBridge } from '../EditorBridge';
import { editorStore, useEditorStore } from '../state/editor-store';
import type { EraseScope, Layer, PathStyle } from '../types/editor-events';
import { useI18n } from '../../i18n';

const LAYERS: Array<{ key: Layer; labelKey: string }> = [
  { key: 'terrain',     labelKey: 'editor.layers.terrain' },
  { key: 'paths',       labelKey: 'editor.layers.paths' },
  { key: 'decorations', labelKey: 'editor.layers.decorations' },
  { key: 'buildings',   labelKey: 'editor.layers.buildings' },
];

const PATH_STYLES: PathStyle[] = ['main', 'secondary', 'trail', 'plaza'];

const ERASE_SCOPES: EraseScope[] = ['all', 'terrain', 'decorations', 'paths'];

export function LayerPanel() {
  const { t } = useI18n();
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
    if (confirm(t('editor.layers.confirmAction', { action: what }))) {
      editorBridge.emit('ed:action', what);
    }
  };

  return (
    <div className="editor-layers">
      <div className="editor-palette-header">{t('editor.layers.title')}</div>
      {LAYERS.map((l) => (
        <div key={l.key} className="editor-row">
          <label>
            <input
              type="checkbox"
              checked={layers[l.key]}
              onChange={() => onToggle(l.key)}
            /> {t(l.labelKey)}
          </label>
        </div>
      ))}

      <div className="editor-palette-header" style={{ marginTop: 6 }}>{t('editor.layers.pathBrush')}</div>
      <div className="editor-row">
        <label>{t('editor.layers.style')}</label>
        <select value={pathBrush.style} onChange={(e) => onPathStyle(e.target.value as PathStyle)}>
          {PATH_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="editor-row">
        <label>{t('editor.layers.width', { width: pathBrush.width })}</label>
        <input
          type="range"
          min={16}
          max={80}
          step={1}
          value={pathBrush.width}
          onChange={(e) => onPathWidth(parseInt(e.target.value, 10))}
        />
      </div>

      <div className="editor-palette-header" style={{ marginTop: 6 }}>{t('editor.layers.paintBrush')}</div>
      <div className="editor-row">
        <label>
          <input type="checkbox" checked={paintTile.walkable} onChange={(e) => onWalkable(e.target.checked)} />
          {' '}{t('editor.layers.walkable')}
        </label>
      </div>

      {tool === 'erase' && (
        <>
          <div className="editor-palette-header" style={{ marginTop: 6 }}>{t('editor.layers.eraseScope')}</div>
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

      <div className="editor-palette-header" style={{ marginTop: 6 }}>{t('editor.layers.clear')}</div>
      <button className="editor-btn" onClick={() => onClear('clear-terrain')}>{t('editor.layers.clearTerrain')}</button>
      <button className="editor-btn" onClick={() => onClear('clear-decorations')}>{t('editor.layers.clearDecorations')}</button>
      <button className="editor-btn" onClick={() => onClear('clear-paths')}>{t('editor.layers.clearPaths')}</button>
      <button className="editor-btn" onClick={() => onClear('reset-buildings')}>{t('editor.layers.resetBuildings')}</button>
    </div>
  );
}
