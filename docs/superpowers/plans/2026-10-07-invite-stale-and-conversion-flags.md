# Invite-stale refusal and conversion flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt team join` refuses an invite whose org slug no longer matches the cloned org's marker, leaving nothing behind, and the team-to-org conversion script takes `--org <name>` and `--org-placeholder`.

**Architecture:** Join reads `mattstack/mattstack.jsonc` from the fresh clone right after `git clone`, before the roster check; on a mismatch it removes the clone, restores the per-org record and the setup intent to what they were before this call, and throws a `UserActionableError` with code `invite-stale`, which `commands/team.ts` draws as a refused note. The conversion planner separates the org's name (written into the marker) from the clone's folder name (the match key for `${team:<folder>}` in old values) and can write `${org}` instead of `${team:<folder>}`.

**Tech Stack:** Bun, TypeScript, `bun:test`, real git in temp dirs for the end-to-end-ish tests.

**Spec:** `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-mattstack/gilraen/docs/superpowers/specs/2026-10-06-orgs-root-design.md`, sections 5, 6 and their lines in section 10. Read-only; it lives in another branch's worktree.

## Global Constraints

- This branch is off `main` and still clones under `~/.mattstack/teams/<slug>`; build against that. Sections 3 (folder move) and 4 (`rt team rename`) are other PRs: do not build them, and do not add `${org}` to the resolver.
- Refusal code is exactly `invite-stale`; message is exactly `This invite names the org by an old name; ask for a fresh one`.
- Join's `--json` envelope keeps its shape: a new error code is fine, keys and existing codes never change.
- A refusal by policy is drawn as a `refused` note (add the code to `REFUSAL_CODES` in `commands/team.ts`), never a failure block. Exit code stays 2.
- No em or en dashes anywhere (code, comments, tests, plan, PR body).
- Placeholder names only in committed text and fixtures: acme, globex, widgets, gadgets, dev1, dev2, gitlab.example.com.
- Comments only state a constraint the code cannot show.
- Run `bun test <file>` from the repo root only, targeted files, never the full suite locally.
- A test that spawns a child passes `childEnv()`; a test that uses real probes sets `process.env.HOME` to a temp dir and restores it.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions this plan makes (flag at review)

1. **Only a fresh clone is checked.** When the org folder was already on this Mac (`alreadyCloned`, the resume path), join never removes it: removing a folder this call did not create could destroy a working org.
2. **Only an org marker is compared.** The check fires when the marker parses, has `role: "org"` and a string `org` that differs from `pointer.team`, the same reading `orgOfPackDir` uses. A missing, unparsable or non-org marker falls through to today's behavior (the roster check), so existing joins and fixtures are untouched.
3. **"No record behind" means both records join wrote before cloning go back to what they were.** `~/.mattstack/rt/teams/<slug>.json`: removed when it did not exist before this call, otherwise `joinedByRt` restored (the existing clone-failure path's rule). `~/.mattstack/rt/setup-intent.json`: removed when it did not exist before this call, otherwise its prior bytes are written back verbatim, even when they are this same invite's join intent. Clearing that intent would break the setup app: `teamJoinRun` (`lib/setup/steps/team.ts`) resumes from it, and with it gone the next Retry reports "Already joined" and the step drops out, so the wizard would look joined when it is not. Kept, the row keeps showing the refusal until a fresh code's dry run overwrites the intent.
7. **The error carries a `why`** ("The org was renamed after this invite was made; a fresh invite from your admin joins it."), so the setup row's remedy (`remedyFrom` in `lib/setup/steps/team.ts`, outside this branch's fence) and the refused note both say what to do.
4. **`--org-placeholder` rewrites every `${team:<folder>}`**, not only the moved paths, so the converted stores never mix the two forms for an org whose members all run the new rt.
5. **`--org` is validated in the script** with `validateSlug` (`lib/secrets/store.ts`, the rule `orgOfPackDir` applies to a marker's `org`) and refused as a usage failure. Without `--org`, the basename keeps today's looser folder-name check.
6. **The marketplace-name fallback stays the folder name**, since it names the plugin id already installed on Macs.

## Review Focus

1. A pointer slug that matches the marker exactly: join proceeds as today (pinned by existing tests plus one explicit test).
2. A marker written as JSONC with a comment: still read, still refused (Task 1 test uses a comment).
3. A prior record with other fields (`forgeUsername`) for the same slug: survives the refusal (Task 1 test).
4. A prior intent for a different invite: restored byte for byte, not cleared (Task 1 test).
5. `--org` given twice, or with a value starting `--`: usage failure, nothing written (Task 4 test).
6. The setup app resuming a join with no code from this invite's own saved intent: after the refusal the intent is still there byte for byte (Task 1 test).

---

## File Structure

- Modify `lib/team/join.ts`: a `clonedOrgName(p, dir)` helper and the refusal right after the fresh clone in `joinRedeem`; capture the prior intent bytes and prior record existence before they are written.
- Modify `lib/team/__tests__/join.test.ts`: fake-probe tests and one real-git test.
- Modify `commands/team.ts`: `"invite-stale"` in `REFUSAL_CODES`.
- Modify `commands/__tests__/team-join.test.ts`: refused note and `--json` envelope.
- Modify `scripts/lib/convert-team-repo.ts`: `ConvertOpts.folder`, `ConvertOpts.orgPlaceholder`.
- Modify `scripts/convert-team-repo-to-org.ts`: `--org`, `--org-placeholder`, usage string.
- Modify `scripts/__tests__/convert-team-repo.test.ts`: planner tests and wrapper tests.

---

### Task 1: join refuses a stale invite and leaves nothing behind

**Files:**
- Modify: `lib/team/join.ts` (imports; `joinRedeem` around the `writeIntent` call and the `else` clone branch)
- Test: `lib/team/__tests__/join.test.ts`

**Interfaces:**
- Produces: `UserActionableError` with `code === "invite-stale"`, `message === "This invite names the org by an old name; ask for a fresh one"`, thrown from `joinRedeem`.

- [ ] **Step 1: Write the failing fake-probe tests**

Add inside `describe("joinRedeem", ...)` in `lib/team/__tests__/join.test.ts` (it already has `redeemProbes`, `fakeRelay`, `baseJoinRedeemSeams`, `NO_SECRETS`, `TEAM_DIR`, `POINTER`, `CODE`, `ID_HEX`; add `teamLocalPath` is already imported; import `intentPath`/`readIntent` already exist):

```ts
  describe("an invite naming the org by an old name", () => {
    const MARKER = `${TEAM_DIR}/mattstack/mattstack.jsonc`;
    const renamed = { [MARKER]: `// org marker\n{ "role": "org", "org": "globex" }` };

    async function refusal(p: ReturnType<typeof redeemProbes>, relay = fakeRelay()): Promise<UserActionableError> {
      const err = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, baseJoinRedeemSeams().seams).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(UserActionableError);
      return err as UserActionableError;
    }

    test("is refused as invite-stale before the roster pull or the redeem", async () => {
      const p = redeemProbes({ files: renamed });
      const relay = fakeRelay();
      const err = await refusal(p, relay);
      expect(err.code).toBe("invite-stale");
      expect(err.message).toBe("This invite names the org by an old name; ask for a fresh one");
      expect(relay.redeemCalls).toEqual([]);
      expect(p.calls.exec.some((argv) => argv.includes("pull"))).toBe(false);
    });

    test("removes the fresh clone, writes no record and leaves no intent", async () => {
      const p = redeemProbes({ files: renamed });
      await refusal(p);
      expect(p.exists(MARKER)).toBe(false);
      expect(p.exists(ORG_STORE)).toBe(false);
      expect(p.exists(teamLocalPath(HOME, POINTER.team))).toBe(false);
      expect(readIntent(p)).toBeNull();
    });

    test("a prior record for the slug keeps its fields and its joinedByRt", async () => {
      const p = redeemProbes({ files: { ...renamed, [teamLocalPath(HOME, POINTER.team)]: JSON.stringify({ joinedByRt: false, forgeUsername: "dev1" }) } });
      await refusal(p);
      const record = readTeamLocal(p, POINTER.team);
      expect(record.joinedByRt).toBe(false);
      expect(record.forgeUsername).toBe("dev1");
    });

    test("an intent for a different invite is put back byte for byte", async () => {
      const prior = JSON.stringify({ v: 1, at: "2026-08-01T00:00:00.000Z", mode: "create", team: { slug: "gadgets", name: "Gadgets", remote: "https://github.com/acme/gadgets.git", others: false } });
      const p = redeemProbes({ files: { ...renamed, [intentPath(HOME)]: prior } });
      await refusal(p);
      expect(p.readFile(intentPath(HOME))).toBe(prior);
    });

    test("this invite's own saved join intent survives, so the setup app's resume keeps showing the refusal", async () => {
      const saved = JSON.stringify({ v: 1, at: "2026-08-01T00:00:00.000Z", mode: "join", join: { id: ID_HEX, keyB64: Buffer.from(KEY).toString("base64"), pointer: POINTER } });
      const p = redeemProbes({ files: { ...renamed, [intentPath(HOME)]: saved } });
      const err = await joinRedeem(p, fakeRelay().client, () => NO_SECRETS, {}, baseJoinRedeemSeams().seams).then(() => null, (e: unknown) => e);
      expect((err as UserActionableError).code).toBe("invite-stale");
      expect(p.readFile(intentPath(HOME))).toBe(saved);
    });

    test("a marker naming the pointer's own org joins as before", async () => {
      const p = redeemProbes({ files: { [MARKER]: `{ "role": "org", "org": "acme" }` } });
      const result = await joinRedeem(p, fakeRelay().client, () => NO_SECRETS, { code: CODE }, baseJoinRedeemSeams().seams);
      expect(result.access).toBe("ok");
    });

    test("an org folder already on this Mac is never removed, whatever its marker says", async () => {
      const p = redeemProbes({ files: { ...renamed, [`${TEAM_DIR}/.git/config`]: gitConfigWithRemote(REMOTE) } });
      const result = await joinRedeem(p, fakeRelay().client, () => NO_SECRETS, { code: CODE }, baseJoinRedeemSeams().seams);
      expect(result.access).toBe("ok");
      expect(p.exists(MARKER)).toBe(true);
    });
  });
```

Note: the fake clone `exec` writes nothing, so the marker is seeded up front; `TEAM_DIR` has no `.git/config`, so `joinRedeem` still takes the clone branch.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/team/__tests__/join.test.ts -t "old name"`
Expected: the refusal tests FAIL (join returns `access: "ok"`); the two pass-through tests PASS.

- [ ] **Step 3: Implement the refusal**

In `lib/team/join.ts`:

Imports: add `import { stripJsonc } from "../jsonc.ts";`, add `intentPath` to the `../setup/intent.ts` import, and `teamLocalPath` to the `./team-local.ts` import.

Helper near `readOrigin`:

```ts
/** The org a clone's marker names, or null when the marker is absent, unparsable or not an org marker. */
function clonedOrgName(p: Pick<Probes, "readFile">, dir: string): string | null {
  const raw = p.readFile(join(dir, "mattstack", "mattstack.jsonc"));
  if (raw === null) return null;
  try {
    const marker = JSON.parse(stripJsonc(raw)) as { role?: unknown; org?: unknown } | null;
    return marker?.role === "org" && typeof marker.org === "string" ? marker.org : null;
  } catch {
    return null;
  }
}
```

In `joinRedeem`, immediately before `writeIntent(...)`:

```ts
  const priorIntent = p.readFile(intentPath(p.home));
```

Immediately before `const priorLocal = readTeamLocal(p, pointer.team);`:

```ts
  const priorRecordExists = p.exists(teamLocalPath(p.home, pointer.team));
```

In the `else` (fresh clone) branch, after the `if (clone.code !== 0) { ... }` block:

```ts
    const cloned = clonedOrgName(p, dir);
    if (cloned !== null && cloned !== pointer.team) {
      p.removeDir(dir);
      if (priorRecordExists) updateTeamLocal(p, pointer.team, { joinedByRt: priorJoined });
      else p.removeFile(teamLocalPath(p.home, pointer.team));
      if (priorIntent !== null) p.writeFile(intentPath(p.home), priorIntent, 0o600);
      else clearIntent(p);
      throw new UserActionableError("invite-stale", "This invite names the org by an old name; ask for a fresh one", {}, {
        why: "The org was renamed after this invite was made; a fresh invite from your admin joins it.",
        log: `the invite names ${pointer.team}; the org repo's marker names ${cloned}`,
      });
    }
```

The intent goes back exactly as it was before this call: absent stays absent, present gets its captured bytes, including this same invite's join intent (the setup app resumes from it; see Decision 3).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/team/__tests__/join.test.ts`
Expected: all PASS (the whole file: existing clone-failure and remote-mismatch tests must not move).

- [ ] **Step 5: Write the real-git test**

At the bottom of `lib/team/__tests__/join.test.ts`, beside the existing real-probes test. Imports to add: `execFileSync` from `child_process`; `existsSync`, `mkdirSync`, `writeFileSync` from `fs`; `childEnv` from `../../subprocess.ts`.

```ts
test("a real clone whose marker names another org is removed, with no record and no intent left", async () => {
  const home = mkdtempSync(pathJoin(tmpdir(), "join-stale-"));
  const priorHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const env = { ...childEnv(), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
    const work = pathJoin(home, "work");
    mkdirSync(pathJoin(work, "mattstack", "org"), { recursive: true });
    writeFileSync(pathJoin(work, "mattstack", "mattstack.jsonc"), `{ "role": "org", "org": "globex" }\n`);
    writeFileSync(pathJoin(work, "mattstack", "org", "settings.org.jsonc"), rosterWith("dev2"));
    const bare = pathJoin(home, "origin.git");
    execFileSync("git", ["init", "-q", "-b", "main", work], { env });
    execFileSync("git", ["-C", work, "add", "."], { env });
    execFileSync("git", ["-C", work, "commit", "-q", "-m", "org"], { env });
    execFileSync("git", ["clone", "-q", "--bare", work, bare], { env });

    const p = createRealProbes();
    const realExec = p.exec.bind(p);
    // The pointer's remote must be an https url; the clone itself reads the local bare repo.
    p.exec = (argv, opts) => realExec(argv.map((arg) => (arg === REMOTE ? bare : arg)), opts);

    const err = await joinRedeem(p, fakeRelay().client, () => NO_SECRETS, { code: CODE }, baseJoinRedeemSeams().seams).then(() => null, (e: unknown) => e);

    expect((err as UserActionableError).code).toBe("invite-stale");
    expect(existsSync(pathJoin(home, ".mattstack", "teams", "acme"))).toBe(false);
    expect(existsSync(teamLocalPath(home, "acme"))).toBe(false);
    expect(existsSync(intentPath(home))).toBe(false);
  } finally {
    if (priorHome === undefined) delete process.env.HOME; else process.env.HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6: Run it**

Run: `bun test lib/team/__tests__/join.test.ts -t "real clone"`
Expected: PASS. If it fails, confirm the clone ran (temporarily drop the marker and expect the folder to exist) before changing join.

- [ ] **Step 7: Commit**

```bash
git add lib/team/join.ts lib/team/__tests__/join.test.ts
git commit -m "join: refuse an invite that names the org by an old name

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `rt team join` draws invite-stale as a refusal

**Files:**
- Modify: `commands/team.ts` (`REFUSAL_CODES`, around line 163)
- Test: `commands/__tests__/team-join.test.ts`

**Interfaces:**
- Consumes: `invite-stale` from Task 1.

- [ ] **Step 1: Write the failing tests**

Add in `describe("teamJoin", ...)`. The suite's `fakeProbes` seeds the org store at `${HOME}/.mattstack/teams/acme/...`; add the marker beside it:

```ts
  const staleMarker = { [`${HOME}/.mattstack/teams/acme/mattstack/mattstack.jsonc`]: `{ "role": "org", "org": "globex" }` };

  test("an invite naming the org by an old name is refused, not failed", async () => {
    const deps = baseDeps({ probes: fakeProbes({ home: HOME, fetch: relayFetch(), exec: () => ({ code: 0, stdout: "", stderr: "" }), files: staleMarker }) });
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => teamJoin([], {}, deps));
      expect(code).toBe(2);
      expect(io.stderr()).toStartWith("[refused] This invite names the org by an old name; ask for a fresh one\n  why: The org was renamed after this invite was made; a fresh invite from your admin joins it.\n");
    } finally {
      io.restore();
    }
  });

  test("--json carries invite-stale in the usual error envelope", async () => {
    const deps = baseDeps({ probes: fakeProbes({ home: HOME, fetch: relayFetch(), exec: () => ({ code: 0, stdout: "", stderr: "" }), files: staleMarker }) });
    const code = await runExpectingProcessExit(() => teamJoin(["--json"], {}, deps));
    expect(code).toBe(2);
    const body = JSON.parse(deps.lines[0]!);
    expect(body.error.code).toBe("invite-stale");
    expect(body.error.message).toBe("This invite names the org by an old name; ask for a fresh one");
  });
```

Before writing, read the existing `"a second team exits 2 ..."` and `"a code on argv is refused, not failed"` tests and match their envelope keys and stderr assertions exactly (the envelope test above must assert the same keys those tests do, nothing new).

- [ ] **Step 2: Run to verify the refused test fails**

Run: `bun test commands/__tests__/team-join.test.ts -t "old name"`
Expected: FAIL: stderr starts with a failure block, not `[refused]`. The `--json` test may already pass (the envelope route ignores `REFUSAL_CODES`).

- [ ] **Step 3: Add the code**

In `commands/team.ts`, add `"invite-stale",` to `REFUSAL_CODES` after `"team-remote-mismatch",`.

- [ ] **Step 4: Run to verify**

Run: `bun test commands/__tests__/team-join.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add commands/team.ts commands/__tests__/team-join.test.ts
git commit -m "team join: draw a stale invite as a refusal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: the planner separates the org name from the folder and can write `${org}`

**Files:**
- Modify: `scripts/lib/convert-team-repo.ts` (`ConvertOpts`, the name check at the top of `planConversion`, `marketName`, the `clone`/`swaps` block, the marker write)
- Test: `scripts/__tests__/convert-team-repo.test.ts` (`describe("planConversion")`)

**Interfaces:**
- Produces:
  ```ts
  export interface ConvertOpts {
    /** The org's name: written into the marker. */
    org: string;
    /** The clone's folder name, the key `${team:<folder>}` matches in old values. Defaults to `org`. */
    folder?: string;
    /** Write `${org}` instead of `${team:<folder>}` into the converted stores. */
    orgPlaceholder?: boolean;
    admin: string;
    team?: string;
    teamRepos?: string[];
  }
  ```

- [ ] **Step 1: Write the failing tests**

The fixture's old store has `"rt.roles": { dev: { hook: "${team:acme}/mattstack/packs/widgets/hooks/dev.sh" } }` under `repos[SHARED]`. Add in `describe("planConversion")`:

```ts
  test("--org names the org in the marker while the folder stays the match key", () => {
    const plan = run(oldClone(), { org: "globex", folder: "acme" });
    expect(JSON.parse(plan.writes["mattstack/mattstack.jsonc"]!)).toEqual({ role: "org", org: "globex" });
    const org = settings(plan.writes["mattstack/org/settings.org.jsonc"]!);
    expect(org.repos[SHARED]["rt.roles"].dev.hook).toBe("${team:acme}/mattstack/teams/widgets/packs/widgets/hooks/dev.sh");
  });

  test("without a folder the org is the folder, as before", () => {
    const org = settings(run().writes["mattstack/org/settings.org.jsonc"]!);
    expect(org.repos[SHARED]["rt.roles"].dev.hook).toBe("${team:acme}/mattstack/teams/widgets/packs/widgets/hooks/dev.sh");
  });

  test("orgPlaceholder writes ${org} into rewritten paths and every other ${team:<folder>} value", () => {
    const input = oldClone();
    const store = settings(input.files["mattstack/settings.team.jsonc"]!.replace(/^\/\/.*\n/, ""));
    store.repos[OWN]["rt.roles"] = { dev: { hook: "${team:acme}/scripts/dev.sh" } };
    input.files["mattstack/settings.team.jsonc"] = JSON.stringify(store);
    const plan = run(input, { org: "globex", folder: "acme", orgPlaceholder: true });
    const org = settings(plan.writes["mattstack/org/settings.org.jsonc"]!);
    const team = settings(plan.writes["mattstack/teams/widgets/settings.team.jsonc"]!);
    expect(org.repos[SHARED]["rt.roles"].dev.hook).toBe("${org}/mattstack/teams/widgets/packs/widgets/hooks/dev.sh");
    expect(team.repos[OWN]["rt.roles"].dev.hook).toBe("${org}/scripts/dev.sh");
    expect(JSON.stringify(plan.writes)).not.toContain("${team:acme}");
  });

  test("orgPlaceholder leaves another folder's ${team:<name>} alone", () => {
    const input = oldClone();
    const store = settings(input.files["mattstack/settings.team.jsonc"]!.replace(/^\/\/.*\n/, ""));
    store.repos[OWN]["rt.roles"] = { dev: { hook: "${team:acme-tools}/dev.sh" } };
    input.files["mattstack/settings.team.jsonc"] = JSON.stringify(store);
    const team = settings(run(input, { orgPlaceholder: true }).writes["mattstack/teams/widgets/settings.team.jsonc"]!);
    expect(team.repos[OWN]["rt.roles"].dev.hook).toBe("${team:acme-tools}/dev.sh");
  });

  test("an unsafe folder name is refused like an unsafe org name", () => {
    expect(() => run(oldClone(), { folder: "../x" })).toThrow("Choose a safe org folder name");
  });
```

Check the fixture's `repos[OWN]` shape before relying on it (it has `"rt.branchNaming"`); adding `"rt.roles"` beside it is fine.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test scripts/__tests__/convert-team-repo.test.ts -t "planConversion"`
Expected: the new tests FAIL (marker says `acme`, no `${org}`); existing tests PASS.

- [ ] **Step 3: Implement**

In `scripts/lib/convert-team-repo.ts`:

- Extend `ConvertOpts` as in **Interfaces**.
- At the top of `planConversion`:
  ```ts
  const folder = opts.folder ?? opts.org;
  for (const name of [opts.org, folder]) if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error("Choose a safe org folder name");
  ```
  replacing the single `opts.org` check.
- `const marketName = typeof market.name === "string" ? market.name : folder;`
- Replace the `clone`/`swaps` block:
  ```ts
  const from = `\${team:${folder}}`;
  const to = opts.orgPlaceholder ? "${org}" : from;
  const swaps: [string, string][] = [
    [`${from}/mattstack/packs/${pack}`, `${to}/mattstack/teams/${team}/packs/${team}`],
    ...input.packs.filter(isBase).map((base): [string, string] => [`${from}/mattstack/packs/${base}`, `${to}/mattstack/org/packs/${base}`]),
    [`${from}/mattstack/secrets`, `${to}/mattstack/org/secrets`],
    ...(opts.orgPlaceholder ? [[from, to] as [string, string]] : []),
  ];
  ```
  The last swap catches every remaining `${team:<folder>}`; `rewritePaths`' trailing guard plus the closing brace keep it from matching `${team:<folder>-x}`.
- The marker write keeps `opts.org`.
- When `opts.org !== folder`, push a report line: `` `the marker names the org ${opts.org}; old values still match \${team:${folder}}` ``.

- [ ] **Step 4: Run to verify**

Run: `bun test scripts/__tests__/convert-team-repo.test.ts -t "planConversion"`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/convert-team-repo.ts scripts/__tests__/convert-team-repo.test.ts
git commit -m "convert: name the org apart from its folder, and offer \${org}

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: the script takes `--org` and `--org-placeholder`

**Files:**
- Modify: `scripts/convert-team-repo-to-org.ts` (`USAGE`, argument loop, the admin check block, the `planConversion` call)
- Test: `scripts/__tests__/convert-team-repo.test.ts` (`describe("the wrapper")`)

**Interfaces:**
- Consumes: `ConvertOpts.folder`, `ConvertOpts.orgPlaceholder` from Task 3; `validateSlug` from `lib/secrets/store.ts` (throws on a bad slug).

- [ ] **Step 1: Write the failing wrapper tests**

In `describe("the wrapper")` (it has `ready`, `tempClone`, `runScript`, `snapshot`; the clone folder is `acme`):

```ts
  test("--org writes that name into the marker and keeps ${team:<folder>} in old values", () => {
    ready();
    const dir = tempClone();
    const out = runScript(dir, "--org", "globex", "--write", "--roster-confirmed");
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "mattstack", "mattstack.jsonc"), "utf8"))).toEqual({ role: "org", org: "globex" });
    expect(readFileSync(join(dir, "mattstack", "org", "settings.org.jsonc"), "utf8")).toContain("${team:acme}/mattstack/teams/widgets/packs/widgets/hooks/dev.sh");
  });

  test("--org-placeholder writes ${org}", () => {
    ready();
    const dir = tempClone();
    expect(runScript(dir, "--org-placeholder", "--write", "--roster-confirmed").exitCode).toBe(0);
    const org = readFileSync(join(dir, "mattstack", "org", "settings.org.jsonc"), "utf8");
    expect(org).toContain("${org}/mattstack/teams/widgets/packs/widgets/hooks/dev.sh");
    expect(org).not.toContain("${team:acme}");
  });

  test("an --org that breaks the slug rule, or a second --org, is a usage failure and changes nothing", () => {
    const dir = tempClone();
    const before = snapshot(dir);
    for (const extra of [["--org", "Globex"], ["--org", "globex", "--org", "gadgets"], ["--org", "--write"]]) {
      const out = runScript(dir, ...extra);
      expect(out.exitCode).toBe(2);
      expect(snapshot(dir)).toBe(before);
    }
  });
```

Read the `snapshot` helper's return type first; if it returns an object, compare with `toEqual`.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test scripts/__tests__/convert-team-repo.test.ts -t "org"`
Expected: FAIL (the script calls `--org` an unknown argument and exits 2 on the first two tests).

- [ ] **Step 3: Implement**

In `scripts/convert-team-repo-to-org.ts`:

- Import `validateSlug` from `../lib/secrets/store.ts`.
- `USAGE`: `"bun scripts/convert-team-repo-to-org.ts <clone-dir> --admin <username> [--org <name>] [--org-placeholder] [--team <name>] [--team-repo <identity>]... [--write --roster-confirmed]"`.
- In the loop, `["--write", "--roster-confirmed", "--org-placeholder"]` are switches and `["--admin", "--org", "--team", "--team-repo"]` take values.
- After the admin check:
  ```ts
  const org = values["--org"]?.[0];
  if ((values["--org"]?.length ?? 0) > 1) {
    out.fail(usageFailure("Name the org once", USAGE));
    process.exit(2);
  }
  if (org !== undefined) {
    try {
      validateSlug(org);
    } catch {
      out.fail(usageFailure("Choose an org name of lowercase letters, digits and dashes", USAGE));
      process.exit(2);
    }
  }
  ```
- The plan call: `{ org: org ?? basename(clone), folder: basename(clone), orgPlaceholder: switches.has("--org-placeholder"), admin, team: values["--team"]?.[0], teamRepos: values["--team-repo"] }`.
- `readForgeUsername(basename(clone))` stays on the folder (the record is keyed by folder).

- [ ] **Step 4: Run the whole file**

Run: `bun test scripts/__tests__/convert-team-repo.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/convert-team-repo-to-org.ts scripts/__tests__/convert-team-repo.test.ts
git commit -m "convert: take --org and --org-placeholder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: branch verification

- [ ] `bun run typecheck`: clean.
- [ ] `bun test lib/team/__tests__/join.test.ts commands/__tests__/team-join.test.ts scripts/__tests__/convert-team-repo.test.ts`: all pass.
- [ ] `bun test lib/__tests__`: the `no-*` guards pass (raw output, no dashes in copy, purity).
- [ ] `bun run check`: passes.
- [ ] `rg -n '[\x{2013}\x{2014}]' $(git diff --name-only main...HEAD)`: no matches.
