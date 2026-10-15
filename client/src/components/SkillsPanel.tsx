import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  HERO_LABEL_COLOR, formatTokens, skillShortName,
  type AgentSource, type AgentState, type SkillInventory,
} from '../types/agent';
import { aggregateFleetUsage } from '../report/fleetUsage';
import { buildFleetJson, buildFleetMarkdown, exportFileName } from '../report/sessionExport';
import { copyText, downloadText } from '../report/download';
import { HeroAvatar } from './HeroAvatar';
import { ContextMeter } from './ContextMeter';
import './SettingsPanel.css';
import './SkillsPanel.css';

interface SkillsPanelProps {
  agents: AgentState[];
  skillInventory: Partial<Record<AgentSource, SkillInventory>>;
  onClose: () => void;
  onSelectAgent: (id: string) => void;
}

const LIVE_STATUSES = new Set<AgentState['status']>(['active', 'waiting', 'idle']);
const SOURCE_LABEL: Record<AgentSource, string> = { claude: 'Claude Code', codex: 'Codex' };

/**
 * Fleet-wide view of the telemetry every hero carries: which skills and
 * plugins are in use across all agents, what they cost in context, how each
 * agent's window is doing — plus the AI-review export for the whole fleet.
 */
export function SkillsPanel({ agents, skillInventory, onClose, onSelectAgent }: SkillsPanelProps) {
  const [scope, setScope] = useState<'live' | 'all'>('live');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const scoped = useMemo(
    () => (scope === 'live' ? agents.filter((a) => LIVE_STATUSES.has(a.status)) : agents),
    [agents, scope],
  );
  const usage = useMemo(() => aggregateFleetUsage(scoped), [scoped]);
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const exportMarkdown = useCallback(() => buildFleetMarkdown(scoped, skillInventory), [scoped, skillInventory]);
  const onCopy = useCallback(async () => {
    const ok = await copyText(exportMarkdown());
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 1800);
  }, [exportMarkdown]);
  const onDownloadMd = useCallback(() => {
    downloadText(exportFileName('fleet', 'md'), exportMarkdown(), 'text/markdown');
  }, [exportMarkdown]);
  const onDownloadJson = useCallback(() => {
    downloadText(exportFileName('fleet', 'json'), JSON.stringify(buildFleetJson(scoped), null, 2), 'application/json');
  }, [scoped]);

  const inventories = (['claude', 'codex'] as const).filter((s) => (skillInventory[s]?.count ?? 0) > 0);

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-modal skills-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Skills and plugins">
        <button className="settings-close" onClick={onClose} title="Close (Esc)">×</button>
        <h2 className="settings-title">{'✦'} Skills &amp; Plugins</h2>

        <div className="skills-toolbar">
          <div className="skills-scope" role="radiogroup" aria-label="Agents in scope">
            <button type="button" role="radio" aria-checked={scope === 'live'} className={`skills-scope-btn ${scope === 'live' ? 'on' : ''}`} onClick={() => setScope('live')}>Live agents</button>
            <button type="button" role="radio" aria-checked={scope === 'all'} className={`skills-scope-btn ${scope === 'all' ? 'on' : ''}`} onClick={() => setScope('all')}>All ({agents.length})</button>
          </div>
          <div className="skills-export" aria-label="Export for AI review">
            <span className="skills-export-label">Export for AI review</span>
            <button type="button" className="settings-btn" onClick={() => { void onCopy(); }} title="Copy a Markdown report of every agent in scope">
              {copied ? 'Copied ✓' : 'Copy Markdown'}
            </button>
            <button type="button" className="settings-btn" onClick={onDownloadMd} title="Download the Markdown report">.md</button>
            <button type="button" className="settings-btn" onClick={onDownloadJson} title="Download the raw data as JSON">.json</button>
          </div>
        </div>

        <div className="skills-tiles">
          <div className="skills-tile"><span className="skills-tile-v">{usage.skills.length}</span><span className="skills-tile-k">skills in use</span></div>
          <div className="skills-tile"><span className="skills-tile-v">~{formatTokens(usage.totals.skillTokens)}</span><span className="skills-tile-k">tokens from skills</span></div>
          <div className="skills-tile"><span className="skills-tile-v">{usage.totals.pluginCalls}</span><span className="skills-tile-k">plugin calls</span></div>
          <div className="skills-tile"><span className="skills-tile-v">~{formatTokens(usage.totals.pluginTokens)}</span><span className="skills-tile-k">tokens from plugins</span></div>
        </div>
        {inventories.length > 0 && (
          <p className="settings-muted skills-inventory">
            {inventories.map((s) => `${SOURCE_LABEL[s]}: ${skillInventory[s]!.count} skills installed (~${formatTokens(skillInventory[s]!.tokens)} tokens if always loaded)`).join(' · ')}.
            {' '}Loading skills on demand kept ~{formatTokens(Math.max(0, inventories.reduce((sum, s) => sum + skillInventory[s]!.tokens, 0) - usage.totals.skillTokens))} tokens out of the contexts in scope.
          </p>
        )}

        <div className="settings-section-label">Skills</div>
        {usage.skills.length === 0 ? (
          <p className="settings-muted">No skills loaded by the agents in scope.</p>
        ) : (
          <table className="skills-table">
            <thead><tr><th>Skill</th><th>Plugin</th><th className="num">Loads</th><th className="num">~Tokens</th><th className="num">Agents</th></tr></thead>
            <tbody>
              {usage.skills.map((s) => (
                <tr key={s.name} title={s.name}>
                  <td>{'✦'} {skillShortName(s.name)}</td>
                  <td className="muted">{s.plugin ?? '–'}</td>
                  <td className="num">{s.loads}</td>
                  <td className="num">~{formatTokens(s.loadTokens)}</td>
                  <td className="num">{s.agents}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="settings-section-label">Plugins &amp; MCP</div>
        {usage.plugins.length === 0 ? (
          <p className="settings-muted">No plugin or MCP calls by the agents in scope.</p>
        ) : (
          <table className="skills-table">
            <thead><tr><th>Plugin / server</th><th>Kind</th><th className="num">Calls</th><th className="num">~Tokens</th><th className="num">Agents</th></tr></thead>
            <tbody>
              {usage.plugins.map((p) => (
                <tr key={`${p.kind}:${p.name}`} title={`${p.kind}: ${p.name}`}>
                  <td>{'⚙'} {p.name}</td>
                  <td className="muted">{p.kind}</td>
                  <td className="num">{p.calls}</td>
                  <td className="num">~{formatTokens(p.resultTokens)}</td>
                  <td className="num">{p.agents}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="settings-section-label">Agents</div>
        {usage.agents.length === 0 ? (
          <p className="settings-muted">No agents in scope.</p>
        ) : (
          <ul className="skills-agents">
            {usage.agents.map((row) => {
              const agent = byId.get(row.id);
              if (agent === undefined) return null;
              const parent = row.parentId !== undefined ? byId.get(row.parentId) : undefined;
              return (
                <li key={row.id} className={`skills-agent ${row.isSubagent ? 'is-sub' : ''}`}>
                  <button type="button" className="skills-agent-main" onClick={() => onSelectAgent(row.id)} title={`Select ${row.name}`}>
                    <HeroAvatar agent={agent} size={28} />
                    <span className="skills-agent-name" style={{ color: HERO_LABEL_COLOR[agent.heroColor] }}>
                      {row.isSubagent ? '⚔ ' : ''}{row.name}
                    </span>
                    {row.isSubagent && parent !== undefined && <span className="skills-agent-parent">for {parent.name}</span>}
                    <span className={`skills-agent-status status-${row.status}`}>{row.status}</span>
                  </button>
                  <span className="skills-agent-ctx"><ContextMeter context={agent.context} size="mini" /></span>
                  <span className="skills-agent-meta">
                    {row.activeSkill !== undefined && <span className="skills-chip" title={row.activeSkill}>{'✦'} {skillShortName(row.activeSkill)}</span>}
                    <span className="muted">skills ~{formatTokens(row.skillTokens)} · plugins ~{formatTokens(row.pluginTokens)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <p className="settings-foot">
          Figures marked ~ are estimates (characters ÷ 4). The export bundles the same data as Markdown or JSON so an AI outside Agent Quest can review the sessions.
        </p>
      </div>
    </div>
  );
}
