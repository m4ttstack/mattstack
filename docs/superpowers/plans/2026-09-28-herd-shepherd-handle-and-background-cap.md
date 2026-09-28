# Herd shepherd handle and background cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Worker briefs name the shepherd's real chat handle (RT-356), and the herd watchdog's background-work exemption expires after 60 minutes with the task named in the evidence (RT-359).

**Architecture:** RT-356: the job template gains a `<shepherd handle>` slot that brief assembly passes through, and `herd:spawn` fills it from the herd row on every launch. RT-359: the watchdog sensor reports the background task and when it began; the evaluator exempts only work younger than a fixed `backgroundCapMins`.

**Tech Stack:** Bun, TypeScript, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-09-28-herd-shepherd-handle-and-background-cap-design.md`

## Global Constraints

- Run every `bun test` from the repo root (bunfig preload only loads from cwd).
- Write fence: `lib/daemon/herd-watchdog*.ts`, `lib/herd-brief.ts`, `commands/herd.ts`, `lib/daemon/handlers/herd.ts`, their tests, `plugins/mattstack/attachments/orchestration/shepherdr/references/job-template.md`, the compiled `plugins/mattstack/skills/shepherdr/`, `plugins/mattstack/.claude-plugin/plugin.json`, generated `apps/board/skills/`, `docs/`. Never edit `apps/board/skills-src`, `lib/mcp/`, `packages/`, or `plugins/mattstack/CERTIFICATION.md`.
- No em or en dashes anywhere (code, comments, prose, commits).
- Comments only state constraints the code cannot show; no ticket narration beyond the existing `(RT-nnn)` tag style.
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- `backgroundCapMins` is a fixed 60 in `CONFIG_DEFAULTS`; no settings key.
- Never run a built binary or the daemon against the real HOME; never kill by pattern.

## Review Focus

1. A brief whose `<shepherd handle>` word-wraps across a line break (`<shepherd\nhandle>`) must still be filled at spawn: Task 1 tests it.
2. An explicit `--fill "shepherd handle=x"` must still win over spawn: Task 1 tests it (spawn then finds no marker).
3. HTML comments (`<!-- mcp-lint: allow -->`) and other markers in a brief must survive `fillSpawnSlots` untouched: Task 1 tests it.
4. Background work exactly at the cap is no longer exempt (strict `<`): Task 4 tests 59m exempt and 60m not.
5. A pane whose background work clears and later returns restarts its clock rather than inheriting the old stamp: Task 4 tests it.

---

### Task 1: Brief assembly passes the spawn-filled slot through; `fillSpawnSlots`

**Files:**
- Modify: `lib/herd-brief.ts`
- Test: `lib/__tests__/herd-brief.test.ts`

**Interfaces:**
- Produces: `export const SPAWN_FILLED_SLOTS: readonly string[]` (`["shepherd handle"]`) and `export function fillSpawnSlots(brief: string, values: Record<string, string>): string`.

- [ ] **Step 1: Write the failing tests** (append a new `describe` to `lib/__tests__/herd-brief.test.ts`; add `fillSpawnSlots` to the existing import from `../herd-brief.ts`)

```ts
describe("spawn-filled slots (RT-356)", () => {
  const TEMPLATE = "# JOB: <name>\n\n## Method\n<method>\n\n## Messages\nDM <shepherd handle> when stuck.\n";
  const method = { kind: "file" as const, content: "do it" };

  test("an unfilled <shepherd handle> is not a leftover and passes through verbatim", () => {
    const r = assembleBrief({ template: TEMPLATE, job: "j", fills: {}, method });
    if (!r.ok) throw new Error(r.error);
    expect(r.brief).toContain("DM <shepherd handle> when stuck.");
  });

  test("an explicit fill still wins, leaving spawn nothing to replace", () => {
    const r = assembleBrief({ template: TEMPLATE, job: "j", fills: { "shepherd handle": "ann" }, method });
    if (!r.ok) throw new Error(r.error);
    expect(r.brief).toContain("DM ann when stuck.");
    expect(fillSpawnSlots(r.brief, { "shepherd handle": "tom" })).toBe(r.brief);
  });

  test("other unfilled markers are still refused", () => {
    const r = assembleBrief({ template: TEMPLATE + "<paths>\n", job: "j", fills: {}, method });
    expect(r).toMatchObject({ ok: false, leftover: ["paths"] });
  });

  test("fillSpawnSlots replaces every marker, including one wrapped across a line", () => {
    expect(fillSpawnSlots("to <shepherd handle>, and\n<shepherd\nhandle> again", { "shepherd handle": "tom" })).toBe("to tom, and\ntom again");
  });

  test("fillSpawnSlots leaves comments, other markers and unknown slots alone", () => {
    const text = "x <!-- mcp-lint: allow --> <id> <paths>";
    expect(fillSpawnSlots(text, { "shepherd handle": "tom", paths: "p" })).toBe(text);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/__tests__/herd-brief.test.ts`
Expected: FAIL (`fillSpawnSlots` is not exported; the first test reports `unfilled markers: shepherd handle`).

- [ ] **Step 3: Implement** in `lib/herd-brief.ts`

Add after `normalizeMarkerName`:

```ts
/** Slots herd:spawn fills from the herd row on every launch, so assembly
    passes them through rather than refusing them as leftovers. */
export const SPAWN_FILLED_SLOTS: readonly string[] = ["shepherd handle"];

const SPAWN_MARKER_RE = /<([^<>]+)>/g;

export function fillSpawnSlots(brief: string, values: Record<string, string>): string {
  return brief.replace(SPAWN_MARKER_RE, (whole, raw: string) => {
    const name = normalizeMarkerName(raw);
    return SPAWN_FILLED_SLOTS.includes(name) && values[name] !== undefined ? values[name]! : whole;
  });
}
```

In `substituteMarkers`, the `value === undefined` branch becomes:

```ts
      } else {
        out += m[0];
        if (!SPAWN_FILLED_SLOTS.includes(name) && !seenLeftover.has(name)) {
          seenLeftover.add(name);
          leftover.push(name);
        }
      }
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/__tests__/herd-brief.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add lib/herd-brief.ts lib/__tests__/herd-brief.test.ts
git commit -m "herd brief: pass the spawn-filled shepherd handle slot through; add fillSpawnSlots (RT-356)"
```

### Task 2: `herd:spawn` fills the shepherd handle from the herd row

**Files:**
- Modify: `lib/daemon/handlers/herd.ts` (the `"herd:spawn"` handler, around the `agent:start` call)
- Test: `lib/daemon/__tests__/herd-handlers.test.ts` (inside `describe("herd:spawn", ...)`)

**Interfaces:**
- Consumes: `fillSpawnSlots` from `lib/herd-brief.ts` (Task 1); `deps.identityNames(ids: Iterable<string>): Map<string, string>` (already on `HerdDeps`).

- [ ] **Step 1: Write the failing tests** (the `harness(over)` in this file accepts an `identityNames` override; `START`, `harness` and `readFileSync`/`join` are already in scope)

```ts
  test("RT-356: the prompt names the herd's current shepherd, and job.md keeps the slot for the next launch", async () => {
    let shepherdName = "tom";
    const hx = harness({ identityNames: (ids: Iterable<string>) => new Map([...ids].map((id) => [id, shepherdName])) });
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    const first = await hx.h["herd:spawn"]({ herd: s.data.herd, job: "job-a", brief: "# job\nDM <shepherd handle> when done.", dir: "/t" });
    if (!first.ok) throw new Error(first.error);
    expect(hx.agentCalls[0].prompt).toContain("DM tom when done.");
    expect(hx.agentCalls[0].prompt).not.toContain("<shepherd handle>");
    expect(readFileSync(join(hx.dir, "herds", s.data.herd, "job-a", "job.md"), "utf8")).toContain("<shepherd handle>");
    shepherdName = "ann";
    const again = await hx.h["herd:spawn"]({ herd: s.data.herd, job: "job-a", dir: "/t" });
    if (!again.ok) throw new Error(again.error);
    expect(hx.agentCalls[1].prompt).toContain("DM ann when done.");
  });

  test("RT-356: a brief with no slot is launched unchanged", async () => {
    const { h, agentCalls, herd } = await started();
    const res = await h["herd:spawn"]({ herd, job: "job-a", brief: "# job\nplain", dir: "/t" });
    if (!res.ok) throw new Error(res.error);
    expect(agentCalls[0].prompt).toBe("# job\nplain");
  });
```

If `agentCalls[0].prompt` is not the raw brief today (check the existing first spawn test, which uses `toContain`), change the second test's assertion to `toContain("# job\nplain")`.

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/daemon/__tests__/herd-handlers.test.ts -t "RT-356"`
Expected: FAIL on `toContain("DM tom when done.")`.

- [ ] **Step 3: Implement** in `lib/daemon/handlers/herd.ts`

Import: `import { fillSpawnSlots } from "../../herd-brief.ts";`

Just before `const started = await deps.agent["agent:start"]({`:

```ts
      const shepherdName = deps.identityNames([herd.shepherdHandle]).get(herd.shepherdHandle) ?? herd.shepherdHandle;
```

and in the `agent:start` payload replace `prompt: brief,` with:

```ts
        prompt: fillSpawnSlots(brief, { "shepherd handle": shepherdName }),
```

`brief` stays as written to `job.md`, so the stored copy keeps the marker.

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/daemon/__tests__/herd-handlers.test.ts`
Expected: PASS, whole file.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/handlers/herd.ts lib/daemon/__tests__/herd-handlers.test.ts
git commit -m "herd spawn: fill the shepherd handle from the herd row on every launch (RT-356)"
```

### Task 3: Template names the shepherd; recompile; plugin bump; board skills

**Files:**
- Modify: `plugins/mattstack/attachments/orchestration/shepherdr/references/job-template.md` (`## Messages`)
- Regenerate: `plugins/mattstack/skills/shepherdr/` (compiled copy)
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (`0.27.8` to `0.27.9`)
- Regenerate: `apps/board/skills/`
- Test: `lib/__tests__/herd-brief.test.ts`

Load `superpowers:writing-skills` before editing the template (standing rule for any skill file); keep the edit to the prose below.

**Interfaces:**
- Consumes: `assembleBrief`, `fillSpawnSlots` (Task 1).

- [ ] **Step 1: Write the failing test** (append to the Task 1 `describe`; add `readFileSync` from `fs` and `join` from `path` to the imports if missing)

```ts
  test("the real job template names the shepherd by the spawn-filled handle, never a bare shepherd", () => {
    const template = readFileSync(join(import.meta.dir, "../../plugins/mattstack/attachments/orchestration/shepherdr/references/job-template.md"), "utf8");
    const probe = assembleBrief({ template, job: "j", fills: {}, method });
    const leftover = probe.ok ? [] : (probe.leftover ?? []);
    const r = assembleBrief({ template, job: "j", fills: Object.fromEntries(leftover.map((n) => [n, "x"])), method });
    if (!r.ok) throw new Error(r.error);
    expect(r.brief).toContain("<shepherd handle>");
    const brief = fillSpawnSlots(r.brief, { "shepherd handle": "tom" });
    const messages = brief.slice(brief.indexOf("## Messages"), brief.indexOf("## Git"));
    expect(messages).toContain("Your shepherd is tom in chat");
    expect(messages).toMatch(/`chat_dm` to\s+tom\b/);
    expect(brief).not.toContain("<shepherd handle>");
    expect(brief).not.toMatch(/(?:chat_dm|chat dm)\s+`?shepherd\b/);
    expect(brief).not.toMatch(/\bto:?\s+`?shepherd`?[\s.,]/);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/__tests__/herd-brief.test.ts`
Expected: FAIL on `toContain("<shepherd handle>")`.

- [ ] **Step 3: Edit the template.** In `## Messages`, insert these lines directly under the heading, before `Chat arrives as`:

```markdown
Your shepherd is <shepherd handle> in chat. Anything you send the shepherd
outside a gate, a milestone or a report goes by `chat_dm` to
<shepherd handle>, never to a handle guessed from the role.
```

The slot sits outside any backtick or quote span, so assembly treats it as a real slot.

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/__tests__/herd-brief.test.ts`
Expected: PASS.

- [ ] **Step 5: Recompile, bump, expand**

```bash
bun cli.ts skills compile --pack mattstack
```
(run from the repo root; if it needs a HOME, run it as `env -i HOME="$(mktemp -d)" PATH="$PATH" bun cli.ts skills compile --pack mattstack --mattstack-dir .` and check `bun cli.ts skills compile --help` for the exact flags). Confirm `git diff --stat` shows `plugins/mattstack/skills/shepherdr/references/job-template.md` with the same three lines and nothing unrelated.

Bump `plugins/mattstack/.claude-plugin/plugin.json` `"version": "0.27.8"` to `"0.27.9"`, then:

```bash
bun run skills:expand:board
bun test lib/__tests__/no-board-skills-drift.test.ts
```
Expected: drift test PASS; `git status` shows only `apps/board/skills/` version-stamp changes plus the files above.

- [ ] **Step 6: Commit**

```bash
git add plugins/mattstack/attachments/orchestration/shepherdr/references/job-template.md plugins/mattstack/skills/shepherdr plugins/mattstack/.claude-plugin/plugin.json apps/board/skills lib/__tests__/herd-brief.test.ts
git commit -m "shepherdr job-template: name the shepherd by its spawn-filled chat handle (0.27.9) (RT-356)"
```

### Task 4: Background-work exemption expires; the evidence names the task

**Files:**
- Modify: `lib/daemon/herd-watchdog.ts`
- Modify: `lib/daemon/herd-watchdog-adapters.ts`
- Test: `lib/daemon/__tests__/herd-watchdog.test.ts`, `lib/daemon/__tests__/herd-watchdog-adapters.test.ts`

**Interfaces:**
- Produces: `WatchdogSensors.backgroundWork(pane: string): { task: string; sinceMs: number } | null`; `WatchdogConfig.backgroundCapMins: number`; `export function backgroundTask(screen: string): string | null` (replaces `hasBackgroundWork`).

- [ ] **Step 1: Update the evaluator tests.** In `herd-watchdog.test.ts`:
  - add `backgroundCapMins: 60,` to the `cfg` literal;
  - default sensor `backgroundWork: () => null,`;
  - add `const bgFor = (mins: number) => () => ({ task: "1 shell", sinceMs: NOW - mins * MIN });`;
  - every existing `backgroundWork: () => true` becomes `backgroundWork: bgFor(5)`, and `backgroundWork: (p) => p === "w1:p1"` becomes `backgroundWork: (p) => (p === "w1:p1" ? { task: "1 shell", sinceMs: NOW - 5 * MIN } : null)`.

Then append to `describe("evaluateJob", ...)`:

```ts
  test("RT-359: background work younger than the cap still exempts; at the cap it does not", () => {
    const young = sensors({ ...idleFor(80), backgroundWork: bgFor(59) });
    expect(evaluateJob(job({ updatedAt: NOW - 90 * MIN }), young, cfg)).toEqual({ kind: "healthy" });
    const capped = sensors({ ...idleFor(80), backgroundWork: bgFor(60) });
    expect(evaluateJob(job({ updatedAt: NOW - 90 * MIN }), capped, cfg)).toEqual({ kind: "wedged", path: "backstop", evidence: "idle 80m with no open gate; background 1 shell for 60m" });
  });

  test("RT-359: a done job on background work past the cap draws the nag, naming the task", () => {
    const s = sensors({ ...idleFor(40), backgroundWork: bgFor(61) });
    const j = job({ status: "done", lastReport: 2758, updatedAt: NOW - 60 * MIN });
    expect(evaluateJob(j, s, cfg)).toEqual({
      kind: "finished-lingering",
      evidence: "job-a done with report 60m ago, quiet 40m; background 1 shell for 61m; if a follow-up round is in flight run rt herd follow-up job-a --herd demo-1, else rt herd close job-a --herd demo-1",
    });
  });

  test("RT-359: the shepherd backstop fires on a done job whose background work outlived the cap", () => {
    const s = sensors({ paneState: () => "idle", backgroundWork: bgFor(61), jobs: () => [job({ status: "done", lastReport: 2758, updatedAt: NOW - 90 * MIN })] });
    expect(evaluateShepherd(herd(), s, { ...cfg, nagMins: 120 })).toEqual({
      kind: "wedged", path: "backstop",
      evidence: "job-a done with report 90m ago, quiet 90m, not yet closed; background 1 shell for 61m; if a follow-up round is in flight run rt herd follow-up job-a --herd demo-1, else rt herd close job-a --herd demo-1",
    });
  });
```

- [ ] **Step 2: Update the adapter tests.** In `herd-watchdog-adapters.test.ts`:
  - import `backgroundTask` instead of `hasBackgroundWork`; rename `describe("hasBackgroundWork"` to `describe("backgroundTask"`;
  - `expect(hasBackgroundWork(SHELL_FOOTER)).toBe(true)` becomes `expect(backgroundTask(SHELL_FOOTER)).toBe("1 shell")`; `SHELL_MONITOR_FOOTER` gives `"1 shell, 1 monitor"`; `AGENTS_PANEL` gives `"subagent general-purpose Throwaway footer… 5s"`; every `.toBe(false)` becomes `.toBeNull()`; in the captured-fixture block, `CAPTURED` gives `"1 shell"`, and `withoutCount` gives a string starting with `"subagent "` (`expect(backgroundTask(withoutCount)).toStartWith("subagent ")`);
  - in `describe("watchdog sensors: background work"`, `.toBe(true)` becomes `.toEqual({ task: "1 shell", sinceMs: NOW })` and `.toBe(false)` becomes `.toBeNull()`;
  - add `backgroundCapMins: 60,` to the `readWatchdogConfig` `toEqual` literal.

Append to `describe("watchdog sensors: background work", ...)`:

```ts
  test("RT-359: the clock starts at the first busy sweep, holds while busy, and restarts after it clears", async () => {
    const clock = { now: NOW };
    const screens: Record<string, string> = { "w1:p1": SHELL_FOOTER };
    const { sensors } = fx({ snapshots, jobs: [jobRow()], screens, clock });
    await sensors.refresh();
    clock.now = NOW + 5 * MIN;
    await sensors.refresh();
    expect(sensors.backgroundWork("w1:p1")).toEqual({ task: "1 shell", sinceMs: NOW });
    screens["w1:p1"] = PLAIN_FOOTER;
    clock.now = NOW + 6 * MIN;
    await sensors.refresh();
    expect(sensors.backgroundWork("w1:p1")).toBeNull();
    screens["w1:p1"] = SHELL_MONITOR_FOOTER;
    clock.now = NOW + 7 * MIN;
    await sensors.refresh();
    expect(sensors.backgroundWork("w1:p1")).toEqual({ task: "1 shell, 1 monitor", sinceMs: NOW + 7 * MIN });
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test lib/daemon/__tests__/herd-watchdog.test.ts lib/daemon/__tests__/herd-watchdog-adapters.test.ts`
Expected: FAIL (`backgroundTask` not exported; the RT-359 evaluator tests read healthy).

- [ ] **Step 4: Implement the evaluator** in `lib/daemon/herd-watchdog.ts`

Sensor doc and type:

```ts
  /** The background shell, monitor or subagent the pane's idle readings have
      shown without a break, and when that run began; null when none. A turn
      that ended to wait on one is working, not wedged, until
      backgroundCapMins. Job panes only; never the shepherd's. */
  backgroundWork(pane: string): { task: string; sinceMs: number } | null;
```

Config field, after `nagMins: number;`:

```ts
  /** How long background work alone keeps a pane off the nag and the
      backstop (RT-359). Fixed in the defaults; not a settings key. */
  backgroundCapMins: number;
```

Helper, after `oldest`:

```ts
type Background = { exempt: true } | { exempt: false; note: string };

function background(pane: string, s: WatchdogSensors, cfg: WatchdogConfig, now: number): Background {
  const bg = s.backgroundWork(pane);
  if (bg === null) return { exempt: false, note: "" };
  const age = now - bg.sinceMs;
  return age < ms(cfg.backgroundCapMins) ? { exempt: true } : { exempt: false, note: `; background ${bg.task} for ${minutes(age)}m` };
}
```

`openReportAges` takes `cfg` and returns the note (update the last sentence of its doc comment to: "A pane waiting on a background shell, monitor or subagent counts as working too (RT-355), until that work outlives backgroundCapMins (RT-359)."):

```ts
function openReportAges(job: HerdJobRow, s: WatchdogSensors, cfg: WatchdogConfig, now: number): { reportMs: number; quietMs: number; background: string } | null {
  if (job.status !== "done" || job.lastReport === null || job.pane === null) return null;
  const state = s.paneState(job.pane);
  if (state === "gone" || state === "working") return null;
  const bg = background(job.pane, s, cfg, now);
  if (bg.exempt) return null;
  const idleSince = s.idleSinceMs(job.pane);
  const lastActivity = idleSince !== null && idleSince > job.updatedAt ? idleSince : job.updatedAt;
  return { reportMs: now - job.updatedAt, quietMs: now - lastActivity, background: bg.note };
}
```

`finishedLingering`: call `openReportAges(job, s, cfg, now)`; evidence becomes
`` `${job.name} done with report ${minutes(ages.reportMs)}m ago, quiet ${minutes(ages.quietMs)}m${ages.background}; ${closeRemedy(job)}` ``.

`evaluateJob` tail becomes:

```ts
  if (AWAITING_ANSWER.has(job.status) || idleMs < ms(cfg.backstopMins)) return HEALTHY;
  const bg = background(job.pane, s, cfg, now);
  if (bg.exempt) return HEALTHY;
  return { kind: "wedged", path: "backstop", evidence: `idle ${minutes(idleMs)}m with no open gate${bg.note}` };
```

`evaluateShepherd` second loop: `openReportAges(job, s, cfg, now)`, evidence
`` `${job.name} done with report ${minutes(ages.reportMs)}m ago, quiet ${minutes(ages.quietMs)}m, not yet closed${ages.background}; ${closeRemedy(job)}` ``.

- [ ] **Step 5: Implement the adapter** in `lib/daemon/herd-watchdog-adapters.ts`

Replace `hasBackgroundWork` with:

```ts
export function backgroundTask(screen: string): string | null {
  const lines = screen.split("\n");
  let rule = -1;
  for (let i = 0; i < lines.length; i++) if (RULE_LINE.test(lines[i]!)) rule = i;
  if (rule < 0) return null;
  const footer = lines.slice(rule + 1);
  for (const line of footer) {
    const segment = line.split(" · ").find((part) => FOOTER_TASK_COUNT.test(part));
    if (segment !== undefined) return segment.trim();
  }
  const main = footer.findIndex((line) => AGENTS_PANEL_MAIN.test(line));
  if (main < 0) return null;
  const row = footer.slice(main + 1).find((line) => line.trim().length > 0);
  if (row === undefined) return null;
  return `subagent ${row.split(" · ")[0]!.replace(/^\s*◯\s*/, "").replace(/\s+/g, " ").trim()}`;
}
```

Sensor state: `let busy = new Map<string, { task: string; sinceMs: number }>();`. In `refresh`, `nextBusy` becomes a `Map` of the same type, and the read line becomes:

```ts
        const task = typeof text === "string" ? backgroundTask(text) : null;
        if (task !== null) nextBusy.set(job.pane, { task, sinceMs: busy.get(job.pane)?.sinceMs ?? t });
```

(`t` is the `now()` already taken earlier in `refresh`.) The returned sensor: `backgroundWork: (pane) => busy.get(pane) ?? null,`.

`CONFIG_DEFAULTS` gains `backgroundCapMins: 60,`; `readWatchdogConfig`'s return gains `backgroundCapMins: CONFIG_DEFAULTS.backgroundCapMins,`.

- [ ] **Step 6: Run to verify pass**

Run: `bun test lib/daemon/__tests__/herd-watchdog.test.ts lib/daemon/__tests__/herd-watchdog-adapters.test.ts && bunx tsc --noEmit`
Expected: PASS; tsc clean. `rg -n hasBackgroundWork lib e2e` finds nothing.

- [ ] **Step 7: Commit**

```bash
git add lib/daemon/herd-watchdog.ts lib/daemon/herd-watchdog-adapters.ts lib/daemon/__tests__/herd-watchdog.test.ts lib/daemon/__tests__/herd-watchdog-adapters.test.ts
git commit -m "herd watchdog: background work exempts for 60m, then the nag and backstop name it (RT-359)"
```

### Task 5: Whole-branch verification

- [ ] `bun run test` (repo root): PASS.
- [ ] `bun test --preload ./e2e/setup.ts e2e/tests/herd.test.ts e2e/tests/herd-watchdog.test.ts`: PASS.
- [ ] `bunx tsc --noEmit`: clean.
- [ ] `bash scripts/repo-purity.sh`: clean.
- [ ] `env -i HOME="$(mktemp -d)" PATH="$PATH" bun cli.ts skills check --strict`: current.
- [ ] `bun test lib/__tests__/no-board-skills-drift.test.ts`: PASS.
