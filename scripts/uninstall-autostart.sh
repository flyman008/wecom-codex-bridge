#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This uninstaller only supports macOS." >&2
  exit 1
fi

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
installation_id="$(printf '%s' "$project_root" | shasum -a 256 | cut -c1-10)"
label="com.local.wecom-codex-bridge.$installation_id"
plist_path="$HOME/Library/LaunchAgents/$label.plist"

if [[ -f "$plist_path" ]]; then
  launchctl bootout "gui/$(id -u)" "$plist_path" 2>/dev/null || true
  rm -f "$plist_path"
fi

echo "LaunchAgent removed: $plist_path"
