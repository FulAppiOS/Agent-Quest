import { useEffect, useState } from 'react';
import './NoInstallBanner.css';
import { isDismissed, setDismissed, resetDismissal } from './noInstallBannerStorage';

interface Props {
  /** null until the first snapshot arrives; empty array means nothing was discovered. */
  configDirs: string[] | null;
  connected: boolean;
}

/**
 * Full-width banner shown when the WebSocket is connected AND the server
 * reported zero config dirs across both providers. Disambiguates the two
 * empty-village states:
 *   - "Neither Claude Code nor Codex is installed"  → this banner
 *   - "At least one provider is installed but idle" → no banner
 * Dismiss is persisted (with one-time migration from the old Claude-only key)
 * so returning users don't see it every load.
 */
export function NoInstallBanner({ configDirs, connected }: Props) {
  const [dismissed, setDismissedState] = useState<boolean>(() => isDismissed());

  // Reset dismissal if a config dir appears later (user installed Claude Code
  // or Codex while the dashboard was open) — don't bury a helpful banner forever.
  useEffect(() => {
    if (configDirs !== null && configDirs.length > 0 && dismissed) {
      resetDismissal();
    }
  }, [configDirs, dismissed]);

  if (!connected) return null;
  if (configDirs === null) return null;
  if (configDirs.length > 0) return null;
  if (dismissed) return null;

  const onDismiss = () => {
    setDismissedState(true);
    setDismissed();
  };

  return (
    <div className="no-install-banner" role="alert">
      <span className="no-install-icon" aria-hidden>⚠</span>
      <div className="no-install-body">
        <div className="no-install-title">No Claude Code or Codex installation detected</div>
        <div className="no-install-text">
          The server found no <code>~/.claude*</code> or <code>~/.codex</code> directory with session logs.
          {' '}Start a Claude Code or Codex session to see heroes appear here.
        </div>
      </div>
      <button
        className="no-install-dismiss"
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
