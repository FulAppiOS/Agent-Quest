# Agent Quest — One-line install & `agentquest` CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a single `curl | bash` installer that clones the repo, installs dependencies, creates a global `agentquest` command with `start` / `update` sub-commands, and hand the user a running village — on macOS only. Remove the map-editor "Set Template" button so the update flow stays safe without a broader refactor.

**Architecture:** Pure bash, no runtime deps added. Two new shell scripts (`install.sh` at repo root, `bin/agentquest` at repo root), one file content seed (`server/data/maps/template.json` ← current `slot-1.json`), a small surgical removal in the map editor (client + server), and README updates. The CLI self-locates through a symlink in `~/.local/bin/` — nothing is hardcoded about install path, so manual installs work too.

**Tech Stack:** Bash 3.2+ (macOS default), git, Bun ≥ 1.1, React 19 / TypeScript strict (client), Hono (server). No new dependencies.

**Spec:** `docs/specs/2026-04-22-agentquest-cli-design.md`

**Working branch:** `feat/agentquest-cli` (already created on `main`).

---

## File map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `server/data/maps/template.json` | Upstream default map — seeded from current `slot-1.json` |
| Modify | `client/src/editor/panels/EditorTopBar.tsx` | Remove "Set Template" button and its handler |
| Modify | `client/src/editor/types/editor-events.ts` | Remove `'set-template'` from the action union |
| Modify | `client/src/editor/game/scenes/EditorScene.ts` | Remove the `case 'set-template':` branch |
| Modify | `server/src/map/routes.ts` | Remove POST `/api/map/template`; keep GET |
| Create | `bin/agentquest` | Executable bash CLI (start, update, --help, --version) |
| Create | `install.sh` | One-liner installer entry point |
| Modify | `README.md` | Quick install block + Manual install subsection + Troubleshooting entry + Development line |

---

## Task 1: Seed `template.json` from current `slot-1.json`

**Why first:** Unblocks the "Set Template" removal (once the upstream template matches what the user wants, there's no functional regression in dropping the button). Trivial change, isolated commit.

**Files:**
- Modify: `server/data/maps/template.json`

- [ ] **Step 1: Overwrite template.json with slot-1.json contents**

Run:
```bash
cp "server/data/maps/slot-1.json" "server/data/maps/template.json"
```

- [ ] **Step 2: Verify the two files now match**

Run:
```bash
diff -q server/data/maps/slot-1.json server/data/maps/template.json
```

Expected: empty output (no differences), exit 0.

- [ ] **Step 3: Verify JSON parses**

Run:
```bash
bun -e 'JSON.parse(await Bun.file("server/data/maps/template.json").text()); console.log("ok")'
```

Expected: `ok`.

- [ ] **Step 4: Commit**

Run:
```bash
git add server/data/maps/template.json
git commit -m "$(cat <<'EOF'
feat: seed template.json from current slot-1

Make the upstream template match the map the author currently ships
in slot-1. Users cloning the repo will start from the same default.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: one-file commit on `feat/agentquest-cli`.

---

## Task 2: Remove "Set Template" from the map editor (client side)

**Why before server side:** The client is the only consumer of the POST endpoint. Removing the client reference first means the server removal in Task 3 cannot break anything that's still wired up.

**Files:**
- Modify: `client/src/editor/panels/EditorTopBar.tsx:40-43, 99`
- Modify: `client/src/editor/types/editor-events.ts:31`
- Modify: `client/src/editor/game/scenes/EditorScene.ts` (the `case 'set-template':` block around L1270)

- [ ] **Step 1: Remove the button from the JSX**

In `client/src/editor/panels/EditorTopBar.tsx`, delete exactly this line (currently L99):

```tsx
        <button className="editor-btn" onClick={onSetTemplate} title="Copy this slot as default template">Set Template</button>
```

- [ ] **Step 2: Remove the `onSetTemplate` handler**

In the same file, delete exactly this block (currently L40-44):

```tsx
  const onSetTemplate = () => {
    if (confirm('Copy this slot as the default template? This will overwrite the current template.')) {
      editorBridge.emit('ed:action', 'set-template');
    }
  };
```

(Keep a blank line between the surrounding `onSetActive` and `onResetSlot` handlers to preserve formatting.)

- [ ] **Step 3: Remove the event-type entry**

In `client/src/editor/types/editor-events.ts`, remove the `| 'set-template'` line from the action union (currently L31). The union should remain valid TypeScript (other members unchanged).

- [ ] **Step 4: Remove the scene handler branch**

In `client/src/editor/game/scenes/EditorScene.ts`, find the action dispatcher around L1270 that contains `case 'set-template':` and delete the whole `case` block (`case` line, body — typically a `fetch` POST to `/api/map/template`, and the `break;`). Use the surrounding `case` statements as anchors if the line number shifted.

Verify with:
```bash
grep -n "set-template" client/src/editor/game/scenes/EditorScene.ts
```

Expected: no matches.

- [ ] **Step 5: Confirm no other references remain in the client**

Run:
```bash
grep -rn "set-template\|setTemplate\|Set Template\|onSetTemplate" client/src
```

Expected: no matches (empty output).

- [ ] **Step 6: TypeScript check (client)**

Run:
```bash
cd client && bunx tsc --noEmit
```

Expected: exit 0, no errors. (If the project's typecheck is invoked via a different script, use the package.json script — check `client/package.json` first and prefer the project's own command.)

- [ ] **Step 7: Client build smoke test**

Run:
```bash
cd client && bun run build
```

Expected: successful build (Vite production build completes without errors).

- [ ] **Step 8: Commit**

```bash
git add client/src/editor/panels/EditorTopBar.tsx \
        client/src/editor/types/editor-events.ts \
        client/src/editor/game/scenes/EditorScene.ts
git commit -m "$(cat <<'EOF'
refactor(editor): remove Set Template button

The upstream template is now shipped by the repo and updated via
`git pull`. Letting users overwrite it from the editor broke this
invariant and produced merge conflicts on every update. Drop the
button, its handler, its action-type entry, and the scene-level
dispatcher branch. The POST endpoint on the server is removed in the
next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Remove POST `/api/map/template` from the server

**Why now:** Client no longer references it (Task 2). Leaving it as dead code invites drift.

**Files:**
- Modify: `server/src/map/routes.ts:118` (the POST handler)

- [ ] **Step 1: Inspect the current routes file**

Run:
```bash
sed -n '100,140p' server/src/map/routes.ts
```

Note the exact structure of the POST handler (start line, end line) and confirm the GET handler directly above it remains untouched.

- [ ] **Step 2: Remove the POST handler**

Open `server/src/map/routes.ts`. Delete the entire `app.post('/api/map/template', ...)` block including its closing `});`. Leave the GET handler (`app.get('/api/map/template', ...)`) intact.

After the edit, verify with:
```bash
grep -n "/api/map/template" server/src/map/routes.ts
```

Expected: exactly one match — the GET handler.

- [ ] **Step 3: Confirm no remaining in-repo references to the POST call**

Run:
```bash
grep -rn "POST.*map/template\|fetch.*map/template.*method.*POST" . --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules
```

Expected: empty output.

- [ ] **Step 4: Run server tests**

Run:
```bash
cd server && bun test
```

Expected: all existing tests pass. None should exist for the POST endpoint (spec §9), but this catches any incidental breakage.

- [ ] **Step 5: Smoke-test the remaining GET route**

Start the server in the background, curl the GET endpoint, then stop it:

```bash
cd server && bun run dev &
SERVER_PID=$!
sleep 3
curl -sf http://localhost:4444/api/map/template | head -c 200
echo
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true
```

Expected: valid JSON content starting with `{"version":1,"world":...`.

- [ ] **Step 6: Commit**

```bash
git add server/src/map/routes.ts
git commit -m "$(cat <<'EOF'
refactor(server): drop POST /api/map/template

The client no longer calls this endpoint (Set Template button was
removed). Keep GET, which the editor still needs for the "new slot"
default.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Create `bin/agentquest` (the CLI)

**Why before install.sh:** The installer creates a symlink to this file, so it must exist first. Also, the CLI is independently testable — we can invoke it directly via `bin/agentquest` to verify behaviour before gluing it through a symlink.

**Files:**
- Create: `bin/agentquest`

- [ ] **Step 1: Create `bin/` directory and write the CLI script**

Run (paste the script verbatim — it is the complete CLI):

```bash
mkdir -p bin
```

Then create `bin/agentquest` with exactly this content:

```bash
#!/usr/bin/env bash
# agentquest — local dashboard for Claude Code agents
# macOS-first; relies on bash 3.2+, git, bun >= 1.1.
set -euo pipefail

# ------------------------------------------------------------------ self-locate
# Follows symlinks portably (macOS has no `readlink -f`).
resolve_symlink() {
  local src="$1"
  while [[ -L "$src" ]]; do
    local dir
    dir="$(cd -P "$(dirname "$src")" && pwd)"
    src="$(readlink "$src")"
    [[ "$src" != /* ]] && src="$dir/$src"
  done
  printf '%s/%s\n' "$(cd -P "$(dirname "$src")" && pwd)" "$(basename "$src")"
}
SCRIPT_REAL="$(resolve_symlink "${BASH_SOURCE[0]}")"
REPO_ROOT="$(cd -P "$(dirname "$(dirname "$SCRIPT_REAL")")" && pwd)"

# ------------------------------------------------------------------ colours
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_BLUE=$'\033[34m'; C_GREEN=$'\033[32m'; C_RED=$'\033[31m'
  C_YELLOW=$'\033[33m'; C_DIM=$'\033[2m'; C_RESET=$'\033[0m'
else
  C_BLUE=""; C_GREEN=""; C_RED=""; C_YELLOW=""; C_DIM=""; C_RESET=""
fi
info() { printf '%s==>%s %s\n' "$C_BLUE" "$C_RESET" "$1"; }
ok()   { printf '%s✓%s %s\n'  "$C_GREEN" "$C_RESET" "$1"; }
warn() { printf '%s!%s %s\n'  "$C_YELLOW" "$C_RESET" "$1" >&2; }
err()  { printf '%sERROR:%s %s\n' "$C_RED" "$C_RESET" "$1" >&2; }

# ------------------------------------------------------------------ helpers
# Return 0 if $1 >= $2, treating both as dotted semver (prerelease tags ignored).
semver_ge() {
  local a="${1%%-*}" b="${2%%-*}"
  local IFS=.
  local -a ap bp
  # shellcheck disable=SC2206
  ap=( $a ); bp=( $b )
  local i av bv
  for i in 0 1 2; do
    av="${ap[i]:-0}"; bv="${bp[i]:-0}"
    if (( 10#$av > 10#$bv )); then return 0; fi
    if (( 10#$av < 10#$bv )); then return 1; fi
  done
  return 0
}

read_pkg_version() {
  local pkg="$REPO_ROOT/package.json"
  if [[ -f "$pkg" ]]; then
    grep -m1 '"version"' "$pkg" \
      | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
  else
    echo "unknown"
  fi
}

check_bun_runtime() {
  if ! command -v bun >/dev/null 2>&1; then
    err "Bun is not installed. Install from https://bun.sh"
    exit 1
  fi
  local v
  v="$(bun --version 2>/dev/null)" || { err "bun --version failed."; exit 1; }
  if ! semver_ge "$v" "1.1.0"; then
    err "Bun v$v is too old (need >= 1.1.0). Upgrade with: bun upgrade"
    exit 1
  fi
}

check_ports() {
  command -v lsof >/dev/null 2>&1 || return 0
  local busy
  busy="$(lsof -ti:4444,4445 2>/dev/null || true)"
  if [[ -n "$busy" ]]; then
    err "Ports 4444 or 4445 are in use (PIDs: $(echo "$busy" | tr '\n' ' '))."
    err "Free them with:  lsof -ti:4444,4445 | xargs kill -9"
    exit 1
  fi
}

check_claude_dirs() {
  if ! compgen -G "$HOME/.claude*/projects" >/dev/null 2>&1; then
    warn "No Claude Code installation detected. The village will be empty until a session starts."
  fi
}

ensure_deps() {
  if [[ ! -d "$REPO_ROOT/server/node_modules" || ! -d "$REPO_ROOT/client/node_modules" ]]; then
    info "Dependencies missing — running bun install ..."
    ( cd "$REPO_ROOT" && bun install --silent )
  fi
}

open_browser_later() {
  (
    local i
    for i in $(seq 1 30); do
      if curl --silent --fail --max-time 1 http://localhost:4445 >/dev/null 2>&1; then
        open http://localhost:4445 2>/dev/null || true
        exit 0
      fi
      sleep 0.5
    done
  ) &
  disown
}

prompt_yn() {
  # $1 question, $2 default (Y or n). Returns 0 for yes, 1 for no.
  local q="$1" def="${2:-Y}" ans
  if [[ -r /dev/tty ]]; then
    read -r -p "$q " ans < /dev/tty
  else
    read -r ans || ans=""
  fi
  ans="${ans:-$def}"
  [[ "$ans" =~ ^[Yy]$ ]]
}

# ------------------------------------------------------------------ sub-commands
cmd_help() {
  cat <<USAGE
agentquest — fantasy village dashboard for Claude Code agents

USAGE:
  agentquest [start]           Start server + client, open browser
  agentquest update            Pull upstream changes (preserves local maps)
  agentquest --version, -v     Print version
  agentquest --help,    -h     Print this help

REPO:  $REPO_ROOT
USAGE
}

cmd_version() {
  local v; v="$(read_pkg_version)"
  local commit=""
  if command -v git >/dev/null 2>&1 && [[ -d "$REPO_ROOT/.git" ]]; then
    local c
    c="$(cd "$REPO_ROOT" && git describe --always --dirty 2>/dev/null || true)"
    [[ -n "$c" ]] && commit=" ($c)"
  fi
  printf 'agentquest v%s%s\n' "$v" "$commit"
}

cmd_start() {
  check_bun_runtime
  check_ports
  check_claude_dirs
  ensure_deps
  open_browser_later
  info "Starting Agent Quest (Ctrl+C to stop) ..."
  cd "$REPO_ROOT"
  exec bun start
}

cmd_update() {
  cd "$REPO_ROOT"
  info "Fetching upstream ..."
  git fetch origin main --quiet
  local local_sha upstream_sha
  local_sha="$(git rev-parse HEAD)"
  upstream_sha="$(git rev-parse origin/main 2>/dev/null || echo '')"
  if [[ -z "$upstream_sha" ]]; then
    err "No origin/main ref. Is this repo connected to a remote?"; exit 1
  fi
  if [[ "$local_sha" == "$upstream_sha" ]]; then
    ok "Already up to date."; exit 0
  fi
  local branch; branch="$(git rev-parse --abbrev-ref HEAD)"
  if [[ "$branch" != "main" ]]; then
    warn "Not on main (on $branch). Switch to main or run git pull manually."
    exit 1
  fi
  local ahead; ahead="$(git rev-list --count origin/main..HEAD)"
  if [[ "$ahead" -gt 0 ]]; then
    warn "You have $ahead local commit(s) ahead of origin/main. Merge or rebase manually."
    exit 1
  fi
  local dirty; dirty="$(git status --porcelain)"
  if [[ -n "$dirty" ]]; then
    printf '\nLocal changes detected:\n'
    echo "$dirty" | sed 's/^/  /'
    printf '\n'
    if ! prompt_yn "Keep your local changes and try to update? [Y/n]" "Y"; then
      echo "Update cancelled."
      exit 0
    fi
    local stash_msg="agentquest-update-$(date +%s)"
    git stash push -u -m "$stash_msg" >/dev/null
    info "Stashed as '$stash_msg'. Pulling ..."
    git pull --ff-only --quiet
    if ! git stash pop; then
      err "Stash pop produced conflicts. Your original changes are still in:  git stash list"
      err "To keep YOUR version:    git checkout --ours <file> && git add <file>"
      err "To take upstream:        git checkout --theirs <file> && git add <file>"
      err "Then:                    git stash drop"
      exit 1
    fi
    ok "Updated. Your local maps were preserved."
  else
    git pull --ff-only --quiet
    ok "Updated."
  fi
  info "Installing dependencies ..."
  bun install --silent
  ok "Done. $(git describe --always --dirty 2>/dev/null || true)"
}

# ------------------------------------------------------------------ dispatch
case "${1:-start}" in
  start)                cmd_start ;;
  update)               cmd_update ;;
  --help|-h|help)       cmd_help ;;
  --version|-v|version) cmd_version ;;
  *) err "Unknown command: $1"; cmd_help; exit 1 ;;
esac
```

- [ ] **Step 2: Make the file executable**

Run:
```bash
chmod +x bin/agentquest
```

- [ ] **Step 3: Syntax check**

Run:
```bash
bash -n bin/agentquest && echo "syntax OK"
```

Expected: `syntax OK`.

- [ ] **Step 4: Test `--help`**

Run:
```bash
bin/agentquest --help
```

Expected: usage text containing `start`, `update`, `--version`, `--help`, and the resolved `REPO_ROOT`.

- [ ] **Step 5: Test `--version`**

Run:
```bash
bin/agentquest --version
```

Expected: a line like `agentquest v0.0.1 (<commit-sha> or <commit-sha>-dirty)`.

- [ ] **Step 6: Test symlink self-location**

Simulate a user install by symlinking the script into `/tmp`:

```bash
ln -sf "$PWD/bin/agentquest" /tmp/agentquest-test
/tmp/agentquest-test --version
rm /tmp/agentquest-test
```

Expected: same `agentquest v0.0.1 (...)` output, proving the script resolves its real path through the symlink.

- [ ] **Step 7: Test `update` on a clean tree (dry scenario)**

From the working branch, run:
```bash
bin/agentquest update
```

Expected behaviour (the branch is `feat/agentquest-cli`, not `main`, so the script must warn and exit):
- Message: `! Not on main (on feat/agentquest-cli). Switch to main or run git pull manually.`
- Exit code: `1`.

Verify exit code:
```bash
bin/agentquest update; echo "exit=$?"
```

Expected: `exit=1`.

- [ ] **Step 8: Confirm the executable bit is visible to git**

Run:
```bash
ls -l bin/agentquest
git ls-files --stage bin/agentquest 2>/dev/null || echo "(not yet tracked — will be picked up at commit)"
```

Expected: `ls -l` shows `-rwxr-xr-x`. On macOS (APFS/HFS+) git records the executable bit automatically on commit; no `git update-index --chmod=+x` needed.

- [ ] **Step 9: Commit**

```bash
git add bin/agentquest
git commit -m "$(cat <<'EOF'
feat: add bin/agentquest CLI (start/update/--help/--version)

Single bash script, self-locates via symlink resolution (portable on
macOS without readlink -f), runs:

  agentquest [start]   health-check + bun install if needed + bun start
                       + background poll to open the browser
  agentquest update    fetch/pull with dirty-tree Y/N stash safety
  agentquest --help    usage
  agentquest --version package.json version + git describe

Designed to be symlinked from ~/.local/bin/agentquest by the
upcoming install.sh (which is also the manual-install recipe in
README).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Create `install.sh` (one-liner installer)

**Files:**
- Create: `install.sh` (repo root)

- [ ] **Step 1: Write `install.sh`**

Create `install.sh` at the repo root with exactly this content:

```bash
#!/usr/bin/env bash
# Agent Quest — one-line installer for macOS.
# Usage: curl -fsSL https://raw.githubusercontent.com/FulAppiOS/agent-quest/main/install.sh | bash
set -euo pipefail

REPO_URL="https://github.com/FulAppiOS/agent-quest.git"
DEFAULT_DIR="$HOME/agent-quest"
MIN_BUN="1.1.0"

INSTALL_DIR="$DEFAULT_DIR"
AUTO_YES=0
NO_START=0

usage() {
  cat <<USAGE
Agent Quest installer (macOS)

Usage:
  install.sh [options]

Options:
  --dir <path>   Install directory (default: \$HOME/agent-quest)
  --yes          Skip all confirmation prompts (defaults to Y)
  --no-start     Don't offer to launch after install
  --help, -h     Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)      INSTALL_DIR="$2"; shift 2 ;;
    --yes|-y)   AUTO_YES=1; shift ;;
    --no-start) NO_START=1; shift ;;
    --help|-h)  usage; exit 0 ;;
    *) printf 'Unknown flag: %s\n' "$1" >&2; usage >&2; exit 1 ;;
  esac
done

# ------------------------------------------------------------------ colours
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_BLUE=$'\033[34m'; C_GREEN=$'\033[32m'; C_RED=$'\033[31m'
  C_DIM=$'\033[2m'; C_RESET=$'\033[0m'
else
  C_BLUE=""; C_GREEN=""; C_RED=""; C_DIM=""; C_RESET=""
fi
info() { printf '%s==>%s %s\n' "$C_BLUE" "$C_RESET" "$1"; }
ok()   { printf '%s✓%s %s\n'  "$C_GREEN" "$C_RESET" "$1"; }
err()  { printf '%sERROR:%s %s\n' "$C_RED" "$C_RESET" "$1" >&2; }

prompt_yn() {
  # $1 question, $2 default ("Y" or "n"). Return 0 for yes, 1 for no.
  local q="$1" def="${2:-Y}" ans
  if [[ $AUTO_YES -eq 1 ]]; then
    printf '%s %s%s%s\n' "$q" "$C_DIM" "$def" "$C_RESET"
    ans="$def"
  elif [[ -r /dev/tty ]]; then
    read -r -p "$q " ans < /dev/tty
  else
    read -r ans || ans=""
  fi
  ans="${ans:-$def}"
  [[ "$ans" =~ ^[Yy]$ ]]
}

semver_ge() {
  local a="${1%%-*}" b="${2%%-*}"
  local IFS=.
  local -a ap bp
  # shellcheck disable=SC2206
  ap=( $a ); bp=( $b )
  local i av bv
  for i in 0 1 2; do
    av="${ap[i]:-0}"; bv="${bp[i]:-0}"
    if (( 10#$av > 10#$bv )); then return 0; fi
    if (( 10#$av < 10#$bv )); then return 1; fi
  done
  return 0
}

# ------------------------------------------------------------------ banner
cat <<BANNER
${C_BLUE}Agent Quest${C_RESET} — a local dashboard for Claude Code agents
  License: MIT
  Runs entirely on your machine — no API keys, no telemetry, no cloud
  Source: https://github.com/FulAppiOS/agent-quest

This installer will:
  • Check/install Bun (via bun.sh official installer, if missing)
  • Clone the repo into ${INSTALL_DIR}
  • Install dependencies (bun install)
  • Create a CLI shortcut in ~/.local/bin/agentquest

BANNER

if ! prompt_yn "Proceed? [Y/n]" "Y"; then
  info "Install cancelled."
  exit 1
fi

# ------------------------------------------------------------------ OS check
if [[ "$(uname -s)" != "Darwin" ]]; then
  err "macOS only. See README 'Manual install' for other platforms."
  exit 1
fi
ok "macOS detected."

# ------------------------------------------------------------------ Bun
if ! command -v bun >/dev/null 2>&1; then
  info "Bun not found."
  if prompt_yn "Install Bun via https://bun.sh? [Y/n]" "Y"; then
    curl -fsSL https://bun.sh/install | bash
    # Try to pick up the freshly-installed Bun in this subshell.
    export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
    export PATH="$BUN_INSTALL/bin:$PATH"
    if ! command -v bun >/dev/null 2>&1; then
      err "Bun installed but not in PATH for this shell. Restart your terminal and re-run this installer."
      exit 2
    fi
  else
    err "Bun is required. Install it manually from https://bun.sh and re-run."
    exit 2
  fi
fi
BUN_VERSION="$(bun --version 2>/dev/null)" || { err "bun --version failed."; exit 2; }
if ! semver_ge "$BUN_VERSION" "$MIN_BUN"; then
  err "Found Bun v$BUN_VERSION, need >= $MIN_BUN. Upgrade with: bun upgrade"
  exit 2
fi
ok "Bun v$BUN_VERSION"

# ------------------------------------------------------------------ clone
if [[ -d "$INSTALL_DIR/.git" ]]; then
  if ( cd "$INSTALL_DIR" && git remote get-url origin 2>/dev/null | grep -q "agent-quest" ); then
    info "Existing Agent Quest install at $INSTALL_DIR."
    if prompt_yn "Update it with git pull? [Y/n]" "Y"; then
      ( cd "$INSTALL_DIR" \
        && git fetch origin main --quiet \
        && git pull --ff-only --quiet )
      ok "Repo updated."
    else
      info "Leaving existing install alone."
    fi
  else
    err "Directory $INSTALL_DIR exists but is not an Agent Quest checkout."
    err "Remove it or use --dir <other-path> to install elsewhere."
    exit 3
  fi
elif [[ -e "$INSTALL_DIR" ]]; then
  err "$INSTALL_DIR exists and is not a git repo. Remove it or use --dir <other-path>."
  exit 3
else
  info "Cloning into $INSTALL_DIR ..."
  git clone --quiet "$REPO_URL" "$INSTALL_DIR"
  ok "Cloned."
fi

# ------------------------------------------------------------------ deps
info "Installing dependencies (bun install) ..."
( cd "$INSTALL_DIR" && bun install --silent )
ok "Dependencies installed."

# ------------------------------------------------------------------ symlink
BIN_DIR="$HOME/.local/bin"
LINK="$BIN_DIR/agentquest"
TARGET="$INSTALL_DIR/bin/agentquest"
mkdir -p "$BIN_DIR"
if [[ -L "$LINK" ]]; then
  if [[ "$(readlink "$LINK")" == "$TARGET" ]]; then
    ok "CLI shortcut already up to date."
  else
    ln -sf "$TARGET" "$LINK"
    ok "CLI shortcut updated."
  fi
elif [[ -e "$LINK" ]]; then
  err "$LINK exists and is not a symlink. Remove it manually and re-run."
  exit 3
else
  ln -s "$TARGET" "$LINK"
  ok "CLI shortcut installed at $LINK"
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) : ;;
  *)
    printf '\n%sNOTE:%s ~/.local/bin is not in your PATH. Add it with:\n  %secho '\''export PATH="$HOME/.local/bin:$PATH"'\'' >> ~/.zshrc && source ~/.zshrc%s\n\n' \
      "$C_BLUE" "$C_RESET" "$C_DIM" "$C_RESET"
    ;;
esac

ok "Installation complete."

# ------------------------------------------------------------------ start?
if [[ $NO_START -eq 1 ]]; then
  printf 'Run: %sagentquest start%s\n' "$C_GREEN" "$C_RESET"
  exit 0
fi

if prompt_yn "Start Agent Quest now? [Y/n]" "Y"; then
  exec "$TARGET" start
else
  printf 'Run: %sagentquest start%s\n' "$C_GREEN" "$C_RESET"
fi
```

- [ ] **Step 2: Make executable**

Run:
```bash
chmod +x install.sh
ls -l install.sh
```

Expected: `-rwxr-xr-x`. On macOS, git records the executable bit automatically at commit time.

- [ ] **Step 3: Syntax check**

Run:
```bash
bash -n install.sh && echo "syntax OK"
```

Expected: `syntax OK`.

- [ ] **Step 4: Test `--help`**

Run:
```bash
./install.sh --help
```

Expected: usage block with `--dir`, `--yes`, `--no-start`, `--help`. Exit 0.

- [ ] **Step 5: Dry-run into a throwaway directory (end-to-end)**

Run:
```bash
TEST_DIR="/tmp/aq-install-test-$$"
rm -rf "$TEST_DIR"
./install.sh --dir "$TEST_DIR" --yes --no-start
```

Expected:
- macOS check passes.
- Bun check passes (already installed; version printed).
- "Cloning into /tmp/aq-install-test-..." message.
- bun install runs.
- Symlink created at `~/.local/bin/agentquest` (pointing at the TEST_DIR).
- Prints `Run: agentquest start`.
- Exit code 0.

Verify:
```bash
[[ -x "$TEST_DIR/bin/agentquest" ]] && echo "bin: OK"
[[ -L "$HOME/.local/bin/agentquest" ]] && echo "symlink: OK"
readlink "$HOME/.local/bin/agentquest"
"$TEST_DIR/bin/agentquest" --version
```

Expected:
- `bin: OK`
- `symlink: OK`
- The symlink readlink prints `$TEST_DIR/bin/agentquest`.
- `agentquest v0.0.1 (...)` is printed.

- [ ] **Step 6: Cleanup the throwaway install and restore the real symlink**

```bash
rm -rf "$TEST_DIR"
# Restore the symlink to point at the actual working repo (so your shell's
# `agentquest` command doesn't dangle after the cleanup).
ln -sf "$PWD/bin/agentquest" "$HOME/.local/bin/agentquest"
ls -l "$HOME/.local/bin/agentquest"
```

Expected: symlink now targets your working-branch checkout.

- [ ] **Step 7: Commit**

```bash
git add install.sh
git commit -m "$(cat <<'EOF'
feat: add install.sh one-line installer (macOS)

One-shot `curl | bash` installer that:

  • prints a transparent banner (MIT, local-only, no API keys),
  • confirms before touching anything,
  • checks/installs Bun via the official bun.sh installer,
  • clones into ~/agent-quest (override via --dir),
  • runs bun install,
  • symlinks ~/.local/bin/agentquest -> <repo>/bin/agentquest,
  • optionally runs `agentquest start` to hand the user a running village.

Flags: --dir, --yes, --no-start, --help. Idempotent: re-running on an
existing Agent Quest checkout offers a git pull instead of refusing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update `README.md`

**Files:**
- Modify: `README.md` (Quick start block; new Manual install subsection; Development line; Troubleshooting entry)

- [ ] **Step 1: Replace the Quick start code fence**

In `README.md`, locate the `## Quick start` section (around L55). Replace the existing three-command block:

```markdown
```bash
git clone https://github.com/FulAppiOS/agent-quest.git
cd agent-quest
bun install
npm start              # or: bun start
```
```

with the new one-liner + pointer:

```markdown
### One-line install (macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/FulAppiOS/agent-quest/main/install.sh | bash
```

The installer prints exactly what it's going to do and asks before touching anything. It checks/installs Bun, clones into `~/agent-quest` (override with `--dir <path>`), runs `bun install`, creates an `agentquest` shortcut in `~/.local/bin/`, and offers to launch right away. When it finishes, your browser opens on <http://localhost:4445> and the village appears.

From the next session onwards:

```bash
agentquest            # same as `agentquest start` — launches and opens the browser
agentquest update     # git pull + bun install (preserves local map edits)
```

### Manual install

Prefer to do it by hand? The installer does nothing magical — three commands:

```bash
git clone https://github.com/FulAppiOS/agent-quest.git
cd agent-quest
bun install
# optional: add the CLI shortcut
mkdir -p ~/.local/bin
ln -s "$PWD/bin/agentquest" ~/.local/bin/agentquest
```

Then `bun start` (or `agentquest start` if you created the symlink). `agentquest update` works on manually-cloned repos too.
```

(Leave the "Open <http://localhost:4445>..." paragraph that follows the current Quick start intact, or fold it into the one-line section — whichever reads better once the edit is made. Preserve all surrounding prose about assets, Claude Code, etc.)

- [ ] **Step 2: Add a Troubleshooting entry**

In the `## Troubleshooting` section, after the `EADDRINUSE` bullet, append:

```markdown
**`agentquest: command not found` after install** — `~/.local/bin` is not in your `$PATH`. Add it:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```
```

- [ ] **Step 3: Add the update line to Development**

In the `## Development` section, append this line after `npm run check:assets`:

```markdown
agentquest update      # git pull + bun install (preserves local maps)
```

- [ ] **Step 4: Verify README renders cleanly**

Run (optional, only if `mdcat` or similar is available):
```bash
grep -n "Quick start\|Manual install\|agentquest" README.md | head
```

Expected: the new sections appear in order, no leftover references to the old three-command quick start.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: README — one-line install and agentquest CLI

Replace the three-command Quick start with the `curl | bash`
installer. Add a Manual install subsection (unchanged three-step
recipe + optional symlink) so users who prefer not to pipe curl to
bash still have a first-class path. Add `agentquest update` to the
Development list and a Troubleshooting entry for the
command-not-found case.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: End-to-end verification

**Why:** Shell scripts fail in subtle ways. Before calling the work done, walk through the real user flow on the real branch.

**Files:** (none — verification only)

- [ ] **Step 1: Fresh-install simulation with `--no-start`**

```bash
TEST_DIR="/tmp/aq-e2e-$$"
rm -rf "$TEST_DIR"
bash install.sh --dir "$TEST_DIR" --yes --no-start
[[ -f "$TEST_DIR/bin/agentquest" ]] && echo "bin: OK"
[[ -d "$TEST_DIR/server/node_modules" ]] && echo "server deps: OK"
[[ -d "$TEST_DIR/client/node_modules" ]] && echo "client deps: OK"
[[ -L "$HOME/.local/bin/agentquest" ]] && echo "symlink: OK"
"$TEST_DIR/bin/agentquest" --version
```

Expected: all four `OK` lines plus a `agentquest vX.Y.Z (...)` print.

- [ ] **Step 2: Idempotent re-run**

```bash
bash install.sh --dir "$TEST_DIR" --yes --no-start
```

Expected: detects existing install, offers update, completes successfully (no fatal errors, exit 0).

- [ ] **Step 3: Dirty-tree update (n-path)**

```bash
cd "$TEST_DIR"
echo "/*dirty*/" >> server/data/maps/slot-1.json
# Answer "n" to the prompt
echo "n" | bin/agentquest update
```

Expected: shows `Local changes detected:` with `slot-1.json` listed, then `Update cancelled.`, exit 0. Working tree still dirty (slot-1.json still modified).

- [ ] **Step 4: Dirty-tree update (Y-path, clean stash-pop)**

```bash
# Answer default (empty line → Y)
printf '\n' | bin/agentquest update
```

Expected: `Stashed as 'agentquest-update-...'`, `Pulling ...`, `Updated. Your local maps were preserved.` or similar, exit 0. If no upstream changes (likely, since this is a local clone of a fresh install), the earlier `Already up to date.` path is hit first — equally valid.

- [ ] **Step 5: Cleanup**

```bash
cd "$OLDPWD"
rm -rf "$TEST_DIR"
ln -sf "$PWD/bin/agentquest" "$HOME/.local/bin/agentquest"
ls -l "$HOME/.local/bin/agentquest"
```

Expected: symlink points back at the working checkout.

- [ ] **Step 6: Client-side sanity**

```bash
cd client && bun run build && cd ..
```

Expected: production build completes with no errors.

- [ ] **Step 7: Server-side sanity**

```bash
cd server && bun test && cd ..
```

Expected: all tests pass.

- [ ] **Step 8: Asset check**

```bash
bun run check:assets
```

Expected: exit 0, no missing assets.

- [ ] **Step 9: Summary — confirm the branch state**

```bash
git log --oneline main..HEAD
git status
```

Expected: **7 commits ahead of main** — the design spec (pre-plan) plus one commit per implementation task (Tasks 1 through 6). Working tree clean.

(If any extra working-tree changes exist from the verification steps, reset them: `git checkout -- .` — do NOT commit test artefacts.)

- [ ] **Step 10: Update the branch**

No extra commit here. If verification passed, the branch is ready for the user to open a PR.

---

## Out of scope (explicit reminders)

From the spec's non-goals — do **not** do these as part of this plan:

- Do not move slots out of the git tree. That's "Spec B" territory.
- Do not add a `stop`, `doctor`, or `logs` sub-command. Health checks stay implicit inside `start`.
- Do not add Linux / Windows install paths. Keep the macOS exit with pointer.
- Do not publish to npm / brew / standalone binary.
- Do not auto-update on each `start`.
- Do not add unit tests for `install.sh` or `bin/agentquest`; verification is manual (Task 7).

## Test matrix (for reference — already covered above)

| Scenario | Where tested |
|---|---|
| Fresh install, `--no-start` | Task 7 Step 1 |
| Re-install on existing checkout | Task 7 Step 2 |
| Update, dirty tree, n path | Task 7 Step 3 |
| Update, dirty tree, Y path | Task 7 Step 4 |
| Update on non-main branch | Task 4 Step 7 |
| Update on clean/in-sync tree | Task 7 Step 4 (via "Already up to date") |
| Client TypeScript passes | Task 2 Step 6 |
| Client production build | Task 2 Step 7 + Task 7 Step 6 |
| Server tests | Task 3 Step 4 + Task 7 Step 7 |
| Asset integrity | Task 7 Step 8 |
| Symlink self-location | Task 4 Step 6 |
