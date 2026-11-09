import { isXcodeAgent } from '../types/sessionIdentity';
import { useMemo } from 'react';
import { activityLabel, formatTokens, skillShortName, type AgentActivity, type AgentState } from '../types/agent';
import { computeSessionReport } from '../report/sessionReport';
import { configDirLabel } from './configDirLabel';
import { ContextMeter } from './ContextMeter';
import { t, useI18n } from '../i18n';
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
  if (h > 0) return t('sessionReport.durationHours', { hours: h, minutes: m });
  if (m > 0) return t('sessionReport.durationMinutes', { minutes: m, seconds: sec });
  return t('sessionReport.durationSeconds', { seconds: sec });
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
  useI18n();
  const r = useMemo(() => computeSessionReport(agent, subagents), [agent, subagents]);

  return (
    <div className="report">
      <div className="report-env">
        <span className="report-env-item"><span className="report-env-k">{t('sessionReport.profile')}</span> {configDirLabel(agent.configDir)}</span>
        <span className="report-env-item"><span className="report-env-k">{t('sessionReport.project')}</span> {isXcodeAgent(agent) && !agent.isSubagent ? agent.name : agent.cwd.length > 0 ? cwdBasename(agent.cwd) : '—'}</span>
        {agent.model !== undefined && <span className="report-env-item"><span className="report-env-k">{t('sessionReport.model')}</span> {agent.model}</span>}
      </div>

      <div className="report-stats">
        <div className="report-stat"><span className="report-stat-v">{formatDuration(r.durationMs)}</span><span className="report-stat-k">{t('sessionReport.statDuration')}</span></div>
        <div className="report-stat"><span className="report-stat-v">{r.toolTotal}</span><span className="report-stat-k">{t('sessionReport.statToolCalls')}</span></div>
        <div className="report-stat"><span className="report-stat-v">{r.filesModified}</span><span className="report-stat-k">{t('sessionReport.statFiles')}</span></div>
        <div className="report-stat"><span className={`report-stat-v ${r.errorCount > 0 ? 'is-err' : ''}`}>{r.errorCount}</span><span className="report-stat-k">{t('sessionReport.statErrors')}</span></div>
      </div>

      <div className="report-section-title">{t('sessionReport.sectionActivity')}</div>
      {r.byActivity.length === 0 ? (
        <div className="report-empty">{t('sessionReport.noActivity')}</div>
      ) : (
        <div className="report-bars">
          {r.byActivity.map((s) => (
            <div className="report-bar-row" key={s.activity}>
              <span className="report-bar-label">{activityLabel(s.activity)}</span>
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
          <div className="report-section-title">{t('sessionReport.sectionTopTools')}</div>
          <div className="report-tools">
            {r.topTools.map((tool) => (
              <span className="report-tool" key={tool.name}>{tool.name} <span className="report-tool-n">{tool.count}</span></span>
            ))}
          </div>
        </>
      )}

      {r.context !== undefined && (
        <>
          <div className="report-section-title">{t('sessionReport.sectionContext')}</div>
          <ContextMeter context={agent.context} />
          <div className="report-econ report-econ--spaced">
            <div className="report-econ-row"><span>{t('sessionReport.contextInUse')}</span><span>{formatTokens(r.context.used)}{r.context.window !== null ? ` / ${formatTokens(r.context.window)}` : ''}</span></div>
            <div className="report-econ-row"><span>{t('sessionReport.contextPeak')}</span><span>{formatTokens(r.context.peak)}</span></div>
            <div className="report-econ-row"><span>{t('sessionReport.contextCompactions')}</span><span>{r.context.compactions}</span></div>
          </div>
        </>
      )}

      {r.skills.length > 0 && (
        <>
          <div className="report-section-title">{t('sessionReport.sectionSkills')}</div>
          <div className="report-econ">
            {r.skills.map((s) => (
              <div className="report-econ-row" key={s.name} title={s.name}>
                <span>{'✦'} {skillShortName(s.name)}{s.plugin !== undefined ? <span className="report-est"> {s.plugin}</span> : null}</span>
                <span>{s.loads}× · ~{formatTokens(s.loadTokens)}{s.attributedMessages > 0 ? ` · ${t('sessionReport.skillMessages', { count: s.attributedMessages })}` : ''}</span>
              </div>
            ))}
          </div>
          <div className="report-muted report-tokens-note">{t('sessionReport.skillsNote')}</div>
        </>
      )}

      {r.plugins.length > 0 && (
        <>
          <div className="report-section-title">{t('sessionReport.sectionPlugins')}</div>
          <div className="report-econ">
            {r.plugins.map((p) => (
              <div className="report-econ-row" key={`${p.kind}:${p.name}`} title={`${p.kind}: ${p.name}`}>
                <span>{'⚙'} {p.name} <span className="report-est">{p.kind}</span></span>
                <span>{t('sessionReport.pluginCalls', { count: p.calls })} · ~{formatTokens(p.resultTokens)}</span>
              </div>
            ))}
          </div>
          <div className="report-muted report-tokens-note">{t('sessionReport.pluginsNote')}</div>
        </>
      )}

      {r.delegation !== undefined && (
        <>
          <div className="report-section-title">{t('sessionReport.sectionDelegation')}</div>
          <div className="report-econ">
            <div className="report-econ-row"><span>{t('sessionReport.subagents')}</span><span>{t('sessionReport.subagentsLive', { live: r.delegation.live, total: r.delegation.count })}</span></div>
            <div className="report-econ-row"><span>{t('sessionReport.processedByThem')}</span><span>~{formatTokens(r.delegation.childPeakTokens)}</span></div>
            <div className="report-econ-row"><span>{t('sessionReport.returnedHere')}</span><span>~{formatTokens(r.delegation.returnedTokens)}</span></div>
            <div className="report-econ-row report-econ-total"><span>{t('sessionReport.keptOut')}</span><span>~{formatTokens(r.delegation.keptOutTokens)}</span></div>
          </div>
        </>
      )}

      {/* Tokens — Claude only. Codex doesn't report per-message usage, so the
          section is omitted entirely for it (no misleading empty rows). */}
      {r.hasTokens ? (
        <>
          <div className="report-section-title">{t('sessionReport.sectionTokens')}</div>
          <div className="report-econ">
            <div className="report-econ-row"><span>{t('sessionReport.tokensInput')}</span><span>{formatTokens(r.tokens.input)}</span></div>
            <div className="report-econ-row"><span>{t('sessionReport.tokensOutput')}</span><span>{formatTokens(r.tokens.output)}</span></div>
            <div className="report-econ-row"><span>{t('sessionReport.tokensCacheRead')}</span><span>{formatTokens(r.tokens.cacheRead)}</span></div>
            <div className="report-econ-row"><span>{t('sessionReport.tokensCacheWrite')}</span><span>{formatTokens(r.tokens.cacheWrite)}</span></div>
            <div className="report-econ-row report-econ-total"><span>{t('sessionReport.tokensTotal')}</span><span>{formatTokens(r.tokens.total)}</span></div>
          </div>
          <div className="report-muted report-tokens-note">{t('sessionReport.tokensNote')}</div>
        </>
      ) : r.source === 'claude' ? (
        <>
          <div className="report-section-title">{t('sessionReport.sectionTokens')}</div>
          <div className="report-muted">{t('sessionReport.noTokens')}</div>
        </>
      ) : null}
    </div>
  );
}
