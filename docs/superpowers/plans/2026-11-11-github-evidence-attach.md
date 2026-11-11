# GitHub Through the Daemon, Plan C: Evidence on GitHub PRs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `evidence_attach` uploads a run's evidence images into a GitHub PR's description, and `mr_upload` refuses on GitHub in every argument form and names `evidence_attach` (RT-547).

**Architecture:** A new daemon verb, `mr:describe-with-attachments`, runs the same guard and record checks `mr:upload` runs on each file, copies the checked bytes into a private staging folder, and runs `gh pr edit --body-file --attach` with the GitHub token only in gh's environment. It then reads the PR body back through the router's `GitHubProvider` and returns the hosted URL for each file. `evidence_attach` renders the section with a relative reference for each new image, splices it into the live PR body, calls the verb, and remembers the URLs in the run's `evidence-uploads` field for reuse. The attach-the-evidence skill block sends GitHub through the same evidence-boards gate and `evidence_attach` call as GitLab.

**Tech Stack:** TypeScript, Bun, the rt daemon, the rt MCP server, GitHub CLI 2.99+ (`--attach`), the mattstack plugin's block skills.

**Spec:** `docs/superpowers/specs/2026-11-10-daemon-forge-router-design.md`, section 8 (Evidence on GitHub) and the `mr:upload` row of section 3. Plan A (`docs/superpowers/plans/2026-11-10-github-daemon-reads-and-router.md`) is merged: `getRepoContext` routes GitHub repos, `mr:get` and `mr:update` work on GitHub, `isGitHubRepo(repoPath)` is exported from `lib/daemon/freshness.ts`.

## Global Constraints

- GitLab behaviour and error strings do not change, for every GitLab input. Existing GitLab tests stay untouched and green.
- A token only ever goes to its own forge's host. The daemon is the one process that holds forge tokens: the MCP server never reads the GitHub token, and gh gets it only as `GH_TOKEN` in its environment, never in argv.
- gh's environment is exactly `PATH`, `HOME`, `GH_TOKEN` and `GH_PROMPT_DISABLED=1`. gh is the bundled copy when present, else the one on PATH or the well-known bin dirs (`findBundledTool("gh", whichWithWellKnownDirs())` from `lib/bundled-tool.ts`). gh older than 2.99.0, or none, refuses with the command to fix it.
- No live forge calls and no real `gh` upload anywhere: every test fakes gh with a script and fakes the provider. Never run rt, the daemon or a built binary against the real HOME: any rt command in this plan runs as `env HOME=<scratch home> bun cli.ts ...` from the worktree root. Never touch `~/Documents/GitHub/repo-tools`.
- Run only the test files a task touches, from the worktree root (`bun test <file>`), never the full suite.
- Write fence: `lib/mcp/evidence-tools.ts`, `lib/mcp/tools.ts` (the `mr_upload` tool and evidence wiring only), `lib/daemon/handlers/mr-upload.ts`, `lib/mcp/mr-target.ts` (only if a kept refusal must lift), their `__tests__` folders, `packages/rt-client/src/commands.ts`, `.claude/rules/mcp-and-gates.md`, `plugins/mattstack/attachments/evidence-record/attach-the-evidence/index.block.md` and its compiled outputs, `plugins/mattstack/pack/requires.json`, the generated `plugins/mattstack/attachments/mcp-tools/reference.md`, `plugins/mattstack/.claude-plugin/plugin.json` (version only), `docs/superpowers/plans/`, the evidence section of the spec, `.superpowers/`. Another lane edits `lib/mcp/tools.ts` (comment, thread and review tools), `lib/daemon/handlers/discussions.ts`, `.claude/rules/mcp-and-gates.md`, the reference and the plugin version: keep edits to shared files small, and expect to rebase and re-bump.
- No em or en dashes in code, comments, docs, copy or commit messages. A comment states a constraint the code cannot show.
- One commit per task, prefixed `daemon:`, `mcp:` or `mattstack:`, ending with a `Co-Authored-By:` line naming the model that wrote it. Stage named files only.
- After touching `packages/rt-client/src`, run `bun run build` in `packages/rt-client` (`.claude/rules/workspace-packages.md`).

## What gh does (settled from gh 2.103.3's source, the spec's open point)

Read from `pkg/cmd/pr/edit/edit.go` and `internal/attachments/` at tag v2.103.3; this is what the verb's handling rests on.

- **Order.** gh checks every file first (type by extension, size, not empty, at most 50 files), then uploads them one by one in argv order, stopping at the first failure; files after it are not tried. Only then does it write the PR.
- **Partial failure.** With at least one upload done, gh writes the body with only the uploaded files' references rewritten (the failed and untried ones stay local), prints the PR URL and exits 1. With none done, it leaves the body as it was and exits 1. If the uploads land but the PR write fails, it exits 1, prints no URL, and the uploads are orphaned (gh has no delete). So after any nonzero exit the verb reads the body back and records whatever hosted URLs are there; the orphaned case finds none, and the next attach uploads again. This pins the spec's fallback as written.
- **References.** gh parses the body as markdown and matches a link or image destination to an `--attach` file by absolute path; a relative destination resolves against the `--body-file`'s folder first. Only the destination changes; alt text survives. A file the body never references is appended, so every attachment must be referenced.
- **Limits.** Images (png, jpg, jpeg, gif, webp, svg) at most 10 MB, video (mp4, mov, webm) at most 100 MB. rt's own cap is 50 MB, so an image between 10 and 50 MB is refused by the verb before gh runs.
- **Errors on stderr.** A token that cannot write the repo, or that the upload endpoint rejects, gives `could not upload <path>: attaching files requires write access to the repository` (gh checks the viewer's permission first and maps the endpoint's 404 to this). A 401 adds `Try authenticating with:  gh auth login`. A rate limit gives `could not upload <path>: rate limited; ...`.
- **Repo.** `--repo` works from any folder; nothing is read from a git checkout. The verb passes `--repo github.com/<owner>/<repo>` so the host is pinned whatever the user's gh config says.

## Review Focus

1. Someone edits the PR body between rt's read and gh's write, or between gh's write and the read-back: nothing crashes, no wrong URL is recorded against a file, and `written` is still reported truthfully. (Task 2)
2. Two evidence files share a basename in different case folders (two `board.png`): each gets its own staged name and its own URL, and reuse on the next call maps each URL back to the right file. (Task 2, Task 3)
3. An annotated board between 10 MB and 50 MB: refused in the `size` bucket before gh runs, and nothing uploads. (Task 2)
4. gh hangs past the deadline: gh is stopped, the staging folder is removed, the body is read back, and the reply names the stop. (Task 2)
5. A token that cannot upload (a fork contributor, a token the endpoint rejects): the description is still written, the images are named as attached separately, and the section says plainly that they are not shown. (Task 3)

---

### Task 1: `mr_upload` refuses GitHub in every form, and the upload checks become one function

**Files:**
- Modify: `lib/daemon/handlers/mr-upload.ts`, `lib/mcp/tools.ts` (the `mr_upload` tool and `MR_UPLOAD_GH_MOVE` only)
- Test: `lib/daemon/__tests__/mr-upload.test.ts`, `lib/mcp/__tests__/tools.test.ts`

**Interfaces:**
- Produces, inside `createMrUploadHandlers` in `mr-upload.ts` (Task 2 calls it from its own handler in the same closure):

```ts
type CheckedAttachment = { realpath: string; filename: string; mime: string; bytes: Uint8Array };
function checkAttachment(repoName: string, repoPath: string, path: string, runId: unknown): { ok: true; checked: CheckedAttachment } | { ok: false; error: string };
```

  Its body is today's `mr:upload` lines from `checkUploadPath` through `ticketCopyAnyRun`, in the same order, with the same strings (the `runId` shape check stays where it sits today, after the redaction check).
- Produces: `MrUploadSeams.isGitHub?: (repoPath: string) => Promise<boolean>`, default `isGitHubRepo` from `../freshness.ts`.
- Produces: `export const MR_UPLOAD_GITHUB_REFUSAL = "unsupported: GitHub uploads a file only as part of a PR write; use evidence_attach, which uploads images into the PR description"` in `mr-upload.ts`.
- `MR_UPLOAD_GH_MOVE` in `tools.ts` becomes `"GitHub uploads a file only as part of a PR write; on a PR, evidence_attach uploads the images into its description"`, so the shared refusal reads `GitLab only: mr_upload does not speak GitHub; GitHub uploads a file only as part of a PR write; on a PR, evidence_attach uploads the images into its description`.

- [ ] **Step 1: Write the failing tests.** In `mr-upload.test.ts`, the `harness` seams gain `isGitHub: async () => false` as the default (so no existing case reads a real remote), and add: `mr:upload on a GitHub repo refuses with MR_UPLOAD_GITHUB_REFUSAL before any path check` (an `isGitHub: async () => true` harness, a path outside every root: the error equals `MR_UPLOAD_GITHUB_REFUSAL`, `calls` is empty, `hooks` is empty). In `tools.test.ts`, in the `mr_upload` describe: `the single-path form refuses a github.com mrUrl, a github.com repoName and a label resolving to a GitHub repo, before the daemon` (three calls; each error contains `GitLab only: mr_upload does not speak GitHub` and `evidence_attach`; `fakeDaemon` saw no call); `the batch form's GitHub refusal names evidence_attach` (extend the existing batch github.com case and the label case near line 977 with `toContain("evidence_attach")`). Keep the existing "descriptions say GitLab only exactly where the tool still is" test as it is.
- [ ] **Step 2: Run** `bun test lib/daemon/__tests__/mr-upload.test.ts lib/mcp/__tests__/tools.test.ts`. Expected: the new cases FAIL (the single form reaches the daemon, the strings lack `evidence_attach`).
- [ ] **Step 3: Implement.** Extract `checkAttachment`; `mr:upload` calls it after `repo-unknown` and the new `isGitHub(repoPath)` check, then sends `checked.bytes` exactly as today. In the `mr_upload` tool, the single-path form runs `refuseGithubTarget(input, "mr_upload", MR_UPLOAD_GH_MOVE)` before `resolveRepoTarget` and `githubRefusal(target.identity, ...)` after it, as the batch form already does. The description keeps its `GitLab only.` start and gains, right after it: `On GitHub it refuses in every form and names evidence_attach, since GitHub uploads a file only as part of a PR write.`
- [ ] **Step 4: Run** the two files. Expected: PASS, with every pre-existing case unchanged.
- [ ] **Step 5: Commit** `mcp: mr_upload refuses GitHub in every form and names evidence_attach`.

### Task 2: The `mr:describe-with-attachments` daemon verb

**Files:**
- Modify: `lib/daemon/handlers/mr-upload.ts`, `packages/rt-client/src/commands.ts`
- Test: `lib/daemon/__tests__/mr-describe-attachments.test.ts` (new)

**Interfaces:**
- Consumes: `checkAttachment` and the seams from Task 1.
- Produces, in `commands.ts` (and the name added to `COMMAND_NAMES` beside `mr:upload`):

```ts
export type DescribeAttachment = { path: string; name: string };
export type DescribeWithAttachmentsResult =
  | { outcome: "refused"; refused: Array<{ path: string; error: string }> }
  | { outcome: "ran"; written: boolean; urls: Record<string, string>; ghError?: string; uploadRejected?: boolean; readBackError?: string };

"mr:describe-with-attachments": {
  payload: { repoName: string; iid: number; description: string; attachments: DescribeAttachment[]; runId?: string };
  data: DescribeWithAttachmentsResult;
};
```

  `urls` is keyed by the attachment's `path` exactly as sent. `written` is true when gh exited 0, or when it exited nonzero and the read-back found at least one hosted URL.
- Produces, in `mr-upload.ts`: `export const GH_ATTACH_TIMEOUT_MS = 200_000` (inside the socket's 255 s idle limit) and `export const GH_MIN_VERSION = "2.99.0"`.
- Produces seams on `MrUploadSeams`: `ghBinary?: () => string | null` (default `findBundledTool("gh", whichWithWellKnownDirs())`), `githubToken?: () => Promise<string | null>` (default `resolveGithubToken((await loadSecrets()).githubToken)?.token ?? null`), `githubContext?: (repoName: string, repoPath: string) => Promise<{ projectPath: string; readBody: (iid: number) => Promise<string> }>` (default: `getRepoContext`, which must answer `forge: "github"`; `readBody` is `provider.fetchSingleMR(projectPath, iid, null)` and throws on null), `ghTimeoutMs?: number`, `stagingRoot?: () => string` (default `tmpdir()`).

The handler, in this order (each refusal is `{ok: false, error}` unless it says otherwise):

1. Payload: `decodeRepo`; `iid` a positive integer; `description` a string; `attachments` an array of 1 to 50 `{path, name}` with `path` an absolute string and `name` matching `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/`; names unique ignoring case (macOS folders are case-insensitive); each name's extension, lowercased, is in `UPLOAD_EXTENSIONS`; `description` contains `](./<name>)` for every name (gh appends an unreferenced file); `runId`, when present, a non-empty string.
2. `repo-unknown` when the repo index has no path; `unsupported: describe-with-attachments needs a GitHub repo` when `isGitHub(repoPath)` is false.
3. gh: none gives `gh is not installed; attaching images on GitHub needs gh 2.99 or newer (run: brew install gh)`. `gh --version` (env without `GH_TOKEN`, 10 s timeout) below 2.99.0 or unparseable gives `gh <version> cannot attach images; it needs gh 2.99 or newer (run: brew upgrade gh)`.
4. No token gives `missing GitHub token (run: rt setup github connect)`.
5. Each attachment through `checkAttachment(repoName, repoPath, path, runId)`; then an image (not mp4, mov, webm) over 10 MB gives `file is <n.n> MB; the upload cap is 10 MB for an image on GitHub` (the phrase `the upload cap is` keeps `bucketFor` in `size`), and a name whose extension differs from the checked file's gives a refusal. Any refusal returns `{ok: true, data: {outcome: "refused", refused}}` listing every refused attachment, and gh never runs.
6. `githubContext(repoName, repoPath)`; then `mkdtempSync(join(stagingRoot(), "rt-gh-attach-"))`, each attachment's checked bytes written to `<dir>/<name>` (`flag: "wx"`, mode `0o600`), so gh uploads exactly the bytes that passed the checks, and the description to `<dir>/body.md`.
7. `runCapture([gh, "pr", "edit", String(iid), "--repo", "github.com/<projectPath>", "--body-file", "<dir>/body.md", ...("--attach", "<dir>/<name>") per attachment], { cwd: dir, env: {PATH, HOME, GH_TOKEN, GH_PROMPT_DISABLED: "1"}, stderr: "pipe", timeoutMs: ghTimeoutMs ?? GH_ATTACH_TIMEOUT_MS, signal })`.
8. `readBody(iid)`, after every exit, zero or not. Pair the destinations matched by `/\]\(([^)\s]+)/g` in the sent description and the read-back body by position (this covers images and the links gh turns a video into). When the counts differ, record no URL and set `readBackError: "the PR body changed after the write, so the image URLs were not recorded"`. Otherwise, for each position whose sent destination is `./<name>`, a read-back destination that differs and starts with `https://` is that attachment's URL. A read that throws sets `readBackError` to its message, with no URLs.
9. `ghError`, on a nonzero exit or a timeout: gh's stderr trimmed to 500 characters (or `gh pr edit did not finish in <n>s and was stopped` on a timeout), with each `<dir>/<name>` replaced by the source file's basename and any other occurrence of `<dir>` removed, so no staging path or home path reaches a reply. `uploadRejected` is true when the exit was nonzero, no URL was found, and stderr matches `/attaching files requires write access|gh auth login|HTTP 401/`.
10. The staging folder is removed in a `finally`, and only after asserting its path starts with the real staging root and its basename starts with `rt-gh-attach-`.

- [ ] **Step 1: Write the failing tests** in `mr-describe-attachments.test.ts`, with the same harness shape as `mr-upload.test.ts` (temp HOME, temp repo with PNGs, a `runStart` run for the record case). The fake gh is a shell script each test writes to a temp bin folder and returns from `ghBinary`; since gh's environment carries only the four variables, the script's behaviour and its log folder are written into the script itself. It answers `--version` with a scripted version; for `pr edit` it logs its argv, its `env` and its `pwd`, copies the `--body-file` to the log folder, and then, per test, writes a "server body" file (the body with some or all `./<name>` destinations replaced by `https://github.com/user-attachments/assets/<n>`) and exits with a scripted code and stderr. The `githubContext` seam returns `projectPath: "acme/web"` and a `readBody` that reads the server body file. Cases:
  - `runs gh pr edit with the body file and one --attach per file, in the staging folder`: argv after the binary equals `["pr", "edit", "7", "--repo", "github.com/acme/web", "--body-file", "<dir>/body.md", "--attach", "<dir>/1-board.png", "--attach", "<dir>/2-shot.png"]`, the logged cwd is `<dir>`, the copied body equals the description, and each staged file's bytes equal its source's.
  - `gives gh only PATH, HOME, GH_TOKEN and GH_PROMPT_DISABLED, and the token never in argv`: the logged env's keys (ignoring what the shell itself adds: `PWD`, `SHLVL`, `_`, `OLDPWD`) are exactly those four, `GH_TOKEN` equals the seam's token, `GH_PROMPT_DISABLED` is `1`, and no argv entry contains the token.
  - `answers written with each file's URL when gh exits 0`: `{outcome: "ran", written: true, urls: {<path1>: <url1>, <path2>: <url2>}}`, no `ghError`.
  - `two files with the same basename get their own names and their own URLs`: sources `case-a/board.png` and `case-b/board.png` sent as `1-board.png` and `2-board.png`; each path maps to the URL that replaced its own name.
  - `a partial upload returns the uploaded URL, written, and a ghError naming the file without the staging folder`: gh rewrites only `1-board.png`, prints `could not upload <dir>/2-shot.png: rate limited; wait and try again` and exits 1. `written: true`, `urls` has only the first path, `ghError` contains `could not upload shot.png` and not `rt-gh-attach-`, `uploadRejected` is absent or false.
  - `a rejected upload is uploadRejected, unwritten, with no URLs`: stderr `could not upload <dir>/1-board.png: attaching files requires write access to the repository`, exit 1, server body unchanged.
  - `uploads that land before a failed PR write are not written and not rejected`: stderr `HTTP 422: Validation Failed`, exit 1, server body unchanged: `written: false`, `urls: {}`, `uploadRejected` false, `ghError` set.
  - `a body edited after the write records no URL`: exit 0, the server body has one more `](...)` than the sent body: `written: true`, `urls: {}`, `readBackError` set.
  - `gh past the deadline is stopped and the staging folder removed`: the script sleeps 5 s, `ghTimeoutMs: 200`: `ghError` contains `was stopped`, the folder is gone, `readBody` was still called.
  - `the staging folder is removed after success and after a refusal from gh`: no `rt-gh-attach-*` folder remains under the `stagingRoot` seam's temp dir.
  - `refuses gh older than 2.99 and a missing gh, before any pr edit`: version `2.98.1` gives the upgrade string naming `2.98.1`; `ghBinary: () => null` gives the install string; the log shows no `pr edit` either time.
  - `refuses with no token, and on a GitLab repo, before running gh`: the two strings above; no `pr edit`.
  - `an image over 10 MB is refused in the size bucket and gh never runs`: a 10.5 MB PNG: `outcome: "refused"`, its error contains `the upload cap is 10 MB for an image on GitHub`, and `bucketFor` on it (from `lib/evidence/refusal-buckets.ts`) is `size`.
  - `a file outside the roots, and a file not in the run's record, are refused with mr:upload's own strings, and gh never runs`: the same two errors `mr:upload` gives for the same inputs.
  - `refuses a bad payload`: 0 and 51 attachments, a relative path, the names `../x.png`, `a.txt`, a duplicate pair `1-A.png` / `1-a.png`, and a name the description never references, each with no gh run.
- [ ] **Step 2: Run** `bun test lib/daemon/__tests__/mr-describe-attachments.test.ts`. Expected: FAIL, the verb does not exist.
- [ ] **Step 3: Implement** the verb in `createMrUploadHandlers` and its type in `commands.ts`, then `bun run build` in `packages/rt-client`.
- [ ] **Step 4: Run** the new file, `lib/daemon/__tests__/mr-upload.test.ts`, `packages/rt-client/test/dist-freshness.test.ts` and `bun run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `daemon: mr:describe-with-attachments uploads PR images through gh --attach`.

### Task 3: `evidence_attach` uploads and writes on GitHub

**Files:**
- Modify: `lib/mcp/evidence-tools.ts`
- Test: `lib/mcp/__tests__/evidence-tools.test.ts`

**Interfaces:**
- Consumes: `mr:describe-with-attachments` and `DescribeWithAttachmentsResult` (Task 2), `mr:get` and `mr:update` (both forges).
- Produces, in `evidence-tools.ts`: `export const MR_DESCRIBE_TIMEOUT_MS = 240_000`; `export const GITHUB_UPLOAD_REFUSED_NOTE = "The images are named, not shown: GitHub refused the upload for the token rt uses."`; `export function attachmentName(index: number, path: string): string`, returning `${index + 1}-${base}` where `base` is the basename with every character outside `[A-Za-z0-9._-]` turned into `-` and cut to 100 characters with its extension kept.
- The `Target` type becomes `{ forge: "gitlab" | "github"; identity: string; iid: number | undefined; mr: string | null }`. `resolveAttachTarget` resolves every target through `deps.resolveRepo(input, { github: true })` (and the run's mr field the same way), keeping today's iid and field-mismatch refusals; `forge` is `"github"` when `githubRefusal(identity, ...)` would refuse, else `"gitlab"`. `ghMove`, `prNumber`, `githubRepo` and `githubUrl` go. An unregistered GitHub repo now fails resolution, as an unregistered GitLab repo does.
- The GitHub result keeps the GitLab keys: `{forge: "github", mr, uploaded, refused, timedOutTwice: [], linked, section, description?, descriptionWritten, notWritten?, writeErrors?, uploadRefused?, readBackError?}`. `notWritten: "github"` and `next` are gone.

The GitHub branch, sharing the GitLab branch's reuse loop (`reusable` with `project` = identity), its bucket and `linked` classification, and its `evidence-uploads` merge write (extract that block into one helper both branches call, with the GitLab call sites unchanged in behaviour):

1. No PR (`iid` undefined): no daemon call. The section names reused images by URL and every other file as attached separately; the home check applies; `notWritten: "no-mr"`, and a passed `description` comes back spliced.
2. `mr:get` with `refresh: true` reads the live body (a failure is a `writeErrors` entry, as on GitLab). An empty record is `notWritten: "unchanged"`, as on GitLab.
3. Render with a link per file: a reused file by its stored markdown; a file to send as `{ markdown: "![](./<attachmentName(i, path)>)" }` (so `linkText` keeps the slot alt text); a file set to local as `{ local }`. The home check runs on this section before any daemon call. With nothing to send, splice and write through `mr:update` exactly as GitLab does.
4. Otherwise call `mr:describe-with-attachments` with the spliced body, the attachments, and the run's id, `timeoutMs: MR_DESCRIBE_TIMEOUT_MS`, calling `progress` once before and every 15 s while it waits. An already-aborted signal skips the call with the same `cancelled` write error GitLab gives.
5. `outcome: "refused"`: each refused file goes to `linked` (when an earlier call linked it) or to `refused[bucketFor(error)]`. Without `linkRefused`, any bucketed refusal blocks: `notWritten: "refused"`, the section returned without those files (`withoutFiles`), nothing written. With `linkRefused`, each refused file is remembered as `{linked: true}`, rendered as attached separately, and the verb is called once more with the rest (or `mr:update` when none is left); a second `refused` outcome blocks the same way.
6. `outcome: "ran"`: every returned URL joins `uploaded` (`reused: false`) and is remembered as `{sha256, project: identity, url, markdown: "![<basename>](<url>)", at}`. Then:
   - `uploadRejected`: render every unsent file as attached separately with `GITHUB_UPLOAD_REFUSED_NOTE` placed before any appendix, splice the live body, write it through `mr:update`; `uploadRefused` is the `ghError`; `descriptionWritten` follows the write.
   - any other `ghError`: `descriptionWritten` is `written`, and `writeErrors` gets `gh pr edit failed: <ghError>; <k> of <n> images uploaded and are remembered, so calling again resumes`.
   - no `ghError`: `descriptionWritten: true`; a `readBackError` is passed on in the result and does not fail the call.

- [ ] **Step 1: Write the failing tests.** In `makeDeps`, `resolveRepo` records its options and also resolves `https://github.com/acme/<repo>/pull/<n>` and GitHub repoName shapes to `remote:github.com%2Facme%2F<repo>`; `mr:get` returns the GitHub PR's `webUrl` for a GitHub identity; a default `mr:describe-with-attachments` responder replaces each `./<name>` in the sent body with `https://github.com/user-attachments/assets/<name>`, stores it as `state.live`, and answers `written: true` with those URLs. Replace the GitHub cases that assert `notWritten: "github"`, `next` or `gh pr edit` (the `http://github.com` case goes: a PR URL must be https, as `parsePrUrl` requires), keep the fold cases with the new resolution, and add:
  - `a GitHub PR attaches each new file in one describe call and remembers its URL`: one call with `attachments: [{path: <board>, name: "1-badge.png"}]`, the run's id, and a description containing `](./1-badge.png)`; no `mr:upload` call; `descriptionWritten: true`; `state.live` holds the hosted URL; `evidence-uploads` holds `{project: "remote:github.com%2Facme%2Fweb", url, sha256}` for the board; `resolveRepo` was called with `{github: true}`.
  - `a second GitHub attach reuses the stored URL and attaches nothing`: no describe call; the section carries the URL.
  - `a refused file blocks the GitHub write unless linkRefused, and linkRefused sends the rest`: a `record` refusal without `linkRefused`: `notWritten: "refused"`, one describe call, no `mr:update`. With `linkRefused`: a second describe call without that file, the section names it `(attached separately)`, and `evidence-uploads` marks it linked.
  - `a rejected upload still writes the description with the files named and the note`: `mr:update` carries `(attached separately)` and `GITHUB_UPLOAD_REFUSED_NOTE`; `descriptionWritten: true`; `uploadRefused` set.
  - `a partial gh failure remembers what uploaded and says calling again resumes`: `written: true`, one of two URLs: that URL is remembered, `writeErrors[0]` contains `gh pr edit failed` and `calling again resumes`.
  - `two boards with the same basename get two names and keep their own URLs`.
  - `a GitHub repo with no PR yet returns the spliced description and calls no daemon verb`.
  - `a GitHub section naming the home directory is refused before any daemon call`.
  - `progress ticks while the describe call runs` (a responder that resolves after the test advances time, or a counter seen at least once before the call).
- [ ] **Step 2: Run** `bun test lib/mcp/__tests__/evidence-tools.test.ts`. Expected: the new and rewritten GitHub cases FAIL; every GitLab case passes.
- [ ] **Step 3: Implement**, and update the `evidence_attach` description: the GitHub sentence becomes `On GitHub the files go up with the description in one gh write through the daemon (gh 2.99 or newer), after the same checks; a token GitHub refuses for uploads still gets the description written, with the files named as attached separately and a line saying why.`, the result list gains `uploadRefused?` and `readBackError?`, and the `description` input reads `A description to splice the section into when there is no MR or PR to write.`
- [ ] **Step 4: Run** `lib/mcp/__tests__/evidence-tools.test.ts`, `lib/mcp/__tests__/tools.test.ts`, `lib/mcp/__tests__/evidence-ticket-replay.test.ts`, `lib/mcp/__tests__/evidence-import-board-replay.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `mcp: evidence_attach uploads and writes the evidence section on GitHub PRs`.

### Task 4: The skill block, the rules, the reference, the version and the spec note

The controller runs this task itself, since the skill's RED and GREEN runs are fresh agents it dispatches.

**Files:**
- Modify: `plugins/mattstack/attachments/evidence-record/attach-the-evidence/index.block.md`, `plugins/mattstack/attachments/mcp-tools/reference.md` (generated), `plugins/mattstack/.claude-plugin/plugin.json` (version), `plugins/mattstack/pack/requires.json`, `.claude/rules/mcp-and-gates.md`, the spec's section 8

**Interfaces:**
- Consumes: the tool descriptions from Tasks 1 and 3; `evidence_attach`'s GitHub result (Task 3).

- [ ] **Step 1: RED.** Load `superpowers:writing-skills` and `mattstack:editing-skills`. Compile the current engines the way CI does (copy `plugins/mattstack` to `<scratch>/ms/plugins/mattstack`, the two `tests/graph-*.jsonc` files to `<scratch>/pack/pack/`, then `env HOME=<scratch home> bun cli.ts skills compile --pack-dir <scratch>/pack --mattstack-dir <scratch>/ms`) and give a fresh agent the compiled evidence-record skill with a scenario: a ship run on a GitHub PR, two annotated boards, the attach gate just proceeded. Record that it skips the evidence-boards gate and goes to `gh pr view`.
- [ ] **Step 2: Edit the block.** The GitHub branch goes: remove `forge_host`, `gh_pr_view`, `evidence_attach_body`, `description_returned`, `gh_pr_edit` and their edges, and point `attach_evidence` at `run_field_get_cleared`. The prose drops "On GitLab," from the first sentence, the "On GitHub nothing uploads; `<n>` is the PR number in `mrUrl`." sentence and "(a failed `gh pr edit` too)", and says the target is the MR or PR URL. Recompile in scratch and check the compiled evidence-record `SKILL.md` with `python3 plugins/mattstack/plugin/skills/process-digraphs/check-dot.py --short-ids <it>`.
- [ ] **Step 3: GREEN.** The same scenario on a fresh agent with the recompiled skill: it opens the evidence-boards gate for both boards, then calls `evidence_attach` with the PR URL, and ends Attached on `descriptionWritten`; it runs no `gh` and no shell command a tool covers. Up to three craft rounds, then the editing-skills gate.
- [ ] **Step 4: Certify** with `sh <installed mattstack>/tests/certify.sh plugins/mattstack/attachments/evidence-record` until it passes.
- [ ] **Step 5: Rules.** In `.claude/rules/mcp-and-gates.md`, change only: the "upload ... tools are GitLab only" clause to say `mr_upload` refuses on GitHub and names `evidence_attach`, which sends a PR's evidence images through the daemon's `mr:describe-with-attachments` (the same guard and record checks as `mr:upload`, then gh with the token only in its environment); "`mr_upload` is the one tool that sends a local file off the machine" to name both tools; and "(`evidence_attach` builds its own GitHub target)" to say `evidence_attach` passes `github: true` too.
- [ ] **Step 6: Spec note.** In section 8, replace the "Open for Plan C" bullet with the settled facts from this plan's "What gh does" section in three lines (order and stop at first failure; body written only with at least one upload; the orphaned-upload case finds no URL and the next attach uploads again), and add GitHub's 10 MB image cap to step 1. Change nothing outside section 8.
- [ ] **Step 7: Version, floor, reference.** Fetch `origin/main`; set `plugin.json`'s `version` one patch past main's, and `minEngine` in `pack/requires.json` to that same version. Regenerate the reference with `env HOME=<scratch home> bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`. Recompile in scratch and run `env HOME=<scratch home> bun cli.ts skills check --pack-dir plugins/mattstack --strict`. Expected: PASS.
- [ ] **Step 8: Verify** from the worktree root: `bun test` on every test file touched in Tasks 1 to 3, `bun run typecheck`, `bun run purity`, `bun run docs:check`. Expected: all PASS.
- [ ] **Step 9: Commit** `mattstack: GitHub evidence goes through the boards gate and evidence_attach; engine floor rises`, staging the block, the reference, `plugin.json`, `requires.json`, the rules file and the spec by name.

Open the PR after the final whole-branch review: push with `git_push`, then `gh pr create` to `main`. The body says plainly that the engine floor rises, so Macs on an older app hold the plugin until they update. Wait for CodeRabbit and CI, fix what they find, re-check the plugin version against main right before reporting, and never merge.
