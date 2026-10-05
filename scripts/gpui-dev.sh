#!/usr/bin/env bash
# Build and start the GPUI rewrite (branch rewrite/gpui) from its own worktree,
# so the Electron checkout stays untouched.
#
# From the main checkout (the script does not exist on main):
#   git fetch origin rewrite/gpui && git show origin/rewrite/gpui:scripts/gpui-dev.sh | bash
# From inside the rewrite worktree:
#   ./scripts/gpui-dev.sh [--release]
#
# The worktree lives next to the repo as ../opt-gpui. The first build takes a
# few minutes; later runs only rebuild what changed.
set -euo pipefail

BRANCH="rewrite/gpui"
CARGO_ARGS=()
if [[ "${1:-}" == "--release" ]]; then
  CARGO_ARGS=(--release)
fi

repo_root="$(git rev-parse --show-toplevel)"
if [[ "$(git -C "$repo_root" rev-parse --abbrev-ref HEAD)" == "$BRANCH" ]]; then
  worktree="$repo_root"
else
  worktree="$(dirname "$repo_root")/opt-gpui"
fi

# rustup installs into ~/.cargo/bin, which a fresh shell may not have on PATH yet.
if ! command -v cargo >/dev/null 2>&1 && [[ -x "$HOME/.cargo/bin/cargo" ]]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust is not installed. Install it, then run this again:"
  echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  exit 1
fi
if [[ "$(uname)" == "Darwin" ]] && ! xcode-select -p >/dev/null 2>&1; then
  echo "The Xcode command line tools are missing (needed to link). Install them with:"
  echo "  xcode-select --install"
  exit 1
fi

echo "Fetching ${BRANCH}..."
git -C "$repo_root" fetch --quiet origin "$BRANCH"

if [[ ! -e "$worktree/.git" ]]; then
  echo "Creating worktree $worktree"
  if git -C "$repo_root" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git -C "$repo_root" worktree add "$worktree" "$BRANCH"
  else
    git -C "$repo_root" worktree add --track -b "$BRANCH" "$worktree" "origin/$BRANCH"
  fi
fi

echo "Updating ${worktree}..."
if ! git -C "$worktree" pull --ff-only --quiet origin "$BRANCH"; then
  echo "Could not fast-forward $worktree (local changes?). Starting the version that is there."
fi

cd "$worktree"
echo "Building and starting ($(git rev-parse --short HEAD))…"
# Empty-array expansion that also works with macOS bash 3.2 under set -u.
exec cargo run -p prayer-ui ${CARGO_ARGS[@]+"${CARGO_ARGS[@]}"}
