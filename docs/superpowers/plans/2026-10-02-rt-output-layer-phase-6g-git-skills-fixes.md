# rt Output Layer, Phase 6g (git and skills fixes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The follow-ups Matt folded into phase 6 that live in the git and skills code: a conflicted `git stash pop` reported as kept by git-core itself; no shell strings in `lib/git-backup.ts` and `lib/git-ops.ts`; remotes carrying a credential in a query string printed as `REMOTE`, with one token detector instead of two; `rt git tag push --json` no longer echoing a raw token (Matt's Ruling 2: the envelope names the remote through `printable`); `rt skills init` keeping the daemon's `next` when a step throws; plain titles in `skills link`, `skills expand` and `skills init`; a missing Claude Code drawn the same way by `skills sync` and `skills init`; `skills surface apply` printing in one call; the rebase conflict file list under a caption; and the "rt did not make it" phrase at the two skills sites. No allowlist lines (these files left it in phase 5).

**Architecture:** Each item is a small, test-first change in the file that owns it. Two touch shared shapes and say so: `GitClient.stashPop` returns `{ kept: boolean }` (one fake in `lib/mission/__tests__/driver.test.ts` follows), and the init outcome's failure branch gains optional `why` and `next` (not serialized into any `--json`). Nothing changes a `--json` value except Task 4's, which Matt ruled (scoping, Ruling 2): `tag push --json`'s `remote` carries `printable(remote)`, same key, type and order.

**Tech Stack:** Bun + TypeScript, `bun:test`, git sandboxes (`packages/git-core/test-support/sandbox.ts`), Fast Browser.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (RT-369), "Rules", "Copy style". **Scoping:** `docs/superpowers/plans/2026-10-02-rt-output-layer-phase-6-scoping.md`, section 2 (Form 1, Form 2, Form 3 rows for 6g), Ruling 2, shared items 5 and 6. House style: the 5f2 chat plan.

**Size:** about 1,700 changed lines. One PR.

**What was run while writing this plan:** nothing was compiled. Written against `origin/main` at `658e704b9`.

## Global Constraints

- Never use em dashes or en dashes anywhere. Never write the phrase banned under the second heading of `~/.claude/rules/no-em-dashes.md`.
- Comments state only a constraint the code cannot show.
- `--json` keeps its shape everywhere. One value changes, by Matt's ruling (scoping, Ruling 2, 2026-10-02): `rt git tag push --json`'s `remote` becomes `printable(remote)`, with the same key, type and key order (Task 4).
- Exit codes do not change.
- Coral only for failures; a missing Claude Code is `needs-you` (something only the person can do), never coral and never `refused`.
- Copy to "you", plainly; no paths or flags in titles; commands in a `next` callout. The phrase for something rt will not touch because it did not create it: **rt did not make it, so rt left it alone**, worded to fit (scoping section 2).
- Run `bun test` only from the repo root. Never run a built `rt` outside an isolated HOME. Git tests use the sandbox helpers, never a real repo.
- Git commands plain and alone from the worktree root. Never `git add -A`, `.` or `-u`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Files this slice must not edit: every file another phase 6 slice owns (`lib/repo-index.ts` included: this slice stops calling `healErrorClause`, 6k deletes it); `lib/ui/**`; `packages/rt-client/**`; `apps/gitq/**` (its own `GitShell.stashPop` is separate).
- UI validation is mandatory (Task 11).

## Review Focus

1. **A branch or remote name a shell would read.** `deleteBackup` with a ref holding `$(...)`, and `getRemoteDefaultBranch` with a remote named `x;touch <file>` or `--upload-pack=<cmd>`, must run no shell and no option. Pinned in Task 2 (`a backup ref with shell syntax is passed as one argument`, `a remote that looks like an option is refused before git runs`, `a remote with shell syntax runs no shell`).
2. **`git stash pop` that conflicts.** The stash is kept, git-core says `kept: true`, and `rt git stash pop` says the files conflict and the stash was kept; `--json` stays `{ ok: true, index }`. Pinned in Task 1 (`a conflicting pop reports kept and leaves the stash`) and the existing `commands/git/__tests__/mutate.test.ts` cases.
3. **A remote URL with `?private_token=...` passed to `rt git pull`, `push` or `tag push`.** It prints as `REMOTE`. Pinned in Task 3 (`a remote carrying a credential in its query prints as REMOTE`).
4. **`rt skills init` when the daemon cannot add the repo to its list.** The failure carries the daemon's own `next`, not the generic materialize command. Pinned in Task 5 (`a step that throws keeps the error's why and next`).
5. **A rebase that stops on conflicts in many files.** The files sit under a caption, below the failure, never flush left; the backup branch is in the failure's `why`. Pinned in Task 9 (`a conflict failure lists its files under a caption`).

## Readers

| Reader | Reads | After |
|---|---|---|
| `lib/mcp/git-tools.ts` (`branch_sync`) | `rt sync --json --no-agent`: exit code, envelope, the last three stderr lines when the envelope has no `error` | the conflict path is the bundle (exit 3), unchanged; the failure's stderr under `--json` goes through `compactFailure`, which drops details and keeps title, hint, why, next: the backup moves into `why`, so it now reaches that tail (Task 9 notes it) |
| `plugins/mattstack/attachments/forge/rebase-worktree/SKILL.md:257` | quotes `rt sync refused (exit 4): ...` | exit 4 is the stack refusal, untouched |
| `rt git tag push --json` | nothing reads it: no skill, plugin, MCP tool, tray model, script or e2e test parses it, the verb is not agent-safe so `rt_verb` cannot run it, and only `commands/git/__tests__/mutate*.test.ts` assert it (scoping, Ruling 2) | `remote` is `printable(remote)`; pinned in Task 4 |
| `skills/rt-*`, `plugins/mattstack` | `rt skills init --json`, `rt skills sync --json` | envelopes unchanged |
| `rt skills link --json` `actions[].detail` | nothing parses it: the tray, skills, MCP tools and e2e read `kind` and `name`, never `detail` (a human sentence inside the envelope, cross-phase ruling 1) | the conflict detail takes the new words; pinned in Task 7 |

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/git-core/src/stash.ts`, `types.ts`; `packages/git-core/src/__tests__/stash-mutations.test.ts` | `stashPop` returns `{ kept }` | 1 |
| `commands/git/mutate.ts`, `commands/git/__tests__/mutate.test.ts`; `lib/mission/__tests__/driver.test.ts` | the caller and the one fake | 1 |
| `lib/git-backup.ts`, `lib/git-ops.ts`, `lib/__tests__/git-ops.test.ts`, `commands/git/__tests__/backup.test.ts` | argv, never a shell | 2 |
| `lib/team/redact.ts`, `commands/git/shared.ts`, `commands/git/__tests__/shared.test.ts`, `lib/team/__tests__/redact.test.ts` | one token detector; query credentials | 3 |
| `commands/git/mutate.ts` (tag push) | Ruling 2 | 4 |
| `lib/skills/init.ts`, `commands/skills-init.ts`, `lib/skills/__tests__/init.test.ts`, `commands/__tests__/skills-init.test.ts` | `why`/`next` kept; titles; compile failure; the repo-list failure | 5, 6 |
| `commands/skills-link.ts`, `lib/skills/link.ts`, `commands/skills-expand.ts` and their tests | titles; the "not ours" phrase | 7 |
| `commands/skills-sync.ts`, `commands/skills.ts` and their tests | missing Claude; surface apply in one call | 8 |
| `commands/git/rebase.ts`, `commands/git/shared.ts` (`drawFailure`), `commands/sync.ts`, `lib/rebase-escalation.ts` and their tests | conflict files under a caption | 9 |

---

### Task 0: Confirm the base

- [ ] **Step 1:** `git fetch origin`; `git rebase origin/main`.
- [ ] **Step 2:** Run `bun test packages/git-core/src/__tests__/stash-mutations.test.ts commands/git/__tests__ lib/__tests__/git-ops.test.ts lib/team/__tests__/redact.test.ts lib/skills/__tests__/init.test.ts lib/skills/__tests__/link.test.ts commands/__tests__/skills-init.test.ts commands/__tests__/skills-link.test.ts commands/__tests__/skills-expand.test.ts commands/__tests__/skills-sync.test.ts commands/__tests__/sync-output.test.ts lib/__tests__/rebase-escalation.test.ts lib/mission`. PASS, or **stop** and report: a failure here is not this slice's.
- [ ] **Step 3:** Run `grep -n "export function healErrorClause" lib/repo-index.ts` (one line: 6g stops calling it, 6k deletes it) and `grep -n "export function printable" commands/git/shared.ts` (one line, for Task 4). Either empty: stop and report.

---

### Task 1: `stashPop` says whether git kept the stash

**Interfaces:**
- Changes: `GitClient.stashPop(index: number): Promise<{ kept: boolean }>` (was `Promise<void>`).

- [ ] **Step 1: Failing test** (append to `packages/git-core/src/__tests__/stash-mutations.test.ts`):

```ts
describe("stashPop on a conflict", () => {
  it("a conflicting pop reports kept and leaves the stash", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await sb.write("a.txt", "stashed\n");
      await client.stashPush({ message: "mine" });
      await sb.write("a.txt", "committed\n");
      await sb.commitAll("theirs");
      expect(await client.stashPop(0)).toEqual({ kept: true });
      expect((await client.stashes()).length).toBe(1);
      expect(await Bun.file(`${sb.dir}/a.txt`).text()).toContain("<<<<<<<");
    } finally {
      await sb.cleanup();
    }
  });

  it("a clean pop reports not kept", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await sb.write("a.txt", "two\n");
      await client.stashPush({ message: "x" });
      expect(await client.stashPop(0)).toEqual({ kept: false });
    } finally {
      await sb.cleanup();
    }
  });
});
```

If `git stash pop` on a conflict makes `ctx.git.stash` throw in this sandbox (simple-git treats some non-zero exits as errors), the first test fails with that throw; the implementation below then catches a throw whose message carries `CONFLICT` and still counts.

- [ ] **Step 2:** `bun test packages/git-core/src/__tests__/stash-mutations.test.ts`: FAIL (`undefined` is not `{ kept: true }`).
- [ ] **Step 3: Implement** (`packages/git-core/src/stash.ts`):

```ts
/** A pop that conflicts leaves the stash in place, and git exits without an error simple-git treats as one. */
export async function stashPop(ctx: ClientContext, index: number): Promise<{ kept: boolean }> {
  const before = (await ctx.git.stashList()).total;
  try {
    await ctx.git.stash(["pop", `stash@{${index}}`]);
  } catch (err) {
    if (!/CONFLICT/.test(err instanceof Error ? err.message : String(err))) throw err;
  }
  const after = (await ctx.git.stashList()).total;
  return { kept: after === before };
}
```

`types.ts`: `stashPop(index: number): Promise<{ kept: boolean }>;`. `client.ts` already forwards the return.

In `commands/git/mutate.ts`'s `stashPopCommand`, replace the counting with the result:

```ts
  let kept = false;
  try {
    kept = (await client.stashPop(index)).kept;
  } catch (err) {
    failPlain(json, "Could not bring that stash back", errText(err));
  }
```

and delete the comment about counting. `lib/mission/__tests__/driver.test.ts:190`: `stashPop: async () => ({ kept: false }),`.

- [ ] **Step 4:** Run `bun test packages/git-core commands/git/__tests__/mutate.test.ts commands/git/__tests__/mutate-json.test.ts lib/mission`. PASS; `bun run typecheck` clean (any other `GitClient` fake the compiler names gets `({ kept: false })`).
- [ ] **Step 5:** Commit, message `git-core: stashPop reports whether a conflicting pop kept the stash`.

---

### Task 2: argv, never a shell, in `lib/git-backup.ts` and `lib/git-ops.ts`

- [ ] **Step 1: Failing tests.**

Append to `lib/__tests__/git-ops.test.ts` (it builds temp repos; reuse its helper for a repo with a remote):

```ts
import { existsSync } from "fs";

test("a remote that looks like an option is refused before git runs", () => {
  const repo = makeRepo();
  const marker = join(repo, "upload-pack-ran");
  expect(getRemoteDefaultBranch(repo, `--upload-pack=touch ${marker}`, { preferRemote: true })).toBeNull();
  expect(existsSync(marker)).toBe(false);
});

test("a remote with shell syntax runs no shell", () => {
  const repo = makeRepo();
  const marker = join(repo, "pwned");
  getRemoteDefaultBranch(repo, `x;touch ${marker}`, { preferRemote: true });
  expect(existsSync(marker)).toBe(false);
});
```

(`makeRepo()` is the file's own helper, `lib/__tests__/git-ops.test.ts:11`. The marker sits inside the temp repo, so a run that did reach git writes nothing outside it; today `git ls-remote --symref --upload-pack=touch <marker> HEAD` runs the command, so the first test fails on the marker.) Append to `commands/git/__tests__/backup.test.ts` (it already has `repo` from `makeRepo(root)` in `commands/git/__tests__/helpers.ts`; import `deleteBackup` from `../../../lib/git-backup.ts` and `existsSync` from `fs`):

```ts
test("a backup ref with shell syntax is passed as one argument", () => {
  const marker = join(repo, "pwned");
  expect(() => deleteBackup(`rt-backup/x/$(touch ${marker})`, repo)).toThrow();
  expect(existsSync(marker)).toBe(false);
});
```

(`git branch -D` on a missing ref throws, which is the point: no shell ran.)

Add a source guard to `lib/__tests__/git-ops.test.ts`:

```ts
test("git-ops and git-backup call git with argv only", () => {
  for (const f of ["git-ops.ts", "git-backup.ts"]) {
    expect(readFileSync(join(import.meta.dir, "..", f), "utf8")).not.toMatch(/\bexecSync\(/);
  }
});
```

- [ ] **Step 2:** Run both files: FAIL (the shell runs `touch`; `execSync(` is present).
- [ ] **Step 3: Implement.** In `lib/git-ops.ts` (import `execFileSync` only):

```ts
const GIT_OPTS = { encoding: "utf8" as const, stdio: "pipe" as const };

export function getCurrentBranch(cwd: string): string | null {
  try {
    return execFileSync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd, ...GIT_OPTS }).trim() || null;
  } catch {
    return null;
  }
}
```

and the same shape for `hasUncommittedChanges` (`["status", "--porcelain"]`), `localDefaultBranchSymref` (`["symbolic-ref", "--quiet", "--short", \`refs/remotes/${remote}/HEAD\`]`), `remoteDefaultBranchSymref` (`["ls-remote", "--symref", remote, "HEAD"]`, keeping `timeout: 5000`), and the fallback probe (`["rev-parse", "--verify", candidate]`). At the top of `getRemoteDefaultBranch`:

```ts
  // git reads a leading dash as an option, whatever argv position it is in.
  if (remote.startsWith("-")) return null;
```

In `lib/git-backup.ts`: `listBackups` passes `["branch", "--list", \`${BACKUP_PREFIX}*\`, "--format=%(refname:short)\t%(objectname:short)", "--sort=-committerdate"]` (the `\t` is a real tab in the JS string, as the shell string gave git); `deleteBackup` passes `["branch", "-D", backupRef]`; the `symbolic-ref` read at line 127 passes argv. Drop `execSync` from both imports.

- [ ] **Step 4:** Run `bun test lib/__tests__/git-ops.test.ts commands/git/__tests__/backup.test.ts commands/git/__tests__/rebase.test.ts commands/git/__tests__/reset.test.ts commands/__tests__/sync-output.test.ts lib/mission`. PASS.
- [ ] **Step 5:** Commit, message `git-ops, git-backup: call git with argv; a remote that looks like an option is refused`.

---

### Task 3: One token detector; query-string credentials print as `REMOTE`

**Interfaces:**
- Produces: `holdsCredentialToken(text: string): boolean` exported from `lib/team/redact.ts`.

- [ ] **Step 1: Failing tests.** In `commands/git/__tests__/shared.test.ts`:

```ts
test("a remote carrying a credential in its query prints as REMOTE", () => {
  expect(printable("https://gitlab.example.com/acme/app.git?private_token=abc123")).toBe("REMOTE");
  expect(printable("https://gitlab.example.com/acme/app.git?ref=main")).toBe("https://gitlab.example.com/acme/app.git?ref=main");
});

test("printable and the team redactor agree on token shapes", () => {
  for (const t of ["ghp_abcdefABCDEF123456", "glpat-abcdefABCDEF123456", "xoxb-1234-abcd", "sk-ant-abcdefABCDEF"]) {
    expect(printable(`https://host/${t}/repo.git`)).toBe("REMOTE");
    expect(holdsCredentialToken(t)).toBe(true);
  }
  expect(holdsCredentialToken("origin")).toBe(false);
});
```

(import `holdsCredentialToken` from `../../../lib/team/redact.ts`.) And a guard:

```ts
test("commands/git/shared.ts keeps no token pattern of its own", () => {
  expect(readFileSync(join(import.meta.dir, "..", "shared.ts"), "utf8")).not.toContain("ghp_");
});
```

- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement.** In `lib/team/redact.ts`, after `CREDENTIAL_TOKEN_RE`:

```ts
/** Whether text holds a token of a shape rt or a forge issues. */
export function holdsCredentialToken(text: string): boolean {
  return new RegExp(CREDENTIAL_TOKEN_RE.source).test(text);
}
```

(a fresh non-global copy: `.test` on the shared global regex keeps `lastIndex` between calls). In `commands/git/shared.ts`, delete `TOKEN_SHAPE_RE` and its parity comment, import `holdsCredentialToken` from `../../lib/team/redact.ts` and `redactCredentials` from `../../packages/rt-client/src/redact.ts`, and end `printable` with:

```ts
  return holdsCredentialToken(shown) || redactCredentials(shown) !== shown ? "REMOTE" : shown;
```

(`redactCredentials` changes a string only where it finds userinfo, a credential query parameter, a token shape, an auth header or a secret assignment, so a clean remote comes back unchanged.)

- [ ] **Step 4:** Run `bun test commands/git/__tests__ lib/team/__tests__/redact.test.ts`. PASS.
- [ ] **Step 5:** Commit, message `git: one token detector shared with the team redactor; a credential in a remote's query prints as REMOTE`.

---

### Task 4: `rt git tag push --json` names the remote through `printable` (Matt's Ruling 2)

Matt ruled this on 2026-10-02 (scoping, Ruling 2). Nothing reads the envelope (the Readers table above), so the change breaks no caller; the test pins the whole envelope, bytes and key order included.

- [ ] **Step 1: Failing test** (append to `commands/git/__tests__/mutate-json.test.ts`):

```ts
import { tagPushEnvelope } from "../mutate.ts";
import { printable } from "../shared.ts";

test("tag push --json names the remote as printable shows it", () => {
  const credentialed = "https://user:secret@gitlab.example.com/acme/app.git";
  expect(tagPushEnvelope("v1", credentialed)).toEqual({ ok: true, name: "v1", remote: printable(credentialed) });
  expect(JSON.stringify(tagPushEnvelope("v1", credentialed))).not.toContain("secret");
  expect(tagPushEnvelope("v1", "origin")).toEqual({ ok: true, name: "v1", remote: "origin" });
  expect(JSON.stringify(tagPushEnvelope("v1", "origin"))).toBe('{"ok":true,"name":"v1","remote":"origin"}');
  expect(JSON.stringify(tagPushEnvelope("v1", credentialed))).toBe(`{"ok":true,"name":"v1","remote":${JSON.stringify(printable(credentialed))}}`);
});
```

- [ ] **Step 2:** Run: FAIL (`tagPushEnvelope` is not exported).
- [ ] **Step 3:** In `commands/git/mutate.ts`:

```ts
export function tagPushEnvelope(name: string, remote: string): { ok: true; name: string; remote: string } {
  return { ok: true, name, remote: printable(remote) };
}
```

and in `tagPushCommand`, `if (json) out.json(tagPushEnvelope(name, remote));`. The key order (`ok`, `name`, `remote`) is today's.

- [ ] **Step 4:** Run the file: PASS.
- [ ] **Step 5:** Commit, message `git tag push: --json names the remote without its credential (Matt's ruling)`.

---

### Task 5: `rt skills init` keeps a thrown error's `why` and `next`

**Interfaces:**
- Changes: `InitOutcome`'s failure branch becomes `{ ok: false; refused: false; code: FailureCode; detail: string; wrote: string[]; remedy?: InitRemedy; why?: string; next?: string }`.

- [ ] **Step 1: Failing tests.** In `lib/skills/__tests__/init.test.ts` (it builds `InitDeps` fakes), add:

```ts
test("a step that throws keeps the error's why and next", async () => {
  const { deps } = world({
    registerRepo: async () => {
      throw new UserActionableError("locate-failed", "rt could not add this repo to its list", {}, { why: "The rt daemon is not running.", next: "rt daemon start" });
    },
  });
  const out = await initPack({ repoDir: REPO, zone: null }, deps);
  expect(out).toMatchObject({ ok: false, refused: false, why: "The rt daemon is not running.", next: "rt daemon start" });
});
```

(`world(overrides)` is the file's builder of a passing `InitDeps` (`lib/skills/__tests__/init.test.ts:235`), and `REPO` its repo path; `initPack` takes `zone: null` as every other case does. Import `UserActionableError` from `../../errors.ts`. If `registerRepo` runs inside a step whose code is not the one `attempt` wraps, put the throw on the dep that `attempt` wraps first and name it in the ledger.) In `commands/__tests__/skills-init.test.ts`:

```ts
test("the failure prefers the error's next to the generic remedy", () => {
  const f = initFailure({ ok: false, refused: false, code: "materialize-failed", detail: "rt could not add this repo to its list", wrote: [], remedy: { commands: ["rt skills materialize --dir /code/x"] }, why: "The rt daemon is not running.", next: "rt daemon start" });
  expect(f).toMatchObject({ title: "rt could not add this repo to its list", why: "The rt daemon is not running.", next: ui.cmd("rt daemon start") });
});
```

- [ ] **Step 2:** Run both: FAIL.
- [ ] **Step 3: Implement.** In `lib/skills/init.ts`:

```ts
  const failed = (code: FailureCode, detail: string, from?: { why?: string; next?: string }): InitOutcome => ({
    ok: false, refused: false, code, detail, wrote, remedy: remedyFor(code),
    ...(from?.why ? { why: from.why } : {}),
    ...(from?.next ? { next: from.next } : {}),
  });

  const attempt = async <T>(code: FailureCode, fn: () => Promise<T>): Promise<{ value: T } | { outcome: InitOutcome }> => {
    try {
      return { value: await fn() };
    } catch (err) {
      if (err instanceof UserActionableError) {
        logFailureDetail(err);
        return { outcome: failed(code, err.message, { why: err.why, next: err.next }) };
      }
      return { outcome: failed(code, err instanceof Error ? err.message : String(err)) };
    }
  };
```

(import `UserActionableError` and `logFailureDetail` from `../errors.ts`; the error's `log` reaches the CLI log, as every flattened `UserActionableError` must, cross-phase ruling 12). In `commands/skills-init.ts`'s `initFailure`, for the failure branch: `...(o.why ? { why: o.why } : {})` and `next: o.next ? ui.cmd(o.next) : (o.remedy ? remedyCell(o.remedy) : <today's default>)`. `repoListFailure` stops calling `healErrorClause`:

```ts
export function repoListFailure(dir: string, indexed: Omit<Extract<IndexHealResult, { ok: false }>, "ok">): UserActionableError {
  return new UserActionableError("locate-failed", "rt could not add this repo to its list", {}, {
    why: indexed.why ?? indexed.error,
    ...(indexed.next ? { next: indexed.next } : {}),
    log: `${dir}: ${indexed.error}`,
  });
}
```

(drop `healErrorClause` from the import). The `--json` failure envelope (`userErrorPayload(new UserActionableError(out.code, out.detail, { refused: false, wrote: out.wrote }))`) is unchanged: `why` and `next` are not passed into it.

- [ ] **Step 4:** Run `bun test lib/skills/__tests__/init.test.ts commands/__tests__/skills-init.test.ts`. PASS.
- [ ] **Step 5:** Commit, message `skills init: a step that throws keeps the error's why and next; the repo-list failure reads as two sentences`.

---

### Task 6: `rt skills init` titles and the compile failure

- [ ] **Step 1: Failing tests** (append to `commands/__tests__/skills-init.test.ts`):

```ts
test("a compile failure is one title and its next, then every error under a caption", () => {
  const o = { ok: false, refused: false, code: "compile-failed", detail: "skills/a: missing title\nskills/b: bad slot", wrote: [], remedy: { commands: ["rt skills compile --pack-dir /p"] } } as const;
  const f = initFailure(o);
  expect(f.title).toBe("The new pack did not compile");
  expect(f.details).toBeUndefined();
  const io = captureOut();
  io.reset();
  ui.__test__.setHuman(() => false);
  try {
    ui.fail(f, ...initFailureAfter(o));
    const err = io.stderr();
    const at = (s: string) => err.indexOf(s);
    expect(at("The new pack did not compile")).toBe(0);
    expect(at("next: Run rt skills compile --pack-dir /p")).toBeGreaterThan(0);
    expect(at("what did not compile")).toBeGreaterThan(at("next: Run rt skills compile --pack-dir /p"));
    expect(at("skills/a: missing title")).toBeGreaterThan(at("what did not compile"));
    expect(at("skills/b: bad slot")).toBeGreaterThan(at("skills/a: missing title"));
  } finally {
    io.restore();
  }
});
```

And in `lib/skills/__tests__/init.test.ts`, the not-a-repo and invalid-namespace refusals' `detail` no longer start with a path or name a config file:

```ts
test("refusal titles name no path or config file", async () => {
  const notRepo = await initPack({ repoDir: REPO, zone: null }, world({ gitRemote: async () => ({ kind: "not-a-repo" }) }).deps);
  expect(notRepo).toMatchObject({ refused: true, detail: "This folder is not a git repo" });
});
```

(and the invalid-namespace case through the zone fake the file uses: `detail` equals `The <zone> zone's name cannot be a pack name`).

- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement.** `lib/skills/init.ts`: `refuse("not-a-repo", "This folder is not a git repo")`; `refuse("no-remote", "This repo has no git remote", "git remote add origin <url>")`; `refuse("invalid-namespace", \`The ${zone.slug} zone's name cannot be a pack name\`, undefined)` with the detail's reason moved to a new optional `why` on the refused branch: `{ ok: false; refused: true; code; detail; next?; why?: string }`, set to `Pack names use lowercase letters, digits and dashes; this one is ${pack}.`; `commands/skills-init.ts`'s `initFailure` and `initRefusalBlocks` carry `why` (`ui.callout("why", o.why)` after the line for a refusal). In `initFailure`, for `compile-failed`:

```ts
  if (o.code === "compile-failed") {
    return { title: "The new pack did not compile", ...(o.why ? { why: o.why } : {}), next: o.next ? ui.cmd(o.next) : o.remedy ? remedyCell(o.remedy) : ["Fix it, then run ", ui.cmd("rt skills compile"), " and ", ui.cmd("rt skills check")] };
  }
```

and, beside it, the blocks drawn after the failure:

```ts
export function initFailureAfter(o: Extract<InitOutcome, { ok: false }>): Block[] {
  if (o.code !== "compile-failed") return [];
  const lines = [...o.detail.split("\n"), ...(o.remedy?.folder ? [`Pack folder: ${o.remedy.folder}`] : []), ...(o.wrote.length > 0 ? ["Written so far:", ...o.wrote] : [])];
  return [ui.verbatim(lines, "what did not compile")];
}
```

The caller becomes `ui.fail(initFailure(out), ...initFailureAfter(out))` (`commands/skills-init.ts:244`). (`ui.verbatim` takes `string[]`, `lib/ui/out.ts:87`.) Three existing `commands/__tests__/skills-init.test.ts` cases pin the old compile-failed shape and change on purpose: `a failure names each command of its remedy, then what was written` (`:65-77`) now expects `"The new pack did not compile\n  next: Run rt skills compile --pack-dir /z/mattstack/packs/acme, then rt skills check --pack-dir /z/mattstack/packs/acme\n"` from `initFailure`, and `initFailureAfter` to equal `[ui.verbatim(["boom", "Written so far:", "/a", "/b"], "what did not compile")]`; `a multi-line detail keeps each line` (`:79-91`) expects `"The new pack did not compile\n  next: Run rt skills compile --pack-dir /z/p\n"` and `[ui.verbatim(["stubs.jsonc: unknown slot review", "skills.jsonc: duplicate name work", "Written so far:", "/a"], "what did not compile")]`; `with no remedy, the next step is the general one` (`:106-110`) expects `"The new pack did not compile\n  next: Fix it, then run rt skills compile and rt skills check\n"`. The write-failed case (`:93-104`) keeps its details and does not move. Both renderers draw a failure's `next` before anything after it, so the errors read below the command that fixes them, as Task 11's AGENTS rule says. (`Block` from `../lib/ui/protocol.ts`; `captureOut` from `../../lib/ui/__tests__/capture-out.ts` in the test.)

The `--json` refusal envelope's message (`out.detail`, with `. Run <next>` appended) takes the new words: a human sentence inside the envelope (cross-phase ruling 1); `code` and `refused` are unchanged.

- [ ] **Step 4:** Run both files: PASS.
- [ ] **Step 5:** Commit, message `skills init: titles without paths, and a compile failure lists every error under one title`.

---

### Task 7: `skills link` and `skills expand` titles; the "not ours" phrase

- [ ] **Step 1: Failing tests.** In `commands/__tests__/skills-link.test.ts`: `--from` with no value fails with title `Which folder should the links come from?` and `next: rt skills link --from <folder>`; an unknown option fails with title `rt skills link does not take that option` and hint the option; a conflict row's hint reads `left alone: a file or folder already has this name, and rt did not make it` (the row's word is already `left alone`, `commands/skills-link.ts:33`, so the detail does not say it again), the `--json` envelope's conflict action has `detail: "a file or folder already has this name, and rt did not make it"` (pinned), and the note reads `rt left those alone. Move or rename them by hand, then run this again.`. In `commands/__tests__/skills-expand.test.ts`: `--src` with no value fails with `usageFailure("Which folder holds the skills to expand?", "rt skills expand --src <dir> --out <dir>")`; `--out` with no value with the out-folder twin; `--mattstack-dir` with no value with `usageFailure("Which mattstack folder?", "rt skills expand --mattstack-dir <dir>")`; an unknown option with title `rt skills expand does not take that option`, hint the option.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement.** `skills-link.ts`'s `fail(title, next?)` gains a `hint` parameter; the two sites by the tests above. `lib/skills/link.ts:126`: `detail: "a file or folder already has this name, and rt did not make it"`. `skills-link.ts:118`'s note by the test. `skills-expand.ts`'s `requireFlagValue(flag, value)` maps the flag to its usage failure:

```ts
const MISSING_VALUE: Record<string, out.FailureInput> = {
  "--src": usageFailure("Which folder holds the skills to expand?", "rt skills expand --src <dir> --out <dir>"),
  "--out": usageFailure("Which folder should the expanded skills go in?", "rt skills expand --src <dir> --out <dir>"),
  "--mattstack-dir": usageFailure("Which mattstack folder?", "rt skills expand --mattstack-dir <dir>"),
};
```

and the default branch `fail({ title: "rt skills expand does not take that option", hint: a })`.

- [ ] **Step 4:** Run `bun test commands/__tests__/skills-link.test.ts commands/__tests__/skills-expand.test.ts lib/skills/__tests__/link.test.ts`. PASS. (`lib/skills/__tests__/link.test.ts` asserts the old conflict `detail` if it reads it; update that one string on purpose.)
- [ ] **Step 5:** Commit, message `skills link, expand: titles without flags; the rt-did-not-make-it phrase`.

---

### Task 8: A missing Claude Code reads the same in `sync` and `init`; `surface apply` prints once

**Interfaces:**
- Produces: `claudeMissingBlocks(): Block[]` exported from `commands/skills-sync.ts`.

- [ ] **Step 1: Failing tests.** In `commands/__tests__/skills-sync.test.ts`:

```ts
test("no Claude Code is a needs-you note, the same one init prints", () => {
  expect(renderPlain(claudeMissingBlocks())).toBe("[needs you] Claude Code is not installed  rt installs and syncs packs through it\n  next: Install Claude Code, then run this again\n");
});
```

plus a case that runs `skillsSync` with deps whose `claudeBin` is `null` (the file builds sync deps; use its builder) and asserts stderr equals `renderPlain(claudeMissingBlocks())`, stdout empty under no `--json`, and the exit code unchanged from today's (read the existing refusal test for it). In `commands/__tests__/skills-init.test.ts`, the `claude-missing` refusal prints the same blocks on stderr (exit code as today). In `commands/__tests__/skills-surface.test.ts`, `surface apply moves print in one call`: with the fake helper of `lib/ui/__tests__/fake-rt-ui.ts` (as 5f2's Task 5 test uses it), a two-move apply records one `render` spawn, not two.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement.**

```ts
export function claudeMissingBlocks(): Block[] {
  return [out.line("needs-you", "Claude Code is not installed", "rt installs and syncs packs through it"), out.callout("next", "Install Claude Code, then run this again")];
}
```

In `skillsSync`, where the human path draws `syncRefusal(report)`: when `deps.claudeBin === null` and the stopping step is `guards`, `out.note(...claudeMissingBlocks())` instead (the `--json` path is unchanged). In `skillsInit`, `else if (out.code === "claude-missing") ui.note(...claudeMissingBlocks())` before the policy-refusal branch. In `commands/skills.ts`'s surface apply, collect the rows into `const blocks: Block[] = []` (each `out.print(out.line(...))` becomes `blocks.push(out.line(...))`, the nothing-to-move line included) and `if (!flags.json && blocks.length > 0) out.print(...blocks);` once, after the loops.
- [ ] **Step 4:** Run the three test files and `commands/__tests__/skills-json-frozen.test.ts`. PASS.
- [ ] **Step 5:** Commit, message `skills: a missing Claude Code reads as needing you in sync and init; surface apply prints once`.

---

### Task 9: The conflict files under a caption

**Interfaces:**
- Produces: `conflictFilesBlock(files: string[]): Block` in `commands/git/rebase.ts`; `drawFailure(f, refused?, after: Block[] = [])` in `commands/git/shared.ts`.

- [ ] **Step 1: Failing tests.** In `commands/git/__tests__/rebase-output.test.ts`:

```ts
test("a conflict failure lists its files under a caption", () => {
  const f = conflictFailure({ unresolvedFiles: ["src/a.ts", "src/b.ts"], backupBranch: "rt-backup/rebase/x/2026" });
  expect(f.details).toBeUndefined();
  expect(f.why).toBe("rt put the branch back the way it was. Your branch as it was is saved as rt-backup/rebase/x/2026.");
  expect(renderPlain([out.failure(f), conflictFilesBlock(["src/a.ts", "src/b.ts"])])).toBe(
    "The rebase stopped on conflicts in 2 files\n  why: rt put the branch back the way it was. Your branch as it was is saved as rt-backup/rebase/x/2026.\nfiles with conflicts:\n  src/a.ts\n  src/b.ts\n",
  );
});
```

(Run `renderPlain` on a `verbatim` with a caption first and use its exact form.) In `lib/__tests__/rebase-escalation.test.ts`, the timeout, gave-up and unfinished failures carry no `details` and are followed by `kv` rows (`pane: <id>`, `backup: <branch>` where present). In `commands/__tests__/sync-output.test.ts`, `branchEnding` of a conflicted branch returns the failure and the files block.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement.** `commands/git/rebase.ts`:

```ts
export function conflictFailure(result: Pick<RebaseResult, "unresolvedFiles" | "backupBranch">): out.FailureInput {
  return {
    title: `The rebase stopped on conflicts in ${plural(result.unresolvedFiles.length, "file")}`,
    why: result.backupBranch ? `${PUT_BACK} Your branch as it was is saved as ${result.backupBranch}.` : PUT_BACK,
  };
}

export function conflictFilesBlock(files: string[]): Block {
  return out.verbatim(files, "files with conflicts");
}
```

`commands/git/shared.ts`: `export function drawFailure(f: out.FailureInput, refused?: boolean, after: Block[] = []): void { if (refused) out.note(...refusalNote(f), ...after); else out.fail(f, ...after); }`. `commands/git/rebase.ts:552`: `if (result.failure) out.fail(result.failure, ...(result.unresolvedFiles.length > 0 ? [conflictFilesBlock(result.unresolvedFiles)] : []));`. `commands/sync.ts`: in `branchEnding` and `reportSync`, when `s.rebaseResult?.status === "conflict" && !s.rebaseResult.rebaseInProgress && s.rebaseResult.unresolvedFiles.length > 0`, pass `[conflictFilesBlock(s.rebaseResult.unresolvedFiles)]` as `after` (under `--json`, `reportSync` keeps passing `compactFailure(failure)` and no `after`, so stderr there is the title, hint, why and next only; the backup now rides in `why`, which `branch_sync` may quote as its error tail: say so in the PR body). `lib/rebase-escalation.ts`: the three failures drop `details` and pass `out.kv("pane", launched.paneId)` and, when `bundle.backupBranch`, `out.kv("backup", bundle.backupBranch)` before `paneTail`'s excerpt; `Undid the rebase`'s hint becomes `your branch as it was is saved as <branch>`.
- [ ] **Step 4:** Run `bun test commands/git/__tests__ commands/__tests__/sync-output.test.ts commands/__tests__/sync-all.test.ts lib/__tests__/rebase-escalation.test.ts`. PASS. Then `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/git-verbs.test.ts`: PASS, or update an assertion that read the old `details` lines and say so in the report.
- [ ] **Step 5:** Commit, message `rebase: conflict files under a caption, the backup branch in why`.

---

### Task 10: Stop calling `healErrorClause` (6g's caller)

Task 5 already removed the call in `commands/skills-init.ts`. Run `grep -n "healErrorClause" commands/skills-init.ts`: no output. Nothing to commit if Task 5 did it; otherwise remove it here and commit `skills init: no healErrorClause`.

---

### Task 11: Renders, AGENTS.md and every gate

- [ ] **Step 1:** `bun run ui:build`. `blocks-6g.ts` in the scratchpad: the conflicted stash pop line, `printable`'s REMOTE in a pushed line, the skills init failure with a daemon `next`, the compile failure, the not-a-repo and invalid-namespace refusals, the link conflict row and its note, the expand usage failure, `claudeMissingBlocks()`, a surface apply with two moves, the conflict failure with its files block, and an escalation timeout with its `pane` and `backup` rows. Copy 5f2's `ansi-page.ts`.
- [ ] **Step 2:** Render at width 100, dark and light.
- [ ] **Step 3:** Screenshot both into `docs/design/output-layer/6g-git-skills-dark.png` and `-light.png`. Write down plainly what reads wrong: the files list sits under its caption on the thin rail; the needs-you line is not coral; no title names a path or a flag. Fix and re-render.
- [ ] **Step 4:** README row: `| \`6g-git-skills-dark.png\`, \`6g-git-skills-light.png\` | phase 6 git and skills fixes: a kept stash, a credentialed remote, skills init's failures and refusals, a link conflict, an expand usage failure, the missing-Claude note, a surface apply, a rebase conflict with its files, an escalation timeout |`.
- [ ] **Step 5:** AGENTS.md (append to "Output layer"):

```markdown
A list that belongs to a failure (the files a rebase stopped on, the lines
a child printed) is a `verbatim` block with a caption passed after the
failure (`out.fail(f, ...after)`), never the failure's `details`, which
is a one-line pointer. Something rt leaves alone because it did not create
it is worded the same everywhere: rt did not make it, so rt left it alone.
```

- [ ] **Step 6:** The eight gates, one at a time. All pass.
- [ ] **Step 7:** Commit, message `docs: git and skills fix renders and the rule for failure lists`.

---

### Task 12: Ship

- [ ] **Step 1:** `git fetch origin`; `git rebase origin/main`; merge `AGENTS.md` and the README by hand.
- [ ] **Step 2:** The eight gates again.
- [ ] **Step 3:** `git diff --shortstat origin/main...HEAD`; about 1,700 lines.
- [ ] **Step 4:** Push with `git_push`; body in `<scratchpad>/pr-body-6g.md` (framing; **git** (stash, argv, tokens, `tag push --json` per Matt's ruling, with its no-readers finding), **skills**, **rebase**; renders; gates; last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`); `gh pr create --repo m4ttstack/mattstack --title "RT-369: output layer phase 6g, git-skills-fixes" --body-file <scratchpad>/pr-body-6g.md`.
- [ ] **Step 5:** Report URL, gates, size, renders. Do not merge.

---

## Decisions this plan made

1. **`GitClient.stashPop` returns `{ kept }`** rather than throwing on a conflict: a conflicting pop is a normal outcome git itself reports, and a throw would turn it into a failure for every caller.
2. **A remote starting with a dash is refused** in `getRemoteDefaultBranch` (returns null, as an unknown remote does) rather than passed after `--`: `git ls-remote` and `rev-parse --verify` do not take `--` the same way.
3. **`printable` defers to `redactCredentials`** for everything beyond the token shapes (query parameters, userinfo, headers), so the two never drift again.
4. **Missing Claude Code is `needs-you`** in both `sync` and `init`; their `--json` (`refused` status, the `claude-missing` code) is unchanged.
5. **`rt sync --json`'s failure stderr now includes the backup branch** (it moved from `details`, which `compactFailure` drops, into `why`). No reader matches on that text.

## Self-Review

**Spec coverage.** Every 6g row of the scoping document's section 2: stash (1), shell strings (2), tokens (3), Ruling 2 (4), skills init (5, 6), titles and the phrase (7), Claude and surface apply (8), rebase lists (9), `healErrorClause` (5, 10).

**Placeholders.** Tests name the file's own helpers to reuse (`seeded`, `makeRepo()` in `lib/__tests__/git-ops.test.ts`, `makeRepo(root, name)` in `commands/git/__tests__/helpers.ts`, `world()` in `lib/skills/__tests__/init.test.ts`, the sync deps builder); each states every assertion.

**Type consistency.** `stashPop` → `{ kept }`, `holdsCredentialToken`, `conflictFilesBlock`, `drawFailure(f, refused, after)`, `claudeMissingBlocks`, the outcome's `why`/`next` match across tasks.

**Review Focus.** Five lines, each pinned by a named test.
