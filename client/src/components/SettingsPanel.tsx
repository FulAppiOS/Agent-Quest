import { useCallback, useEffect, useState } from 'react';
import type { AppSettings } from '../hooks/useSettings';
import { SERVER_URL } from '../config';
import { playChime } from '../notifications/sound';
import { useI18n } from '../i18n';
import { LanguageSettings } from './LanguageSettings';
import './SettingsPanel.css';

interface SettingsPanelProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
}

type PermissionState = 'unsupported' | 'default' | 'granted' | 'denied';

function readPermission(): PermissionState {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as PermissionState;
}

/** Small reusable on/off switch — label on the left, toggle on the right. */
function Toggle({
  label,
  hint,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <label className={`settings-toggle ${disabled === true ? 'is-disabled' : ''}`}>
      <span className="settings-toggle-text">
        <span className="settings-toggle-label">{label}</span>
        {hint !== undefined && <span className="settings-toggle-hint">{hint}</span>}
      </span>
      <span className="settings-switch">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="settings-switch-track" aria-hidden="true" />
      </span>
    </label>
  );
}

interface HookStatus {
  installed: boolean;
  anyInstalled: boolean;
  configDirs: string[];
}

interface HookUiState {
  loading: boolean;
  status: HookStatus | null;
  error: string | null;
  busy: boolean;
}

export function SettingsPanel({ settings, onChange, onClose }: SettingsPanelProps) {
  const { t } = useI18n();
  const [permission, setPermission] = useState<PermissionState>(() => readPermission());
  const [hook, setHook] = useState<HookUiState>({ loading: true, status: null, error: null, busy: false });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Keep the permission state in sync with the browser — including changes the
  // user makes in the site settings while the panel is open. Without this, once
  // the permission was 'denied' the "blocked" message would never clear even
  // after the user allowed notifications, because we'd never re-read it.
  useEffect(() => {
    setPermission(readPermission());
    const perms = typeof navigator !== 'undefined' ? navigator.permissions : undefined;
    if (perms?.query === undefined) return;
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const toState = (s: string): PermissionState => (s === 'prompt' ? 'default' : (s as PermissionState));
    // Safari doesn't support querying the 'notifications' permission and may
    // throw synchronously here (not just reject) — wrap the whole call so we
    // fall back cleanly to the direct Notification.permission read above.
    try {
      perms.query({ name: 'notifications' as PermissionName }).then((st) => {
        if (cancelled) { return; }
        status = st;
        setPermission(toState(st.state));
        st.onchange = () => setPermission(toState(st.state));
      }).catch(() => { /* not queryable — fall back to readPermission */ });
    } catch { /* Safari: query('notifications') unsupported — fall back */ }
    return () => { cancelled = true; if (status !== null) status.onchange = null; };
  }, []);

  const sendTestNotification = useCallback(() => {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Agent Quest', { body: `${t('settings.testBody')} \u{1F514}`, tag: 'agentquest:test' });
      }
    } catch { /* ignore */ }
    if (settings.soundEnabled) playChime('waiting', settings.volume);
  }, [settings.soundEnabled, settings.volume, t]);

  const refreshHook = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/hooks/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Record<string, unknown>;
      setHook((h) => ({
        ...h,
        loading: false,
        error: null,
        status: {
          installed: data.installed === true,
          anyInstalled: data.anyInstalled === true,
          configDirs: Array.isArray(data.configDirs) ? (data.configDirs as string[]) : [],
        },
      }));
    } catch (e) {
      setHook((h) => ({ ...h, loading: false, error: (e as Error).message }));
    }
  }, []);

  useEffect(() => { void refreshHook(); }, [refreshHook]);

  const setHookEnabled = useCallback(async (enable: boolean) => {
    setHook((h) => ({ ...h, busy: true, error: null }));
    try {
      const res = await fetch(`${SERVER_URL}/api/hooks/${enable ? 'install' : 'uninstall'}`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setHook((h) => ({ ...h, error: (e as Error).message }));
    } finally {
      setHook((h) => ({ ...h, busy: false }));
      await refreshHook();
    }
  }, [refreshHook]);

  // Enabling notifications needs the browser's permission. Ask for it the moment
  // the user flips the master switch on; reflect the outcome in the hint below.
  const handleNotificationsToggle = (next: boolean) => {
    onChange({ notificationsEnabled: next });
    // Re-request whenever we don't already have it. On 'default' the browser
    // prompts; on 'denied' it resolves immediately without a prompt (harmless),
    // and the Permissions API subscription will reflect any later change.
    if (next && permission !== 'granted' && permission !== 'unsupported' && typeof Notification !== 'undefined') {
      void Notification.requestPermission().then((p) => setPermission(p as PermissionState));
    }
  };

  const notifyOn = settings.notificationsEnabled;
  const permissionBlocked = notifyOn && permission === 'denied';
  // The category toggles ("which events do I care about") gate both channels,
  // so they stay live as long as at least one channel — desktop or sound — is on.
  const anyChannel = settings.notificationsEnabled || settings.soundEnabled || settings.inAppToasts;

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('settings.title')}>
        <button className="settings-close" onClick={onClose} title={t('common.closeEsc')}>×</button>

        <h2 className="settings-title">{t('settings.title')}</h2>

        <LanguageSettings />

        <div className="settings-section-label">{t('settings.notifications')}</div>
        <Toggle
          label={t('settings.desktopNotifications')}
          hint={t('settings.desktopNotificationsHint')}
          checked={notifyOn}
          onToggle={handleNotificationsToggle}
        />
        {permissionBlocked && (
          <p className="settings-warn">
            {t('settings.permissionBlocked')}
          </p>
        )}
        {notifyOn && permission === 'unsupported' && (
          <p className="settings-warn">
            {t('settings.unsupported')}
          </p>
        )}
        {notifyOn && permission === 'granted' && (
          <div className="settings-row">
            <span className="settings-muted">{t('settings.allowed')}</span>
            <button className="settings-btn" onClick={sendTestNotification}>{t('settings.sendTest')}</button>
          </div>
        )}
        <Toggle
          label={t('settings.inAppToasts')}
          hint={t('settings.inAppToastsHint')}
          checked={settings.inAppToasts}
          onToggle={(v) => onChange({ inAppToasts: v })}
        />

        <div className="settings-hint-block settings-hook-blurb">
          <strong>{t('settings.hookTitle')}</strong>{t('settings.hookBlurbBefore')}<code>Stop</code>{t('settings.hookBlurbMiddle')}<code>settings.json</code>{t('settings.hookBlurbAfter')}
        </div>
        {hook.loading ? (
          <p className="settings-muted">{t('settings.checking')}</p>
        ) : hook.status === null ? (
          <p className="settings-warn">{t('settings.serverUnreachable', { detail: hook.error !== null ? `: ${hook.error}` : '' })}</p>
        ) : hook.status.configDirs.length === 0 ? (
          <p className="settings-muted">{t('settings.noInstall')}</p>
        ) : (
          <>
            <div className="settings-hook">
              <span className={`settings-hook-state ${hook.status.installed ? 'on' : ''}`}>
                {hook.status.installed ? t('settings.hookOn') : hook.status.anyInstalled ? t('settings.hookPartial') : t('settings.hookOff')}
              </span>
              <button
                className="settings-btn"
                disabled={hook.busy}
                onClick={() => { void setHookEnabled(!hook.status!.installed); }}
              >
                {hook.busy ? '…' : hook.status.installed ? t('settings.disable') : t('settings.enable')}
              </button>
            </div>
            {hook.status.anyInstalled && (
              <p className="settings-muted">
                {t('settings.restartHint')}
              </p>
            )}
            {hook.error !== null && <p className="settings-warn">{hook.error}</p>}
          </>
        )}

        <div className="settings-subgroup" data-dim={!anyChannel}>
          <Toggle
            label={t('settings.turnFinished')}
            hint={t('settings.turnFinishedHint')}
            checked={settings.notifyWaiting}
            disabled={!anyChannel}
            onToggle={(v) => onChange({ notifyWaiting: v })}
          />
          <Toggle
            label={t('settings.errors')}
            hint={t('settings.errorsHint')}
            checked={settings.notifyError}
            disabled={!anyChannel}
            onToggle={(v) => onChange({ notifyError: v })}
          />
          <Toggle
            label={t('settings.sessionCompleted')}
            hint={t('settings.sessionCompletedHint')}
            checked={settings.notifyCompleted}
            disabled={!anyChannel}
            onToggle={(v) => onChange({ notifyCompleted: v })}
          />
          <Toggle
            label={t('settings.contextNearlyFull')}
            hint={t('settings.contextNearlyFullHint')}
            checked={settings.notifyContext}
            disabled={!anyChannel}
            onToggle={(v) => onChange({ notifyContext: v })}
          />
        </div>

        <div className="settings-section-label">{t('settings.map')}</div>
        <Toggle
          label={t('settings.contextBars')}
          hint={t('settings.contextBarsHint')}
          checked={settings.showContextBars}
          onToggle={(v) => onChange({ showContextBars: v })}
        />

        <div className="settings-section-label">{t('settings.sound')}</div>
        <Toggle
          label={t('settings.playSound')}
          hint={t('settings.playSoundHint')}
          checked={settings.soundEnabled}
          onToggle={(v) => onChange({ soundEnabled: v })}
        />
        <div className="settings-row" data-dim={!settings.soundEnabled}>
          <span className="settings-toggle-label">{t('settings.volume')}</span>
          <input
            className="settings-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            disabled={!settings.soundEnabled}
            onChange={(e) => onChange({ volume: Number(e.target.value) })}
            aria-label={t('settings.volumeLabel')}
          />
          <span className="settings-volume-value">{Math.round(settings.volume * 100)}%</span>
        </div>

        <div className="settings-section-label">{t('settings.doNotDisturb')}</div>
        <Toggle
          label={t('settings.muteEverything')}
          hint={t('settings.muteEverythingHint')}
          checked={settings.doNotDisturb}
          onToggle={(v) => onChange({ doNotDisturb: v })}
        />

        <p className="settings-foot">
          {t('settings.footer')}
        </p>
      </div>
    </div>
  );
}
