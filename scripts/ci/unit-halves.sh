#!/bin/bash
# Runs one shard's two halves at once and prints each half's log whole.
# bun runs test files one after another in a single process, so each runner
# takes two: the preload gives every process its own HOME, socket dir and tmp
# by pid.
# Usage: unit-halves.sh <shard> <total shards> <bun test arguments...>
set -uo pipefail
shard=$1
total=$2
shift 2
halves=$((total * 2))
a=$((shard * 2 - 1))
b=$((shard * 2))
logs=$(mktemp -d)

# Two processes share a runner's cores, and a git-heavy worktree test that
# takes two seconds alone has hit bun's 5s default beside its neighbour; the
# limit is for a hang, not a slow runner.
bun test "$@" --shard="$a/$halves" --timeout 20000 > "$logs/a.log" 2>&1 &
pid_a=$!
bun test "$@" --shard="$b/$halves" --timeout 20000 > "$logs/b.log" 2>&1 &
pid_b=$!

status=0
wait "$pid_a" || status=1
wait "$pid_b" || status=1
echo "::group::half $a of $halves"; cat "$logs/a.log"; echo "::endgroup::"
echo "::group::half $b of $halves"; cat "$logs/b.log"; echo "::endgroup::"
[ "$status" = 0 ] || { echo "a half of shard $shard failed; its log is above"; exit 1; }
