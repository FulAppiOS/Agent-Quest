#!/usr/bin/env bash
# Agent Quest — one-line installer for macOS.
# Usage: curl -fsSL https://raw.githubusercontent.com/FulAppiOS/Agent-Quest/main/install.sh | bash
set -euo pipefail

REPO_URL="https://github.com/FulAppiOS/Agent-Quest.git"
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
    --dir)
      # Validate before assignment: under `set -u`, a bare "$2" when $2
      # is unset aborts with a cryptic bash error. Give a clear one instead.
      if [[ -z "${2:-}" ]]; then
        printf 'ERROR: --dir requires a path argument (e.g. --dir ~/agent-quest)\n' >&2
        exit 1
      fi
      INSTALL_DIR="$2"
      shift 2
      ;;
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
${C_BLUE}Agent Quest${C_RESET} — a local dashboard for Claude Code and Codex agents
  License: MIT (open source, hobby project)
  Runs entirely on your machine — no API keys, no telemetry, no cloud
  Source: https://github.com/FulAppiOS/Agent-Quest

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
    # Official Bun installer. Source: https://github.com/oven-sh/bun
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
      if ! ( cd "$INSTALL_DIR" \
               && git fetch origin main --quiet \
               && git pull --ff-only --quiet ); then
        err "git pull failed — your existing checkout may have local changes or"
        err "have diverged from origin/main. Resolve manually, then re-run:"
        err "  cd $INSTALL_DIR && git status"
        err "  agentquest update   (safer: handles dirty trees with stash)"
        exit 3
      fi
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
  current_target="$(readlink "$LINK")"
  if [[ "$current_target" == "$TARGET" ]]; then
    ok "CLI shortcut already up to date."
  elif [[ "$current_target" == *"/bin/agentquest" ]]; then
    # Previous target is another Agent Quest checkout — safe to overwrite.
    ln -sf "$TARGET" "$LINK"
    ok "CLI shortcut updated (was: $current_target)."
  else
    err "$LINK already points at $current_target (not an Agent Quest install)."
    if prompt_yn "Overwrite it? [y/N]" "n"; then
      ln -sf "$TARGET" "$LINK"
      ok "CLI shortcut replaced."
    else
      err "Keeping existing symlink. CLI shortcut NOT installed."
      exit 3
    fi
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
exit 0
