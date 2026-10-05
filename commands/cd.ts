#!/usr/bin/env bun

/**
 * rt cd - Context-aware worktree/repo directory picker.
 *
 * Prints the selected path to stdout so a shell function can cd into it.
 *
 * rt cd is for changing worktree or repo; moving around inside a repo is what
 * rt nav is for. So the default never drills below the worktree root.
 *
 * Behavior:
 *   - In a tracked repo with worktrees → worktree picker + "switch repo" option
 *   - In a tracked repo without worktrees → repo picker (all known repos)
 *   - Not in a tracked repo → repo picker (all known repos with worktrees)
 *   - --package → opt back into the monorepo package picker (one level deeper)
 *
 * Shell setup (add to your shell rc file):
 *   rtcd() { local dir; dir="$(rt cd "$@")" && [ -n "$dir" ] && cd "$dir"; }
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { getRepoIdentity, getKnownRepos, getKnownReposCached, findKnownRepo, repoCarriesWorktree, getWorkspacePackages, repoFromOptionValue, missingRepoFailure, type KnownRepo } from "../lib/repo.ts";
import { writeRepoCache } from "../lib/repo-cache.ts";
import { isTrashPath } from "../lib/worktree/trash.ts";
import {
  pickWorktreeWithSwitch,
  pickFromAllRepos,
  pickPackageWithEscape,
  resolveWorktreeByBranch,
  pickRepo,
  isSwitchRepo,
} from "../lib/pickers.ts";
import { detectShell, shellRcPath } from "../lib/shell-integration.ts";

// ─── Shell function setup ────────────────────────────────────────────────────

export const SHELL_FUNCTION = [
  `rt() {`,
  `  # Resolve rt by absolute path at ~/.local/bin/rt when it exists. This`,
  `  # bypasses zsh's command-hash cache, which otherwise pins rt to whichever`,
  `  # binary it first found and ignores a switch between the dev and prod apps`,
  `  # until the shell calls 'hash -r'.`,
  `  local rt_bin="$HOME/.local/bin/rt"`,
  `  # whence -p (zsh) / type -P (bash): PATH-only lookup, skips this function`,
  `  [ -x "$rt_bin" ] || rt_bin="$(whence -p rt 2>/dev/null || type -P rt 2>/dev/null)"`,
  `  [ -x "$rt_bin" ] || { echo "rt: binary not found in PATH" >&2; return 1; }`,
  ``,
  `  if [ "$1" = "cd" ]; then`,
  `    local dir`,
  `    dir="$(COLUMNS=$COLUMNS "$rt_bin" cd "\${@:2}")" && [ -n "$dir" ] && builtin cd "$dir"`,
  `  elif [ "$1" = "nav" ]; then`,
  `    local dir`,
  `    dir="$(COLUMNS=$COLUMNS "$rt_bin" nav "\${@:2}")" && [ -n "$dir" ] && builtin cd "$dir"`,
  `  elif [ "$1" = "x" ]; then`,
  `    "$rt_bin" "$@"`,
  `    local rt_cwd`,
  `    rt_cwd="$(cat "$HOME/.mattstack/rt/.last-cwd" 2>/dev/null)"`,
  `    if [ -n "$rt_cwd" ] && [ "$rt_cwd" != "$PWD" ]; then`,
  `      builtin cd "$rt_cwd"`,
  `    fi`,
  `  else`,
  `    "$rt_bin" "$@"`,
  `  fi`,
  `}`,
].join("\n");

function wrapperNotes(rcLabel: string, flags: { funcnest: boolean; preRehash: boolean; noNav: boolean; worktreeNav: boolean; hashCache: boolean; oldWrapper: boolean; legacyRtcd: boolean }): Block {
  const reason = flags.funcnest
    ? "it can loop forever in zsh"
    : flags.preRehash
      ? "it does not rehash after a dev mode switch"
      : flags.noNav
        ? "it cannot cd for rt nav"
        : flags.worktreeNav
          ? "it still jumps on rt worktree"
          : flags.hashCache
            ? "it finds the dev app's rt by name, not by path"
            : flags.oldWrapper
              ? "it does not follow rt x"
              : flags.legacyRtcd
                ? "it is the old rtcd function"
                : null;
  return reason ? out.line("warn", "Your rt shell function is out of date", reason) : out.line("needs-you", "rt cd needs a shell function to change your directory", rcLabel);
}

async function ensureShellFunction(): Promise<void> {
  const shell = detectShell();
  const home = process.env.HOME ?? homedir();
  const rcFile = shellRcPath(shell) ?? join(home, ".zshrc");
  let rcContent = "";
  try {
    rcContent = readFileSync(rcFile, "utf8");
  } catch { /* no rc file yet */ }

  // Latest version marker: whence -p / type -P PATH-only lookup (fixes FUNCNEST
  // recursion), and NO bare `rt worktree` cd-jump - that hijacked the subcommand
  // picker, so a wrapper still carrying it is stale and gets rewritten below.
  if (
    rcContent.includes('rt() {') &&
    rcContent.includes('whence -p rt') &&
    rcContent.includes('"$rt_bin" nav') &&
    !rcContent.includes('"$1" = "worktree"')
  ) return;

  const release = out.holdStdout();
  try {

  const { confirm } = await import("../lib/rt-render.ts");
  const hasLegacyRtcd = rcContent.includes("rtcd()");
  const hasOldRtWrapper = rcContent.includes("rt() {") && rcContent.includes("command rt cd") && !rcContent.includes(".last-cwd");
  const hasPreRehashWrapper = rcContent.includes("rt() {") && rcContent.includes(".last-cwd") && !rcContent.includes("hash -r");
  const hasNoNav = rcContent.includes("rt() {") && rcContent.includes("command rt cd") && !rcContent.includes("command rt nav") && !rcContent.includes('"$rt_bin" nav');
  // Function exists but uses `command rt` everywhere - vulnerable to the stale
  // zsh hash-table issue. Anything pre-absolute-path version qualifies.
  const hasHashCacheBug = rcContent.includes("rt() {") && rcContent.includes("command rt cd") && !rcContent.includes("local rt_bin");
  // Uses command -v which returns the function name in zsh, causing infinite recursion
  const hasFuncnestBug = rcContent.includes("rt() {") && rcContent.includes("command -v rt") && !rcContent.includes("whence -p rt");
  // Function still carries the bare `rt worktree` cd-jump - strip it so
  // `rt worktree` reaches its subcommand picker like every other group.
  const hasWorktreeNav = rcContent.includes("rt() {") && rcContent.includes('"$1" = "worktree"');
  const hasOldFunction = hasLegacyRtcd || hasOldRtWrapper || hasPreRehashWrapper || hasHashCacheBug || hasFuncnestBug || hasWorktreeNav;

  const hasOldFunction2 = hasOldFunction || hasNoNav;
  const rcLabel = rcFile.replace(home, "~");
  out.print(wrapperNotes(rcLabel, {
    funcnest: hasFuncnestBug, preRehash: hasPreRehashWrapper, noNav: hasNoNav,
    worktreeNav: hasWorktreeNav, hashCache: hasHashCacheBug,
    oldWrapper: hasOldRtWrapper, legacyRtcd: hasLegacyRtcd,
  }));
  const install = await confirm({
    message: hasOldFunction2
      ? `Upgrade rt shell wrapper in ${rcLabel}?`
      : `Add rt cd support to ${rcLabel}?`,
    initialValue: true,
    stderr: true,
  });

  if (!install) {
    out.print(out.copy(SHELL_FUNCTION, "add this to your shell config"));
    release();
    process.exit(0);
  }

  if (hasOldRtWrapper || hasPreRehashWrapper || hasNoNav || hasHashCacheBug || hasFuncnestBug || hasWorktreeNav) {
    rcContent = rcContent
      .replace(/\n?# rt (?:\u2014|-) shell wrapper \(enables rt cd to change directory\)\n?/g, "")
      .replace(/\n?rt\(\) \{[\s\S]*?\n\}\n?/g, "\n");
    writeFileSync(rcFile, rcContent);
  } else if (hasLegacyRtcd) {
    rcContent = rcContent
      .replace(/\n?# rt (?:\u2014|-) worktree\/repo directory picker\n?/g, "")
      .replace(/\n?rtcd\(\)[^\n]*\n?/g, "\n");
    writeFileSync(rcFile, rcContent);
  }

  const line = `\n# rt - shell wrapper (enables rt cd to change directory)\n${SHELL_FUNCTION}\n`;
  appendFileSync(rcFile, line);
  out.print(out.line("done", "Installed the rt shell function", rcLabel), out.callout("next", out.cmd(`source ${rcLabel}`)));
  } finally {
    release();
  }
}

// ─── Cache read path ─────────────────────────────────────────────────────────

/**
 * The cd cache can predate the repo you are standing in right now (never yet
 * written back since this repo was created or first registered), so a
 * resolved identity the cached list doesn't carry forces one live
 * `getKnownRepos` scan for this invocation - correctness over speed, and only
 * ever the one extra scan, since a repo that's genuinely absent from the live
 * list won't retrigger it on the next call either.
 */
export function resolveReposForIdentity(
  identity: { identity: string; repoRoot: string } | null,
  cachedRepos: KnownRepo[],
): KnownRepo[] {
  if (!identity) return cachedRepos;
  // The matched row must also CARRY the worktree being stood in: a cache
  // written before this worktree existed matches on identity alone, and serving
  // it hides the new tree from `--worktree <branch>` and from the picker.
  const hit = findKnownRepo(cachedRepos, identity);
  if (hit && repoCarriesWorktree(hit, identity.repoRoot)) return cachedRepos;
  return getKnownRepos({ includeMissing: true });
}

/**
 * The cd-cache rebuilds on a timer, so its rows can carry a worktree disposed
 * (trashed) since the last refresh; served verbatim, that row becomes a picker
 * entry whose selection dead-ends in ghostPathRefusal. Linked rows are
 * re-checked against disk before any picker sees them. The lead row stays even
 * when missing: that is the repo-level lost-path case, which must remain
 * pickable so it gets missingRepoFailure instead of vanishing.
 */
export function dropGhostWorktrees(
  repos: KnownRepo[],
  exists: (path: string) => boolean = existsSync,
): KnownRepo[] {
  let changed = false;
  const out = repos.map((r) => {
    const kept = r.worktrees.filter((w, i) => i === 0 || (exists(w.path) && !isTrashPath(w.path)));
    if (kept.length === r.worktrees.length) return r;
    changed = true;
    return { ...r, worktrees: kept };
  });
  return changed ? out : repos;
}

// ─── Entry ───────────────────────────────────────────────────────────────────

/**
 * ctrl-r's in-process reload: a live re-scan plus a cache refresh, handed to
 * the repo picker so it can push fresh rows via `handle.update` without
 * closing (this replaced the old fzf `ctrl-r:reload(rt cd --emit-rows)`
 * shell-exec bind).
 */
function reloadRepos(): KnownRepo[] {
  const repos = getKnownRepos({ includeMissing: true });
  writeRepoCache(repos);
  return repos;
}

export async function worktreePicker(args: string[]): Promise<void> {
  await ensureShellFunction();

  const release = out.holdStdout();
  try {
  // ── Parse flags ─────────────────────────────────────────────────────────────────────
  const forceRepo    = args.includes("--repo");
  const wtIdx        = args.indexOf("--worktree");
  const wtBranch     = wtIdx !== -1 ? args[wtIdx + 1] : undefined;

  // getRepoIdentity() registers the current repo in the index (via
  // updateRepoIndex) as a side effect, so it MUST run before the repo list is
  // read. Otherwise a repo you just entered (especially a local-only repo
  // seen for the first time) is absent from `repos`, currentRepo resolves to
  // null, and rt cd wrongly falls through to the global all-repos picker
  // instead of recognizing where you are.
  //
  // includeMissing: true so a lost repo still renders (dimmed, via repoOption)
  // in every picker built from `repos` - pickFromAllRepos's missing guard is
  // otherwise dead code, since a bare getKnownRepos() never hands it one.
  //
  // `repos` reads the cd cache (fast path). resolveReposForIdentity re-reads
  // live when the cache predates the repo the identity just resolved, so the
  // repo you are standing in is never invisible to its own cd invocation.
  const identity     = getRepoIdentity();
  const cachedRepos  = getKnownReposCached({ includeMissing: true });
  const repos        = dropGhostWorktrees(resolveReposForIdentity(identity, cachedRepos));
  const currentRepo  = identity
    ? findKnownRepo(repos, identity) ?? null
    : null;

  let selectedPath: string;

  // The dispatcher header is suppressed for `rt cd` (command-tree-def.ts
  // `fullscreen: true`) -- every picker below carries this instead, per
  // Cd.dc.html/Enrichment.dc.html.
  const CD_BREADCRUMB = ["rt", "cd"];

  /** After resolving a worktree, drill into its packages when it's a monorepo. */
  async function maybeDrillPackages(repo: KnownRepo, wtPath: string): Promise<string> {
    const packages = getWorkspacePackages(wtPath);
    if (packages.length > 0) {
      return pickPackageWithEscape(repo, wtPath, repos, { stderr: true, breadcrumb: CD_BREADCRUMB });
    }
    return wtPath;
  }

  // ── --repo flag: always go to repo picker ────────────────────────────────────
  if (forceRepo) {
    if (wtBranch) {
      // Pick repo first, then jump to the matching worktree (or show picker).
      // A missing row must be pickable here so it gets the clean
      // missingRepoFailure below instead of resolving via branch name against
      // a dead path.
      const pickedRepoName = repos.length === 1
        ? repos[0]!.repoName
        : await pickRepo(repos, { onReload: reloadRepos, breadcrumb: CD_BREADCRUMB });
      if (!pickedRepoName) process.exit(0); // Esc on repo picker
      const pickedRepo = repoFromOptionValue(repos, pickedRepoName)!;
      if (pickedRepo.missing) {
        out.fail(missingRepoFailure(pickedRepo));
        process.exit(1);
      }

      // Try to resolve the worktree in that repo; fall back to picker
      const lower = wtBranch.toLowerCase();
      const hit = pickedRepo.worktrees.filter((wt) => wt.branch.toLowerCase().startsWith(lower));
      if (hit.length === 1) {
        selectedPath = await maybeDrillPackages(pickedRepo, hit[0]!.path);
      } else {
        const wtPath = await resolveWorktreeByBranch(wtBranch, [pickedRepo], { stderr: true, breadcrumb: CD_BREADCRUMB });
        selectedPath = await maybeDrillPackages(pickedRepo, wtPath);
      }
    } else {
      selectedPath = await pickFromAllRepos(repos, { stderr: true, includePackages: true, onReload: reloadRepos, breadcrumb: CD_BREADCRUMB });
    }

  // ── --worktree flag only: resolve branch in current repo (then all repos) ──
  } else if (wtBranch) {
    const searchRepos = currentRepo ? [currentRepo] : repos;
    const lower = wtBranch.toLowerCase();
    const inCurrent = currentRepo?.worktrees.filter((wt) => wt.branch.toLowerCase().startsWith(lower)) ?? [];
    // If not found in current repo, broaden to all repos
    const finalRepos = inCurrent.length > 0 ? searchRepos : repos;
    const wtPath = await resolveWorktreeByBranch(wtBranch, finalRepos, { stderr: true, breadcrumb: CD_BREADCRUMB });
    const wtRepo = currentRepo ?? repos.find(r => r.worktrees.some(w => w.path === wtPath)) ?? null;
    selectedPath = wtRepo ? await maybeDrillPackages(wtRepo, wtPath) : wtPath;

  // ── In a multi-worktree repo: worktree picker ────────────────────────────
  } else if (currentRepo && currentRepo.worktrees.length > 1) {
    // pickWorktreeWithSwitch exits internally on cancel (its abort line rides
    // the shared lib/pickers.ts cancel path), so result is never falsy here.
    const result = await pickWorktreeWithSwitch(currentRepo, identity!.repoRoot, { stderr: true, breadcrumb: CD_BREADCRUMB });
    if (isSwitchRepo(result)) {
      selectedPath = await pickFromAllRepos(repos, { stderr: true, includePackages: true, onReload: reloadRepos, breadcrumb: CD_BREADCRUMB });
    } else {
      selectedPath = await maybeDrillPackages(currentRepo, result);
    }

  // ── In a monorepo (single worktree): package picker ─────────────────────
  } else if (currentRepo && getWorkspacePackages(identity!.repoRoot).length > 0) {
    selectedPath = await pickPackageWithEscape(currentRepo, identity!.repoRoot, repos, { stderr: true, breadcrumb: CD_BREADCRUMB });

  // ── Not in a tracked repo or single-worktree: repo picker ───────────────
  } else {
    selectedPath = await pickFromAllRepos(repos, { stderr: true, includePackages: true, onReload: reloadRepos, breadcrumb: CD_BREADCRUMB });
  }

  release();

  // Ghost guard: the cache (or a picker built from it) can hand back a path
  // that no longer exists on disk. Refuse rather than print a dead path...
  // the shell wrapper `cd`s into whatever stdout prints, no questions asked.
  if (!existsSync(selectedPath)) {
    out.fail({ title: "That folder is gone", hint: selectedPath, why: "rt's list of folders was out of date.", next: out.cmd("rt repos prune") });
    process.exit(1);
  }

  out.payload(selectedPath + "\n");
  } finally {
    release();
  }
}
