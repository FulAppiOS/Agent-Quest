# Cursor Provider — Design Spec (implementation plan)

**Date:** 2026-08-24
**Status:** approved — ready for implementation
**Scope:** add Cursor (IDE agents) as a third provider beside `ClaudeProvider` and `CodexProvider`

This document is written to be executable step-by-step by an AI implementer
with limited reasoning. Follow the steps in order. Do not deviate from the
contracts. Do not refactor existing code beyond what is listed.

---

## 1. Background

Agent Quest reads agent session logs from disk and turns them into heroes.
Claude Code writes `~/.claude*/projects/**/*.jsonl`; Codex writes
`~/.codex/sessions/**/rollout-*.jsonl`. This spec adds a third source:

```
~/.cursor/projects/<encoded-project-path>/agent-transcripts/<uuid>/<uuid>.jsonl
```

Cursor (the IDE) writes one JSONL transcript per agent chat, appended live
while the agent works. The format was verified empirically on a real
installation on 2026-08-24 (120 transcripts, ~25k tool calls scanned).

## 2. Data format (as observed on disk)

### 2.1 Directory layout

- `~/.cursor/projects/` — one subdirectory per opened project.
- Project dir name = the project's absolute path with `/` replaced by `-`
  (e.g. `/Volumes/ExtremeSSD/projects/Agent-Quest` →
  `Volumes-ExtremeSSD-projects-Agent-Quest`). **Ambiguous**: `-` is also a
  valid path character. Decode per §4.
- Inside: `agent-transcripts/<uuid>/<uuid>.jsonl` — one folder + one JSONL
  file per agent chat. Sibling folders (`canvases/`, `mcps/`) must be ignored.

### 2.2 JSONL line shapes (exhaustive)

Top-level key sets observed (only these three exist):

1. **Message line** — keys `{role, message}`:

```json
{"role":"user","message":{"content":[{"type":"text","text":"..."}]}}
{"role":"assistant","message":{"content":[{"type":"text","text":"..."},{"type":"tool_use","name":"Read","input":{"path":"/x/y.ts"}}]}}
```

   - `role`: `"user"` or `"assistant"`.
   - `message.content`: array of blocks. Block types observed: `text`,
     `tool_use` **only** (no `tool_result` — Cursor transcripts carry no
     tool results and no error markers, so `hasError` is never derivable).
   - `tool_use` blocks have `name` and `input` but **no `id`** field.
   - No per-line timestamp exists anywhere in the file.

2. **Turn-end line** — keys `{type, status}` (and `error` when failed):

```json
{"type":"turn_ended","status":"success"}
{"type":"turn_ended","status":"error","error":"User aborted request"}
```

3. Anything else → unknown, drop (return `null`).

### 2.3 Consequences

- **Timestamps**: none in-file. The provider must stamp every `ParsedEvent`
  with the file's `mtime` captured at read time (see §5.3).
- **Session id**: the `<uuid>` (file basename without `.jsonl`). It is unique
  per chat. Pass it as `sessionId` to the parser; the state manager uses it
  verbatim.
- **cwd**: decoded from the project dir name (§4). There is no in-file cwd.
- **No tokens, no model, no subagents** in Cursor transcripts. Token usage
  stays zero; the SessionReport UI already omits the token section for
  non-Claude sources (§6.5).

## 3. Type changes (shared between server and client)

**IMPORTANT**: `server/src/types.ts` and `client/src/types/agent.ts` mirror
each other. Both MUST get the identical change.

### 3.1 `server/src/types.ts`

Current:

```ts
export const AGENT_SOURCES = ['claude', 'codex'] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];
```

Change to:

```ts
export const AGENT_SOURCES = ['claude', 'codex', 'cursor'] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];
```

Also update the comment on `AgentState.source` (line ~62) to:

```ts
  source: AgentSource;    // 'claude' | 'codex' | 'cursor' — which client/CLI produced this session
```

And the comment on `SessionMeta` / pidfile section stays as-is (it already
says "Claude Code only").

### 3.2 `client/src/types/agent.ts`

Same `AGENT_SOURCES` change (line ~15). Then extend the badge color map
(line ~24):

```ts
export const SOURCE_BADGE_COLOR: Record<AgentSource, string> = {
  claude: '#FF9F4A', // orange
  codex:  '#7ED9CF', // teal
  cursor: '#7CB8F7', // sky blue
};
```

## 4. New file: `server/src/parsers/cursor-parser.ts`

Pure functions only (no filesystem access) so they are unit-testable,
mirroring `codex-parser.ts` structure.

### 4.1 Tool → activity mapping

```ts
const READING_TOOLS = new Set(['Read', 'ReadFile', 'Grep', 'Glob', 'rg']);
const EDITING_TOOLS = new Set(['Write', 'StrReplace', 'Edit', 'ApplyPatch', 'Delete']);
const REVIEWING_TOOLS = new Set(['Task', 'Subagent']);
const GIT_COMMAND_PATTERN = /\bgit\s+(commit|push|merge|rebase|cherry-pick)\b/;
```

Resolution order for a `tool_use` named `N` with input `I`:

1. `N` in `READING_TOOLS` → `reading`
2. `N` in `EDITING_TOOLS` → `editing`
3. `N` in `REVIEWING_TOOLS` → `reviewing`
4. `N === 'Shell'` (or `'Bash'`): command string = `I.command` (if string).
   If `GIT_COMMAND_PATTERN` matches → `git`, else `bash`
5. everything else (MCP tools, `TodoWrite`, `WebFetch`, `WebSearch`,
   `AskQuestion`, `CallMcpTool`, unknown…) → `thinking`

### 4.2 Exported API

```ts
export interface CursorLineMeta {
  sessionId: string;
  cwd: string;
  timestamp: number; // provider stamps this (file mtime at read time)
}

/** Parse one JSONL line. Returns null for noise/unknown/malformed lines. */
export function parseCursorLine(raw: string, meta: CursorLineMeta): ParsedEvent | null;

/** Parse a whole file (used on first sight / session start). */
export function parseCursorFile(contents: string, meta: CursorLineMeta): ParsedEvent[];

/**
 * Decode a project dir name into an absolute cwd path.
 * Greedy left-to-right: starting from '/', try the longest dash-joined
 * segment prefix whose path exists on disk (via existsSync), descend into
 * it and repeat with the remaining parts. If at some step no existing
 * directory matches, join ALL remaining parts with '-' into the current
 * path (unverifiable tail) and stop.
 * Always returns a string starting with '/'.
 */
export function decodeProjectDir(name: string): string;
```

`decodeProjectDir` MUST be injectable for tests — implement it as:

```ts
export function decodeProjectDir(name: string, exists?: (p: string) => boolean): string
```

where `exists` defaults to `node:fs.existsSync`. Tests pass a fake.

### 4.3 `parseCursorLine` behavior (exact contract)

Input line → output (or `null`):

| Line | Output |
|---|---|
| malformed JSON | `null` |
| `role === 'user'` | One `ParsedEvent` with `kind: 'task'`, `activity: 'thinking'`, `currentTask` = concatenation of all `text` block texts (joined with `'\n'`; strip nothing). If the user message contains `<user_query>…</user_query>`, extract the inner text as `currentTask` instead (regex `/<user_query>\s*([\s\S]*?)\s*<\/user_query>/`). Empty result → `null`. `toolCalls: []`, `cwd: meta.cwd`, `timestamp: meta.timestamp`, `slug: undefined`. |
| `role === 'assistant'` | Emit ONE event per `tool_use` block? **No.** Emit a SINGLE event containing all `tool_use` blocks as `toolCalls` (the state manager handles batches). `activity` = activity of the FIRST `tool_use` block (by mapping §4.1); if the line has no `tool_use` blocks (text-only) → event with `activity: 'thinking'`, `toolCalls: []`, `isTurnEnd: false`, `lastMessage` = concatenation of `text` blocks (may be `undefined` when no text). For each tool call build `ToolCall { id: \`cursor-${meta.timestamp}-${index}\`, name, timestamp: meta.timestamp, input }`. `file`/`command` detail: from the first tool call — for file tools use `input.path ?? input.file_path` (string only); for Shell use `input.command`; else `undefined`. `kind: 'tool'`, `cwd: meta.cwd`. |
| `type === 'turn_ended'` | Event with `kind: 'tool'`, `activity: 'idle'`, `toolCalls: []`, `isTurnEnd: true`, `hasError: (status !== 'success')`, `cwd: meta.cwd`, `timestamp: meta.timestamp`. |
| anything else | `null` |

Do NOT set `usage`, `usageMessageId`, or `model` on any Cursor event.

### 4.4 `parseCursorFile`

Split on `'\n'`, skip blank lines, run `parseCursorLine` per line, collect
non-null results. Same shape as `parseCodexFile`.

## 5. New file: `server/src/providers/cursor-provider.ts`

Mirror `codex-provider.ts` exactly in structure (class `CursorProvider
implements SessionProvider`, `readonly source: AgentSource = 'cursor'`).

### 5.1 Options

```ts
export interface CursorProviderOptions {
  /** Defaults to `~/.cursor`. */
  cursorRoot?: string;
  /** How often to rescan. Default 3000ms. */
  scanIntervalMs?: number;
  /** Ignore transcript files whose mtime is older than this when first seen. Default 3h. */
  maxAgeMs?: number;
}
```

### 5.2 `start(handlers)`

1. `stat(cursorRoot)`. Missing → `console.log('[CursorProvider] ${cursorRoot} not found — provider inactive')`,
   set nothing, return (same pattern as CodexProvider). Otherwise
   `rootExists = true`.
2. `await this.scan()` then `setInterval(() => this.scan().catch(...), scanIntervalMs)`.
3. `console.log('[CursorProvider] watching ${cursorRoot} every ${scanIntervalMs}ms')`.

`stop()`, `getConfigDirs()` (return `[cursorRoot]` only when `rootExists`)
copy CodexProvider, including the re-entrancy guard (`private scanning`).

### 5.3 `scan()`

Re-entrancy guard as in CodexProvider. Then:

1. List `join(cursorRoot, 'projects')` entries (directories only). If the
   dir is missing → return.
2. **Cap**: sort project dirs by mtime desc, keep the first 20. (There can
   be hundreds of stale project dirs; only recent ones matter.)
3. For each kept project dir: `decodeProjectDir(dirname)` → `projectCwd`.
   Then walk `join(projectDir, 'agent-transcripts')` at depth ≤ 2 collecting
   every `*.jsonl` file.
4. For each file: `processFile(filePath, projectCwd)`.

### 5.4 `processFile(filePath, projectCwd)`

Track files in `private tracked = new Map<string, { sessionId: string; cwd: string; size: number }>()`,
same as CodexProvider.

1. `stat` the file; skip on error.
2. **First sight**:
   - Age (`now - mtimeMs`) > `maxAgeMs` → store sentinel
     `{ sessionId: '', cwd: projectCwd, size: s.size }`, return (same
     resume-later pattern as Codex).
   - Read the whole file. `sessionId` = basename of the file minus `.jsonl`.
     Events = `parseCursorFile(contents, { sessionId, cwd: projectCwd, timestamp: Date.now() })`.
   - Store `{ sessionId, cwd: projectCwd, size: s.size }`.
   - `handlers.onSessionStart({ source: 'cursor', sessionId, configDir: this.cursorRoot, events })`.
   - Return.
3. **Follow-up**: if `s.size <= tracked.size` return. If sentinel
   (`sessionId === ''`): delete entry, re-call `processFile` (single hop),
   return.
4. Slice new bytes `tracked.size → s.size`, cut at the last `'\n'` (partial
   line guard — identical to CodexProvider). Parse the complete chunk with
   `parseCursorLine` per line, **stamping `timestamp: s.mtimeMs`** (use the
   stat result of this scan so events share the observed write time).
5. Advance `tracked.size += Buffer.byteLength(complete, 'utf8')`.
6. If any events → `handlers.onSessionEvents({ source: 'cursor', sessionId, configDir: this.cursorRoot, events })`.

**Timestamp note**: first-sight events use `Date.now()` (file just read);
incremental events use the current scan's `s.mtimeMs`. Both are fine for
`lastEvent` arithmetic since they are wall-clock at read time.

## 6. Server wiring: `server/src/index.ts`

Apply these exact changes:

1. Import: `import { CursorProvider } from './providers/cursor-provider';`
2. After `const codexProvider = new CodexProvider({ maxAgeMs: SESSION_MAX_AGE_MS });`
   add:

   ```ts
   const cursorProvider = new CursorProvider({ maxAgeMs: SESSION_MAX_AGE_MS });
   ```
3. `allConfigDirs()` becomes:

   ```ts
   function allConfigDirs(): string[] {
     return [...claudeProvider.getConfigDirs(), ...codexProvider.getConfigDirs(), ...cursorProvider.getConfigDirs()];
   }
   ```
4. In the boot sequence, after `await codexProvider.start(providerHandlers);`
   add `await cursorProvider.start(providerHandlers);`
5. Update the "no install detected" warning string to:
   `'[Server] WARNING: no Claude Code, Codex or Cursor installation detected. Start a session with any of them to see heroes here.'`
6. Update the `SessionRegistry` seed comment block (lines ~213-220) to keep
   saying Claude-only; no code change there.

## 7. Server tests (new files, `bun test`)

### 7.1 `server/src/parsers/cursor-parser.test.ts`

Cover at minimum:

- `parseCursorLine` user message → `kind: 'task'`, `currentTask` extracted
  from `<user_query>` when present.
- `parseCursorLine` assistant with two `tool_use` blocks → one event,
  `toolCalls.length === 2`, activity = first tool's mapping.
- `parseCursorLine` assistant text-only → `activity: 'thinking'`,
  `lastMessage` set.
- Tool mapping: `Read`→reading, `StrReplace`→editing, `Shell`→bash,
  `Shell` with `git commit`→git, `Task`→reviewing, `CallMcpTool`→thinking.
- `turn_ended` success → `isTurnEnd: true`, `hasError: false`.
- `turn_ended` error → `hasError: true`.
- Malformed JSON line → `null`; unknown top-level shape → `null`.
- `decodeProjectDir` with fake `exists`:
  - `decodeProjectDir('Volumes-ExtremeSSD-projects-Agent-Quest', fake)` where
    fake confirms `/Volumes`, `/Volumes/ExtremeSSD`,
    `/Volumes/ExtremeSSD/projects`, and
    `/Volumes/ExtremeSSD/projects/Agent-Quest` → returns
    `/Volumes/ExtremeSSD/projects/Agent-Quest`.
  - Fallback: when `exists` returns false for everything, returns
    `'/Volumes-ExtremeSSD-projects-Agent-Quest'` (all parts joined).

### 7.2 `server/src/providers/cursor-provider.test.ts`

Mirror `codex-provider.test.ts` style (`mkdtempSync`, manual `scan()` calls,
`scanIntervalMs: 60_000` so no auto-poll):

- `new CursorProvider().source === 'cursor'`.
- Build tree `<root>/projects/Users-test-MyProj/agent-transcripts/aaa/bbb... `
  — actually: `<root>/projects/<proj>/agent-transcripts/<uuid>/<uuid>.jsonl`
  with one user-message line. `start()` → `onSessionStart` called once,
  sessionId = `<uuid>`, one task event.
- Append an assistant tool_use line, call `scan()` → `onSessionEvents` with
  one event.
- File older than `maxAgeMs` (set `utimesSync` into the past) → no
  `onSessionStart`.
- `cursorRoot` missing → `getConfigDirs()` returns `[]` after `start()`.

## 8. Client changes

### 8.1 Badge logic — `client/src/App.tsx` (lines ~82-84)

Current:

```ts
const showSourceBadge = liveAgents.some((a) => a.source === 'claude')
    && liveAgents.some((a) => a.source === 'codex');
```

Replace with (badge shows whenever ≥ 2 distinct sources are live):

```ts
const liveSources = new Set(liveAgents.map((a) => a.source));
const showSourceBadge = liveSources.size >= 2;
```

### 8.2 Badge logic — `client/src/game/scenes/VillageScene.ts` (lines ~657-660)

Current:

```ts
const hasClaude = liveAgents.some((a) => a.source === 'claude');
const hasCodex = liveAgents.some((a) => a.source === 'codex');
const showSourceBadge = hasClaude && hasCodex;
```

Replace with:

```ts
const showSourceBadge = new Set(liveAgents.map((a) => a.source)).size >= 2;
```

Update the surrounding comment ("Mixed-provider mode…") to say "two or more
providers" instead of "both Claude and Codex".

### 8.3 No other badge code changes

`DetailPanel`, `PartyBar`, `ActivityRow`, `HeroSprite` all render
`agent.source.toUpperCase()` with `SOURCE_BADGE_COLOR[agent.source]` —
the type map additions in §3.2 are sufficient. `HeroSprite` comment
(line ~407: "Show or hide the source badge (`CODEX` / `CLAUDE`)") → update
to "(`CLAUDE` / `CODEX` / `CURSOR`)".

### 8.4 Copy updates (exact strings)

| File | Old | New |
|---|---|---|
| `client/src/components/NoInstallBanner.tsx` title | `No Claude Code or Codex installation detected` | `No Claude Code, Codex or Cursor installation detected` |
| same file body | `The server found no ~/.claude* or ~/.codex directory with session logs. Start a Claude Code or Codex session to see heroes appear here.` | `The server found no ~/.claude*, ~/.codex or ~/.cursor directory with session logs. Start a Claude Code, Codex or Cursor session to see heroes appear here.` |
| same file JSDoc (line ~13) | `"Neither Claude Code nor Codex is installed"` | `"Neither Claude Code, Codex nor Cursor is installed"` |
| `client/src/components/ActivityFeed.tsx:173` | `Launch Claude Code or Codex in any project — it'll appear here.` | `Launch Claude Code, Codex or Cursor in any project — it'll appear here.` |
| `client/src/hooks/useAgentState.ts:15` | `neither ~/.claude* nor ~/.codex install on disk` | `no ~/.claude*, ~/.codex or ~/.cursor install on disk` |
| `client/src/components/Tutorial.tsx` tagline (line ~36) | `Use Claude Code CLI or Codex as usual — each session auto-spawns a hero on the dashboard, live.` | `Use Claude Code, Codex or Cursor as usual — each session auto-spawns a hero on the dashboard, live.` |
| Tutorial intro (line ~51-54) | `turns your Claude Code and Codex sessions into a 2D fantasy village` | `turns your Claude Code, Codex and Cursor sessions into a 2D fantasy village` |
| Tutorial compat (line ~64-74) | after the Codex sentence add | append: ` It also works with Cursor — the IDE agent chats are read from ~/.cursor/projects/.` (keep the existing final sentence about the Claude desktop app/claude.ai) |
| Tutorial badge paragraph (line ~90-93) | `When both Claude Code and Codex have active agents, each hero shows a small CLAUDE or CODEX badge so you can tell which CLI it came from.` | `When agents from more than one source are active, each hero shows a small CLAUDE, CODEX or CURSOR badge so you can tell where it came from.` |
| Tutorial how-to (line ~98) | `Heroes appear in real time as you spawn new Claude Code or Codex sessions.` | `Heroes appear in real time as you spawn new Claude Code, Codex or Cursor sessions.` |
| Tutorial privacy (line ~133-135) | `Agent Quest only reads the logs Claude Code and Codex already keep on your disk.` | `Agent Quest only reads the logs Claude Code, Codex and Cursor already keep on your disk.` |
| Tutorial platform — add after the Codex paragraph | — | new paragraph: `Cursor: tested on macOS. Windows/Linux not yet verified.` |
| `client/src/components/SessionReport.tsx` comment (line ~79) | `Tokens — Claude only. Codex doesn't report usage…` | `Tokens — Claude only. Codex and Cursor don't report usage…` |

### 8.5 `client/src/components/configDirLabel.ts`

`.cursor` already renders as `cursor` via the generic dot-strip fallback.
Add an explicit branch for clarity and parity with `.claude`/`.codex`:

```ts
if (base === '.cursor') return 'cursor';
```

Add a test case to `client/src/components/configDirLabel.test.ts`:
`it('returns "cursor" for ~/.cursor', () => expect(configDirLabel('~/.cursor')).toBe('cursor'));`
(adjust to the existing test style — inspect the file first).

## 9. Documentation

### 9.1 `README.md`

- Tagline (line 6): `A fantasy village dashboard for monitoring your Claude Code and Codex agents.` →
  `A fantasy village dashboard for monitoring your Claude Code, Codex and Cursor agents.`
- Features bullet (line ~48): `Real-time visualization of active Claude Code and Codex sessions` →
  `Real-time visualization of active Claude Code, Codex and Cursor sessions`
- Features bullet (line ~49): auto-discovery bullet — append `and of ~/.cursor if present`.
- "Why?" paragraph (line ~44): mention `~/.cursor` alongside the others.
- Requirements bullet (line ~58): `(one or more ~/.claude* directories, and/or ~/.codex, with session logs)` →
  `(one or more ~/.claude* directories, and/or ~/.codex, and/or ~/.cursor, with session logs)`.
- Platform matrix (line ~223): add row `| Cursor | ✓ | not yet verified | not yet verified |`
  and a sentence after the table: `Cursor support reads the IDE's local agent-chat transcripts (~/.cursor/projects/); it has been tested on macOS only so far.`
- Hooks bullet (line ~52): append `— Codex and Cursor don't use this path`.
- Troubleshooting empty-village entry (line ~147): update to mention all three.

### 9.2 `CLAUDE.md`

- Architecture bullet: add `CursorProvider watches ~/.cursor/projects/**/agent-transcripts/**/*.jsonl for Cursor IDE agent chats.` Keep the note that hooks and SessionRegistry are Claude-only; add: `Cursor liveness is inferred from transcript-file activity, same as Codex.`
- Data flow line: append `and ~/.cursor/projects/<encoded-path>/agent-transcripts/**/*.jsonl → CursorProvider`.
- Key Type bullet: `source` field now `'claude' | 'codex' | 'cursor'`; `configDir` can also be `~/.cursor`.

## 10. Explicitly out of scope

- Cursor hooks integration (`~/.cursor/hooks.json` exists but is command-type
  only; wiring it is a separate future feature).
- Parsing `~/.cursor/chats/*/store.db` (SQLite, legacy IDE chat storage).
- Cursor on Windows/Linux verification.
- Any change to map editor, themes, notifications, map storage.

## 11. Acceptance checklist

- [ ] `AGENT_SOURCES` includes `'cursor'` in BOTH `server/src/types.ts` and
      `client/src/types/agent.ts`; `SOURCE_BADGE_COLOR` has `cursor`.
- [ ] `cursor-parser.ts` + `cursor-provider.ts` exist per §4/§5 contracts.
- [ ] `index.ts` wires `CursorProvider` into `allConfigDirs()` and boot.
- [ ] New tests (§7) pass: `cd server && bun test`.
- [ ] All existing tests still pass.
- [ ] TypeScript strict compiles with zero errors (`noUncheckedIndexedAccess` on).
- [ ] Client badge logic uses "≥ 2 distinct sources" (§8.1/§8.2).
- [ ] All copy updates in §8.4/§9 applied.
- [ ] No `any` introduced anywhere.
