import { useEffect, useState } from 'react';
import type { AppSettings } from '../hooks/useSettings';
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

export function SettingsPanel({ settings, onChange, onClose }: SettingsPanelProps) {
  const [permission, setPermission] = useState<PermissionState>(() => readPermission());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Enabling notifications needs the browser's permission. Ask for it the moment
  // the user flips the master switch on; reflect the outcome in the hint below.
  const handleNotificationsToggle = (next: boolean) => {
    onChange({ notificationsEnabled: next });
    if (next && permission === 'default' && typeof Notification !== 'undefined') {
      void Notification.requestPermission().then((p) => setPermission(p as PermissionState));
    }
  };

  const notifyOn = settings.notificationsEnabled;
  const permissionBlocked = notifyOn && permission === 'denied';
  // The category toggles ("which events do I care about") gate both channels,
  // so they stay live as long as at least one channel — desktop or sound — is on.
  const anyChannel = settings.notificationsEnabled || settings.soundEnabled;

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <button className="settings-close" onClick={onClose} title="Close (Esc)">×</button>

        <h2 className="settings-title">Settings</h2>

        <div className="settings-section-label">Notifications</div>
        <Toggle
          label="Desktop notifications"
          hint="Alert me when an agent needs me or finishes"
          checked={notifyOn}
          onToggle={handleNotificationsToggle}
        />
        {permissionBlocked && (
          <p className="settings-warn">
            Notifications are blocked by your browser. Enable them for this site in the
            browser's site settings, then toggle this back on.
          </p>
        )}
        {notifyOn && permission === 'unsupported' && (
          <p className="settings-warn">
            This browser doesn't support desktop notifications — sounds will still work.
          </p>
        )}

        <div className="settings-subgroup" data-dim={!anyChannel}>
          <Toggle
            label="Turn finished"
            hint="Agent finished its turn and is waiting for you"
            checked={settings.notifyWaiting}
            disabled={!anyChannel}
            onToggle={(v) => onChange({ notifyWaiting: v })}
          />
          <Toggle
            label="Errors"
            hint="Agent hit an error"
            checked={settings.notifyError}
            disabled={!anyChannel}
            onToggle={(v) => onChange({ notifyError: v })}
          />
          <Toggle
            label="Session completed"
            hint="Agent session ended"
            checked={settings.notifyCompleted}
            disabled={!anyChannel}
            onToggle={(v) => onChange({ notifyCompleted: v })}
          />
        </div>

        <div className="settings-section-label">Sound</div>
        <Toggle
          label="Play a sound"
          hint="Chime alongside notifications"
          checked={settings.soundEnabled}
          onToggle={(v) => onChange({ soundEnabled: v })}
        />
        <div className="settings-row" data-dim={!settings.soundEnabled}>
          <span className="settings-toggle-label">Volume</span>
          <input
            className="settings-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            disabled={!settings.soundEnabled}
            onChange={(e) => onChange({ volume: Number(e.target.value) })}
            aria-label="Notification volume"
          />
          <span className="settings-volume-value">{Math.round(settings.volume * 100)}%</span>
        </div>

        <div className="settings-section-label">Do not disturb</div>
        <Toggle
          label="Mute everything"
          hint="Temporarily silence all notifications and sounds"
          checked={settings.doNotDisturb}
          onToggle={(v) => onChange({ doNotDisturb: v })}
        />

        <p className="settings-foot">
          Preferences are saved locally in this browser. Nothing is uploaded.
        </p>
      </div>
    </div>
  );
}
