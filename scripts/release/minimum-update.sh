#!/bin/bash
# scripts/release/minimum-update.sh <tag>
# Prints the Sparkle minimum update version the release cut at <tag> must
# carry, as a bundle version (build.sh's numeric_build: 2.21.1 -> 2021001),
# or nothing when rt-tray/sparkle-minimum-update is absent.
#
# The declaration names the one release it is for:
#     release=2.22.0
#     minimum=2.21.1
# It applies to that release and to any earlier version (a dry run rehearses
# with a patch bump of the live feed's newest item), and refuses any later
# version, so a declaration left behind fails the next release instead of
# shipping again.
set -euo pipefail

if [ "$#" -ne 1 ]; then
    echo "usage: minimum-update.sh <tag>" >&2
    exit 2
fi
TAG="$1"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DECLARATION="$ROOT/rt-tray/sparkle-minimum-update"
[ -f "$DECLARATION" ] || exit 0

# Kept in step with numeric_build in rt-tray/build.sh: sparkle:version and the
# installed app's CFBundleVersion both come from it, and Sparkle compares the
# minimum against CFBundleVersion, so "2.21.1" would read as below every build.
numeric_build() {
    if [[ "$1" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
        echo $(( BASH_REMATCH[1] * 1000000 + BASH_REMATCH[2] * 1000 + BASH_REMATCH[3] ))
    else
        return 1
    fi
}

declared() {
    sed -n "s/^$1=//p" "$DECLARATION" | tr -d '[:space:]'
}

RELEASE="$(declared release)"
MINIMUM="$(declared minimum)"
RELEASE_BUILD="$(numeric_build "$RELEASE")" || {
    echo "✗ rt-tray/sparkle-minimum-update needs release=X.Y.Z (got '$RELEASE')" >&2; exit 1; }
MINIMUM_BUILD="$(numeric_build "$MINIMUM")" || {
    echo "✗ rt-tray/sparkle-minimum-update needs minimum=X.Y.Z (got '$MINIMUM')" >&2; exit 1; }

VERSION="${TAG#v}"
VERSION="${VERSION%%-*}"
VERSION_BUILD="$(numeric_build "$VERSION")" || {
    echo "✗ tag '$TAG' is not vX.Y.Z or a vX.Y.Z-ciN rehearsal" >&2; exit 1; }

if [ "$VERSION_BUILD" -gt "$RELEASE_BUILD" ]; then
    echo "✗ rt-tray/sparkle-minimum-update declares a minimum for $RELEASE, but this release is $VERSION. Delete the file, or point it at this release, and commit." >&2
    exit 1
fi
if [ "$MINIMUM_BUILD" -ge "$VERSION_BUILD" ]; then
    echo "✗ rt-tray/sparkle-minimum-update requires $MINIMUM, which is not below this release ($VERSION)" >&2
    exit 1
fi

echo "$MINIMUM_BUILD"
