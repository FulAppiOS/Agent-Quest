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
          />
          {selectedAgent !== null && (
            <DetailPanel agent={selectedAgent} onClose={() => handleSelectAgent(null)} />
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
          />
        </div>
      )}
      {tutorialOpen && <Tutorial onClose={closeTutorial} />}
    </div>
  );
}
