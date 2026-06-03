import { useEffect, useState, useCallback, useRef } from 'react';
import { PhaserGame } from './game/PhaserGame';
import { useAgentState } from './hooks/useAgentState';
import { useSelectedAgent } from './hooks/useSelectedAgent';
import { eventBridge } from './game/EventBridge';
import { TopBar } from './components/TopBar';
import { PartyBar } from './components/PartyBar';
import { ActivityFeed } from './components/ActivityFeed';
import { DetailPanel } from './components/DetailPanel';
import { BuildingInfoPanel } from './components/BuildingInfoPanel';
import { Tutorial } from './components/Tutorial';
import { NoInstallBanner } from './components/NoInstallBanner';
import { SettingsPanel } from './components/SettingsPanel';
import { Toasts, type ToastItem } from './components/Toasts';
import type { NotificationEntry } from './components/NotificationMenu';
import { useSettings } from './hooks/useSettings';
import { useAgentNotifications, type ToastPayload } from './hooks/useAgentNotifications';
import './App.css';

export default function App() {
  const { agents, activityLog, connected, configDirs } = useAgentState();
  const { selectedAgentId, selectAgent } = useSelectedAgent();
  const [selectedBuilding, setSelectedBuilding] = useState<{
    id: string;
    anchor: { x: number; y: number };
  } | null>(null);
  const [villageReady, setVillageReady] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, updateSettings] = useSettings();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationEntry[]>([]);
  const [notifUnread, setNotifUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifIdRef = useRef(0);
  // Read inside the stable pushAlert callback without re-creating it (and
  // without the stale-closure that dropped a badge increment on the close frame).
  const notifOpenRef = useRef(notifOpen);
  notifOpenRef.current = notifOpen;

  const pushAlert = useCallback((p: ToastPayload) => {
    // Persistent history for the notification menu — always recorded, even when
    // transient toasts are disabled, so the menu is a complete log.
    const entry: NotificationEntry = { ...p, id: ++notifIdRef.current, timestamp: Date.now() };
    setNotifications((prev) => [entry, ...prev].slice(0, 50));
    setNotifUnread((n) => (notifOpenRef.current ? 0 : n + 1));
    // Transient toast (deduped per agent+category), only if enabled.
    if (settings.inAppToasts) {
      setToasts((prev) => {
        const key = `${p.agentId}:${p.category}`;
        const without = prev.filter((t) => t.key !== key);
        return [{ ...p, key }, ...without].slice(0, 5);
      });
    }
  }, [settings.inAppToasts]);

  const dismissToast = useCallback((key: string) => {
    setToasts((prev) => prev.filter((t) => t.key !== key));
  }, []);

  const toggleNotifMenu = useCallback(() => {
    setNotifOpen((open) => {
      if (!open) setNotifUnread(0); // opening clears the unread badge
      return !open;
    });
  }, []);

  const clearNotifications = useCallback(() => setNotifications([]), []);

  const closeTutorial = useCallback(() => {
    setTutorialOpen(false);
    try { localStorage.setItem('agent-quest:tutorial-seen', '1'); } catch {}
  }, []);

  const selectedAgent = selectedAgentId !== null
    ? agents.find((a) => a.id === selectedAgentId) ?? null
    : null;

  // Only show source badges when both providers have a LIVE agent — completed
  // / error sessions don't count, otherwise the badge would linger after the
  // last Codex hero finishes just because it's still in state.
  const liveAgents = agents.filter((a) => a.status !== 'completed' && a.status !== 'error');
  const showSourceBadge = liveAgents.some((a) => a.source === 'claude')
    && liveAgents.some((a) => a.source === 'codex');

  // When selecting agent, clear building
  const handleSelectAgent = useCallback((id: string | null) => {
    selectAgent(id);
    setSelectedBuilding(null);
  }, [selectAgent]);

  // Desktop notifications + sounds + in-app toasts on agent state transitions
  // (gated by settings). Toasts are the browser-independent, permission-free
  // channel.
  useAgentNotifications(agents, settings, handleSelectAgent, pushAlert);

  // When selecting building, clear agent. `anchor` is the click's screen-space
  // position, captured by the Building entity and used by BuildingInfoPanel
  // to place itself next to the clicked structure.
  const handleSelectBuilding = useCallback((id: string, anchor: { x: number; y: number }) => {
    setSelectedBuilding((prev) => (prev?.id === id ? null : { id, anchor }));
    selectAgent(null);
  }, [selectAgent]);

  // Listen for building clicks from Phaser
  useEffect(() => {
    const onBuildingClicked = (payload: unknown) => {
      if (typeof payload === 'object' && payload !== null && 'id' in payload) {
        const p = payload as { id: string; screenX: number; screenY: number };
        handleSelectBuilding(p.id, { x: p.screenX, y: p.screenY });
      }
    };
    eventBridge.on('building:clicked', onBuildingClicked);
    return () => {
      eventBridge.off('building:clicked', onBuildingClicked);
    };
  }, [handleSelectBuilding]);

  // Listen for hero clicks from Phaser. String = select that agent;
  // null = user clicked the map background with no hero hit → deselect.
  useEffect(() => {
    const onHeroClicked = (id: unknown) => {
      if (id === null) handleSelectAgent(null);
      else if (typeof id === 'string') handleSelectAgent(id);
    };
    eventBridge.on('hero:clicked', onHeroClicked);
    return () => {
      eventBridge.off('hero:clicked', onHeroClicked);
    };
  }, [handleSelectAgent]);

  // Hide the HTML overlays (TopBar, PartyBar, etc.) while the BootScene is up.
  // VillageScene emits 'village:ready' in its create().
  useEffect(() => {
    const onReady = () => {
      setVillageReady(true);
      try {
        if (localStorage.getItem('agent-quest:tutorial-seen') !== '1') {
          setTutorialOpen(true);
        }
      } catch {
        setTutorialOpen(true);
      }
    };
    eventBridge.on('village:ready', onReady);
    return () => eventBridge.off('village:ready', onReady);
  }, []);

  useEffect(() => {
    const onOpen = () => setTutorialOpen(true);
    eventBridge.on('tutorial:open', onOpen);
    return () => eventBridge.off('tutorial:open', onOpen);
  }, []);

  useEffect(() => {
    const onOpen = () => setSettingsOpen(true);
    eventBridge.on('settings:open', onOpen);
    return () => eventBridge.off('settings:open', onOpen);
  }, []);

  useEffect(() => {
    eventBridge.emit('agents:updated', agents);
  }, [agents]);

  useEffect(() => {
    eventBridge.emit('selection:changed', selectedAgentId);
  }, [selectedAgentId]);

  useEffect(() => {
    if (connected) {
      eventBridge.emit('ws:connected');
    } else {
      eventBridge.emit('ws:disconnected');
    }
  }, [connected]);

  return (
    <div className="app-container">
      <PhaserGame />
      {villageReady && (
        <div className="overlay">
          <TopBar
            agents={agents}
            connected={connected}
            notifications={{
              entries: notifications,
              unread: notifUnread,
              open: notifOpen,
              onToggle: toggleNotifMenu,
              onActivate: handleSelectAgent,
              onClear: clearNotifications,
            }}
          />
          <NoInstallBanner configDirs={configDirs} connected={connected} />
          <PartyBar
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={handleSelectAgent}
            showSourceBadge={showSourceBadge}
          />
          {selectedAgent !== null && (
            <DetailPanel agent={selectedAgent} onClose={() => handleSelectAgent(null)} showSourceBadge={showSourceBadge} />
          )}
          {selectedBuilding !== null && (
            <BuildingInfoPanel
              buildingId={selectedBuilding.id}
              anchor={selectedBuilding.anchor}
              agents={agents}
              onClose={() => setSelectedBuilding(null)}
            />
          )}
          <ActivityFeed
            log={activityLog}
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={handleSelectAgent}
            showSourceBadge={showSourceBadge}
          />
          <Toasts items={toasts} onActivate={handleSelectAgent} onDismiss={dismissToast} />
        </div>
      )}
      {tutorialOpen && <Tutorial onClose={closeTutorial} />}
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
