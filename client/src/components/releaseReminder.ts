export const RELEASE_REMINDER_KEY = 'agentquest:release-reminder';
export const REMIND_AFTER_MS = 24 * 60 * 60_000;

export interface ReleaseReminder { version: string; until: number }

export function parseReminder(raw: string | null): ReleaseReminder | null {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (value && typeof value === 'object' && 'version' in value && 'until' in value
      && typeof value.version === 'string' && typeof value.until === 'number'
      && Number.isFinite(value.until)) {
      return { version: value.version, until: value.until };
    }
  } catch { /* Corrupt storage should not hide an update. */ }
  return null;
}

export function isReleaseSnoozed(reminder: ReleaseReminder | null, version: string, now = Date.now()): boolean {
  return reminder?.version === version && reminder.until > now;
}
