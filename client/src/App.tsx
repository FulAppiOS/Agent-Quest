import { useEffect, useState, useCallback } from 'react';
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
import { NoClaudeBanner } from './components/NoClaudeBanner';
import './App.css';

export default function App() {
  const { agents, activityLog, connected, configDirs } = useAgentState();
  const { selectedAgentId, selectAgent } = useSelectedAgent();
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [villageReady, setVillageReady] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);

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
    setSelectedBuildingId(null);
  }, [selectAgent]);

  // When selecting building, clear agent
  const handleSelectBuilding = useCallback((id: string) => {
    setSelectedBuildingId((prev) => (prev === id ? null : id));
    selectAgent(null);
  }, [selectAgent]);

  // Listen for building clicks from Phaser
  useEffect(() => {
    const onBuildingClicked = (id: unknown) => {
      handleSelectBuilding(id as string);
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
          <TopBar agents={agents} connected={connected} />
          <NoClaudeBanner configDirs={configDirs} connected={connected} />
          <PartyBar
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={handleSelectAgent}
            showSourceBadge={showSourceBadge}
          />
          {selectedAgent !== null && (
            <DetailPanel agent={selectedAgent} onClose={() => handleSelectAgent(null)} showSourceBadge={showSourceBadge} />
          )}
          {selectedBuildingId !== null && (
            <BuildingInfoPanel
              buildingId={selectedBuildingId}
              agents={agents}
              onClose={() => setSelectedBuildingId(null)}
            />
          )}
          <ActivityFeed
            log={activityLog}
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={handleSelectAgent}
            showSourceBadge={showSourceBadge}
          />
        </div>
      )}
      {tutorialOpen && <Tutorial onClose={closeTutorial} />}
    </div>
  );
}
