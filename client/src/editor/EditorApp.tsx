import { useEffect } from 'react';
import { EditorPhaserGame } from './EditorPhaserGame';
import { EditorTopBar } from './panels/EditorTopBar';
import { MouseHint } from '../components/MouseHint';
import { ToolBar } from './panels/ToolBar';
import { TilePalette } from './panels/TilePalette';
import { LayerPanel } from './panels/LayerPanel';
import { Inspector } from './panels/Inspector';
import { AssetWarningBanner } from './panels/AssetWarningBanner';
import { editorBridge } from './EditorBridge';
import { editorStore } from './state/editor-store';
import type { AssetManifest } from './types/map';
import type { EditorStats, Selection } from './types/editor-events';
import type { GroupedMissingAssets } from '../game/data/asset-diagnostics';
import './editor.css';

export default function EditorApp() {
  useEffect(() => {
    const onReady = (payload: unknown) => {
      const p = payload as { manifest: AssetManifest };
      editorStore.setManifest(p.manifest);
    };
    const onStats = (payload: unknown) => {
      editorStore.setStats(payload as EditorStats);
    };
    const onSelected = (payload: unknown) => {
      editorStore.setSelection(payload as Selection | null);
    };
    const onSaved = (payload: unknown) => {
      const p = payload as { updatedAt: number };
      editorStore.setSaved(p.updatedAt);
    };
    const onSaveError = (msg: unknown) => {
      editorStore.setSaveError(String(msg));
    };
    const onDirty = (d: unknown) => {
      editorStore.setDirty(Boolean(d));
    };
    const onAssetErrors = (payload: unknown) => {
      editorStore.setAssetErrors(payload as GroupedMissingAssets);
    };

    editorBridge.on('ed:ready', onReady);
    editorBridge.on('ed:state:update', onStats);
    editorBridge.on('ed:selected', onSelected);
    editorBridge.on('ed:saved', onSaved);
    editorBridge.on('ed:save:error', onSaveError);
    editorBridge.on('ed:dirty', onDirty);
    editorBridge.on('ed:asset:errors', onAssetErrors);

    return () => {
      editorBridge.off('ed:ready', onReady);
      editorBridge.off('ed:state:update', onStats);
      editorBridge.off('ed:selected', onSelected);
      editorBridge.off('ed:saved', onSaved);
      editorBridge.off('ed:save:error', onSaveError);
      editorBridge.off('ed:dirty', onDirty);
      editorBridge.off('ed:asset:errors', onAssetErrors);
    };
  }, []);

  return (
    <div className="editor-root">
      <EditorPhaserGame />
      <div className="editor-overlay">
        <EditorTopBar />
        <AssetWarningBanner />
        <ToolBar />
        <TilePalette />
        <LayerPanel />
        <Inspector />
        <MouseHint />
      </div>
    </div>
  );
}
