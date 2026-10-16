import { expect, it } from 'bun:test';
import { isReleaseSnoozed, parseReminder, REMIND_AFTER_MS } from './releaseReminder';

it('remembers a release for 24 hours across reloads without hiding later releases', () => {
  const now = 1_000;
  const saved = JSON.stringify({ version: '0.4.0', until: now + REMIND_AFTER_MS });
  expect(isReleaseSnoozed(parseReminder(saved), '0.4.0', now)).toBe(true);
  expect(isReleaseSnoozed(parseReminder(saved), '0.5.0', now)).toBe(false);
  expect(isReleaseSnoozed(parseReminder(saved), '0.4.0', now + REMIND_AFTER_MS)).toBe(false);
});

it('does not hide updates when stored preferences are missing or corrupted', () => {
  for (const raw of [null, '', '{', 'null', '[]', '{"version":123,"until":5000}', '{"version":"0.4.0","until":"5000"}', '{"version":"0.4.0","until":1e999}']) {
    expect(parseReminder(raw)).toBeNull();
    expect(isReleaseSnoozed(parseReminder(raw), '0.4.0', 1_000)).toBe(false);
  }
});
