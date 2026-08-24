# Cursor provider — implementation summary

**Date:** 2026-08-24

Cursor IDE agent chats are now a third data source alongside Claude Code and Codex.

## What shipped

### Server
- `server/src/parsers/cursor-parser.ts` — parses `~/.cursor/projects/<encoded-path>/agent-transcripts/**/*.jsonl`
- `server/src/providers/cursor-provider.ts` — polls those transcripts (3s), same lifecycle as Codex
- `AgentSource` extended to `'claude' | 'codex' | 'cursor'`
- Wired in `server/src/index.ts`

Tool mapping:

| Cursor tool | Village activity |
|---|---|
| Read, ReadFile, Grep, Glob, rg | reading |
| Write, StrReplace, Edit, ApplyPatch, Delete | editing |
| Shell / Bash | bash (git commit/push/… → git) |
| Task, Subagent | reviewing |
| everything else (MCP, TodoWrite, WebFetch…) | thinking |
| `turn_ended` | idle (turn end) |

### Client
- Source badge color for Cursor (`#7CB8F7`)
- Badges appear when **≥ 2 distinct sources** are live (not only Claude+Codex)
- Empty-state banner, tutorial, activity feed, config-dir labels, README, CLAUDE.md, installer copy

### Tests
- Server: **200 pass** (`cd server && bun test`)
- Client: **107 pass** (`cd client && bun test`)

### Live check (this machine)
- Server discovered **13 Cursor sessions**, including this Agent-Quest chat (`ab1d17c7-…`, status `active`)
- UI at `http://localhost:4445`: Status Online, Active 4 / Waiting 9 / Total 13
- Tutorial copy already mentions Cursor transcripts under `~/.cursor/projects/`

## How to run (no Docker)

```bash
# Bun is required (installed to ~/.bun/bin if missing)
export PATH="$HOME/.bun/bin:$PATH"
bun install
bun start   # server :4444 + client :4445
```

## Manual checks worth doing

1. Open `http://localhost:4445` while this Cursor chat is active — you should see an **Agent-Quest** hero (thinking/reading/editing as tools fire).
2. Start a Claude Code or Codex session in parallel — source badges `CLAUDE` / `CODEX` / `CURSOR` should appear.
3. Stop all Cursor chats for >3h (or temporarily rename `~/.cursor`) — empty village + “no install” banner.
4. Map editor still loads (`🗺️`); unrelated to the provider.
5. Session report for a Cursor hero should **omit** the token section (Cursor transcripts have no usage).

## Out of scope (intentionally)

- Cursor hooks (`~/.cursor/hooks.json`)
- Windows/Linux verification
- Parsing legacy `chats/*/store.db`
