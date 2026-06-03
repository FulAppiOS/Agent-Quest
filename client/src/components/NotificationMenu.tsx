import { useEffect, useRef } from 'react';
import type { ToastPayload } from '../hooks/useAgentNotifications';
import './NotificationMenu.css';

export interface NotificationEntry extends ToastPayload {
  /** Monotonic id (also the React key). */
  id: number;
  /** When it fired (ms). */
  timestamp: number;
}

interface NotificationMenuProps {
  entries: NotificationEntry[];
  unread: number;
  open: boolean;
  onToggle: () => void;
  onActivate: (agentId: string) => void;
  onClear: () => void;
}

const CATEGORY_ICON: Record<ToastPayload['category'], string> = {
  waiting: '\u{1F514}',
  error: '\u{26A0}\u{FE0F}',
  completed: '\u{2705}',
};

function relativeTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

/**
 * Notification center: a bell in the Top Bar with an unread badge, opening a
 * dropdown history of recent alerts (kept even after their toasts are
 * dismissed). Each row jumps to the agent. Subagent alerts never reach here —
 * they're suppressed upstream — so this stays a main-agent activity log.
 */
export function NotificationMenu({ entries, unread, open, onToggle, onActivate, onClear }: NotificationMenuProps) {
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside-click / Escape while open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current !== null && !wrapRef.current.contains(e.target as Node)) onToggle();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onToggle(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onToggle]);

  return (
    <div className="notif-menu" ref={wrapRef}>
      <button
        type="button"
        className="topbar-effect-btn notif-bell"
        onClick={onToggle}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        title="Notifications"
      >
        {'\u{1F514}'}
        {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-dropdown" role="dialog" aria-label="Recent notifications">
          <div className="notif-dropdown-header">
            <span>Notifications</span>
            {entries.length > 0 && (
              <button type="button" className="notif-clear" onClick={onClear}>Clear</button>
            )}
          </div>
          {entries.length === 0 ? (
            <div className="notif-empty">No notifications yet.</div>
          ) : (
            <ul className="notif-list">
              {entries.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className={`notif-item notif-${e.category}`}
                    onClick={() => { onActivate(e.agentId); onToggle(); }}
                  >
                    <span className="notif-item-icon" aria-hidden="true">{CATEGORY_ICON[e.category]}</span>
                    <span className="notif-item-text">
                      <span className="notif-item-title">{e.title}</span>
                      <span className="notif-item-body">{e.body}</span>
                    </span>
                    <span className="notif-item-time">{relativeTime(e.timestamp)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
