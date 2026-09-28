# mr_upload accepts a run's own evidence folder

## Problem

The work pipeline's evidence stage saves captures for an unbound run under
`~/.mattstack/work/<run id>/evidence/`. The `mr_upload` guard
(`lib/daemon/upload-guard.ts`) accepts only files under the target repo's
worktrees, the Claude Code temp root (`/private/tmp/claude-<uid>/` and its
`/tmp` alias) and `rt.mcp.uploadRoots`. The evidence folder is none of those,
so every evidence upload on an unbound run is refused and stops at the
engines' upload off-script gate.

## Decision for the shepherd: where the new root lives

Two ways to accept the folder. The bytes-match-extension check, the size cap,
the regular-file check and the `O_NOFOLLOW` verified read stay in both.

**(a) A registry default for `rt.mcp.uploadRoots`.** Rejected, for four
reasons:

1. A registry default is a static literal and `rt.mcp.uploadRoots` takes only
   absolute paths (the handler drops anything else with a warning). HOME
   differs per machine, so no literal names `~/.mattstack/work`. Making it
   work means teaching the handler `~`/`${home}` expansion, which widens the
   setting's own contract.
2. The key merges with `replace`. The first machine entry a user adds (their
   Screenshots folder) silently drops the default, and evidence uploads start
   failing again with nothing pointing at why.
3. A root is plain directory containment. It can only name all of
   `~/.mattstack/work`, which also holds `scratch/` (handoff notes), team
   folders (`claimview/`) and old ticket folders. It cannot say "only the
   `evidence/` folder" or "only for a run that exists".
4. It hides a built-in behavior in user-editable config: removing the entry
   looks like tidying and breaks the pipeline.

**(b) A narrow built-in root in the guard. Recommended.** The guard accepts a
file whose realpath sits under `<work root>/<id>/evidence/`, where `<id>` is
a single path component naming a run that exists on this machine. This is
the same kind of built-in the temp root already is. It does not loosen any
existing check: it adds one more root, computed from the file's own realpath,
and only for folders the pipeline itself owns. AGENTS.md's "widen through the
setting" rule still governs every other folder a human wants to allow.

## Design (option b)

All of it lives in `lib/daemon/upload-guard.ts`; the handler does not change.

- `workRoot()`: `join(process.env.HOME ?? homedir(), ".mattstack", "work")`,
  resolved at call time like the settings paths, so an isolated HOME is
  honored.
- `runEvidenceRoot(real, { workRoot, runsRoot })`, exported and pure apart
  from `realpath`/`stat`: given the file's realpath,
  1. realpath the work root; if that fails, no root;
  2. `relative(workRootReal, real)` must split into `<id>/evidence/<rest>`
     with `<rest>` non-empty and `<id>` passing `isPathComponent`
     (`lib/runs/paths.ts`);
  3. some `<runsRoot>/<repo>/<id>/state.db` must be a regular file (any repo
     dir; the run's repo segment and the upload's repo identity are different
     string forms, so the run is not tied to the upload target);
  4. returns `<workRootReal>/<id>/evidence`, else `null`.
- `checkUploadPath(path, roots, opts)` gains `opts.workRoot` and
  `opts.runsRoot` (defaults `workRoot()` and `runsRoot()`) and accepts the
  file when `contained(real, roots)` or `runEvidenceRoot` returns a root. The
  refusal message names the new root: `path is outside the allowed upload
  roots (a worktree of the target repo, the Claude Code temp root, a run's
  evidence folder, or an rt.mcp.uploadRoots entry)`.

### Escapes stay closed

The derivation runs on the realpath, never the caller's string, so:

- `..` in the given path resolves before the check;
  `<work>/<id>/evidence/../secret.png` is `<work>/<id>/secret.png`, which is
  not under `evidence/`.
- A symlink out (a file link, an `evidence` dir link, or a `<id>` dir link to
  anywhere outside the work root) resolves to a realpath outside the work
  root and derives no run.
- A sibling folder (`<work>/<id>/other/`, `<work>/scratch/`, `<work>/<id>/`
  itself) is refused.
- An `<id>` with no run under the runs root is refused.
- A symlinked work root itself (`~/.mattstack` on another volume) still works,
  because the comparison uses the work root's realpath.

## Testing

Test-first in `lib/daemon/__tests__/upload-guard.test.ts`, with temp work and
runs roots passed through `opts` (never the real `~/.mattstack`):

- accepted: a png in `<work>/<id>/evidence/`, and one in a subfolder of it,
  when `<runs>/<repo>/<id>/state.db` exists;
- refused, each with the outside-roots message: no such run; a sibling
  folder; the run folder itself; `..` out of `evidence/`; a file symlink out;
  an `evidence` dir symlink out; a bad `<id>` (`.`);
- still refused on bytes: a text file named `.png` inside a valid evidence
  folder;
- every existing refusal test passes unchanged except the message string.

Then an isolated-HOME check (a scratch HOME with a fake run) of the same
accepted and refused cases through `checkUploadPath` with default opts.
`bun run test`, `bunx tsc --noEmit`, `bash scripts/repo-purity.sh`. The
mcp-serve e2e lists `mr_upload` by name only, so it does not cover this.

## Docs

- AGENTS.md "Gates and the rt_verb MCP tool": add "a run's own evidence
  folder" to the upload-root list.
- `lib/mcp/tools.ts`: add the root to `mr_upload`'s description, with the
  `tools.test.ts` assertion.

## Second decision: the write fence

Two follow-ons sit outside my fence and would strand the fix if left out:

1. Changing `mr_upload`'s description changes `bun cli.ts mcp tools --json`,
   and CI's `plugin-mattstack` job fails unless
   `plugins/mattstack/attachments/mcp-tools/reference.md` is regenerated,
   which in turn needs a `.claude-plugin/plugin.json` version bump.
2. `stage-evidence/SKILL.md` says `~/.mattstack/work/<work-id>/evidence/`.
   `<work-id>` is defined nowhere; the guard keys on the run id `run_start`
   returned. An agent that reads `<work-id>` as the ticket id still gets
   refused. The line should say `<run id>` (the `runId` from `run_start`),
   and the compiled copies regenerated if the compile check asks.

Recommended: widen the fence to those plugin files. The alternative is to
leave the tool description alone (it then under-lists the roots) and ticket
the skill wording.
