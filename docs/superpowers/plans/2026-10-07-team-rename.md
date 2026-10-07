# `rt team rename` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An org admin renames their org with `rt team rename <name>`: rt writes the marker's `org`, commits and publishes it on the checked-out branch, then converges this Mac's folder, records, repo index and marketplace at once.

**Architecture:** A pure-ish library function `renameOrg` in `lib/team/rename.ts` does the preflight refusals, the marker write, the commit, the publish (rolling the commit back when the push fails) and calls a `converge` seam. `teamRename` in `commands/team.ts` resolves the org, renders the result or refusal, and owns the real seams; the real `converge` seam builds an `ApplyContext` and calls `convergeOrgFolder` from the converge PR (`lib/setup/steps/org-folder.ts`), wired in the last task after merging `origin/converge`.

**Tech Stack:** Bun, TypeScript, `bun:test`, real git in temp HOMEs (`orgWorld`), `jsonc-parser`.

**Spec:** `docs/superpowers/specs/2026-10-06-orgs-root-design.md`, section 4 (Renaming an org), section 3 (the converge contract), section 10's rename lines.

## Global Constraints

- Only an org admin may run it (`roleFor(p, org).kind === "admin"`); anyone else is refused with `rename-not-admin`.
- `<name>` passes the slug rule (`validateSlug`, `/^[a-z0-9][a-z0-9-]{0,39}$/`), differs from the current name, and is not already a folder under `orgsDir()`.
- Refuse a clone with uncommitted changes to tracked files or one behind its origin, the guards `rt team publish` relies on (untracked files are not "uncommitted": they move with the folder).
- Commit message exactly `org: rename to <name>`, on the CHECKED-OUT branch (`orgBranch` in `lib/team/org-branch.ts`); never hard-code `main`.
- Publish through `publishTeam` (`lib/team/publish.ts`), then run converge on this Mac.
- `--json` returns `{ ok, from, to, converged }` (inside `envelope`) and the refusal codes; refusals by policy render as `refused` notes (via `REFUSAL_CODES` in `commands/team.ts`), never failures.
- Node `description` is exactly `Rename your org`; no `agentSafe`; `omitBehavior` declared for the required positional; run `bun run docs:gen` after the tree change.
- The result tells members: their Mac converges at its next update, or now with `rt setup update --force`.
- Copy: plain short sentences, speak to "you", commands go in `next` callouts, no em or en dashes anywhere.
- Placeholder names only in tests and text: acme, widgets, gadgets, dev1, dev2, gitlab.example.com.
- Tests: real git only under a temp HOME (`orgWorld` from `lib/team/__tests__/org-world.ts`); run `bun test <file>` from the repo root, targeted files only.
- Write fence: `commands/team.ts`, `commands/__tests__/team*.ts`, `lib/team/`, `lib/command-tree-def.ts`, generated `docs/` and `website/docs/`, this plan.

## Review Focus

1. A clone whose folder has not converged (marker `org` differs from its folder): renaming it would stack a second mismatch; refuse with `org-not-converged` and point at `rt setup update --force`. (Task 1)
2. A push that fails after the marker commit: the rename must not half-happen; the commit is undone (`git reset --keep HEAD~1`), the marker reads the old name and the clone is clean. (Task 2)
3. A trial branch the remote has never seen: that is not "behind"; the rename publishes and creates the branch there, leaving `main` untouched. (Task 2)
4. A name with capitals or spaces (`Acme Labs`): refused as a bad name before anything is written or committed. (Task 1)
5. A converge that fails or ends `partial` after a successful publish: the rename still succeeded; exit 0, `converged: false`, and a person sees the converge detail and `rt setup update --force`. (Task 3)

---

## File Structure

- Create `lib/team/rename.ts`: `renameOrg`, its seams and result types, every preflight refusal.
- Create `lib/team/__tests__/rename.test.ts`: real-git tests over `orgWorld`.
- Modify `commands/team.ts`: `teamRename`, `renameBlocks`, new `REFUSAL_CODES`, `renameSeams` on `TeamDeps`, the real seams (Task 4 wires converge).
- Create `commands/__tests__/team-rename.test.ts`: envelope, refusal and human copy tests.
- Modify `lib/command-tree-def.ts`: the `team.rename` node.
- Regenerate `docs/` and `website/docs/` with `bun run docs:gen`.

---

### Task 1: `renameOrg` preflight refusals

**Files:**
- Create: `lib/team/rename.ts`
- Test: `lib/team/__tests__/rename.test.ts`

**Interfaces:**
- Consumes: `roleFor`, `rolesFor` (`lib/team/roles.ts`); `orgBranch`, `shellQuote` (`lib/team/org-branch.ts`); `validateSlug` (`lib/secrets/store.ts`); `orgDirUnder` (`lib/rt-paths.ts`); `teamRemote` (`lib/team/members.ts`); `gitWithToken` (`lib/team/git-credential.ts`); `withoutUrls` (`lib/team/redact.ts`); `GIT_OBJECT_ID` (`lib/team/publish-history.ts`).
- Produces:

```ts
export type ConvergeOutcome = { state: "done" | "partial" | "failed" | "skipped"; detail?: string; remedy?: string };
export interface RenameSeams {
  forgeToken: (p: Probes, remote: string) => Promise<string | null>;
  converge: (p: Probes) => Promise<ConvergeOutcome>;
}
export interface RenameResult { from: string; to: string; converged: boolean; convergeDetail?: string; convergeRemedy?: string }
export const MARKER_RELATIVE = "mattstack/mattstack.jsonc";
export async function renameOrg(p: Probes, from: string, to: string, seams: RenameSeams): Promise<RenameResult>;
```

In this task `renameOrg` runs the preflight only and then throws `new Error("not yet")` after it; Task 2 replaces that tail.

Refusal codes and copy (every one a `UserActionableError`):

| Order | Condition | code | message | why / next |
|---|---|---|---|---|
| 1 | `roleFor(p, from).kind !== "admin"` | `rename-not-admin` | `Only an org admin can rename the org` | why: `Ask <admins joined with " or "> to rename it.` (when `rolesFor(p, from).admins` is empty: `This org names no admins yet.`) |
| 2 | `validateSlug(to)` throws | `bad-org-name` | `${JSON.stringify(to)} cannot be an org name` | why: `Use lowercase letters, digits and dashes, up to 40 characters, starting with a letter or digit.` |
| 3 | `to === from` | `rename-same-name` | `Your org is already called ${to}` | none |
| 4 | `p.exists(orgDirUnder(p.home, to))` | `rename-name-taken` | `This Mac already has an org folder called ${to}` | why: `Pick another name, or move that folder aside first.` |
| 5 | marker missing, unparseable, or not an object | `org-marker-unreadable` | `rt could not read your org's name from its marker file` | none |
| 6 | marker `org` !== `from` | `org-not-converged` | `Your org folder does not match the org's name yet` | why: `Bring this Mac up to date before you rename the org.`, next: `rt setup update --force` |
| 7 | `orgBranch` throws `org-detached` | (its own) | | |
| 8 | `git status --porcelain --untracked-files=no` non-empty | `org-uncommitted` | `Your copy of the org has changes that are not committed` | why: `Commit and publish them, or discard them, before you rename the org.`, next: `git -C <shellQuote(dir)> status` |
| 9 | ls-remote of `refs/heads/<branch>` fails | `org-unreachable` | `rt could not reach the org repo` | log: redacted git output |
| 10 | remote sha exists and (`git cat-file -e <sha>^{commit}` fails OR `git merge-base --is-ancestor <sha> HEAD` exits non-zero) | `org-behind` | `The org repo has changes this Mac does not have yet` | why: `Pull them before you rename the org.`, next: `rt team pull --team ${from}`, thenRun: `rt team rename ${to}` |

A remote with no row for the branch (a trial branch never pushed) is not behind.

- [ ] **Step 1: Write the failing tests**

`lib/team/__tests__/rename.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { childEnv } from "../../subprocess.ts";
import { renameOrg, type ConvergeOutcome, type RenameSeams } from "../rename.ts";
import { cleanupOrgWorlds, orgWorld } from "./org-world.ts";

afterEach(cleanupOrgWorlds);

function seams(outcome: ConvergeOutcome = { state: "done", detail: "Moved acme" }): RenameSeams & { converged: number } {
  const s = { converged: 0, forgeToken: async () => null, converge: async () => { s.converged += 1; return outcome; } };
  return s;
}

const marker = (root: string) => JSON.parse(readFileSync(join(root, "mattstack", "mattstack.jsonc"), "utf8")) as { org: string };

describe("renameOrg refusals", () => {
  test("a member who is not an admin is refused and nothing is written", async () => {
    const w = orgWorld("dev2");
    await expect(renameOrg(w.p, "acme", "gadgets", seams())).rejects.toMatchObject({ code: "rename-not-admin", why: "Ask dev1 to rename it." });
    expect(marker(w.root).org).toBe("acme");
  });

  test("a name that breaks the slug rule is refused before anything is written", async () => {
    const w = orgWorld();
    await expect(renameOrg(w.p, "acme", "Acme Labs", seams())).rejects.toMatchObject({ code: "bad-org-name" });
    expect(marker(w.root).org).toBe("acme");
    expect(w.git("status", "--porcelain")).toBe("");
  });

  test("the current name is refused", async () => {
    const w = orgWorld();
    await expect(renameOrg(w.p, "acme", "acme", seams())).rejects.toMatchObject({ code: "rename-same-name" });
  });

  test("a name another folder under orgs already holds is refused", async () => {
    const w = orgWorld();
    mkdirSync(join(w.home, ".mattstack", "orgs", "gadgets"), { recursive: true });
    await expect(renameOrg(w.p, "acme", "gadgets", seams())).rejects.toMatchObject({ code: "rename-name-taken" });
  });

  test("a clone whose marker already names another org is refused until it converges", async () => {
    const w = orgWorld();
    writeFileSync(join(w.root, "mattstack", "mattstack.jsonc"), `${JSON.stringify({ role: "org", org: "widgets" }, null, 2)}\n`);
    w.git("commit", "-q", "-am", "marker moved elsewhere");
    await expect(renameOrg(w.p, "acme", "gadgets", seams())).rejects.toMatchObject({ code: "org-not-converged", next: "rt setup update --force" });
  });

  test("uncommitted changes to tracked files are refused", async () => {
    const w = orgWorld();
    writeFileSync(join(w.root, ".claude-plugin", "marketplace.json"), "{}\n");
    await expect(renameOrg(w.p, "acme", "gadgets", seams())).rejects.toMatchObject({ code: "org-uncommitted" });
  });

  test("an untracked file is not an uncommitted change", async () => {
    const w = orgWorld();
    writeFileSync(join(w.root, "notes.txt"), "mine\n");
    const result = await renameOrg(w.p, "acme", "gadgets", seams()).catch((err: unknown) => err);
    expect(result).not.toMatchObject({ code: "org-uncommitted" });
  });

  test("a clone behind its origin is refused and pointed at a pull", async () => {
    const w = orgWorld();
    const other = join(w.home, "other");
    execFileSync("git", ["clone", "-q", w.remote, other], { env: childEnv() });
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=dev2", "-c", "user.email=dev2@example.test", ...args], { cwd: other, env: childEnv() });
    writeFileSync(join(other, "later.txt"), "x\n");
    git("add", "later.txt");
    git("commit", "-q", "-m", "later");
    git("push", "-q", "origin", "main");
    await expect(renameOrg(w.p, "acme", "gadgets", seams())).rejects.toMatchObject({ code: "org-behind", next: "rt team pull --team acme", thenRun: "rt team rename gadgets" });
    expect(marker(w.root).org).toBe("acme");
  });

  test("a detached clone is refused", async () => {
    const w = orgWorld();
    w.git("checkout", "-q", "--detach");
    await expect(renameOrg(w.p, "acme", "gadgets", seams())).rejects.toMatchObject({ code: "org-detached" });
  });
});
```

The "untracked" test only asserts the refusal is not `org-uncommitted` (Task 1's tail still throws `not yet`; Task 2 tightens nothing there).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/team/__tests__/rename.test.ts`
Expected: FAIL, `Cannot find module '../rename.ts'`.

- [ ] **Step 3: Write `lib/team/rename.ts`**

```ts
import { join } from "path";
import { parse, type ParseError } from "jsonc-parser";
import { UserActionableError } from "../errors.ts";
import { orgDirUnder } from "../rt-paths.ts";
import { validateSlug } from "../secrets/store.ts";
import type { Probes } from "../setup/probes.ts";
import { gitWithToken } from "./git-credential.ts";
import { teamRemote } from "./members.ts";
import { orgBranch, shellQuote } from "./org-branch.ts";
import { GIT_OBJECT_ID } from "./publish-history.ts";
import { withoutUrls } from "./redact.ts";
import { roleFor, rolesFor } from "./roles.ts";

export type ConvergeOutcome = { state: "done" | "partial" | "failed" | "skipped"; detail?: string; remedy?: string };

export interface RenameSeams {
  forgeToken: (p: Probes, remote: string) => Promise<string | null>;
  converge: (p: Probes) => Promise<ConvergeOutcome>;
}

export interface RenameResult {
  from: string;
  to: string;
  converged: boolean;
  convergeDetail?: string;
  convergeRemedy?: string;
}

export const MARKER_RELATIVE = "mattstack/mattstack.jsonc";

interface Prepared {
  dir: string;
  branch: string;
  remote: string | null;
  token: string | null;
  markerText: string;
}

function readMarker(p: Probes, dir: string): { text: string; org: unknown } {
  const text = p.readFile(join(dir, MARKER_RELATIVE));
  const errors: ParseError[] = [];
  const value: unknown = text === null ? null : parse(text, errors);
  if (text === null || errors.length > 0 || value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new UserActionableError("org-marker-unreadable", "rt could not read your org's name from its marker file");
  }
  return { text, org: (value as { org?: unknown }).org };
}

async function assertNotBehind(p: Probes, dir: string, branch: string, from: string, to: string, remote: string | null, token: string | null): Promise<void> {
  const ref = `refs/heads/${branch}`;
  const lookup = gitWithToken(["ls-remote", "--refs", "origin", ref], token, { GIT_TERMINAL_PROMPT: "0" }, { remote });
  const res = await p.exec(lookup.argv, { cwd: dir, env: lookup.env });
  if (res.code !== 0) {
    throw new UserActionableError("org-unreachable", "rt could not reach the org repo", {}, { log: withoutUrls(`${res.stdout}\n${res.stderr}`.trim()) });
  }
  const sha = res.stdout.trim().split("\n").filter(Boolean)[0]?.split("\t")[0];
  if (sha === undefined) return;
  const known = GIT_OBJECT_ID.test(sha) && (await p.exec(["git", "cat-file", "-e", `${sha}^{commit}`], { cwd: dir })).code === 0;
  if (known && (await p.exec(["git", "merge-base", "--is-ancestor", sha, "HEAD"], { cwd: dir })).code === 0) return;
  throw new UserActionableError("org-behind", "The org repo has changes this Mac does not have yet", {}, {
    why: "Pull them before you rename the org.",
    next: `rt team pull --team ${from}`,
    thenRun: `rt team rename ${to}`,
  });
}

async function prepare(p: Probes, from: string, to: string, seams: RenameSeams): Promise<Prepared> {
  if (roleFor(p, from).kind !== "admin") {
    const admins = rolesFor(p, from).admins;
    throw new UserActionableError("rename-not-admin", "Only an org admin can rename the org", {}, {
      why: admins.length > 0 ? `Ask ${admins.join(" or ")} to rename it.` : "This org names no admins yet.",
    });
  }
  try {
    validateSlug(to);
  } catch {
    throw new UserActionableError("bad-org-name", `${JSON.stringify(to)} cannot be an org name`, {}, {
      why: "Use lowercase letters, digits and dashes, up to 40 characters, starting with a letter or digit.",
    });
  }
  if (to === from) throw new UserActionableError("rename-same-name", `Your org is already called ${to}`);
  if (p.exists(orgDirUnder(p.home, to))) {
    throw new UserActionableError("rename-name-taken", `This Mac already has an org folder called ${to}`, {}, { why: "Pick another name, or move that folder aside first." });
  }
  const dir = orgDirUnder(p.home, from);
  const marker = readMarker(p, dir);
  if (marker.org !== from) {
    throw new UserActionableError("org-not-converged", "Your org folder does not match the org's name yet", {}, {
      why: "Bring this Mac up to date before you rename the org.",
      next: "rt setup update --force",
    });
  }
  const branch = await orgBranch(p, dir);
  const status = await p.exec(["git", "status", "--porcelain", "--untracked-files=no"], { cwd: dir });
  if (status.code !== 0 || status.stdout.trim() !== "") {
    throw new UserActionableError("org-uncommitted", "Your copy of the org has changes that are not committed", {}, {
      why: "Commit and publish them, or discard them, before you rename the org.",
      next: `git -C ${shellQuote(dir)} status`,
    });
  }
  const remote = teamRemote(p, from);
  const token = remote ? await seams.forgeToken(p, remote) : null;
  await assertNotBehind(p, dir, branch, from, to, remote, token);
  return { dir, branch, remote, token, markerText: marker.text };
}

export async function renameOrg(p: Probes, from: string, to: string, seams: RenameSeams): Promise<RenameResult> {
  await prepare(p, from, to, seams);
  throw new Error("not yet");
}
```

Note: `p.exists` reads through the Probes seam, so `orgWorld`'s real probes see the temp HOME.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/team/__tests__/rename.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/team/rename.ts lib/team/__tests__/rename.test.ts
git commit -m "team: rename refuses a non-admin, a bad or taken name, and a dirty or stale clone"
```

---

### Task 2: write, commit, publish, roll back, converge

**Files:**
- Modify: `lib/team/rename.ts` (the tail of `renameOrg`)
- Test: `lib/team/__tests__/rename.test.ts`

**Interfaces:**
- Consumes: Task 1's `prepare`, `RenameSeams`, `RenameResult`, `MARKER_RELATIVE`; `commitFiles` (`lib/team/create.ts`, `(p, slug, paths, message) => Promise<boolean>`); `publishTeam` (`lib/team/publish.ts`); `assertMayWrite` (`lib/team/roles.ts`); `modify`, `applyEdits` from `jsonc-parser`.
- Produces: the finished `renameOrg`.

Behaviour after `prepare`:

1. `assertMayWrite(p, from, MARKER_RELATIVE)`; write the marker with `applyEdits(text, modify(text, ["org"], to, { formattingOptions: { insertSpaces: true, tabSize: 2 } }))`.
2. `commitFiles(p, from, [MARKER_RELATIVE], \`org: rename to ${to}\`)`. When it throws, restore the marker text and rethrow.
3. `publishTeam(p, from, null, { token, tokenRemote: remote })`. When it throws: `git reset -q --keep HEAD~1` in `dir`; if that reset exits non-zero throw `UserActionableError("rename-undo-failed", "rt could not undo the rename after the push failed", {}, { why: "Your copy of the org has a rename commit the org repo does not have.", next: \`git -C ${shellQuote(dir)} reset --keep HEAD~1\`, log: <the publish error's message> })`; else rethrow the publish error.
4. `const outcome = await seams.converge(p)`; return `{ from, to, converged: outcome.state === "done", ...(outcome.state !== "done" && outcome.detail ? { convergeDetail: outcome.detail } : {}), ...(outcome.state !== "done" && outcome.remedy ? { convergeRemedy: outcome.remedy } : {}) }`.

- [ ] **Step 1: Write the failing tests** (append to `rename.test.ts`)

```ts
describe("renameOrg", () => {
  test("writes the marker, commits it, publishes it and converges this Mac", async () => {
    const w = orgWorld();
    const s = seams();
    const result = await renameOrg(w.p, "acme", "gadgets", s);
    expect(result).toEqual({ from: "acme", to: "gadgets", converged: true });
    expect(marker(w.root)).toMatchObject({ role: "org", org: "gadgets" });
    expect(w.git("log", "-1", "--format=%s").trim()).toBe("org: rename to gadgets");
    expect(w.git("show", "--name-only", "--format=", "HEAD").trim()).toBe("mattstack/mattstack.jsonc");
    expect(w.atOrigin("log", "-1", "--format=%s", "main").trim()).toBe("org: rename to gadgets");
    expect(w.git("status", "--porcelain")).toBe("");
    expect(s.converged).toBe(1);
  });

  test("on a trial branch the origin has never seen, it publishes that branch and leaves main alone", async () => {
    const w = orgWorld();
    w.git("switch", "-q", "-c", "org-trial");
    await renameOrg(w.p, "acme", "gadgets", seams());
    expect(w.atOrigin("log", "-1", "--format=%s", "org-trial").trim()).toBe("org: rename to gadgets");
    expect(w.atOrigin("log", "-1", "--format=%s", "main").trim()).toBe("seed");
    expect(w.pushes.flat().join(" ")).not.toContain("refs/heads/main");
  });

  test("a push the origin refuses undoes the rename commit and converges nothing", async () => {
    const w = orgWorld();
    const hook = join(w.remote, "hooks", "pre-receive");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const s = seams();
    await expect(renameOrg(w.p, "acme", "gadgets", s)).rejects.toBeDefined();
    expect(marker(w.root).org).toBe("acme");
    expect(w.git("log", "-1", "--format=%s").trim()).toBe("seed");
    expect(w.git("status", "--porcelain")).toBe("");
    expect(s.converged).toBe(0);
  });

  test("a converge that does not finish still reports the rename, with its detail and remedy", async () => {
    const w = orgWorld();
    const result = await renameOrg(w.p, "acme", "gadgets", seams({ state: "partial", detail: "claude is missing", remedy: "Run claude plugin marketplace add" }));
    expect(result).toEqual({ from: "acme", to: "gadgets", converged: false, convergeDetail: "claude is missing", convergeRemedy: "Run claude plugin marketplace add" });
    expect(w.atOrigin("log", "-1", "--format=%s", "main").trim()).toBe("org: rename to gadgets");
  });

  test("a marker with comments keeps them", async () => {
    const w = orgWorld();
    writeFileSync(join(w.root, "mattstack", "mattstack.jsonc"), `// the org marker\n{\n  "role": "org",\n  "org": "acme"\n}\n`);
    w.git("commit", "-q", "-am", "comment the marker");
    w.git("push", "-q", "origin", "main");
    await renameOrg(w.p, "acme", "gadgets", seams());
    const text = readFileSync(join(w.root, "mattstack", "mattstack.jsonc"), "utf8");
    expect(text).toContain("// the org marker");
    expect(text).toContain(`"org": "gadgets"`);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/team/__tests__/rename.test.ts`
Expected: the five new tests FAIL with `not yet`; Task 1's still pass.

- [ ] **Step 3: Implement the tail**

Add imports `applyEdits, modify` (beside `parse`), `commitFiles` from `./create.ts`, `publishTeam` from `./publish.ts`, `assertMayWrite` from `./roles.ts`, and replace `renameOrg`:

```ts
export async function renameOrg(p: Probes, from: string, to: string, seams: RenameSeams): Promise<RenameResult> {
  const { dir, remote, token, markerText } = await prepare(p, from, to, seams);
  const markerPath = join(dir, MARKER_RELATIVE);
  assertMayWrite(p, from, MARKER_RELATIVE);
  p.writeFile(markerPath, applyEdits(markerText, modify(markerText, ["org"], to, { formattingOptions: { insertSpaces: true, tabSize: 2 } })));
  try {
    await commitFiles(p, from, [MARKER_RELATIVE], `org: rename to ${to}`);
  } catch (err) {
    p.writeFile(markerPath, markerText);
    throw err;
  }
  try {
    await publishTeam(p, from, null, { token, tokenRemote: remote });
  } catch (err) {
    const undo = await p.exec(["git", "reset", "-q", "--keep", "HEAD~1"], { cwd: dir });
    if (undo.code !== 0) {
      throw new UserActionableError("rename-undo-failed", "rt could not undo the rename after the push failed", {}, {
        why: "Your copy of the org has a rename commit the org repo does not have.",
        next: `git -C ${shellQuote(dir)} reset --keep HEAD~1`,
        log: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }
  const outcome = await seams.converge(p);
  const done = outcome.state === "done";
  return {
    from,
    to,
    converged: done,
    ...(!done && outcome.detail ? { convergeDetail: outcome.detail } : {}),
    ...(!done && outcome.remedy ? { convergeRemedy: outcome.remedy } : {}),
  };
}
```

`Prepared.branch` stays in the type only if used; drop it from `Prepared` if TypeScript flags it unused.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/team/__tests__/rename.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/team/rename.ts lib/team/__tests__/rename.test.ts
git commit -m "team: rename commits and publishes the marker, undoes a refused push, then converges"
```

---

### Task 3: the `rt team rename` verb

**Files:**
- Modify: `commands/team.ts` (imports, `TeamDeps.renameSeams`, `REFUSAL_CODES`, `renameBlocks`, `teamRename`, the usage doc comment at the top)
- Modify: `lib/command-tree-def.ts` (the `team.rename` node, placed after `publish`)
- Create: `commands/__tests__/team-rename.test.ts`
- Regenerate: `docs/`, `website/docs/` via `bun run docs:gen`

**Interfaces:**
- Consumes: `renameOrg`, `RenameSeams`, `RenameResult` (Tasks 1 and 2); `resolveTeamSlug`, `positional`, `usageError`, `exitTeamError`, `envelope`, `storedForgeToken` (all already in or imported by `commands/team.ts`).
- Produces: `export async function teamRename(args: string[], _ctx?: CommandContext, deps?: TeamDeps): Promise<void>`; `export function renameBlocks(result: RenameResult): Block[]`; `TeamDeps.renameSeams?: Partial<RenameSeams>`.

Until Task 4, the real `converge` seam is a placeholder in `commands/team.ts`:

```ts
/** Replaced by the converge step once it lands; until then this Mac's folder moves at its next update. */
async function convergeLater(): Promise<ConvergeOutcome> {
  return { state: "skipped", detail: "This Mac's folder moves at its next update", remedy: "rt setup update --force" };
}
```

- [ ] **Step 1: Write the failing tests**

`commands/__tests__/team-rename.test.ts`:

```ts
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { cleanupOrgWorlds, orgWorld } from "../../lib/team/__tests__/org-world.ts";
import type { ConvergeOutcome } from "../../lib/team/rename.ts";
import { renameBlocks, teamRename, type TeamDeps } from "../team.ts";

afterEach(cleanupOrgWorlds);

function depsFor(p: TeamDeps["probes"], outcome: ConvergeOutcome = { state: "done" }) {
  const lines: string[] = [];
  const deps: TeamDeps = { probes: p, print: (s) => lines.push(s), renameSeams: { forgeToken: async () => null, converge: async () => outcome } };
  return { deps, lines };
}

async function exitCode(fn: () => Promise<void>): Promise<number | undefined> {
  const spy = spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
  try {
    await fn();
    return undefined;
  } catch {
    return spy.mock.calls.at(-1)?.[0] as number | undefined;
  } finally {
    spy.mockRestore();
  }
}

describe("rt team rename", () => {
  test("--json prints ok, from, to and converged", async () => {
    const w = orgWorld();
    const { deps, lines } = depsFor(w.p);
    await teamRename(["gadgets", "--json"], {}, deps);
    expect(JSON.parse(lines[0]!)).toMatchObject({ ok: true, from: "acme", to: "gadgets", converged: true });
    expect(Object.keys(JSON.parse(lines[0]!)).sort()).toEqual(["at", "contract", "converged", "from", "ok", "to"]);
  });

  test("a converge that did not finish is converged false, and still exit 0", async () => {
    const w = orgWorld();
    const { deps, lines } = depsFor(w.p, { state: "failed", detail: "The rt daemon is running but did not answer", remedy: "Run rt daemon restart, then rt setup update --force" });
    expect(await exitCode(() => teamRename(["gadgets", "--json"], {}, deps))).toBeUndefined();
    expect(JSON.parse(lines[0]!)).toMatchObject({ ok: true, converged: false });
  });

  test("a non-admin sees a refused note, exit 2", async () => {
    const w = orgWorld("dev2");
    const { deps } = depsFor(w.p);
    const captured = captureOut();
    try {
      expect(await exitCode(() => teamRename(["gadgets"], {}, deps))).toBe(2);
      expect(captured.stderr()).toContain("[refused] Only an org admin can rename the org");
    } finally { captured.restore(); }
  });

  test("--json refusal carries the code", async () => {
    const w = orgWorld("dev2");
    const { deps, lines } = depsFor(w.p);
    expect(await exitCode(() => teamRename(["gadgets", "--json"], {}, deps))).toBe(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ error: { code: "rename-not-admin" } });
  });

  test("no name is a usage error, exit 2", async () => {
    const w = orgWorld();
    const { deps, lines } = depsFor(w.p);
    expect(await exitCode(() => teamRename(["--json"], {}, deps))).toBe(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ error: { code: "usage" } });
  });

  test("the human result names the move and what teammates do next", () => {
    const text = renderPlain(renameBlocks({ from: "acme", to: "gadgets", converged: true }));
    expect(text).toContain("Renamed your org to gadgets");
    expect(text).toContain("This Mac's org folder is now gadgets");
    expect(text).toContain("rt setup update --force");
  });

  test("the human result shows why this Mac did not move yet", () => {
    const text = renderPlain(renameBlocks({ from: "acme", to: "gadgets", converged: false, convergeDetail: "claude is missing", convergeRemedy: "Run claude plugin marketplace add" }));
    expect(text).toContain("This Mac's org folder has not moved yet");
    expect(text).toContain("claude is missing");
    expect(text).toContain("Run claude plugin marketplace add");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test commands/__tests__/team-rename.test.ts`
Expected: FAIL, `teamRename` / `renameBlocks` not exported.

- [ ] **Step 3: Implement the verb**

In `commands/team.ts`:

- Import `renameOrg, type ConvergeOutcome, type RenameResult, type RenameSeams` from `../lib/team/rename.ts`.
- Add to `TeamDeps`: `/** Overrides `renameOrg`'s seams; real by default. */ renameSeams?: Partial<RenameSeams>;`
- Add to `REFUSAL_CODES`: `"rename-not-admin"`, `"rename-same-name"`, `"rename-name-taken"`, `"org-not-converged"`, `"org-uncommitted"`, `"org-behind"`.
- Add `rt team rename <name> [--team <org>] [--json]` to the header usage comment.
- Add:

```ts
export function renameBlocks(result: RenameResult): Block[] {
  const here = result.converged
    ? [out.line("done", `This Mac's org folder is now ${result.to}`)]
    : [
        out.line("needs-you", "This Mac's org folder has not moved yet", result.convergeDetail),
        (result.convergeRemedy ? out.callout("fix", result.convergeRemedy) : out.callout("next", out.cmd("rt setup update --force"))),
      ];
  return [
    out.line("done", `Renamed your org to ${result.to}`, `was ${result.from}`),
    ...here,
    out.callout("note", ["Your teammates' Macs follow at their next update, or now with ", out.cmd("rt setup update --force")]),
  ];
}

function realRenameSeams(deps: TeamDeps): RenameSeams {
  return { forgeToken: deps.forgeToken ?? storedForgeToken, converge: convergeLater, ...deps.renameSeams };
}

export async function teamRename(args: string[], _ctx: CommandContext = {}, deps: TeamDeps = realTeamDeps()): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const to = positional(args, ["--team"])[0];
  if (!to) usageError(deps, json, "What should your org be called?", "rt team rename <name> [--json]");
  try {
    const from = resolveTeamSlug(args, "team rename");
    const result = await renameOrg(deps.probes, from, to, realRenameSeams(deps));
    if (json) {
      deps.print(JSON.stringify(envelope({ ok: true, from: result.from, to: result.to, converged: result.converged })));
      return;
    }
    out.print(...renameBlocks(result));
  } catch (err) {
    if (err instanceof UserActionableError) exitTeamError(err, json, deps);
    throw err;
  }
}
```

`CalloutLabel` is the closed set `tip | next | fix | why | note` (`lib/ui/protocol.ts`).

In `lib/command-tree-def.ts`, after `publish`:

```ts
      rename: {
        description: "Rename your org",
        module: "./commands/team.ts",
        fn: "teamRename",
        omitBehavior: { exempt: "a new org name cannot be listed" },
        args: [
          { name: "Name", type: "text", placeholder: "gadgets", hint: "The org's new name: lowercase letters, digits and dashes" },
          { name: "Team", flag: "--team", type: "text", placeholder: "acme", hint: "Which org clone; leave out, since a Mac holds one" },
          SETUP_JSON_ARG,
        ],
      },
```

`commands/team.ts` is already in `lib/module-registry.ts`; no registry change.

- [ ] **Step 4: Run the tests, the gates and the docs**

Run:
```bash
bun test commands/__tests__/team-rename.test.ts lib/team/__tests__/rename.test.ts
bun run picker:check
bun run docs:gen
git status --porcelain
```
Expected: tests PASS; picker:check passes; docs:gen changes only files under `docs/` and `website/docs/`.

- [ ] **Step 5: Commit**

```bash
git add commands/team.ts commands/__tests__/team-rename.test.ts lib/command-tree-def.ts docs website/docs
git commit -m "team: rt team rename renames your org and converges this Mac"
```

---

### Task 4: wire converge to `convergeOrgFolder`

**Files:**
- Modify: `commands/team.ts`
- Test: `commands/__tests__/team-rename.test.ts`

**Precondition:** `git fetch origin converge && git show origin/converge:lib/setup/steps/org-folder.ts | grep -n "export async function convergeOrgFolder"` prints the function. If it does not, stop and ask through `herd_ask` (wait for the converge branch, or ship with the placeholder).

**Interfaces:**
- Consumes: `convergeOrgFolder(ctx: ApplyContext): Promise<StepOutcome>` from `lib/setup/steps/org-folder.ts`; `createApplyContext` from `lib/setup/apply.ts`.
- Produces: `realRenameSeams(deps).converge` running the real step; a shared `applyContextFor(deps: TeamDeps)` helper used by both `installPack` (in `realUseTeamSeams`) and converge.

- [ ] **Step 1: Merge the converge branch**

```bash
git fetch origin converge
git merge --no-edit origin/converge
```
Resolve any conflict in favor of both sides; then `bun run typecheck`.

- [ ] **Step 2: Write the failing test** (append)

```ts
import { realTeamDeps } from "../team.ts";
import * as orgFolder from "../../lib/setup/steps/org-folder.ts";

test("the real converge seam runs the org.folder step", async () => {
  const w = orgWorld();
  const spy = spyOn(orgFolder, "convergeOrgFolder").mockResolvedValue({ state: "done", detail: "Moved acme" });
  try {
    const lines: string[] = [];
    await teamRename(["gadgets", "--json"], {}, { ...realTeamDeps(), probes: w.p, print: (s) => lines.push(s), forgeToken: async () => null });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ converged: true });
  } finally { spy.mockRestore(); }
});
```

If `spyOn` cannot intercept the dynamic import's binding, use the converge branch's own `orgFolderSeams` seams instead (stub `locate` and `marketplace`) and assert the folder moved to `orgs/gadgets`.

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test commands/__tests__/team-rename.test.ts`
Expected: FAIL, the spy is never called (placeholder seam).

- [ ] **Step 4: Implement**

Extract from `realUseTeamSeams.installPack`:

```ts
async function applyContextFor(deps: TeamDeps): Promise<ApplyContext> {
  const { createApplyContext } = await import("../lib/setup/apply.ts");
  const { createRealSecretsExecSeam } = await import("../lib/secrets/store.ts");
  const { realSecretPresence } = await import("../lib/setup/plan.ts");
  return createApplyContext({
    probes: deps.probes,
    emit: () => {},
    secrets: deps.secrets ?? { ageKeySeam: deps.ageKeySeam ?? createRealAgeKeySeam(), execSeam: createRealSecretsExecSeam() },
    relay: createRelayClient(deps.probes.fetch, switchboardUrl(deps.probes.env)),
    secretPresence: deps.secretPresence ?? realSecretPresence(),
    flags: { nonInteractive: true, teamOfOne: false, ci: false, update: true },
  });
}
```

`installPack` calls `applyContextFor(deps)`. Replace `convergeLater` with:

```ts
async function convergeHere(deps: TeamDeps): Promise<ConvergeOutcome> {
  const { convergeOrgFolder } = await import("../lib/setup/steps/org-folder.ts");
  return convergeOrgFolder(await applyContextFor(deps));
}
```

and `realRenameSeams` uses `converge: () => convergeHere(deps)`. Import `type ApplyContext` from `../lib/setup/apply.ts` as a type-only import.

- [ ] **Step 5: Run the tests and gates**

```bash
bun test commands/__tests__/team-rename.test.ts lib/team/__tests__/rename.test.ts commands/__tests__/team.test.ts
bun run typecheck
```
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add commands/team.ts commands/__tests__/team-rename.test.ts
git commit -m "team: rename converges this Mac through the org.folder step"
```

---

### Task 5: verification

- [ ] `bun run typecheck`
- [ ] `bun test lib/__tests__` (the `no-*` guards, including no-raw-output and no-legacy-teams-root)
- [ ] `bun run picker:check`
- [ ] `bun run check`
- [ ] `grep -rnP "[\x{2013}\x{2014}]" lib/team/rename.ts commands/team.ts commands/__tests__/team-rename.test.ts lib/team/__tests__/rename.test.ts docs/superpowers/plans/2026-10-07-team-rename.md` prints nothing (use `rg` if BSD grep lacks `-P`).
