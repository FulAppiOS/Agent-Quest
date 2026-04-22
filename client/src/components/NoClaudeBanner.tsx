import { useEffect, useState } from 'react';
import './NoClaudeBanner.css';

const DISMISS_KEY = 'agent-quest:no-claude-dismissed';

interface Props {
  /** null until the first snapshot arrives; empty array means nothing was discovered. */
  configDirs: string[] | null;
  connected: boolean;
}

/**
 * Full-width banner shown when the WebSocket is connected AND the server
 * reported zero `~/.claude*` config dirs. This disambiguates two states
 * that are otherwise indistinguishable in the empty village:
 *   - "Claude Code not installed at all"   → this banner
 *   - "Claude installed but no sessions"   → no banner, empty village is fine
 * Dismiss is persisted so returning users don't see it every load.
 */
export function NoClaudeBanner({ configDirs, connected }: Props) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  // Reset dismissal if a config dir appears later (user installed Claude Code
  // while the dashboard was open) — don't bury a helpful banner forever.
  useEffect(() => {
    if (configDirs !== null && configDirs.length > 0 && dismissed) {
      try { localStorage.removeItem(DISMISS_KEY); } catch {}
    }
  }, [configDirs, dismissed]);

  if (!connected) return null;
  if (configDirs === null) return null;
  if (configDirs.length > 0) return null;
  if (dismissed) return null;

  const onDismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
  };

  return (
    <div className="no-claude-banner" role="alert">
      <span className="no-claude-icon" aria-hidden>⚠</span>
      <div className="no-claude-body">
        <div className="no-claude-title">No Claude Code installation detected</div>
        <div className="no-claude-text">
          The server found no <code>~/.claude*</code> directory with session logs.
          {' '}
          <a
            href="https://claude.ai/code"
            target="_blank"
            rel="noopener noreferrer"
            className="no-claude-link"
          >
            Install Claude Code
          </a>
          {' '}and start a session — heroes will appear here automatically.
        </div>
      </div>
      <button
        className="no-claude-dismiss"
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
