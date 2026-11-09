import { isXcodeAgent, sourceBadgeLabel } from '../types/sessionIdentity';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  heroClassLabel, HERO_LABEL_COLOR, SOURCE_BADGE_COLOR, modelBadge, displayActivity, formatTokens, isSubagentAgent, skillShortName,
  type AgentSource, type AgentState, type ContextUsage, type SkillInventory,
} from '../types/agent';
import { HeroAvatar } from './HeroAvatar';
import { SessionReport } from './SessionReport';
import { ContextMeter } from './ContextMeter';
import { configDirLabel } from './configDirLabel';
import { isPath, resolvePath } from './activityFeedUtils';
import { buildSessionJson, buildSessionMarkdown, exportFileName } from '../report/sessionExport';
import { copyText, downloadText } from '../report/download';
import { t, useI18n } from '../i18n';
import './DetailPanel.css';

interface DetailPanelProps {
  agent: AgentState;
  /** Every known agent — parents and subagents are looked up here. */
  agents: AgentState[];
  skillInventory: Partial<Record<AgentSource, SkillInventory>>;
  onClose: () => void;
  onSelectAgent: (id: string) => void;
  showSourceBadge: boolean;
}

const LIVE_STATUSES = new Set<AgentState['status']>(['active', 'waiting', 'idle']);

function formatDuration(startMs: number): string {
  const elapsed = Math.floor((Date.now() - startMs) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return t('detail.duration', { mins, secs });
}

/** One line explaining where the context window figure comes from. */
function windowSourceNote(c: ContextUsage, source: AgentSource): string {
  switch (c.windowSource) {
    case 'reported': return source === 'codex' ? t('detail.windowReportedCodex') : t('detail.windowReportedCli');
    case 'configured': return t('detail.windowConfigured');
    case 'inferred': return t('detail.windowInferred');
    case 'default': return t('detail.windowDefault');
  }
}

function PathValue({ path, cwd, className }: { path: string; cwd: string; className?: string }) {
  if (!isPath(path)) {
    return <span className={className}>{path}</span>;
  }
  const absolute = resolvePath(path, cwd);
  if (absolute === null) {
    return <span className={className}>{path}</span>;
  }
  return (
    <a
      href={`vscode://file${encodeURI(absolute)}`}
      className={`${className ?? ''} detail-path-link`}
      title={absolute}
    >{path}</a>
  );
}

export function DetailPanel({ agent, agents, skillInventory, onClose, onSelectAgent, showSourceBadge }: DetailPanelProps) {
  const { t } = useI18n();
  // Tick every second so duration-derived values refresh between server pushes.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const [tab, setTab] = useState<'live' | 'report'>('live');
  // Reset to the live tab when switching to a different agent.
  useEffect(() => { setTab('live'); }, [agent.id]);
  const [copied, setCopied] = useState(false);

  const isLive = agent.status === 'active' || agent.status === 'waiting';
  const currentFile = isLive ? agent.currentFile : undefined;
  const currentCommand = isLive ? agent.currentCommand : undefined;
  const lastMessage = isLive ? agent.lastMessage : undefined;

  const children = agents.filter((a) => a.parentId === agent.id && isSubagentAgent(a));
  const parent = agent.parentId !== undefined ? agents.find((a) => a.id === agent.parentId) : undefined;
  const skills = agent.skills ?? [];
  const plugins = agent.plugins ?? [];
  const inventory = skillInventory[agent.source];
  const loadedTokens = skills.reduce((sum, s) => sum + s.loadTokens, 0);

  // AI-review export of this session (plus its subagents): Markdown to paste
  // into another AI, or files to attach.
  const exportMarkdown = () => buildSessionMarkdown(agent, children, inventory);
  const onCopyExport = async () => {
    const ok = await copyText(exportMarkdown());
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 1800);
  };
  const onDownloadMd = () => downloadText(exportFileName(agent.name, 'md'), exportMarkdown(), 'text/markdown');
  const onDownloadJson = () => downloadText(exportFileName(agent.name, 'json'), JSON.stringify(buildSessionJson(agent, children), null, 2), 'application/json');

  // Last-message overflow detection: the panel itself never grows — when the
  // rendered markdown exceeds the collapsed CSS height we reveal a button
  // that opens a full-size modal with the complete text.
  const lastMessageRef = useRef<HTMLDivElement | null>(null);
  const [messageOverflows, setMessageOverflows] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  // Re-measure whenever the message or the agent changes; also close any stale
  // modal if the user selects a different hero.
  useEffect(() => {
    setModalOpen(false);
  }, [agent.id, lastMessage]);
  useLayoutEffect(() => {
    const el = lastMessageRef.current;
    if (el === null || lastMessage === undefined) {
      setMessageOverflows(false);
      return;
    }
    setMessageOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [lastMessage, agent.id]);

  return (
    <>
    <div className="detail-panel">
      <div className="detail-topbar">
        <span className="detail-avatar-wrap">
          <HeroAvatar agent={agent} size={44} />
          <span className={`detail-status-overlay ${agent.status}`} aria-hidden="true" />
        </span>
        <div className="detail-topbar-body">
          <div className="detail-name-row">
            <span className="detail-name" style={{ color: HERO_LABEL_COLOR[agent.heroColor] }}>{agent.name}</span>
            {isSubagentAgent(agent) && <span className="detail-sub-badge" title={agent.subagentType ?? t('hero.subagent')}>SUBAGENT</span>}
            {(showSourceBadge || isXcodeAgent(agent)) && (
              <span
                className="detail-source-badge"
                style={{
                  color: SOURCE_BADGE_COLOR[agent.source],
                  borderColor: `${SOURCE_BADGE_COLOR[agent.source]}80`,
                  background: `${SOURCE_BADGE_COLOR[agent.source]}14`,
                }}
                aria-label={t('detail.sourceAria', { label: sourceBadgeLabel(agent), source: agent.source })}
              >
                {sourceBadgeLabel(agent)}
              </span>
            )}
          </div>
          <div className="detail-class">
            {isSubagentAgent(agent)
              ? <>{'⚔'} {agent.subagentType ?? t('hero.subagent')} <span className="detail-class-muted">· {heroClassLabel(agent.heroClass)}</span></>
              : heroClassLabel(agent.heroClass)}
          </div>
        </div>
        <button className="detail-close" onClick={onClose} aria-label={t('detail.closePanel')}>✕</button>
      </div>

      <div className="detail-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'live'}
          className={`detail-tab ${tab === 'live' ? 'active' : ''}`}
          onClick={() => setTab('live')}
        >{t('detail.tabLive')}</button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'report'}
          className={`detail-tab ${tab === 'report' ? 'active' : ''}`}
          onClick={() => setTab('report')}
        >{t('detail.tabReport')}</button>
        <span className="detail-export" aria-label={t('detail.exportAria')}>
          <button type="button" className="detail-export-btn" onClick={() => { void onCopyExport(); }} title={t('detail.copyMdTitle')}>
            {copied ? t('common.copied') : t('detail.copyMd')}
          </button>
          <button type="button" className="detail-export-btn" onClick={onDownloadMd} title={t('detail.downloadMdTitle')}>.md</button>
          <button type="button" className="detail-export-btn" onClick={onDownloadJson} title={t('detail.downloadJsonTitle')}>.json</button>
        </span>
      </div>

      {tab === 'report' ? (
        <div className="detail-body"><SessionReport agent={agent} subagents={children} /></div>
      ) : (
      <div className="detail-body">
        <div className="detail-section">
          <div className="detail-section-title">{t('detail.sectionStatus')}</div>
          <div className="detail-row">
            <span className="detail-label">{t('detail.labelState')}</span>
            <span className={`detail-value detail-state status-${agent.status}`}>{displayActivity(agent)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">{t('detail.labelSession')}</span>
            <span className="detail-value detail-value--num">{formatDuration(agent.sessionStart)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">{t('detail.labelToolCalls')}</span>
            <span className="detail-value detail-value--num">{agent.toolCalls.length}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">{t('detail.labelProfile')}</span>
            <span className="detail-value">{configDirLabel(agent.configDir)}</span>
          </div>
          {(() => {
            const badge = modelBadge(agent.model);
            if (badge === null) return null;
            return (
              <div className="detail-row">
                <span className="detail-label">{t('detail.labelModel')}</span>
                <span className="detail-value detail-model-value">
                  <span
                    className="detail-model-badge"
                    style={{
                      color: badge.color,
                      borderColor: `${badge.color}80`,
                      background: `${badge.color}14`,
                    }}
                  >
                    {badge.short}
                  </span>
                  <span className="detail-model-id" title={agent.model}>{agent.model}</span>
                </span>
              </div>
            );
          })()}
        </div>

        {agent.context !== undefined && (
          <div className="detail-section">
            <div className="detail-section-title">{t('detail.sectionContext')}</div>
            <ContextMeter context={agent.context} />
            <div className="detail-row detail-row--spaced">
              <span className="detail-label">{t('detail.labelInUse')}</span>
              <span className="detail-value detail-value--num">
                {formatTokens(agent.context.used)}
                {agent.context.window !== null && <span className="detail-value-suffix">/ {formatTokens(agent.context.window)}</span>}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">{t('detail.labelPeak')}</span>
              <span className="detail-value detail-value--num">{formatTokens(agent.context.peak)}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">{t('detail.labelCompactions')}</span>
              <span className={`detail-value detail-value--num ${agent.context.compactions > 0 ? 'detail-value--warn' : ''}`}>{agent.context.compactions}</span>
            </div>
            <div className="detail-note">{windowSourceNote(agent.context, agent.source)}</div>
          </div>
        )}

        {(agent.activeSkill !== undefined || skills.length > 0 || plugins.length > 0 || inventory !== undefined) && (
          <div className="detail-section">
            <div className="detail-section-title">{t('detail.sectionSkills')}</div>
            {agent.activeSkill !== undefined && (
              <div className="detail-row">
                <span className="detail-label">{t('detail.labelActiveSkill')}</span>
                <span className="detail-skill-pill" title={agent.activeSkill}>{'✦'} {skillShortName(agent.activeSkill)}</span>
              </div>
            )}
            {skills.length > 0 && (
              <ul className="detail-usage-list">
                {skills.map((s) => (
                  <li key={s.name} className="detail-usage-row" title={s.name}>
                    <span className="detail-usage-name">
                      {'✦'} {skillShortName(s.name)}
                      {s.plugin !== undefined && <span className="detail-usage-tag">{s.plugin}</span>}
                    </span>
                    <span className="detail-usage-stat">
                      {t('detail.skillLoads', { loads: s.loads, tokens: formatTokens(s.loadTokens) })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {plugins.length > 0 && (
              <ul className="detail-usage-list">
                {plugins.map((p) => (
                  <li key={`${p.kind}:${p.name}`} className="detail-usage-row" title={`${p.kind}: ${p.name}`}>
                    <span className="detail-usage-name">
                      {'⚙'} {p.name}
                      <span className="detail-usage-tag">{p.kind}</span>
                    </span>
                    <span className="detail-usage-stat">
                      {t('detail.pluginCalls', { count: p.calls, tokens: formatTokens(p.resultTokens) })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {skills.length === 0 && plugins.length === 0 && agent.activeSkill === undefined && (
              <div className="detail-note">{t('detail.noSkillsYet')}</div>
            )}
            {inventory !== undefined && inventory.count > 0 && (
              <div className="detail-note">
                {t('detail.inventoryNote', { count: inventory.count, tokens: formatTokens(inventory.tokens), loaded: skills.length, loadedTokens: formatTokens(loadedTokens) })}
              </div>
            )}
          </div>
        )}

        {children.length > 0 && (() => {
          const live = children.filter((c) => LIVE_STATUSES.has(c.status)).length;
          const processed = children.reduce((sum, c) => sum + (c.context?.peak ?? 0), 0);
          const returned = children.reduce((sum, c) => sum + (c.returnedTokens ?? 0), 0);
          return (
            <div className="detail-section">
              <div className="detail-section-title">{t('detail.sectionDelegation')}</div>
              <div className="detail-row">
                <span className="detail-label">{t('detail.labelSubagents')}</span>
                <span className="detail-value detail-value--num">{t('detail.subagentsLive', { count: live })} <span className="detail-value-suffix">/ {children.length}</span></span>
              </div>
              <div className="detail-row">
                <span className="detail-label">{t('detail.labelProcessedByThem')}</span>
                <span className="detail-value detail-value--num">{t('detail.approxTokens', { tokens: formatTokens(processed) })}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">{t('detail.labelReturnedHere')}</span>
                <span className="detail-value detail-value--num">{t('detail.approxTokens', { tokens: formatTokens(returned) })}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">{t('detail.labelKeptOut')}</span>
                <span className="detail-value detail-value--num detail-value--good">{t('detail.approxTokens', { tokens: formatTokens(Math.max(0, processed - returned)) })}</span>
              </div>
              <ul className="detail-usage-list">
                {children.map((c) => (
                  <li key={c.id} className="detail-usage-row">
                    <button type="button" className="detail-link-btn" onClick={() => onSelectAgent(c.id)} title={c.id}>
                      {'⚔'} {c.name}
                    </button>
                    <span className={`detail-usage-stat status-${c.status}`}>{displayActivity(c)}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}

        {isSubagentAgent(agent) && (parent !== undefined || agent.returnedTokens !== undefined) && (
          <div className="detail-section">
            <div className="detail-section-title">{t('detail.sectionParent')}</div>
            {parent !== undefined && (
              <div className="detail-row">
                <span className="detail-label">{t('detail.labelSpawnedBy')}</span>
                <button type="button" className="detail-link-btn" onClick={() => onSelectAgent(parent.id)} style={{ color: HERO_LABEL_COLOR[parent.heroColor] }}>
                  {parent.name}
                </button>
              </div>
            )}
            {agent.context !== undefined && (
              <div className="detail-row">
                <span className="detail-label">{t('detail.labelOwnContextPeak')}</span>
                <span className="detail-value detail-value--num">{t('detail.approxTokens', { tokens: formatTokens(agent.context.peak) })}</span>
              </div>
            )}
            {agent.returnedTokens !== undefined && (
              <div className="detail-row">
                <span className="detail-label">{t('detail.labelReturnedToParent')}</span>
                <span className="detail-value detail-value--num">{t('detail.approxTokens', { tokens: formatTokens(agent.returnedTokens) })}</span>
              </div>
            )}
          </div>
        )}

        {currentFile !== undefined && (
          <div className="detail-section">
            <div className="detail-section-title">{t('detail.sectionCurrentFile')}</div>
            <PathValue path={currentFile} cwd={agent.cwd} className="detail-value detail-value--path" />
          </div>
        )}

        {currentCommand !== undefined && (
          <div className="detail-section">
            <div className="detail-section-title">{t('detail.sectionCurrentCommand')}</div>
            <div className="detail-value detail-value--path">{currentCommand}</div>
          </div>
        )}

        <div className="detail-section">
          <div className="detail-section-title">{t('detail.sectionProject')}</div>
          <PathValue path={agent.cwd} cwd={agent.cwd} className="detail-value detail-value--path" />
        </div>

        {lastMessage !== undefined && (
          <div className="detail-section">
            <div className="detail-section-title">{t('detail.sectionLastMessage')}</div>
            <div ref={lastMessageRef} className="detail-last-message collapsed">
              <ReactMarkdown>{lastMessage}</ReactMarkdown>
            </div>
            {messageOverflows && (
              <button
                type="button"
                className="detail-last-message-toggle"
                onClick={() => setModalOpen(true)}
              >
                {t('detail.showFullMessage')}
              </button>
            )}
          </div>
        )}

        {agent.filesModified.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-title">{t('detail.sectionFilesModified', { count: agent.filesModified.length })}</div>
            <ul className="detail-file-list">
              {agent.filesModified.slice(-10).map((f) => (
                <li key={f} title={f}>
                  <PathValue path={f} cwd={agent.cwd} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {agent.errors.length > 0 && (
          <div className="detail-section detail-section--errors">
            <div className="detail-section-title">{t('detail.sectionErrors', { count: agent.errors.length })}</div>
            {agent.errors.slice(-3).map((e, i) => (
              <div key={i} className="detail-value detail-value--error">{e}</div>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
    {modalOpen && lastMessage !== undefined && (
      <LastMessageModal
        agentName={agent.name}
        message={lastMessage}
        onClose={() => setModalOpen(false)}
      />
    )}
    </>
  );
}

interface LastMessageModalProps {
  agentName: string;
  message: string;
  onClose: () => void;
}

function LastMessageModal({ agentName, message, onClose }: LastMessageModalProps) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="lastmsg-backdrop" onClick={onClose}>
      <div
        className="lastmsg-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t('detail.lastMessageAria', { name: agentName })}
      >
        <button className="lastmsg-close" onClick={onClose} title={t('common.closeEsc')} aria-label={t('common.close')}>×</button>
        <div className="lastmsg-header">
          <span className="lastmsg-header-label">{t('detail.lastMessageFrom')}</span>
          <span className="lastmsg-header-name">{agentName}</span>
        </div>
        <div className="lastmsg-body">
          <ReactMarkdown>{message}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
