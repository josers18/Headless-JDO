#!/usr/bin/env bash
# export-mcp-env.sh — exports the environment variables that .cursor/mcp.json
# interpolates at startup. Cursor's remote HTTP MCP support reads variables
# from the shell it was launched in (it does NOT read the workspace .env for
# remote servers), so you need to do this BEFORE relaunching or reloading
# Cursor's MCP panel:
#
#   source scripts/export-mcp-env.sh
#   # then: Cmd+Shift+J -> Features -> Model Context Protocol -> reload
#
# If you're on a GUI launch of Cursor (not from the terminal), add the same
# four lines to ~/.zshrc or ~/.bash_profile so every new login shell has
# them — Cursor inherits your login shell environment.
#
# This script is idempotent and silent on success. It errors loudly if .env
# is missing or if any required variable is absent, so you know immediately
# rather than seeing a cryptic "invalid token" in the MCP panel later.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "export-mcp-env.sh: $ENV_FILE not found" >&2
  return 1 2>/dev/null || exit 1
fi

# Parse only the vars we care about; ignore quoting subtleties by using sh's
# own parser on each matching line.
REQUIRED=(SF_ACCESS_TOKEN SF_INSTANCE_URL INFERENCE_URL INFERENCE_KEY)

for key in "${REQUIRED[@]}"; do
  line=$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)
  if [ -z "$line" ]; then
    echo "export-mcp-env.sh: missing $key in $ENV_FILE" >&2
    return 1 2>/dev/null || exit 1
  fi
  # Strip leading KEY= and any surrounding single / double quotes.
  value="${line#${key}=}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  export "${key}=${value}"
  # Also push into the macOS GUI session so Cursor launched from the Dock
  # inherits it. Harmless on Linux (launchctl missing → ignored).
  if command -v launchctl >/dev/null 2>&1; then
    launchctl setenv "${key}" "${value}" 2>/dev/null || true
  fi
done

# Also export SF_REFRESH_TOKEN if present — useful for the refresh helper.
refresh_line=$(grep -E "^SF_REFRESH_TOKEN=" "$ENV_FILE" | tail -n 1 || true)
if [ -n "$refresh_line" ]; then
  value="${refresh_line#SF_REFRESH_TOKEN=}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  export "SF_REFRESH_TOKEN=${value}"
  if command -v launchctl >/dev/null 2>&1; then
    launchctl setenv SF_REFRESH_TOKEN "${value}" 2>/dev/null || true
  fi
fi

echo "export-mcp-env.sh: exported SF_ACCESS_TOKEN, SF_INSTANCE_URL, INFERENCE_URL, INFERENCE_KEY (shell + launchctl)" >&2
