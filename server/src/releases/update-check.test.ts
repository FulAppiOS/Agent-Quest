import { describe, expect, it } from 'bun:test';
import { createUpdateChecker, isNewerStableVersion } from './update-check';

const release = (overrides = {}) => ({ tag_name: 'v0.4.0', draft: false, prerelease: false, body: 'New features', ...overrides });

describe('stable release comparison', () => {
  it('compares numbers, ignores build metadata, and never downgrades', () => {
    expect(isNewerStableVersion('v0.10.0', '0.9.0')).toBe(true);
    expect(isNewerStableVersion('1.0.0', '0.99.99')).toBe(true);
    expect(isNewerStableVersion('v0.3.1', '0.3.0')).toBe(true);
    expect(isNewerStableVersion('v0.3.0', '0.3.0')).toBe(false);
    expect(isNewerStableVersion('v0.3.0', '0.4.0')).toBe(false);
    expect(isNewerStableVersion('v0.3.0+build.2', '0.3.0+build.1')).toBe(false);
    expect(isNewerStableVersion('v0.3.0', '0.3.0-beta.1')).toBe(true);
  });

  it('rejects preview releases and malformed versions', () => {
    for (const version of ['0.4.0-beta.1', 'latest', 'v04.0.0', '0.4', '0.4.0/path']) {
      expect(isNewerStableVersion(version, '0.3.0')).toBe(false);
    }
    expect(isNewerStableVersion('v0.4.0', 'unknown')).toBe(false);
  });
});

describe('release checker', () => {
  it('returns notes and a repository-scoped link, caches and deduplicates requests', async () => {
    let calls = 0;
    let time = 0;
    const check = createUpdateChecker({
      installedVersion: '0.3.0', now: () => time,
      fetchRelease: async (url, init) => {
        calls++;
        expect(url).toBe('https://api.github.com/repos/FulAppiOS/Agent-Quest/releases/latest');
        expect(init.signal).toBeInstanceOf(AbortSignal);
        return Response.json(release({ html_url: 'https://untrusted.example' }));
      },
    });
    const results = await Promise.all([check(), check(), check()]);
    expect(calls).toBe(1);
    expect(results[0]).toEqual({
      currentVersion: '0.3.0', status: 'available',
      release: { version: '0.4.0', notes: 'New features', url: 'https://github.com/FulAppiOS/Agent-Quest/releases/tag/v0.4.0' },
    });
    await check();
    expect(calls).toBe(1);
    time = 6 * 60 * 60_000;
    await check();
    expect(calls).toBe(2);
  });

  it('does not notify equal or newer installations', async () => {
    for (const installedVersion of ['0.4.0', '0.5.0']) {
      const check = createUpdateChecker({ installedVersion, fetchRelease: async () => Response.json(release()) });
      expect(await check()).toEqual({ currentVersion: installedVersion, status: 'up-to-date', release: null });
    }
  });

  it('ignores drafts, prereleases, malformed payloads and invalid tags', async () => {
    for (const payload of [null, [], release({ draft: true }), release({ prerelease: true }), release({ tag_name: 'v0.5.0-beta.1' }), release({ tag_name: 'latest' })]) {
      const check = createUpdateChecker({ fetchRelease: async () => Response.json(payload) });
      expect((await check()).status).toBe('unavailable');
      expect((await check()).release).toBeNull();
    }
  });

  it('silently handles offline, timeouts, rate limits, missing releases and invalid JSON, then retries', async () => {
    for (const failure of [
      async () => { throw new TypeError('offline'); },
      async () => { throw new DOMException('timeout', 'TimeoutError'); },
      async () => new Response('', { status: 403 }),
      async () => new Response('', { status: 429 }),
      async () => new Response('', { status: 404 }),
      async () => new Response('invalid json'),
    ]) {
      let time = 0;
      let calls = 0;
      const check = createUpdateChecker({ installedVersion: '0.3.0', now: () => time, fetchRelease: async () => {
        calls++;
        return calls === 1 ? failure() : Response.json(release());
      } });
      expect((await check()).status).toBe('unavailable');
      await check();
      expect(calls).toBe(1);
      time = 15 * 60_000;
      expect((await check()).status).toBe('available');
      expect(calls).toBe(2);
    }
  });

  it('tolerates empty notes and bounds large release notes', async () => {
    const empty = createUpdateChecker({ installedVersion: '0.3.1', fetchRelease: async () => Response.json(release({ body: null })) });
    expect((await empty()).release?.notes).toBe('');
    const large = createUpdateChecker({ installedVersion: '0.3.1', fetchRelease: async () => Response.json(release({ body: 'x'.repeat(30_000) })) });
    expect((await large()).release?.notes).toHaveLength(20_000);
  });
});
