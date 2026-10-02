# rt Output Layer, Phase 6d (service verbs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The hidden service verbs (`services`, `apps`, `flavor takeover`, `bg`, `cron`, `reconciler`, `endpoint`, `rt --post-install`) print through the output layer, their `--json` replies and exit codes unchanged; the endpoint config's warning goes through `warn` (5a row 39); and `rt intercept run`'s passthrough notes lose their `rt-intercept:` prefix and long dash. Nine allowlist lines go.

**Architecture:** Each verb keeps its seam for the `--json` envelope (its `print` or `log` now writes through `out.payload`, byte for byte) and draws its human result with blocks built by small pure functions, so a test reads blocks through `renderPlain`. Usage failures use 5a's `usageFailure`; refusals by policy (`bg stop` with live claims, `apps enable` of an app rt does not manage) are `refused` notes.

**Tech Stack:** Bun + TypeScript, `bun:test` (fake probes from `lib/setup/__tests__/fakes.ts`, a fake daemon socket), the e2e suite, Fast Browser.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (RT-369), phase 6 ("Hidden verbs": `services`, `bg`, `cron`, `apps`, `reconciler`, `endpoint`, `flavor`), "Rules", "Copy style". **Scoping:** `docs/superpowers/plans/2026-10-02-rt-output-layer-phase-6-scoping.md`, 6d; 5a's warnings table row 39 (`docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5a-layer-additions.md`, "The warnings table"). House style: the 5f2 chat plan.

**Size:** about 1,700 changed lines. One PR.

**What was run while writing this plan:** nothing was compiled. Written against `origin/main` at `658e704b9`.

## Global Constraints

- Never use em dashes or en dashes anywhere. Today's `appNotRunning` message, the `services restart` line, the deck-omitted warning, the post-install notes, the endpoint config warning and the three passthrough notes each hold one; every one is replaced.
- Never write the phrase banned under the second heading of `~/.claude/rules/no-em-dashes.md`.
- Comments state only a constraint the code cannot show.
- `--json` keeps its shape: `apps list|enable|disable --json` (the tray decodes them), `services list|register|restart --json`, `flavor takeover --json` (the tray), `cron install|remove --json`, `bg status|release|stop --json`, `reconciler status|clear --json`, `endpoint lookup|release --json`. Human sentences inside an exit-2 envelope (`error.message`) may be reworded (cross-phase ruling 1, the 2026-10-01 spec ruling): `apps`' deck-not-running and not-managed messages, `services`' app-not-running message, `cron`'s board-missing message. Every other value is byte-identical. Task 3 pins `apps list` (deck down), `services list`, `bg status|release|stop` and `reconciler status|clear`. `flavor takeover --json` is pinned by `commands/__tests__/flavor-takeover.test.ts`'s `--json` cases (`:272-274`, `:282`, `:362`, `:407-410`), which must pass with only human-text expectations changed. The rest (`services register|restart`, `cron install|remove`, `endpoint lookup|release`, `apps enable|disable`) keep their `--json` line untouched: each task rewrites only the human branch, and the reviewer checks that in the diff.
- Exit codes do not change.
- Rule 2: human text on stdout; `rt --post-install`'s notes stay on stderr (`out.note`), because the installer may read setup's stdout. Rule 3: failures through `out.fail`, policy refusals as `refused` notes.
- Copy to "you", plainly; no paths, store names or ids in sentences; commands in a `next` callout.
- Run `bun test` only from the repo root. Never run a built `rt` outside an isolated HOME. No test quits an app, touches launchd or reaches the real tray or daemon: every one uses the fakes named per task.
- Git commands plain and alone from the worktree root. Never `git add -A`, `.` or `-u`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Files this slice must not edit: every file another phase 6 slice owns (`commands/intercept.ts` is 6h's: its `interceptNote` sink stays as it is); `lib/ui/**`; `lib/setup/**` except nothing (this slice edits none); `lib/deck-hand-agent.ts`; `rt-tray/**`.
- UI validation is mandatory (Task 9).

## Review Focus

1. **The tray's Apps settings reading `rt apps list --json` when deck is down.** It decodes the exit-2 envelope's `error.code`; only `error.message` may change words. Pinned in Task 3 (`apps list --json, deck down, keeps its envelope shape and code`).
2. **`rt flavor takeover dev --json` from the tray.** The success envelope's keys and values (`flavor`, `retired`, `bootedOut`, `handDeck`, `rt`) and the exit-2 failure envelope are byte-identical. Pinned by `commands/__tests__/flavor-takeover.test.ts`'s `--json` cases (`:272-274`, `:282`, `:362`, `:407-410`), which must pass with only its human-text expectations changed.
3. **`rt bg stop` while claims are live.** The daemon replies `{ ok: false, error: "bg server has live claims: <owners>" }` (`lib/daemon/handlers/bg.ts:43-50`) and the CLI exits 1 (`commands/__tests__/bg.test.ts:134-139`). It is rt declining, so a person reads a `refused` note naming the owners and the release command, not coral; the exit stays 1 and `--json` stdout stays empty. Pinned in Task 3 (`bg stop --json with live claims`) and Task 6 (`stop with live claims is a refusal that names the release command`).
4. **An intercepted dev server whose role is not set up.** The note must say plainly that the command ran without an rt port, with no `rt-intercept:` prefix and no long dash, while the debug traces keep their prefix (`commands/intercept.ts` matches it). Pinned in Task 8 (`a passthrough note is one plain sentence; debug traces keep their prefix`).
5. **An endpoint setting that cannot be resolved.** One warning, through `warn`, shown once per process, naming the repo by its label. Pinned in Task 8 (`an unresolvable endpoint setting warns once through warn`).

## Readers

| Reader | Reads | After |
|---|---|---|
| `rt-tray/Sources-core/Settings/AppsSettingsModel.swift:31,44` | `apps list --json`, `apps enable|disable <name> --json` | unchanged envelopes; `error.message` reworded |
| `rt-tray/Sources-core/Flavor/FlavorLaunch.swift:113` | `flavor takeover <dev|prod> --json` | unchanged |
| `rt-tray/Sources-core/Rt/RtFailureCopy.swift:56` | shows `apps list --json`'s `error.message` verbatim | each reworded message is one short line; `why` and `next` stay out of `message` |
| `commands/__tests__/intercept-output.test.ts:235`, `e2e/tests/endpoint.test.ts:394` | the passthrough note contains `passthrough` | changed in Task 8 to `ran without an rt port` |
| `lib/setup/steps/services.ts` | calls the tray directly, not `commands/services.ts` | unaffected |
| `scripts/e2e-cleanroom.sh:90`, the release `test-install` recipe | `rt --post-install` exit code | unchanged |
| `plugins/mattstack/.../shepherdr/SKILL.md:846` | names "the endpoint lookup" as a step through `rt_verb` (`--json`) | unchanged envelope |
| `e2e/tests/bg.test.ts`, `endpoint.test.ts`, `reconciler.test.ts` | through the binary | updated where they assert human text (Tasks 6, 8) |

## Copy table

"print" `out.print`, "note" `out.note`, "fail" `out.fail`. `<app>` is `TRAY_APP_NAME`.

### services

| Today | After |
|---|---|
| `mattstack.app is not running -- open it, then retry` (exit 2, message) | message `mattstack.app is not open`, `why: "rt asks it to manage background services."`, `next: "open -a mattstack"` |
| `mattstack.app returned an unexpected /services response (status <n>)` | message `mattstack.app gave an answer rt could not read`, `log: "status <n>"` |
| `rt services list: no registered agents` | print `line("skipped", "No background services are registered")` |
| `<label>: <status>` per agent | print `table` of `[strong(label), status word]`; status `enabled` as `running`, `requiresApproval` as `needs-you` ("waiting for your approval"), `notRegistered` and `notFound` as `off`, anything else as `skipped` with the raw word |
| `deck not bundled yet -- only the daemon is registered` (warn seam) | the seam takes one string, so note `line("warn", "Only the daemon was registered: this app does not carry deck yet")` |
| `rt services register: ok (<plists>)` / `failed (...)` | print `line("done", "Registered <n> background service(s)", <names>)` / fail `{ title: "mattstack.app did not register them", hint: <names> }` (exit 1 as today) |
| `rt services restart: <label> -- ok` / `failed` | print `line("done", "Restarted <label>")` / fail `{ title: "mattstack.app did not restart <label>" }` (exit 1) |
| usage (`usage: rt services restart <label> [--json]`) | human: fail `usageFailure("Which service?", "rt services restart <label>")`, exit 2; `--json`: unchanged |

### apps

| Today | After |
|---|---|
| `rt <verb>: deck is not running; open mattstack.app, then retry` (exit 2) | message `deck is not running`, `why: "rt changes apps through deck, which mattstack.app runs."`, `next: "open -a mattstack"` |
| `rt <verb>: deck answered an unreadable app list` / `deck answered <n> listing apps` / `deck answered <n>` | message `deck gave an answer rt could not read`, `log: <the old detail>` |
| `rt <verb>: deck has no app named <x>` | message `deck has no app called <x>`, `next: "rt apps list"` |
| `rt <verb>: <x> is not a mattstack app; rt manages only ...` | the code `not-managed` is rt declining: human: note `line("refused", "rt leaves <x> alone", "it is not one of the apps mattstack ships")`, exit 2 as today; `--json`: the envelope, message reworded to `<x> is not one of the apps mattstack ships` |
| `no mattstack apps registered` | print `line("skipped", "No mattstack apps are registered")` |
| `on   <name> <display>  (needs a team)` rows | print `table` of `[{on: "running" "on" / off: "off" "off"}, strong(name), displayName, dim("needs a team")]` |
| `rt apps enable: <x> is now on` | print `line("done", "Turned <x> on")` (or `Turned <x> off`) |
| usage | human: fail `usageFailure("Which app?", "rt apps enable <name>")` (or `disable`), exit 2; `--json` unchanged |

Today `fail` prints the human message through `deps.print` (stdout). After, human failures go to stderr (`out.fail`), as every converted verb's do; `--json` still prints its envelope through `deps.print`.

### flavor takeover

| Today | After |
|---|---|
| `rt flavor takeover: usage: rt flavor takeover <dev|prod>` | fail `usageFailure("Which app should this Mac run?", "rt flavor takeover <dev|prod>")` |
| `... no rt source checkout is known; set one with: rt settings source-path <path>` | fail `{ title: "rt does not know where your rt source is", next: cmd("rt settings source-path <path>") }` |
| `... <bundle> is not installed, so there is no compiled rt to link at <path>` | fail `{ title: "<bundle> is not installed", why: "The prod app carries the rt this Mac would run." }` |
| `... could not point <path> at the <target> app: <err>` | fail `{ title: "rt could not switch this Mac to the <target> app", why: <err> }` |
| the result lines (`<path> runs the source at <src>`, `<app> retired its daemon...`, `booted out <labels>`, ...) and `this Mac now runs the <target> app` | print `line("done", "This Mac now runs the <target> app")`, then `verbatim(<the same lines, without the leading spaces>, "what changed")` |

Exit 2 on every failure, as today; `--json` unchanged.

### bg, reconciler

| Today | After |
|---|---|
| `rt bg: <msg>` / `rt reconciler: <msg>` (daemon errors) | fail `{ title: <msg> }` |
| `rt bg: usage: rt bg release [<owner>] [--json]` | fail `usageFailure("Which claim?", "rt bg release <owner>")` |
| `rt reconciler: usage: rt reconciler clear <agentId> [--json]` | fail `usageFailure("Which agent?", "rt reconciler clear <agentId>")` |
| bg status: `server: up|down`, `socket: <path>`, claims | print `line(up ? "running" : "off", up ? "The background server is running" : "The background server is stopped")`; claims `section("Live claims", undefined, table([strong(owner), dim(pane or "-"), "<age>"]))` or `line("skipped", "No live claims")`; the socket path is in `--json` only |
| `released <owner>` / `<owner> was not claimed` | `line("done", "Released <owner>")` / `line("skipped", "<owner> was not claimed")` |
| `stopped` / the daemon's `bg server has live claims: <owners>` (exit 1) | `line("done", "Stopped the background server")` / note `line("refused", "Left the background server running", "it still has live claims: <owners>")`, `callout("next", cmd("rt bg release <first owner>"))`, exit 1 as today |
| reconciler status: `swept: <iso>|never`, `herdr: reachable|unreachable`, executors | `kv("last sweep", <local time> or "never")`, `line(reachable ? "done" : "warn", reachable ? "herdr is reachable" : "herdr is not reachable")`, `table` of `[strong(agentId), state word, dim(paneRef or "-")]` or `line("skipped", "No known executors")`; states: live `running`, blocked `needs-you`, hidden `off`, gone `warn` ("gone"), cleared `skipped`, unknown `skipped` |
| `cleared <agentId>` | `line("done", "Cleared <agentId>")` |

### cron

| Today | After |
|---|---|
| usage (exit 2) | human: fail `usageFailure("Which trigger?", "rt cron <install|remove> <trigger>", "The one trigger is board-triage.")`, exit 2; `--json` unchanged |
| `board binary not found -- resolve it first: \`rt deps resolve board\` (once bundled, ...)` | message `rt cannot find the board app`, `next: "rt deps resolve board"` |
| `rt cron install: installed "<name>"` + `the daemon arms it within 30 seconds ... (rt daemon restart arms it now)` | print `line("done", "Installed the <name> schedule", "the daemon picks it up within 30 seconds")`, `callout("tip", ["To start it now: ", cmd("rt daemon restart")])` |
| `rt cron remove: removed "<name>"` + the drop line | `line("done", "Removed the <name> schedule", "the daemon drops it within 30 seconds")`, the same tip |
| `rt cron remove: "<name>" was not installed` | `line("skipped", "The <name> schedule was not installed")` |

### endpoint

| Today | After |
|---|---|
| `rt endpoint: <msg>` failures | fail by kind: usage via `usageFailure("Which role?" / "Which worktree?", <usage>)`; `--path needs a value` / `--role needs a value` as `usageFailure`; `not in a git repo` as `{ title: "You are not in a git repo" }`; `repo "<n>" is not registered ...` as `{ title: "rt does not know this repo yet", why: "rt learns a repo the first time you run it there.", next: cmd("rt repos register .") }`; `daemon unavailable ... (rt daemon start)` as `{ title: "The rt daemon is not running", next: cmd("rt daemon start") }`; a daemon error as `{ title: <error> }`; `no claims to release` as `line("skipped", "No claims to release here")` (print, exit 1 as today) |
| lookup: `no claim for role "<r>" in <repo>` | `line("off", "No claim for the <r> role", <repo>)` |
| lookup: `<url> (running|claimed, not running|...|port taken)` | `line(status, <url>, <words>)`: running `running` "running"; claimed with a live process `pending` "the process is up but not listening yet"; claimed not running `off` "claimed, not running"; port taken `failed` "another process holds this port" |
| `worktree <name> (<path>)` | `kv("worktree", <name> or the folder name)` |
| `⚠ port <p> is listening, but pid <x> (<cmd>, <cwd>) does not belong to this worktree` | `line("warn", "Port <p> belongs to another worktree", "pid <x>, <cmd>")` |
| `the listening process (pid <x>, <cmd>) could not be attributed to a worktree` | `line("warn", "rt could not tell which worktree owns port <p>", "pid <x>, <cmd>")` |
| `⚠ running from the canonical main checkout, not a claimed worktree` | `line("warn", "This is the main checkout, not a worktree with a claim")` |
| release: `no claim(s) to release for <wt> (role "<r>") in <repo>` | `line("skipped", "No claims to release", "<wt><, role r>")` |
| `released <n> claim(s) for <wt> in <repo>` | `line("done", "Released <n> claim(s)", <wt>)` |
| `lib/endpoint/config.ts:235` `rt: ignoring "<key>" for repo "<repo>" -- <err>` | 5a row 39: `warn("endpoint", \`ignoring ${key} for ${repoName}: ${err.message}\`, { show: { title: \`An endpoint setting for ${repoLabel(repoName)} is being ignored\`, hint: <first line of err>, next: cmd("rt settings check") } })` |
| `lib/endpoint/run.ts:102` `rt-intercept: passthrough -- role "<r>" is not declared for repo "<repo>"` | `${command} ran without an rt port: ${repoLabel(repo)} has no ${role} role` |
| `:115` `rt-intercept: passthrough -- daemon unavailable or claim failed for role "<r>"` | `${command} ran without an rt port: rt could not reserve one for the ${role} role` |
| `:155` `rt-intercept: passthrough -- applying the claim for role "<r>" failed: <err>` | `${command} ran without an rt port: setting up the ${role} role failed (${err})` |
| `:88`, `:111` debug traces `rt-intercept: match ...`, `rt-intercept: claim result=...` | unchanged: `commands/intercept.ts`'s `DEBUG_TRACE` matches that prefix |

### post-install

| Today (stderr) | After (stderr, `out.note` / `out.fail`) |
|---|---|
| `rt: running from <root> -- drag mattstack.app to /Applications and run this again` (exit 2) | fail `{ title: "Run this from the installed app", why: "rt is running from a disk image or a moved copy, which can disappear mid-install.", next: "Drag mattstack.app to Applications, then run rt --post-install again" }` |
| `✓ migration: daemon healthy under the new registration` | note `line("done", "The daemon came back after the move to the new app")` |
| `✗ migration: daemon did not come up under the new registration yet` + `Check: rt daemon status / rt verify` | note `line("warn", "The daemon has not come back yet after the move")`, `callout("next", cmd("rt daemon status"))` |
| `NOTE: notification + full-disk-access permissions must be re-granted for <bundle> -- the bundle id changed ...` | note `line("needs-you", "Grant notifications and Full Disk Access to mattstack.app again", "the app's identity changed in this update")` |

The not-installed-yet `next` above is a sentence because the step is a drag in Finder, not a command; it is the one `next` in this slice that is not a `cmd`.

## File Structure

| File | Responsibility |
|---|---|
| `commands/services.ts`, `apps.ts`, `flavor.ts`, `bg.ts`, `cron.ts`, `reconciler.ts`, `endpoint.ts`, `post-install.ts` (modify) | blocks; seams for JSON |
| `lib/endpoint/config.ts`, `lib/endpoint/run.ts` (modify) | the warning; the passthrough copy |
| `commands/__tests__/service-verbs-json.test.ts` (create) | the `--json` pins |
| `commands/__tests__/services.test.ts`, `apps.test.ts`, `flavor-takeover.test.ts`, `bg.test.ts`, `endpoint.test.ts`, `lib/__tests__/post-install-sweep.test.ts`, `lib/endpoint/__tests__/intercept-run.test.ts`, `config.test.ts` (modify) | human expectations |
| `e2e/tests/bg.test.ts`, `endpoint.test.ts`, `reconciler.test.ts` (modify where they assert human text) | |
| `lib/__tests__/raw-output-allowlist.json` (modify) | nine lines |

---

### Task 1: Confirm the base

- [ ] **Step 1:** `git fetch origin`; `git rebase origin/main`.
- [ ] **Step 2:** Run each alone: `grep -n "export function warn" lib/ui/warn.ts`; `grep -n "export function usageFailure" lib/ui/usage.ts`; `grep -n "export function note" lib/ui/out.ts`. One line each, or **stop** and report. Then `grep -n "commands/services.ts\|commands/apps.ts\|commands/flavor.ts\|commands/bg.ts\|commands/cron.ts\|commands/reconciler.ts\|commands/endpoint.ts\|commands/post-install.ts\|lib/endpoint/config.ts" lib/__tests__/raw-output-allowlist.json`: nine lines, or stop.
- [ ] **Step 3:** Run the unit files in the File Structure table plus `lib/__tests__/no-raw-output.test.ts`. PASS, or stop and report.

---

### Task 2: Audit (no code)

The copy table above is the audit. Counts: guard lines `services` 1, `apps` 1, `flavor` 2, `bg` 7, `cron` 6, `reconciler` 5, `endpoint` 7, `post-install` 5, `lib/endpoint/config.ts` 1 (35); seam calls `services` 8, `apps` 5, `flavor` 5. Every command named in a `next` exists: `rt apps list`, `rt settings source-path`, `rt bg release`, `rt reconciler clear`, `rt deps resolve board`, `rt daemon restart`, `rt daemon start`, `rt daemon status`, `rt repos register`, `rt settings check` (checked against `lib/command-tree-def.ts`); `open -a mattstack` is the system `open`.

---

### Task 3: Pin the `--json` replies before converting

**Files:** Create `commands/__tests__/service-verbs-json.test.ts`.

- [ ] **Step 1: Write the tests**

```ts
/**
 * The service verbs' --json replies are read by the tray and by agents.
 * Pinned before the output layer touches the files; only a human sentence
 * inside an exit-2 envelope (error.message) may change words after.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { appsList, appsEnable, type AppsDeps } from "../apps.ts";
import { servicesList, servicesRestart, type ServicesDeps } from "../services.ts";
import { bgRelease, bgStatus, bgStop } from "../bg.ts";
import { reconcilerClear, reconcilerStatus } from "../reconciler.ts";
import { fakeProbes, fakeTray } from "../../lib/setup/__tests__/fakes.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

const at = (s: string) => s.replace(/"at":"[^"]+"/g, '"at":"<at>"');

let home: string;
let origHome: string | undefined;
let server: ReturnType<typeof Bun.serve>;
let replies: Record<string, unknown> = {};

beforeAll(() => {
  origHome = process.env.HOME;
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-service-json-")));
  process.env.HOME = home;
  mkdirSync(join(home, ".mattstack", "rt"), { recursive: true });
  server = Bun.serve({
    unix: join(home, ".mattstack", "rt", "rt.sock"),
    async fetch(req) {
      const cmd = new URL(req.url).pathname.slice(1);
      return Response.json(replies[cmd] ?? { ok: false, error: `unknown command: ${cmd}` });
    },
  });
});

afterAll(() => {
  server.stop(true);
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

class Exit extends Error {
  constructor(public code: number) {
    super("exit");
  }
}

async function captured(fn: () => Promise<void>): Promise<{ code: number; stdout: string }> {
  const io = captureOut({ console: true });
  ui.__test__.setHuman(() => false);
  const exit = spyOn(process, "exit").mockImplementation(((c?: number) => {
    throw new Exit(c ?? 0);
  }) as unknown as typeof process.exit);
  let code = 0;
  try {
    await fn();
  } catch (e) {
    if (e instanceof Exit) code = e.code;
    else throw e;
  } finally {
    exit.mockRestore();
  }
  const r = { code, stdout: io.stdout() };
  io.restore();
  return r;
}

function appsDeps(lines: string[], deck: Record<string, () => { status: number; body: string }>): AppsDeps {
  const probes = fakeProbes({ home: "/home/x" });
  return {
    probes: { ...probes, fetch: async (url: string, init?: { method?: string }) => (deck[`${init?.method ?? "GET"} ${new URL(url).pathname}`] ?? (() => ({ status: 404, body: "" })))() } as never,
    print: (s) => lines.push(s),
    exit: ((c: number) => {
      throw new Exit(c);
    }) as never,
  };
}

describe("service verbs --json (frozen shape)", () => {
  test("apps list --json, deck down, keeps its envelope shape and code", async () => {
    const lines: string[] = [];
    await expect(appsList(["--json"], {}, appsDeps(lines, {}))).rejects.toThrow();
    const body = JSON.parse(lines[0]!);
    expect(Object.keys(body).sort()).toEqual(["at", "contract", "error"]);
    expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
    expect(body.error.code).toBe("deck-not-running");
  });

  test("services list --json is the agents envelope", async () => {
    const lines: string[] = [];
    const agents = [{ label: "com.mattstack.daemon", status: "enabled" }];
    const deps: ServicesDeps = {
      probes: fakeProbes({ home: "/home/x", tray: fakeTray({ "GET /services": () => ({ status: 200, json: { agents } }) }) }),
      print: (s) => lines.push(s),
      warn: () => {},
      exit: ((c: number) => {
        throw new Exit(c);
      }) as never,
    };
    await servicesList(["--json"], {}, deps);
    expect(at(lines[0]!)).toBe('{"contract":1,"at":"<at>","agents":[{"label":"com.mattstack.daemon","status":"enabled"}]}');
  });

  test("bg and reconciler --json lines are the daemon data spread after ok", async () => {
    replies = { "bg:status": { ok: true, data: { up: true, socket: "/tmp/bg.sock", claims: [{ owner: "runner", pane: "bg:w1:p1", createdAt: 1 }] } } };
    expect((await captured(() => bgStatus(["--json"]))).stdout).toBe('{"ok":true,"up":true,"socket":"/tmp/bg.sock","claims":[{"owner":"runner","pane":"bg:w1:p1","createdAt":1}]}\n');
    replies = { "bg:release": { ok: true, data: { released: true } } };
    expect((await captured(() => bgRelease(["runner", "--json"]))).stdout).toBe('{"ok":true,"released":true}\n');
    replies = { "bg:stop": { ok: true, data: { stopped: true } } };
    expect((await captured(() => bgStop(["--json"]))).stdout).toBe('{"ok":true,"stopped":true}\n');
    replies = { "reconciler:status": { ok: true, data: { sweptAt: 0, herdrReachable: true, executors: [] } } };
    expect((await captured(() => reconcilerStatus(["--json"]))).stdout).toBe('{"ok":true,"sweptAt":0,"herdrReachable":true,"executors":[]}\n');
    replies = { "reconciler:clear": { ok: true, data: { cleared: true } } };
    expect((await captured(() => reconcilerClear(["ag-1", "--json"]))).stdout).toBe('{"ok":true,"cleared":true}\n');
  });

  test("bg stop --json with live claims: stdout empty, exit 1", async () => {
    replies = { "bg:stop": { ok: false, error: "bg server has live claims: runner, herd:h-1" } };
    expect(await captured(() => bgStop(["--json"]))).toEqual({ code: 1, stdout: "" });
  });
});
```

`envelope()` (`lib/setup/contract.ts`) writes the keys in its own order; read it and write the `services list` expectation in that order before running. The `bg:*` and `reconciler:*` command names are rt-client's (`packages/rt-client/src/client.ts`); if a wrapper sends a different path, use the path the wrapper sends. `appsDeps`' fake `fetch` returns `{ status, body }` as `Probes.fetch` does (read `lib/setup/probes.ts` for its exact shape and match it). Record any such adjustment in the ledger.

- [ ] **Step 2:** Run it: PASS on today's code. Twice more: PASS.
- [ ] **Step 3:** Commit, message `service verbs: pin the --json replies before the output layer touches them`.

---

### Task 4: `rt services` and `rt apps`

**Files:** `commands/services.ts`, `commands/apps.ts`, `commands/__tests__/services.test.ts`, `commands/__tests__/apps.test.ts`, the allowlist.

**Interfaces:**
- `ServicesDeps.print` and `AppsDeps.print` carry only `--json` envelopes now; their real implementations become `(s) => out.payload(\`${s}\n\`)`. `ServicesDeps.warn` stays a string seam; its real implementation becomes `(s) => out.note(out.line("warn", s))`.
- Produces: `servicesListBlocks(agents: ServiceAgent[]): Block[]`, `appsListBlocks(apps: AppRow[]): Block[]`, both exported.

- [ ] **Step 1: Failing tests.** In `services.test.ts`, the human-output tests read blocks:

```ts
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { servicesListBlocks } from "../services.ts";

test("services list for a person is a table with each status as a word", () => {
  expect(renderPlain(servicesListBlocks([{ label: "com.mattstack.daemon", status: "enabled" }, { label: "com.mattstack.deck", status: "requiresApproval" }]))).toMatch(
    /^com\.mattstack\.daemon +enabled\ncom\.mattstack\.deck +waiting for your approval\n$/,
  );
  expect(renderPlain(servicesListBlocks([]))).toBe("[skipped] No background services are registered\n");
});
```

Change `human output lists label: status per agent` to capture with `captureOut()` + `setHuman(() => false)` and expect `io.stdout()` to equal `renderPlain(servicesListBlocks(agents))`; change the deck-omitted warning test to expect `deps.warnings` to equal `["Only the daemon was registered: this app does not carry deck yet"]` (the seam takes one string: title, a colon, the hint). Do the same in `apps.test.ts` with:

```ts
import { appsListBlocks } from "../apps.ts";

test("apps list for a person: on and off as states, needs-a-team as a hint", () => {
  const text = renderPlain(appsListBlocks([{ name: "board", displayName: "Board", enabled: true, requiresTeam: true }, { name: "chat", displayName: "Chat", enabled: false, requiresTeam: false }]));
  expect(text).toMatch(/^on +board +Board +needs a team\noff +chat +Chat *\n$/);
});
```

(the hint cell is last and empty for `chat`; the plain renderer pads every cell but the last, so that row may end in spaces) and change the not-managed human case to expect stderr `[refused] rt leaves deck alone  it is not one of the apps mattstack ships`, exit 2.

These existing assertions read today's words and change on purpose, to the copy table's: `apps.test.ts:66-69` (the not-managed `error.message`), `:83` (`deck answered an unreadable app list`), `:89` (`no mattstack apps registered`, now read through `renderPlain(appsListBlocks([]))`); `services.test.ts:65` (`rt services list: no registered agents`). Every `error.code` assertion stays.

- [ ] **Step 2:** Run both files: FAIL.
- [ ] **Step 3: Implement** by the copy table. In `services.ts`:

```ts
import * as out from "../lib/ui/out.ts";
import type { Block, Segment } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";

export function realServicesDeps(): ServicesDeps {
  return { probes: createRealProbes(), print: (s) => out.payload(`${s}\n`), warn: (s) => out.note(out.line("warn", s)), exit: process.exit };
}

const SERVICE_STATUS: Record<string, { word: string; role: Segment["role"] }> = {
  enabled: { word: "enabled", role: "running" },
  requiresApproval: { word: "waiting for your approval", role: "needs-you" },
  notRegistered: { word: "not registered", role: "off" },
  notFound: { word: "not found", role: "off" },
};

export function servicesListBlocks(agents: ServiceAgent[]): Block[] {
  if (agents.length === 0) return [out.line("skipped", "No background services are registered")];
  return [out.table(agents.map((a) => { const s = SERVICE_STATUS[a.status] ?? { word: a.status, role: "skipped" as const }; return [out.strong(a.label), { text: s.word, role: s.role }]; }))];
}

function appNotRunning(json: boolean, verb: string, deps: ServicesDeps): never {
  exitUserError(new UserActionableError("app-not-running", "mattstack.app is not open", {}, { why: "rt asks it to manage background services.", next: "open -a mattstack" }), json, verb, deps.print);
}
```

`servicesList`'s human branch: `out.print(...servicesListBlocks(agents))`. The unreadable reply: `new UserActionableError("services-list-failed", "mattstack.app gave an answer rt could not read", {}, { log: \`status ${res.status}\` })`. `servicesRegister`'s deck-omitted warning: `deps.warn("Only the daemon was registered: this app does not carry deck yet")`; its human result: `ok ? out.print(out.line("done", \`Registered ${plists.length} background service${plists.length === 1 ? "" : "s"}\`, plists.join(", "))) : out.fail({ title: "mattstack.app did not register them", hint: plists.join(", ") })`, then `if (!ok) exitWith(deps, 1)`. `servicesRestart`: the same shape with `Restarted <label>` and `mattstack.app did not restart <label>`; its human usage branch: `out.fail(usageFailure("Which service?", "rt services restart <label>")); process.exit(2);` and the `--json` branch keeps `exitUserError(...)`.

In `apps.ts`, `realAppsDeps` prints envelopes with `out.payload`. `fail` splits:

```ts
function fail(deps: AppsDeps, json: boolean, err: UserActionableError, refusedName?: string): never {
  if (json) deps.print(JSON.stringify(userErrorPayload(err, deps.probes.now())));
  else if (refusedName !== undefined) out.note(out.line("refused", `rt leaves ${refusedName} alone`, "it is not one of the apps mattstack ships"));
  else out.fail(failureFor(err));
  return deps.exit(2);
}
```

(`failureFor` from `lib/errors.ts`.) `extra` is spread into the envelope's `error` object by `userErrorPayload`, so the refused app's name must not ride there: `fail` takes it as a fourth parameter instead, `fail(deps, json, err, refusedName?: string)`, and the refusal line reads `rt leaves ${refusedName} alone`. Only the 409 site passes it, and every call drops the `verb` argument the old `fail` took (the block carries no prefix). Rewrite the errors' messages by the copy table, with `why`, `next` and `log` in `UserActionableError`'s options argument. `printList`'s human branch: `out.print(...appsListBlocks(apps))`:

```ts
export function appsListBlocks(apps: AppRow[]): Block[] {
  if (apps.length === 0) return [out.line("skipped", "No mattstack apps are registered")];
  return [out.table(apps.map((a) => [{ text: a.enabled ? "on" : "off", role: a.enabled ? "running" : "off" }, out.strong(a.name), a.displayName, a.requiresTeam ? out.dim("needs a team") : ""]))];
}
```

`setEnabled`'s success: `json ? deps.print(<the same envelope>) : out.print(out.line("done", \`Turned ${name} ${enabled ? "on" : "off"}\`))`. Its usage: human `out.fail(usageFailure("Which app?", \`rt ${verb} <name>\`)); return deps.exit(2);`, `--json` the existing envelope.

Delete `commands/services.ts` and `commands/apps.ts` from the allowlist.

- [ ] **Step 4:** Run `bun test commands/__tests__/services.test.ts commands/__tests__/apps.test.ts commands/__tests__/service-verbs-json.test.ts lib/__tests__/no-raw-output.test.ts`. PASS; `grep -n "console\." commands/services.ts commands/apps.ts` prints nothing; `bun run typecheck` clean.
- [ ] **Step 5:** Commit, message `services, apps: tables and plain failures for a person; the envelopes the tray reads unchanged`.

---

### Task 5: `rt flavor takeover`

**Files:** `commands/flavor.ts`, `commands/__tests__/flavor-takeover.test.ts`, the allowlist.

**Interfaces:**
- `TakeoverSeams.log` carries only the `--json` envelope (real: `(s) => out.payload(\`${s}\n\`)`); `TakeoverSeams.error` is replaced by `fail(f: out.FailureInput): void` (real: `out.fail`), and a new `print(...blocks: Block[]): void` (real: `out.print`).
- Produces: `takeoverBlocks(target: Flavor, lines: string[]): Block[]`, exported.

- [ ] **Step 1: Failing tests.** In `flavor-takeover.test.ts`, every place that builds seams with `log`/`error` collecting strings adds `print: (...b) => printed.push(...b)` and `fail: (f) => failures.push(f)`; assertions on the human lines read `renderPlain(printed)`; the usage, no-source and no-prod-app failure assertions read `failures[0].title`. Add:

```ts
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { takeoverBlocks } from "../flavor.ts";

test("the takeover result is one line with what changed under it", () => {
  expect(renderPlain(takeoverBlocks("dev", ["~/.local/bin/rt runs the source at /code/rt", "booted out com.mattstack.daemon"]))).toBe(
    "[ok] This Mac now runs the dev app\nwhat changed:\n  ~/.local/bin/rt runs the source at /code/rt\n  booted out com.mattstack.daemon\n",
  );
});
```

(Check the plain `verbatim` form with `bun -e` before trusting the expected string: `renderPlain([verbatim(["a"], "c")])`.)

- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement.** `fail(seams, json, code, f: out.FailureInput)`: `if (json) seams.log(JSON.stringify(envelope({ ok: false, error: { code, message: <today's message string> } }))); else seams.fail(f); seams.exit(2);`. Pass each site its old message (for `--json`) and its copy-table failure (for a person). The end of `flavorTakeover`: `if (json) { seams.log(<unchanged>); return; } seams.print(...takeoverBlocks(target, lines));` with

```ts
export function takeoverBlocks(target: Flavor, lines: string[]): Block[] {
  return [out.line("done", `This Mac now runs the ${target} app`), ...(lines.length > 0 ? [out.verbatim(lines, "what changed")] : [])];
}
```

Delete `commands/flavor.ts` from the allowlist.

- [ ] **Step 4:** Run `bun test commands/__tests__/flavor-takeover.test.ts commands/__tests__/service-verbs-json.test.ts`. PASS.
- [ ] **Step 5:** Commit, message `flavor takeover: one result line with what changed; failures as failure blocks; --json unchanged`.

---

### Task 6: `rt bg` and `rt reconciler`

**Files:** `commands/bg.ts`, `commands/reconciler.ts`, `commands/__tests__/bg.test.ts`, `e2e/tests/bg.test.ts`, `e2e/tests/reconciler.test.ts`, the allowlist.

**Interfaces:**
- Produces: `bgStatusBlocks(data: Commands["bg:status"]["data"], now: number): Block[]`; `reconcilerStatusBlocks(data: Commands["reconciler:status"]["data"]): Block[]`. `renderStatus` in both files is deleted (its callers are the verbs and their tests).

- [ ] **Step 0: Move `bg.test.ts`'s `run` onto the capture** (passes on today's code). Its harness (`commands/__tests__/bg.test.ts:36-52`) spies only `console.log` and `console.error`, so once `bg.ts` writes through the layer every `r.stdout` and `r.stderr` would read `""`. Replace it with:

```ts
async function run(fn: (args: string[]) => Promise<void>, args: string[]) {
  const io = captureOut({ console: true });
  ui.__test__.setHuman(() => false);
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });
  let code = 0;
  try {
    await fn(args);
  } catch (e) {
    if (e instanceof Error && e.message === "process.exit sentinel") code = (exitSpy.mock.calls.at(-1)?.[0] as number | undefined) ?? 1;
    else throw e;
  } finally {
    exitSpy.mockRestore();
  }
  const r = { code, stdout: io.stdout(), stderr: io.stderr() };
  io.restore();
  return r;
}
```

(`import * as ui from "../../lib/ui/out.ts";` and `import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";`.) The capture keeps each line's newline where the old harness joined lines with `"\n"`, so the two exact checks gain it: `:89` `toBe("released herd:hd-1\n")` and `:124` `toBe("stopped\n")`. Every `toContain` and `JSON.parse` check (`:78`, `:80`, `:96`, `:102`, `:109`, `:116`, `:131`, `:138`) reads the same. Run the file: PASS with `bg.ts` untouched. Commit (`bg tests: read output through the capture helper`).

- [ ] **Step 1: Failing tests** (append to `commands/__tests__/bg.test.ts`, and create the reconciler cases there too, since no reconciler unit test exists):

```ts
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { bgStatusBlocks } from "../bg.ts";
import { reconcilerStatusBlocks } from "../reconciler.ts";

test("bg status: the server state, then its claims, with no socket path", () => {
  const text = renderPlain(bgStatusBlocks({ up: true, socket: "/tmp/bg.sock", claims: [{ owner: "runner", pane: "bg:w1:p1", createdAt: 0 }] }, 42_000));
  expect(text).toStartWith("[running] The background server is running\n");
  expect(text).toMatch(/runner +bg:w1:p1 +42s/);
  expect(text).not.toContain("/tmp/bg.sock");
  expect(renderPlain(bgStatusBlocks({ up: false, socket: "/s", claims: [] }, 0))).toBe("[off] The background server is stopped\n[skipped] No live claims\n");
});

test("reconciler status: the sweep, herdr, and each executor's state as a word", () => {
  const text = renderPlain(reconcilerStatusBlocks({ sweptAt: 0, herdrReachable: false, executors: [{ agentId: "ag-1", state: "blocked", paneRef: "w1:p2" }, { agentId: "ag-2", state: "gone", paneRef: null }] } as never));
  expect(text).toContain("last sweep: never");
  expect(text).toContain("[warning] herdr is not reachable");
  expect(text).toMatch(/ag-1 +waiting on you +w1:p2/);
  expect(text).toMatch(/ag-2 +gone +-/);
});
```

and, in the same file, replace `bg stop renders the daemon's refusal text plainly and exits 1` (`:134-139`) with `stop with live claims is a refusal that names the release command`: the daemon replies `{ ok: false, error: "bg server has live claims: herd:hd-1, runner:123" }` to `bg:stop`; `run(bgStop, [])` gives code 1 (kept), stdout `""`, and stderr `[refused] Left the background server running  it still has live claims: herd:hd-1, runner:123\n  next: rt bg release herd:hd-1\n`.

- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement** by the copy table:

```ts
export function bgStatusBlocks(data: Commands["bg:status"]["data"], now: number): Block[] {
  const head = data.up ? out.line("running", "The background server is running") : out.line("off", "The background server is stopped");
  if (data.claims.length === 0) return [head, out.line("skipped", "No live claims")];
  const rows = data.claims.map((c) => [out.strong(c.owner), out.dim(c.pane ?? "-"), `${Math.max(0, Math.round((now - c.createdAt) / 1000))}s`]);
  return [head, out.section("Live claims", undefined, out.table(rows))];
}
```

```ts
const EXECUTOR: Record<ExecutorState, { word: string; role: Segment["role"] }> = {
  live: { word: "live", role: "running" },
  blocked: { word: "waiting on you", role: "needs-you" },
  hidden: { word: "hidden", role: "off" },
  gone: { word: "gone", role: "warn" },
  cleared: { word: "cleared", role: "skipped" },
  unknown: { word: "unknown", role: "skipped" },
};

export function reconcilerStatusBlocks(data: Commands["reconciler:status"]["data"]): Block[] {
  const blocks: Block[] = [
    out.kv("last sweep", data.sweptAt > 0 ? new Date(data.sweptAt).toLocaleString() : "never"),
    data.herdrReachable ? out.line("done", "herdr is reachable") : out.line("warn", "herdr is not reachable"),
  ];
  if (data.executors.length === 0) return [...blocks, out.line("skipped", "No known executors")];
  return [...blocks, out.table(data.executors.map((e) => [out.strong(e.agentId), { text: EXECUTOR[e.state].word, role: EXECUTOR[e.state].role }, out.dim(e.paneRef ?? "-")]))];
}
```

(`ExecutorState` from `packages/rt-client/src/index.ts`; check the executor row type's field names in `ReconcilerStatus` and match them.) `fail(msg)` in both files becomes `out.fail({ title: msg }); process.exit(1);`; the two usage sites use `usageFailure`. Every `--json` line becomes `out.json({ ok: true, ...data })`. `bgStop` reads the reply itself, since the refusal arrives as `ok: false`:

```ts
const LIVE_CLAIMS = "bg server has live claims: ";

export async function bgStop(args: string[]): Promise<void> {
  const res = await clientStop();
  if (!res.ok && res.error?.startsWith(LIVE_CLAIMS)) {
    const owners = res.error.slice(LIVE_CLAIMS.length);
    out.note(out.line("refused", "Left the background server running", `it still has live claims: ${owners}`), out.callout("next", out.cmd(`rt bg release ${owners.split(", ")[0]}`)));
    process.exit(1);
  }
  const data = unwrap(res, "stop");
  if (args.includes("--json")) return void out.json({ ok: true, ...data });
  out.print(out.line("done", "Stopped the background server"));
}
```

The daemon's sentence is matched by its prefix; the handler and this file change together or not at all. Under `--json` the refusal leaves stdout empty and exits 1, as today, and the refused note still goes to stderr (shepherd ruling, review round 2), so a caller learns why; it replaces today's `rt bg: <sentence>` line there.

Update `e2e/tests/bg.test.ts` and `e2e/tests/reconciler.test.ts` where they assert today's plain text (`server: up`, `no live claims`, `swept:`, `cleared`): read each and change it to the new words; keep every `--json` assertion. Delete both files from the allowlist.

- [ ] **Step 4:** Run the unit file, the JSON pin, the guard, and `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/bg.test.ts e2e/tests/reconciler.test.ts`. PASS.
- [ ] **Step 5:** Commit, message `bg, reconciler: status as states and tables; bg stop with live claims is a refusal`.

---

### Task 7: `rt cron` and `rt --post-install`

**Files:** `commands/cron.ts`, `commands/post-install.ts`, `lib/__tests__/post-install-sweep.test.ts`, the allowlist.

- [ ] **Step 1: Failing tests.** Create the cron cases in a new `commands/__tests__/cron.test.ts`:

```ts
import { describe, expect, spyOn, test } from "bun:test";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { cronRemove } from "../cron.ts";

describe("rt cron for a person", () => {
  test("an unknown trigger is a usage failure naming the one trigger", async () => {
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    const exit = spyOn(process, "exit").mockImplementation(((c?: number) => {
      throw new Error(`exit ${c}`);
    }) as unknown as typeof process.exit);
    try {
      await expect(cronRemove(["nightly"])).rejects.toThrow("exit 2");
      expect(io.stderr()).toBe("Which trigger?\n  why: The one trigger is board-triage.\n  next: rt cron <install|remove> <trigger>\n");
      expect(io.stdout()).toBe("");
    } finally {
      exit.mockRestore();
      io.restore();
    }
  });
});
```

(Run `bun -e` on `renderPlain([failure(usageFailure("Which trigger?", "rt cron <install|remove> <trigger>", "The one trigger is board-triage."))])` first and use its exact output as the expectation.) `lib/__tests__/post-install-sweep.test.ts` captures by replacing `console.error` (`setUpFakes` and `tearDownFakes`, `:61-96`), which a note through the layer never reaches. Move it onto the capture first, so it reads the same text today and after:

```ts
let io: CapturedOut | undefined;
// in setUpFakes, in place of the console.error swap:
  io = captureOut({ console: true });
  ui.__test__.setHuman(() => false);
// in tearDownFakes, in place of restoring console.error:
  io?.restore();
  io = undefined;
```

and every `stderrLines.join("\n")` reads `io!.stderr()` (`import * as ui from "../ui/out.ts";`, `import { captureOut, type CapturedOut } from "../ui/__tests__/capture-out.ts";`; delete `stderrLines` and `originalConsoleError`). Run it on today's code: PASS. Then change the three expectations to the copy table's words: `:183` `not.toContain("Grant notifications and Full Disk Access to mattstack.app again")`, `:203` `toContain("Grant notifications and Full Disk Access to mattstack.app again")`, `:261` `toContain("Run this from the installed app")`.

- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement** by the copy table. `usageForTrigger`:

```ts
function usageForTrigger(json: boolean, verb: string): never {
  if (json) exitUserError(new UserActionableError("usage", `usage: rt cron ${verb} <trigger> [--json] (trigger: ${KNOWN_TRIGGERS.join(", ")})`), json, `cron ${verb}`);
  out.fail(usageFailure("Which trigger?", "rt cron <install|remove> <trigger>", `The one trigger is ${KNOWN_TRIGGERS.join(", ")}.`));
  process.exit(2);
}
```

(`exitUserError` with no `print` writes the envelope through `out.json`: the same bytes `console.log` wrote.) The board-missing error: `new UserActionableError("board-missing", "rt cannot find the board app", {}, { next: "rt deps resolve board" })`, no `print` argument. `cronInstall` and `cronRemove` human branches by the copy table; `--json` lines through `out.json(envelope(...))`.

`post-install.ts`: the transient refusal `out.fail({ title: "Run this from the installed app", why: "rt is running from a disk image or a moved copy, which can disappear mid-install.", next: "Drag mattstack.app to Applications, then run rt --post-install again" }); return exit(2);`; `reportMigrationOutcome` prints its notes with `out.note` by the copy table.

Delete `commands/cron.ts` and `commands/post-install.ts` from the allowlist.

- [ ] **Step 4:** Run `bun test commands/__tests__/cron.test.ts lib/__tests__/post-install-sweep.test.ts lib/__tests__/no-raw-output.test.ts`. PASS.
- [ ] **Step 5:** Commit, message `cron, post-install: plain result lines; usage as a usage failure; notes on stderr`.

---

### Task 8: `rt endpoint`, the endpoint config warning, and the passthrough notes

**Files:** `commands/endpoint.ts`, `lib/endpoint/config.ts`, `lib/endpoint/run.ts`, `commands/__tests__/endpoint.test.ts`, `commands/__tests__/intercept-output.test.ts`, `lib/endpoint/__tests__/intercept-run.test.ts`, `lib/endpoint/__tests__/config.test.ts`, `e2e/tests/endpoint.test.ts`, the allowlist.

**Interfaces:**
- `buildLookupOutput(data, ctx)` returns `{ payload, blocks: Block[] }` in place of `{ payload, lines }`; `payload` is unchanged.

- [ ] **Step 1: Failing tests.**

In `commands/__tests__/endpoint.test.ts`, change every `lines` assertion on `buildLookupOutput` to `renderPlain(r.blocks)`, with: unclaimed `[off] No claim for the web role  sample-app`; running `[running] http://localhost:4100  running`; a foreign listener `[failed] http://localhost:4100  another process holds this port` then `[warning] Port 4100 belongs to another worktree  pid 77, node`; the main checkout `[warning] This is the main checkout, not a worktree with a claim`; and `payload` deep-equal to today's (keep those assertions as they are).

In `lib/endpoint/__tests__/intercept-run.test.ts`, inside `describe("runInterception")`, add:

```ts
  test("a passthrough note is one plain sentence; debug traces keep their prefix", async () => {
    const { deps, calls } = harness({ claim: async () => null });
    await run(deps, ["run", "serve"]);
    expect(calls.warned).toContain("fakecmd ran without an rt port: rt could not reserve one for the web role");
    expect(calls.warned.every((w) => !w.startsWith("rt-intercept:"))).toBe(true);
    const traced = harness({ claim: async () => null });
    await run(traced.deps, ["run", "serve"], { RT_INTERCEPT_DEBUG: "1" });
    expect(traced.calls.warned.some((w) => w.startsWith("rt-intercept: match "))).toBe(true);
  });
```

(`run` passes the tool as `fakecmd` and the harness's rule names role `web`; `debug` is read from the caller's env, `RT_INTERCEPT_DEBUG`.) Change the two existing `w.includes("passthrough")` checks to `w.includes("ran without an rt port")`. Two more readers expect the old word and change the same way: `commands/__tests__/intercept-output.test.ts:235` (`expect(warned[2]).toContain("passthrough")` becomes `toContain("ran without an rt port")`) and `e2e/tests/endpoint.test.ts:394` (`expect(res.stderr).toContain("passthrough")`, likewise). 6h also edits `commands/__tests__/intercept-output.test.ts` (its left-alone line); whichever of 6d and 6h merges second rebases that file by hand.

In `lib/endpoint/__tests__/config.test.ts`, add `an unresolvable endpoint setting warns once through warn`: with `setWarningLog` capturing and a `getSetting` that throws for `rt.roles` (use the seam the existing tests use to inject a failing setting; if none exists, write a `rt.roles` value with an unsatisfiable `${...}` variable into the temp settings store the file's other tests use), `loadEndpointConfig` twice logs two warnings (module `endpoint`) and shows one note.

- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement.**

`buildLookupOutput`:

```ts
  const blocks: Block[] = [];
  const treeLabel = worktree.name ?? basename(worktree.path);
  if (!data.claimed) {
    blocks.push(out.line("off", `No claim for the ${ctx.role} role`, ctx.repoName));
  } else {
    const foreign = listener !== null && listener.ownsClaim === false;
    const [status, words] = foreign
      ? (["failed", "another process holds this port"] as const)
      : listener !== null
        ? (["running", "running"] as const)
        : data.running
          ? (["pending", "the process is up but not listening yet"] as const)
          : (["off", "claimed, not running"] as const);
    blocks.push(out.line(status, data.url ?? `port ${data.port}`, words));
  }
  blocks.push(out.kv("worktree", treeLabel));
  if (listener !== null && listener.ownsClaim === false) {
    blocks.push(out.line("warn", `Port ${data.port} belongs to another worktree`, `pid ${listener.pid}, ${listener.command}`));
  } else if (listener !== null && listener.ownsClaim === null) {
    blocks.push(out.line("warn", `rt could not tell which worktree owns port ${data.port}`, `pid ${listener.pid}, ${listener.command}`));
  }
  if (main) blocks.push(out.line("warn", "This is the main checkout, not a worktree with a claim"));
  return { payload, blocks };
```

`endpointLookup`: `if (json) { out.json(payload); return; } out.print(...blocks);`. `endpointRelease` by the copy table. `fail(msg)` is replaced at each site by the copy table's failure (keep exit 1); the `no claims to release` picker branch prints `out.line("skipped", "No claims to release here")` and exits 1 as today. Remove the `lib/tui.ts` import.

`lib/endpoint/config.ts`'s `resolveKey`:

```ts
  } catch (err) {
    const message = (err as Error).message;
    warn("endpoint", `ignoring ${key} for ${repoName}: ${message}`, {
      show: { title: `An endpoint setting for ${repoLabel(repoName)} is being ignored`, hint: message.split("\n")[0], next: cmd("rt settings check") },
    });
    return undefined;
  }
```

(imports: `warn` from `../ui/warn.ts`, `cmd` from `../ui/out.ts`, `repoLabel` from `../repo-label.ts`; the daemon reaches this file, and `lib/ui/warn.ts` and `lib/ui/out.ts` are daemon-safe per 5a; run `lib/__tests__/no-eager-tui.test.ts` and `lib/__tests__/no-daemon-sync-exec.test.ts` in Step 4.)

`lib/endpoint/run.ts`: the three passthrough `deps.warn(...)` calls take the copy table's sentences, with `repoLabel(rule.repo)` for the repo and `command` for the tool; the two debug traces are unchanged.

Update `e2e/tests/endpoint.test.ts` where it asserts plain lookup or release text. Delete `commands/endpoint.ts` and `lib/endpoint/config.ts` from the allowlist.

- [ ] **Step 4:** Run `bun test commands/__tests__/endpoint.test.ts lib/endpoint lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-daemon-sync-exec.test.ts commands/__tests__/intercept*.test.ts` and `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/endpoint.test.ts`. PASS. `rg -n "[\x{2013}\x{2014}]" lib/endpoint/run.ts lib/endpoint/config.ts commands/endpoint.ts`: no hit on a line this task wrote.
- [ ] **Step 5:** Commit, message `endpoint: lookup and release as states; the config warning through warn; intercept passthrough notes in plain words`.

---

### Task 9: Renders, AGENTS.md and every gate

- [ ] **Step 1:** `bun run ui:build`. In the scratchpad, `blocks-6d.ts` imports `servicesListBlocks`, `appsListBlocks`, `takeoverBlocks`, `bgStatusBlocks`, `reconcilerStatusBlocks`, `buildLookupOutput` (and `out`) from the worktree and emits: a services table with three statuses, an apps table, a takeover result, bg up with two claims, the bg stop refusal with its `next`, a reconciler status with four executor states, an endpoint lookup with a foreign listener, an endpoint lookup on the main checkout, the cron install line with its tip, the post-install migration notes, the apps not-managed refusal, and the endpoint-setting warning (`line("warn", ...)` + `next`). Copy 5f2's `ansi-page.ts`.
- [ ] **Step 2:** Render at width 100, dark and light, as in 6a Task 8 Step 2.
- [ ] **Step 3:** Screenshot both with Fast Browser into `docs/design/output-layer/6d-services-dark.png` and `6d-services-light.png`. Write down plainly what reads wrong: only "another process holds this port" may be coral; "waiting for your approval" and "waiting on you" read as needing you; the refusals read as rt declining; the takeover's "what changed" lines sit under their line on the thin rail. Fix and re-render.
- [ ] **Step 4:** README row: `| \`6d-services-dark.png\`, \`6d-services-light.png\` | the hidden service verbs at 100 columns: services and apps tables, a flavor takeover, bg and reconciler status, the bg stop refusal, two endpoint lookups, a cron install, the post-install notes, the apps refusal and an endpoint setting warning |`.
- [ ] **Step 5:** AGENTS.md (append to "Output layer"):

```markdown
The service verbs (`services`, `apps`, `flavor takeover`, `bg`, `cron`,
`reconciler`, `endpoint`) keep a seam for their `--json` envelope, which
writes through `out.payload`, and draw everything a person reads with
blocks. Their human failures moved from stdout to stderr; the envelopes the
tray reads did not change. `rt intercept run`'s passthrough notes are plain
sentences; only its debug traces keep the `rt-intercept:` prefix, because
`commands/intercept.ts` routes them to the log by that prefix.
```

- [ ] **Step 6:** The eight gates, one at a time (as 6a Task 8 Step 6). All pass.
- [ ] **Step 7:** Commit the PNGs, README and AGENTS.md, message `docs: service verb renders and the output layer rule for their seams`.

---

### Task 10: Ship

- [ ] **Step 1:** `git fetch origin`; `git rebase origin/main`; merge the allowlist, `AGENTS.md` and README by hand.
- [ ] **Step 2:** The eight gates again; the JSON pin passes as committed.
- [ ] **Step 3:** `git diff --shortstat origin/main...HEAD`; about 1,700 lines; put it in the report.
- [ ] **Step 4:** Push with `git_push`; body in `<scratchpad>/pr-body-6d.md` (framing; **Services and apps**, **Flavor**, **bg and reconciler**, **cron and post-install**, **endpoint and intercept** groups; renders; gates; last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`); `gh pr create --repo m4ttstack/mattstack --title "RT-369: output layer phase 6d, services" --body-file <scratchpad>/pr-body-6d.md`.
- [ ] **Step 5:** Report URL, gates, size, renders. Do not merge.

---

## Decisions this plan made

1. **Human failures of `apps` move from stdout to stderr.** Today `apps`' `fail` prints the human message through `deps.print` (stdout). Rule 3 puts failures on stderr; the tray reads only `--json`, so nothing parses the plain text.
2. **`apps enable` of a non-mattstack app is a refusal** (`refused` note, exit 2 as today): rt declines by policy; the envelope's code stays `not-managed`.
3. **`bg status` drops the socket path for a person;** `--json` keeps it.
4. **`rt --post-install`'s notes stay on stderr** (`out.note`), not stdout, because the installer may run setup with `--json`, whose stdout is an envelope stream.
5. **The transient-root `next` is a sentence, not a command**: the step is a drag in Finder.
6. **`rt bg stop` with live claims is a refused note and keeps exit 1**, on stderr under `--json` too (shepherd ruling, review round 2). The daemon answers `ok: false`; the CLI recognises its sentence by prefix and draws a refusal naming the owners and `rt bg release <first owner>` instead of coral.
7. **`flavor takeover`'s "what changed" lines keep their full paths.** They sit in a `verbatim` block captioned "what changed", which is a record of the files rt touched, not a sentence; the success line above it names no path.

## Self-Review

**Spec coverage.** Phase 6's `services`, `bg`, `cron`, `apps`, `reconciler`, `endpoint`, `flavor`: Tasks 4 to 8; `post-install` (phase 5 ruling 4): Task 7. 5a row 39: Task 8. The intercept passthrough fold-in: Task 8. `--json` frozen: Task 3. Nine allowlist lines: Tasks 4 to 8.

**Placeholders.** None. Task 3 names three source shapes to read and match before running.

**Type consistency.** `servicesListBlocks`, `appsListBlocks`, `takeoverBlocks`, `bgStatusBlocks`, `reconcilerStatusBlocks`, `buildLookupOutput`'s `{ payload, blocks }` match across tasks and renders.

**Review Focus.** Five lines, each pinned by a named test.
