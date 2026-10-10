#!/bin/bash
# Joiner-side propagation assertions against a fixture's expect.json:
# the team clone, every tracked repo cloned, every team plugin installed,
# every team secret decryptable with THIS machine's age key, and every
# deck-managed job actually running. Run as tester in the joiner guest.
# Usage: assert-team.sh <slug> <expect.json>
#
# HARNESS_PROFILE (claude-only | codex-only | mixed) names the agent apps this
# guest was set up with and turns on the profile assertions: each selected
# harness got its own skills build and Mattstack MCP entry, and a Codex-only
# guest has no Claude CLI or configuration at all. Unset, the run checks what
# it always did (Claude's team plugins) and nothing more.
set -uo pipefail
SLUG="${1:?slug}"; EXPECT="${2:?expect.json}"
export PATH="$HOME/.local/bin:/Applications/mattstack.app/Contents/Helpers:/usr/bin:/bin:/usr/sbin:/sbin"
RT="${RT:-/tmp/rt-new}"; [ -x "$RT" ] || RT=rt
fails=0
ok()  { echo "TEAM ok   $1"; }
bad() { echo "TEAM FAIL $1"; fails=$((fails+1)); }
TEAM="$HOME/.mattstack/teams/$SLUG"
PROFILE_ASSERTS=0; [ -n "${HARNESS_PROFILE:-}" ] && PROFILE_ASSERTS=1
HARNESS_PROFILE="${HARNESS_PROFILE:-claude-only}"
case "$HARNESS_PROFILE" in
  claude-only) WANT_CLAUDE=1; WANT_CODEX=0 ;;
  codex-only)  WANT_CLAUDE=0; WANT_CODEX=1 ;;
  mixed)       WANT_CLAUDE=1; WANT_CODEX=1 ;;
  *) echo "TEAM FAIL unknown HARNESS_PROFILE $HARNESS_PROFILE (want claude-only|codex-only|mixed)"; exit 1 ;;
esac
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
APP_HELPERS="/Applications/mattstack.app/Contents/Helpers"

# Profile: what the selected harnesses got, and what an unselected one did not.
if [ "$PROFILE_ASSERTS" = 1 ] && [ "$WANT_CLAUDE" = 0 ]; then
  if command -v claude >/dev/null 2>&1 && [ "${CLAUDE_TRIPWIRE:-}" != "$(command -v claude)" ]; then bad "claude is on PATH in a Codex-only guest: $(command -v claude)"; else ok "no Claude CLI on PATH"; fi
  [ -e "$HOME/.claude" ] && bad "~/.claude exists in a Codex-only guest" || ok "no ~/.claude"
  [ -e "$HOME/.claude.json" ] && bad "~/.claude.json exists in a Codex-only guest" || ok "no ~/.claude.json"
  if [ -n "${CLAUDE_TRIPWIRE_LOG:-}" ] && [ -s "$CLAUDE_TRIPWIRE_LOG" ]; then bad "the Claude tripwire was called: $(head -1 "$CLAUDE_TRIPWIRE_LOG")"; else ok "the Claude tripwire was never called"; fi
fi
if [ "$PROFILE_ASSERTS" = 1 ] && [ "$WANT_CODEX" = 1 ]; then
  command -v codex >/dev/null 2>&1 && ok "Codex CLI on PATH ($(codex --version 2>/dev/null | head -1))" || bad "no Codex CLI on PATH"
  grep -q '^\[mcp_servers\.mattstack\]' "$CODEX_HOME_DIR/config.toml" 2>/dev/null && ok "Mattstack MCP entry in $CODEX_HOME_DIR/config.toml" || bad "no [mcp_servers.mattstack] in $CODEX_HOME_DIR/config.toml"
  for app in board gitq; do
    linked=$(find "$CODEX_HOME_DIR/skills" -maxdepth 1 -type l -lname "$APP_HELPERS/skills-targets/codex/$app/*" 2>/dev/null | wc -l | tr -d ' ')
    [ "${linked:-0}" -gt 0 ] && ok "$app skills linked for Codex from the Codex build ($linked)" || bad "no $app skills linked for Codex from Helpers/skills-targets/codex/$app"
  done
  if find "$CODEX_HOME_DIR/skills" -maxdepth 1 -type l -lname "$APP_HELPERS/skills/*" 2>/dev/null | grep -q .; then bad "Codex links a Claude build from Helpers/skills"; else ok "Codex links no Claude build"; fi
fi
if [ "$PROFILE_ASSERTS" = 1 ] && [ "$WANT_CLAUDE" = 1 ]; then
  for app in board gitq; do
    linked=$(find "$HOME/.claude/skills" -maxdepth 1 -type l -lname "$APP_HELPERS/skills/$app/*" 2>/dev/null | wc -l | tr -d ' ')
    [ "${linked:-0}" -gt 0 ] && ok "$app skills linked for Claude ($linked)" || bad "no $app skills linked for Claude from Helpers/skills/$app"
  done
fi

[ -d "$TEAM/.git" ] && ok "team clone at $TEAM ($(git -C "$TEAM" rev-parse --short HEAD))" || bad "no team clone at $TEAM"

# The setup checklist's team.sync row is the daemon's own readiness signal.
SETUP_JSON=$("$RT" setup status --json 2>/dev/null | tail -1)
ROW=$(printf '%s' "$SETUP_JSON" | jq -c '.groups[]?.rows[]? | select(.id == "team.sync")' 2>/dev/null | head -1)
if [ -n "$ROW" ]; then
  ROW_STATUS=$(printf '%s' "$ROW" | jq -r '.status')
  ROW_DETAIL=$(printf '%s' "$ROW" | jq -r '.detail // empty')
  if [ "$ROW_STATUS" = "ready" ]; then ok "team.sync row ready"; else bad "team.sync row $ROW_STATUS: $ROW_DETAIL"; fi
else
  bad "team.sync row absent"
fi

# A joiner's first pass through the checklist runs before team.join clones the
# team, so every team-declared required row is invisible then; requiredMissing
# only fills in on this later pass, once the snapshot is real. Empty here is
# the one claim that actually says a joiner can finish, not just that the run
# went green.
MISSING=$(printf '%s' "$SETUP_JSON" | jq -r '.requiredMissing[]?' 2>/dev/null)
if [ -z "$MISSING" ]; then
  ok "requiredMissing is empty"
else
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    ROW=$(printf '%s' "$SETUP_JSON" | jq -c --arg id "$id" '.groups[]?.rows[]? | select(.id == $id)' 2>/dev/null | head -1)
    RS=$(printf '%s' "$ROW" | jq -r '.status // "row absent"' 2>/dev/null)
    RD=$(printf '%s' "$ROW" | jq -r '.detail // empty' 2>/dev/null)
    bad "requiredMissing: $id ($RS: $RD)"
  done <<< "$MISSING"
fi

# Without a global identity every commit on this Mac, the snapshot daemon's
# included, carries git's auto-derived author instead of the operator's own.
GIT_NAME=$(git config --global user.name 2>/dev/null)
GIT_EMAIL=$(git config --global user.email 2>/dev/null)
if [ -n "$GIT_NAME" ] && [ -n "$GIT_EMAIL" ]; then ok "git identity: $GIT_NAME <$GIT_EMAIL>"; else bad "git identity not configured"; fi

# Tracked repos: repos.clone puts each under the first rt.repoRoots entry.
ROOT=$("$RT" settings get rt.repoRoots --json 2>/dev/null | jq -r '.value[0] // empty')
for repo in $(jq -r '.repos[]?' "$EXPECT"); do
  if [ -n "$ROOT" ] && [ -d "$ROOT/$repo/.git" ]; then ok "tracked repo cloned: $ROOT/$repo"; else bad "tracked repo not cloned: $repo (repoRoots[0]=${ROOT:-unset})"; fi
done

# Team plugins: installed (never auto-enabled) through each selected
# harness's own CLI. A Codex-only profile reads Codex's list and never runs
# claude, which the profile assertions below require to be absent.
if [ "$WANT_CLAUDE" = 1 ]; then
  INSTALLED="$HOME/.claude/plugins/installed_plugins.json"
  for plugin in $(jq -r '.plugins[]?' "$EXPECT"); do
    if [ -f "$INSTALLED" ] && jq -e --arg p "$plugin" '.plugins[$p] != null' "$INSTALLED" >/dev/null 2>&1; then ok "team plugin installed: $plugin"; else bad "team plugin not installed: $plugin"; fi
  done
fi
if [ "$WANT_CODEX" = 1 ]; then
  CODEX_LIST=$(codex plugin list --json 2>/dev/null)
  for plugin in $(jq -r '.plugins[]?' "$EXPECT"); do
    if printf '%s' "$CODEX_LIST" | jq -e --arg p "$plugin" '[.installed[]? | select(.installed == true and ((.pluginId // (.name + "@" + .marketplaceName)) == $p))] | length > 0' >/dev/null 2>&1; then
      ok "team plugin installed for Codex: $plugin"
    else
      bad "team plugin not installed for Codex: $plugin"
    fi
  done
fi

# Team secrets: decrypt with the joiner's own key, straight through sops, so
# "listed" (keys are plaintext in a sops file) never passes for "readable".
n=$(jq '.secrets | length' "$EXPECT")
if [ "$n" -gt 0 ]; then
  AGE_KEY=$("$RT" home key export 2>/dev/null | grep -o 'AGE-SECRET-KEY-1[A-Z0-9]*' | head -1)
  [ -n "$AGE_KEY" ] || bad "no age key exportable on the joiner"
  for i in $(seq 0 $((n-1))); do
    d=$(jq -r ".secrets[$i].domain" "$EXPECT"); k=$(jq -r ".secrets[$i].key" "$EXPECT"); want=$(jq -r ".secrets[$i].value" "$EXPECT")
    file="$TEAM/mattstack/secrets/$d.json"
    if [ ! -f "$file" ]; then bad "team secret file missing: mattstack/secrets/$d.json"; continue; fi
    got=$(cd "$TEAM" && SOPS_AGE_KEY="$AGE_KEY" sops -d --input-type json --output-type json "$file" 2>/tmp/sops.err | jq -r --arg k "$k" '.[$k] // empty')
    if [ "$got" = "$want" ]; then ok "team secret $d/$k decrypts on the joiner"; else bad "team secret $d/$k not readable on the joiner: $(head -c 200 /tmp/sops.err | tr '\n' ' ')"; fi
  done
fi

# Every deck-managed job must hold a pid: a spawn-failed job (exit 78) is
# a crash loop launchd never logs.
for label in $(launchctl print "gui/$(id -u)" 2>/dev/null | grep -oE 'com\.mattstack\.deck\.[a-z]+' | sort -u); do
  if launchctl print "gui/$(id -u)/$label" 2>/dev/null | grep -qE '^\s*pid = [0-9]+'; then ok "$label running"; else bad "$label not running ($(launchctl print "gui/$(id -u)/$label" 2>/dev/null | grep -oE 'last exit code = [^,]*' | head -1))"; fi
done

# Linear MCP: the entry the pack skills call by name, plus rt's own proof the key
# behind it works. The credential check is account.linear's row rather than a curl
# from here: rt makes the api.linear.app call itself.
if jq -e '.linearMcp == true' "$EXPECT" >/dev/null 2>&1; then
  if [ "$WANT_CLAUDE" = 1 ]; then
    CJ="$HOME/.claude.json"
    if [ -f "$CJ" ] && jq -e '.mcpServers.linear.url == "https://mcp.linear.app/mcp"' "$CJ" >/dev/null 2>&1; then
      ok "linear MCP entry present in ~/.claude.json"
    else
      bad "no linear MCP entry in ~/.claude.json"
    fi
  fi
  # Setup writes Linear only into Claude's configuration today (audit A21).
  if [ "$WANT_CODEX" = 1 ]; then
    grep -q '^\[mcp_servers\.linear\]' "$CODEX_HOME_DIR/config.toml" 2>/dev/null && ok "linear MCP entry present in $CODEX_HOME_DIR/config.toml" || bad "no linear MCP entry in $CODEX_HOME_DIR/config.toml"
  fi
  for id in tool.linear-mcp account.linear; do
    ROW=$(printf '%s' "$SETUP_JSON" | jq -c --arg id "$id" '.groups[]?.rows[]? | select(.id == $id)' 2>/dev/null | head -1)
    if [ -z "$ROW" ]; then bad "$id row absent"; continue; fi
    S=$(printf '%s' "$ROW" | jq -r '.status'); D=$(printf '%s' "$ROW" | jq -r '.detail // empty')
    if [ "$S" = "ready" ]; then ok "$id row ready"; else bad "$id row $S: $D"; fi
  done
fi

echo "TEAM fails=$fails"
[ "$fails" -eq 0 ]
