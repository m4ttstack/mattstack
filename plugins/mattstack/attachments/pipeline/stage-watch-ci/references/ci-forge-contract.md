# The ci-forge@1 contract

## Purpose

`stage-watch-ci` is a generic CI watch/triage engine. It must work against
any forge (GitLab, GitHub, others) without engine edits. The seam that makes
that possible is `ci-forge@1`: one forge behind one entry point, so the
engine and one `allowed-tools` rule serve every provider. An adapter that
implements this contract is a drop-in forge for the engine; the engine never
knows or cares which forge it is talking to.

This document is the normative contract. If you are implementing an
adapter -- GitLab, GitHub, or anything else -- everything you need to build
a conforming adapter is here. If you are only skimming for the shape of one
verb, read section "Verb table" below; do not guess.

## Entry point

Every adapter ships exactly one executable, at exactly this path relative to
the adapter skill's own directory:

```
scripts/ci-forge.sh <verb> [args]
```

The filename and location are fixed, not a convention you may vary. The
engine's `allowed-tools` frontmatter authorizes `Bash(*/scripts/ci-forge.sh:*)`
once, for every adapter, forever -- that single rule only works because the
filename never changes. An adapter that ships under any other name (an
"adapter" binary, a `<forge>-ci-adapter` script, a PATH-registered
`<engine>-<forge>` command, or anything else) is not invokable by the engine
and is not a conforming adapter, no matter how correct its behavior is
otherwise.

Requirements on the entry point itself:

- Executable (`chmod +x`). Implementation language is the adapter's choice
  (first-party adapters use bash with `set -euo pipefail`); this contract
  governs the CLI surface, not the implementation dialect.
- Its only runtime dependencies should be `jq` and the forge's own CLI
  (e.g. `glab`, `gh`).
- stdout carries data only, in the shapes specified below. Nothing else may
  ever be printed to stdout, including on error.
- All diagnostics, warnings, and human-readable error text go to stderr.

This is a CLI contract, not an API contract: there is no capabilities verb,
no handshake, no version negotiation beyond the `@1` in this document's name
(a breaking change ships as `ci-forge@2` with its own contract).

## Verb table

All seven verbs below MUST be implemented by every conforming adapter.
"May print nothing" is legal exactly where the notes column says so; it is
never a substitute for implementing the verb.

Output is TSV (tab-separated values), never JSON, never NDJSON. This is
deliberate: the engine is POSIX shell reading with `cut`/`while read`, not a
JSON-consuming runtime.

| verb | args | stdout | notes |
|---|---|---|---|
| `pipelines-for-ref` | `<ref> [--limit N] [--all-sources]` | TSV rows `pipeline_id  status  web_url`, newest first | by default, pipelines whose source carries no CI evidence are filtered out (GitLab: `external` AND `schedule`); `--all-sources` disables the filter; N default 1 |
| `pipeline-info` | `<pipeline_id>` | one TSV row `pipeline_id  status  web_url` | status normalized to the vocabulary below |
| `jobs` | `<pipeline_id> [--scope <s>] [--name <substr>]` | TSV rows `pipeline_id  job_id  name  status  blocking\|allow_failure`; zero rows is a legal success | covers the WHOLE pipeline tree (GitLab: recursive bridge walk); `--scope failed` is the engine's main use |
| `trace` | `<job_id> <out_file>` | nothing | writes raw log to out_file |
| `retry-job` | `<job_id>` | optional confirmation line | performs the forge's retry |
| `target-branch` | `<ref>` | base branch name, or nothing | the open MR/PR base for the ref; empty output + exit 0 when none |
| `infra-patterns` | (none) | zero or more `grep -E` patterns, one per line | forge-specific infra noise (e.g. the forge's registry/runner error shapes) so the engine's defaults stay forge-free |

Column shapes are exact. `pipelines-for-ref` and `pipeline-info` share the
same three-column row shape (`pipeline_id  status  web_url`); `jobs` has
five columns, the fifth being either the literal `blocking` or the literal
`allow_failure` depending on the job's own `allow_failure` setting.

## Status vocabulary

Every status an adapter emits (in `pipeline-info` and in the fourth column of
`jobs`) MUST be normalized to exactly one of:

```
running  pending  success  failed  canceled  skipped
```

Terminal set (a pipeline that has reached one of these will not change
again): `success failed canceled skipped`.

Forge-native states outside this vocabulary must be mapped onto it by the
adapter, never passed through raw. (For example, GitLab's
`created|waiting_for_resource|preparing|scheduled|manual` all map to
`pending`.) The engine's watch loop polls until status is in the terminal
set; an unmapped or invented status value will hang the loop or misclassify
a result.

## Exit-code contract

Every verb, no exceptions, uses this exit-code scheme:

| exit code | meaning |
|---|---|
| `0` | the queried object exists and the answer is on stdout, INCLUDING a legitimately empty answer |
| `1` | the queried object does not exist |
| `2` | usage error |
| `3` | forge CLI missing or unauthenticated |

Read that table twice. In particular:

- `0` covers a pipeline with no matching jobs, a ref with no MR, an adapter
  with no infra patterns -- an empty answer to a well-formed question is
  success, not failure.
- `1` covers an unknown pipeline id, an unknown job id, a ref with no
  pipelines at all -- the object itself does not exist.
- `2` is a malformed invocation (missing required arg, unknown flag).
- `3` is "the forge CLI cannot be reached or is not authenticated" --
  network failure, `glab`/`gh` not installed, expired auth. This is
  distinct from both `0` and `1`: an unauthenticated forge must never be
  silently read as "no pipeline found."

**The 0-vs-1 split is load-bearing.** "This pipeline exists and nothing on
it failed" and "there is no such pipeline" must never share an exit code.
If they did, a stale or mistyped pipeline id would read as a clean,
passing pipeline -- exactly the failure mode this contract exists to
prevent. Do not collapse these two cases into one exit code under any
circumstances, and do not reuse `2` or `3` for a not-found case either;
those codes are reserved for usage errors and CLI-availability failures
respectively, not for "nothing there."

**Boundary case for `pipelines-for-ref`:** exit `1` only when the ref has no
pipelines AT ALL. When pipelines exist for the ref but every one of them is
removed by the default evidence-free-source filter (see below), that is
exit `0` with empty output, not exit `1`. The engine's `--all-sources` retry
treats both cases the same way procedurally (it retries either way), but the
distinction still matters: fixture data and adapter tests need one
canonical answer for "ref has zero pipelines" versus "ref has pipelines, all
filtered."

## Evidence-free source filtering

Some pipeline sources are not evidence of anything about the current code:
a `schedule`-triggered pipeline running the nightly build, or (on GitLab) an
`external` pipeline mirrored from elsewhere. By default, `pipelines-for-ref`
filters these out of its result set, because a caller asking "what CI ran
for this ref" almost always means "what CI ran because of a push to this
ref."

`--all-sources` disables that filter and returns everything, including
evidence-free sources. This is the escape hatch for the one legitimate case
where evidence-free pipelines are the only signal available (e.g. a
mirror-only branch that never triggers a push-based pipeline). The engine
uses it as a fallback retry when the default-filtered listing comes back
empty, never as its first choice.

## Generic-vs-config rule

This section governs what belongs in the engine's built-in failure-pattern
defaults versus what belongs in domain config or in an adapter's
`infra-patterns` output. The criterion, stated exactly:

> Engine defaults may contain only failure patterns from tooling with broad
> cross-team adoption in the ecosystems the engine watches (test runners,
> type checkers, linters, package-manager lifecycles) where the string
> distinctively signals failure. Patterns tied to a single library, a
> team's bot, or a team's job names are domain config. Patterns tied to a
> forge's own infrastructure arrive via `infra-patterns`.

Apply this test before adding any pattern anywhere:

- Would this string appear, unmodified, in failure output from any team
  using this tooling, regardless of what they are building? If yes and the
  tooling has broad ecosystem adoption, it may be an engine default.
- Does this string only make sense given one team's specific stack, one
  library's specific error message, or one bot's specific phrasing? Then it
  is domain config, supplied through the engine's config file, never a
  built-in default.
- Is this string specific to the forge's own infrastructure (registry
  errors, runner failures, the forge's own transient-error shapes) rather
  than to the code under test? Then it belongs in that forge adapter's
  `infra-patterns` verb output, not in the engine and not in domain config.

An adapter author who is tempted to hardcode a failure-classification string
into the adapter itself, outside `infra-patterns`, has misread this
contract: adapters supply forge infrastructure noise through
`infra-patterns` and nothing else. Everything about the code under test is
the engine's or the domain config's job to classify, never the adapter's.

## Implementing GitHub

GitHub is the explicit second-forge target for this contract; a GitHub
adapter must require zero engine edits. This section documents the mapping;
no GitHub adapter ships as part of this document.

- **Pipelines.** GitHub Actions workflow runs map onto "pipelines."
  `pipelines-for-ref <ref>` is implemented via `gh run list` scoped to the
  branch.
- **Jobs.** `jobs <pipeline_id>` is implemented via
  `gh run view --json jobs`. GitHub Actions runs are one level deep (no
  bridge/downstream-pipeline recursion the way GitLab needs), but
  reusable-workflow callers must be flattened into the same job list so the
  "covers the WHOLE pipeline tree" requirement still holds.
- **Trace.** `trace <job_id> <out_file>` is implemented via
  `gh run view --log --job`.
- **Retry.** `retry-job <job_id>` is implemented via `gh run rerun --job`.
- **Target branch.** `target-branch <ref>` is implemented via
  `gh pr view --json baseRefName`.
- **Blocking column.** A job is blocking unless its check run is `neutral`
  or otherwise marked non-required; that maps to the `jobs` verb's fifth
  column (`blocking` vs `allow_failure`).
- **Evidence-free sources.** `schedule`-triggered workflow runs are
  GitHub's evidence-free source, the equivalent of GitLab's
  `schedule`/`external` filtering; they are excluded from the default
  `pipelines-for-ref` listing and included only under `--all-sources`.

A GitHub adapter that satisfies every row of the verb table above, using
this mapping, is a conforming `ci-forge@1` adapter and needs no changes to
the engine.

## Conformance checklist

An adapter is conforming only if all of the following hold. This list is
the basis for that adapter's test suite.

1. Entry point is exactly `scripts/ci-forge.sh`, executable, at the
   adapter's own directory root.
2. All seven verbs are implemented: `pipelines-for-ref`, `pipeline-info`,
   `jobs`, `trace`, `retry-job`, `target-branch`, `infra-patterns`.
3. `jobs` covers the whole pipeline tree, not just the top level (recursion
   across nested/downstream pipelines where the forge has them, e.g.
   GitLab bridges, including nested children).
4. `jobs` honors `--scope` and `--name` filters correctly.
5. All TSV row shapes match the verb table exactly, including the fifth
   `jobs` column being the literal string `blocking` or `allow_failure`.
6. Status values emitted by `pipeline-info` and `jobs` are normalized to
   the status vocabulary; no forge-native status string leaks through
   unmapped.
7. `pipelines-for-ref` filters evidence-free sources by default and
   returns them under `--all-sources`.
8. `trace` writes the raw log to the given out_file and prints nothing to
   stdout.
9. `target-branch` covers all three cases: an MR/PR-linked ref resolves to
   its base branch; a ref discoverable only via a source-branch lookup
   still resolves; a ref with no open MR/PR prints nothing and exits 0.
10. `infra-patterns` prints zero or more `grep -E` patterns, one per line,
    and contains only forge-infrastructure noise (never patterns about the
    code under test).
11. Not-found paths (unknown pipeline id, unknown job id, ref with zero
    pipelines) exit 1, never 0, never 2 or 3.
12. A pipeline that exists but has zero matching jobs (or zero infra
    patterns, or no target branch) exits 0 with empty/short output, never
    1.
13. The `pipelines-for-ref` boundary case is correct: zero pipelines for
    the ref at all exits 1; pipelines exist but all are filtered by the
    default source filter exits 0 with empty output.
14. Usage errors (missing required argument, unknown flag) exit 2.
15. Forge CLI missing or unauthenticated exits 3, distinguishable from
    both the 0 and 1 cases above -- an unauthenticated adapter must never
    look like "no pipeline found."
16. stdout carries only the documented data shape; stderr carries
    diagnostics; nothing extra is printed to stdout on any path, including
    error paths.
