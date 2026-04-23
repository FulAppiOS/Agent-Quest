export const OLD_DISMISS_KEY = 'agent-quest:no-claude-dismissed';
export const NEW_DISMISS_KEY = 'agent-quest:no-install-dismissed';

/**
 * Has the user dismissed the empty-state banner? Reads the new key and, on
 * the first call after an upgrade, migrates a pre-existing value from the
 * old Claude-only key so returning users don't see the banner reappear.
 */
export function isDismissed(): boolean {
  try {
    const current = localStorage.getItem(NEW_DISMISS_KEY);
    if (current === '1') {
      // Clean up any lingering old key.
      localStorage.removeItem(OLD_DISMISS_KEY);
      return true;
    }
    const legacy = localStorage.getItem(OLD_DISMISS_KEY);
    if (legacy === '1') {
      localStorage.setItem(NEW_DISMISS_KEY, '1');
      localStorage.removeItem(OLD_DISMISS_KEY);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function setDismissed(): void {
  try { localStorage.setItem(NEW_DISMISS_KEY, '1'); } catch {}
}

export function resetDismissal(): void {
  try { localStorage.removeItem(NEW_DISMISS_KEY); } catch {}
  try { localStorage.removeItem(OLD_DISMISS_KEY); } catch {}
}
