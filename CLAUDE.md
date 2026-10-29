# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Quest is a browser-based monitoring dashboard that visualizes active Claude Code and Codex agent sessions as fantasy heroes in a 2D WoW-style village. Each agent is represented as a hero character that walks between buildings corresponding to its current activity (Read → Library, Edit → Forge, Bash → Arena, etc.).

## Architecture

Two-process monorepo:

- **server/** — Bun + Hono backend. Two providers run in parallel: `ClaudeProvider` auto-discovers every `~/.claude*` directory with a `projects/` subdir (e.g. `~/.claude`, `~/.claude-work`, `~/.claude-personale`); `CodexProvider` watches `~/.codex/sessions/` for Codex rollout files. On macOS, both providers also discover the corresponding ClaudeAgentConfig/projects and codex/sessions directories under ~/Library/Developer/Xcode/CodingAssistant, including folders created after startup. Xcode Claude sessions rely on transcript lifecycle rather than terminal pidfiles. Both poll their session logs every 2-3s, parse events into `AgentState` objects, push updates over native Bun WebSocket. Each `AgentState` carries its `configDir` and a `source` field (`'claude' | 'codex'`) so the UI can distinguish installations and providers. Optional Hono endpoint receives Claude Code `postToolUse` hooks for lower-latency events — **Claude Code only**; Codex doesn't expose hooks. `SessionRegistry` (pidfile oracle) is also **Claude-only by design**; Codex liveness is inferred purely from rollout-file activity. Both providers also feed `kind: 'telemetry'` events (tool results, skill bodies, token counts, compaction markers) that update accounting only — never status, activity or lifecycle timers.
  - Codex rollouts come in two formats: the legacy per-kind events (`user_message`, `exec_command_end`, `patch_apply_end`, …) and, from Codex ≥ 0.160, a single `item_completed` event whose `item.type` is `UserMessage | CommandExecution | FileChange | WebSearch | McpToolCall | SubAgentActivity | ContextCompaction | …`. `codex-parser.ts` handles both. Codex **does** have subagents: rollouts with `thread_source: 'subagent'` carry `parent_thread_id`, `agent_nickname` and `agent_path` in their `session_meta`.
  - `server/src/state/context-window.ts` resolves the Claude context window (env override → `[1m]` model id → `[1m]` model in `<configDir>/settings.json` → inferred from usage > 200k → default 200k). Codex reports `model_context_window` itself.
  - `server/src/skills/skill-inventory.ts` measures installed `SKILL.md` files (user skills + latest cached plugin versions, `~/.codex/skills`) so the UI can show what skills would cost if always loaded.
- **client/** — React 19 + Phaser 4 "Caladan" frontend. Fullscreen Phaser canvas renders the village; React overlay panels (Party Bar, Activity Feed, Detail Panel, Minimap, Top Bar) sit on top via ref-based bridge pattern (useRef + useEffect + EventEmitter).

Data flow: `~/.claude*/projects/**/*.jsonl` and `~/.codex/sessions/**/rollout-*.jsonl` → ClaudeProvider / CodexProvider → SessionParser (per-format) → AgentStateManager → WebSocket → Browser (React state + Phaser scene). Providers pass a `SessionMeta` (`isSubagent`, `parentId`, `subagentType`, `spawnToolUseId`, `configuredModel`, `nameOverride`) alongside the events; `processEvent(event, meta)` is the only entry point into the state manager.

## Commands

```bash
bun start              # Start both server and client (concurrently)
bun run dev:server     # Server only on localhost:4444
bun run dev:client     # Client only on localhost:4445
bun run check:assets   # Verify every bundled sprite referenced by the theme exists on disk
```

## Ports

| Service | Port |
|---|---|
| Server (WebSocket + HTTP API) | `localhost:4444` |
| Client (Vite dev server) | `localhost:4445` |

These are fixed. Do NOT use 3000, 3333, 5173, 5174, 8000 — reserved by other projects.

## Code Conventions

- TypeScript strict everywhere, no `any`
- Code and identifiers in English, UI labels in English
- Commit messages: conventional style (`feat:`, `fix:`, `refactor:`)

## Git Workflow

- **Never push to the remote automatically.** The repo is public on GitHub; every `git push` must be explicitly requested by the user. Commits are fine without asking (once changes are ready), but pushes require direct authorization.

## Key Type: AgentState

The central data model flows from server to client. Defined in shared types (`server/src/types.ts` and `client/src/types/agent.ts` — keep them in sync). Maps tool calls to activities: Read/Grep/Glob → `reading`, Edit/Write → `editing`, Bash → `bash`, thinking → `thinking`, git → `git`, idle → `idle`, debug → `debugging`, review → `reviewing`. `configDir` can be `~/.claude*` or `~/.codex`; the `source` field (`'claude' | 'codex'`) discriminates which provider produced the session.

Hero class is by role, not round-robin: main agents are always `warrior` (the knight), subagents `pawn`, ultra-mode Workflow agents `archer`; subagents inherit the parent's `heroColor` (adopted later if the parent is discovered after them).

Telemetry fields: `context` (`ContextUsage`: used / peak / window / windowSource / compactions), `skills` (`SkillUsage[]`: loads and ~tokens per skill, Claude attribution counts), `plugins` (`PluginUsage[]`: calls and ~result tokens per plugin or MCP server), `activeSkill`, and for subagents `parentId`, `subagentType`, `returnedTokens` (what the subagent's result pushed back into the parent context). Token estimates are `Math.ceil(chars / 4)` via `estimateTokens`. The WebSocket snapshot also carries `skillInventory` per provider.

## Design Spec

Full spec with building mappings, hero classes, VFX, panel layouts, and asset pipeline: `docs/specs/2026-04-15-agent-quest-design.md`
