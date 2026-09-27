# Prompts Out Of Argv Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No agent rt launches (herd worker, `rt agent start/resume`, rebase escalation, `rt skills audit`) carries its prompt text in any process's argv.

**Architecture:** Interactive (herdr) launches write the prompt to an owner-only file and pass a one-line pointer prompt; headless launches (`claude -p`, `codex exec`) receive the prompt on stdin. The conversion happens at the one launch seam, `launch()` in `lib/daemon/handlers/agent.ts`; the argv builders stop emitting headless prompts.

**Tech Stack:** Bun, TypeScript, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-09-27-prompts-out-of-argv-design.md`

## Global Constraints

- rt is a PUBLIC repo: no employer names anywhere.
- No em dashes or en dashes in code, comments, tests, docs or commit messages.
- Comments state only constraints the code cannot show; no narration, no review or task references.
- Prompt files: directory mode 0700, file mode 0600, enforced even when the path already exists.
- Run `bun test` only from the repo root (bunfig preload isolates HOME). Never `pkill`/`killall` by pattern; stop only processes you started, by PID.
- Commit after each task; end each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Write only under `lib/`, `commands/`, `packages/rt-client/`, their tests, and `docs/`.

## Review Focus

1. A pre-existing prompt dir or file with loose permissions (0755/0644, left by an older rt) must be tightened, not left as is. Pinned in Task 1.
2. A resume that passes a new prompt must go through the pointer too, and a resume with no prompt must emit no pointer. Pinned in Task 4.
3. The cswap account wrapper: `cswap run <acct> -- ...` must carry only the pointer, never the prompt. Pinned in Task 4's real-process test.
4. A prompt containing quotes, newlines or a leading `-` must round-trip into the file byte for byte. Pinned in Task 1.
5. codex headless resume only reads stdin when the prompt positional is `-`; omitting it reads nothing. Pinned in Task 2.

---

### Task 1: Owner-only prompt file helper

**Files:**
- Create: `lib/agent-argv/prompt-file.ts`
- Modify: `lib/agent-argv/index.ts` (re-export)
- Test: `lib/__tests__/prompt-file.test.ts`

**Interfaces:**
- Produces: `writePromptFile(dir: string, name: string, text: string): string` (returns `join(dir, name)`), `pointerPrompt(path: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pointerPrompt, writePromptFile } from "../agent-argv/index.ts";

let root: string;
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), "rt-prompt-file-"))); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const mode = (p: string) => statSync(p).mode & 0o777;

describe("writePromptFile", () => {
  test("creates the dir 0700 and the file 0600 and returns the file path", () => {
    const dir = join(root, "prompts");
    const path = writePromptFile(dir, "a.md", "body");
    expect(path).toBe(join(dir, "a.md"));
    expect(mode(dir)).toBe(0o700);
    expect(mode(path)).toBe(0o600);
    expect(readFileSync(path, "utf8")).toBe("body");
  });

  test("tightens a pre-existing loose dir and file and overwrites the body", () => {
    const dir = join(root, "prompts");
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755);
    writeFileSync(join(dir, "a.md"), "old", { mode: 0o644 });
    chmodSync(join(dir, "a.md"), 0o644);
    const path = writePromptFile(dir, "a.md", "new");
    expect(mode(dir)).toBe(0o700);
    expect(mode(path)).toBe(0o600);
    expect(readFileSync(path, "utf8")).toBe("new");
  });

  test("round-trips quotes, newlines and a leading dash byte for byte", () => {
    const text = "-p it's \"quoted\"\nline two\n\ttab $HOME `x`";
    const path = writePromptFile(join(root, "p"), "q.md", text);
    expect(readFileSync(path, "utf8")).toBe(text);
  });
});

describe("pointerPrompt", () => {
  test("names the path and nothing of the prompt", () => {
    expect(pointerPrompt("/x/y.md")).toBe("Your instructions for this session are in /x/y.md. Read that whole file now and follow it as your task.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/__tests__/prompt-file.test.ts`
Expected: FAIL, `writePromptFile` is not exported.

- [ ] **Step 3: Write minimal implementation**

`lib/agent-argv/prompt-file.ts`:

```ts
/**
 * lib/agent-argv/prompt-file.ts ... an agent's prompt lives in an owner-only
 * file, never in argv, where any `pkill -f` pattern it mentions would match
 * the agent's own process.
 */

import { chmodSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

export function writePromptFile(dir: string, name: string, text: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdir and writeFile modes apply only on creation (and are umask-masked).
  chmodSync(dir, 0o700);
  const path = join(dir, name);
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

export function pointerPrompt(path: string): string {
  return `Your instructions for this session are in ${path}. Read that whole file now and follow it as your task.`;
}
```

`lib/agent-argv/index.ts`: add `export * from "./prompt-file.ts";` beside the other re-exports.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/__tests__/prompt-file.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/agent-argv/prompt-file.ts lib/agent-argv/index.ts lib/__tests__/prompt-file.test.ts
git commit -m "agent-argv: add owner-only prompt file helper and pointer prompt"
```

---

### Task 2: Headless builders never put the prompt in argv

**Files:**
- Modify: `lib/agent-argv/claude.ts` (`claudeArgs`, header comment)
- Modify: `lib/agent-argv/codex.ts` (`buildCodexArgv`)
- Test: `lib/__tests__/agent-argv.test.ts`, `lib/__tests__/agent-argv-codex.test.ts`, `commands/__tests__/skills-audit.test.ts`

**Interfaces:**
- Produces: `buildClaudeArgv(inv)` with `inv.headless` emits no prompt token (claude `-p` reads stdin). `buildCodexArgv(inv)` with `inv.headless` emits `-` as the prompt positional (codex reads stdin for `-`, and `exec resume` reads stdin ONLY for `-`). Both still throw when a headless invocation has no prompt. Interactive (`headless: false`) argv and both pane-command builders are unchanged.

- [ ] **Step 1: Update the tests to the new contract (they fail against current code)**

In `lib/__tests__/agent-argv.test.ts`:
- "all knobs, headless start with prompt": drop the trailing `"do it"` from the expected array (it ends at `"--permission-mode", "plan"`), and add `expect(argv).not.toContain("do it")` by first assigning the result to `const argv`.
- "resume never emits --session-id": expected becomes `["/abs/claude", "-p", "--output-format", "json", "--resume", UUID]`.
- Add:

```ts
  test("headless never carries the prompt in argv; the caller feeds it on stdin", () => {
    const argv = buildClaudeArgv({ session: { kind: "start", sessionId: UUID }, headless: true, prompt: "pkill -f 'bun run test'" }, bins);
    expect(argv.some((a) => a.includes("bun run test"))).toBe(false);
  });

  test("interactive still carries its (pointer) prompt as the last token", () => {
    const argv = buildClaudeArgv({ session: { kind: "start", sessionId: UUID }, headless: false, prompt: "read /x.md" }, bins);
    expect(argv.at(-1)).toBe("read /x.md");
  });
```

In `lib/__tests__/agent-argv-codex.test.ts`:
- "headless start": expected `["/abs/codex", "exec", "--json", "-"]`.
- "all knobs, headless start": last element `"-"` instead of `"do it"`.
- "headless resume": expected `["/abs/codex", "exec", "resume", "--json", "-m", "gpt-6-astra", UUID, "-"]`.
- Add:

```ts
  test("headless never carries the prompt text; `-` tells codex to read stdin", () => {
    const argv = buildCodexArgv({ session: { kind: "resume", sessionId: UUID }, headless: true, prompt: "secret brief" }, bins);
    expect(argv.at(-1)).toBe("-");
    expect(argv).not.toContain("secret brief");
  });
```

In `commands/__tests__/skills-audit.test.ts`:
- "is a headless claude run ...": replace `expect(argv.at(-1)).toBe("PROMPT");` with `expect(argv).not.toContain("PROMPT");`.
- "every lockdown flag is one ... token": replace `expect(argv.slice(start + LOCKDOWN.length)).toEqual(["PROMPT"]);` with `expect(argv.slice(start + LOCKDOWN.length)).toEqual([]);`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test lib/__tests__/agent-argv.test.ts lib/__tests__/agent-argv-codex.test.ts commands/__tests__/skills-audit.test.ts`
Expected: FAIL on the changed expectations (prompt still present).

- [ ] **Step 3: Implement**

`lib/agent-argv/claude.ts`, in `claudeArgs`, replace `if (inv.prompt) args.push(inv.prompt);` with:

```ts
  // A headless prompt is the caller's stdin: `claude -p` reads it there.
  if (inv.prompt && !inv.headless) args.push(inv.prompt);
```

and in the file header comment replace the sentence "Headless without a prompt blocks on stdin, so it is refused at build time." with "A headless prompt never enters argv: the caller feeds it on stdin, and a headless invocation without one is refused at build time."

`lib/agent-argv/codex.ts`, in `buildCodexArgv`, replace `if (inv.prompt) args.push(inv.prompt);` with (the headless-without-prompt throw above it stays; a non-headless call keeps its prompt unchanged):

```ts
  // `-` is the only form `codex exec resume` reads stdin for; the caller feeds the prompt there.
  if (inv.headless) args.push("-");
  else if (inv.prompt) args.push(inv.prompt);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/__tests__/agent-argv.test.ts lib/__tests__/agent-argv-codex.test.ts commands/__tests__/skills-audit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/agent-argv/claude.ts lib/agent-argv/codex.ts lib/__tests__/agent-argv.test.ts lib/__tests__/agent-argv-codex.test.ts commands/__tests__/skills-audit.test.ts
git commit -m "agent-argv: headless builders leave the prompt to stdin"
```

---

### Task 3: `runCapture` stdin and `rt skills audit` feeds its prompt there

**Files:**
- Modify: `lib/subprocess.ts` (`runCapture` opts + spawn)
- Modify: `commands/skills-audit.ts`
- Test: `lib/__tests__/subprocess.test.ts`, `commands/__tests__/skills-audit.test.ts`

**Interfaces:**
- Consumes: Task 2's headless `buildClaudeArgv`.
- Produces: `runCapture(argv, { stdin?: string, ... })`: when set, the child's stdin is that text (then EOF); otherwise `"ignore"` as today. `buildAuditRun(prompt: string, sessionId: string, claude: string, packDir: string): { argv: [string, ...string[]]; opts: { cwd: string; timeoutMs: number; stderr: "pipe"; stdin: string } }` exported from `commands/skills-audit.ts`.

- [ ] **Step 1: Write the failing tests**

`lib/__tests__/subprocess.test.ts`, new describe:

```ts
describe("runCapture stdin", () => {
  test("feeds the given text on the child's stdin", async () => {
    const r = await runCapture(["cat"], { stdin: "hello\nworld" });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("hello\nworld");
  });

  test("without stdin the child reads EOF immediately", async () => {
    const r = await runCapture(["cat"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
  });
});
```

`commands/__tests__/skills-audit.test.ts` (add `buildAuditRun` to the import from `../skills-audit.ts`):

```ts
  test("the audit run carries its prompt on stdin, never in argv", () => {
    const run = buildAuditRun("PROMPT TEXT", SESSION, "/bin/claude", "/pack");
    expect(run.argv.some((a) => a.includes("PROMPT TEXT"))).toBe(false);
    expect(run.opts).toMatchObject({ cwd: "/pack", stderr: "pipe", stdin: "PROMPT TEXT" });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test lib/__tests__/subprocess.test.ts commands/__tests__/skills-audit.test.ts`
Expected: FAIL (`stdin` ignored, so `cat` prints nothing; `buildAuditRun` not exported).

- [ ] **Step 3: Implement**

`lib/subprocess.ts`: add `stdin?: string;` to the `runCapture` opts type, a doc line in the function comment ("`opts.stdin` is written to the child's stdin, then EOF; otherwise stdin is closed."), and in `Bun.spawn` replace `stdin: "ignore",` with:

```ts
      stdin: opts.stdin !== undefined ? new Blob([opts.stdin]) : "ignore",
```

`commands/skills-audit.ts`: add

```ts
export function buildAuditRun(prompt: string, sessionId: string, claude: string, packDir: string) {
  const argv = buildClaudeArgv(buildAuditInvocation(prompt, sessionId), { claude }) as [string, ...string[]];
  return { argv, opts: { cwd: packDir, timeoutMs: AUDIT_TIMEOUT_MS, stderr: "pipe" as const, stdin: prompt } };
}
```

and in `skillsAudit` replace the `argv`/`runCapture` lines with:

```ts
  const run = buildAuditRun(prompt, randomUUID(), claude, resolved.packDir);
  const r = await runCapture(run.argv, run.opts);
```

Update the comment above `buildAuditPrompt`: "the prompt is one argv token, so inlining file text would hit ARG_MAX" becomes "the prompt is fed on stdin, but inlining tens of thousands of lines would still swamp the run's context".

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/__tests__/subprocess.test.ts commands/__tests__/skills-audit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/subprocess.ts lib/__tests__/subprocess.test.ts commands/skills-audit.ts commands/__tests__/skills-audit.test.ts
git commit -m "skills audit: feed the audit prompt on stdin via runCapture"
```

---

### Task 4: The agent launch seam: pointer for herdr, stdin for headless

**Files:**
- Modify: `lib/daemon/handlers/agent.ts` (`HeadlessChild` spawn signature, `defaultSpawnHeadless`, `launch()`, a new `agentPromptDir()` beside `agentResultPath`)
- Test: `lib/daemon/__tests__/agent-handlers.test.ts`

**Interfaces:**
- Consumes: `writePromptFile`, `pointerPrompt` (Task 1); headless builders (Task 2).
- Produces: `spawnHeadless(argv, cwd, env, opts?: { captureSessionId?: boolean; stdin?: string })`. herdr launches with a prompt put `pointerPrompt(join(rtDir(), "agent-prompts", "<rec.id>.md"))` in the pane command; headless launches pass `opts.stdin = prompt`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/daemon/__tests__/agent-handlers.test.ts` (extend the `fs` import with `statSync`, `mkdtempSync`, `writeFileSync`, `chmodSync`; import `pointerPrompt` from `../../agent-argv/index.ts`; widen `fresh`'s `spawn` type to accept a 4th `opts?: { captureSessionId?: boolean; stdin?: string }` argument):

```ts
const BRIEF = "# job\nrun `bun run test` then pkill nothing\nit's \"quoted\"";

test("agent:start herdr puts only a pointer in the pane command; the prompt sits in an 0600 file", async () => {
  const calls: string[][] = [];
  const h = fresh({ runner: okRunner(calls) });
  const res = await h["agent:start"]({ repo: REPO, cwd: "/tmp/x", prompt: BRIEF, surface: "herdr" });
  if (!res.ok) throw new Error(res.error);
  const cmd = calls.find((c) => c[0] === "pane" && c[1] === "run")![3]!;
  const file = join(rtDir(), "agent-prompts", `${res.data.id}.md`);
  expect(cmd).not.toContain("bun run test");
  expect(cmd).toContain(pointerPrompt(file));
  expect(readFileSync(file, "utf8")).toBe(BRIEF);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(statSync(join(rtDir(), "agent-prompts")).mode & 0o777).toBe(0o700);
});

test("agent:start herdr with no prompt emits no pointer", async () => {
  const calls: string[][] = [];
  const h = fresh({ runner: okRunner(calls) });
  const res = await h["agent:start"]({ repo: REPO, cwd: "/tmp/x", surface: "herdr" });
  if (!res.ok) throw new Error(res.error);
  expect(calls.find((c) => c[0] === "pane" && c[1] === "run")![3]).not.toContain("Your instructions");
});

test("agent:resume with a new prompt goes through the pointer; without one it emits none", async () => {
  const calls: string[][] = [];
  const h = fresh({ runner: okRunner(calls) });
  const started = await h["agent:start"]({ repo: REPO, cwd: "/tmp/x", prompt: "first", surface: "herdr", label: "R" });
  if (!started.ok) throw new Error(started.error);
  const file = join(rtDir(), "agent-prompts", `${started.data.id}.md`);
  calls.length = 0;
  expect((await h["agent:resume"]({ id: started.data.id, prompt: BRIEF })).ok).toBe(true);
  const withPrompt = calls.find((c) => c[0] === "pane" && c[1] === "run")![3]!;
  expect(withPrompt).not.toContain("bun run test");
  expect(withPrompt).toContain(pointerPrompt(file));
  expect(readFileSync(file, "utf8")).toBe(BRIEF);
  calls.length = 0;
  expect((await h["agent:resume"]({ id: started.data.id, tab: "again" })).ok).toBe(true);
  expect(calls.find((c) => c[0] === "pane" && c[1] === "run")![3]).not.toContain("Your instructions");
});

test("agent:start headless feeds the prompt on stdin and keeps it out of argv", async () => {
  let seen: { argv: string[]; stdin?: string } | undefined;
  const h = fresh({ spawn: (argv, _cwd, _env, opts) => { seen = { argv, stdin: opts?.stdin }; return { exited: new Promise(() => {}), stdout: async () => "{}", sessionId: () => Promise.resolve(undefined) }; } });
  const res = await h["agent:start"]({ repo: REPO, cwd: "/tmp/x", surface: "headless", prompt: BRIEF });
  expect(res.ok).toBe(true);
  expect(seen!.argv.some((a) => a.includes("bun run test"))).toBe(false);
  expect(seen!.stdin).toBe(BRIEF);
});

// The real ps view: the built pane command runs through a shell against
// stand-in claude and cswap binaries that record their own `ps -o args`.
test("a launched agent's own ps args carry the pointer and no prompt text, with and without cswap", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-ps-args-")));
  try {
    const bin = join(root, "bin");
    mkdirSync(bin);
    for (const name of ["claude", "cswap"]) {
      writeFileSync(join(bin, name), `#!/bin/sh\nps -ww -o args= -p $$ > "${root}/${name}.args"\n`);
      chmodSync(join(bin, name), 0o755);
    }
    const calls: string[][] = [];
    const h = fresh({ runner: okRunner(calls) });
    for (const account of [undefined, "acct@example.com"]) {
      calls.length = 0;
      const res = await h["agent:start"]({ repo: REPO, cwd: root, prompt: BRIEF, surface: "herdr", ...(account && { account }), tab: `t-${account ?? "plain"}` });
      if (!res.ok) throw new Error(res.error);
      const cmd = calls.find((c) => c[0] === "pane" && c[1] === "run")![3]!;
      const proc = Bun.spawn(["/bin/sh", "-c", cmd], { env: { PATH: `${bin}:/usr/bin:/bin`, HOME: process.env.HOME! }, stdout: "ignore", stderr: "ignore" });
      expect(await proc.exited).toBe(0);
      const args = readFileSync(join(root, `${account ? "cswap" : "claude"}.args`), "utf8");
      expect(args).toContain("Your instructions for this session are in");
      expect(args).not.toContain("bun run test");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

(Add `mkdirSync` to the `fs` import too.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test lib/daemon/__tests__/agent-handlers.test.ts`
Expected: the five new tests FAIL (brief text in the pane command; no prompt file; headless stdin undefined). Every existing test still passes.

- [ ] **Step 3: Implement**

In `lib/daemon/handlers/agent.ts`:

1. Import `pointerPrompt, writePromptFile` from `../../agent-argv/index.ts` (extend the existing import from that module).
2. Beside `agentResultPath`:

```ts
/** Owner-only: a prompt in argv is matched by any `pkill -f` pattern it quotes. */
function agentPromptDir(): string {
  return join(rtDir(), "agent-prompts");
}
```

3. Widen the spawn option type everywhere it is declared (the `spawnHeadless` field on the handler opts and `defaultSpawnHeadless`) to `opts: { captureSessionId?: boolean; stdin?: string } = {}`, and in `defaultSpawnHeadless` replace `stdin: "ignore",` with `stdin: opts.stdin !== undefined ? new Blob([opts.stdin]) : "ignore",`.
4. In `launch()`, replace `...(prompt !== undefined && { prompt }),` in the `inv` literal with:

```ts
      ...(prompt !== undefined && {
        prompt: rec.surface === "herdr" ? pointerPrompt(writePromptFile(agentPromptDir(), `${rec.id}.md`, prompt)) : prompt,
      }),
```

5. Replace the headless spawn call with:

```ts
    const child = spawnHeadless(argv, rec.cwd, gateEnv, { captureSessionId: rec.provider === "codex", ...(prompt !== undefined && { stdin: prompt }) });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/daemon/__tests__/agent-handlers.test.ts`
Expected: PASS, all tests including the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/handlers/agent.ts lib/daemon/__tests__/agent-handlers.test.ts
git commit -m "agent: herdr launches point at an owner-only prompt file; headless feeds stdin"
```

---

### Task 5: Herd `job.md` and rebase task files are owner-only

**Files:**
- Modify: `lib/daemon/handlers/herd.ts` (`herd:spawn` brief write)
- Modify: `lib/rebase-escalation.ts` (`writeTaskFile`)
- Test: `lib/daemon/__tests__/herd-handlers.test.ts`, `lib/__tests__/rebase-escalation.test.ts`

**Interfaces:**
- Consumes: `writePromptFile` (Task 1).

- [ ] **Step 1: Write the failing tests**

In `lib/daemon/__tests__/herd-handlers.test.ts`, in the test at line ~960 (the one asserting `job.md` contains "do the thing"), after that assertion add (import `statSync` from `fs` if absent):

```ts
    const jobMd = join(dir, "herds", herd, "job-a", "job.md");
    expect(statSync(jobMd).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "herds", herd, "job-a")).mode & 0o777).toBe(0o700);
```

In `lib/__tests__/rebase-escalation.test.ts`, in "writes under <dataDir>/agent-tasks and returns the path", add (import `statSync`):

```ts
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(dataDir, "agent-tasks")).mode & 0o777).toBe(0o700);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test lib/daemon/__tests__/herd-handlers.test.ts lib/__tests__/rebase-escalation.test.ts`
Expected: FAIL on the mode assertions (0644 / 0755 under the default umask).

- [ ] **Step 3: Implement**

`lib/daemon/handlers/herd.ts`: import `writePromptFile` from `../../agent-argv/index.ts`; replace

```ts
      if (brief) { mkdirSync(dir, { recursive: true }); writeFileSync(briefPath, brief); }
```

with

```ts
      if (brief) writePromptFile(dir, "job.md", brief);
```

Drop `mkdirSync`/`writeFileSync` from the `fs` import only if nothing else in the file uses them (check with `grep -n "mkdirSync\|writeFileSync" lib/daemon/handlers/herd.ts`).

`lib/rebase-escalation.ts`: import `writePromptFile` from `./agent-argv/index.ts` (merge into the existing import from that module); replace the body of `writeTaskFile` with:

```ts
  const ts = new Date().toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "");
  return writePromptFile(join(dataDir, "agent-tasks"), `rebase-${ts}.md`, content);
```

and drop now-unused `fs` imports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/daemon/__tests__/herd-handlers.test.ts lib/__tests__/rebase-escalation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/handlers/herd.ts lib/rebase-escalation.ts lib/daemon/__tests__/herd-handlers.test.ts lib/__tests__/rebase-escalation.test.ts
git commit -m "herd, rebase escalation: write prompt files owner-only"
```

---

### Task 6: Whole-branch verification

No code unless a check fails (then fix under superpowers:systematic-debugging and commit the fix).

- [ ] `bun run test` from the repo root: all pass (compare any failure against clean `main` before calling it pre-existing).
- [ ] `bunx tsc --noEmit`: clean.
- [ ] `bash scripts/repo-purity.sh`: clean.
- [ ] e2e covering herd or pane spawn: `ls e2e/tests e2e/pty | grep -i -e herd -e agent -e pane`; run any match with `bun test --preload ./e2e/setup.ts <file>`.
- [ ] Manual isolated-HOME check (never the real `~/.mattstack`): with `HOME=$(mktemp -d)` run Task 4's real-process test file alone, `HOME=<tmp> bun test lib/daemon/__tests__/agent-handlers.test.ts -t "ps args"`, and additionally run the built pane command by hand with a stand-in `claude` that sleeps 30s, then `ps -o args= -p <that pid>` and confirm only the pointer appears; stop it by that PID.
- [ ] `grep -rn "[—–]" $(git diff --name-only main...HEAD)`: no output.
