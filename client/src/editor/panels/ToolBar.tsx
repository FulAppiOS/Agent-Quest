import { editorBridge } from '../EditorBridge';
import { editorStore, useEditorStore } from '../state/editor-store';
import type { ToolName } from '../types/editor-events';

interface ToolDef {
  id: ToolName;
  icon: string;
  /** Tooltip on hover — keeps the full description. */
  label: string;
  /** One-word subtitle shown under the icon in the sidebar. */
  caption: string;
}

const TOOLS: ToolDef[] = [
  { id: 'select',         icon: '↖',  label: 'Select',            caption: 'Select' },
  { id: 'paint',          icon: '🖌', label: 'Paint terrain',     caption: 'Paint'  },
  { id: 'erase',          icon: '🩹', label: 'Erase',             caption: 'Erase'  },
  { id: 'decoration',     icon: '🌳', label: 'Decoration',        caption: 'Decor'  },
  { id: 'path',           icon: '〰', label: 'Path',              caption: 'Path'   },
  { id: 'move-building',  icon: '🏰', label: 'Move building',     caption: 'Move'   },
  { id: 'npc',            icon: '👤', label: 'Place NPC',         caption: 'NPC'    },
  { id: 'spawn',          icon: '🚩', label: 'Hero spawn point',  caption: 'Spawn'  },
];

export function ToolBar() {
  const activeTool = useEditorStore((s) => s.tool);
  const gridVisible = useEditorStore((s) => s.gridVisible);

  const onSelectTool = (t: ToolName) => {
    editorStore.setTool(t);
    editorBridge.emit('ed:tool:set', t);
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
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`editor-tool-btn${activeTool === t.id ? ' active' : ''}`}
          title={t.label}
          onClick={() => onSelectTool(t.id)}
        >
          <span className="editor-tool-icon">{t.icon}</span>
          <span className="editor-tool-caption">{t.caption}</span>
        </button>
      ))}
      <div className="editor-tool-divider" />
      <button className="editor-tool-btn" title="Zoom in" onClick={() => onZoom('in')}>
        <span className="editor-tool-icon">＋</span>
        <span className="editor-tool-caption">In</span>
      </button>
      <button className="editor-tool-btn" title="Zoom out" onClick={() => onZoom('out')}>
        <span className="editor-tool-icon">−</span>
        <span className="editor-tool-caption">Out</span>
      </button>
      <button className="editor-tool-btn" title="Fit to viewport" onClick={() => onZoom('fit')}>
        <span className="editor-tool-icon">⤢</span>
        <span className="editor-tool-caption">Fit</span>
      </button>
      {activeTool === 'paint' && (
        <>
          <div className="editor-tool-divider" />
          <button
            className="editor-tool-btn"
            title="Fill all terrain (F)"
            onClick={() => editorBridge.emit('ed:action', 'fill-terrain')}
          >
            <span className="editor-tool-icon">▧</span>
            <span className="editor-tool-caption">Fill</span>
          </button>
        </>
      )}
      <div className="editor-tool-divider" />
      <button
        className={`editor-tool-btn${gridVisible ? ' active' : ''}`}
        title="Toggle grid"
        onClick={onToggleGrid}
      >
        <span className="editor-tool-icon">#</span>
        <span className="editor-tool-caption">Grid</span>
      </button>
    </div>
  );
}
