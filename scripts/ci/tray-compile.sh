#!/bin/bash
# Compiles the tray app (rt-tray/project.yml, scheme mattstack) unsigned, with
# none of build.sh's bundling, so a change that stops it compiling fails CI.
# Usage: scripts/ci/tray-compile.sh
# Env: TRAY_CONFIGS (default "Release Debug"), TRAY_DERIVED, TRAY_PACKAGES
#
# Both configurations, because a large share of Sources sits behind #if DEBUG
# and Release is what ships. The mattstack-dev scheme compiles the same
# sources with different build settings only, so one scheme covers them.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TRAY="$REPO_DIR/rt-tray"
SCRATCH="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
DERIVED="${TRAY_DERIVED:-$SCRATCH/tray-compile/derived}"
PACKAGES="${TRAY_PACKAGES:-$SCRATCH/tray-compile/packages}"
CONFIGS="${TRAY_CONFIGS:-Release Debug}"
ARCH="$(uname -m)"
LOG_DIR="$SCRATCH/tray-compile/logs"
mkdir -p "$DERIVED" "$PACKAGES" "$LOG_DIR"

xcodebuild -version >/dev/null 2>&1 || { echo "tray-compile: xcodebuild needs a full Xcode (xcode-select -p is $(xcode-select -p 2>/dev/null))" >&2; exit 1; }

if ! command -v xcodegen >/dev/null; then
  if command -v brew >/dev/null && [ -w "$(brew --prefix)/bin" ]; then
    echo "tray-compile: installing xcodegen"
    HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install --quiet xcodegen >/dev/null
  else
    echo "tray-compile: xcodegen is not on PATH and brew cannot install it here; run brew install xcodegen as the Homebrew owner" >&2
    exit 1
  fi
fi

# xcodegen writes the Generated/*-Info.plist files project.yml points at; the
# LaunchAgent plists come from the target's own pre-build script.
xcodegen generate --quiet --spec "$TRAY/project.yml" --project "$TRAY"

COMMON=(-project "$TRAY/mattstack.xcodeproj" -scheme mattstack
  -derivedDataPath "$DERIVED" -clonedSourcePackagesDirPath "$PACKAGES"
  -skipPackagePluginValidation -skipMacroValidation)

# SwiftPM's fetch of Sparkle's binary zip has hung on GitHub-hosted runners
# (release.yml); bound each attempt and retry. macOS has no GNU timeout.
resolved=false
for i in 1 2 3; do
  if GIT_TERMINAL_PROMPT=0 /usr/bin/perl -e 'alarm 240; exec @ARGV' \
      xcodebuild -resolvePackageDependencies "${COMMON[@]}" >"$LOG_DIR/resolve.log" 2>&1; then
    resolved=true; break
  fi
  echo "tray-compile: package resolve attempt $i failed or timed out"
  tail -5 "$LOG_DIR/resolve.log"
  rm -rf "$PACKAGES"; mkdir -p "$PACKAGES"
done
[ "$resolved" = true ] || { echo "tray-compile: package resolve failed after 3 attempts" >&2; exit 1; }

# Native arch only (project.yml pins arm64): compile-only, so the Intel runner
# need not cross-compile.
status=0
for config in $CONFIGS; do
  log="$LOG_DIR/build-$config.log"
  start=$(date +%s)
  if xcodebuild build "${COMMON[@]}" -configuration "$config" -disableAutomaticPackageResolution \
      -destination "platform=macOS,arch=$ARCH" ARCHS="$ARCH" ONLY_ACTIVE_ARCH=YES \
      CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
      COMPILER_INDEX_STORE_ENABLE=NO -quiet >"$log" 2>&1; then
    echo "tray-compile: $config ($ARCH) compiled in $(( $(date +%s) - start ))s"
    continue
  fi
  status=1
  echo "tray-compile: $config ($ARCH) FAILED after $(( $(date +%s) - start ))s"
  errors=$(grep -E ': (fatal )?error: ' "$log" | sort -u || true)
  if [ -n "$errors" ]; then
    echo "$errors"
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
      # path:line:col: error: message -> a workflow annotation on the file.
      echo "$errors" | sed -nE "s#^$REPO_DIR/([^:]+):([0-9]+):([0-9]+): (fatal )?error: (.*)#::error file=\1,line=\2,col=\3::\5#p"
    fi
  else
    tail -40 "$log"
  fi
done
exit "$status"
