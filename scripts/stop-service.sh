#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pid_file="$project_root/.runtime/service.pid"
entry_path="$project_root/dist/src/index.js"

if [[ ! -f "$pid_file" ]]; then
  echo "Service is not running (PID file not found)."
  exit 0
fi

service_pid="$(tr -d '[:space:]' < "$pid_file")"
if [[ ! "$service_pid" =~ ^[0-9]+$ ]] || ! kill -0 "$service_pid" 2>/dev/null; then
  rm -f "$pid_file"
  echo "Service is not running (stale PID file removed)."
  exit 0
fi

command_line="$(ps -p "$service_pid" -o command= 2>/dev/null || true)"
if [[ "$command_line" != *"$entry_path"* ]]; then
  echo "PID $service_pid does not belong to this service; refusing to stop it." >&2
  exit 1
fi

kill "$service_pid"
for _ in {1..20}; do
  if ! kill -0 "$service_pid" 2>/dev/null; then
    rm -f "$pid_file"
    echo "Service stopped (PID $service_pid)."
    exit 0
  fi
  sleep 0.25
done

echo "Service did not stop within 5 seconds." >&2
exit 1
