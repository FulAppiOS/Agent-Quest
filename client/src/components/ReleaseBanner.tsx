import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { SERVER_URL } from '../config';
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
    <section className="release-banner" aria-label="App update">
      <div className="release-banner-header">
        <p role="status"><strong>Agent Quest {release.version} is available</strong><span>You’re using {currentVersion}.</span></p>
        <button type="button" onClick={remindTomorrow}>Remind me tomorrow</button>
      </div>
      <details key={release.version} className="release-banner-details">
        <summary>What’s new &amp; how to update</summary>
        <h2>What’s new</h2>
        <div className="release-banner-notes">
          {release.notes.trim() ? (
            <ReactMarkdown skipHtml disallowedElements={['img']} components={{
              a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
            }}>{release.notes}</ReactMarkdown>
          ) : <p>No release notes were provided.</p>}
        </div>
        <a href={release.url} target="_blank" rel="noopener noreferrer">View release on GitHub ↗</a>
        <h2>Update manually</h2>
        <ol>
          <li>On the computer running Agent Quest, stop the app with <kbd>Ctrl+C</kbd> in its terminal.</li>
          <li>Run <code>agentquest update</code>.</li>
          <li>Start it again with <code>agentquest</code>, then refresh this page.</li>
        </ol>
        <p>Without the shortcut, open your Agent Quest folder and run:</p>
        <pre><code>{'git pull --ff-only && bun install\nbun start'}</code></pre>
        <p className="release-banner-hint">The updater follows main. If Git reports local changes or a conflict, keep your changes and resolve it before continuing. Nothing updates automatically.</p>
      </details>
    </section>
  );
}
