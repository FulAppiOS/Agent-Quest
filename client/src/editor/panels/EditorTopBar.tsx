import { editorBridge } from '../EditorBridge';
import { editorStore, useEditorStore } from '../state/editor-store';
import type { SlotInfo } from '../types/map';

export function EditorTopBar() {
  const dirty = useEditorStore((s) => s.dirty);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const saveError = useEditorStore((s) => s.saveError);
  const saving = useEditorStore((s) => s.saving);
  const currentSlot = useEditorStore((s) => s.currentSlot);
  const activeSlot = useEditorStore((s) => s.activeSlot);
  const slotInfo = useEditorStore((s) => s.slotInfo);

  const formatTime = (ts: number): string => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const statusText = (() => {
    if (saveError !== null) return `Save error: ${saveError}`;
    if (saving) return 'Saving...';
    if (dirty) return 'Unsaved changes';
    if (lastSavedAt !== null) return `Saved ${formatTime(lastSavedAt)}`;
    return 'Ready';
  })();

  const statusClass = saveError !== null
    ? 'editor-status error'
    : dirty ? 'editor-status dirty' : lastSavedAt !== null ? 'editor-status saved' : 'editor-status';

  const onSave = () => {
    editorStore.setSaving(true);
    editorBridge.emit('ed:action', 'save');
  };

  const onSetActive = () => {
    editorBridge.emit('ed:action', 'set-active');
  };

  const onResetSlot = () => {
    if (confirm('Reset this slot to defaults? This cannot be undone.')) {
      editorBridge.emit('ed:action', 'reset-all');
    }
  };

  const onSlotClick = (info: SlotInfo) => {
    editorStore.setCurrentSlot(info.slot);
    editorBridge.emit('ed:slot:load', info.slot);
  };

  const getSlotLabel = (info: SlotInfo): string => {
    const star = info.isActive ? ' \u2605' : '';
    if (info.isEmpty) return `${info.slot}${star}`;
    const name = info.name.length > 10 ? info.name.slice(0, 10) + '...' : info.name;
    return `${info.slot} \u2014 ${name}${star}`;
  };

  return (
    <div className="editor-topbar">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div className="editor-topbar-title">Map Editor</div>
        <div className="editor-slot-tabs">
          {slotInfo.map((info) => {
            const isCurrentSlot = info.slot === currentSlot;
            const classes = [
              'editor-slot-tab',
              isCurrentSlot ? 'active' : '',
              !info.isEmpty ? 'has-map' : '',
            ].filter(Boolean).join(' ');
            return (
              <button
                key={info.slot}
                className={classes}
                title={info.isEmpty ? `Slot ${info.slot} (empty)` : `${info.name}${info.isActive ? ' (active)' : ''}`}
                onClick={() => onSlotClick(info)}
              >
                {getSlotLabel(info)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="editor-topbar-actions">
        <span className={statusClass}>{statusText}</span>
        <button className="editor-btn primary" onClick={onSave} disabled={saving}>Save</button>
        <button
          className="editor-btn"
          onClick={onSetActive}
          title="Set this slot as the active map for the dashboard"
        >
          Set Active {currentSlot === activeSlot ? '\u2605' : ''}
        </button>
        <button className="editor-btn danger" onClick={onResetSlot}>Reset Slot</button>
        <a className="editor-btn" href="/" style={{ textDecoration: 'none' }}>Back to Village</a>
      </div>
    </div>
  );
}
