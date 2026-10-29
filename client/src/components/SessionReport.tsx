import { isXcodeAgent } from '../types/sessionIdentity';
import { useMemo } from 'react';
import { formatTokens, skillShortName, type AgentActivity, type AgentState } from '../types/agent';
import { computeSessionReport } from '../report/sessionReport';
import { configDirLabel } from './configDirLabel';
import { ContextMeter } from './ContextMeter';
import './SessionReport.css';

const ACTIVITY_COLOR: Record<AgentActivity, string> = {
  idle: '#888888', thinking: '#C48BE8', reading: '#88BBFF', editing: '#FF8C42',
  bash: '#FF9966', git: '#88E08A', debugging: '#FF6B6B', reviewing: '#7AE0C8',
};

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function cwdBasename(cwd: string): string {
  const parts = cwd.split('/').filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? cwd;
}

interface SessionReportProps {
  agent: AgentState;
  /** The session's subagents (any status), for the delegation block. */
  subagents?: AgentState[];
}

export function SessionReport({ agent, subagents = [] }: SessionReportProps) {
  const r = useMemo(() => computeSessionReport(agent, subagents), [agent, subagents]);

  return (
    <div className="report">
      <div className="report-env">
        <span className="report-env-item"><span className="report-env-k">Profile</span> {configDirLabel(agent.configDir)}</span>
        <span className="report-env-item"><span className="report-env-k">Project</span> {isXcodeAgent(agent) && !agent.isSubagent ? agent.name : agent.cwd.length > 0 ? cwdBasename(agent.cwd) : '—'}</span>
        {agent.model !== undefined && <span className="report-env-item"><span className="report-env-k">Model</span> {agent.model}</span>}
      </div>

      <div className="report-stats">
        <div className="report-stat"><span className="report-stat-v">{formatDuration(r.durationMs)}</span><span className="report-stat-k">duration</span></div>
        <div className="report-stat"><span className="report-stat-v">{r.toolTotal}</span><span className="report-stat-k">tool calls</span></div>
        <div className="report-stat"><span className="report-stat-v">{r.filesModified}</span><span className="report-stat-k">files</span></div>
        <div className="report-stat"><span className={`report-stat-v ${r.errorCount > 0 ? 'is-err' : ''}`}>{r.errorCount}</span><span className="report-stat-k">errors</span></div>
      </div>

      <div className="report-section-title">Activity (by tool use)</div>
      {r.byActivity.length === 0 ? (
        <div className="report-empty">No tool activity recorded.</div>
      ) : (
        <div className="report-bars">
          {r.byActivity.map((s) => (
            <div className="report-bar-row" key={s.activity}>
              <span className="report-bar-label">{s.activity}</span>
              <span className="report-bar-track">
                <span className="report-bar-fill" style={{ width: `${Math.max(2, s.pct)}%`, background: ACTIVITY_COLOR[s.activity] }} />
              </span>
              <span className="report-bar-count">{s.count}</span>
            </div>
          ))}
        </div>
      )}

      {r.topTools.length > 0 && (
        <>
          <div className="report-section-title">Top tools</div>
          <div className="report-tools">
            {r.topTools.map((t) => (
              <span className="report-tool" key={t.name}>{t.name} <span className="report-tool-n">{t.count}</span></span>
            ))}
          </div>
        </>
      )}

      {r.context !== undefined && (
        <>
          <div className="report-section-title">Context window</div>
          <ContextMeter context={agent.context} />
          <div className="report-econ report-econ--spaced">
            <div className="report-econ-row"><span>In use</span><span>{formatTokens(r.context.used)}{r.context.window !== null ? ` / ${formatTokens(r.context.window)}` : ''}</span></div>
            <div className="report-econ-row"><span>Peak</span><span>{formatTokens(r.context.peak)}</span></div>
            <div className="report-econ-row"><span>Compactions</span><span>{r.context.compactions}</span></div>
          </div>
        </>
      )}

      {r.skills.length > 0 && (
        <>
          <div className="report-section-title">Skills loaded</div>
          <div className="report-econ">
            {r.skills.map((s) => (
              <div className="report-econ-row" key={s.name} title={s.name}>
                <span>{'✦'} {skillShortName(s.name)}{s.plugin !== undefined ? <span className="report-est"> {s.plugin}</span> : null}</span>
                <span>{s.loads}× · ~{formatTokens(s.loadTokens)}{s.attributedMessages > 0 ? ` · ${s.attributedMessages} msg` : ''}</span>
              </div>
            ))}
          </div>
          <div className="report-muted report-tokens-note">~tokens = skill text that entered the context (chars ÷ 4).</div>
        </>
      )}

      {r.plugins.length > 0 && (
        <>
          <div className="report-section-title">Plugins &amp; MCP</div>
          <div className="report-econ">
            {r.plugins.map((p) => (
              <div className="report-econ-row" key={`${p.kind}:${p.name}`} title={`${p.kind}: ${p.name}`}>
                <span>{'⚙'} {p.name} <span className="report-est">{p.kind}</span></span>
                <span>{p.calls} call{p.calls === 1 ? '' : 's'} · ~{formatTokens(p.resultTokens)}</span>
              </div>
            ))}
          </div>
          <div className="report-muted report-tokens-note">~tokens = tool results that entered the context.</div>
        </>
      )}

      {r.delegation !== undefined && (
        <>
          <div className="report-section-title">Delegation</div>
          <div className="report-econ">
            <div className="report-econ-row"><span>Subagents</span><span>{r.delegation.live} live / {r.delegation.count}</span></div>
            <div className="report-econ-row"><span>Processed by them</span><span>~{formatTokens(r.delegation.childPeakTokens)}</span></div>
            <div className="report-econ-row"><span>Returned here</span><span>~{formatTokens(r.delegation.returnedTokens)}</span></div>
            <div className="report-econ-row report-econ-total"><span>Kept out of this context</span><span>~{formatTokens(r.delegation.keptOutTokens)}</span></div>
          </div>
        </>
      )}

      {/* Tokens — Claude only. Codex doesn't report per-message usage, so the
          section is omitted entirely for it (no misleading empty rows). */}
      {r.hasTokens ? (
        <>
          <div className="report-section-title">Tokens</div>
          <div className="report-econ">
            <div className="report-econ-row"><span>Input</span><span>{formatTokens(r.tokens.input)}</span></div>
            <div className="report-econ-row"><span>Output</span><span>{formatTokens(r.tokens.output)}</span></div>
            <div className="report-econ-row"><span>Cache read</span><span>{formatTokens(r.tokens.cacheRead)}</span></div>
            <div className="report-econ-row"><span>Cache write</span><span>{formatTokens(r.tokens.cacheWrite)}</span></div>
            <div className="report-econ-row report-econ-total"><span>Total tokens</span><span>{formatTokens(r.tokens.total)}</span></div>
          </div>
          <div className="report-muted report-tokens-note">Tokens for this session only — its subagents are tracked separately.</div>
        </>
      ) : r.source === 'claude' ? (
        <>
          <div className="report-section-title">Tokens</div>
          <div className="report-muted">No token usage recorded for this session yet.</div>
        </>
      ) : null}
    </div>
  );
}
