# rt Output Layer, Phase 6h (copy polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The copy and small behavior follow-ups Matt folded into phase 6 in the settings, setup, team, home, repos, port, tools, intercept and worktree code: plain words in `settings list` labels; an unset `settings get` that prints nothing as its value; `rt settings extension` exiting 1 when nothing was installed (Matt's yes, triage Form 1); a header on `rt logins`; an unreadable tool version that no longer reads "older than"; `failCannotAsk` naming worktrees when it means them; `team members remove`'s `next` holding only a command; the `forge-login-unknown` remedy in the right order; "recognize"; the "pid NaN" hint; `repos prune`'s duplicate row naming the kept repo once, and `repos prune` and `missingRepoFailure` printing a `--repo` value `rt repos locate` resolves; `tools install` of a refused bundled link drawn as refused; the "rt did not make it" phrase at three sites; and the dispose sentences parsed next to where they are written. No allowlist lines (these files left it in phase 5).

**Architecture:** One task per area, each test-first in the file that owns it. Three changes reach shared shapes and say so: `InstallResult` gains an optional `reason` that the `--json` envelope never carries (the envelope is built from the old three keys, pinned first); `lib/repo-arg.ts` learns to resolve a repo by its `host/path` label; and a small `lib/worktree/running-run.ts` holds the writer and parser of the `running-run` sentence, so the daemon's detail and the CLI's reading of it live together without the CLI importing the dispose module. No `--json` shape and no exit code changes, except `rt settings extension`'s.

**Tech Stack:** Bun + TypeScript, `bun:test`, Fast Browser.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (RT-369), "Copy style", "Status set", "Rules". **Scoping:** `docs/superpowers/plans/2026-10-02-rt-output-layer-phase-6-scoping.md`, section 2 rows for 6h, shared items 5 and 6. House style: the 5f2 chat plan.

**Size:** about 1,500 changed lines. One PR.

**What was run while writing this plan:** nothing was compiled. Written against `origin/main` at `658e704b9`.

## Global Constraints

- Never use em dashes or en dashes anywhere. Never write the phrase banned under the second heading of `~/.claude/rules/no-em-dashes.md`.
- Comments state only a constraint the code cannot show.
- `--json` keeps its shape: `tools install|setup --json` (the tray's row actions decode `via`, `ok`, `detail`), `settings get --json`, `settings list --json`, `repos prune --json`, `team members remove --json`, `worktree dispose --json` and every other envelope this slice's files print. Human sentences inside setup rows (`detail`, `remedy`) may change words (cross-phase ruling 1); statuses, ids and codes may not.
- Exit codes do not change, except `rt settings extension` (Task 3): 1 when its extension is missing or no selected editor took it (Matt's triage, Form 1).
- Coral only for failures; a refused bundled link and things rt did not make are `refused`.
- Copy to "you", plainly; no paths, store names, flags or ids in sentences; commands in a `next` callout. The phrase: **rt did not make it, so rt left it alone**, worded to fit.
- American spelling: "recognize".
- Run `bun test` only from the repo root. Never run a built `rt` outside an isolated HOME.
- Git commands plain and alone from the worktree root. Never `git add -A`, `.` or `-u`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Files this slice must not edit: every file another phase 6 slice owns (`lib/repo-index.ts` included: this slice stops calling `healErrorClause` in `commands/repos.ts`, 6k deletes it; `commands/sdm.ts` is 6i's); `lib/ui/**`; `rt-tray/**`. `lib/repo.ts` is this slice's (`failCannotAsk`, `missingRepoFailure`); 6f does not edit it, and 6k deletes its `missingRepoRefusal`/`ghostPathRefusal` re-export (`:17`) after both merge.
- **This slice merges before 6f** (scoping, "6h merges before 6f"): 6f routes `rt cd`'s missing-repo refusal through `missingRepoFailure`, which Task 7 fixes.
- UI validation is mandatory (Task 10).

## Review Focus

1. **The tray's Install button for a tool whose bundled link rt refuses** (a user copy sits in the slot). The `--json` envelope stays `{ via, ok, detail }` under the contract; a person at a terminal reads `refused`, not coral. Pinned in Task 4 (`a refused bundled link is a refusal for a person and the same envelope for the tray`).
2. **`rt settings get <unset key>` in a script.** stdout is empty (not `<unset>`), the key row on the human stream says `not set anywhere`, exit 0. Pinned in Task 2 (`an unset key prints no value on stdout`).
3. **`rt repos locate <path> --repo <host/path>`, the command prune now prints.** It resolves to the identity; an ambiguous or unknown label still fails the same way. Pinned in Task 7 (`a host/path label resolves through --repo`).
4. **A tool whose `--version` prints nothing rt can read.** The setup row says rt could not read its version; its status stays `invalid` (the tray reads statuses). Pinned in Task 4 (`an unreadable version says so, with the status unchanged`).
5. **`rt settings extension` with no editor taking the extension.** Exit 1, with each editor's failure shown. Pinned in Task 3 (`nothing installed exits 1`).

## Readers

| Reader | Reads | After |
|---|---|---|
| `rt-tray/Sources-core/Readiness/RowActionDispatcher.swift:48,51` | `tools install <tool> --json` envelope | unchanged keys and values |
| `rt-tray` setup rows | `rt setup plan --json` row `detail` / `remedy` (tools validator, team join step) | words change, statuses do not |
| scripts reading `rt settings get <key>` | stdout as the value | an unset key now prints nothing instead of `<unset>`; the repo's readers all pass `--json` (`rt-tray/vm/run/**`, `plugins/herdr-chat/src/deck.rs:51`, `rt_verb`) |
| `e2e/tests/settings.test.ts` | `settings list` / `get` plain text | asserts none of the changed strings (no `<unset>` or bracketed label in it): unchanged |
| `rt repos register --json`'s `error.message` on a failed move | nothing parses it: the tray, skills and MCP tools name `rt repos register` only in their own sentences | a human sentence inside the envelope (2026-10-01 ruling), reworded in Task 7 |

## Copy table

| Site | Today | After |
|---|---|---|
| `commands/settings-keys.ts:465` | `expandError: <e>` | `a variable in it could not be filled: <e>` |
| `:466` | `invalid[<scope>]: <reason>` | `<SCOPE_WORDS[scope]> has a value that is not valid: <reason>` |
| `:467` | `nonconforming[<scope>]: <issue>` | `<SCOPE_WORDS[scope]> has a value of the wrong shape: <issue>` |
| `:468` | `merged: <issue>` | `the combined value has a problem: <issue>` |
| `:469` | `diverged[<scope>]: <store names>` | `<SCOPE_WORDS[scope]> holds two copies that disagree` |
| `:229` `settings get`, unset | stdout `<unset>` | stdout nothing; the key row (provenance `not set anywhere`) on the human stream says it |
| `commands/extension.ts:183` | failure, exit 0 | the same failure, exit 1 |
| `commands/extension.ts` `installInto`, none installed | exit 0 | exit 1 |
| `commands/logins.ts:94` | headerless table | `table(rows, ["Login page", "Signed in as"])` |
| `lib/setup/validators/tools.ts:117,522`, version unreadable | `<name> is older than <floor>` | `rt could not read <name>'s version (it needs <floor> or newer)`; a read version keeps `<name> <version> is older than <floor>` |
| `lib/repo.ts:45-52` `failCannotAsk` (and `missingRepoFailure` at `:34`, Task 7) | why `rt knows more than one repo ...` at both call sites | `failCannotAsk("repo" \| "worktree")`: why `rt knows more than one <repo \| worktree> and cannot ask which one you mean without a terminal.` (the worktree site at `:312`) |
| `commands/team.ts:313` (`membersRemoveBlocks`, `:307`) | `next` holding the residue sentence and the command | `callout("note", <residue sentence>)`, then `callout("next", cmd("rt secrets rotate --team <slug> <domain> <key>"))` |
| `commands/team.ts:245` | `... ended in a way rt does not recognise` | `... ended in a way rt does not recognize` |
| `commands/home.ts:414,431` | `a key rt does not recognise` | `a key rt does not recognize` |
| `lib/team/join.ts:565-568` `forge-login-unknown` | why `Sign in to the <cli> command line tool, then join again.`, next `<cli> auth login` (setup remedy reads `Sign in ..., then join again. Run <cli> auth login`) | why `rt reads your username from the <cli> command line tool, which is not signed in. The invite still works once you are.`, next `<cli> auth login` |
| `commands/port.ts:136` | hint `pid <pid>, port <port>` even when `pid` is not a number | hint `port <port>` when `pid` is not a positive whole number |
| `commands/repos.ts:216-235` duplicate row | hint `<path> · same folder as <kept> ; carried N files to <kept>; moved its worktrees to <kept>` | `<path> · same folder as <kept>; carried N files there; moved its worktrees there` (`merged its worktrees into that one's`, `that one's worktrees could not be written, so both were kept`) |
| `commands/repos.ts:253` | next `<hint> <new-path> --repo <wire identity>` | `--repo <repoLabelFull(identity)>` (the `host/path` form, which Task 7 teaches `--repo` to resolve) |
| `lib/repo.ts:34` `missingRepoFailure` | next `rt repos locate <new-path> --repo <wire identity>` | `--repo <repoLabelFull(r.repoName)>`; a plain-name row prints its name as today |
| `commands/repos.ts:163` | `rt could not move <name> to <path>: <healErrorClause(error)>` | message `rt could not move this repo's records`, why `indexed.why` or today's fallback sentence, `log: <name> to <path>: <error>`; the `--json` envelope's `error.message` takes the new title (code unchanged) |
| `lib/setup/tools-install.ts`, `commands/tools.ts:86` bundled link refused | `out.fail({ title: "<tool> was not installed", why: <detail> })` | refusals (`user-copy`, `dev-mode-owns-rt`, `occupied`): `out.note(out.line("refused", "rt left your <tool> alone", <detail>))`, exit 1 as today, under `--json` too (stderr); `no-bundle` stays a failure |
| `commands/intercept.ts:295` | `refused`, `Left alone, because rt did not make them` | `refused`, `rt did not make these, so rt left them alone` |
| `commands/worktree.ts:428` | `rt did not make it, so rt does not remove it` | `rt did not make it, so rt left it alone` |
| `lib/setup/steps/index.ts:31` | log `not ours, left alone: <names>` | `rt did not make these, so rt left them alone: <names>` |

Every command named above exists in `lib/command-tree-def.ts`; `<cli> auth login` is `gh` or `glab`'s.

## File Structure

| File | Task |
|---|---|
| `commands/settings-keys.ts`, `commands/__tests__/settings-keys-render.test.ts`, `commands/__tests__/settings-get.test.ts` (or the file that tests `settingsGet`) | 2 |
| `commands/extension.ts`, `commands/__tests__/extension-install.test.ts`, `extension-output.test.ts` | 3 |
| `commands/logins.ts`, `lib/setup/validators/tools.ts`, `lib/setup/tools-install.ts`, `commands/tools.ts` and their tests; `commands/__tests__/__snapshots__/setup-copy.test.ts.snap` | 4 |
| `lib/repo.ts`, `lib/__tests__/repo-index-missing.test.ts`, `lib/__tests__/repo.test.ts` | 5, 7 |
| `commands/team.ts`, `lib/team/join.ts`, `commands/home.ts`, `commands/__tests__/team-blocks.test.ts`, `lib/team/__tests__/join.test.ts` | 6 |
| `commands/repos.ts`, `lib/repo-arg.ts`, `commands/__tests__/repos.test.ts`, `lib/__tests__/repo-arg-resolution.test.ts` | 7 |
| `commands/port.ts`, `commands/__tests__/port.test.ts` | 8 |
| `commands/intercept.ts`, `commands/worktree.ts`, `lib/setup/steps/index.ts`, `lib/worktree/dispose.ts`, `lib/worktree/running-run.ts` (create) and their tests | 9 |

---

### Task 1: Confirm the base

- [ ] **Step 1:** `git fetch origin`; `git rebase origin/main`.
- [ ] **Step 2:** Run `bun test commands/__tests__/settings-keys-render.test.ts commands/__tests__/extension-install.test.ts commands/__tests__/extension-output.test.ts commands/__tests__/logins.test.ts lib/setup/__tests__/validators-tools.test.ts commands/__tests__/tools-setup.test.ts commands/__tests__/team-blocks.test.ts lib/setup/__tests__/steps-team-log.test.ts commands/__tests__/repos.test.ts commands/__tests__/port.test.ts lib/__tests__/repo-arg-resolution.test.ts commands/__tests__/worktree*.test.ts`. PASS, or stop and report (a file that does not exist is noted in the ledger, and the task that needs it creates it).

---

### Task 2: `settings list` labels and an unset `settings get`

- [ ] **Step 1: Failing tests.** In `settings-keys-render.test.ts`, change the label expectations:

```ts
    expect(text).toContain("this Mac's settings has a value of the wrong shape: enabled: expected boolean, got string");
    expect(text).toContain("the combined value has a problem: enabled: expected boolean, got string");
```

and in `renderListRow over store names`: `toContain("your user settings holds two copies that disagree")` and `not.toContain("rt.roles  ")` beyond the key cell (store names are not in the label). Add:

```ts
  test("an invalid value names whose settings hold it, in words", () => {
    const text = listText(row({ invalid: [{ scope: "user", file: "/tmp/x", reason: "expected number, got string" }] } as never));
    expect(text).toContain("your user settings has a value that is not valid: expected number, got string");
    expect(text).not.toContain("invalid[");
  });
```

In the file that tests `settingsGet` (find it with `grep -ln "settingsGet" commands/__tests__`; create `commands/__tests__/settings-get-unset.test.ts` if none covers the human path), add:

```ts
test("an unset key prints no value on stdout", async () => {
  const io = captureOut();
  out.__test__.setHuman(() => false);
  try {
    await settingsGet(["chat.viewerUrl"]);
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toContain("not set anywhere");
  } finally {
    io.restore();
  }
});
```

(`chat.viewerUrl` has no default; if the temp HOME's resolver gives it one, use another registered key with no default and note it.)

- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement.** In `renderListRow`:

```ts
  if (s.expandError) labels.push(`a variable in it could not be filled: ${s.expandError}`);
  for (const inv of s.invalid ?? []) labels.push(`${SCOPE_WORDS[inv.scope]} has a value that is not valid: ${inv.reason}`);
  for (const nc of s.nonconforming ?? []) labels.push(`${SCOPE_WORDS[nc.scope]} has a value of the wrong shape: ${firstIssueText(nc.issues)}`);
  if (s.mergedIssues && s.mergedIssues.length > 0) labels.push(`the combined value has a problem: ${firstIssueText(s.mergedIssues)}`);
  for (const d of s.diverged ?? []) labels.push(`${SCOPE_WORDS[d.scope]} holds two copies that disagree`);
```

(`SCOPE_WORDS` is keyed by `Scope`; if an entry's `scope` type is narrower, index with `as Scope`.) In `settingsGet`'s human ending:

```ts
  out.print(out.kv(key, undefined, describeProvenance(resolved.provenance)), ...(note ? [out.callout("note", note)] : []));
  if (resolved.value !== undefined) out.payload(`${formatValuePretty(resolved.value)}\n`);
```

`formatValuePretty` and `formatValueInline` keep their `<unset>` return for the list and explain rows, which are human tables.

The key row's provenance already reads `not set anywhere` for an unset key (`describeProvenance`, `commands/settings-keys.ts:182`), so no second line says it. `e2e/tests/settings.test.ts` asserts none of the changed strings (`grep -n "<unset>\|invalid\[\|nonconforming\[\|diverged\[" e2e/tests/settings.test.ts` prints nothing) and needs no change; Step 4 runs it to prove that.

- [ ] **Step 4:** Run the two unit files and `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/settings.test.ts`. PASS.
- [ ] **Step 5:** Commit, message `settings: list labels in words; an unset get prints no value`.

---

### Task 3: `rt settings extension` exits 1 when nothing was installed

**Interfaces:**
- Changes: `installExtension(_args?: string[], _ctx?: unknown, deps: ExtensionDeps = realExtensionDeps())`; the command tree still calls it with `(args, ctx)`.

- [ ] **Step 1: Failing tests** (in `commands/__tests__/extension-install.test.ts`; add `installExtension` and `type ExtensionDeps` to its `../extension.ts` import):

```ts
describe("installExtension's exit code", () => {
  const EDITORS = [
    { name: "Sample Code", cliPath: "/apps/sample-code", appPath: "/Applications/Sample Code.app" },
    { name: "Sample Editor", cliPath: "/apps/sample-editor", appPath: "/Applications/Sample Editor.app" },
  ];
  const deps = (over: Partial<ExtensionDeps>): ExtensionDeps => ({
    findVsix: () => "/x/rt-context.vsix",
    detectEditors: () => EDITORS,
    pick: async () => EDITORS.map((e) => e.cliPath),
    install: async () => ({ ok: true }),
    ...over,
  });
  const run = async (d: ExtensionDeps): Promise<number> => {
    const io = captureOut();
    out.__test__.setHuman(() => false);
    const exit = spyOn(process, "exit").mockImplementation(((c?: number) => {
      throw new Error(`exit ${c}`);
    }) as unknown as typeof process.exit);
    try {
      await installExtension([], {}, d);
      return 0;
    } catch (err) {
      const m = /^exit (\d+)$/.exec((err as Error).message);
      if (!m) throw err;
      return Number(m[1]);
    } finally {
      exit.mockRestore();
      io.restore();
    }
  };

  test("a missing extension exits 1", async () => {
    expect(await run(deps({ findVsix: () => null }))).toBe(1);
  });

  test("nothing installed exits 1", async () => {
    expect(await run(deps({ install: async () => ({ ok: false, output: "boom" }) }))).toBe(1);
  });

  test("a partial install exits 0", async () => {
    expect(await run(deps({ install: async (cliPath) => (cliPath === "/apps/sample-code" ? { ok: true } : { ok: false, output: "boom" }) }))).toBe(0);
  });
});
```

- [ ] **Step 2:** Run: FAIL (`installExtension` takes no deps, and today none of these exits).
- [ ] **Step 3: Implement.** In `commands/extension.ts`:

```ts
export interface ExtensionDeps {
  findVsix: () => string | null;
  detectEditors: () => DetectedEditor[];
  pick: (editors: DetectedEditor[]) => Promise<string[] | null>;
  install: Installer;
}

function realExtensionDeps(): ExtensionDeps {
  return {
    findVsix,
    detectEditors: () => detectEditors(),
    pick: async (editors) => {
      const { filterableMultiselect } = await import("../lib/pick-wrappers.ts");
      return filterableMultiselect({
        message: "Select editors to install RT Context into",
        options: editors.map((e) => ({ value: e.cliPath, label: e.name, hint: e.appPath })),
      });
    },
    install: installWithCli,
  };
}

export async function installExtension(_args: string[] = [], _ctx: unknown = {}, deps: ExtensionDeps = realExtensionDeps()): Promise<void> {
  const vsixPath = deps.findVsix();
  if (!vsixPath) {
    out.fail({ title: "rt could not find its editor extension", why: "It ships beside the rt program and is missing there." });
    process.exit(1);
  }
  logCliEvent("debug", "extension", "vsix found", { path: vsixPath });
  const editors = deps.detectEditors();
  // ...the no-editor and none-selected branches unchanged (exit 0)
  const selected = await deps.pick(editors);
  // ...
  const installed = await installInto(selected.map((cliPath) => editors.find((e) => e.cliPath === cliPath)!), vsixPath, deps.install);
  if (installed === 0) process.exit(1);
}
```

(`DetectedEditor` from `../lib/editors.ts`.) A partial install exits 0, as today; no editor found and none selected keep exit 0 (nothing failed).
- [ ] **Step 4:** Run the two extension test files. PASS.
- [ ] **Step 5:** Commit, message `settings extension: exit 1 when the extension is missing or no editor took it (Matt, follow-ups triage)`.

---

### Task 4: `rt logins` header; an unreadable tool version; a refused bundled link

**Interfaces:**
- Changes: `InstallResult` gains `reason?: "no-bundle" | "user-copy" | "dev-mode-owns-rt" | "occupied"` (set only by the bundled-link path); `commands/tools.ts` builds its envelope from `{ via, ok, detail }` explicitly.

- [ ] **Step 1: Failing tests.**

`commands/__tests__/logins.test.ts`, inside `describe("rt logins")` (it has `deps()` and `capturePlain()`):

```ts
  test("the logins table has a header", async () => {
    const t = deps({ readStdin: async () => ({ email: "dev@example.com", password: "x" }) });
    await loginsAdd(["https://login.example.com", "--json"], {}, t.d);
    const io = capturePlain();
    try {
      await loginsList([], {}, t.d);
      const rows = io.stdout().split("\n");
      expect(rows[0]).toMatch(/^Login page +Signed in as$/);
      expect(rows.some((r) => r.startsWith("https://login.example.com"))).toBe(true);
    } finally {
      io.restore();
    }
  });
```

(`capturePlain` is phase 3's wrapper of `captureOut` with the human gate closed; if the plain renderer draws a rule under headers, the row after the header is that rule and the `some` check still finds the data row.)

`commands/__tests__/__snapshots__/setup-copy.test.ts.snap:445` and `:962` pin `"tool.herdr.detail": "herdr is older than 0.7.5"` (the unreadable-version case). After Step 3, run `bun test commands/__tests__/setup-copy.test.ts --update-snapshots` and check with `git diff` that exactly those two lines changed, to `rt could not read herdr's version (it needs 0.7.5 or newer)`.

`lib/setup/__tests__/validators-tools.test.ts:1118`: `expect(r.detail).toBe("rt could not read herdr's version (it needs 0.7.5 or newer)")` and `expect(r.status).toBe("invalid")`, the test renamed `an unreadable version says so, with the status unchanged`; the team-tool twin likewise (find it with `grep -n "is older than" lib/setup/__tests__/validators-tools.test.ts`).

A refused bundled link, in the test file that covers `toolsInstall` (`grep -ln "toolsInstall" commands/__tests__`; create `commands/__tests__/tools-install-output.test.ts` if none): `toolsInstall` takes probes as its third argument and calls `installTool`; give it the `ToolsInstallSeams` path by spying the module: `spyOn(toolsInstallModule, "installTool").mockResolvedValue({ via: "bundled-link", ok: false, detail: "a copy you installed is in the way", reason: "user-copy" })` with `import * as toolsInstallModule from "../../lib/setup/tools-install.ts"`. Then:

```ts
test("a refused bundled link is a refusal for a person and the same envelope for the tray", async () => {
  const exit = spyOn(process, "exit").mockImplementation(((c?: number) => {
    throw new Error(`exit ${c}`);
  }) as unknown as typeof process.exit);
  const io = captureOut();
  out.__test__.setHuman(() => false);
  try {
    await expect(toolsInstall(["fast-browser"], {}, fakeProbes({ home: "/home/x" }))).rejects.toThrow("exit 1");
    expect(io.stderr()).toContain("[refused] rt left your fast-browser alone  a copy you installed is in the way");
    io.clear();
    await expect(toolsInstall(["fast-browser", "--json"], {}, fakeProbes({ home: "/home/x" }))).rejects.toThrow("exit 1");
    const env = JSON.parse(io.stdout());
    expect(Object.keys(env).sort()).toEqual(["at", "contract", "detail", "ok", "via"]);
    expect(io.stderr()).toContain("[refused] rt left your fast-browser alone");
    expect(io.stderr()).not.toContain("[failed]");
  } finally {
    exit.mockRestore();
    io.restore();
  }
});
```

- [ ] **Step 2:** Run: FAIL (no header; the version reads "older than"; the refusal is a failure; the envelope carries `reason` once Step 3 adds the field, which is why the key list is pinned now).
- [ ] **Step 3: Implement.**

`commands/logins.ts:94`: `out.print(out.table(rows.map((r) => [r.origin, r.email]), ["Login page", "Signed in as"]));`

`lib/setup/validators/tools.ts`, both version checks:

```ts
  if (!atLeast(version, HERDR_FLOOR)) {
    const detail = version ? `${named("herdr", version)} is older than ${HERDR_FLOOR}` : `rt could not read herdr's version (it needs ${HERDR_FLOOR} or newer)`;
    return row({ ...base, status: "invalid", detail, action: provisionedInstallAction("herdr", opts.hasBrew, "Upgrade") });
  }
```

and the team-tool twin with `req.name` and `req.floor`.

`lib/setup/tools-install.ts`:

```ts
export interface InstallResult {
  via: InstallVia;
  ok: boolean;
  detail: string;
  /** Why a bundled link was not made: rt declining is a refusal, a missing bundle a failure. Never in the --json envelope. */
  reason?: Extract<LinkOutcome, { ok: false }>["reason"];
}
```

and in `installTool`'s bundled branch: `return { via: "bundled-link", ok: outcome.ok, detail: linkOutcomeDetail(outcome), ...(outcome.ok ? {} : { reason: outcome.reason }) };`.

`commands/tools.ts` `toolsInstall`:

```ts
  if (json) out.json(envelope({ via: result.via, ok: result.ok, detail: result.detail }));
  if (!result.ok) {
    if (result.reason && result.reason !== "no-bundle") out.note(out.line("refused", `rt left your ${t} alone`, result.detail));
    else out.fail({ title: `${t} was not installed`, why: result.detail });
    process.exit(1);
  }
  if (json) return;
```

(`envelope` writes `contract` and `at` around the object as today; the explicit object keeps today's keys in today's order.)

- [ ] **Step 4:** Run the four test files and `commands/__tests__/setup-copy.test.ts`. PASS.
- [ ] **Step 5:** Commit (the snapshot included), message `logins header; an unreadable tool version says so; a refused bundled link reads as refused`.

---

### Task 5: `failCannotAsk` names what it means

- [ ] **Step 1: Failing test.** In `lib/__tests__/repo-index-missing.test.ts`, beside `pickWorktree still refuses when the only row is a missing one` (`:127`, which drives the non-TTY path), add two cases: with one repo holding two worktrees and stdin not a TTY, the failure's why is `rt knows more than one worktree and cannot ask which one you mean without a terminal.`; with two repos, `... more than one repo ...`.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement.**

```ts
function failCannotAsk(what: "repo" | "worktree"): never {
  out.fail({
    title: "You are not in a git repo",
    why: `rt knows more than one ${what} and cannot ask which one you mean without a terminal.`,
    next: "Run this from inside the repo you mean",
  });
  process.exit(1);
}
```

`lib/repo.ts:273` calls `failCannotAsk("repo")`; `:312` calls `failCannotAsk("worktree")`.

- [ ] **Step 4:** Run the test. PASS.
- [ ] **Step 5:** Commit, message `repo: the cannot-ask failure names worktrees when it means them`.

---

### Task 6: team, join and home copy

- [ ] **Step 1: Failing tests.** In `commands/__tests__/team-blocks.test.ts`, the members remove expectations become:

```ts
  expect(text).toBe(
    "[ok] Removed alice from the team  forge access: skipped\n" +
      "  fix: alice can still see the team repo. Remove them there too: mattstack does not manage who can see this repo.\n" +
      "  note: Removed members keep any secrets they already opened. Rotate those values to shut them out.\n" +
      "  next: rt secrets rotate --team acme <domain> <key>\n",
  );
```

and the second case `"[skipped] alice was not on the team list  forge access: revoked\n  note: n\n  next: rt secrets rotate --team acme <domain> <key>\n"`. In `lib/team/__tests__/join.test.ts`, the forge-login case (`:1415-1431`, `an undeterminable forge login never gets sealed as a guess ...`) gains, after its message assertions: `expect((caught as UserActionableError).why).toBe("rt reads your username from the gh command line tool, which is not signed in. The invite still works once you are.");` and `expect((caught as UserActionableError).next).toBe("gh auth login");`. (`lib/setup/__tests__/steps-team-log.test.ts:103` builds its own error and never reaches `join.ts`, so it is left alone.) Add a test that the team pull fallback title says `recognize` (from the existing fallback test in `commands/__tests__/team*.test.ts`; `grep -n "recognise" commands/__tests__` finds it, or add one through `teamPull` with an unknown outcome the way `team.test.ts` drives it).
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement.** `membersRemoveBlocks`: `out.callout("note", result.residueNote), out.callout("next", out.cmd(\`rt secrets rotate --team ${slug} <domain> <key>\`))`. `team.ts:245`, `home.ts:414,431`: `recognize`. `join.ts:565-568`: the why by the copy table, `cli` interpolated.
- [ ] **Step 4:** Run `bun test commands/__tests__/team*.test.ts lib/team commands/__tests__/home*.test.ts`. PASS.
- [ ] **Step 5:** Commit, message `team, home: members remove's next is the command alone; the forge sign-in remedy reads in order; recognize`.

---

### Task 7: `repos prune` names the kept repo once; `--repo` resolves `host/path`

- [ ] **Step 1: Failing tests.** In `commands/__tests__/repos.test.ts`:

```ts
test("a duplicate row names the kept repo once", () => {
  const text = renderPlain(pruneBlocks([{ repoName: "remote:gitlab.example.com/acme/old", path: "/code/app", reason: "duplicate", keptAs: "remote:gitlab.example.com/acme/app", data: { moved: ["a"], merged: [], refused: [], registry: "moved" } } as never], false));
  expect(text.match(/gitlab\.example\.com\/acme\/app/g)).toHaveLength(1);
  expect(text).toContain("carried 1 file there; moved its worktrees there");
});

test("a kept missing row's next names the repo as --repo resolves it", () => {
  const text = renderPlain(pruneBlocks([{ repoName: "remote:gitlab.example.com/acme/app", path: "/code/gone", reason: "missing", retained: true, hint: "rt repos locate" } as never], false));
  expect(text).toContain("next: rt repos locate <new-path> --repo gitlab.example.com/acme/app");
});
```

(The wire form is `remote:` plus the URI-encoded `host/path`, as `serializeIdentity` writes it: use `"remote:gitlab.example.com%2Facme%2Fold"` and `"remote:gitlab.example.com%2Facme%2Fapp"` in both tests above in place of the unencoded strings.) In `lib/__tests__/repo-arg-resolution.test.ts`, inside `describe("tryResolveRepoArg")` (its `beforeEach` gives a temp HOME):

```ts
  test("a host/path label resolves through --repo", async () => {
    setKvValue(REPO_INDEX_NS, RT_ID, "/repos/rt");
    expect(await tryResolveRepoArg("github.com/m4ttstack/rt")).toEqual({ kind: "resolved", identity: RT_ID });
    expect(await tryResolveRepoArg("github.com/m4ttstack/nope")).toEqual({ kind: "none" });
  });

  test("a live directory still resolves as the directory, even when it is spelled like a label", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rt-label-dir-"));
    execFileSync("git", ["init", "-q", dir]);
    setKvValue(REPO_INDEX_NS, RT_ID, "/repos/rt");
    const derived = serializeIdentity(await deriveRepoIdentity(dir));
    expect(await tryResolveRepoArg(dir)).toEqual({ kind: "resolved", identity: derived });
    rmSync(dir, { recursive: true, force: true });
  });
```

(Import what the second test needs if the file lacks it: `mkdtempSync`, `rmSync` from `fs`, `tmpdir` from `os`, `execFileSync` from `child_process`, `serializeIdentity` and `deriveRepoIdentity` from where `lib/repo-arg.ts` imports them.) In `lib/__tests__/repo.test.ts`, beside the existing `missingRepoFailure` case (`:64`, a plain name, unchanged):

```ts
test("missingRepoFailure names a remote repo by the label --repo resolves", () => {
  const f = missingRepoFailure({ repoName: "remote:gitlab.example.com%2Facme%2Fapp", worktrees: [] } as never);
  expect(f.next).toEqual({ text: "rt repos locate <new-path> --repo gitlab.example.com/acme/app", role: "command" });
});
```

In `commands/__tests__/repos.test.ts`, three assertions read the old locate failure and change on purpose: `:161` (`toStartWith(\`rt could not move ${basename(repoPath)} to ${repoPath}: \`)` becomes `toStartWith("rt could not move this repo's records\n")`), `:202` (the whole stderr: the new title line, then the `why` and `next` this case's `indexed` carries; read it, and the fallback `why` applies when it has none) and `:210` (the envelope's `message` becomes `rt could not move this repo's records`; `code` stays `locate-failed`). The message is a human sentence inside the envelope (the 2026-10-01 ruling) and no program reads it (Readers).

- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement.** `commands/repos.ts`:

```ts
function describeDataMove(r: PrunedEntry, dryRun: boolean): string {
  const d = r.data;
  if (!d) return "";
  const carried = d.moved.length + d.merged.length;
  const parts: string[] = [];
  if (carried > 0) parts.push(`${dryRun ? "would carry" : "carried"} ${carried} file${carried === 1 ? "" : "s"} there`);
  if (d.merged.length > 0) parts.push(`merged ${d.merged.join(", ")}`);
  if (d.registry === "moved") parts.push(`${dryRun ? "would move" : "moved"} its worktrees there`);
  if (d.registry === "merged") parts.push(`${dryRun ? "would merge" : "merged"} its worktrees into that one's`);
  if (d.registry === "refused") parts.push("that one's worktrees could not be written, so both were kept");
  if (d.refused.length > 0) parts.push(`kept both copies of ${d.refused.join(", ")}`);
  return parts.length > 0 ? `; ${parts.join("; ")}` : "";
}
```

`pruneBlocks`' needs-you `next`: `out.cmd(\`${r.hint ?? "rt repos locate"} <new-path> --repo ${repoLabelFull(r.repoName)}\`)`. The locate failure at `:163`: `new UserActionableError("locate-failed", "rt could not move this repo's records", {}, { why: indexed.why ?? indexed.error, ...(indexed.next ? { next: indexed.next } : {}), log: \`${name} to ${real}: ${indexed.error}\` })` and drop `healErrorClause` from the import (the old `why` sentence, "rt knows it at a folder that is gone...", becomes the fallback when `indexed.why` is unset: `why: indexed.why ?? "rt knows it at a folder that is gone, and moving its records did not finish."`; the raw error goes to `log`).

`lib/repo.ts` `missingRepoFailure`: `next: out.cmd(\`rt repos locate <new-path> --repo ${repoLabelFull(r.repoName)}\`)` (import `repoLabelFull` from `./repo-label.ts`); a plain-name row's label is its name, so the existing plain-name tests (`lib/__tests__/repo.test.ts:64`, `command-tree.test.ts:449`, `pickers.test.ts:417`, `repo-index-missing.test.ts:139`) do not move.

`lib/repo-arg.ts`, in `tryResolveRepoArg`, after the `looksLikePath` directory branch and in place of its `const index = loadRepoIndex();`:

```ts
  const index = loadRepoIndex();
  const byLabel = Object.keys(index).filter((id) => parseIdentity(id) !== null && repoLabelFull(id) === arg);
  if (byLabel.length === 1) return { kind: "resolved", identity: byLabel[0]! };
```

(import `repoLabelFull` from `./repo-label.ts`). The label match runs after the directory branch, so an argument that is a live directory still derives its identity from that folder, and every other `--repo` caller (settings, runs, worktree, herd, agent, `lib/mcp/tools.ts`, mr-target, ready-held) sees no change for a real path; the label only catches an argument that is not a directory on disk.
- [ ] **Step 4:** Run `bun test commands/__tests__/repos.test.ts commands/__tests__/repos-locate.test.ts lib/__tests__/repo-arg-resolution.test.ts lib/__tests__/repo.test.ts lib/__tests__/command-tree.test.ts lib/__tests__/pickers.test.ts lib/__tests__/repo-index-missing.test.ts`. PASS.
- [ ] **Step 5:** Commit, message `repos prune and missingRepoFailure: the kept repo named once, and a --repo value locate resolves`.

---

### Task 8: `rt port`'s "pid NaN"

- [ ] **Step 1: Failing test** (in `commands/__tests__/port.test.ts`, which drives `stopAll` through its seam): a target with `pid: Number.NaN, command: "node", port: 3000` yields `[skipped] node has no process to stop  port 3000`.
- [ ] **Step 2:** Run: FAIL (hint reads `pid NaN, port 3000`).
- [ ] **Step 3:** In `stopAll`: `const valid = Number.isInteger(pid) && pid > 0; const where = valid ? \`pid ${pid}, port ${port}\` : \`port ${port}\`;` and use `valid` in the guard.
- [ ] **Step 4:** Run the file. PASS.
- [ ] **Step 5:** Commit, message `port: no pid in the hint when there is none`.

---

### Task 9: "rt did not make it" at three sites; the dispose sentence parsed where it is written

**Interfaces:**
- Produces, in a new `lib/worktree/running-run.ts` (no imports): `runningRunDetail(id: string, stage: string): string` and `parseRunningRunDetail(detail: string): { id: string; stage: string } | null`. `lib/worktree/dispose.ts` imports the writer; `commands/worktree.ts` imports the parser from this file, not from `dispose.ts`, which pulls daemon modules into the CLI.

- [ ] **Step 1: Failing tests.** `commands/__tests__/intercept*.test.ts` (the `installBlocks` test): `[refused] rt did not make these, so rt left them alone  deck`. `commands/__tests__/worktree*.test.ts` (the `disposeReason` coverage): a `kind-*` reason's words are `rt did not make it, so rt left it alone`. `lib/setup/__tests__` (the intercepts step log test, if one asserts the line; else add one through `interceptsInstallRun` with an `installShims` fake reporting one skipped name): the log line starts `rt did not make these, so rt left them alone:`. In a new `lib/worktree/__tests__/running-run.test.ts`:

```ts
test("the running-run detail and its parser agree", () => {
  const detail = runningRunDetail("run-42", "review");
  expect(parseRunningRunDetail(detail)).toEqual({ id: "run-42", stage: "review" });
  expect(parseRunningRunDetail("something else")).toBeNull();
});
```

and `commands/worktree.ts`'s `disposeReason("running-run", runningRunDetail("run-42", "review"))` still yields its words with `next: rt runs abandon run-42`.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement.** `lib/worktree/running-run.ts`:

```ts
/** The running-run refusal's detail: the daemon log and --json carry it, and the CLI reads the id and stage back out of it. */
export function runningRunDetail(id: string, stage: string): string {
  return `running run ${id} at ${stage}; rt runs abandon ${id}`;
}

export function parseRunningRunDetail(detail: string): { id: string; stage: string } | null {
  const m = /^running run (\S+) at (\S+);/.exec(detail);
  return m ? { id: m[1]!, stage: m[2]! } : null;
}
```

and, in `lib/worktree/dispose.ts`, `refuse("running-run", runningRunDetail(scan.run.id, scan.run.currentStage))` (the bytes are today's). `commands/worktree.ts` imports `parseRunningRunDetail` from `../lib/worktree/running-run.ts` in place of its own regex; the `kind-*` words by the copy table. `commands/intercept.ts:295` and `lib/setup/steps/index.ts:31` by the copy table.
- [ ] **Step 4:** Run the four test areas and `commands/__tests__/worktree*.test.ts`. PASS; `worktree dispose --json` is unchanged (the detail bytes are the same).
- [ ] **Step 5:** Commit, message `one phrase for what rt did not make; the running-run detail is written and parsed in one file`.

---

### Task 10: Renders, AGENTS.md and every gate

- [ ] **Step 1:** `bun run ui:build`. `blocks-6h.ts` in the scratchpad builds: a `settings list` table with an invalid, a wrong-shape and a two-copies row (`renderListRow`), the unset get (`kv` row and the `off` line), the extension failure, the logins table with its header, the tool row's unreadable-version line (as `line("failed", ...)`, the way setup draws an invalid row), the members remove blocks, the prune duplicate and kept rows, the port skipped row, the refused bundled link, and the intercept refused line. Copy 5f2's `ansi-page.ts`.
- [ ] **Step 2:** Render at width 100, dark and light.
- [ ] **Step 3:** Screenshot both into `docs/design/output-layer/6h-copy-dark.png` and `-light.png`. Write down plainly what reads wrong: the logins header row reads as a header (faint, a rule under it); the settings labels read as warnings, not code; the refused rows are not coral. Fix and re-render.
- [ ] **Step 4:** README row: `| \`6h-copy-dark.png\`, \`6h-copy-light.png\` | phase 6 copy polish: settings list labels, an unset get, the extension failure, the logins header, an unreadable tool version, members remove, a prune duplicate and a kept repo, a port row with no pid, a refused bundled link, and intercept's left-alone line |`.
- [ ] **Step 5:** AGENTS.md: append one sentence to the "Output layer" section: `A command a person can run to fix something names its subject in a form the verb resolves: \`rt repos locate --repo\` takes a repo's \`host/path\` label, so printed commands use that (\`repoLabelFull\`), never the stored identity.` Before writing it, run `grep -rn -- '--repo \${' commands lib --include=*.ts | grep -v __tests__` and check that every printed `--repo` value goes through `repoLabelFull` or is a plain name; any other hit is fixed in this task or the sentence is not written.
- [ ] **Step 6:** The eight gates, one at a time from the repo root: `bun run ui:build`, `bun run typecheck`, `bun run test`, `bun run test:e2e`, `bun run test:pty`, `bun run picker:check`, `bun run format:check`, `bun run check`. All pass (known rotating flakes: a failure in an untouched file that passes alone is reported, not fixed).
- [ ] **Step 7:** Commit, message `docs: copy polish renders`.

---

### Task 11: Ship

- [ ] **Step 1:** `git fetch origin`; `git rebase origin/main`; merge `AGENTS.md` and the README by hand.
- [ ] **Step 2:** The eight gates again.
- [ ] **Step 3:** `git diff --shortstat origin/main...HEAD`; about 1,500 lines.
- [ ] **Step 4:** Push with `git_push`; body in `<scratchpad>/pr-body-6h.md` (framing; **Settings**, **Setup and tools**, **Team and home**, **Repos and port**, **Left alone** groups; a line naming the one exit-code change and Matt's triage; renders; gates; last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`); `gh pr create --repo m4ttstack/mattstack --title "RT-369: output layer phase 6h, copy-polish" --body-file <scratchpad>/pr-body-6h.md`.
- [ ] **Step 5:** Report URL, gates, size, renders. Do not merge.

---

## Decisions this plan made

1. **An unset `settings get` prints nothing on stdout.** The value is the payload, and `<unset>` was a value a script could mistake for one; the human line says "Not set". The repo's readers all pass `--json`.
2. **A refused bundled link exits 1 as today** but reads `refused`; `InstallResult.reason` never reaches the envelope.
3. **`--repo` resolves a `host/path` label** after the directory branch and before the name lookups, so the commands rt prints are runnable as printed and a live folder still wins.
4. **A partial `settings extension` install (some editors took it) exits 0,** as today; only nothing installed exits 1.

## Self-Review

**Spec coverage.** Every 6h row of the scoping document's section 2: settings (2), extension (3), logins, tool version, tools install (4), failCannotAsk (5), team, join, home (6), repos and `--repo` (7), port (8), the phrase and dispose (9), `healErrorClause` at `commands/repos.ts` (7).

**Placeholders.** One test names the file it extends by a given `grep` (the `settingsGet` test file); every other test names its file, and every assertion is written out.

**Type consistency.** `InstallResult.reason`, `failCannotAsk(what)`, `describeDataMove`, `runningRunDetail` / `parseRunningRunDetail` match across tasks.

**Review Focus.** Five lines, each pinned by a named test.
