import { useEffect } from 'react';
import './Tutorial.css';

interface TutorialProps {
  onClose: () => void;
}

const ACTIVITY_LEGEND: { activity: string; building: string; tools: string }[] = [
  { activity: 'Read / Grep / Glob',     building: 'Library',     tools: 'search & read code' },
  { activity: 'Edit / Write',           building: 'Forge',       tools: 'write & edit code' },
  { activity: 'Bash',                   building: 'Arena',       tools: 'run commands & tests' },
  { activity: 'Thinking',               building: 'Castle',      tools: 'reason & plan' },
  { activity: 'Reviewing / subagents',  building: 'Watchtower',  tools: 'dispatch review' },
  { activity: 'Git commit / push',      building: 'Chapel',      tools: 'commit & push' },
  { activity: 'Debugging',              building: 'Alchemist',   tools: 'fix errors' },
  { activity: 'Idle / waiting',         building: 'Tavern',      tools: 'rest between tasks' },
];

export function Tutorial({ onClose }: TutorialProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="tutorial-backdrop" onClick={onClose}>
      <div className="tutorial-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tutorial-close" onClick={onClose} title="Close (Esc)">×</button>

        <img src="assets/logo.png" alt="Agent Quest" className="tutorial-logo" />

        <h2 className="tutorial-title">Welcome to Agent Quest</h2>

        <div className="tutorial-tagline">
          Use <strong>Claude Code</strong> or <strong>Codex</strong> as usual — each session auto-spawns a hero on the dashboard, live.
        </div>

        <a
          className="tutorial-tip-jar"
          href="https://buymeacoffee.com/fulvio"
          target="_blank"
          rel="noreferrer"
          title="Support the project — buy me a beer"
        >
          <span className="tutorial-tip-jar-icon" aria-hidden="true">🍺</span>
          <span className="tutorial-tip-jar-text">Buy me a beer</span>
        </a>

        <p className="tutorial-text">
          Agent Quest is a live dashboard that turns your{' '}
          <strong>Claude Code</strong> and <strong>Codex</strong> sessions into a 2D
          fantasy village. Every running agent becomes a <strong>hero</strong> who
          walks between buildings based on what it's doing.
        </p>
        <p className="tutorial-text">
          Works with{' '}
          <a
            className="tutorial-link"
            href="https://docs.claude.com/en/docs/claude-code/overview"
            target="_blank"
            rel="noreferrer"
          >Claude Code</a>
          {' '}in any form that writes session logs locally — the terminal CLI and
          the official IDE extensions (VS Code, JetBrains). Also works with{' '}
          <strong>Codex</strong>, reading rollout logs from{' '}
          <code>~/.codex/sessions/</code>. It doesn't work with the Claude desktop
          app or claude.ai in the browser, since those don't expose local session files.
        </p>

        <div className="tutorial-section-label">Activity → Building</div>
        <table className="tutorial-legend">
          <tbody>
            {ACTIVITY_LEGEND.map((row) => (
              <tr key={row.building}>
                <td className="tutorial-legend-k">{row.activity}</td>
                <td className="tutorial-legend-v">{row.building}</td>
                <td className="tutorial-legend-desc">{row.tools}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="tutorial-text">
          When both Claude Code and Codex have active agents, each hero shows a small{' '}
          <strong>CLAUDE</strong> or <strong>CODEX</strong> badge so you can tell which
          CLI it came from.
        </p>

        <div className="tutorial-section-label">How to use it</div>
        <p className="tutorial-text">
          Heroes appear in real time as you spawn new Claude Code or Codex sessions. Click a
          hero in the <em>Party Bar</em> (bottom) to see what it's doing; click any
          building to see which heroes are there. The 🗺️ icon in the top bar opens
          the map editor. Reopen this tutorial any time with the{' '}
          <strong>❓</strong> button, or press <code>Esc</code> to close it.
        </p>

        <div className="tutorial-section-label">Getting started</div>
        <p className="tutorial-text">
          Requires <code>bun ≥ 1.1.0</code>. Two equivalent ways to run it:
        </p>
        <ul className="tutorial-list">
          <li><code>agentquest</code> — if you installed via the one-line installer (<code>curl&nbsp;|&nbsp;bash</code>)</li>
          <li><code>bun start</code> — classic form, server + client together from the project root</li>
          <li><code>bun run dev:server</code> — server only on <code>:4444</code></li>
          <li><code>bun run dev:client</code> — client only on <code>:4445</code></li>
        </ul>
        <p className="tutorial-text">
          Once running, open <code>http://localhost:4445</code> in your browser to see the
          village. To pull upstream changes later: <code>agentquest update</code> (or{' '}
          <code>git pull --ff-only && bun install</code>).
        </p>
        <p className="tutorial-text">
          To share the village with other devices on the same Wi-Fi, prefix either form with{' '}
          <code>AGENT_QUEST_LAN=1</code> (e.g. <code>AGENT_QUEST_LAN=1 agentquest</code>) —
          the server will print the reachable LAN URLs at boot.
        </p>

        <div className="tutorial-section-label">Tech stack</div>
        <p className="tutorial-text">
          Bun · Hono · WebSocket · React 19 · Phaser 4 · TypeScript · Vite
        </p>

        <div className="tutorial-section-label">Privacy</div>
        <p className="tutorial-text">
          Everything runs locally on your machine. Nothing is uploaded, shared or
          persisted — Agent Quest only reads the logs Claude Code and Codex already
          keep on your disk.
        </p>

        <div className="tutorial-section-label">Platform</div>
        <p className="tutorial-text">
          <strong>Claude Code:</strong> tested on macOS and Windows (via <strong>WSL2</strong> — see the README).
        </p>
        <p className="tutorial-text">
          <strong>Codex:</strong> macOS tested. Windows not yet verified.
        </p>
        <p className="tutorial-text">
          <strong>Linux:</strong> should work for both, but not routinely tested.
        </p>

        <div className="tutorial-section-label">About</div>
        <p className="tutorial-text">
          Built by <strong>Fulvio Scichilone</strong> (
          <a
            className="tutorial-link"
            href="https://github.com/FulAppiOS"
            target="_blank"
            rel="noreferrer"
          >@FulAppiOS</a>
          {' '}on GitHub). Open source under the MIT license —{' '}
          <a
            className="tutorial-link"
            href="https://github.com/FulAppiOS/agent-quest"
            target="_blank"
            rel="noreferrer"
          >source on GitHub</a>.
        </p>
      </div>
    </div>
  );
}
