#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pid_file="$project_root/.runtime/service.pid"
env_file="$project_root/.env"
service_pid=""
process_running="false"
health_port="8787"

if [[ -f "$pid_file" ]]; then
  service_pid="$(tr -d '[:space:]' < "$pid_file")"
  if [[ "$service_pid" =~ ^[0-9]+$ ]] && kill -0 "$service_pid" 2>/dev/null; then
    process_running="true"
  fi
fi

if [[ -f "$env_file" ]]; then
  configured_port="$(sed -n 's/^HEALTH_PORT=//p' "$env_file" | tail -n 1 | tr -d '[:space:]')"
  if [[ "$configured_port" =~ ^[0-9]+$ ]]; then
    health_port="$configured_port"
  fi
fi

health_json="$(curl --silent --show-error --max-time 3 "http://127.0.0.1:$health_port/health" 2>/dev/null || true)"
if [[ -z "$health_json" ]]; then
  health_json='{"status":"unavailable","activeTasks":null}'
fi

printf '{"processRunning":%s,"processId":"%s","health":%s}\n' \
  "$process_running" "$service_pid" "$health_json"
