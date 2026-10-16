import { version as currentVersion } from '../../../package.json';

const REPOSITORY = 'https://github.com/FulAppiOS/Agent-Quest';
const LATEST_RELEASE_API = 'https://api.github.com/repos/FulAppiOS/Agent-Quest/releases/latest';
const CACHE_MS = 6 * 60 * 60_000;
const RETRY_MS = 15 * 60_000;

export interface ReleaseUpdate {
  currentVersion: string;
  status: 'available' | 'up-to-date' | 'unavailable';
  release: { version: string; url: string; notes: string } | null;
}

// Stable release tags are vMAJOR.MINOR.PATCH (or without v). Accept valid
// prerelease/build suffixes locally so a stable release supersedes its beta.
const VERSION = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

export function isNewerStableVersion(candidate: string, installed: string): boolean {
  const next = VERSION.exec(candidate);
  const local = VERSION.exec(installed);
  if (!next || !local || next[4]) return false;
  for (let i = 1; i <= 3; i++) {
    const a = Number(next[i]);
    const b = Number(local[i]);
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return false;
    if (a !== b) return a > b;
  }
  return Boolean(local[4]);
}

/** Lazy, shared cache: opening more tabs never multiplies GitHub requests. */
export function createUpdateChecker({
  installedVersion = currentVersion,
  fetchRelease = (url: string, init: RequestInit) => fetch(url, init),
  now = Date.now,
}: {
  installedVersion?: string;
  fetchRelease?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
} = {}) {
  let cached: ReleaseUpdate | null = null;
  let expiresAt = 0;
  let pending: Promise<ReleaseUpdate> | null = null;

  async function check(): Promise<ReleaseUpdate> {
    let result: ReleaseUpdate = { currentVersion: installedVersion, status: 'unavailable', release: null };
    try {
      const response = await fetchRelease(LATEST_RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Agent-Quest-update-check' },
        signal: AbortSignal.timeout(5_000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('Release lookup unavailable');
      const release: unknown = await response.json();
      if (!release || typeof release !== 'object') throw new Error('Invalid release');
      const data = release as Record<string, unknown>;
      if (data.draft !== false || data.prerelease !== false || typeof data.tag_name !== 'string') {
        throw new Error('Not a stable release');
      }
      const parsed = VERSION.exec(data.tag_name);
      if (!parsed || parsed[4]) throw new Error('Invalid release version');
      const newer = isNewerStableVersion(data.tag_name, installedVersion);
      result = {
        currentVersion: installedVersion,
        status: newer ? 'available' : 'up-to-date',
        release: newer ? {
          version: data.tag_name.replace(/^v/, ''),
          url: `${REPOSITORY}/releases/tag/${encodeURIComponent(data.tag_name)}`,
          notes: typeof data.body === 'string' ? data.body.slice(0, 20_000) : '',
        } : null,
      };
    } catch {
      // Offline, rate-limited, timeout, missing release, or invalid response:
      // never prevent the dashboard from starting and never claim it's current.
    }
    cached = result;
    expiresAt = now() + (result.status === 'unavailable' ? RETRY_MS : CACHE_MS);
    return result;
  }

  return function getUpdate(): Promise<ReleaseUpdate> {
    if (cached && now() < expiresAt) return Promise.resolve(cached);
    if (!pending) pending = check().finally(() => { pending = null; });
    return pending;
  };
}
