import { useEffect, useMemo, useState, useCallback } from 'react';
import { PhaserGame } from './game/PhaserGame';
import { useAgentState } from './hooks/useAgentState';
import { useSelectedAgent } from './hooks/useSelectedAgent';
import { useTopBarPrefs } from './hooks/useTopBarPrefs';
import { computeShowSourceBadge, filterAgentsForPresentation } from './presentation/agentPresentation';
import { eventBridge } from './game/EventBridge';
import { TopBar } from './components/TopBar';
import { PartyBar } from './components/PartyBar';
import { ActivityFeed } from './components/ActivityFeed';
import { DetailPanel } from './components/DetailPanel';
import { BuildingInfoPanel } from './components/BuildingInfoPanel';
import { Tutorial } from './components/Tutorial';
import { NoInstallBanner } from './components/NoInstallBanner';
import './App.css';

export default function App() {
  const { agents, activityLog, connected, configDirs } = useAgentState();
  const { selectedAgentId, selectAgent } = useSelectedAgent();
  const [topBarPrefs, updateTopBarPrefs] = useTopBarPrefs();

  // Presentation projection: agents shown in the Party Bar and the Phaser
  // village scene. TopBar stats, DetailPanel lookup, ActivityFeed, and
  // BuildingInfoPanel continue to use the unfiltered `agents` snapshot.
  const presentationAgents = useMemo(
    () => filterAgentsForPresentation(agents, topBarPrefs.showCompletedAgents),
    [agents, topBarPrefs.showCompletedAgents],
  );
  const [selectedBuilding, setSelectedBuilding] = useState<{
    id: string;
    anchor: { x: number; y: number };
  } | null>(null);
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
  // last Codex hero finishes just because it's still in state. Computed by a
  // shared helper so VillageScene stays in lockstep.
  const showSourceBadge = useMemo(() => computeShowSourceBadge(agents), [agents]);

  // When selecting agent, clear building
  const handleSelectAgent = useCallback((id: string | null) => {
    selectAgent(id);
    setSelectedBuilding(null);
  }, [selectAgent]);

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
    eventBridge.emit('agents:updated', presentationAgents);
  }, [presentationAgents]);

  // Deselect when the selected agent gets hidden by the presentation projection
  // (e.g. user flips the "Show completed agents" toggle off while a completed
  // hero is selected). Without this the DetailPanel would linger pointing at a
  // hero that is no longer on screen.
  useEffect(() => {
    if (selectedAgentId === null) return;
    const stillVisible = presentationAgents.some((a) => a.id === selectedAgentId);
    if (!stillVisible) selectAgent(null);
  }, [presentationAgents, selectedAgentId, selectAgent]);

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
            showCompletedAgents={topBarPrefs.showCompletedAgents}
            onToggleShowCompletedAgents={() =>
              updateTopBarPrefs({ showCompletedAgents: !topBarPrefs.showCompletedAgents })
            }
          />
          <NoInstallBanner configDirs={configDirs} connected={connected} />
          <PartyBar
            agents={presentationAgents}
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
              agents={presentationAgents}
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
        </div>
      )}
      {tutorialOpen && <Tutorial onClose={closeTutorial} />}
    </div>
  );
}
