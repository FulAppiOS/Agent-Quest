import { useMemo } from 'react';
import type { AgentActivity, AgentState } from '../types/agent';
import { computeSessionReport } from '../report/sessionReport';
import { configDirLabel } from './configDirLabel';
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

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `<$0.01`;
  if (usd < 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(2)}`;
}

function cwdBasename(cwd: string): string {
  const parts = cwd.split('/').filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? cwd;
}

export function SessionReport({ agent }: { agent: AgentState }) {
  const r = useMemo(() => computeSessionReport(agent), [agent]);

  return (
    <div className="report">
      <div className="report-env">
        <span className="report-env-item"><span className="report-env-k">Profile</span> {configDirLabel(agent.configDir)}</span>
        <span className="report-env-item"><span className="report-env-k">Project</span> {agent.cwd.length > 0 ? cwdBasename(agent.cwd) : '—'}</span>
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

      <div className="report-section-title">Economy</div>
      {r.hasTokens ? (
        <div className="report-econ">
          <div className="report-econ-row"><span>Input</span><span>{formatNum(r.tokens.input)}</span></div>
          <div className="report-econ-row"><span>Output</span><span>{formatNum(r.tokens.output)}</span></div>
          <div className="report-econ-row"><span>Cache read</span><span>{formatNum(r.tokens.cacheRead)}</span></div>
          <div className="report-econ-row report-econ-total"><span>Total tokens</span><span>{formatNum(r.tokens.total)}</span></div>
          {r.estCost !== null ? (
            <>
              <div className="report-econ-row"><span>Est. cost</span><span>{formatCost(r.estCost)}<span className="report-est"> est.</span></span></div>
              {r.costPerMin !== null && <div className="report-econ-row"><span>Cost / min</span><span>{formatCost(r.costPerMin)}<span className="report-est"> est.</span></span></div>}
            </>
          ) : (
            <div className="report-muted">Cost estimate unavailable for this model.</div>
          )}
        </div>
      ) : (
        <div className="report-muted">
          {r.source === 'codex'
            ? 'Codex doesn’t report token usage, so cost can’t be shown.'
            : 'No token usage recorded for this session yet.'}
        </div>
      )}
    </div>
  );
}
