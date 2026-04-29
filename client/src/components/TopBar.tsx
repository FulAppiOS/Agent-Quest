import { useEffect, useRef, useState } from 'react';
import type { AgentState } from '../types/agent';
import { eventBridge } from '../game/EventBridge';
import './TopBar.css';

interface TopBarProps {
  agents: AgentState[];
  connected: boolean;
}

export function TopBar({ agents, connected }: TopBarProps) {
  const active = agents.filter((a) => a.status === 'active').length;
  const idle = agents.filter((a) => a.status === 'idle').length;
  const completed = agents.filter((a) => a.status === 'completed').length;
  const errors = agents.filter((a) => a.status === 'error').length;

  const [nightOn, setNightOn] = useState(false);
  const [rainOn, setRainOn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
          title="Show tutorial"
          aria-label="Show tutorial"
        >
          <img src="assets/logo.png" alt="Agent Quest" className="topbar-logo" />
        </button>

        <span
          className={`topbar-status-dot ${connected ? 'online' : 'offline'}`}
          role="status"
          aria-label={connected ? 'Online' : 'Offline'}
          title={connected ? 'Online' : 'Offline'}
        />

        <div
          id="topbar-tools"
          className="topbar-tools"
          role="region"
          aria-label="Topbar menu"
        >
          <div className="topbar-stats">
            <div className="topbar-stat">
              <span className="topbar-stat-label">Status:</span>
              <span className={`topbar-stat-value ${connected ? 'active' : 'error'}`}>
                {connected ? 'Online' : 'Offline'}
              </span>
            </div>
            <div className="topbar-stat">
              <span className="topbar-stat-label">Active:</span>
              <span className="topbar-stat-value active">{active}</span>
            </div>
            <div className="topbar-stat">
              <span className="topbar-stat-label">Idle:</span>
              <span className="topbar-stat-value idle">{idle}</span>
            </div>
            <div className="topbar-stat">
              <span className="topbar-stat-label">Done:</span>
              <span className="topbar-stat-value">{completed}</span>
            </div>
            {errors > 0 && (
              <div className="topbar-stat">
                <span className="topbar-stat-label">Errors:</span>
                <span className="topbar-stat-value error">{errors}</span>
              </div>
            )}
            <div className="topbar-stat">
              <span className="topbar-stat-label">Total:</span>
              <span className="topbar-stat-value">{agents.length}</span>
            </div>
          </div>

          <div className="topbar-effects">
            <button
              className={`topbar-effect-btn ${nightOn ? 'active' : ''}`}
              onClick={toggleNight}
              title={nightOn ? 'Day mode' : 'Night mode'}
            >
              {nightOn ? '\u{1F319}' : '\u{2600}\u{FE0F}'}
            </button>
            <button
              className={`topbar-effect-btn ${rainOn ? 'active' : ''}`}
              onClick={toggleRain}
              title={rainOn ? 'Stop rain' : 'Start rain'}
            >
              {'\u{1F327}\u{FE0F}'}
            </button>
            <a
              className="topbar-effect-btn"
              data-mobile-hide="true"
              href="/?mode=editor"
              target="_blank"
              rel="noopener"
              title="Open Map Editor"
              style={{ textDecoration: 'none' }}
            >
              {'\u{1F5FA}\u{FE0F}'}
            </a>
            <button
              className="topbar-effect-btn"
              onClick={() => eventBridge.emit('tutorial:open')}
              title="Show tutorial"
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
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
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
