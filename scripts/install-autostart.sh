#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer only supports macOS." >&2
  exit 1
fi

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
entry_path="$project_root/dist/src/index.js"
log_dir="$project_root/logs"
node_path="$(command -v node)"
installation_id="$(printf '%s' "$project_root" | shasum -a 256 | cut -c1-10)"
label="com.local.wecom-codex-bridge.$installation_id"
launch_agents_dir="$HOME/Library/LaunchAgents"
plist_path="$launch_agents_dir/$label.plist"
path_value="$PATH:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin"

if [[ ! -f "$entry_path" ]]; then
  echo "Build output not found. Run npm run build first." >&2
  exit 1
fi

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'
}

mkdir -p "$launch_agents_dir" "$log_dir"

escaped_node="$(xml_escape "$node_path")"
escaped_entry="$(xml_escape "$entry_path")"
escaped_root="$(xml_escape "$project_root")"
escaped_stdout="$(xml_escape "$log_dir/service.stdout.log")"
escaped_stderr="$(xml_escape "$log_dir/service.stderr.log")"
escaped_path="$(xml_escape "$path_value")"

{
  echo '<?xml version="1.0" encoding="UTF-8"?>'
  echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
  echo '<plist version="1.0"><dict>'
  echo "  <key>Label</key><string>$label</string>"
  echo "  <key>ProgramArguments</key><array><string>$escaped_node</string><string>$escaped_entry</string></array>"
  echo "  <key>WorkingDirectory</key><string>$escaped_root</string>"
  echo '  <key>RunAtLoad</key><true/>'
  echo '  <key>KeepAlive</key><true/>'
  echo "  <key>StandardOutPath</key><string>$escaped_stdout</string>"
  echo "  <key>StandardErrorPath</key><string>$escaped_stderr</string>"
  echo "  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$escaped_path</string></dict>"
  echo '</dict></plist>'
} > "$plist_path"

plutil -lint "$plist_path" >/dev/null
launchctl bootout "gui/$(id -u)" "$plist_path" 2>/dev/null || true
if [[ -f "$project_root/.runtime/service.pid" ]]; then
  "$project_root/scripts/stop-service.sh"
fi
launchctl bootstrap "gui/$(id -u)" "$plist_path"

sleep 2
"$project_root/scripts/status-service.sh"

echo "LaunchAgent installed: $plist_path"
