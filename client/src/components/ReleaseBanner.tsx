import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { SERVER_URL } from '../config';
import { useI18n } from '../i18n';
import { isReleaseSnoozed, parseReminder, RELEASE_REMINDER_KEY, REMIND_AFTER_MS, type ReleaseReminder } from './releaseReminder';
import './ReleaseBanner.css';

interface Update {
  currentVersion: string;
  release: { version: string; url: string; notes: string };
}

function readReminder(): ReleaseReminder | null {
  try { return parseReminder(localStorage.getItem(RELEASE_REMINDER_KEY)); } catch { return null; }
}

export function ReleaseBanner() {
  const { t } = useI18n();
  const [update, setUpdate] = useState<Update | null>(null);
  const [reminder, setReminder] = useState(readReminder);

  useEffect(() => {
    let disposed = false;
    let active: AbortController | null = null;
    async function check() {
      if (active) return;
      const controller = new AbortController();
      active = controller;
      const timeout = setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch(`${SERVER_URL}/api/updates`, { signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json();
        if (disposed) return;
        if (data.status === 'up-to-date') setUpdate(null);
        if (data.status === 'available' && typeof data.currentVersion === 'string'
          && typeof data.release?.version === 'string' && typeof data.release.notes === 'string'
          && typeof data.release.url === 'string'
          && data.release.url.startsWith('https://github.com/FulAppiOS/Agent-Quest/releases/tag/')) {
          setUpdate({ currentVersion: data.currentVersion, release: data.release });
        }
      } catch { /* Network failure must remain invisible to the user. */ }
      finally { clearTimeout(timeout); active = null; }
    }
    void check();
    // The server caches GitHub responses for six hours; retry sooner if offline.
    const interval = setInterval(() => { void check(); }, 15 * 60_000);
    const onOnline = () => { void check(); };
    window.addEventListener('online', onOnline);
    return () => {
      disposed = true;
      active?.abort();
      clearInterval(interval);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === RELEASE_REMINDER_KEY || event.key === null) setReminder(readReminder());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (!reminder) return;
    const remaining = reminder.until - Date.now();
    if (remaining <= 0) { setReminder(null); return; }
    // Clamp malformed timestamps to the maximum timeout supported by browsers.
    const timeout = setTimeout(() => setReminder(null), Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timeout);
  }, [reminder]);

  if (!update || isReleaseSnoozed(reminder, update.release.version)) return null;
  const { release, currentVersion } = update;

  function remindTomorrow() {
    const next = { version: release.version, until: Date.now() + REMIND_AFTER_MS };
    setReminder(next);
    try { localStorage.setItem(RELEASE_REMINDER_KEY, JSON.stringify(next)); } catch { /* Session-only fallback. */ }
  }

  return (
    <section className="release-banner" aria-label={t('release.ariaLabel')}>
      <div className="release-banner-header">
        <p role="status"><strong>{t('release.available', { version: release.version })}</strong><span>{t('release.current', { version: currentVersion })}</span></p>
        <button type="button" onClick={remindTomorrow}>{t('release.remindTomorrow')}</button>
      </div>
      <details key={release.version} className="release-banner-details">
        <summary>{t('release.summary')}</summary>
        <h2>{t('release.whatsNew')}</h2>
        <div className="release-banner-notes">
          {release.notes.trim() ? (
            <ReactMarkdown skipHtml disallowedElements={['img']} components={{
              a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
            }}>{release.notes}</ReactMarkdown>
          ) : <p>{t('release.noNotes')}</p>}
        </div>
        <a href={release.url} target="_blank" rel="noopener noreferrer">{t('release.viewOnGitHub')} ↗</a>
        <h2>{t('release.updateManually')}</h2>
        <ol>
          <li>{t('release.step1Before')}<kbd>Ctrl+C</kbd>{t('release.step1After')}</li>
          <li>{t('release.step2Before')}<code>agentquest update</code>{t('release.step2After')}</li>
          <li>{t('release.step3Before')}<code>agentquest</code>{t('release.step3After')}</li>
        </ol>
        <p>{t('release.withoutShortcut')}</p>
        <pre><code>{'git pull --ff-only && bun install\nbun start'}</code></pre>
        <p className="release-banner-hint">{t('release.hint')}</p>
      </details>
    </section>
  );
}
