# gitlab_get GitHub guard narrowing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `gitlab_get` on GitHub reads any file under `:repo/contents/` and any repo named after a guarded word, while every credential route stays refused, now also against padded, folded and empty-segment spellings.

**Architecture:** All guard logic stays in `checkGithubForgePath` and the shared `plainApiPath` in `lib/daemon/forge-reads.ts`. Two small pure helpers (`wordSkeleton`, `foldsToSeparator`) carry the Unicode rules. A positional file-path test and a matching window replace today's whole-path `entryAt` scan. Tests drive a real `GitHubProvider` over a stubbed `globalThis.fetch`.

**Tech Stack:** Bun, TypeScript, `bun:test`, `@mattstack/glance` (`GitHubProvider`).

**Spec:** `docs/superpowers/specs/2026-11-13-gitlab-get-github-guard-narrowing-design.md` (revision 1, reviewer Approved in round 6). Implementers read the spec's "The rule", "Order of checks", "Refusal text" and "Test plan" sections before their task.

## Global Constraints

- **Base.** Build on main after PR #1130 (`copilot-refusal`) has merged. #1130 adds `GITHUB_REFUSED_ROUTES = ["copilot"]`, an owner/repo `projectPath` check, and a refusal of an interior empty segment (`'"path" must not contain an empty segment (//)'`). Keep all three. Where #1130 is stricter than the spec (it refuses `//` outright, so `:repo//pulls` and `:repo/actions//oidc/...` are refused at that check, not read or dropped), #1130 wins: guard lists are widened, never narrowed, without review.
- #1130's projectPath check runs first in `checkGithubForgePath`, before `plainApiPath`, not at the spec's step 3. Keep it there; the spec's order is otherwise followed.
- Leading and trailing empty segments keep #1130's behavior (a trailing `/` is allowed). Blank segments that are not empty (`%20`, `%E2%80%8B`, `%CC%81`) are dropped from the matching window.
- No live forge call, and no `gitlab_get` call against a real repo. Never read, print or stage `packages/glance/harness_credentials.json`.
- Run `bun test` only from the worktree root. Run only the targeted files below; CI runs the full suite.
- Any `bun cli.ts ...` run uses an isolated HOME: `env -i HOME="$(mktemp -d)" PATH="$PATH" bun cli.ts ...`.
- No em or en dashes in code comments, strings, docs or commit messages. Comments only state a constraint the code cannot show.
- GitLab's word list and refusal texts do not change. GitLab picks up only the C1 control widening (Task 1).
- Exact refusal texts (spec, "Refusal text"):
  - `WORD_REFUSAL(word)`: `gitlab_get refuses "path" because the path after the repo reads as "${word}", ignoring case, spaces and invisible characters. On GitHub that word names an endpoint that can return credentials, so it is refused in any segment after the repo, including branch and tag names. To read a file, use :repo/contents/<file path>, where file names are not checked.` This text is used for every `GITHUB_REFUSED_SEGMENTS` entry; `git/blobs` keeps its own text.
  - `ROUTE_REFUSAL(word)`, for `GITHUB_REFUSED_ROUTES`: `gitlab_get refuses "path" because the route right after the repo reads as "${word}", ignoring case, spaces and invisible characters. That GitHub endpoint can return credentials. A branch, file or repo named ${word} is fine.`
  - Rule 2: `"path" must name the repo as repos/<owner>/<name>, spelled plainly with no percent escapes. Start it with :repo/ instead.`
  - Rule 1: `gitlab_get cannot read this GitHub repo, because its path is not owner/name. Check the repo's origin remote.` This replaces #1130's text for the same check.
  - Dot parts and dot lookalikes: the existing `"path" must not contain dot segments`.
  - NFKD separators: the existing `"path" must be a plain API path; pass query values in "query"`.
  - `git/blobs`: unchanged.
- The plugin version bump in `plugins/mattstack/.claude-plugin/plugin.json` goes one past main's at merge time (Task 5).

## Review Focus

1. A file read whose name holds a guarded word in an odd position (`contents/a/b/secrets.tf.json`, `contents/hooks`), expected to be read. Pinned in Task 4's accepted loop.
2. A repo named after a guarded word hiding the same word as a real route (`acme/hooks.io` with `:repo/hooks/1/config`), expected to be refused. Pinned in Task 4's credential table.
3. An ordinary spaced or accented name outside a file path (`labels/good%20first%20issue`, `labels/caf%C3%A9`), expected to be read. Pinned in Task 3.
4. A file name with a plain `#` or `?` sent encoded (`contents/docs/C%23.md`), expected to be read as today. Pinned in Task 2's caller test in Task 3.
5. The `:repo/contents` root listing and `:repo/contents/` (trailing slash), expected to be read. Pinned in Task 4.

---

### Task 0: Rebase onto #1130 (the orchestrator does this, not a subagent)

- [ ] Wait for the shepherd's word that PR #1130 is on main. Do not touch guard code before it.
- [ ] `git fetch origin main && git merge origin/main` in this worktree. Resolve nothing by hand in `lib/daemon/forge-reads.ts`; the branch has no code changes yet.
- [ ] Re-read `checkGithubForgePath` on the merged tree. If #1130's names or texts differ from this plan's Global Constraints, edit this plan to match before dispatching Task 1, and commit the plan.
- [ ] Run `bun test lib/daemon/__tests__/forge-get-github.test.ts lib/daemon/__tests__/forge-reads.test.ts` and record the pass count as the baseline.

### Task 1: C1 controls refused on both forges

**Files:**
- Modify: `lib/daemon/forge-reads.ts` (`CONTROL`, about line 130)
- Test: `lib/daemon/__tests__/forge-reads.test.ts`, `lib/daemon/__tests__/forge-get-github.test.ts`

**Interfaces:**
- Produces: `CONTROL = /\p{Cc}/u`, used by `plainApiPath` on the raw and decoded text as today.

- [ ] **Step 1: Write the failing tests.** In `forge-reads.test.ts`, `test("refuses a C1 control character, raw or decoded")`: `checkForgePath` on `projects/:id/issues%C2%85`, `projects/:id/issues%C2%9F` and `projects/:id/issues\u0085` each equals `{ ok: false, error: '"path" must be a plain API path; pass query values in "query"' }`. In `forge-get-github.test.ts`, the same assertion for `checkGithubForgePath` on `:repo/hooks%C2%85`, `:repo/actions/secrets%C2%85`, `:repo/contents/a%C2%85b` and `:repo/pulls%C2%9F`.
- [ ] **Step 2: Run** `bun test lib/daemon/__tests__/forge-reads.test.ts lib/daemon/__tests__/forge-get-github.test.ts`. Expected: the new tests FAIL (the C1 paths pass or hit another refusal).
- [ ] **Step 3: Change `CONTROL` to `/\p{Cc}/u`.**
- [ ] **Step 4: Run the same command.** Expected: PASS, with the baseline count plus the new tests.
- [ ] **Step 5: Commit** `forge-reads: refuse C1 control characters in gitlab_get paths`.

### Task 2: The word skeleton and the NFKD separator test

**Files:**
- Modify: `lib/daemon/forge-reads.ts` (new exports beside `namesWord`)
- Test: `lib/daemon/__tests__/forge-get-github.test.ts` (new `describe("wordSkeleton and foldsToSeparator")`)

**Interfaces:**
- Produces:
  - `export function wordSkeleton(segment: string): string`: NFKD, then delete every match of `/[\p{White_Space}\p{Cf}\p{M}\p{Default_Ignorable_Code_Point}]/gu`, then `.toUpperCase().toLowerCase()`.
  - `export function dotSkeleton(segment: string): string`: steps 1 and 2 only (no case fold), for the dot checks.
  - `export function foldsToSeparator(decoded: string): boolean`: true when any code point `ch` of `decoded` has `ch.normalize("NFKD") !== ch` and the NFKD form matches `/[;%?#\\]/`. The test is per code point (`[...decoded]`), never on the NFKD form of the whole string.

- [ ] **Step 1: Write the failing tests.**
  - `wordSkeleton`: `"secrets "`, `"sec​rets"`, `"ｓｅｃｒｅｔｓ"`, `"secretś"`, `"s͏ecrets"`, `"ſecrets"`, `"SECRETS"`, `"secretsㅤ"` all return `"secrets"`. `"Keys"` returns `"keys"`. `"good first issue"` returns `"goodfirstissue"`. `"secrets .json"` returns `"secrets.json"`. `"actions／oidc"` returns `"actions/oidc"`. `"actions＼oidc"` returns `"actions\\oidc"`. `"​"` and `" "` return `""`. `"ѕecrets"` (Cyrillic) does not return `"secrets"`.
  - `dotSkeleton`: `".. "`, `"．．"`, `"..﻿"`, `"..​"` return `".."`; `"‥／hooks"` returns `"../hooks"`.
  - `foldsToSeparator`: true for `"x；"`, `";"`, `"a％b"`, `"a？b"`, `"a＃b"`, `"..＼hooks"`, `"﹨"`. False for `"docs/C#.md"`, `"what?.md"`, `"a;b"`, `"café"`, `"a／b"` (a fullwidth solidus folds to `/`, which is not in the class).
- [ ] **Step 2: Run** `bun test lib/daemon/__tests__/forge-get-github.test.ts`. Expected: FAIL, the three functions are not exported.
- [ ] **Step 3: Implement the three functions** with the regexes above.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `forge-reads: add the word skeleton and NFKD separator helpers`.

### Task 3: Match guarded words on the window's skeletons

This task changes how words are matched but does not narrow yet. The file path is still matched, and the owner and name are still refused, so every refusal today stays a refusal.

**Files:**
- Modify: `lib/daemon/forge-reads.ts` (`checkGithubForgePath`, `entryAt`)
- Test: `lib/daemon/__tests__/forge-get-github.test.ts`

**Interfaces:**
- Consumes: `wordSkeleton`, `dotSkeleton`, `foldsToSeparator` (Task 2); `GITHUB_REFUSED_ROUTES` (#1130).
- Produces:
  - `export function matchingWindow(segments: string[], from: number, to: number): { ok: true; parts: string[] } | { ok: false; error: string }`: `segments.slice(from, to).flatMap((s) => wordSkeleton(s).split(/[\/\\]/)).filter((p) => p !== "")`; a part equal to `"."` or `".."` gives `{ ok: false, error: '"path" must not contain dot segments' }`.
  - `const windowEntryAt = (parts: string[], entry: string): number`: its own copy of today's `entryAt` logic over `parts` (all but the last entry part exact, the last with `namesWord`), not a call to `entryAt`, which Task 4 deletes.
  - `export const githubWordRefusal = (word: string): string`: `WORD_REFUSAL` from Global Constraints.
  - `export const githubRouteRefusal = (word: string): string`: `ROUTE_REFUSAL` from Global Constraints.

- [ ] **Step 1: Write the failing tests** through the real provider (extend the `forgeGet through a real GitHubProvider` block; add a helper `wire(projectPath, path)` that runs `forgeGet(provider(), projectPath, { path }, "github")` and returns `{ result, sent }`). Each refused case asserts the exact error and `sent` empty:
  - Each accepted case in this task and Task 4 also asserts `redirect: "manual"` on the one request; `wire` returns it.
  - Refused with `githubWordRefusal(word)`: `:repo/actions/secrets%20`, `:repo/actions/%20secrets`, `:repo/hooks%C2%A0`, `:repo/actions/sec%E2%80%8Brets`, `:repo/hooks%E2%80%AE`, `:repo/hoo%C2%ADks`, `:repo/%EF%BB%BFhooks`, `:repo/actions/secrets%CC%81`, `:repo/actions/s%CD%8Fecrets`, `:repo/actions/%C5%BFecrets`, `:repo/%E2%84%AAeys`, `:repo/actions/%EF%BD%93%EF%BD%85%EF%BD%83%EF%BD%92%EF%BD%85%EF%BD%94%EF%BD%93`, `:repo/actions/secrets%20.json`, `:repo/actions/oidc%E2%80%8B/customization/sub`, `:repo/actions%20/oidc/customization/sub`, `:repo/actions/%20/oidc/customization/sub`, `:repo/actions/%E2%80%8B/oidc/customization/sub`, `:repo/actions%EF%BC%8Foidc/customization/sub`.
  - Refused with `githubRouteRefusal("copilot")`: `:repo/%E2%80%8Bcopilot/cloud-agent/configuration`, `:repo/%20/copilot/cloud-agent/configuration`, `:repo/%CC%81/copilot/code-review/settings`, `:repo/copilot.json/cloud-agent/configuration`, `:repo/copilot%EF%BC%8Fcloud-agent/configuration`, and #1130's existing copilot refusals (move their expected text to `githubRouteRefusal`).
  - A loop over `GITHUB_REFUSED_SEGMENTS` (single-word entries) and `GITHUB_REFUSED_ROUTES`: `:repo/<word>%20`, `:repo/<word>%E2%80%8B`, `:repo/<word>%CC%81`, `:repo/<word>%E3%85%A4` each refused, with `githubWordRefusal(word)` or `githubRouteRefusal(word)` by list.
  - Refused with the dot-segment error: `:repo/actions/.%E2%80%8B/oidc/customization/sub`, `:repo/%EF%BC%8E%EF%BC%8E/pulls`. (`:repo/%EF%BC%8E%EF%BC%8E/hooks` is refused in this task by the whole-path word check, which runs first; Task 4 moves it to the dot-segment error.)
  - Refused with the plain-path error (NFKD separators, at step 2): `:repo/contents/..%EF%BC%BChooks`, `:repo/actions%EF%BC%BCoidc/customization/sub`, `:repo/contents/x%EF%BC%9B/a`, `:repo/pulls%CD%BE`, `:repo/contents/a%EF%BC%85b`, `:repo/contents/a%EF%BC%9Fb`, `:repo/contents/a%EF%BC%83b`.
  - `:repo/git%EF%BC%8Fblobs/abc` refused with the `git/blobs` text.
  - Read, one request each, with the wire pathname: `:repo/labels/good%20first%20issue`, `:repo/labels/help%20wanted`, `:repo/readme/my%20docs`, `:repo/actions/workflows/ci%20build.yml`, `:repo/labels/caf%C3%A9`, `:repo/contents/docs/C%23.md`, `:repo/contents/what%3F.md`, `:repo/commits/copilot/fix`, `:repo/git/ref/heads/copilot/x`, and on repo `acme/copilot` `:repo/pulls`.
  - Update `credentialRefusal` in the file to `githubWordRefusal` so the existing word tests take the new text.
  - Move #1130's test "refuses a repo path that is not exactly owner/repo" from `gitlab_get reads a GitHub repo only by its owner/repo path` to the Rule 1 text, for all its projectPaths. This also covers the spec's three-segment `projectPath` case.
- [ ] **Step 2: Run** `bun test lib/daemon/__tests__/forge-get-github.test.ts`. Expected: the new refused cases and the moved texts FAIL; the read cases already pass.
- [ ] **Step 3: Rework `checkGithubForgePath`** to the spec's Order of checks, steps 1 to 4 and 7 to 8, with no file path yet (window `from = 3`, `to = segments.length`):
  - after the existing `;` check, `if (foldsToSeparator(decoded))` returns the plain-path error;
  - keep #1130's projectPath check (with the Rule 1 text), prefix check and empty-segment check where #1130 put them;
  - keep today's whole-path checks exactly as they run now (the `hits` over all segments, the owner and name refusal, and the whole-path `refused` check, now with `githubWordRefusal`, and the whole-path `git/blobs` check), in front of the window, so an entry that starts in the name and ends in the route (`:repo/oidc/x` on `acme/actions`, `:repo/blobs/x` on `acme/git`) stays refused; Task 4 deletes them;
  - then build `matchingWindow(segments, 3, segments.length)`; return its error if any;
  - `GITHUB_REFUSED_ROUTES` match only `parts[0]` with `namesWord` and refuse with `githubRouteRefusal`; `GITHUB_REFUSED_SEGMENTS` match with `windowEntryAt` and refuse with `githubWordRefusal`; then `git/blobs` on the window.
- [ ] **Step 4: Run the same command.** Expected: PASS. No case that was refused at the baseline is now read.
- [ ] **Step 5: Commit** `forge-reads: match GitHub guarded words on a skeleton window`.

### Task 4: The narrowing: file path and repo name

**Files:**
- Modify: `lib/daemon/forge-reads.ts` (`checkGithubForgePath`)
- Test: `lib/daemon/__tests__/forge-get-github.test.ts`

**Interfaces:**
- Consumes: `matchingWindow`, `windowEntryAt`, `githubWordRefusal`, `dotSkeleton` (Tasks 2, 3).
- Produces: `const fileStartOf = (rest: string): number | null`: splits the raw `rest` (after `:repo` expansion, before decoding) on `/`; returns `4` when raw part 3 is exactly `contents` and a raw part 4 exists, else `null`. It is positional: it never searches for `contents` by value.

- [ ] **Step 1: Write the failing tests** through the real provider:
  - **Credential table.** A `const CREDENTIAL_ROUTES` array of the spec's rows (Test plan, "The credential routes, on every repo shape"), including `actions/runners/downloads` and the two copilot rows. For each repo in `["o/r", "acme/hooks", "acme/hooks.io", "acme/keys", "secrets/app", "acme/actions", "acme/environments", "acme/contents", "acme/copilot"]` and each row, `:repo/<row>` is refused with no request. Name the regression cases in their own test: `:repo/hooks` and `:repo/hooks/1/config` on `acme/hooks.io`, `:repo/actions/secrets` on `secrets/app`, `:repo/actions/oidc/customization/sub` on `acme/actions`, `:repo/hooks` and `:repo/actions/secrets` on `acme/contents`, `:repo/copilot/cloud-agent/configuration` on `acme/copilot`.
  - **Accepted file paths**, with the wire pathname: `:repo/contents/src/hooks/useAuth.ts`, `:repo/contents/secrets.md`, `:repo/contents/infra/variables.tf`, `:repo/contents/keys/README.md`, `:repo/contents/Actions/Secrets`, `:repo/contents/git/blobs/x`, `:repo/contents/docs%2Fhooks.md`, `:repo/contents/a%20b.md`, `:repo/contents/a%E2%80%8Bb.md`, `:repo/contents/a/b/secrets.tf.json`, `:repo/contents`, `:repo/contents/` (Octokit drops the trailing slash, so the wire pathname is `/repos/o/r/contents` or `/repos/o/r/contents/`, as the existing `:repo/pulls/` test allows), `:repo/contents/..%E2%84%80hooks`. A loop over every `GITHUB_REFUSED_SEGMENTS` and `GITHUB_REFUSED_ROUTES` entry: `:repo/contents/<entry>` and `:repo/contents/dir/<entry>.md` read.
  - **Accepted repo names:** `:repo` and `:repo/pulls` on `acme/keys`, `acme/hooks.io`, `secrets/app`, `acme/contents`; `:repo/contents/README.md` on `acme/contents` sends `/repos/acme/contents/contents/README.md`; `:repo/oidc/customization/sub` on `acme/actions` is read.
  - **Strict match kept**, refused with `githubWordRefusal`: `:repo/Contents/hooks`, `:repo/%63ontents/hooks`, `:repo/contents.json/hooks`, `:repo/contents%2Fhooks`, `:repo/actions/contents/secrets`, `:repo/readme/hooks`, `:repo/git/ref/heads/feature/hooks`, `:repo/commits/hooks`.
  - **File-path dot checks**, refused with the dot-segment error: `:repo/contents/..%20/hooks`, `:repo/contents/%EF%BC%8E%EF%BC%8E/hooks`, `:repo/contents/..%EF%BB%BF/hooks`, `:repo/contents/..%E2%80%8B/hooks`, `:repo/contents/..%EF%BC%8Fhooks`, `:repo/contents/%EF%BC%8E%EF%BC%8E%EF%BC%8Fhooks`, `:repo/contents/%E2%80%A5%EF%BC%8Fhooks`; the existing `:repo/contents/../hooks`, `%2e%2e` and `%252e%252e` cases keep their errors.
  - **Rule 2**, refused with the Rule 2 text: `Repos/o/r/contents/hooks`, `repos/o%2Fr/pulls`, `repos/o/%72/pulls`, `repos/%4F/r/pulls`, and on repo `kcme/r` the path `repos/Kcme/r/pulls`.
  - `:repo/%EF%BC%8E%EF%BC%8E/hooks` moves from the word refusal to the dot-segment error.
  - **Whole-path checks still run inside a file path**, each with its exact error: `:repo/contents/x;/../hooks` (dot-segment error, which comes first), `:repo/contents/{x}` (the braces error), `:repo/contents/a%5Cb` (plain-path error), `:repo/contents/a b` (the whitespace error), and `:repo/hooks%09` (plain-path error).
  - #1130's copilot cases `repos%2Fo%2Fr%2Fcopilot/cloud-agent/configuration`, `repos/%6F/%72/copilot/cloud-agent/configuration` and `REPOS/O/R/COPILOT/code-review/settings` move to the Rule 2 text; they stay refused.
  - `:repo/oidc/x` on `acme/actions` (#1130's test) moves from refused to read, as does `:repo/blobs/x` on `acme/git`.
  - Remove the test `a repo whose owner or name is a refused word is refused as such`; move `:repo/contents/secrets.md` from the suffix test's refused list to accepted.
  - A 302 from `:repo/contents/big.bin` is refused naming only the host.
- [ ] **Step 2: Run** `bun test lib/daemon/__tests__/forge-get-github.test.ts`. Expected: the new accepted cases and the Rule 2 cases FAIL.
- [ ] **Step 3: Finish `checkGithubForgePath`** (spec Order of checks, steps 5 and 6):
  - after the prefix and empty-segment checks, refuse unless raw part 0 is exactly `repos` and raw parts 1 and 2 each match `/^[A-Za-z0-9._-]+$/` (Rule 2 text);
  - `const fileStart = fileStartOf(rest)`; when not null, for each decoded segment from index 4, refuse with the dot-segment error if any part of `dotSkeleton(seg).split(/[\/\\]/)` is `"."` or `".."`;
  - window becomes `matchingWindow(segments, 3, fileStart ?? segments.length)`;
  - delete the owner and name refusal and the whole-path `hits` and `refused` checks Task 3 kept, and delete `entryAt`, which then has no callers (`noUnusedLocals` is off, so typecheck will not flag it).
- [ ] **Step 4: Run** `bun test lib/daemon/__tests__/forge-get-github.test.ts lib/daemon/__tests__/forge-reads.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `forge-reads: read GitHub file paths and word-named repos through gitlab_get (RT-554)`.

### Task 5: The MCP seam, the tool text and the docs

**Files:**
- Modify: `lib/mcp/forge-read-tools.ts` (the `gitlab_get` description, line 58)
- Modify: `plugins/mattstack/attachments/mcp-tools/reference.md` (regenerated)
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (version)
- Modify: `.claude/rules/mcp-and-gates.md` (the GitHub guard sentences)
- Modify: `docs/superpowers/specs/2026-11-10-daemon-forge-router-design.md` (section 4, one line)
- Test: `lib/mcp/__tests__/redact.test.ts`

- [ ] **Step 1: Write the failing test.** In `redact.test.ts`, `test("a GitHub contents body's download_url token is redacted")`: `toCallResult({ ok: true, body: { status: 200, body: { name: "a.md", download_url: "https://raw.githubusercontent.com/o/r/main/a.md?token=AAAAFAKETOKEN123" } } })` has text containing `?token=[redacted]` and not `AAAAFAKETOKEN123`.
- [ ] **Step 2: Run** `bun test lib/mcp/__tests__/redact.test.ts`. Expected: PASS already, since `CREDENTIAL_PARAM` covers it. Keep it as the pin the spec asks for; if it fails, stop and report, since that is a live leak on main.
- [ ] **Step 3: Edit the description.** In the GitHub refused clause, after "and similar", add: `; file paths under :repo/contents/ are not checked for those words, and a repo named after one is readable`.
- [ ] **Step 4: Regenerate the reference:** `env -i HOME="$(mktemp -d)" PATH="$PATH" bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`. Expected: the diff is that one description change.
- [ ] **Step 5: Bump the plugin version** to one past `git show origin/main:plugins/mattstack/.claude-plugin/plugin.json`'s version.
- [ ] **Step 6: Edit `.claude/rules/mcp-and-gates.md`** with the spec's "Docs that change with the code" wording: word matching over the window after the repo on the word skeleton; owner and name never matched; no matching in a file path after a literal `:repo/contents/`; and the widenings (repo shape and plain repo segments, empty segments, C1 controls on both forges, NFKD separators, dot lookalikes, `copilot` route-anchored). Keep "widened, never narrowed, without a design review" and name this spec as the review.
- [ ] **Step 7: Add one line** to section 4 of `2026-11-10-daemon-forge-router-design.md`: `RT-554 narrows this list for file paths and repo names; see 2026-11-13-gitlab-get-github-guard-narrowing-design.md.`
- [ ] **Step 8: Run** `bun test lib/mcp/__tests__/redact.test.ts lib/mcp/__tests__/forge-read-tools.test.ts lib/daemon/__tests__/forge-get-github.test.ts lib/daemon/__tests__/forge-reads.test.ts && bun run typecheck && bun run purity && bun run docs:check`. Expected: all green.
- [ ] **Step 9: Commit** `gitlab_get: describe the narrowed GitHub guard, rules and reference (RT-554)`.

### After Task 5 (the orchestrator)

- [ ] Whole-branch security review by an Opus subagent at xhigh, briefed to find a reachable credential route through the code as built (not the spec).
- [ ] Push with `git_push`, open the PR with `gh pr create`, wait for CodeRabbit and CI. Never merge.
