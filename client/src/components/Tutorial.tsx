import { useEffect } from 'react';
import { useI18n } from '../i18n';
import './Tutorial.css';

interface TutorialProps {
  onClose: () => void;
}

/**
 * One row per building. `tool` is a literal tool-name cell (Read / Edit / Bash…)
 * that is never translated; rows without one take their activity label from
 * `tutorial.legend.<id>.activity`. Building names come from `building.<id>.name`.
 */
const ACTIVITY_LEGEND: { id: string; tool: string | null }[] = [
  { id: 'library',    tool: 'Read / Grep / Glob' },
  { id: 'forge',      tool: 'Edit / Write' },
  { id: 'arena',      tool: 'Bash' },
  { id: 'castle',     tool: null },
  { id: 'watchtower', tool: null },
  { id: 'chapel',     tool: null },
  { id: 'alchemist',  tool: null },
  { id: 'tavern',     tool: null },
];

export function Tutorial({ onClose }: TutorialProps) {
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="tutorial-backdrop" onClick={onClose}>
      <div className="tutorial-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tutorial-close" onClick={onClose} title={t('common.closeEsc')}>×</button>

        <img src="assets/logo.png" alt="Agent Quest" className="tutorial-logo" />

        <h2 className="tutorial-title">{t('tutorial.title')}</h2>

        <div className="tutorial-tagline">
          {t('tutorial.taglineBefore')}<strong>Claude Code CLI</strong>{t('tutorial.taglineBetween')}<strong>Codex</strong>{t('tutorial.taglineAfter')}
        </div>

        <a
          className="tutorial-tip-jar"
          href="https://buymeacoffee.com/fulvio"
          target="_blank"
          rel="noreferrer"
          title={t('tutorial.tipJarTitle')}
        >
          <span className="tutorial-tip-jar-icon" aria-hidden="true">🍺</span>
          <span className="tutorial-tip-jar-text">{t('tutorial.tipJar')}</span>
        </a>

        <p className="tutorial-text">
          {t('tutorial.introBefore')}<strong>Claude Code</strong>{t('tutorial.introBetween')}<strong>Codex</strong>
          {t('tutorial.introAfterCodex')}<strong>{t('tutorial.introHero')}</strong>{t('tutorial.introAfter')}
        </p>
        <p className="tutorial-text">
          {t('tutorial.worksWithBefore')}
          <a
            className="tutorial-link"
            href="https://docs.claude.com/en/docs/claude-code/overview"
            target="_blank"
            rel="noreferrer"
          >Claude Code</a>
          {t('tutorial.worksWithAfterClaude')}
          <a
            className="tutorial-link"
            href="https://github.com/openai/codex"
            target="_blank"
            rel="noreferrer"
          >Codex</a>
          {t('tutorial.worksWithAfterCodex')}<code>~/.codex/sessions/</code>{t('tutorial.worksWithAfterPath')}
        </p>

        <p className="tutorial-text">
          {t('tutorial.xcodeBefore')}<strong>{t('tutorial.xcodeStrong')}</strong>{t('tutorial.xcodeMiddle')}
          <strong>Xcode</strong>{t('tutorial.xcodeAfter')}
        </p>

        <div className="tutorial-section-label">{t('tutorial.legendTitle')}</div>
        <table className="tutorial-legend">
          <tbody>
            {ACTIVITY_LEGEND.map((row) => (
              <tr key={row.id}>
                <td className="tutorial-legend-k">{row.tool ?? t(`tutorial.legend.${row.id}.activity`)}</td>
                <td className="tutorial-legend-v">{t(`building.${row.id}.name`)}</td>
                <td className="tutorial-legend-desc">{t(`tutorial.legend.${row.id}.tools`)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="tutorial-text">
          {t('tutorial.badgesBefore')}<strong>CLAUDE</strong>{t('tutorial.badgesBetween')}<strong>CODEX</strong>{t('tutorial.badgesAfter')}
        </p>

        <div className="tutorial-section-label">{t('tutorial.contextTitle')}</div>
        <p className="tutorial-text">
          {t('tutorial.contextBarBefore')}<strong>{t('tutorial.contextWindow')}</strong>{t('tutorial.contextBarAfter')}
          <strong>Ctx</strong>{t('tutorial.contextCtxAfter')}<strong>✦ {t('tutorial.skillTag')}</strong>{t('tutorial.contextSkillAfter')}
        </p>
        <p className="tutorial-text">
          <strong>{t('tutorial.knightsLead')}</strong> <strong>{t('tutorial.subagentsWord')}</strong>{t('tutorial.subagentsBefore')}
          <strong>SUBAGENT · {t('tutorial.subagentRole')}</strong>{t('tutorial.subagentsMiddle')}<strong>⚑ N</strong>{t('tutorial.subagentsAfter')}
        </p>
        <p className="tutorial-text">
          {t('tutorial.exportBefore')}<strong>✦</strong>{t('tutorial.exportAfterStar')}<strong>{t('tutorial.skillsPlugins')}</strong>
          {t('tutorial.exportAfterView')}<strong>{t('tutorial.exportWord')}</strong>{t('tutorial.exportAfter')}
        </p>

        <div className="tutorial-section-label">{t('tutorial.howToTitle')}</div>
        <p className="tutorial-text">
          {t('tutorial.howToBefore')}<em>{t('tutorial.partyBar')}</em>{t('tutorial.howToAfterPartyBar')}
          <strong>❓</strong>{t('tutorial.howToAfterButton')}<code>Esc</code>{t('tutorial.howToAfterEsc')}
        </p>

        <div className="tutorial-section-label">{t('tutorial.gettingStartedTitle')}</div>
        <p className="tutorial-text">
          {t('tutorial.requiresBefore')}<code>bun ≥ 1.1.0</code>{t('tutorial.requiresAfter')}
        </p>
        <ul className="tutorial-list">
          <li><code>agentquest</code>{t('tutorial.runAgentquestBefore')}<code>curl&nbsp;|&nbsp;bash</code>{t('tutorial.runAgentquestAfter')}</li>
          <li><code>bun start</code>{t('tutorial.runBunStart')}</li>
          <li><code>bun run dev:server</code>{t('tutorial.runServerOnly')}<code>:4444</code>{t('tutorial.runServerOnlyAfter')}</li>
          <li><code>bun run dev:client</code>{t('tutorial.runClientOnly')}<code>:4445</code>{t('tutorial.runClientOnlyAfter')}</li>
        </ul>
        <p className="tutorial-text">
          {t('tutorial.openBefore')}<code>http://localhost:4445</code>{t('tutorial.openAfterUrl')}<code>agentquest update</code>
          {t('tutorial.openOr')}<code>git pull --ff-only && bun install</code>{t('tutorial.openAfter')}
        </p>
        <p className="tutorial-text">
          {t('tutorial.lanBefore')}<code>AGENT_QUEST_LAN=1</code>{t('tutorial.lanExample')}<code>AGENT_QUEST_LAN=1 agentquest</code>{t('tutorial.lanAfter')}
        </p>

        <div className="tutorial-section-label">{t('tutorial.techStackTitle')}</div>
        <p className="tutorial-text">
          Bun · Hono · WebSocket · React 19 · Phaser 4 · TypeScript · Vite
        </p>

        <div className="tutorial-section-label">{t('tutorial.privacyTitle')}</div>
        <p className="tutorial-text">
          {t('tutorial.privacyText')}
        </p>

        <div className="tutorial-section-label">{t('tutorial.platformTitle')}</div>
        <p className="tutorial-text">
          <strong>Claude Code:</strong>{t('tutorial.platformClaudeBefore')}<strong>WSL2</strong>{t('tutorial.platformClaudeAfter')}
        </p>
        <p className="tutorial-text">
          <strong>Codex:</strong>{t('tutorial.platformCodex')}
        </p>
        <p className="tutorial-text">
          <strong>Linux:</strong>{t('tutorial.platformLinux')}
        </p>

        <div className="tutorial-section-label">{t('tutorial.aboutTitle')}</div>
        <p className="tutorial-text">
          {t('tutorial.aboutBefore')}<strong>Fulvio Scichilone</strong>{t('tutorial.aboutAfterName')}
          <a
            className="tutorial-link"
            href="https://github.com/FulAppiOS"
            target="_blank"
            rel="noreferrer"
          >@FulAppiOS</a>
          {t('tutorial.aboutAfterHandle')}
          <a
            className="tutorial-link"
            href="https://github.com/FulAppiOS/agent-quest"
            target="_blank"
            rel="noreferrer"
          >{t('tutorial.aboutSourceLink')}</a>.
        </p>
      </div>
    </div>
  );
}
