import type { ToastPayload } from '../hooks/useAgentNotifications';
import './Toasts.css';

export interface ToastItem extends ToastPayload {
  /** Stable de-dupe key: one toast per agent+category at a time. */
  key: string;
}

interface ToastsProps {
  items: ToastItem[];
  onActivate: (id: string) => void;
  onDismiss: (key: string) => void;
}

const CATEGORY_ICON: Record<ToastPayload['category'], string> = {
  waiting: '\u{1F514}',   // bell
  error: '\u{26A0}\u{FE0F}', // warning
  completed: '\u{2705}',  // check
};

/**
 * In-app toast stack (top-right). Browser-independent and permission-free, so
 * it's the reliable alert channel where desktop notifications are flaky (e.g.
 * Safari). Each toast is dismissable and clickable to jump to the agent.
 */
export function Toasts({ items, onActivate, onDismiss }: ToastsProps) {
  if (items.length === 0) return null;
  return (
    <div className="toasts" role="region" aria-label="Notifications">
      {items.map((t) => (
        <div key={t.key} className={`toast toast-${t.category}`} role="status">
          <button
            type="button"
            className="toast-body-btn"
            onClick={() => { onActivate(t.agentId); onDismiss(t.key); }}
            title="Show this agent"
          >
            <span className="toast-icon" aria-hidden="true">{CATEGORY_ICON[t.category]}</span>
            <span className="toast-text">
              <span className="toast-title">{t.title}</span>
              <span className="toast-message">{t.body}</span>
            </span>
          </button>
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={() => onDismiss(t.key)}
          >×</button>
        </div>
      ))}
    </div>
  );
}
