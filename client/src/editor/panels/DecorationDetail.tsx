import { editorBridge } from '../EditorBridge';
import { editorStore, useEditorStore } from '../state/editor-store';
import type { DecorationManifest } from '../types/map';

interface Props {
  decoration: DecorationManifest;
}

export function DecorationDetail({ decoration }: Props) {
  const brush = useEditorStore((s) => s.decorationBrush);
  const animated = brush?.animated ?? false;
  const chosen = brush?.animation ?? decoration.animations?.[0]?.name ?? 'idle';

  if (decoration.animations === undefined || decoration.animations.length === 0) return null;

  const updateBrush = (patch: { animated?: boolean; animation?: string }): void => {
    if (brush === null) return;
    const payload = { ...brush, ...patch };
    editorStore.setDecorationBrush(payload);
    editorBridge.emit('ed:decoration:set', payload);
  };

  return (
    <div className="decoration-detail">
      <label className="decoration-detail-row">
        <input
          type="checkbox"
          checked={animated}
          onChange={(e) => updateBrush({ animated: e.target.checked })}
        />
        <span>Animate on place</span>
      </label>
      {animated && (
        <label className="decoration-detail-row">
          <span>Animation</span>
          <select
            value={chosen}
            onChange={(e) => updateBrush({ animation: e.target.value })}
          >
            {decoration.animations.map((a) => (
              <option key={a.name} value={a.name}>{a.name}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
