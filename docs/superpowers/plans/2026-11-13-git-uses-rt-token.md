# git and the forge CLIs use rt's token: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt sync`, `rt git rebase` and `rt git reset` reach origin with rt's forge token when git's own auth fails, the stack check passes that token to glab and gh, SSH failures name the key, and a new opt-in `rt git auth` wires a clone to rt's helper for every git.

**Architecture:** `commands/git/origin-auth.ts` owns every decision about offering rt's token to git: the effective origin URL, the host gate, the single token read per run, the one-run helper env and the prompt guard. `commands/git/clone-state.ts` classifies a clone (the `--check` table), and is shared by `fetchOrigin`'s SSH offer, `rt git auth` and the register note. `fetchOrigin` and a new `pushOrigin` in `commands/git/shared.ts` retry once through rt's helper; `syncBranch` and the rebase and reset handlers set the prompt guard first. `commands/git/auth.ts` is the new verb. The stack guard gets an optional token seam that only `rt sync` passes.

**Tech Stack:** Bun, TypeScript, `bun:test`, git's credential helper protocol and `GIT_CONFIG_*` env.

**Spec:** `docs/superpowers/specs/2026-11-12-git-uses-rt-token-design.md`

## Global Constraints

- No token in git config, a URL, argv, a log line, an error message, a `--json` envelope, or an env var on any git path. The only token-carrying env is glab's `GITLAB_TOKEN` and gh's `GH_TOKEN` in the stack check (spec section 6).
- The token goes only to github.com, gitlab.com or `rt.integrations.forgeHost` (`readUserIntegrationOverrides().forgeHost`), never over `http://`; a GitLab token never to github.com (`mayOfferGitLabToken`), a GitHub token never to a GitLab host. A confirmed host must also be one rt's forge detection recognises (`forgeFromHost`: github.com, or a host matching `gitlab.`), since `forgeTokenKey` has no token for any other; tests use `gitlab.acme.internal` as the confirmed self-hosted host.
- rt changes a clone's config or origin URL only after a y/n at a terminal or `--yes`; never global config.
- The helper pair is always two values for `credential.https://<host>.helper`: `""` then the helper.
- Output only through `lib/ui/out.ts`; refusals via `refuseWith` / `refusalNote`; failures via `failWith` / `failPlain`; the sync API returns `failure` and never prints it; a failed `rt sync --json` ends with one failure in at most three lines (`compactFailure`). No `console.*`. `FailureInput.next` is one row: two commands share it with a joining phrase.
- No `@{u}`. No em or en dashes in code, copy, comments or commits.
- Tests run from the worktree root with an isolated HOME and temp git repos; no live forge, no real `~/.gitconfig` or `~/.mattstack`. No test points a remote git really contacts at an `https://` forge URL: tests that need a passing gate inject a fake `OriginAuth`, or keep a local fetch URL and set an https `remote.origin.pushurl`. Any test that changes `process.env` restores it. The fake token everywhere is `glpat-LEAKCHECK000000000` (long enough for `redactCredentials`' token pattern); leak checks assert `LEAKCHECK` is absent.
- Copy for every new line goes through `rt:ui-copy`; it says "this run", never "this sync".
- Write fence: `commands/sync.ts`, `commands/git/**`, `lib/stack-guard.ts`, `lib/team/forge.ts`, `lib/worktree/fetch-auth.ts`, `commands/repos.ts`, `lib/command-tree-def.ts` and `lib/module-registry.ts` (the `auth` node only), their tests, `sites/docs/docs/rt/reference/**`.

## Review Focus

1. **`GIT_CONFIG_COUNT` already set** (the branch_sync outer retry, or the user's shell): rt's two pairs land at the next free indexes and the existing pairs survive. A non-numeric count is treated as 0. Test in Task 1.
2. **A token never leaks through a failure**: a second auth failure, a refused push and a stack check failure whose CLI echoes the token all carry no token value. Tests in Tasks 3, 4 and 6.
3. **`rt sync all` across several worktrees**: the prompt guard is restored after each `syncBranch`, so one worktree's decision never leaks into the next, and the note names only the worktrees that needed the token. Test in Task 4.
4. **The token store cannot be read** (sops or keychain error): no prompt guard, no retry, the stack check uses the CLI's own login, and `--check` shows `skipped` "rt could not read its token store". Tests in Tasks 1, 2 and 6.
5. **SSH URL shapes**: `git@host:group/sub/repo` (no `.git`), `ssh://git@host:2222/group/repo.git` (port dropped), an SSH alias whose ssh config `HostName` is a forge (mapped through it) and one whose is not (refused as `unmappable-ssh`). Tests in Tasks 1 and 8.

---

### Task 1: `origin-auth.ts`, the one place that decides about rt's token

**Files:**
- Create: `commands/git/origin-auth.ts`
- Test: `commands/git/__tests__/origin-auth.test.ts`
- Modify (tests only): `commands/git/__tests__/credential.test.ts`

**Interfaces:**
- Consumes: `forgeTokenLookupForGit`, `mayOfferToken`, `mayOfferGitLabToken`, `type ForgeTokenLookup` (`lib/team/forge-token.ts`); `forgeTokenKey` (`lib/team/git-credential.ts`); `forgeFromRemote`, `forgeFromHost`, `hostFromRemote`, `readUserIntegrationOverrides` (`lib/setup/team-settings.ts`); `parseRemoteUrl`, `resolveSshAlias`, `setSshHostResolver` (tests) (`lib/enrich.ts`); `rtSelfArgv` (`lib/rt-self.ts`); `shellQuote` (`lib/herdr-launch.ts`); `createRealProbes` (`lib/setup/probes.ts`); `runGit` (`lib/worktree/git-async.ts`).
- Produces:
  ```ts
  export type Forge = "gitlab" | "github";
  export interface OriginAuthSeams {
    confirmedHost(): string | null;
    lookup(remote: string): Promise<ForgeTokenLookup>;
  }
  export type SkipReason = "no-origin" | "http" | "ssh" | "not-https" | "not-forge" | "unconfirmed" | "no-token" | "unreadable";
  export type OriginAuthVerdict =
    | { ok: true; url: string; host: string; forge: Forge }
    | { ok: false; reason: SkipReason; url: string | null; host: string | null; forge: Forge | null };
  export interface OriginAuth {
    /** One read per forge per run; a thrown lookup reads as `unreadable`. */
    tokenFor(remote: string): Promise<ForgeTokenLookup>;
    confirmedHost(): string | null;
    /** The section 1 checks, in order, on a URL git would use. Never returns the token. */
    verdict(url: string | null): Promise<OriginAuthVerdict>;
    /** `git remote get-url [--push] origin` (applies insteadOf), then `verdict`. */
    forOrigin(cwd: string, push: boolean): Promise<OriginAuthVerdict>;
    /** Decides once for the fetch URL and, when `push`, the push URL; either passing sets the prompt guard. Returns its undo. */
    guardPrompts(cwd: string, opts: { push: boolean }): Promise<() => void>;
  }
  export function createOriginAuth(seams?: OriginAuthSeams | null): OriginAuth;
  export function defaultOriginAuthSeams(): OriginAuthSeams | null;
  export function rtSelfHelper(argv?: string[]): string;
  export function helperEnv(host: string, base: NodeJS.ProcessEnv, helper?: string): NodeJS.ProcessEnv;
  /** An SSH origin's HTTPS URL, its host resolved through ssh config; null for a non-SSH URL or a host that is not a forge. */
  export function sshToHttps(url: string): Promise<string | null>;
  export function forgeName(forge: Forge): "GitLab" | "GitHub";
  ```

- [ ] **Step 1: Write the failing tests**

`origin-auth.test.ts`, with a fake `OriginAuthSeams` (`confirmedHost` returns `"gitlab.acme.internal"`, `lookup` counts calls and returns `{ kind: "token", token: "glpat-LEAKCHECK000000000" }` unless a test overrides it) and temp repos made with `makeRepo` from `commands/git/__tests__/helpers.ts`. Tests that use an alias set `setSshHostResolver` and reset it to null afterwards.

```ts
test("verdict passes an https gitlab.com origin with a token held", async () => {
  expect(await auth.verdict("https://gitlab.com/acme/x.git")).toEqual({ ok: true, url: "https://gitlab.com/acme/x.git", host: "gitlab.com", forge: "gitlab" });
});
test("verdict checks in order: http before host, host before token", async () => {
  expect((await auth.verdict("http://gitlab.com/acme/x.git")).reason).toBe("http");
  expect((await auth.verdict("git@gitlab.com:acme/x.git")).reason).toBe("ssh");
  expect((await auth.verdict("https://evil.example/acme/x.git")).reason).toBe("not-forge");
  expect(seams.lookupCalls).toBe(0);
});
test("a confirmed self-hosted GitLab passes, matched without case", async () => {
  expect((await auth.verdict("https://GitLab.Acme.Internal/acme/x.git")).ok).toBe(true);
});
test("an unconfirmed GitLab host is refused before any token read", async () => {
  expect((await auth.verdict("https://gitlab.other.org/acme/x.git")).reason).toBe("unconfirmed");
  expect(seams.lookupCalls).toBe(0);
});
test("absent reads as no-token; a throw, unreadable or withheld as unreadable", async () => { /* four seams variants */ });
test("tokenFor reads once per forge per run", async () => {
  await auth.verdict("https://gitlab.com/a/b.git"); await auth.verdict("https://gitlab.com/c/d.git");
  expect(seams.lookupCalls).toBe(1);
});
test("a verdict never carries the token", async () => {
  expect(JSON.stringify(await auth.verdict("https://gitlab.com/acme/x.git"))).not.toContain("LEAKCHECK");
});
test("helperEnv appends two pairs after existing ones and silences prompts", () => {
  const env = helperEnv("gitlab.com", { GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "a.b", GIT_CONFIG_VALUE_0: "1", GIT_CONFIG_KEY_1: "c.d", GIT_CONFIG_VALUE_1: "2" }, "!rt git credential");
  expect(env.GIT_CONFIG_COUNT).toBe("4");
  expect(env.GIT_CONFIG_KEY_0).toBe("a.b");
  expect([env.GIT_CONFIG_KEY_2, env.GIT_CONFIG_VALUE_2]).toEqual(["credential.https://gitlab.com.helper", ""]);
  expect([env.GIT_CONFIG_KEY_3, env.GIT_CONFIG_VALUE_3]).toEqual(["credential.https://gitlab.com.helper", "!rt git credential"]);
  expect([env.GIT_TERMINAL_PROMPT, env.GIT_ASKPASS]).toEqual(["0", ""]);
});
test("helperEnv treats a non-numeric count as 0", () => {
  expect(helperEnv("gitlab.com", { GIT_CONFIG_COUNT: "x" }, "!h").GIT_CONFIG_COUNT).toBe("2");
});
test("helperEnv puts no token anywhere in the env", () => {
  expect(JSON.stringify(helperEnv("gitlab.com", {}, rtSelfHelper(["/opt/rt"])))).not.toContain("LEAKCHECK");
});
test("rtSelfHelper quotes each argv element and appends git credential", () => {
  expect(rtSelfHelper(["/Apps/My rt/rt"])).toBe("!'/Apps/My rt/rt' git credential");
});
test("sshToHttps maps scp and ssh:// forms", async () => {
  expect(await sshToHttps("git@gitlab.com:group/sub/repo")).toBe("https://gitlab.com/group/sub/repo.git");
  expect(await sshToHttps("git@github.com:acme/x.git")).toBe("https://github.com/acme/x.git");
  expect(await sshToHttps("ssh://git@gitlab.acme.internal:2222/group/repo.git")).toBe("https://gitlab.acme.internal/group/repo.git");
  expect(await sshToHttps("https://gitlab.com/a/b.git")).toBeNull();
});
test("sshToHttps maps an alias through ssh config and refuses one that is not a forge", async () => {
  setSshHostResolver(async ({ host }) => (host === "github-work" ? "github.com" : null));
  expect(await sshToHttps("github-work:acme/x.git")).toBe("https://github.com/acme/x.git");
  expect(await sshToHttps("myhost:acme/x.git")).toBeNull();
});
test("forOrigin reads the push URL when asked and applies insteadOf", async () => { /* temp repo: origin https, pushurl git@...; forOrigin(cwd,false).ok true, forOrigin(cwd,true).reason "ssh"; a local url.<x>.insteadOf rewrites to ssh -> reason "ssh" */ });
test("guardPrompts sets both vars when either URL passes and its undo restores the old values", async () => {
  process.env.GIT_ASKPASS = "/usr/bin/editor-askpass";
  const undo = await auth.guardPrompts(cwd, { push: true }); // fetch ssh, push https
  expect([process.env.GIT_TERMINAL_PROMPT, process.env.GIT_ASKPASS]).toEqual(["0", ""]);
  undo();
  expect(process.env.GIT_ASKPASS).toBe("/usr/bin/editor-askpass");
  expect("GIT_TERMINAL_PROMPT" in process.env).toBe(false);
});
test("guardPrompts changes nothing when no URL passes", async () => { /* no-token seams; env untouched; undo is a no-op */ });
test("createOriginAuth(null) reads https URLs as no-token and never reads", async () => { /* http and ssh URLs keep their own reasons */ });
```

`credential.test.ts`, new cases pinning the helper (spec section 1), using `gitCredentialReply` with fake deps that return a token:

```ts
test("answers nothing for another host", ...);          // host=evil.example -> ""
test("answers nothing over http", ...);                  // protocol=http -> ""
test("answers nothing for store or erase", ...);         // op "store", "erase" -> ""
test("answers nothing for an unconfirmed GitLab host", ...); // confirmedHost "gitlab.acme.internal", host=gitlab.other.org -> ""
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/git/__tests__/origin-auth.test.ts commands/git/__tests__/credential.test.ts`
Expected: origin-auth fails to import; the credential cases pass already (they pin existing behaviour; keep them).

- [ ] **Step 3: Implement `commands/git/origin-auth.ts`**

- `defaultOriginAuthSeams()` returns null when `process.env.RT_POOL_FORGE_TOKEN === "off"` (test-setup.ts sets it, so no suite reaches the real store), else seams over `readUserIntegrationOverrides().forgeHost ?? null` and `forgeTokenLookupForGit(createRealProbes(), remote)`.
- `createOriginAuth(seams = defaultOriginAuthSeams())`: memo keyed by `forgeTokenKey(remote)`; null seams read every lookup as `absent`. `verdict` order: null URL is `no-origin`; `http://` is `http`; an scp-like or `ssh://` URL is `ssh`; any other non-`https://` is `not-https`; `forgeFromRemote` null is `not-forge`; then `forgeTokenKey(url) === "gitlabToken" ? mayOfferGitLabToken : mayOfferToken` false is `unconfirmed`; then the lookup (`absent` is `no-token`; `unreadable`, `withheld` or a throw is `unreadable`).
- `sshToHttps`: null unless the URL is scp-like or `ssh://`; `await resolveSshAlias(url)`, then `parseRemoteUrl(url)` (which drops an SSH port and reads the resolved alias); null when `forgeFromHost` of its host is null; else `https://<host>/<projectPath>.git`.
- `helperEnv`: copies `base`, reads `GIT_CONFIG_COUNT` with `Number.parseInt`, non-finite or negative as 0, appends the two pairs, sets the count, `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=""`. Default `helper` is `rtSelfHelper()`.
- `guardPrompts` remembers each var's prior presence and value so undo deletes or restores exactly.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test commands/git/__tests__/origin-auth.test.ts commands/git/__tests__/credential.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add commands/git/origin-auth.ts commands/git/__tests__/origin-auth.test.ts commands/git/__tests__/credential.test.ts
git commit -m "add commands/git/origin-auth.ts: host gate, one token read, helper env (RT-526)"
```

---

### Task 2: `clone-state.ts`, the clone classifier

**Files:**
- Create: `commands/git/clone-state.ts`
- Test: `commands/git/__tests__/clone-state.test.ts`

**Interfaces:**
- Consumes: Task 1; `rtCredentialHelper` (`lib/setup/steps/repos.ts`); `linkPath` (`lib/deps/resolve.ts`); `shellQuote` (`lib/herdr-launch.ts`).
- Produces:
  ```ts
  export type CloneStateName = "done" | "pending" | "off" | "skipped";
  /** The machine cause; Task 8 maps it to a refusal code, Task 7 to the --check row. */
  export type CloneCause =
    | "wired" | "ready" | "ssh-ready"
    | "own-helper" | "insteadof-maps-back" | "no-rt-link" | "unmappable-ssh"
    | "no-origin" | "http-origin" | "not-https" | "not-a-forge" | "unconfirmed-host" | "no-token" | "token-unreadable";
  export interface CloneState {
    state: CloneStateName;
    cause: CloneCause;
    transport: "https" | "ssh" | "http" | "other" | "none";
    host: string | null;       // for SSH, the mapped HTTPS host
    forge: Forge | null;
    reason: string;            // the row's hint, through rt:ui-copy
    next?: string;             // a runnable command, path shell-quoted
    originUrl: string | null;
    httpsUrl: string | null;   // the mapped URL for an SSH origin
    ownHelpers?: string[];     // the entries rt did not write
    insteadOfRule?: string;    // "url.<base>.insteadOf <value>"
  }
  export interface CloneDeps { auth: OriginAuth; rtLink: string; rtLinkExists(): boolean }
  export function realCloneDeps(auth?: OriginAuth): CloneDeps;   // rtLink = linkPath(HOME, "rt")
  export function helperEntries(root: string, host: string): Promise<string[]>; // local config, --get-all, [] when unset
  export function rtWired(entries: string[], rtLink: string): boolean;         // exactly ["", rtCredentialHelper(rtLink)]
  export function insteadOfMapsBack(root: string, httpsUrl: string): Promise<string | null>; // the rule, or null
  export function classifyClone(root: string, deps: CloneDeps): Promise<CloneState>;
  ```

- [ ] **Step 1: Write the failing tests**

Temp repos via `makeRepo`; local config only (`git config --local`); fake seams from Task 1; `rtLink` a temp file that exists unless a test says not. Each row of the spec's `--check` table, in order:

```ts
test("https, rt wired: done/wired", ...);                         // entries ["", rtCredentialHelper(link)]
test("https, foreign helper entries: skipped/own-helper, names them and the host", ...);
test("ssh, foreign entries for the mapped host: skipped/own-helper", ...);
test("ssh whose https URL an insteadOf rule maps back: skipped/insteadof-maps-back naming the rule", ...);
test("no rt link beats pending and off: skipped/no-rt-link", ...);
test("https, token held, host confirmed: pending/ready, next rt git auth <path>", ...);
test("ssh, token held: off/ssh-ready, next rt git auth --https <path>", ...);
test("an ssh alias that is not a forge: skipped/unmappable-ssh", ...);
test("no token, unconfirmed host, http, file origin, no origin, not a forge: skipped with each cause", ...);
test("unreadable store: skipped/token-unreadable 'rt could not read its token store'", ...);
test("rows match first in table order", ...);  // foreign entries + token held + confirmed host -> own-helper, not ready
test("a path with a space is shell-quoted in next", ...);
test("classifying writes nothing", ...);       // .git/config byte-identical before and after
test("no state carries the token", ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/git/__tests__/clone-state.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

`classifyClone` reads `git remote get-url origin` (effective). For SSH it maps through `sshToHttps` (null gives `unmappable-ssh`) and checks the mapped URL. Order: `wired`; `own-helper` (non-empty entries that are not `rtWired`); `insteadof-maps-back` (SSH only); then the Task 1 verdict's failure causes (`no-origin`, `http-origin`, `not-https`, `not-a-forge`, `unconfirmed-host`, `no-token`, `token-unreadable`); then `no-rt-link`; then `ready` (HTTPS, `pending`) or `ssh-ready` (SSH, `off`). Every cause but the last three is `skipped`; `wired` is `done`. `helperEntries` runs `git -C root config --local --get-all credential.https://<host>.helper`. `insteadOfMapsBack` runs `git -C root ls-remote --get-url <https>`; when the echo differs it finds the rule with `git -C root config --get-regexp '^url\..*\.insteadof$'` and returns `url.<base>.insteadOf <value>`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test commands/git/__tests__/clone-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add commands/git/clone-state.ts commands/git/__tests__/clone-state.test.ts
git commit -m "add commands/git/clone-state.ts: classify a clone for rt's token (RT-526)"
```

---

### Task 3: `fetchOrigin` retries with rt's helper and names SSH causes

**Files:**
- Modify: `commands/git/shared.ts` (`FetchDeps`, `defaultFetchDeps`, `fetchOrigin`, add `RemoteOutcome`, `tokenRefusedFailure`, `httpsSwitchViable`)
- Modify: `commands/sync.ts`, `commands/git/rebase.ts`, `commands/git/reset.ts` (only for the new return type)
- Test: `commands/git/__tests__/fetch-origin.test.ts`

**Interfaces:**
- Consumes: Task 1's `OriginAuth`, `helperEnv`, `forgeName`; Task 2's `classifyClone`, `realCloneDeps`; `isAuthFailure` (`lib/worktree/fetch-auth.ts`).
- Produces:
  ```ts
  export interface FetchDeps {
    run(cwd: string, env: NodeJS.ProcessEnv): Promise<{ ok: true } | { ok: false; output: string }>;
    findAgent(preferred: string | undefined): Promise<{ socket: string; preferred: boolean } | undefined>;
    env: NodeJS.ProcessEnv;
    auth: OriginAuth;
    helper?: string;                              // defaults to rtSelfHelper()
    switchViable?: (cwd: string) => Promise<boolean>; // defaults to httpsSwitchViable
  }
  export function defaultFetchDeps(auth?: OriginAuth): FetchDeps;
  export interface RemoteOutcome { env: NodeJS.ProcessEnv; usedRtToken: boolean; forge: Forge | null; host: string | null }
  export function fetchOrigin(cwd: string, deps?: FetchDeps): Promise<RemoteOutcome>;
  /** `classifyClone(cwd).state === "off"`: `rt git auth --https` would go ahead. */
  export function httpsSwitchViable(cwd: string, auth: OriginAuth): Promise<boolean>;
  export function tokenRefusedFailure(subject: string, host: string, forge: Forge, details: string): out.FailureInput;
  ```
  `subject` is `"fetch from origin"` or `` `push ${branch}` ``; the title is `` `Could not ${subject}: the forge refused rt's token as well` ``. Failures are thrown as `new FetchFailed(...)`, so `fetchFailureOf` unwraps them.

- [ ] **Step 1: Write the failing tests**

Extend the `deps()` helper with an `auth` fake (a `createOriginAuth` over fake seams with a stub `forOrigin`), a recorded env per run and a stub `switchViable`. Update the existing tests to read `.env` off the outcome. New cases:

```ts
test("an https auth failure retries once with rt's helper and reports it", async () => {
  // run 1: "fatal: could not read Username for 'https://gitlab.com'", run 2: ok; forOrigin ok for gitlab.com
  const o = await fetchOrigin("/r", d);
  expect([o.usedRtToken, o.forge, o.host]).toEqual([true, "gitlab", "gitlab.com"]);
  expect(envs[1].GIT_CONFIG_VALUE_1).toBe("!helper");
  expect(o.env.GIT_CONFIG_COUNT).toBe("2");
});
test("a second auth failure says rt's token was refused too and names the reconnect", async () => {
  const f = await failureOf(fetchOrigin("/r", d)); // both runs fail on auth
  expect(f.title).toBe("Could not fetch from origin: the forge refused rt's token as well");
  expect(f.why).toContain("gitlab.com");
  expect(JSON.stringify(f.next)).toContain("rt setup gitlab connect");
  expect(JSON.stringify(f)).not.toContain("LEAKCHECK");
});
test("GitHub's refusal names rt setup github connect", ...);
test("an https auth failure with no usable token keeps git's plain failure and does not retry", ...); // runs.length 1
test("a non-auth failure never retries", ...);
test("an agent holding a key that origin refuses says the forge refused your SSH key", async () => {
  expect(f.title).toBe("Could not fetch from origin: the forge refused your SSH key");
  expect(f.details).toBe(DENIED);
});
test("an agent retry origin also refuses says the forge refused your SSH key", ...); // replaces "keeps the plain failure"
test("the SSH failures name rt git auth --https only when the switch could go ahead", async () => {
  // switchViable true, no key: next is one row: "Load your key with ", ssh-add, ", or let rt sign in over HTTPS with ", rt git auth --https
  // switchViable true, refused key: next "Let rt sign in over HTTPS with ", rt git auth --https
  // switchViable false: no-key keeps today's ssh-add row; refused-key has no next
});
test("a clean fetch reports usedRtToken false", ...);
test("httpsSwitchViable is true only for an off clone", ...); // temp repo with ssh origin and fake seams; false once a foreign helper entry is added
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/git/__tests__/fetch-origin.test.ts`
Expected: FAIL (no `usedRtToken`, old titles).

- [ ] **Step 3: Implement the changes in `commands/git/shared.ts`**

`fetchOrigin`: first run; ok returns `{ env, usedRtToken: false, forge: null, host: null }`. If `isAuthFailure(output)`: `deps.auth.forOrigin(cwd, false)`; not ok throws today's plain failure; ok retries under `helperEnv(host, deps.env, deps.helper)`; success returns that env with `usedRtToken: true`, `forge`, `host`; a retry that fails on auth again throws `new FetchFailed(tokenRefusedFailure("fetch from origin", host, forge, output))`, any other retry failure the plain failure with the retry's output. The SSH branch keeps its agent retry; the two "agent holds a key" endings become the refused-key failure (`why`: git reached origin over SSH with a loaded key and the forge said no). `next` per the test above. `tokenRefusedFailure`'s `why` names the host; `next` is `["Connect GitLab again with ", out.cmd("rt setup gitlab connect")]` or the GitHub row with `rt setup github connect`. Callers in `sync.ts`, `rebase.ts` and `reset.ts` take `.env` for now.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test commands/git/__tests__/fetch-origin.test.ts commands/git/__tests__/rebase.test.ts commands/git/__tests__/reset.test.ts commands/__tests__/sync-output.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add commands/git/shared.ts commands/git/__tests__/fetch-origin.test.ts commands/sync.ts commands/git/rebase.ts commands/git/reset.ts
git commit -m "fetchOrigin: retry once with rt's helper, name SSH key refusals (RT-526)"
```

---

### Task 4: `rt sync` runs unprompted, retries its push and prints the note

**Files:**
- Modify: `commands/git/shared.ts` (add `PushDeps`, `defaultPushDeps`, `PushFailed`, `pushOrigin`)
- Modify: `commands/git/origin-auth.ts` (add `tokenNoteBlocks`)
- Modify: `commands/sync.ts` (`syncBranch` options and wrapper, push, `SyncSummary`, `syncCommand`, `syncAll`, add `syncAllNote`)
- Test: `commands/__tests__/sync-auth.test.ts` (new), `commands/git/__tests__/push-origin.test.ts` (new)

**Interfaces:**
- Consumes: Tasks 1 and 3.
- Produces:
  ```ts
  // shared.ts
  export interface PushDeps {
    run(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ ok: true } | { ok: false; output: string }>;
    findAgent(preferred: string | undefined): Promise<{ socket: string; preferred: boolean } | undefined>;
    auth: OriginAuth;
    helper?: string;
    switchViable?: (cwd: string) => Promise<boolean>;
  }
  export function defaultPushDeps(auth?: OriginAuth): PushDeps;
  export class PushFailed extends Error { constructor(readonly failure: out.FailureInput) }
  export function pushOrigin(cwd: string, branch: string, args: string[], from: RemoteOutcome, deps?: PushDeps): Promise<RemoteOutcome>;
  // origin-auth.ts
  export function tokenNoteBlocks(forge: Forge, worktrees?: string[]): Block[];
  // sync.ts
  interface SyncSummary { /* existing */ usedRtToken?: boolean; tokenForge?: Forge }
  syncBranch(cwd, opts: { /* existing */ originAuth?: OriginAuth; fetchDeps?: FetchDeps; pushDeps?: PushDeps })
  export function syncAllNote(summaries: SyncSummary[]): Block[];
  ```

- [ ] **Step 1: Write the failing tests**

`push-origin.test.ts`:

```ts
test("a push whose fetch already used rt's token and still fails on auth says rt's token was refused", async () => {
  // from = { usedRtToken: true, forge: "gitlab", host: "gitlab.com", env }
  expect(f.title).toBe("Could not push feat: the forge refused rt's token as well");
  expect(f.why).toContain("gitlab.com");
});
test("a push that fails on auth after a plain fetch retries once when the push URL passes", ...); // usedRtToken true, retry env carries deps.helper
test("the push retry checks the push URL, not the fetch URL", ...); // forOrigin called with push true
test("an SSH push refusal with no agent key says no SSH key is loaded", ...);   // "Could not push feat: no SSH key is loaded"
test("an SSH push refusal with a loaded key says the forge refused your SSH key", ...);
test("any other push failure keeps the plain title and git's output", ...);      // "Could not push feat", details
test("no push failure carries the token", ...);                                    // not.toContain("LEAKCHECK")
```

`sync-auth.test.ts`: temp repo with a local bare origin and a feature branch behind it, built as `sync-stack-guard.test.ts` does; stack runners stubbed clear; `fetchDeps` and `pushDeps` with fake `run`.

```ts
test("syncBranch decides the guard from the push URL and restores it after", async () => {
  // real createOriginAuth over fake seams; local fetch URL, remote.origin.pushurl https://gitlab.com/acme/x.git (never contacted: fake runs)
  expect(seenDuringFetch).toBe("0");                 // fake fetch run records process.env.GIT_TERMINAL_PROMPT
  expect(process.env.GIT_TERMINAL_PROMPT).toBe(before);
});
test("syncBranch calls guardPrompts before its first remote call", async () => {
  // fake OriginAuth whose guardPrompts records order; getRemoteDefaultBranch's ls-remote happens after it
});
test("syncBranch leaves prompts alone when rt cannot authenticate origin", ...);
test("a sync that needed rt's token reports usedRtToken and its forge", ...);
test("the guard from one syncBranch does not leak into the next", ...); // first: pushurl passes; second: no-token seams; second fetch sees prompts untouched
test("tokenNoteBlocks names the forge, says this run and points at rt git auth", () => {
  const text = renderPlain(tokenNoteBlocks("gitlab"));
  expect(text).toContain("GitLab");
  expect(text).toContain("this run");
  expect(text).toContain("rt git auth");
});
test("tokenNoteBlocks under sync all names the worktrees", ...);
test("syncAllNote lists only the worktrees that used the token and is empty when none did", ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/sync-auth.test.ts commands/git/__tests__/push-origin.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

- `pushOrigin`: run under `from.env`. On ok return `from`. On `isAuthFailure`: when `from.usedRtToken` throw `new PushFailed(tokenRefusedFailure(`push ${branch}`, from.host!, from.forge!, output))`; else `auth.forOrigin(cwd, true)`, ok retries under `helperEnv(host, from.env, deps.helper)`, success returns `{ env, usedRtToken: true, forge, host }`, a second auth failure throws the refused-token failure; not ok throws the plain failure. On `looksLikeSshAuthFailure`: `findAgent(from.env.SSH_AUTH_SOCK)`; none gives "Could not push <branch>: no SSH key is loaded", found gives "Could not push <branch>: the forge refused your SSH key"; `next` as in Task 3, using `switchViable`. Else `{ title: `Could not push ${branch}`, details: output }`.
- `syncBranch` becomes a wrapper: `const auth = opts.originAuth ?? createOriginAuth(); const undo = await auth.guardPrompts(cwd, { push: true }); try { return await syncOne(cwd, opts, auth); } finally { undo(); }`. `syncOne` is today's body; its fetch uses `opts.fetchDeps ?? defaultFetchDeps(auth)` and keeps the outcome; its push calls `pushOrigin(cwd, branch, pushArgs, outcome, opts.pushDeps ?? defaultPushDeps(auth))` inside the existing quiet and step branches, `PushFailed` mapped to `asError(err.failure)`, anything else to today's plain push failure. `usedRtToken` and `tokenForge` come from whichever outcome used it.
- `syncCommand`: after `reportSync` returns 0 and `mode !== "json"`, print `tokenNoteBlocks(summary.tokenForge)` when `summary.usedRtToken && summary.tokenForge`. Never after a failure or under escalation.
- `syncAll`: one `createOriginAuth()` for the whole run, passed to every `syncBranch`; after `syncAllBlocks`, print `syncAllNote(summaries)`.
- Copy through `rt:ui-copy`; shape: `out.callout("note", "rt signed in with your <Forge> token for this run, because git had no other way in")`, then `out.callout("next", ["To use it for every git on this clone, run ", out.cmd("rt git auth")])`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test commands/__tests__/sync-auth.test.ts commands/git/__tests__/push-origin.test.ts commands/__tests__/sync-output.test.ts commands/__tests__/sync-all.test.ts commands/__tests__/sync-stack-guard.test.ts lib/mcp/__tests__/git-tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add commands/git/shared.ts commands/git/origin-auth.ts commands/sync.ts commands/__tests__/sync-auth.test.ts commands/git/__tests__/push-origin.test.ts
git commit -m "rt sync: unprompted when rt can sign in, push retry, token note (RT-526)"
```

---

### Task 5: `rt git rebase` and `rt git reset origin` get the guard and the note

**Files:**
- Modify: `commands/git/rebase.ts` (`RebaseOptions`, `RebaseResult`, `runRebaseWithEscalation`, add `__testSeams`)
- Modify: `commands/git/reset.ts` (`ResetOptions`, `ResetResult`, `originCommand`, add `__testSeams`)
- Test: `commands/git/__tests__/rebase.test.ts`, `commands/git/__tests__/reset.test.ts`

**Interfaces:**
- Consumes: `createOriginAuth`, `tokenNoteBlocks` (Tasks 1, 4); `defaultFetchDeps`, `RemoteOutcome` (Task 3).
- Produces: `rebaseOnto` and `resetToOrigin` accept `originAuth?: OriginAuth` and `fetchDeps?: FetchDeps`, and set `usedRtToken?: boolean` and `tokenForge?: Forge` on their result from the fetch outcome when they fetched. Each file exports `__testSeams: { originAuth?: OriginAuth; fetchDeps?: FetchDeps }`, which its command handler reads; tests set and clear it.

- [ ] **Step 1: Write the failing tests**

```ts
// rebase.test.ts
test("rebaseOnto reports usedRtToken when its fetch needed rt's helper", ...); // fetchDeps fake: auth failure then ok
test("rebaseOnto with skipFetch never reports usedRtToken", ...);
test("rebaseCommand prints the token note after a finished rebase, not under --json, not after a failure", ...);
test("rebaseCommand calls guardPrompts before the fetch and undoes it before exiting", ...); // fake OriginAuth recording order
// reset.test.ts: the same four for resetToOrigin / originCommand
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/git/__tests__/rebase.test.ts commands/git/__tests__/reset.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

`runRebaseWithEscalation` and `originCommand` take `__testSeams.originAuth ?? createOriginAuth()`, call `guardPrompts(cwd, { push: false })` before `rebaseOnto` / `resetToOrigin`, and undo it in a `finally` that runs before any `process.exit` (capture the code first, as `syncCommand` does). On a finished run (rebase `ok` or `up-to-date`; reset with no `error` and not cancelled) and not `--json`, print `tokenNoteBlocks(result.tokenForge)` when `result.usedRtToken && result.tokenForge`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test commands/git/__tests__/rebase.test.ts commands/git/__tests__/reset.test.ts commands/git/__tests__/rebase-output.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add commands/git/rebase.ts commands/git/reset.ts commands/git/__tests__/rebase.test.ts commands/git/__tests__/reset.test.ts
git commit -m "rt git rebase and reset: prompt guard, rt token retry note (RT-526)"
```

---

### Task 6: the stack check passes rt's token to glab and gh

**Files:**
- Modify: `lib/stack-guard.ts` (`createStackGuardRunners`, `listGitlab`, `listGithub`, `failure`)
- Modify: `commands/sync.ts` (both `createStackGuardRunners` calls pass the run's auth)
- Test: `lib/__tests__/stack-guard-auth.test.ts` (new)

**Interfaces:**
- Consumes: `forgeAuthEnv` (`lib/team/forge.ts`, unchanged); `mayOfferGitLabToken`, `tokenOrNull`, `type ForgeTokenLookup` (`lib/team/forge-token.ts`); `redactCredentials` (`packages/rt-client/src/redact.ts`); Task 1's `OriginAuth`.
- Produces:
  ```ts
  export interface StackGuardAuth {
    confirmedHost(): string | null;
    tokenFor(remote: string): Promise<ForgeTokenLookup>;
  }
  export function createStackGuardRunners(p: Probes, auth?: StackGuardAuth): StackGuardRunners;
  ```
  An `OriginAuth` satisfies `StackGuardAuth`, so `rt sync` passes the same object and the token is read once per run. The other callers (`commands/git/mutate.ts`, `lib/mcp/stack-tool.ts`, `lib/mission/driver.ts`) pass nothing and behave as today.

- [ ] **Step 1: Write the failing tests**

With `fakeProbes` from `lib/setup/__tests__/fakes.ts` recording each exec's argv and opts:

```ts
test("GitLab: a held token for a passing host goes as GITLAB_TOKEN with GITLAB_HOST, cwd the checkout", async () => {
  // origin https://gitlab.com/acme/x.git
  expect(glabCall.opts.env).toEqual({ GITLAB_TOKEN: "glpat-LEAKCHECK000000000", GITLAB_HOST: "gitlab.com" });
  expect(glabCall.opts.cwd).toBe("/work/x");
  expect(glabCall.argv.join(" ")).not.toContain("LEAKCHECK");
});
test("GitLab self-hosted, confirmed (gitlab.acme.internal): GITLAB_HOST is that host", ...);
test("GitLab, unconfirmed host: glabEnv as today and no token read", ...);
test("GitHub: github.com with a token gets GH_TOKEN and never a GitLab token", ...);
test("GitHub Enterprise or any other host: no token, as today", ...);
test("no token held: the CLI's own login, env as today", ...);
test("a lookup that throws or is unreadable falls back to the CLI's own login", ...);
test("without auth the runners behave exactly as before", ...); // env glabEnv(host), no cwd
test("a glab failure that echoes the token reaches the hint redacted", async () => {
  // glab exits 1 with stderr "401 Unauthorized: token glpat-LEAKCHECK000000000 rejected"
  expect(verdict.refusal.hint).not.toContain("LEAKCHECK");
});
test("the token is read once for both listings", ...); // tokenFor calls 1
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/__tests__/stack-guard-auth.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

`forgeOpenMrs` reads origin as today, then, when `auth` is given, decides once per call: GitLab provider with `mayOfferGitLabToken(remote, auth.confirmedHost())` and a token gives `{ env: { ...forgeAuthEnv("gitlab", host, token), GITLAB_HOST: host }, cwd }`; GitHub provider with host `github.com` and a token gives `{ env: forgeAuthEnv("github", host, token), cwd }`; anything else, or a lookup that throws, gives today's options. `listGitlab` / `listGithub` take that options object. `failure()` runs its detail through `redactCredentials`. In `sync.ts` the runners are built with the run's `OriginAuth` (`syncBranch`'s wrapper hands it to `syncOne`; `syncAll` builds its runners with its shared one); `opts.stackRunners` still wins when a test passes it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/__tests__/stack-guard-auth.test.ts lib/__tests__/stack-guard.test.ts lib/__tests__/stack-guard-forge-listing.test.ts commands/__tests__/sync-stack-guard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/stack-guard.ts lib/__tests__/stack-guard-auth.test.ts commands/sync.ts
git commit -m "stack guard: pass rt's token to glab and gh behind the host gate (RT-526)"
```

---

### Task 7: `rt git auth --check` and the command node

**Files:**
- Create: `commands/git/auth.ts` (entry, `--check`; the plain and `--https` forms land in Task 8)
- Modify: `lib/command-tree-def.ts` (an `auth` node under `git`), `lib/module-registry.ts` (its module line)
- Test: `commands/git/__tests__/auth-check.test.ts` (new)

**Interfaces:**
- Consumes: Task 2; `loadRepoIndexEntries` (`lib/repo-index.ts`); `repoLabel` (`lib/repo-label.ts`).
- Produces:
  ```ts
  export interface AuthDeps extends CloneDeps {
    entries(): { repoName: string; path: string }[];
    interactive: boolean;
    confirm(message: string): Promise<boolean>;
    print(line: string): void;      // the --json envelope only
  }
  export function realAuthDeps(): AuthDeps;
  export function checkBlocks(rows: { label: string; path: string; s: CloneState }[]): Block[];
  export function authCommand(args: string[], ctx: CommandContext, deps?: AuthDeps): Promise<void>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test("--check prints one row per existing registered checkout, state and reason, next under it", ...); // through renderPlain(checkBlocks(...))
test("--check --json emits the frozen shape and no token", async () => {
  expect(JSON.parse(printed)).toEqual({ ok: true, repos: [{ path, label, state: "pending", transport: "https", host: "gitlab.com", next: `rt git auth ${path}` }] });
  expect(printed).not.toContain("LEAKCHECK");
});
test("--check skips index rows whose folder is gone and exits 0 whatever the states", ...);
test("--check writes nothing and prompts for nothing", ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/git/__tests__/auth-check.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

`--check` runs `classifyClone` over `deps.entries()` whose path exists. `checkBlocks` draws `out.line(state, label, reason)` per repo with `out.callout("next", out.cmd(next))` under it when set. The `auth` tree node: plain description through `rt:ui-copy` (for example "Let git on this clone sign in with the forge token rt holds"), `module: "./commands/git/auth.ts"`, `fn: "authCommand"`, args for the path and the `--https`, `--check`, `--yes` booleans, no `agentSafe`; the registry line is a thunk. Read `.claude/rules/command-tree.md` first.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test commands/git/__tests__/auth-check.test.ts lib/__tests__/command-tree-def.test.ts lib/__tests__/command-tree.test.ts lib/__tests__/module-registry.test.ts lib/__tests__/picker-conformance.test.ts lib/__tests__/no-eager-tui.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add commands/git/auth.ts commands/git/__tests__/auth-check.test.ts lib/command-tree-def.ts lib/module-registry.ts
git commit -m "add rt git auth --check (RT-526)"
```

---

### Task 8: `rt git auth` and `rt git auth --https` write, with consent

**Files:**
- Modify: `commands/git/auth.ts`
- Test: `commands/git/__tests__/auth-write.test.ts` (new)

**Interfaces:**
- Consumes: Tasks 2 and 7.
- Produces: the plain and `--https` forms of `authCommand`. `--json` success envelope (this plan's call): `{ ok: true, path, host, changed: boolean, undo: string[] }`, plus `from` and `to` for an origin switch. Refusal `--json` errors are codes:

  | Situation | Code | next |
  |---|---|---|
  | not inside a git repo | `not-a-repo` | none |
  | `CloneCause` `no-origin`, `http-origin`, `not-https`, `not-a-forge`, `token-unreadable`, `own-helper`, `insteadof-maps-back`, `unmappable-ssh`, `no-rt-link` | the cause itself | none |
  | `unconfirmed-host` | `unconfirmed-host` | `rt setup gitlab connect --host <host>` |
  | `no-token` | `no-token` | `rt setup gitlab connect` or `rt setup github connect` |
  | plain form on any SSH origin | `ssh-origin` | `rt git auth --https` only when the state is `off` |
  | no terminal and no `--yes` | `needs-consent` | the same command with `--yes` |

  Plain form: `ready` writes, `wired` prints done and writes nothing. `--https`: `ssh-ready` switches and writes; on an HTTPS origin it is the plain form.

- [ ] **Step 1: Write the failing tests**

```ts
test("plain form on a pending clone writes the two values after a yes", async () => {
  expect(git(repo, "config", "--local", "--get-all", "credential.https://gitlab.com.helper").split("\n")).toEqual(["", rtCredentialHelper(link)]);
});
test("the done line names the exact undo", ...);            // "git config --unset-all credential.https://gitlab.com.helper"
test("a no at the prompt writes nothing", ...);
test("without a terminal it refuses with needs-consent unless --yes", ...);
test("already wired: done and nothing written", ...);
test("foreign helper entries: refused, entries named, nothing written", ...);
test("each refusal writes nothing and carries its code and next", ...); // table-driven over the table above
test("ssh origin, plain form: refused ssh-origin, names --https only when the state is off", ...);
test("--https switches origin and writes the helper after a yes", async () => {
  expect(git(repo, "remote", "get-url", "origin")).toBe("https://gitlab.com/acme/x.git");
});
test("--https rewrites a same-repo ssh pushurl and leaves a different one alone, saying so", ...);
test("--https refuses an insteadOf rule that maps back, names it, writes nothing", ...);
test("--https refuses an alias that is not a forge (unmappable-ssh) and maps one that is", ...); // setSshHostResolver
test("--https on an https origin behaves as the plain form", ...);
test("--https names both undo commands", ...);              // "git remote set-url origin git@gitlab.com:acme/x.git" and --unset-all
test("no token value in config, remote URL, printed output or the envelope", async () => {
  expect(readFileSync(join(repo, ".git/config"), "utf8")).not.toContain("LEAKCHECK");
});
test("global config is never touched", ...);                 // the test HOME's .gitconfig absent before and after
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/git/__tests__/auth-write.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

Path defaults to `git rev-parse --show-toplevel` of the cwd. `classifyClone`, then the table above through `refuseWith(json, code, ...refusalNote(...))`; the `own-helper` refusal uses the shared "rt did not make it, so rt left it alone" wording and lists `ownHelpers`. Before writing, print what changes (the key, and that for that one host in this clone it takes the place of git's other helpers, such as the keychain; for `--https`, the old and new URL), then `deps.confirm` when `deps.interactive && !yes`. Writes: `--https` runs `git -C root remote set-url origin <https>`, then `git -C root remote set-url --push origin <https>` only when `remote.origin.pushurl` maps through `sshToHttps` to the same URL; then `git -C root config --local --add <key> ""` and `git -C root config --local --add <key> <rtCredentialHelper(rtLink)>`. A helper write that fails after the origin switch reports the switch, the failure and both undo commands.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test commands/git/__tests__/auth-write.test.ts commands/git/__tests__/auth-check.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add commands/git/auth.ts commands/git/__tests__/auth-write.test.ts
git commit -m "rt git auth: wire rt's helper, --https switches origin, both by consent (RT-526)"
```

---

### Task 9: `rt repos register` points at `rt git auth`

**Files:**
- Modify: `commands/repos.ts` (`RegisterDeps`, `realRegisterDeps`, end of `reposRegister`)
- Test: `commands/__tests__/repos.test.ts`

**Interfaces:**
- Consumes: `classifyClone`, `realCloneDeps` (Task 2).
- Produces: `RegisterDeps.cloneState?: (path: string) => Promise<CloneState>`. `realRegisterDeps()` sets it to a function that dynamically imports `commands/git/clone-state.ts` on first call, so `reposPrune` and `reposLocate`, which share the default, never load the token modules.

- [ ] **Step 1: Write the failing tests**

```ts
test("a human register of a pending clone prints one note naming rt git auth <path>", ...);
test("a register of a done, off or skipped clone prints no note", ...);
test("a cloneState that throws prints nothing for that path", ...);
test("--json output is unchanged and carries no note", ...);  // envelope byte-identical to today's, stderr empty
test("register writes nothing to the clone's git config", ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/repos.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

After the human-mode `out.print` of the registered lines, for each registered path whose `cloneState` is `pending`, print `out.callout("note", state.reason)` and `out.callout("next", out.cmd(state.next!))`. The `--json` branch returns before this.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test commands/__tests__/repos.test.ts commands/__tests__/repos-locate.test.ts commands/__tests__/repos-reidentify.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add commands/repos.ts commands/__tests__/repos.test.ts
git commit -m "rt repos register: point a pending clone at rt git auth (RT-526)"
```

---

### Task 10: docs, then whole-branch verification

**Files:**
- Create: `sites/docs/docs/rt/reference/_partials/sync/index.mdx`, `sites/docs/docs/rt/reference/_partials/git/auth.mdx`
- Regenerate: `sites/docs/docs/rt/reference/sync/index.mdx`, `sites/docs/docs/rt/reference/git/auth.mdx` (and whatever else `bun run docs:gen` rewrites for the new node)

- [ ] **Step 1: Write the partials (rt:docs, rt:ui-copy)**

`sync/index.mdx`: a short "How rt sync signs in" section: git's own setup first; when that fails over HTTPS and rt holds a token for a confirmed host, rt retries once through its helper for that run only and writes nothing; no password prompt when rt can sign in; SSH failures name the key and point at `rt git auth --https`; the stack check uses rt's token for glab and gh. `git/auth.mdx`: what `rt git auth` writes (the two config values, never the token), the consent rule, `--https`, `--check`'s states, and the undo commands. Lead with what a person does.

- [ ] **Step 2: Regenerate and check**

Run: `bun run docs:gen && bun run docs:check`
Expected: the `rt git auth` page exists, both pages carry their partials, `docs:check` passes.

- [ ] **Step 3: Commit**

```bash
git add sites/docs/docs/rt/reference/_partials/sync/index.mdx sites/docs/docs/rt/reference/_partials/git/auth.mdx sites/docs/docs/rt/reference/sync/index.mdx sites/docs/docs/rt/reference/git/auth.mdx
git commit -m "docs: how rt sync signs in, rt git auth (RT-526)"
```
(Stage any other page `docs:gen` changed, by name, after reading its diff.)

- [ ] **Step 4: Whole-branch verification**

Run each from the worktree root:
- `bun test commands/git/__tests__ commands/__tests__/sync-auth.test.ts commands/__tests__/sync-output.test.ts commands/__tests__/sync-all.test.ts commands/__tests__/sync-stack-guard.test.ts commands/__tests__/repos.test.ts lib/__tests__/stack-guard-auth.test.ts lib/__tests__/stack-guard.test.ts lib/__tests__/stack-guard-forge-listing.test.ts lib/mcp/__tests__/git-tools.test.ts lib/mcp/__tests__/tools.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-ui-in-cli.test.ts`
- `grep -rln "Could not fetch from origin\|Could not push\|Fetched from origin" e2e/`; run each file it lists alone with `bun test --preload ./e2e/setup.ts --timeout 60000 <file>` (`--timeout 120000` for a file under `e2e/pty/`). None today; record that.
- `bun run typecheck`
- `bun run purity`
- `perl -CSD -ne 'print "$ARGV:$.: $_" if /[\x{2013}\x{2014}]/; close ARGV if eof' $(git diff --name-only main...HEAD)` prints nothing (BSD grep has no `-P`).

Expected: all pass; record each result for the report.
