# herdr fork, Plan 2: rt setup installs the fork's herdr

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt setup`'s herdr row installs and keeps current the patched herdr from the fork's build list, for every mattstack user, verified by SHA-256 before the swap, with Homebrew herdr removed, the running servers handed off, flock's stock backup deleted, a minimum fork build replacing `HERDR_FLOOR`, and a release preflight row that the minimum is published.

**Architecture:** A pure module (`lib/setup/herdr-builds.ts`) parses the build list and herdr's version string and decides a verdict. An install module (`lib/setup/herdr-install.ts`) downloads, verifies, swaps, cleans up and hands off. The `tool.herdr` row and the `herdr.integration` step (already update-safe, so it runs on every app update) both read the verdict; `installTool("herdr")` routes to the new installer instead of `herdr.dev/install.sh`. `rt tools restart herdr` is the one thing that ends panes, and only when pressed.

**Tech Stack:** Bun + TypeScript, `bun:test`, `fakeProbes` (`lib/setup/__tests__/fakes.ts`).

**Spec:** `docs/superpowers/specs/2026-11-23-herdr-fork-design.md` (in the `happy-oyster` worktree; read-only). This plan covers §3 "What mattstack requires" and "`rt:release`", and §4 except the flock row. Plan 1 (`docs/superpowers/plans/2026-11-23-herdr-fork-1-fork.md`, same worktree) fixed the build list fields this plan reads. The fork's own `herdr update` already reads only the fork (Plan 1, Task 3), so "herdr's own updates" needs no rt code: Task 6 checks it on the published build.

## Global Constraints

- Build list URL: `https://github.com/m4ttstack/herdr/releases/latest/download/herdr-builds.json`. Schema `1`. Fields, as `ms/manifests.sh` writes them: `schema`, `newest`, `builds[]` of `{ version, herdr, revision, changesServer, assets: { arm64: {url, sha256}, x86_64: {url, sha256} }, supersedes[] }`, `flockPatchSha256[]`.
- Asset URLs are accepted only under `https://github.com/m4ttstack/herdr/releases/download/`. The download follows redirects (`curl -fsSL`).
- A fork build's `herdr --version` prints `herdr <base>-ms.<n>`, e.g. `herdr 0.9.5-ms.1`. Stock prints `herdr 0.9.5`.
- Ordering: herdr base by semver first, then revision. Every stock herdr needs the fork build, however new its version (the fork wins).
- Minimum fork build: `HERDR_MIN_BUILD = "0.9.5-ms.1"` (Plan 5 raises it for the gate blocker). It replaces `HERDR_FLOOR`.
- Install path `~/.local/bin/herdr` (`vendorBinPath(p.home, "herdr")`). Old flock backup: `~/.local/bin/herdr.pre-mouse-backup`.
- Handoff per running session: `HERDR_SOCKET_PATH=<socket> herdr server live-handoff --import-exe <~/.local/bin/herdr> --expected-version <version>`; success is exit 0 and output containing `live handoff complete`. Sessions come from `herdr session list --json` (`{"sessions":[{"name","running","socket_path",...}]}`); a server's version from `HERDR_SOCKET_PATH=<socket> herdr status server --json` (`.running`, `.version`).
- Nothing ends a pane unless the person presses Restart herdr.
- Never run a downloaded or built herdr outside `env -i HOME="$(mktemp -d)" PATH=/usr/bin:/bin`. Unit tests use `fakeProbes`, never a real herdr.
- Copy rules: `.claude/rules/output-layer.md`, `output-setup-and-services.md`, `command-tree.md`. Row `detail` is copy; ids, statuses and action shapes are contract. A wording change to setup copy is a deliberate `bun test --update-snapshots` of `commands/__tests__/setup-copy.test.ts`.
- Run `bun test` from the repo root, only on the files a task touches.

## Review Focus

1. **The build list unreachable** (offline, 404 while a release publishes). Expect: a fork build at or above the minimum reads ready with a note that rt could not check for newer; stock or below-minimum reads Upgrade; Install fails with a plain reason and leaves the current binary. Task 1 `herdrVerdict` tests and Task 2 `install fails without touching the binary when the list is unreachable`.
2. **A tampered or wrong download** (SHA mismatch, wrong `--version`, a list whose asset URL is off the fork). Expect: nothing swapped, no file left in `~/.local/bin`. Task 1 `rejects an asset url outside the fork` and Task 2's two mismatch tests.
3. **A handoff the server refuses** (protocol change, version mismatch). Expect: binary installed, old server keeps running, the row says "Restart herdr when your agents are done" with a Restart button, and no pane ends until it is pressed. Task 2 `refused handoff leaves the server and reports restart` and Task 3 `stale server reads needs-you with Restart`.
4. **A stock herdr earlier on PATH that is not Homebrew's** (mise, cargo). Expect: rt did not make it, so rt leaves it alone, and the row says which file shadows the fork build with steps to remove it. Task 3 `non-brew shadow offers steps, never deletes`.
5. **A fork build newer than the list's newest** (a local dev build). Expect: ready, never offered a downgrade. Task 1 `a fork build newer than newest is current`.

---

### Task 0: Carry the fork-readmes rule

- [ ] **Step 1:** `git cherry-pick 451265a97` (from `herdr-fork-spec`: `plugins/mattstack/rules/fork-readmes.md` and its plugin bump). Resolve a `plugin.json` version conflict by taking main's version + 1; the final re-bump happens before the PR.

### Task 1: Build list and version verdict

**Files:**
- Create: `lib/setup/herdr-builds.ts`
- Test: `lib/setup/__tests__/herdr-builds.test.ts`

**Interfaces:**
- Produces:
  - `HERDR_BUILDS_URL: string`, `HERDR_MIN_BUILD = "0.9.5-ms.1"`, `HERDR_ASSET_PREFIX = "https://github.com/m4ttstack/herdr/releases/download/"`
  - `interface HerdrBuildAsset { url: string; sha256: string }`
  - `interface HerdrBuild { version: string; herdr: string; revision: number; changesServer: boolean; assets: Partial<Record<HostArch, HerdrBuildAsset>>; supersedes: string[] }`
  - `interface HerdrBuilds { schema: 1; newest: string; builds: HerdrBuild[] }`
  - `parseHerdrBuilds(text: string): HerdrBuilds | null`: null on bad JSON, `schema !== 1`, `newest` not a build's `version`, any asset URL not under `HERDR_ASSET_PREFIX`, any sha256 not 64 lowercase hex. Unknown extra fields are ignored.
  - `interface ForkVersion { herdr: string; revision: number }`
  - `parseHerdrVersion(stdout: string): { version: string; fork: ForkVersion | null }`
  - `compareForkVersions(a: ForkVersion, b: ForkVersion): number` (semver on `herdr` via `lib/setup/semver.ts`, then `revision`)
  - `newestBuild(list: HerdrBuilds): HerdrBuild`
  - `type HerdrVerdict = { kind: "current"; version: string; checked: boolean } | { kind: "outdated"; version: string; target: string; belowMinimum: boolean } | { kind: "stock"; version: string; target: string }`
  - `herdrVerdict(installed: ReturnType<typeof parseHerdrVersion>, list: HerdrBuilds | null): HerdrVerdict`
  - `fetchHerdrBuilds(p: Pick<Probes, "fetch">): Promise<HerdrBuilds | null>` (10 s timeout; non-200, a throw or a bad parse is null)

- [ ] **Step 1: Write the failing tests** with a fixture list built in the test (two builds `0.9.5-ms.1`, `0.9.5-ms.2`, valid URLs and sha256s):

```ts
test("parses herdr's version line", () => {
  expect(parseHerdrVersion("herdr 0.9.5-ms.2\n")).toEqual({ version: "0.9.5-ms.2", fork: { herdr: "0.9.5", revision: 2 } });
  expect(parseHerdrVersion("herdr 0.9.5")).toEqual({ version: "0.9.5", fork: null });
});
test("orders base before revision", () => {
  expect(compareForkVersions({ herdr: "0.9.6", revision: 1 }, { herdr: "0.9.5", revision: 9 })).toBeGreaterThan(0);
  expect(compareForkVersions({ herdr: "0.9.5", revision: 2 }, { herdr: "0.9.5", revision: 10 })).toBeLessThan(0);
});
test("rejects an asset url outside the fork", () => { /* url https://herdr.dev/x → parseHerdrBuilds returns null */ });
test("rejects schema 2, a missing newest, a short sha256", () => { /* each → null */ });
test("newest fork build is current", () => expect(herdrVerdict(parseHerdrVersion("herdr 0.9.5-ms.2"), list)).toEqual({ kind: "current", version: "0.9.5-ms.2", checked: true }));
test("a fork build newer than newest is current", () => expect(herdrVerdict(parseHerdrVersion("herdr 0.9.5-ms.7"), list).kind).toBe("current"));
test("an older fork build is outdated", () => expect(herdrVerdict(parseHerdrVersion("herdr 0.9.5-ms.1"), list)).toEqual({ kind: "outdated", version: "0.9.5-ms.1", target: "0.9.5-ms.2", belowMinimum: false }));
test("stock herdr newer than the fork still needs the fork", () => expect(herdrVerdict(parseHerdrVersion("herdr 0.9.9"), list)).toEqual({ kind: "stock", version: "0.9.9", target: "0.9.5-ms.2" }));
test("without the list, the minimum decides", () => {
  expect(herdrVerdict(parseHerdrVersion("herdr 0.9.5-ms.1"), null)).toEqual({ kind: "current", version: "0.9.5-ms.1", checked: false });
  expect(herdrVerdict(parseHerdrVersion("herdr 0.9.5"), null)).toEqual({ kind: "stock", version: "0.9.5", target: "0.9.5-ms.1" });
});
test("fetchHerdrBuilds reads the fork's url and returns null on 404", async () => { /* fakeProbes({ fetch }) → calls.fetch[0] === HERDR_BUILDS_URL */ });
```

A below-minimum case uses a temporarily injected minimum: give `herdrVerdict` an optional third parameter `minimum = HERDR_MIN_BUILD` and test `herdrVerdict(v("0.9.5-ms.1"), null, "0.9.5-ms.2")` → `{ kind: "outdated", target: "0.9.5-ms.2", belowMinimum: true }`.

- [ ] **Step 2:** Run `bun test lib/setup/__tests__/herdr-builds.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `lib/setup/herdr-builds.ts` per Interfaces.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `add lib/setup/herdr-builds.ts: build list parse and herdr verdict`.

### Task 2: Install the fork build

**Files:**
- Create: `lib/setup/herdr-install.ts`
- Modify: `lib/setup/tools-install.ts` (route herdr to it; drop the herdr `VENDOR_INSTALLERS` entry and `herdr.dev` from `VENDOR_ALLOWED_HOSTS`; update the doc comment)
- Modify: `commands/tools.ts` (`installableTools` still lists herdr)
- Test: `lib/setup/__tests__/herdr-install.test.ts`; update `lib/setup/__tests__/tools-install.test.ts` herdr cases

**Interfaces:**
- Consumes: Task 1's `fetchHerdrBuilds`, `newestBuild`, `parseHerdrVersion`.
- Produces:
  - `HERDR_BACKUP_FILES = ["herdr.pre-mouse-backup"]`
  - `interface HerdrSession { name: string; running: boolean; socket: string }`
  - `herdrSessions(p: Probes, herdr: string[]): Promise<HerdrSession[]>` (`[]` on any failure)
  - `serverVersion(p: Probes, herdr: string[], socket: string): Promise<string | null>` (null when not running or unreadable)
  - `staleHerdrSessions(p: Probes, herdr: string[], version: string): Promise<HerdrSession[]>`: running sessions whose server version is not `version`
  - `homebrewHerdr(p: Probes): { herdr: string; brew: string } | null`: `/opt/homebrew/bin/herdr` or `/usr/local/bin/herdr` whose `readlink` contains `/Cellar/herdr/`; `brew` is `<that bin dir>/brew`
  - `removeHerdrBackups(p: Probes): string[]` (paths removed)
  - `installHerdrBuild(p: Probes, arch: HostArch): Promise<InstallResult>` with `via: "download"`
  - `restartStaleHerdrServers(p: Probes): Promise<{ stopped: string[]; failed: string[] }>`: `HERDR_SOCKET_PATH=<socket> herdr server stop` for each stale session, herdr run from `~/.local/bin/herdr`
  - `installTool(p, "herdr", …)` returns `installHerdrBuild`; `installRoute(p, "herdr", …)` returns `"download"`.

`installHerdrBuild` order (each failure returns `ok: false` with a plain detail and leaves `~/.local/bin/herdr` as it was):
1. Fetch the list; null → "rt could not read herdr's build list from m4ttstack/herdr".
2. Take `newestBuild`, its asset for `arch`; none → "The newest herdr build has no download for this Mac's processor (<arch>)".
3. `curl -fsSL <url> -o $TMPDIR/rt-herdr-install/herdr`; `shasum -a 256`; mismatch → "The herdr download did not match the build list's sha256, so nothing was installed".
4. `install -m 0755` to `~/.local/bin/.herdr-<version>.new`; run it with `--version`; a version other than the build's → remove the staged file, fail.
5. `p.rename(staged, ~/.local/bin/herdr)`.
6. `removeHerdrBackups`.
7. `homebrewHerdr` → `<brew> uninstall herdr`; a failure is noted in the detail, not a failed install.
8. When `changesServer`: for each of `staleHerdrSessions(p, [dest], version)`, run the live-handoff (5 min timeout). Not handed off → that session goes on a restart list.
9. `ok: true`; detail names the version, then each of "removed Homebrew's herdr", "moved N running herdr servers onto it", "restart herdr when your agents are done" that applies.

- [ ] **Step 1: Write the failing tests** with `fakeProbes` scripting `curl`, `shasum`, `install`, the staged `--version`, `herdr session list --json`, `herdr status server --json` and `herdr server live-handoff`:
  - `installs the newest build for arm64`: `calls.exec` has curl of the arm64 URL; `~/.local/bin/herdr` renamed from the staged path; `ok: true`; detail starts `Installed herdr 0.9.5-ms.2`.
  - `sha mismatch installs nothing`: no rename, no `install` call; detail as step 3.
  - `wrong --version installs nothing`: staged file removed; no rename.
  - `install fails without touching the binary when the list is unreachable`: fetch 404 → no curl call.
  - `deletes flock's stock backup`: file present → removed, absent → no call.
  - `uninstalls Homebrew herdr`: `/opt/homebrew/bin/herdr` links into `Cellar/herdr/0.9.5` → `/opt/homebrew/bin/brew uninstall herdr` called; detail mentions Homebrew.
  - `hands off each stale running session`: two running sessions, one already on the new version → exactly one live-handoff call with `HERDR_SOCKET_PATH` of the other and `--expected-version 0.9.5-ms.2`.
  - `refused handoff leaves the server and reports restart`: live-handoff exits 1 → `ok: true`, no `server stop` call, detail ends with "restart herdr when your agents are done".
  - `restartStaleHerdrServers stops only stale servers`.
  - In `tools-install.test.ts`: replace the herdr vendor-script tests with `installRoute(herdr) is download` and `installTool(herdr) never runs a vendor script or brew install`.
- [ ] **Step 2:** Run `bun test lib/setup/__tests__/herdr-install.test.ts lib/setup/__tests__/tools-install.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `setup: install herdr from the fork's build list`.

### Task 3: The herdr row reads the verdict

**Files:**
- Modify: `lib/setup/validators/tools.ts` (`herdrRow`; remove `HERDR_FLOOR`)
- Test: `lib/setup/__tests__/validators-tools.test.ts` (herdr cases); snapshot `commands/__tests__/setup-copy.test.ts`

**Interfaces:**
- Consumes: Task 1's `fetchHerdrBuilds`, `parseHerdrVersion`, `herdrVerdict`; Task 2's `homebrewHerdr`, `staleHerdrSessions`.
- Produces: row `tool.herdr` states, checked top to bottom after the existing missing/timeout/exit branches, so a Homebrew copy is named even when the version is also stock:

| Condition | status | required | detail (copy) | action |
|---|---|---|---|---|
| Homebrew herdr present | invalid | true | `Homebrew's herdr would run instead of the mattstack build. Upgrade removes it` | Upgrade |
| `stock` | invalid | true | `herdr <v> is not the mattstack build. Upgrade installs <target>` | Upgrade (`install`, `via: "download"`) |
| `outdated`, `belowMinimum` | invalid | true | `herdr <v> is older than <target>, which mattstack needs` | Upgrade |
| `outdated` | needs-you | false, optionalNote `Installed by Install (herdr.integration).` | `herdr <v> has a newer mattstack build, <target>` | Upgrade |
| another herdr earlier on `p.env.PATH` than `~/.local/bin` (not a link to it, not Homebrew's) | needs-you | true | `<path> would run instead of the mattstack build. rt did not make it, so rt left it alone` | `steps`: `rm <path>` |
| `staleHerdrSessions` non-empty | needs-you | false, optionalNote `herdr keeps working; panes end only when you restart it.` | `Restart herdr when your agents are done` | `run`, label `Restart herdr`, verb `["tools", "restart", "herdr"]` |
| then today's integration check | as today | | ready detail adds ` (rt could not check for a newer build)` when `checked: false` | |

- [ ] **Step 1: Write the failing tests**, one per table row plus `newest fork build with the integration reads ready` and `non-brew shadow offers steps, never deletes` (assert no `rm`/`removeFile` call) and `stale server reads needs-you with Restart`. Drive the list through `fakeProbes({ fetch })`.
- [ ] **Step 2:** Run `bun test lib/setup/__tests__/validators-tools.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement; `provisionedInstallAction("herdr", …)` passes `via: "download"` for herdr.
- [ ] **Step 4:** Run it again. Expected: PASS. Then `bun test commands/__tests__/setup-copy.test.ts`; if only herdr copy moved, `bun test commands/__tests__/setup-copy.test.ts --update-snapshots` and read the diff.
- [ ] **Step 5:** Commit `setup: herdr row wants the fork's newest build`.

### Task 4: Update runs install it; Restart herdr

**Files:**
- Modify: `lib/setup/steps/tools.ts` (`herdrIntegrationRun`, step title `Set up herdr`)
- Modify: `commands/tools.ts` (`toolsRestart`), `lib/command-tree-def.ts` (`tools restart`)
- Test: `lib/setup/__tests__/steps-tools.test.ts` (or the file that holds `herdr.integration` tests; find it with `rg -l herdrIntegration lib/setup/__tests__`), `commands/__tests__/tools-restart.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces:
  - `herdr.integration` first reads the verdict: `stock` or `outdated`, or a Homebrew herdr present → `installHerdrBuild(ctx.p, hostArch())`; a failed install → `{ state: "failed", detail, remedy: "Open setup's herdr row and press Upgrade" }` and the integration is not attempted. Then `removeHerdrBackups`, then today's integration install. A missing herdr stays `skipped` (prepare installs it).
  - `rt tools restart herdr [--json]`: `restartStaleHerdrServers`; human output `out.line("done", "Restarted herdr", …)` or a failure naming the sessions that did not stop; `--json` envelope `{ stopped: string[], failed: string[] }`. Any other tool name: usage failure. Command-tree description: `Restart herdr's servers that run an older herdr (ends their panes)`.

- [ ] **Step 1: Write the failing tests**: `update run on stock herdr installs the fork build then the integration`; `failed install skips the integration`; `current build only installs the integration`; `restart herdr stops stale servers and prints them`; `restart rejects another tool`.
- [ ] **Step 2:** Run the two test files. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them, plus `bun test lib/setup/__tests__/update-safe.test.ts lib/__tests__/command-tree*.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `setup: update runs install the fork's herdr; rt tools restart herdr`.

### Task 5: Release preflight checks the minimum is published

**Files:**
- Modify: `lib/release/preflight.ts` (`checkHerdrMinimum`, wired into `runPreflight`)
- Modify: `skills/rt-release/SKILL.md` ("Gate: cut or hold each stale row": one bullet)
- Test: `lib/release/__tests__/preflight.test.ts`

**Interfaces:**
- Consumes: Task 1's `HERDR_BUILDS_URL`, `HERDR_MIN_BUILD`, `parseHerdrBuilds` (parse the `fetchJson` result via `JSON.stringify`).
- Produces: `checkHerdrMinimum(seams: PreflightSeams): Promise<CheckRow>` with `id: "herdr-minimum"`, `label: "herdr minimum build"`, `pinned: HERDR_MIN_BUILD`, `current: list.newest`; `ok` when a build's `version` equals the minimum, `stale` when not (`detail`: `rt needs herdr <min>, which m4ttstack/herdr has not published`), `error` when the list cannot be read.

- [ ] **Step 1: Write the failing tests**: `ok when the minimum is in the list`, `stale when it is not`, `error when the list cannot be read`.
- [ ] **Step 2:** Run `bun test lib/release/__tests__/preflight.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement and wire it.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Load `superpowers:writing-skills` and `mattstack:editing-skills`, then add to the stale-row gate: `**herdr minimum build**: the minimum fork build rt needs is not published yet. Hold only: publish it from m4ttstack/herdr (its release workflow), never lower the minimum to ship. A herdr catch-up never stales this row.`
- [ ] **Step 6:** Commit `release: preflight checks rt's minimum herdr build is published`.

### Task 6: Check against the published build

Runs once `herdr-builds.json` stops returning 404. If it still 404s at the end, report it under Notes and skip.

- [ ] **Step 1:** `curl -sL <HERDR_BUILDS_URL> | bun -e 'const {parseHerdrBuilds}=await import("./lib/setup/herdr-builds.ts");console.log(parseHerdrBuilds(await Bun.stdin.text())?.newest)'`. Expected: `0.9.5-ms.1`.
- [ ] **Step 2:** Under `env -i HOME="$(mktemp -d)" PATH=/usr/bin:/bin`, download this Mac's asset, check its sha256 against the list, run `--version` (expect `herdr 0.9.5-ms.1`) and `update` (expect `already up to date (0.9.5-ms.1)`, never a herdr.dev fetch).
