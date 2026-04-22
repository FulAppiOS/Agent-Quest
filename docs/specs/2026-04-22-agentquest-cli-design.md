# Agent Quest — One-line install & `agentquest` CLI

**Date:** 2026-04-22
**Status:** Design approved — ready for planning
**Platform scope:** macOS only (Intel & Apple Silicon)
**Supersedes:** none

---

## 1. Summary

Collapse the onboarding experience from three commands (`git clone` → `bun install` → `bun start`) into:

1. **One-line install + first run** — a `curl | bash` command that leaves the user looking at the village in their browser.
2. **`agentquest`** — a globally available CLI with two sub-commands: `start` (default) and `update`.

The feature also includes a tiny, logically coupled change to the map editor — removal of the "Set Template" button — so that the update flow stays safe without requiring a broader refactor.

## 2. Motivation

Agent Quest is a tool built for fun and meant to be easy to try. Today a new user has to know about Bun, about `bun install` vs `npm install`, about ports, and about `localhost:4445`. Each extra step loses some users at the door.

The `curl | bash` one-liner is the established idiom for "try this now" across the ecosystem (Bun itself, Homebrew, Rust, Deno). A 10-character daily command (`agentquest`) matches the ergonomics of `gh`, `brew`, `bun`.

## 3. Non-goals

Out of scope for this spec — parked for a future one if needed:

- **Windows / Linux native support.** macOS-only. The script exits explicitly on other OSes with a pointer to the manual install section. Linux users can still use the manual install path (it works, we just don't advertise or test it).
- **User-maps refactor** (moving slots outside the git tree, new-slot dialog "from template or from slot N"). Architecturally the right long-term move, but a separate ~1-week client/server change. See §11.
- **Additional sub-commands** beyond `start` and `update` (no `stop`, `doctor`, `logs` as public commands — health checks are folded into `start`).
- **Homebrew tap, `bunx`/`npx` distribution, standalone compiled binaries.** The install script + CLI shortcut covers the same surface at a fraction of the maintenance cost.
- **Auto-update on each `start`.** Updates are explicit (`agentquest update`).

## 4. User experience

### 4.1 First install (from cold)

User pastes into a macOS terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/FulAppiOS/agent-quest/main/install.sh | bash
```

Script output:

```
Agent Quest — a local dashboard for Claude Code agents
  License: MIT
  Runs entirely on your machine — no API keys, no telemetry, no cloud
  Source: https://github.com/FulAppiOS/agent-quest

This installer will:
  • Check/install Bun (via bun.sh official installer, if missing)
  • Clone the repo into ~/agent-quest                [override: --dir <path>]
  • Install dependencies (bun install)
  • Create a CLI shortcut in ~/.local/bin/agentquest

Proceed? [Y/n] _
```

On `Y` (or empty):
1. macOS check (`uname -s` = `Darwin`). Non-macOS → exit 1 with manual-install pointer.
2. Bun check (see §5.2). Install if missing (user is prompted again), upgrade instruction if outdated.
3. `git clone https://github.com/FulAppiOS/agent-quest.git ~/agent-quest`. If target already exists and is a valid Agent Quest checkout → offer to update it instead; if it exists but isn't → abort with clear message.
4. `cd ~/agent-quest && bun install`
5. Create `~/.local/bin/` if needed, symlink `~/.local/bin/agentquest → ~/agent-quest/bin/agentquest`.
6. If `~/.local/bin` is not in `$PATH`, print the one-liner to add it to `~/.zshrc` (default macOS shell since Catalina).
7. Prompt: *"Start Agent Quest now? [Y/n]"*. On `Y`: `exec agentquest start`. On `n`: print *"Run `agentquest start` when you're ready."*.

On `n` at the first confirmation: exit gracefully, no changes.

### 4.2 Daily use

```bash
agentquest            # equivalent to `agentquest start`
agentquest start      # explicit
```

`start` behaviour:
1. Quick health check (§5.4). Non-fatal issues → warnings. Fatal → clear diagnostic and exit.
2. If `node_modules/` is missing → auto-run `bun install` first (covers the "cloned manually, forgot install" case).
3. `bun start` (server + client via the existing `concurrently` script).
4. In the background, poll `http://localhost:4445` (short timeout, a few retries); when it responds, `open http://localhost:4445`.
5. `Ctrl+C` stops everything (propagates to `bun start` → `concurrently` which already kills both processes).

No separate `stop` sub-command: `start` runs foreground, `Ctrl+C` is the idiomatic stop.

### 4.3 Updates

```bash
agentquest update
```

Decision tree (details in §5.5):

- `git fetch origin main` — if branch already in sync → *"Already up to date."* and exit.
- If on a branch other than `main` → warn and exit (user is probably contributing; don't touch).
- If local commits ahead of `origin/main` → warn and exit (don't force merge/rebase).
- If working tree is **clean** → `git pull --ff-only && bun install` → done.
- If working tree is **dirty** → list modified files, prompt:

  ```
  Local changes detected:
    M server/data/maps/slot-1.json
    M server/data/maps/slot-2.json

  Keep your local changes and try to update? [Y/n]
  ```

  - `Y` (default): stash → `git pull --ff-only` → `git stash pop`.
    - Stash pop clean → *"Updated. Your local maps were preserved."*.
    - Stash pop conflict (rare) → concrete recovery instructions pointing at `git checkout --ours` / `git checkout --theirs`, and a reminder that the original state is still in `git stash list`.
  - `n`: exit, no changes, suggest `git stash`/`git commit`/`git reset` as next steps.

### 4.4 Manual install path (no script)

The install script is a convenience, not a gate. The README has a short **Manual install** section with the equivalent commands, kept in sync with what the script does:

```bash
git clone https://github.com/FulAppiOS/agent-quest.git
cd agent-quest
bun install
# optional: add the CLI shortcut
mkdir -p ~/.local/bin
ln -s "$PWD/bin/agentquest" ~/.local/bin/agentquest
```

`agentquest update` works identically on a manually-cloned repo because it's just `git pull` + `bun install`.

## 5. Architecture

### 5.1 Components

Three new artefacts, one tweak to existing code:

| Artefact | Location | Purpose |
|---|---|---|
| `install.sh` | repo root | One-line install entry point; invoked via `curl \| bash` |
| `bin/agentquest` | repo root | Executable CLI (bash script); symlinked into `~/.local/bin/agentquest` |
| README sections | `README.md` | New "Quick install" block + "Manual install" subsection |
| Map editor button removal | `client/src/editor/panels/EditorTopBar.tsx` + related | Remove "Set Template" (see §6) |

No new runtime dependencies; no changes to the Bun/Hono server or to Phaser.

### 5.2 `install.sh` — shell script

- Shebang `#!/usr/bin/env bash`; `set -euo pipefail`; POSIX-safe enough to work on the bash 3.2 that ships with macOS.
- All interactive prompts read from `/dev/tty` explicitly, so they work under `curl ... | bash` (where stdin is the pipe, not a TTY).
- ANSI colours gated on `[[ -t 1 ]]` and respect `NO_COLOR`.
- Flags:
  - `--dir <path>`: override install directory (default `$HOME/agent-quest`).
  - `--no-start`: skip the final "start now?" prompt (useful in CI / scripted contexts).
  - `--yes`: skip all confirmation prompts (proceed/bun-install/start-now default to `Y`).
  - `--help`: print usage.
- Exit codes: `0` success, `1` user abort or macOS check failed, `2` dependency failure (Bun install declined / failed), `3` git/bun install failure.
- All state changes are idempotent and re-runnable: re-running the installer on an existing install is an upgrade, not a reinstall.

### 5.3 Bun detection matrix

| State | Detection | Action |
|---|---|---|
| Not installed | `command -v bun` empty | Prompt *"Install Bun via bun.sh? [Y/n]"*. `Y` → `curl -fsSL https://bun.sh/install \| bash`. `n` → exit 2 with manual install instructions. |
| Installed, version ≥ 1.1.0 | `bun --version` parses to semver ≥ 1.1.0 | Proceed. |
| Installed, version < 1.1.0 | semver < 1.1.0 | Exit 2 with *"Found Bun vX.Y.Z, need ≥ 1.1.0. Upgrade with: `bun upgrade`"*. |
| Installed but broken | `bun --version` returns non-zero or no version string | Exit 2 with a diagnostic suggesting reinstall. |
| Installed via Bun installer but not in current `$PATH` | fresh install, shell rc not yet sourced | Source the newly-added Bun rc line in the installer subshell and retry once; if still not found, exit 2 with *"Bun installed but not in PATH — restart your terminal and re-run the installer."*. |

### 5.4 `bin/agentquest` — CLI script

- Shebang `#!/usr/bin/env bash`; `set -euo pipefail`.
- **Self-locates the repo** via symlink resolution: the script in `~/.local/bin/agentquest` is a symlink to `<repo>/bin/agentquest`; the script resolves its own true path and derives `REPO_ROOT=$(dirname $(dirname $REAL_PATH))`. macOS doesn't ship `readlink -f`, so we use a small portable resolver (loop over `readlink` until non-symlink, reconstruct via `cd/pwd`).
- **Sub-commands**:
  - `start` (also default when no argument is passed): health-check → optional `bun install` if `node_modules` is missing → `bun start` → background browser-open poller.
  - `update`: fetch → status-check → pull/stash-pull depending on working tree state (§4.3).
  - `--help` / `-h`: one-paragraph usage.
  - `--version` / `-v`: prints the repo's current git describe (short) + `package.json` version.
- **Health check (inside `start`)**:
  - Bun present and ≥ 1.1.0. Fatal if missing or outdated.
  - Ports 4444 and 4445 not in use. Fatal if occupied — we print the `lsof -ti:4444,4445 | xargs kill -9` one-liner as hint.
  - At least one `~/.claude*` directory with a `projects/` subdir. Non-fatal: just a warning that the village will be empty until a Claude Code session starts.
  - `node_modules/` present in both `server/` and `client/`. If missing → run `bun install` automatically (not a hard fail, the fix is the same every time).
- **Browser open**: poll `curl --silent --fail http://localhost:4445` every 500 ms for up to 15 s; on success, `open http://localhost:4445`. On timeout → print the URL and continue (server is still running, user can click it).
- **Ctrl+C handling**: `bun start` is exec'd (not backgrounded), so the signal goes straight to `concurrently`, which already tears down both children.

### 5.5 Update state machine — detail

Pseudo-code (for clarity; real implementation in bash):

```
cd "$REPO_ROOT"
git fetch origin main --quiet

if git rev-parse @ == git rev-parse @{u}:
    echo "Already up to date."; exit 0

current_branch = git rev-parse --abbrev-ref HEAD
if current_branch != "main":
    warn "Not on main (on $current_branch). Switch to main or update manually."
    exit 1

if git rev-list --count @{u}..@ > 0:
    warn "You have $N local commits ahead of origin/main. Merge or rebase manually."
    exit 1

dirty = git status --porcelain
if dirty:
    print "Local changes detected:"; print dirty
    prompt "Keep your local changes and try to update? [Y/n]"
    if answer == n:
        echo "Update cancelled."; exit 0
    git stash push -u -m "agentquest-update-$(date +%s)"
    trap "git stash pop_if_ours" on error  # safety net
    git pull --ff-only
    git stash pop
    if conflict:
        print recovery instructions (checkout --ours / --theirs, stash list)
        exit 1
else:
    git pull --ff-only

bun install
echo "Updated to $(git describe --always --dirty)."
```

## 6. Map editor: remove "Set Template"

### 6.1 Why this lives in the same spec

The update policy assumes `template.json` is **upstream-owned** (user never modifies it) while the `slot-*.json` files are **user-owned**. The "Set Template" button in the editor (`EditorTopBar.tsx:99`) lets the user overwrite `template.json` from the current slot, breaking that invariant and turning every future `git pull` into a template conflict. Removing the button is the minimum change that lets the update flow stay simple.

### 6.2 Scope of the change

Remove the button, its handler, its event type, and the corresponding server endpoint — nothing half-done.

- `client/src/editor/panels/EditorTopBar.tsx`: remove the `<button>Set Template</button>` and the `onSetTemplate` handler (L40-43, L99).
- `client/src/editor/types/editor-events.ts`: remove `'set-template'` from the action union (L31).
- `client/src/editor/game/scenes/EditorScene.ts`: remove the `case 'set-template':` branch (L1270-ish) that POSTs to `/api/map/template`.
- Server: remove the **POST** handler for `/api/map/template` (the GET handler stays — the editor still needs it to read the bundled template on "new slot"). If the POST is co-located with the GET in a single route, refactor to leave only the GET.
- No other UI strings or docs reference "Set Template" that we need to update (verify during implementation).

### 6.3 Seed: slot-1 becomes the new upstream template

The user confirmed the desired upstream template **is the current content of `server/data/maps/slot-1.json`**. Implementation step:

```bash
cp server/data/maps/slot-1.json server/data/maps/template.json
```

Committed as part of this feature branch. After this, cloning the repo gives every user the same starting map in `template.json` (read-only from their POV) and the same starting `slot-1.json` (which they are free to edit).

## 7. README changes

Three edits in `README.md`:

1. **Quick install** block replaces the current Quick start code fence with the `curl | bash` one-liner plus a two-line "or clone manually" pointer.
2. **Manual install** subsection (new, short) with the `git clone` / `bun install` / optional symlink triplet. Also documents the `agentquest` CLI for manually-cloned installs.
3. **Development** section gets one extra line: `agentquest update   # git pull + bun install (preserves local maps)`.

The existing Windows / LAN / Configuration / Troubleshooting sections don't change. Troubleshooting gets one new entry: *"`agentquest: command not found` after install → add `~/.local/bin` to your PATH (see output of install script)."*.

## 8. Error handling & edge cases

Behaviour for failure modes the user will realistically hit:

| Situation | Response |
|---|---|
| User is on Linux / WSL | Install: exit 1 immediately with *"macOS only. See README 'Manual install'"*. CLI script itself does not check OS — it runs on any POSIX shell that has bash, git, and bun. Linux users who clone manually get a working install; we just don't advertise it. |
| `curl` not available | Pre-condition of the one-liner itself; we don't detect this from inside the script. |
| `~/agent-quest` exists and is an Agent Quest checkout | Offer *"Existing install detected. Update it? [Y/n]"*. On `Y` → exec `agentquest update`. On `n` → exit. |
| `~/agent-quest` exists but isn't an Agent Quest repo | Abort with *"Target directory is not an Agent Quest checkout. Remove it or use `--dir` to install elsewhere."*. Never delete an unknown directory. |
| `~/.local/bin/agentquest` exists, symlink to a different target | Overwrite only if the existing symlink points inside another Agent Quest checkout (detectable via the target path structure); otherwise prompt before overwriting. |
| `~/.local/bin` not in `$PATH` | After symlink creation, print: *"Add `~/.local/bin` to your PATH: `echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc`"*. |
| Ports 4444/4445 already in use when `start` runs | Fatal. Print the `lsof -ti:4444,4445 \| xargs kill -9` hint and exit. |
| User runs `agentquest update` while `start` is running | `git pull` / `bun install` both succeed; the running server picks up changes on next restart. We don't attempt hot reload. |
| Stash pop generates a merge conflict | Print recovery instructions with exact `git` commands. Stash is preserved (we do *not* drop it on failure); user can retry resolution. |
| User interrupts install with Ctrl+C mid-clone or mid-install | Script leaves partial state; next run detects it (see existing-dir cases above) and offers to clean up or resume. |

## 9. Testing strategy

No unit tests for `install.sh` — shell scripts of this size are best verified end-to-end on a real macOS box. We add:

- **Manual test matrix** documented in `docs/superpowers/plans/2026-04-22-agentquest-cli-plan.md` (once the plan exists): fresh install on a clean user, re-install over existing checkout, install with `--dir`, update on clean tree, update on dirty tree (Y path), update on dirty tree (n path), update with local commits.
- **CLI `agentquest --version`** run in CI (GitHub Actions on macos-latest) as a smoke test after a manual install step. One job, two minutes, catches shell syntax errors and missing-file regressions.
- **Existing server tests** (`cd server && bun test`) still run unchanged — the map editor endpoint removal has to be verified not to break them (the POST `/api/map/template` may or may not have test coverage; confirm during implementation).
- **Asset check script** (`bun run check:assets`) continues to run in its existing CI job.

## 10. Commit & branch strategy

One feature branch (`feat/agentquest-cli`, already created). Suggested commit sequence for reviewability:

1. `feat: update template.json from current slot-1 content` — the one-line seed.
2. `refactor(editor): remove Set Template button and server endpoint` — UI + server cleanup, self-contained.
3. `feat: add bin/agentquest CLI with start/update subcommands` — the CLI, testable on its own via a manual symlink.
4. `feat: add install.sh one-liner installer` — the installer, which only *uses* bin/agentquest.
5. `docs: update README with Quick install and Manual install sections` — README last, when everything it references is committed.

PR into `main` as a single feature branch.

## 11. Future work (not in this spec)

Recorded here so we don't lose it:

- **User-maps refactor** (tentatively "Spec B"): move user-editable slots out of the git tree (either to `~/.config/agent-quest/maps/` or a gitignored subdir), keep `template.json` and a `.defaults/` directory upstream, add a map-editor dialog on new-slot creation: *"Start from template or copy from slot N?"*. After this lands, `agentquest update` simplifies — the "dirty tree" branch of §5.5 becomes unreachable in practice and we can remove the stash-pop logic.
- **`agentquest doctor`** as a public sub-command: currently folded into `start`. If we see users needing to run it independently (e.g. to diagnose why no village shows up), promote it.
- **Homebrew tap** (`brew install fulappios/tap/agent-quest`): once the install script is stable, a homebrew formula is ~40 lines that wraps the same logic. Low priority.
- **Non-macOS install script**: if demand appears, a PR-driven Linux branch. Explicitly out of scope today.

## 12. Open implementation questions

Small decisions left to the implementer, explicitly called out so they don't turn into surprises during review:

1. **Symlink target path style.** The symlink can be absolute (`$HOME/agent-quest/bin/agentquest`) or relative. Absolute is simpler and breaks only if the user *moves* the repo (rare, and `agentquest update` can't handle that case anyway). Go with absolute.
2. **`--help` format.** Plain ASCII, one screen, style similar to `brew --help`. No colours unless stdout is a TTY.
3. **Version reporting.** `--version` prints `agentquest vX.Y.Z (commit abc123)` where the version comes from `package.json` and the commit from `git describe --always`. If git isn't available at runtime (very unlikely post-install), fall back to the package.json string alone.
4. **How to test the ports check.** During `start`, we check with `lsof -ti:4444,4445`. If `lsof` isn't available (never true on macOS 10.15+, but worth a one-liner guard), skip the check and let `bun start` fail with its own error — good enough.
