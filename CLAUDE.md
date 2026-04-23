# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Quest is a browser-based monitoring dashboard that visualizes active Claude Code and Codex agent sessions as fantasy heroes in a 2D WoW-style village. Each agent is represented as a hero character that walks between buildings corresponding to its current activity (Read → Library, Edit → Forge, Bash → Arena, etc.).

## Architecture

Two-process monorepo:

- **server/** — Bun + Hono backend. Two providers run in parallel: `ClaudeProvider` auto-discovers every `~/.claude*` directory with a `projects/` subdir (e.g. `~/.claude`, `~/.claude-work`, `~/.claude-personale`); `CodexProvider` watches `~/.codex/sessions/` for Codex rollout files. Both poll their session logs every 2-3s, parse events into `AgentState` objects, push updates over native Bun WebSocket. Each `AgentState` carries its `configDir` and a `source` field (`'claude' | 'codex'`) so the UI can distinguish installations and providers. Optional Hono endpoint receives Claude Code `postToolUse` hooks for lower-latency events — **Claude Code only**; Codex doesn't expose hooks. `SessionRegistry` (pidfile oracle) is also **Claude-only by design**; Codex liveness is inferred purely from rollout-file activity.
- **client/** — React 19 + Phaser 4 "Caladan" frontend. Fullscreen Phaser canvas renders the village; React overlay panels (Party Bar, Activity Feed, Detail Panel, Minimap, Top Bar) sit on top via ref-based bridge pattern (useRef + useEffect + EventEmitter).

Data flow: `~/.claude*/projects/**/*.jsonl` and `~/.codex/sessions/**/rollout-*.jsonl` → ClaudeProvider / CodexProvider → SessionParser (per-format) → AgentStateManager → WebSocket → Browser (React state + Phaser scene).

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

The central data model flows from server to client. Defined in shared types. Maps tool calls to activities: Read/Grep/Glob → `reading`, Edit/Write → `editing`, Bash → `bash`, thinking → `thinking`, git → `git`, idle → `idle`, debug → `debugging`, review → `reviewing`. `configDir` can be `~/.claude*` or `~/.codex`; the `source` field (`'claude' | 'codex'`) discriminates which provider produced the session.

## Design Spec

Full spec with building mappings, hero classes, VFX, panel layouts, and asset pipeline: `docs/specs/2026-04-15-agent-quest-design.md`
