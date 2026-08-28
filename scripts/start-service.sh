#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_dir="$project_root/.runtime"
log_dir="$project_root/logs"
pid_file="$runtime_dir/service.pid"
entry_path="$project_root/dist/src/index.js"

mkdir -p "$runtime_dir" "$log_dir"

if [[ -f "$pid_file" ]]; then
  existing_pid="$(tr -d '[:space:]' < "$pid_file")"
  if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "Service is already running (PID $existing_pid)."
    exit 0
  fi
  rm -f "$pid_file"
fi

if [[ ! -f "$entry_path" ]]; then
  echo "Build output not found: $entry_path" >&2
  exit 1
fi

nohup node "$entry_path" \
  >> "$log_dir/service.stdout.log" \
  2>> "$log_dir/service.stderr.log" \
  < /dev/null &
service_pid=$!
echo "$service_pid" > "$pid_file"

sleep 1
if ! kill -0 "$service_pid" 2>/dev/null; then
  rm -f "$pid_file"
  echo "Service failed to start. Check logs/service.stderr.log." >&2
  exit 1
fi

echo "Service started (PID $service_pid)."
