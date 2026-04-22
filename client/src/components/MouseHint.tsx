import { useState } from 'react';
import './MouseHint.css';

const LS_KEY = 'ag-quest-mouse-hint-dismissed';

export function MouseHint() {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(LS_KEY) === '1'; } catch { return false; }
  });

  if (dismissed) return null;

  const onDismiss = (): void => {
    try { localStorage.setItem(LS_KEY, '1'); } catch { /* ignore */ }
    setDismissed(true);
  };

  return (
    <div className="mouse-hint" role="note" aria-label="Mouse controls">
      <button className="mouse-hint-close" onClick={onDismiss} aria-label="Dismiss">×</button>
      <div className="mouse-hint-row">
        <Mouse highlight="left" />
        <Arrow kind="tap" />
      </div>
      <div className="mouse-hint-row">
        <Mouse highlight="right" />
        <Arrow kind="drag" />
      </div>
    </div>
  );
}

function Mouse({ highlight }: { highlight: 'left' | 'right' }) {
  // 24×32 viewBox. Body is a rounded rectangle. Buttons are the top half
  // split left/right by a vertical separator through the scroll wheel.
  const leftFill = highlight === 'left' ? 'var(--hint-accent)' : 'transparent';
  const rightFill = highlight === 'right' ? 'var(--hint-accent)' : 'transparent';
  return (
    <svg className="mouse-hint-mouse" width="24" height="32" viewBox="0 0 24 32" aria-hidden>
      <rect x="1.5" y="1.5" width="21" height="29" rx="10.5" ry="10.5"
            fill="#1a1d28" stroke="#c9d1dc" strokeWidth="1.5" />
      <path d="M 1.5 12 A 10.5 10.5 0 0 1 12 1.5 L 12 12 Z" fill={leftFill} />
      <path d="M 22.5 12 A 10.5 10.5 0 0 0 12 1.5 L 12 12 Z" fill={rightFill} />
      <line x1="12" y1="1.5" x2="12" y2="12" stroke="#c9d1dc" strokeWidth="1.2" />
      <line x1="1.5" y1="12" x2="22.5" y2="12" stroke="#c9d1dc" strokeWidth="1.2" />
      <rect x="10.5" y="5.5" width="3" height="4" rx="1" fill="#c9d1dc" />
    </svg>
  );
}

function Arrow({ kind }: { kind: 'tap' | 'drag' }) {
  if (kind === 'tap') {
    // Concentric rings evoking a tap/pulse.
    return (
      <svg className="mouse-hint-action" width="24" height="24" viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="3" fill="var(--hint-accent)" />
        <circle cx="12" cy="12" r="7" fill="none" stroke="var(--hint-accent)" strokeWidth="1.5" opacity="0.55" />
        <circle cx="12" cy="12" r="11" fill="none" stroke="var(--hint-accent)" strokeWidth="1.2" opacity="0.25" />
      </svg>
    );
  }
  // 4-way arrows evoking pan/drag.
  return (
    <svg className="mouse-hint-action" width="24" height="24" viewBox="0 0 24 24" aria-hidden>
      <g fill="var(--hint-accent)">
        <polygon points="12,1 8,6 11,6 11,11 6,11 6,8 1,12 6,16 6,13 11,13 11,18 8,18 12,23 16,18 13,18 13,13 18,13 18,16 23,12 18,8 18,11 13,11 13,6 16,6" />
      </g>
    </svg>
  );
}
