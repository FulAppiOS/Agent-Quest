import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  HERO_LABEL_COLOR, SOURCE_BADGE_COLOR, modelBadge, displayActivity, formatTokens, isSubagentAgent, skillShortName,
  type AgentSource, type AgentState, type ContextUsage, type SkillInventory,
} from '../types/agent';
import { HeroAvatar } from './HeroAvatar';
import { SessionReport } from './SessionReport';
import { ContextMeter } from './ContextMeter';
import { configDirLabel } from './configDirLabel';
import { isPath, resolvePath } from './activityFeedUtils';
import { buildSessionJson, buildSessionMarkdown, exportFileName } from '../report/sessionExport';
import { copyText, downloadText } from '../report/download';
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
  return `${mins}m ${secs}s`;
}

/** One line explaining where the context window figure comes from. */
function windowSourceNote(c: ContextUsage, source: AgentSource): string {
  switch (c.windowSource) {
    case 'reported': return `Window reported by ${source === 'codex' ? 'Codex' : 'the CLI'}.`;
    case 'configured': return 'Window from your settings ([1m] model) or AGENT_QUEST_CLAUDE_CONTEXT_WINDOW.';
    case 'inferred': return 'Window inferred from usage: more than 200k tokens in use means the 1M window.';
    case 'default': return 'Default 200k window assumed — set AGENT_QUEST_CLAUDE_CONTEXT_WINDOW if yours differs.';
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
            {isSubagentAgent(agent) && <span className="detail-sub-badge" title={agent.subagentType ?? 'subagent'}>SUBAGENT</span>}
            {showSourceBadge && (
              <span
                className="detail-source-badge"
                style={{
                  color: SOURCE_BADGE_COLOR[agent.source],
                  borderColor: `${SOURCE_BADGE_COLOR[agent.source]}80`,
                  background: `${SOURCE_BADGE_COLOR[agent.source]}14`,
                }}
                aria-label={`source ${agent.source}`}
              >
                {agent.source.toUpperCase()}
              </span>
            )}
          </div>
          <div className="detail-class">
            {isSubagentAgent(agent)
              ? <>{'⚔'} {agent.subagentType ?? 'subagent'} <span className="detail-class-muted">· {agent.heroClass}</span></>
              : agent.heroClass}
          </div>
        </div>
        <button className="detail-close" onClick={onClose} aria-label="Close panel">✕</button>
      </div>

      <div className="detail-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'live'}
          className={`detail-tab ${tab === 'live' ? 'active' : ''}`}
          onClick={() => setTab('live')}
        >Live</button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'report'}
          className={`detail-tab ${tab === 'report' ? 'active' : ''}`}
          onClick={() => setTab('report')}
        >Report</button>
        <span className="detail-export" aria-label="Export this session for AI review">
          <button type="button" className="detail-export-btn" onClick={() => { void onCopyExport(); }} title="Copy a Markdown report of this session to paste into another AI">
            {copied ? 'Copied ✓' : 'Copy MD'}
          </button>
          <button type="button" className="detail-export-btn" onClick={onDownloadMd} title="Download the Markdown report">.md</button>
          <button type="button" className="detail-export-btn" onClick={onDownloadJson} title="Download the raw data as JSON">.json</button>
        </span>
      </div>

      {tab === 'report' ? (
        <div className="detail-body"><SessionReport agent={agent} subagents={children} /></div>
      ) : (
      <div className="detail-body">
        <div className="detail-section">
          <div className="detail-section-title">Status</div>
          <div className="detail-row">
            <span className="detail-label">State</span>
            <span className={`detail-value detail-state status-${agent.status}`}>{displayActivity(agent)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Session</span>
            <span className="detail-value detail-value--num">{formatDuration(agent.sessionStart)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Tool Calls</span>
            <span className="detail-value detail-value--num">{agent.toolCalls.length}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Profile</span>
            <span className="detail-value">{configDirLabel(agent.configDir)}</span>
          </div>
          {(() => {
            const badge = modelBadge(agent.model);
            if (badge === null) return null;
            return (
              <div className="detail-row">
                <span className="detail-label">Model</span>
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
            <div className="detail-section-title">Context</div>
            <ContextMeter context={agent.context} />
            <div className="detail-row detail-row--spaced">
              <span className="detail-label">In use</span>
              <span className="detail-value detail-value--num">
                {formatTokens(agent.context.used)}
                {agent.context.window !== null && <span className="detail-value-suffix">/ {formatTokens(agent.context.window)}</span>}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Peak</span>
              <span className="detail-value detail-value--num">{formatTokens(agent.context.peak)}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Compactions</span>
              <span className={`detail-value detail-value--num ${agent.context.compactions > 0 ? 'detail-value--warn' : ''}`}>{agent.context.compactions}</span>
            </div>
            <div className="detail-note">{windowSourceNote(agent.context, agent.source)}</div>
          </div>
        )}

        {(agent.activeSkill !== undefined || skills.length > 0 || plugins.length > 0 || inventory !== undefined) && (
          <div className="detail-section">
            <div className="detail-section-title">Skills &amp; Plugins</div>
            {agent.activeSkill !== undefined && (
              <div className="detail-row">
                <span className="detail-label">Active skill</span>
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
                      {s.loads}× · ~{formatTokens(s.loadTokens)} tok
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
                      {p.calls} call{p.calls === 1 ? '' : 's'} · ~{formatTokens(p.resultTokens)} tok
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {skills.length === 0 && plugins.length === 0 && agent.activeSkill === undefined && (
              <div className="detail-note">No skills or plugins used yet.</div>
            )}
            {inventory !== undefined && inventory.count > 0 && (
              <div className="detail-note">
                {inventory.count} skills installed (~{formatTokens(inventory.tokens)} tokens if always loaded) ·
                loaded here: {skills.length} (~{formatTokens(loadedTokens)}).
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
              <div className="detail-section-title">Delegation</div>
              <div className="detail-row">
                <span className="detail-label">Subagents</span>
                <span className="detail-value detail-value--num">{live} live <span className="detail-value-suffix">/ {children.length}</span></span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Processed by them</span>
                <span className="detail-value detail-value--num">~{formatTokens(processed)} tok</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Returned here</span>
                <span className="detail-value detail-value--num">~{formatTokens(returned)} tok</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Kept out of this context</span>
                <span className="detail-value detail-value--num detail-value--good">~{formatTokens(Math.max(0, processed - returned))} tok</span>
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
            <div className="detail-section-title">Parent</div>
            {parent !== undefined && (
              <div className="detail-row">
                <span className="detail-label">Spawned by</span>
                <button type="button" className="detail-link-btn" onClick={() => onSelectAgent(parent.id)} style={{ color: HERO_LABEL_COLOR[parent.heroColor] }}>
                  {parent.name}
                </button>
              </div>
            )}
            {agent.context !== undefined && (
              <div className="detail-row">
                <span className="detail-label">Own context peak</span>
                <span className="detail-value detail-value--num">~{formatTokens(agent.context.peak)} tok</span>
              </div>
            )}
            {agent.returnedTokens !== undefined && (
              <div className="detail-row">
                <span className="detail-label">Returned to parent</span>
                <span className="detail-value detail-value--num">~{formatTokens(agent.returnedTokens)} tok</span>
              </div>
            )}
          </div>
        )}

        {currentFile !== undefined && (
          <div className="detail-section">
            <div className="detail-section-title">Current File</div>
            <PathValue path={currentFile} cwd={agent.cwd} className="detail-value detail-value--path" />
          </div>
        )}

        {currentCommand !== undefined && (
          <div className="detail-section">
            <div className="detail-section-title">Current Command</div>
            <div className="detail-value detail-value--path">{currentCommand}</div>
          </div>
        )}

        <div className="detail-section">
          <div className="detail-section-title">Project</div>
          <PathValue path={agent.cwd} cwd={agent.cwd} className="detail-value detail-value--path" />
        </div>

        {lastMessage !== undefined && (
          <div className="detail-section">
            <div className="detail-section-title">Last Message</div>
            <div ref={lastMessageRef} className="detail-last-message collapsed">
              <ReactMarkdown>{lastMessage}</ReactMarkdown>
            </div>
            {messageOverflows && (
              <button
                type="button"
                className="detail-last-message-toggle"
                onClick={() => setModalOpen(true)}
              >
                Show full message
              </button>
            )}
          </div>
        )}

        {agent.filesModified.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-title">Files Modified ({agent.filesModified.length})</div>
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
            <div className="detail-section-title">Errors ({agent.errors.length})</div>
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
        aria-label={`Last message from ${agentName}`}
      >
        <button className="lastmsg-close" onClick={onClose} title="Close (Esc)" aria-label="Close">×</button>
        <div className="lastmsg-header">
          <span className="lastmsg-header-label">Last message from</span>
          <span className="lastmsg-header-name">{agentName}</span>
        </div>
        <div className="lastmsg-body">
          <ReactMarkdown>{message}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
