import { editorBridge } from '../EditorBridge';
import { editorStore, useEditorStore } from '../state/editor-store';
import type { ToolName } from '../types/editor-events';
import { useI18n } from '../../i18n';

interface ToolDef {
  id: ToolName;
  icon: string;
  /** i18n key of the tooltip on hover — keeps the full description. */
  labelKey: string;
  /** i18n key of the one-word subtitle shown under the icon in the sidebar. */
  captionKey: string;
}

const TOOLS: ToolDef[] = [
  { id: 'select',         icon: '↖',  labelKey: 'editor.toolbar.select',         captionKey: 'editor.toolbar.caption.select' },
  { id: 'paint',          icon: '🖌', labelKey: 'editor.toolbar.paintTerrain',   captionKey: 'editor.toolbar.caption.paint' },
  { id: 'erase',          icon: '🩹', labelKey: 'editor.toolbar.erase',          captionKey: 'editor.toolbar.caption.erase' },
  { id: 'decoration',     icon: '🌳', labelKey: 'editor.toolbar.decoration',     captionKey: 'editor.toolbar.caption.decoration' },
  { id: 'path',           icon: '〰', labelKey: 'editor.toolbar.path',           captionKey: 'editor.toolbar.caption.path' },
  { id: 'move-building',  icon: '🏰', labelKey: 'editor.toolbar.moveBuilding',   captionKey: 'editor.toolbar.caption.moveBuilding' },
  { id: 'npc',            icon: '👤', labelKey: 'editor.toolbar.placeNpc',       captionKey: 'editor.toolbar.caption.npc' },
  { id: 'spawn',          icon: '🚩', labelKey: 'editor.toolbar.heroSpawnPoint', captionKey: 'editor.toolbar.caption.spawn' },
];

export function ToolBar() {
  const { t } = useI18n();
  const activeTool = useEditorStore((s) => s.tool);
  const gridVisible = useEditorStore((s) => s.gridVisible);

  const onSelectTool = (tool: ToolName) => {
    editorStore.setTool(tool);
    editorBridge.emit('ed:tool:set', tool);
  };

  const onZoom = (dir: 'in' | 'out' | 'fit') => {
    editorBridge.emit('ed:zoom', dir);
  };

  const onToggleGrid = () => {
    const next = !gridVisible;
    editorStore.setGrid(next);
    editorBridge.emit('ed:grid:toggle', next);
  };

  return (
    <div className="editor-toolbar">
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          className={`editor-tool-btn${activeTool === tool.id ? ' active' : ''}`}
          title={t(tool.labelKey)}
          onClick={() => onSelectTool(tool.id)}
        >
          <span className="editor-tool-icon">{tool.icon}</span>
          <span className="editor-tool-caption">{t(tool.captionKey)}</span>
        </button>
      ))}
      <div className="editor-tool-divider" />
      <button className="editor-tool-btn" title={t('editor.toolbar.zoomIn')} onClick={() => onZoom('in')}>
        <span className="editor-tool-icon">＋</span>
        <span className="editor-tool-caption">{t('editor.toolbar.caption.zoomIn')}</span>
      </button>
      <button className="editor-tool-btn" title={t('editor.toolbar.zoomOut')} onClick={() => onZoom('out')}>
        <span className="editor-tool-icon">−</span>
        <span className="editor-tool-caption">{t('editor.toolbar.caption.zoomOut')}</span>
      </button>
      <button className="editor-tool-btn" title={t('editor.toolbar.fitToViewport')} onClick={() => onZoom('fit')}>
        <span className="editor-tool-icon">⤢</span>
        <span className="editor-tool-caption">{t('editor.toolbar.caption.fit')}</span>
      </button>
      {activeTool === 'paint' && (
        <>
          <div className="editor-tool-divider" />
          <button
            className="editor-tool-btn"
            title={t('editor.toolbar.fillTerrain')}
            onClick={() => editorBridge.emit('ed:action', 'fill-terrain')}
          >
            <span className="editor-tool-icon">▧</span>
            <span className="editor-tool-caption">{t('editor.toolbar.caption.fill')}</span>
          </button>
        </>
      )}
      <div className="editor-tool-divider" />
      <button
        className={`editor-tool-btn${gridVisible ? ' active' : ''}`}
        title={t('editor.toolbar.toggleGrid')}
        onClick={onToggleGrid}
      >
        <span className="editor-tool-icon">#</span>
        <span className="editor-tool-caption">{t('editor.toolbar.caption.grid')}</span>
      </button>
    </div>
  );
}
