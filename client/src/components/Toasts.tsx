import type { ToastPayload } from '../hooks/useAgentNotifications';
import { useI18n } from '../i18n';
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
  context: '\u{1F9E0}',   // brain — context window nearly full
};

/**
 * In-app toast stack (top-right). Browser-independent and permission-free, so
 * it's the reliable alert channel where desktop notifications are flaky (e.g.
 * Safari). Each toast is dismissable and clickable to jump to the agent.
 */
export function Toasts({ items, onActivate, onDismiss }: ToastsProps) {
  const { t } = useI18n();
  if (items.length === 0) return null;
  return (
    <div className="toasts" role="region" aria-label={t('toasts.region')}>
      {items.map((item) => (
        <div key={item.key} className={`toast toast-${item.category}`} role="status">
          <button
            type="button"
            className="toast-body-btn"
            onClick={() => { onActivate(item.agentId); onDismiss(item.key); }}
            title={t('toasts.showAgent')}
          >
            <span className="toast-icon" aria-hidden="true">{CATEGORY_ICON[item.category]}</span>
            <span className="toast-text">
              <span className="toast-title">{item.title}</span>
              <span className="toast-message">{item.body}</span>
            </span>
          </button>
          <button
            type="button"
            className="toast-close"
            aria-label={t('common.dismiss')}
            title={t('common.dismiss')}
            onClick={() => onDismiss(item.key)}
          >×</button>
        </div>
      ))}
    </div>
  );
}
