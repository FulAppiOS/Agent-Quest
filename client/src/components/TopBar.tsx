import { useEffect, useRef, useState } from 'react';
import type { AgentState } from '../types/agent';
import { eventBridge } from '../game/EventBridge';
import { NotificationMenu, type NotificationEntry } from './NotificationMenu';
import { ContextDropdown } from './ContextDropdown';
import { useI18n } from '../i18n';
import './TopBar.css';

interface TopBarNotifications {
  entries: NotificationEntry[];
  unread: number;
  open: boolean;
  onToggle: () => void;
  onActivate: (agentId: string) => void;
  onClear: () => void;
}

interface TopBarProps {
  agents: AgentState[];
  connected: boolean;
  notifications: TopBarNotifications;
}

export function TopBar({ agents, connected, notifications }: TopBarProps) {
  const { t } = useI18n();
  const active = agents.filter((a) => a.status === 'active').length;
  const waiting = agents.filter((a) => a.status === 'waiting').length;
  const idle = agents.filter((a) => a.status === 'idle').length;
  const completed = agents.filter((a) => a.status === 'completed').length;
  const errors = agents.filter((a) => a.status === 'error').length;

  const [nightOn, setNightOn] = useState(false);
  const [rainOn, setRainOn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [ctxOpen, setCtxOpen] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);

  const toggleNight = () => {
    const next = !nightOn;
    setNightOn(next);
    eventBridge.emit('effect:night:toggle', next);
  };

  const toggleRain = () => {
    const next = !rainOn;
    setRainOn(next);
    eventBridge.emit('effect:rain:toggle', next);
  };

  const closeMenu = () => {
    setMenuOpen(false);
    hamburgerRef.current?.focus();
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        hamburgerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 641px)');
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setMenuOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return (
    <>
      <header className="topbar" data-menu-open={menuOpen}>
        <button
          type="button"
          className="topbar-logo-button"
          onClick={() => eventBridge.emit('tutorial:open')}
          title={t('topbar.showTutorial')}
          aria-label={t('topbar.showTutorial')}
        >
          <img src="assets/logo.png" alt="Agent Quest" className="topbar-logo" />
        </button>

        <span
          className={`topbar-status-dot ${connected ? 'online' : 'offline'}`}
          role="status"
          aria-label={connected ? t('topbar.online') : t('topbar.offline')}
          title={connected ? t('topbar.online') : t('topbar.offline')}
        />

        <div
          id="topbar-tools"
          className="topbar-tools"
          role="region"
          aria-label={t('topbar.menuRegion')}
        >
          <div className="topbar-stats">
            <div className="topbar-stat">
              <span className="topbar-stat-label">{t('topbar.status')}</span>
              <span className={`topbar-stat-value ${connected ? 'active' : 'error'}`}>
                {connected ? t('topbar.online') : t('topbar.offline')}
              </span>
            </div>
            <div className="topbar-stat">
              <span className="topbar-stat-label">{t('topbar.active')}</span>
              <span className="topbar-stat-value active">{active}</span>
            </div>
            {waiting > 0 && (
              <div className="topbar-stat">
                <span className="topbar-stat-label">{t('topbar.waiting')}</span>
                <span className="topbar-stat-value waiting">{waiting}</span>
              </div>
            )}
            <div className="topbar-stat">
              <span className="topbar-stat-label">{t('topbar.idle')}</span>
              <span className="topbar-stat-value idle">{idle}</span>
            </div>
            <div className="topbar-stat">
              <span className="topbar-stat-label">{t('topbar.done')}</span>
              <span className="topbar-stat-value">{completed}</span>
            </div>
            {errors > 0 && (
              <div className="topbar-stat">
                <span className="topbar-stat-label">{t('topbar.errors')}</span>
                <span className="topbar-stat-value error">{errors}</span>
              </div>
            )}
            <div className="topbar-stat">
              <span className="topbar-stat-label">{t('topbar.total')}</span>
              <span className="topbar-stat-value">{agents.length}</span>
            </div>
            <ContextDropdown
              agents={agents}
              open={ctxOpen}
              onToggle={() => setCtxOpen((v) => !v)}
              onSelect={(id) => eventBridge.emit('hero:clicked', id)}
            />
          </div>

          <div className="topbar-effects">
            <NotificationMenu
              entries={notifications.entries}
              unread={notifications.unread}
              open={notifications.open}
              onToggle={notifications.onToggle}
              onActivate={notifications.onActivate}
              onClear={notifications.onClear}
            />
            <button
              className={`topbar-effect-btn ${nightOn ? 'active' : ''}`}
              onClick={toggleNight}
              title={nightOn ? t('topbar.dayMode') : t('topbar.nightMode')}
            >
              {nightOn ? '\u{1F319}' : '\u{2600}\u{FE0F}'}
            </button>
            <button
              className={`topbar-effect-btn ${rainOn ? 'active' : ''}`}
              onClick={toggleRain}
              title={rainOn ? t('topbar.stopRain') : t('topbar.startRain')}
            >
              {'\u{1F327}\u{FE0F}'}
            </button>
            <a
              className="topbar-effect-btn"
              data-mobile-hide="true"
              href="/?mode=editor"
              target="_blank"
              rel="noopener"
              title={t('topbar.openMapEditor')}
              style={{ textDecoration: 'none' }}
            >
              {'\u{1F5FA}\u{FE0F}'}
            </a>
            <button
              className="topbar-effect-btn topbar-skills-btn"
              onClick={() => eventBridge.emit('skills:open')}
              title={t('topbar.skillsTitle')}
              aria-label={t('topbar.skillsLabel')}
            >
              {'\u2726'}
            </button>
            <button
              className="topbar-effect-btn"
              onClick={() => eventBridge.emit('settings:open')}
              title={t('topbar.settings')}
              aria-label={t('topbar.settings')}
            >
              {'\u{2699}\u{FE0F}'}
            </button>
            <button
              className="topbar-effect-btn"
              onClick={() => eventBridge.emit('tutorial:open')}
              title={t('topbar.showTutorial')}
            >
              {'\u{2753}'}
            </button>
          </div>
        </div>

        <button
          ref={hamburgerRef}
          type="button"
          className="topbar-menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="topbar-tools"
          aria-label={menuOpen ? t('topbar.closeMenu') : t('topbar.openMenu')}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="topbar-menu-toggle-bar" />
          <span className="topbar-menu-toggle-bar" />
          <span className="topbar-menu-toggle-bar" />
        </button>
      </header>

      {menuOpen && <div className="topbar-overlay" onClick={closeMenu} aria-hidden="true" />}
    </>
  );
}
