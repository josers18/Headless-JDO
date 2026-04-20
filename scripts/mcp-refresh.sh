#!/usr/bin/env bash
# mcp-refresh.sh — single-command recovery from a stale Salesforce token.
#
# Runs the full loop so you never have to remember the four manual steps
# again:
#   1. `sf:login` — OAuth 2.1 + PKCE against the ECA, writes fresh tokens to .env
#   2. `export-mcp-env.sh` — exports the four MCP env vars into this shell
#      AND into the macOS GUI session via launchctl, so Cursor (launched
#      from the Dock) sees them on next relaunch
#   3. `mcp:check` — verifies all 4 Hosted MCP endpoints + userinfo come
#      back 200 with the new token
#   4. prints the final manual step (reload Cursor's MCP panel)
#
# On any failure we stop and print what broke, instead of pretending success.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
DIM="\033[90m"
RESET="\033[0m"

echo ""
echo -e "${BOLD}[1/3] Salesforce OAuth (PKCE)${RESET}"
echo -e "${DIM}Running: npm run sf:login${RESET}"
echo ""
npm run --silent sf:login

echo ""
echo -e "${BOLD}[2/3] Export to shell + launchctl${RESET}"
# We need `source` here so the current shell receives the values — and the
# helper writes through to launchctl for Cursor's GUI session.
# shellcheck disable=SC1091
source "$SCRIPT_DIR/export-mcp-env.sh"

echo ""
echo -e "${BOLD}[3/3] Probe Hosted MCPs${RESET}"
echo -e "${DIM}Running: npm run mcp:check${RESET}"
echo ""
npm run --silent mcp:check

echo ""
echo -e "${GREEN}${BOLD}Tokens rotated + propagated.${RESET}"
echo ""
echo -e "${BOLD}One manual step left:${RESET} reload Cursor's MCP panel so it picks up the new Authorization header value."
echo ""
echo -e "  ${DIM}Cmd+Shift+J → Features → Model Context Protocol → toggle each SF server OFF, then back ON${RESET}"
echo ""
echo -e "${YELLOW}If toggling alone doesn't clear the 'needsAuth' badge, fully quit Cursor${RESET}"
echo -e "${YELLOW}(Cmd+Q) and relaunch — the launchctl values above are already set${RESET}"
echo -e "${YELLOW}in the GUI session, so a Dock launch will see the new token.${RESET}"
echo ""
