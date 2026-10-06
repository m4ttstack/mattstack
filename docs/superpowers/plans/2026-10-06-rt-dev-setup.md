# rt dev setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A collaborator on prod mattstack.app runs `rt dev setup` and ends up on mattstack-dev serving rt and every app from their own clone; `rt dev update` keeps it current; the maintainer's release flow publishes a signed dev app zip; Rebuild without the signing cert refuses with a clear reason.

**Architecture:** Pure orchestration modules under `lib/dev/` drive every external effect through an injected `DevSeams` (Probes for exec/fs/fetch, an `AppSwapSeams` for the app swap). `commands/dev.ts` is a thin shell that builds the real seams, renders one rt-ui step per stage, and prints `--json` envelopes. The app swap is lifted out of `lib/release/update-machine.ts` into `lib/release/app-swap.ts` so `update-machine` and `rt dev update` share it. Publishing is a new `dev-publish` leg of `rt release update-machine`, run on the maintainer's Mac. No Swift changes.

**Tech Stack:** Bun + TypeScript, `bun:test`, the rt output layer (`lib/ui/out.ts`, `openStep`), the setup `Probes` seam, `gh` (bundled), `notarytool` via `scripts/release/notarize.sh`, shell in `rt-tray/build.sh`.

**Spec:** `docs/superpowers/specs/2026-10-06-rt-dev-setup-design.md`

## Global Constraints

- No Swift changes anywhere (`rt-tray/Sources*` untouched).
- The repo is `m4ttstack/mattstack`; the clone goes to `<first rt.repoRoots entry>/mattstack`.
- Tools: git (any), bun at the `packageManager` pin in `package.json` (`bun@1.4.2` today), Go at the `go` line of `ui/go.mod` (`1.26.5` today), node `>= 20` as a warning only. Too old counts as missing for bun and Go.
- Never use the binaries inside an app bundle (any path containing `.app/Contents/`) as the dev toolchain.
- Under `--json` or `RT_BATCH`, or off a terminal, nothing is installed: refuse with the install command as `next`.
- Neither `dev setup` nor `dev update` is `agentSafe`.
- Dev zip asset name: `mattstack-dev-<version>.zip`; its line lives in the release's `SHA256SUMS` as `<sha256>  mattstack-dev-<version>.zip`.
- Info.plist key for a release-built dev app: `MSDevReleaseBuild` (bool true), set by `build.sh dev` when `MS_DEV_RELEASE_BUILD=1`.
- Notary profile name: `NOTARY_PROFILE` env, default `mattstack-notary`.
- Rebuild copy, verbatim: "Rebuilding the dev app needs the maintainers' signing certificate. You only need it for tray changes: your rt, app and skill changes already run from your clone."
- User-facing copy names "the maintainers", never a person.
- All output through `lib/ui/out.ts`; no `console.*` under `commands/` or `lib/` (`lib/__tests__/no-raw-output.test.ts`). Scripts under `scripts/` may use `console`.
- Run every test from the worktree root (`bun test <file>`), never from a subdirectory.
- Only targeted tests locally; the full suite runs in CI.

## Review Focus

1. **No repo root chosen** (prod Mac where `rt.repoRoots` is unset): setup refuses with `rt setup repo-root` as `next` before cloning. Test in Task 5.
2. **The clone folder already holds the user's own mattstack clone on another branch with local edits**: setup reuses it untouched (no checkout, no pull). Test in Task 5.
3. **`bun` on PATH is an app bundle's copy** (`/Applications/mattstack.app/Contents/Helpers/bun` symlinked into a PATH dir): ignored, so the state is `missing` unless a real bun exists. Test in Task 1.
4. **The newest release's `SHA256SUMS` has no dev zip line yet** (upload half done): that release is skipped and the next one with a line is used. Test in Task 4.
5. **No network before the clone**: reading pins from GitHub fails with a plain error before anything on the Mac changes. Test in Task 1 (throws) and Task 5 (no clone attempted).

---

### Task 1: Dev tool table and probing

**Files:**
- Create: `lib/dev/tools.ts`
- Test: `lib/dev/__tests__/tools.test.ts`

**Interfaces:**
- Consumes: `Probes` from `lib/setup/probes.ts`; `fakeProbes` from `lib/setup/__tests__/fakes.ts` (tests); `UserActionableError` from `lib/errors.ts`.
- Produces:
  - `type DevToolName = "git" | "bun" | "go" | "node"`
  - `interface DevPins { bun: string; go: string }`
  - `type DevToolState = "ready" | "missing" | "too-old"`
  - `interface DevToolStatus { name: DevToolName; need: "required" | "warning"; state: DevToolState; found: string | null; version: string | null; wanted: string | null }`
  - `const NODE_FLOOR = "20.0.0"`
  - `function compareVersions(a: string, b: string): number`
  - `function parseBunPin(packageJson: string): string | null`
  - `function parseGoPin(goMod: string): string | null`
  - `function isBundledPath(path: string): boolean`
  - `async function readPins(p: Probes, clone: string | null): Promise<DevPins>` (throws `UserActionableError("dev-pins-unreadable", ...)`)
  - `async function probeDevTools(p: Probes, pins: DevPins): Promise<DevToolStatus[]>`
  - `function installCommandFor(name: DevToolName, wanted: string | null): string`
  - `const PINS_URL_BASE = "https://raw.githubusercontent.com/m4ttstack/mattstack/main"`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/dev/__tests__/tools.test.ts
import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { compareVersions, installCommandFor, isBundledPath, parseBunPin, parseGoPin, probeDevTools, readPins } from "../tools.ts";

const HOME = "/Users/collab";
const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
const missing = { code: 127, stdout: "", stderr: "ENOENT" };

describe("pins", () => {
  test("parseBunPin reads packageManager", () => {
    expect(parseBunPin(JSON.stringify({ packageManager: "bun@1.4.2" }))).toBe("1.4.2");
    expect(parseBunPin(JSON.stringify({ packageManager: "pnpm@9.0.0" }))).toBeNull();
    expect(parseBunPin("not json")).toBeNull();
  });
  test("parseGoPin reads the go line", () => {
    expect(parseGoPin("module rt-ui\n\ngo 1.26.5\n\nrequire (\n")).toBe("1.26.5");
    expect(parseGoPin("module rt-ui\n")).toBeNull();
  });
  test("readPins prefers the clone's files", async () => {
    const p = fakeProbes({ files: { "/c/package.json": JSON.stringify({ packageManager: "bun@1.5.0" }), "/c/ui/go.mod": "go 1.27.0\n" } });
    expect(await readPins(p, "/c")).toEqual({ bun: "1.5.0", go: "1.27.0" });
    expect(p.calls.fetch).toEqual([]);
  });
  test("readPins fetches main from GitHub before a clone exists", async () => {
    const p = fakeProbes({
      fetch: async (url) =>
        url.endsWith("/package.json")
          ? { status: 200, body: JSON.stringify({ packageManager: "bun@1.4.2" }), headers: {} }
          : { status: 200, body: "go 1.26.5\n", headers: {} },
    });
    expect(await readPins(p, null)).toEqual({ bun: "1.4.2", go: "1.26.5" });
  });
  test("readPins with no network throws a plain error", async () => {
    const p = fakeProbes({ fetch: async () => ({ status: 0, body: "", headers: {} }) });
    await expect(readPins(p, null)).rejects.toMatchObject({ code: "dev-pins-unreadable" });
  });
});

describe("compareVersions", () => {
  test("numeric, not lexical", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.4.2", "1.4.2")).toBe(0);
    expect(compareVersions("1.4", "1.4.1")).toBeLessThan(0);
  });
});

describe("isBundledPath", () => {
  test("any path inside an app bundle", () => {
    expect(isBundledPath("/Applications/mattstack.app/Contents/Helpers/bun")).toBe(true);
    expect(isBundledPath(`${HOME}/.bun/bin/bun`)).toBe(false);
  });
});

describe("probeDevTools", () => {
  const pins = { bun: "1.4.2", go: "1.26.5" };
  function probes(execs: Record<string, ReturnType<typeof ok> | typeof missing>, files: Record<string, string>, links: Record<string, string> = {}) {
    return fakeProbes({
      home: HOME,
      env: { PATH: "/usr/local/bin:/usr/bin" },
      files,
      links,
      exec: (argv) => execs[argv[0]!] ?? missing,
    });
  }

  test("all ready", async () => {
    const p = probes(
      {
        "/usr/bin/git": ok("git version 2.50.1"),
        [`${HOME}/.bun/bin/bun`]: ok("1.4.2\n"),
        "/opt/homebrew/bin/go": ok("go version go1.26.5 darwin/arm64"),
        "/opt/homebrew/bin/node": ok("v22.3.0"),
      },
      { "/usr/bin/git": "", [`${HOME}/.bun/bin/bun`]: "", "/opt/homebrew/bin/go": "", "/opt/homebrew/bin/node": "" },
    );
    const s = await probeDevTools(p, pins);
    expect(s.map((t) => [t.name, t.state])).toEqual([["git", "ready"], ["bun", "ready"], ["go", "ready"], ["node", "ready"]]);
    expect(s.find((t) => t.name === "bun")!.found).toBe(`${HOME}/.bun/bin/bun`);
  });

  test("old bun is too-old, missing go is missing, node is a warning", async () => {
    const p = probes({ "/usr/bin/git": ok("git version 2.50.1"), [`${HOME}/.bun/bin/bun`]: ok("1.3.9") }, { "/usr/bin/git": "", [`${HOME}/.bun/bin/bun`]: "" });
    const s = await probeDevTools(p, pins);
    expect(s.find((t) => t.name === "bun")).toMatchObject({ state: "too-old", version: "1.3.9", wanted: "1.4.2" });
    expect(s.find((t) => t.name === "go")).toMatchObject({ state: "missing", need: "required" });
    expect(s.find((t) => t.name === "node")).toMatchObject({ state: "missing", need: "warning" });
  });

  test("a bun on PATH that is an app bundle's copy is ignored (Review Focus 3)", async () => {
    const p = probes(
      { "/usr/bin/git": ok("git version 2.50.1"), "/usr/local/bin/bun": ok("1.4.2") },
      { "/usr/bin/git": "", "/Applications/mattstack.app/Contents/Helpers/bun": "" },
      { "/usr/local/bin/bun": "/Applications/mattstack.app/Contents/Helpers/bun" },
    );
    const s = await probeDevTools(p, pins);
    expect(s.find((t) => t.name === "bun")!.state).toBe("missing");
  });
});

describe("installCommandFor", () => {
  test("names the exact command a person runs", () => {
    expect(installCommandFor("bun", "1.4.2")).toBe("curl -fsSL https://bun.sh/install | bash -s bun-v1.4.2");
    expect(installCommandFor("go", "1.26.5")).toBe("brew install go");
    expect(installCommandFor("node", null)).toBe("brew install node");
    expect(installCommandFor("git", null)).toBe("xcode-select --install");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/dev/__tests__/tools.test.ts`
Expected: FAIL, cannot resolve `../tools.ts`.

- [ ] **Step 3: Implement `lib/dev/tools.ts`**

```ts
import { join } from "path";
import { UserActionableError } from "../errors.ts";
import type { Probes } from "../setup/probes.ts";

export type DevToolName = "git" | "bun" | "go" | "node";
export interface DevPins { bun: string; go: string }
export type DevToolState = "ready" | "missing" | "too-old";
export interface DevToolStatus {
  name: DevToolName;
  need: "required" | "warning";
  state: DevToolState;
  found: string | null;
  version: string | null;
  wanted: string | null;
}

export const NODE_FLOOR = "20.0.0";
export const PINS_URL_BASE = "https://raw.githubusercontent.com/m4ttstack/mattstack/main";

interface Spec {
  name: DevToolName;
  need: "required" | "warning";
  versionArgs: string[];
  parse(out: string): string | null;
  fallbackDirs(home: string): string[];
}

const SPECS: readonly Spec[] = [
  { name: "git", need: "required", versionArgs: ["--version"], parse: (o) => o.match(/git version (\d+(?:\.\d+)*)/)?.[1] ?? null, fallbackDirs: () => ["/usr/bin"] },
  { name: "bun", need: "required", versionArgs: ["--version"], parse: (o) => o.trim().match(/^(\d+\.\d+\.\d+)/)?.[1] ?? null, fallbackDirs: (h) => [join(h, ".bun", "bin"), "/opt/homebrew/bin"] },
  { name: "go", need: "required", versionArgs: ["version"], parse: (o) => o.match(/go(\d+\.\d+(?:\.\d+)?)/)?.[1] ?? null, fallbackDirs: () => ["/opt/homebrew/bin", "/usr/local/go/bin", "/usr/local/bin"] },
  { name: "node", need: "warning", versionArgs: ["--version"], parse: (o) => o.trim().match(/^v?(\d+\.\d+\.\d+)/)?.[1] ?? null, fallbackDirs: () => ["/opt/homebrew/bin", "/usr/local/bin"] },
];

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function parseBunPin(packageJson: string): string | null {
  try {
    const pm = (JSON.parse(packageJson) as { packageManager?: unknown }).packageManager;
    return typeof pm === "string" ? (pm.match(/^bun@(\d+\.\d+\.\d+)$/)?.[1] ?? null) : null;
  } catch {
    return null;
  }
}

export function parseGoPin(goMod: string): string | null {
  return goMod.match(/^go (\d+\.\d+(?:\.\d+)?)\s*$/m)?.[1] ?? null;
}

export function isBundledPath(path: string): boolean {
  return path.includes(".app/Contents/");
}

export async function readPins(p: Probes, clone: string | null): Promise<DevPins> {
  let pkg: string | null;
  let goMod: string | null;
  if (clone) {
    pkg = p.readFile(join(clone, "package.json"));
    goMod = p.readFile(join(clone, "ui", "go.mod"));
  } else {
    const [a, b] = await Promise.all([p.fetch(`${PINS_URL_BASE}/package.json`), p.fetch(`${PINS_URL_BASE}/ui/go.mod`)]);
    pkg = a.status === 200 ? a.body : null;
    goMod = b.status === 200 ? b.body : null;
  }
  const bun = pkg ? parseBunPin(pkg) : null;
  const go = goMod ? parseGoPin(goMod) : null;
  if (!bun || !go) {
    throw new UserActionableError("dev-pins-unreadable", "rt could not read which bun and Go versions mattstack needs", {}, {
      why: clone ? "The clone's package.json or ui/go.mod is missing a version." : "GitHub did not answer. Check your internet connection.",
    });
  }
  return { bun, go };
}

/** Real symlink target, so a link into an app bundle is recognised. */
function realTarget(p: Probes, path: string): string {
  let cur = path;
  for (let i = 0; i < 10; i++) {
    const next = p.readlink(cur);
    if (!next) return cur;
    cur = next.startsWith("/") ? next : join(cur, "..", next);
  }
  return cur;
}

function candidates(p: Probes, spec: Spec): string[] {
  const pathDirs = (p.env.PATH ?? "").split(":").filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of [...pathDirs, ...spec.fallbackDirs(p.home)]) {
    const path = join(dir, spec.name);
    if (seen.has(path)) continue;
    seen.add(path);
    if (!p.exists(path) && !p.readlink(path)) continue;
    if (isBundledPath(path) || isBundledPath(realTarget(p, path))) continue;
    out.push(path);
  }
  return out;
}

function wantedFor(name: DevToolName, pins: DevPins): string | null {
  if (name === "bun") return pins.bun;
  if (name === "go") return pins.go;
  if (name === "node") return NODE_FLOOR;
  return null;
}

export async function probeDevTools(p: Probes, pins: DevPins): Promise<DevToolStatus[]> {
  const result: DevToolStatus[] = [];
  for (const spec of SPECS) {
    const wanted = wantedFor(spec.name, pins);
    let status: DevToolStatus = { name: spec.name, need: spec.need, state: "missing", found: null, version: null, wanted };
    for (const path of candidates(p, spec)) {
      const r = await p.exec([path, ...spec.versionArgs], { timeoutMs: 5000 });
      const version = r.code === 0 ? spec.parse(r.stdout) : null;
      if (!version) continue;
      const state: DevToolState = wanted && compareVersions(version, wanted) < 0 ? "too-old" : "ready";
      status = { ...status, state, found: path, version };
      break;
    }
    result.push(status);
  }
  return result;
}

export function installCommandFor(name: DevToolName, wanted: string | null): string {
  switch (name) {
    case "bun":
      return `curl -fsSL https://bun.sh/install | bash -s bun-v${wanted}`;
    case "go":
      return "brew install go";
    case "node":
      return "brew install node";
    case "git":
      return "xcode-select --install";
  }
}
```

If `fakeProbes` reports a linked path through `exists` already, the `p.readlink(path)` clause in `candidates` is harmless; keep it so a dangling link into a removed bundle is still skipped.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test lib/dev/__tests__/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dev/tools.ts lib/dev/__tests__/tools.test.ts
git commit -m "feat(dev): tool table, pins and probing for rt dev setup"
```

---

### Task 2: Pinned installs for dev tools

**Files:**
- Modify: `lib/setup/tools-install.ts` (`VENDOR_ALLOWED_HOSTS`, `runInstallerAndVerify`, `runVendorInstaller`, new `installDevTool`)
- Test: `lib/setup/__tests__/tools-install-dev.test.ts`

**Interfaces:**
- Consumes: `Probes`, `InstallResult`, `UserActionableError`.
- Produces:
  - `const BUN_INSTALLER_URL = "https://bun.sh/install"`
  - `async function installDevTool(p: Probes, tool: "bun" | "go" | "node", version: string): Promise<InstallResult>`
  - `installTool` is unchanged in behavior (bun is NOT added to `VENDOR_INSTALLERS`, so `rt tools install bun` keeps linking the bundled copy).

- [ ] **Step 1: Write the failing tests**

```ts
// lib/setup/__tests__/tools-install-dev.test.ts
import { describe, expect, test } from "bun:test";
import { fakeProbes } from "./fakes.ts";
import { installDevTool } from "../tools-install.ts";

const HOME = "/Users/collab";

describe("installDevTool", () => {
  test("bun runs the official installer pinned to the version, then verifies ~/.bun/bin/bun", async () => {
    const p = fakeProbes({
      home: HOME,
      env: { TMPDIR: "/tmp" },
      exec: (argv) => ({ code: 0, stdout: argv.at(-1) === "--version" ? "1.4.2" : "", stderr: "" }),
    });
    const r = await installDevTool(p, "bun", "1.4.2");
    expect(r.ok).toBe(true);
    expect(p.calls.exec).toContainEqual(["curl", "-fsSL", "https://bun.sh/install", "-o", "/tmp/rt-vendor-install/bun.sh"]);
    expect(p.calls.exec).toContainEqual(["sh", "/tmp/rt-vendor-install/bun.sh", "bun-v1.4.2"]);
    expect(p.calls.exec).toContainEqual([`${HOME}/.bun/bin/bun`, "--version"]);
  });

  test("go installs with brew and verifies with `go version` at brew's prefix", async () => {
    const p = fakeProbes({
      exec: (argv) => {
        if (argv[0] === "brew" && argv[1] === "--prefix") return { code: 0, stdout: "/opt/homebrew\n", stderr: "" };
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    const r = await installDevTool(p, "go", "1.26.5");
    expect(r.ok).toBe(true);
    expect(p.calls.exec).toContainEqual(["brew", "install", "go"]);
    expect(p.calls.exec).toContainEqual(["/opt/homebrew/bin/go", "version"]);
  });

  test("no Homebrew is a plain error pointing at the download page", async () => {
    const p = fakeProbes({ exec: (argv) => (argv[0] === "brew" ? { code: 127, stdout: "", stderr: "ENOENT" } : { code: 0, stdout: "", stderr: "" }) });
    await expect(installDevTool(p, "node", "20.0.0")).rejects.toMatchObject({ code: "dev-tool-no-brew", next: "open https://nodejs.org/en/download" });
  });

  test("a failed installer is ok:false with the reason", async () => {
    const p = fakeProbes({ env: { TMPDIR: "/tmp" }, exec: (argv) => (argv[0] === "sh" ? { code: 1, stdout: "", stderr: "unsupported" } : { code: 0, stdout: "", stderr: "" }) });
    const r = await installDevTool(p, "bun", "1.4.2");
    expect(r).toMatchObject({ ok: false, via: "vendor" });
    expect(r.detail).toContain("unsupported");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/setup/__tests__/tools-install-dev.test.ts`
Expected: FAIL, `installDevTool` is not exported.

- [ ] **Step 3: Implement**

In `lib/setup/tools-install.ts`:

1. Add `"bun.sh"` to `VENDOR_ALLOWED_HOSTS`:

```ts
const VENDOR_ALLOWED_HOSTS = new Set(["herdr.dev", "claude.ai", "bun.sh"]);
```

2. Give `runInstallerAndVerify` a verify argv, defaulting to today's behavior:

```ts
async function runInstallerAndVerify(
  p: Probes,
  tool: string,
  via: "brew" | "vendor",
  argv: string[],
  label: string,
  successDetail: string,
  verifyArgv: string[] = [tool, "--version"],
): Promise<InstallResult> {
  const res = await p.exec(argv, { timeoutMs: INSTALL_TIMEOUT_MS });
  if (res.code === 124) return { via, ok: false, detail: `${label} did not finish in time` };
  if (res.code !== 0) return { via, ok: false, detail: `${label} failed (exit ${res.code}): ${firstLine(res.stderr || res.stdout)}` };

  const verify = await p.exec(verifyArgv, { timeoutMs: PROBE_TIMEOUT_MS });
  if (verify.code !== 0) {
    return { via, ok: false, detail: `${label} finished, but ${tool} still does not run (exit ${verify.code})` };
  }
  return { via, ok: true, detail: successDetail };
}
```

3. Give `runVendorInstaller` rt-owned args and verify argv (callers that pass nothing behave as before):

```ts
async function runVendorInstaller(p: Probes, tool: string, url: string, opts: { args?: string[]; verify?: string[] } = {}): Promise<InstallResult> {
  // ...validation and download unchanged...
  return runInstallerAndVerify(p, tool, "vendor", ["sh", path, ...(opts.args ?? [])], "install script", "installed via vendor script", opts.verify);
}
```

4. Add `installDevTool` after `installTool`:

```ts
/**
 * The dev toolchain `rt dev setup` needs, installed for real rather than
 * linked from the app bundle: a dev checkout must keep working when the app
 * that shipped a binary is retired or updated. The version and arguments are
 * rt's own, never caller text.
 */
export const BUN_INSTALLER_URL = "https://bun.sh/install";
const DEV_TOOL_DOWNLOAD: Record<"go" | "node", string> = { go: "https://go.dev/dl/", node: "https://nodejs.org/en/download" };

export async function installDevTool(p: Probes, tool: "bun" | "go" | "node", version: string): Promise<InstallResult> {
  if (tool === "bun") {
    return runVendorInstaller(p, "bun", BUN_INSTALLER_URL, { args: [`bun-v${version}`], verify: [join(p.home, ".bun", "bin", "bun"), "--version"] });
  }
  const brew = await p.exec(["brew", "--version"], { timeoutMs: PROBE_TIMEOUT_MS });
  if (brew.code !== 0) {
    throw new UserActionableError("dev-tool-no-brew", `${tool} needs installing, and this Mac has no Homebrew`, {}, {
      why: "Install it from its download page, then run this again.",
      next: `open ${DEV_TOOL_DOWNLOAD[tool]}`,
    });
  }
  const prefix = (await p.exec(["brew", "--prefix"], { timeoutMs: PROBE_TIMEOUT_MS })).stdout.trim() || "/opt/homebrew";
  const verify = [join(prefix, "bin", tool), tool === "go" ? "version" : "--version"];
  return runInstallerAndVerify(p, tool, "brew", ["brew", "install", tool], `brew install ${tool}`, `installed via brew (${tool})`, verify);
}
```

- [ ] **Step 4: Run the new tests and the existing tools-install tests**

Run: `bun test lib/setup/__tests__/tools-install-dev.test.ts lib/setup/__tests__/tools-install.test.ts`
Expected: PASS (if the existing file has another name, run `ls lib/setup/__tests__ | grep tools-install` and include it).

- [ ] **Step 5: Commit**

```bash
git add lib/setup/tools-install.ts lib/setup/__tests__/tools-install-dev.test.ts
git commit -m "feat(setup): pinned real installs for the dev toolchain"
```

---

### Task 3: Lift the app swap out of update-machine

**Files:**
- Create: `lib/release/app-swap.ts`
- Modify: `lib/release/update-machine.ts` (import from `app-swap.ts`; `runDevBundleLeg` calls `swapDevApp`; export `REGISTERED_APPS`)
- Test: `lib/release/__tests__/app-swap.test.ts`; existing `lib/release/__tests__/update-machine.test.ts` must stay green unchanged.

**Interfaces:**
- Consumes: `RunResult` from `lib/subprocess.ts`.
- Produces:
  - `interface AppSwapSeams { exec(argv: [string, ...string[]], opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> }): Promise<RunResult>; sleep(ms: number): Promise<void> }`
  - `const PROD_APP_PATH`, `const DEV_APP_PATH`, `const OPEN_DEV_APP`, `const DEV_APP_ANCHOR` (moved verbatim)
  - `function execTail(r: RunResult): string` (moved)
  - `type ReplaceFailure`, `async function replaceApp(seams: AppSwapSeams, sourcePath: string, destPath: string): Promise<ReplaceFailure | null>` (moved, unchanged)
  - `async function pgrepPids(seams, pattern)`, `pollForPids(seams, pattern, attempts, delayMs)`, `waitForNoPids(seams, pattern, attempts, delayMs)` (moved)
  - `type DevSwapResult = { ok: true; wasRunning: boolean; pid: number | null } | { ok: false; error: string }`
  - `async function swapDevApp(seams: AppSwapSeams, newApp: string): Promise<DevSwapResult>`
  - `export const REGISTERED_APPS` from `update-machine.ts`
  - `UpdateMachineSeams` extends `AppSwapSeams` (its `exec` opts gain `env`).

- [ ] **Step 1: Write the failing test**

```ts
// lib/release/__tests__/app-swap.test.ts
import { describe, expect, test } from "bun:test";
import { DEV_APP_PATH, swapDevApp, type AppSwapSeams } from "../app-swap.ts";

function seams(script: (cmd: string) => { exitCode: number; stdout?: string }) {
  const cmds: string[] = [];
  const s: AppSwapSeams = {
    exec: async (argv) => {
      const cmd = argv.join(" ");
      cmds.push(cmd);
      const r = script(cmd);
      return { stdout: r.stdout ?? "", stderr: "", exitCode: r.exitCode };
    },
    sleep: async () => {},
  };
  return { s, cmds };
}

describe("swapDevApp", () => {
  test("not running: swaps without killing or opening", async () => {
    const { s, cmds } = seams(() => ({ exitCode: 0 }));
    const r = await swapDevApp(s, "/tmp/x/mattstack-dev.app");
    expect(r).toEqual({ ok: true, wasRunning: false, pid: null });
    expect(cmds.some((c) => c.startsWith("kill"))).toBe(false);
    expect(cmds).toContain(`ditto /tmp/x/mattstack-dev.app ${DEV_APP_PATH}`);
    expect(cmds.some((c) => c.includes("/usr/bin/open"))).toBe(false);
  });

  test("running: kills, swaps, reopens and reports the new pid", async () => {
    let opened = false;
    let killed = false;
    const { s } = seams((cmd) => {
      if (cmd.startsWith("pgrep")) return { exitCode: 0, stdout: !killed ? "111\n" : opened ? "222\n" : "" };
      if (cmd.startsWith("kill")) { killed = true; return { exitCode: 0 }; }
      if (cmd.includes("/usr/bin/open")) { opened = true; return { exitCode: 0 }; }
      return { exitCode: 0 };
    });
    expect(await swapDevApp(s, "/tmp/x/mattstack-dev.app")).toEqual({ ok: true, wasRunning: true, pid: 222 });
  });

  test("a failed ditto restores the previous app and reports it", async () => {
    const { s } = seams((cmd) => ({ exitCode: cmd.startsWith("ditto") ? 1 : 0 }));
    const r = await swapDevApp(s, "/tmp/x/mattstack-dev.app");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("restored the previous app");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/release/__tests__/app-swap.test.ts`
Expected: FAIL, cannot resolve `../app-swap.ts`.

- [ ] **Step 3: Create `lib/release/app-swap.ts` and rewire update-machine**

Move these from `lib/release/update-machine.ts` into `lib/release/app-swap.ts` verbatim (including their comments), changing only the seam parameter type from `UpdateMachineSeams` to `AppSwapSeams`: `PROD_APP_PATH`, `DEV_APP_PATH`, `OPEN_DEV_APP`, `DEV_APP_ANCHOR`, `execTail`, `pgrepPids`, `pollForPids`, `waitForNoPids`, `ReplaceFailure`, `replaceApp`. Export each.

Then add `swapDevApp`, which is the kill, replace and reopen body of today's `runDevBundleLeg` with the same error strings:

```ts
export interface AppSwapSeams {
  exec(argv: [string, ...string[]], opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> }): Promise<RunResult>;
  sleep(ms: number): Promise<void>;
}

export type DevSwapResult = { ok: true; wasRunning: boolean; pid: number | null } | { ok: false; error: string };

/** Quits a running dev app, swaps `newApp` in, and reopens it only if it was running: opening it by hand takes the Mac over. */
export async function swapDevApp(seams: AppSwapSeams, newApp: string): Promise<DevSwapResult> {
  const runningBefore = await pgrepPids(seams, DEV_APP_ANCHOR);
  const wasRunning = runningBefore.length > 0;
  for (const pid of runningBefore) {
    const kill = await seams.exec(["kill", String(pid)]);
    if (kill.exitCode !== 0) {
      // A process that already exited between pgrep and kill (ESRCH) is not a failure.
      const stillRunning = (await pgrepPids(seams, DEV_APP_ANCHOR)).includes(pid);
      if (stillRunning) return { ok: false, error: `kill ${pid} failed: ${execTail(kill)}` };
    }
  }
  if (!(await waitForNoPids(seams, DEV_APP_ANCHOR, 5, 500))) {
    return { ok: false, error: "the running dev app did not exit after kill" };
  }

  const failure = await replaceApp(seams, newApp, DEV_APP_PATH);
  if (failure) {
    if (failure.atDest === "unsafe") return { ok: false, error: `${failure.error}; not reopened, ${DEV_APP_PATH} is not safe to launch` };
    if (!wasRunning) return { ok: false, error: `${failure.error}; not reopened, it was not running` };
    const which = failure.atDest === "previous" ? "reopened the previous app" : "opened the new app";
    const reopen = await seams.exec(OPEN_DEV_APP);
    const pids = reopen.exitCode === 0 ? await pollForPids(seams, DEV_APP_ANCHOR, 5, 500) : [];
    const tail = pids.length > 0 ? `${which} (pid ${pids[0]})` : `opening ${DEV_APP_PATH} did not bring up a process${reopen.exitCode === 0 ? "" : `: ${execTail(reopen)}`}`;
    return { ok: false, error: `${failure.error}; ${tail}` };
  }

  if (!wasRunning) return { ok: true, wasRunning: false, pid: null };
  const open = await seams.exec(OPEN_DEV_APP);
  if (open.exitCode !== 0) return { ok: false, error: `open failed: ${execTail(open)}` };
  const pids = await pollForPids(seams, DEV_APP_ANCHOR, 5, 500);
  if (pids.length === 0) return { ok: false, error: "dev app did not relaunch with a fresh pid" };
  return { ok: true, wasRunning: true, pid: pids[0]! };
}
```

In `update-machine.ts`: import the moved names from `./app-swap.ts`; declare `export interface UpdateMachineSeams extends AppSwapSeams { ... }` and delete its own `exec`/`sleep` members; `export const REGISTERED_APPS`. Replace the tail of `runDevBundleLeg` (from `// Opening the dev app by hand...` to the end) with:

```ts
  const swap = await swapDevApp(seams, `${bundleDir}/rt-tray/mattstack-dev.app`);
  if (!swap.ok) return errorLeg("dev-bundle", DEV_BUNDLE_LABEL, swap.error);
  if (!swap.wasRunning) {
    onNotRunning();
    return okLeg("dev-bundle", DEV_BUNDLE_LABEL, `${DEV_APP_PATH} rebuilt at ${ctx.sha.slice(0, 12)}; not relaunched, it was not running`);
  }
  return okLeg("dev-bundle", DEV_BUNDLE_LABEL, `${DEV_APP_PATH} rebuilt at ${ctx.sha.slice(0, 12)} and relaunched (pid ${swap.pid})`);
```

`onNotRunning` must also fire when the swap fails on a dev app that was not running; today it fires before the kill. Keep that ordering: call `const wasRunningBefore = (await pgrepPids(seams, DEV_APP_ANCHOR)).length > 0; if (!wasRunningBefore) onNotRunning();` immediately before `swapDevApp`, and drop the `onNotRunning()` call from the `!swap.wasRunning` branch.

In `commands/release.ts`, the real seam's `exec` gains env passthrough:

```ts
exec: (argv, opts) => runCapture(argv, { stderr: "pipe", timeoutMs: 600_000, ...opts, ...(opts?.env ? { env: { ...childEnv(), ...opts.env } } : {}) }),
```

(import `childEnv` from `../lib/subprocess.ts` if it is not already imported).

- [ ] **Step 4: Run both suites**

Run: `bun test lib/release/__tests__/app-swap.test.ts lib/release/__tests__/update-machine.test.ts`
Expected: PASS, with no edits to `update-machine.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/release/app-swap.ts lib/release/update-machine.ts commands/release.ts lib/release/__tests__/app-swap.test.ts
git commit -m "refactor(release): lift the dev app swap into app-swap.ts"
```

---

### Task 4: Finding, verifying and reading dev apps

**Files:**
- Create: `lib/dev/dev-app.ts`
- Test: `lib/dev/__tests__/dev-app.test.ts`

**Interfaces:**
- Consumes: `Probes`; `compareVersions` (Task 1); `AppSwapSeams`, `swapDevApp`, `DEV_APP_PATH` (Task 3).
- Produces:
  - `function devZipName(version: string): string`
  - `interface DevRelease { tag: string; version: string; zipUrl: string; sumsUrl: string }`
  - `function devReleaseCandidates(releasesJson: string): DevRelease[]` (newest first, no drafts or prereleases, both assets present)
  - `function expectedSha(sums: string, fileName: string): string | null`
  - `async function chooseDevRelease(p: Probes, candidates: DevRelease[]): Promise<{ release: DevRelease; sha: string } | null>`
  - `async function listDevReleases(p: Probes, gh: string[]): Promise<DevRelease[]>`
  - `interface InstalledDevApp { version: string; releaseBuild: boolean }`
  - `async function readInstalledDevApp(p: Probes, appPath?: string): Promise<InstalledDevApp | null>`
  - `interface DevAppInstallSeams { probes: Probes; swap: AppSwapSeams; download(url: string, dest: string): Promise<void>; scratchDir(): string }`
  - `async function installDevAppFromRelease(s: DevAppInstallSeams, chosen: { release: DevRelease; sha: string }, installed: InstalledDevApp | null): Promise<{ swapped: boolean; relaunchedPid: number | null }>` (throws `UserActionableError` codes `dev-zip-checksum`, `dev-zip-unpack`, `dev-app-swap`)

- [ ] **Step 1: Write the failing tests**

```ts
// lib/dev/__tests__/dev-app.test.ts
import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { chooseDevRelease, devReleaseCandidates, devZipName, expectedSha, installDevAppFromRelease, readInstalledDevApp } from "../dev-app.ts";

const rel = (tag: string, assets: string[], extra: object = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  assets: assets.map((name) => ({ name, browser_download_url: `https://dl/${tag}/${name}` })),
  ...extra,
});

describe("devReleaseCandidates", () => {
  test("keeps releases that carry a dev zip and SHA256SUMS, newest first", () => {
    const json = JSON.stringify([
      rel("v2.23.0", ["mattstack-2.23.0.dmg", "SHA256SUMS"]),
      rel("v2.22.0", ["mattstack-dev-2.22.0.zip", "SHA256SUMS"]),
      rel("v2.21.1", ["mattstack-dev-2.21.1.zip", "SHA256SUMS"], { prerelease: true }),
      rel("v2.21.0", ["mattstack-dev-2.21.0.zip", "SHA256SUMS"]),
    ]);
    expect(devReleaseCandidates(json).map((r) => r.version)).toEqual(["2.22.0", "2.21.0"]);
  });
});

describe("expectedSha", () => {
  test("finds the file's line", () => {
    const sums = "aaa  mattstack-2.22.0.dmg\nbbb  mattstack-dev-2.22.0.zip\n";
    expect(expectedSha(sums, devZipName("2.22.0"))).toBe("bbb");
    expect(expectedSha(sums, devZipName("2.21.0"))).toBeNull();
  });
});

describe("chooseDevRelease", () => {
  test("skips a release whose SHA256SUMS has no dev zip line yet (Review Focus 4)", async () => {
    const candidates = devReleaseCandidates(JSON.stringify([rel("v2.22.0", ["mattstack-dev-2.22.0.zip", "SHA256SUMS"]), rel("v2.21.0", ["mattstack-dev-2.21.0.zip", "SHA256SUMS"])]));
    const p = fakeProbes({
      fetch: async (url) => ({ status: 200, headers: {}, body: url.includes("v2.22.0") ? "aaa  mattstack-2.22.0.dmg\n" : "ccc  mattstack-dev-2.21.0.zip\n" }),
    });
    expect(await chooseDevRelease(p, candidates)).toMatchObject({ release: { version: "2.21.0" }, sha: "ccc" });
  });
  test("none usable is null", async () => {
    expect(await chooseDevRelease(fakeProbes(), [])).toBeNull();
  });
});

describe("readInstalledDevApp", () => {
  test("reads version and the release-build key", async () => {
    const p = fakeProbes({
      files: { "/Applications/mattstack-dev.app/Contents/Info.plist": "" },
      exec: (argv) => {
        if (argv.includes("CFBundleShortVersionString")) return { code: 0, stdout: "2.22.0\n", stderr: "" };
        if (argv.includes("MSDevReleaseBuild")) return { code: 0, stdout: "true\n", stderr: "" };
        return { code: 1, stdout: "", stderr: "" };
      },
    });
    expect(await readInstalledDevApp(p)).toEqual({ version: "2.22.0", releaseBuild: true });
  });
  test("a local build has no key: releaseBuild false", async () => {
    const p = fakeProbes({
      files: { "/Applications/mattstack-dev.app/Contents/Info.plist": "" },
      exec: (argv) => (argv.includes("CFBundleShortVersionString") ? { code: 0, stdout: "2.21.0\n", stderr: "" } : { code: 1, stdout: "", stderr: "not found" }),
    });
    expect(await readInstalledDevApp(p)).toEqual({ version: "2.21.0", releaseBuild: false });
  });
  test("not installed is null", async () => {
    expect(await readInstalledDevApp(fakeProbes())).toBeNull();
  });
});

describe("installDevAppFromRelease", () => {
  const chosen = { release: { tag: "v2.22.0", version: "2.22.0", zipUrl: "https://dl/z", sumsUrl: "https://dl/s" }, sha: "good" };
  test("a checksum mismatch stops before anything is unpacked or swapped", async () => {
    const p = fakeProbes({ exec: (argv) => (argv[0] === "shasum" ? { code: 0, stdout: "bad  /scratch/mattstack-dev-2.22.0.zip\n", stderr: "" } : { code: 0, stdout: "", stderr: "" }) });
    const swaps: string[] = [];
    const s = { probes: p, swap: { exec: async (a: string[]) => { swaps.push(a.join(" ")); return { stdout: "", stderr: "", exitCode: 0 }; }, sleep: async () => {} }, download: async () => {}, scratchDir: () => "/scratch" };
    await expect(installDevAppFromRelease(s as never, chosen, null)).rejects.toMatchObject({ code: "dev-zip-checksum" });
    expect(p.calls.exec.some((a) => a[0] === "ditto")).toBe(false);
    expect(swaps).toEqual([]);
  });
  test("not installed: unpacks and copies straight into /Applications without a swap", async () => {
    const p = fakeProbes({ exec: (argv) => (argv[0] === "shasum" ? { code: 0, stdout: "good  x\n", stderr: "" } : { code: 0, stdout: "", stderr: "" }) });
    const s = { probes: p, swap: { exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }), sleep: async () => {} }, download: async () => {}, scratchDir: () => "/scratch" };
    const r = await installDevAppFromRelease(s as never, chosen, null);
    expect(r).toEqual({ swapped: false, relaunchedPid: null });
    expect(p.calls.exec).toContainEqual(["ditto", "-x", "-k", "/scratch/mattstack-dev-2.22.0.zip", "/scratch/unpacked"]);
    expect(p.calls.exec).toContainEqual(["ditto", "/scratch/unpacked/mattstack-dev.app", "/Applications/mattstack-dev.app"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/dev/__tests__/dev-app.test.ts`
Expected: FAIL, cannot resolve `../dev-app.ts`.

- [ ] **Step 3: Implement `lib/dev/dev-app.ts`**

```ts
import { join } from "path";
import { UserActionableError } from "../errors.ts";
import { DEV_APP_PATH, swapDevApp, type AppSwapSeams } from "../release/app-swap.ts";
import type { Probes } from "../setup/probes.ts";

export const DEV_RELEASE_REPO = "m4ttstack/mattstack";

export function devZipName(version: string): string {
  return `mattstack-dev-${version}.zip`;
}

export interface DevRelease { tag: string; version: string; zipUrl: string; sumsUrl: string }

interface ApiRelease { tag_name?: string; draft?: boolean; prerelease?: boolean; assets?: { name?: string; browser_download_url?: string }[] }

export function devReleaseCandidates(releasesJson: string): DevRelease[] {
  let list: ApiRelease[];
  try {
    const parsed = JSON.parse(releasesJson);
    list = Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
  const out: DevRelease[] = [];
  for (const r of list) {
    if (r.draft || r.prerelease || typeof r.tag_name !== "string") continue;
    const version = r.tag_name.replace(/^v/, "");
    const zip = r.assets?.find((a) => a.name === devZipName(version));
    const sums = r.assets?.find((a) => a.name === "SHA256SUMS");
    if (!zip?.browser_download_url || !sums?.browser_download_url) continue;
    out.push({ tag: r.tag_name, version, zipUrl: zip.browser_download_url, sumsUrl: sums.browser_download_url });
  }
  return out;
}

export function expectedSha(sums: string, fileName: string): string | null {
  for (const line of sums.split("\n")) {
    const m = line.match(/^([0-9a-f]+)\s+\*?(.+)$/i);
    if (m && m[2]!.trim() === fileName) return m[1]!.toLowerCase();
  }
  return null;
}

export async function chooseDevRelease(p: Probes, candidates: DevRelease[]): Promise<{ release: DevRelease; sha: string } | null> {
  for (const release of candidates) {
    const sums = await p.fetch(release.sumsUrl, { timeoutMs: 15_000 });
    if (sums.status !== 200) continue;
    const sha = expectedSha(sums.body, devZipName(release.version));
    if (sha) return { release, sha };
  }
  return null;
}

export async function listDevReleases(p: Probes, gh: string[]): Promise<DevRelease[]> {
  const r = await p.exec([...gh, "api", `repos/${DEV_RELEASE_REPO}/releases?per_page=20`], { timeoutMs: 30_000 });
  if (r.code !== 0) {
    throw new UserActionableError("dev-releases-unreadable", "rt could not list mattstack's releases", {}, { why: "GitHub did not answer.", log: r.stderr || r.stdout });
  }
  return devReleaseCandidates(r.stdout);
}

export interface InstalledDevApp { version: string; releaseBuild: boolean }

export async function readInstalledDevApp(p: Probes, appPath: string = DEV_APP_PATH): Promise<InstalledDevApp | null> {
  const plist = join(appPath, "Contents", "Info.plist");
  if (!p.exists(plist)) return null;
  const read = (key: string) => p.exec(["plutil", "-extract", key, "raw", "-o", "-", plist], { timeoutMs: 5000 });
  const version = await read("CFBundleShortVersionString");
  if (version.code !== 0) return null;
  const flag = await read("MSDevReleaseBuild");
  return { version: version.stdout.trim(), releaseBuild: flag.code === 0 && flag.stdout.trim() === "true" };
}

export interface DevAppInstallSeams {
  probes: Probes;
  swap: AppSwapSeams;
  download(url: string, dest: string): Promise<void>;
  scratchDir(): string;
}

export async function installDevAppFromRelease(
  s: DevAppInstallSeams,
  chosen: { release: DevRelease; sha: string },
  installed: InstalledDevApp | null,
): Promise<{ swapped: boolean; relaunchedPid: number | null }> {
  const p = s.probes;
  const scratch = s.scratchDir();
  const zip = join(scratch, devZipName(chosen.release.version));
  await s.download(chosen.release.zipUrl, zip);

  const sum = await p.exec(["shasum", "-a", "256", zip], { timeoutMs: 60_000 });
  const actual = sum.stdout.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (sum.code !== 0 || actual !== chosen.sha) {
    throw new UserActionableError("dev-zip-checksum", "The downloaded dev app does not match its release checksum", {}, {
      why: "rt did not install it. Try again; if it keeps happening, tell the maintainers.",
      log: `expected ${chosen.sha}, got ${actual || sum.stderr}`,
    });
  }

  const unpacked = join(scratch, "unpacked");
  const unzip = await p.exec(["ditto", "-x", "-k", zip, unpacked], { timeoutMs: 120_000 });
  if (unzip.code !== 0) throw new UserActionableError("dev-zip-unpack", "rt could not unpack the dev app", {}, { log: unzip.stderr });
  const app = join(unpacked, "mattstack-dev.app");

  if (!installed) {
    const copy = await p.exec(["ditto", app, DEV_APP_PATH], { timeoutMs: 120_000 });
    if (copy.code !== 0) throw new UserActionableError("dev-app-swap", `rt could not copy the dev app into ${DEV_APP_PATH}`, {}, { log: copy.stderr });
    return { swapped: false, relaunchedPid: null };
  }
  const swap = await swapDevApp(s.swap, app);
  if (!swap.ok) throw new UserActionableError("dev-app-swap", "rt could not swap in the new dev app", {}, { log: swap.error });
  return { swapped: true, relaunchedPid: swap.pid };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test lib/dev/__tests__/dev-app.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dev/dev-app.ts lib/dev/__tests__/dev-app.test.ts
git commit -m "feat(dev): find, verify and install release dev apps"
```

---

### Task 5: `rt dev setup` orchestration

**Files:**
- Create: `lib/dev/seams.ts`, `lib/dev/stages.ts`, `lib/dev/setup.ts`
- Test: `lib/dev/__tests__/setup.test.ts`

**Interfaces:**
- Consumes: Tasks 1-4; `InstallResult` from `lib/setup/tools-install.ts`; `Flavor` from `lib/flavor.ts`; `RenderStatus` from `lib/ui/protocol.ts`; `OPEN_DEV_APP`, `DEV_APP_PATH` from `lib/release/app-swap.ts`; `REGISTERED_APPS` from `lib/release/update-machine.ts`; `expandHome` from `lib/setup/repo-root.ts`.
- Produces (`lib/dev/seams.ts`):
  - `interface StageEnding { status: Exclude<RenderStatus, "running">; title: string; hint?: string }`
  - `type StageRunner = (title: string, task: (sub: (text: string) => void) => Promise<StageEnding>) => Promise<StageEnding>`
  - `interface DevSeams extends DevAppInstallSeams { flavor: Flavor; interactive: boolean; prodVersion: string; confirm(message: string): Promise<boolean>; repoRoot(): string | null; storedSourcePath(): string | null; saveSourcePath(sourcePath: string, bunPath: string): void; installDevTool(tool: "bun" | "go" | "node", version: string): Promise<InstallResult>; gh(): string[] | null; devWrapperOwnsRt(): boolean }`
  - `const DEV_REFUSAL_CODES: ReadonlySet<string>` = `dev-no-push-access`, `dev-clone-path-taken`, `dev-not-set-up`
- Produces (`lib/dev/stages.ts`):
  - `async function ensureTools(s: DevSeams, pins: DevPins, sub: (t: string) => void): Promise<{ ending: StageEnding; bunPath: string; goPath: string }>`
  - `async function ensureDevApp(s: DevSeams, sub: (t: string) => void, mode: "setup" | "update"): Promise<StageEnding>`
  - `function isMattstackRemote(url: string): boolean`
- Produces (`lib/dev/setup.ts`):
  - `type DevSetupResult = { kind: "already"; clone: string } | { kind: "done"; clone: string; stages: StageEnding[] }`
  - `async function runDevSetup(s: DevSeams, stage: StageRunner): Promise<DevSetupResult>`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/dev/__tests__/setup.test.ts
import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import type { DevSeams, StageEnding, StageRunner } from "../seams.ts";
import { runDevSetup } from "../setup.ts";
import { isMattstackRemote } from "../stages.ts";

const HOME = "/Users/collab";
const ROOT = `${HOME}/Documents/GitHub`;
const CLONE = `${ROOT}/mattstack`;
const BUN = `${HOME}/.bun/bin/bun`;
const GO = "/opt/homebrew/bin/go";
const GH = ["/Applications/mattstack.app/Contents/Helpers/gh"];
const PINS = { pkg: JSON.stringify({ packageManager: "bun@1.4.2" }), goMod: "go 1.26.5\n" };

const runner: StageRunner = async (_title, task) => task(() => {});

interface World {
  cloneExists?: boolean;
  origin?: string;
  pushAccess?: string;
  ghLoggedIn?: boolean;
  repoRoot?: string | null;
  bun?: string;
  interactive?: boolean;
  confirm?: boolean;
  online?: boolean;
  takeoverAfterOpen?: boolean;
  flavor?: "dev" | "prod";
  wrapperOwns?: boolean;
}

function world(w: World = {}) {
  const files: Record<string, string> = { "/usr/bin/git": "", [GO]: "", "/opt/homebrew/bin/node": "" };
  if (w.bun !== "missing") files[BUN] = "";
  if (w.cloneExists) {
    files[`${CLONE}/package.json`] = PINS.pkg;
    files[`${CLONE}/ui/go.mod`] = PINS.goMod;
  }
  let opened = false;
  const saved: Array<[string, string]> = [];
  const installs: string[] = [];
  const probes = fakeProbes({
    home: HOME,
    env: { PATH: "/usr/bin" },
    files,
    // exists() on a directory reads `dirs`, so an existing clone needs its folder here too
    dirs: w.cloneExists ? { [CLONE]: ["package.json", "ui"] } : {},
    fetch: async (url) =>
      w.online === false
        ? { status: 0, body: "", headers: {} }
        : url.endsWith("package.json")
          ? { status: 200, body: PINS.pkg, headers: {} }
          : url.endsWith("go.mod")
            ? { status: 200, body: PINS.goMod, headers: {} }
            : { status: 200, body: "good  mattstack-dev-2.22.0.zip\n", headers: {} },
    exec: (argv) => {
      const a = argv.join(" ");
      if (a === "/usr/bin/git --version") return { code: 0, stdout: "git version 2.50.1", stderr: "" };
      if (a === `${BUN} --version`) return { code: 0, stdout: w.bun ?? "1.4.2", stderr: "" };
      if (a === `${GO} version`) return { code: 0, stdout: "go version go1.26.5 darwin/arm64", stderr: "" };
      if (a === "/opt/homebrew/bin/node --version") return { code: 0, stdout: "v22.0.0", stderr: "" };
      if (a.endsWith("auth status")) return { code: w.ghLoggedIn === false ? 1 : 0, stdout: "", stderr: "" };
      if (a.includes("--jq .permissions.push")) return { code: 0, stdout: `${w.pushAccess ?? "true"}\n`, stderr: "" };
      if (a.includes("api repos/m4ttstack/mattstack/releases")) {
        return { code: 0, stderr: "", stdout: JSON.stringify([{ tag_name: "v2.22.0", draft: false, prerelease: false, assets: [{ name: "mattstack-dev-2.22.0.zip", browser_download_url: "https://dl/z" }, { name: "SHA256SUMS", browser_download_url: "https://dl/s" }] }]) };
      }
      if (a.startsWith(`git -C ${CLONE} remote get-url origin`)) return { code: 0, stdout: `${w.origin ?? "https://github.com/m4ttstack/mattstack.git"}\n`, stderr: "" };
      if (a.startsWith("shasum")) return { code: 0, stdout: "good  x\n", stderr: "" };
      if (a.includes("/usr/bin/open")) { opened = true; return { code: 0, stdout: "", stderr: "" }; }
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  const seams: DevSeams = {
    probes,
    swap: { exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }), sleep: async () => {} },
    download: async () => {},
    scratchDir: () => "/scratch",
    flavor: w.flavor ?? "prod",
    interactive: w.interactive ?? true,
    prodVersion: "2.22.0",
    confirm: async () => w.confirm ?? true,
    repoRoot: () => (w.repoRoot === undefined ? ROOT : w.repoRoot),
    storedSourcePath: () => null,
    saveSourcePath: (sp, bp) => { saved.push([sp, bp]); },
    installDevTool: async (tool, version) => { installs.push(`${tool}@${version}`); return { via: "vendor", ok: true, detail: "ok" }; },
    gh: () => GH,
    devWrapperOwnsRt: () => (w.wrapperOwns ?? false) || (opened && (w.takeoverAfterOpen ?? true)),
  };
  return { seams, probes, saved, installs };
}

describe("runDevSetup", () => {
  test("a fresh prod Mac: clones, builds, stores the source, installs and opens the dev app, registers apps", async () => {
    const { seams, probes, saved } = world();
    const r = await runDevSetup(seams, runner);
    expect(r.kind).toBe("done");
    const cmds = probes.calls.exec.map((a) => a.join(" "));
    expect(cmds).toContain(`git clone https://github.com/m4ttstack/mattstack.git ${CLONE}`);
    expect(cmds).toContain(`${BUN} install`);
    expect(cmds).toContain(`${BUN} run ui:build`);
    expect(saved).toEqual([[CLONE, BUN]]);
    expect(cmds.some((c) => c.includes("/usr/bin/open /Applications/mattstack-dev.app"))).toBe(true);
    for (const app of ["board", "console", "chat", "boxscore", "deck"]) {
      expect(cmds).toContain(`/Applications/mattstack-dev.app/Contents/Helpers/deck register --dir ${CLONE}/apps/${app}`);
    }
  });

  test("already on dev with the wrapper: reports already set up, changes nothing", async () => {
    const { seams, probes } = world({ flavor: "dev", wrapperOwns: true });
    expect(await runDevSetup(seams, runner)).toEqual({ kind: "already", clone: CLONE });
    expect(probes.calls.exec).toEqual([]);
  });

  test("no repo root: refuses before cloning (Review Focus 1)", async () => {
    const { seams, probes } = world({ repoRoot: null });
    await expect(runDevSetup(seams, runner)).rejects.toMatchObject({ code: "dev-no-repo-root", next: "rt setup repo-root" });
    expect(probes.calls.exec.some((a) => a[0] === "git" && a[1] === "clone")).toBe(false);
  });

  test("an existing mattstack clone is reused untouched (Review Focus 2)", async () => {
    const { seams, probes } = world({ cloneExists: true });
    await runDevSetup(seams, runner);
    const cmds = probes.calls.exec.map((a) => a.join(" "));
    expect(cmds.some((c) => c.startsWith("git clone"))).toBe(false);
    expect(cmds.some((c) => /git (-C \S+ )?(checkout|pull|reset|fetch)/.test(c))).toBe(false);
  });

  test("a folder holding something else is a refusal", async () => {
    const { seams } = world({ cloneExists: true, origin: "https://github.com/someone/else.git" });
    await expect(runDevSetup(seams, runner)).rejects.toMatchObject({ code: "dev-clone-path-taken" });
  });

  test("no push access refuses before cloning", async () => {
    const { seams, probes } = world({ pushAccess: "false" });
    await expect(runDevSetup(seams, runner)).rejects.toMatchObject({ code: "dev-no-push-access" });
    expect(probes.calls.exec.some((a) => a[1] === "clone")).toBe(false);
  });

  test("not logged in to GitHub, non-interactive: refuses naming gh auth login", async () => {
    const { seams } = world({ ghLoggedIn: false, interactive: false });
    await expect(runDevSetup(seams, runner)).rejects.toMatchObject({ code: "dev-gh-login" });
  });

  test("missing bun, non-interactive: refuses with the install command, installs nothing", async () => {
    const { seams, installs } = world({ bun: "missing", interactive: false });
    await expect(runDevSetup(seams, runner)).rejects.toMatchObject({ code: "dev-tool-missing", next: "curl -fsSL https://bun.sh/install | bash -s bun-v1.4.2" });
    expect(installs).toEqual([]);
  });

  test("too-old bun, interactive and accepted: installs the pinned version", async () => {
    const { seams, installs } = world({ bun: "1.3.0" });
    // the re-probe after install still sees 1.3.0 in this fake, so expect the post-install check to fail loudly
    await expect(runDevSetup(seams, runner)).rejects.toMatchObject({ code: "dev-tool-install-failed" });
    expect(installs).toEqual(["bun@1.4.2"]);
  });

  test("offline before the clone: plain error, nothing changed (Review Focus 5)", async () => {
    const { seams, probes } = world({ online: false });
    await expect(runDevSetup(seams, runner)).rejects.toMatchObject({ code: "dev-pins-unreadable" });
    expect(probes.calls.exec).toEqual([]);
  });

  test("the dev app never takes over: times out pointing back at prod", async () => {
    const { seams } = world({ takeoverAfterOpen: false });
    await expect(runDevSetup(seams, runner)).rejects.toMatchObject({ code: "dev-switch-timeout" });
  });
});

describe("isMattstackRemote", () => {
  test("https and ssh forms", () => {
    expect(isMattstackRemote("https://github.com/m4ttstack/mattstack.git")).toBe(true);
    expect(isMattstackRemote("git@github.com:m4ttstack/mattstack.git")).toBe(true);
    expect(isMattstackRemote("https://github.com/m4ttstack/mattstack")).toBe(true);
    expect(isMattstackRemote("https://github.com/someone/mattstack.git")).toBe(false);
  });
});
```

The "offline" test asserts `probes.calls.exec` is empty: the pin read must happen before any exec (tools probe, gh) runs. Order the stages accordingly (pins, then tools).

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/dev/__tests__/setup.test.ts`
Expected: FAIL, cannot resolve `../setup.ts`.

- [ ] **Step 3: Implement `lib/dev/seams.ts`**

```ts
import type { Flavor } from "../flavor.ts";
import type { InstallResult } from "../setup/tools-install.ts";
import type { RenderStatus } from "../ui/protocol.ts";
import type { DevAppInstallSeams } from "./dev-app.ts";

export interface StageEnding {
  status: Exclude<RenderStatus, "running">;
  title: string;
  hint?: string;
}

export type StageRunner = (title: string, task: (sub: (text: string) => void) => Promise<StageEnding>) => Promise<StageEnding>;

export interface DevSeams extends DevAppInstallSeams {
  flavor: Flavor;
  /** A person can answer a prompt: a terminal, no --json, no RT_BATCH. */
  interactive: boolean;
  /** The running rt's version, to say when the dev app comes from an older release. */
  prodVersion: string;
  confirm(message: string): Promise<boolean>;
  /** The first rt.repoRoots entry, unexpanded, or null. */
  repoRoot(): string | null;
  storedSourcePath(): string | null;
  saveSourcePath(sourcePath: string, bunPath: string): void;
  installDevTool(tool: "bun" | "go" | "node", version: string): Promise<InstallResult>;
  /** The bundled gh argv, or null when the app ships none. */
  gh(): string[] | null;
  devWrapperOwnsRt(): boolean;
}

export const DEV_REFUSAL_CODES: ReadonlySet<string> = new Set(["dev-no-push-access", "dev-clone-path-taken", "dev-not-set-up"]);
```

- [ ] **Step 4: Implement `lib/dev/stages.ts`**

```ts
import { UserActionableError } from "../errors.ts";
import { compareVersions, installCommandFor, probeDevTools, type DevPins, type DevToolStatus } from "./tools.ts";
import { chooseDevRelease, installDevAppFromRelease, listDevReleases, readInstalledDevApp } from "./dev-app.ts";
import type { DevSeams, StageEnding } from "./seams.ts";

export function isMattstackRemote(url: string): boolean {
  return /github\.com[:/]m4ttstack\/mattstack(\.git)?\/?$/.test(url.trim());
}

function describe(t: DevToolStatus): string {
  return `${t.name} ${t.version}`;
}

export async function ensureTools(s: DevSeams, pins: DevPins, sub: (t: string) => void): Promise<{ ending: StageEnding; bunPath: string; goPath: string }> {
  let tools = await probeDevTools(s.probes, pins);
  for (const t of tools.filter((x) => x.need === "required" && x.state !== "ready")) {
    const command = installCommandFor(t.name, t.wanted);
    const what = t.state === "too-old" ? `${t.name} ${t.version} is older than the ${t.wanted} mattstack needs` : `${t.name} is not installed`;
    if (t.name === "git" || !s.interactive) {
      throw new UserActionableError("dev-tool-missing", what, {}, { next: command });
    }
    if (!(await s.confirm(`${what}. Install ${t.name} ${t.wanted} now?`))) {
      throw new UserActionableError("dev-tool-missing", what, {}, { next: command });
    }
    sub(`Installing ${t.name} ${t.wanted}`);
    const result = await s.installDevTool(t.name, t.wanted!);
    if (!result.ok) throw new UserActionableError("dev-tool-install-failed", `Installing ${t.name} failed`, {}, { why: result.detail, next: command });
  }
  tools = await probeDevTools(s.probes, pins);
  const stillMissing = tools.find((x) => x.need === "required" && x.state !== "ready");
  if (stillMissing) {
    throw new UserActionableError("dev-tool-install-failed", `${stillMissing.name} ${stillMissing.wanted} still is not available`, {}, {
      why: "Open a new terminal so your PATH picks it up, then run this again.",
      next: installCommandFor(stillMissing.name, stillMissing.wanted),
    });
  }
  const node = tools.find((x) => x.name === "node")!;
  const ready = tools.filter((x) => x.state === "ready" && x.name !== "git").map(describe).join(" · ");
  const hint = node.state === "ready" ? ready : `${ready} · node 20 or newer is optional, some test suites need it`;
  return {
    ending: { status: "done", title: "Your tools are ready", hint },
    bunPath: tools.find((x) => x.name === "bun")!.found!,
    goPath: tools.find((x) => x.name === "go")!.found!,
  };
}

export async function ensureDevApp(s: DevSeams, sub: (t: string) => void, mode: "setup" | "update"): Promise<StageEnding> {
  const gh = s.gh();
  if (!gh) throw new UserActionableError("dev-no-gh", "This app does not include the GitHub CLI rt needs");
  const installed = await readInstalledDevApp(s.probes);
  if (mode === "update" && installed && !installed.releaseBuild) {
    return { status: "skipped", title: "Your dev app was built on this Mac", hint: "rt only updates a dev app that came from a release" };
  }
  const chosen = await chooseDevRelease(s.probes, await listDevReleases(s.probes, gh));
  if (!chosen) throw new UserActionableError("dev-no-dev-zip", "No mattstack release has a dev app yet", {}, { why: "Ask the maintainers to publish one." });
  if (installed && compareVersions(installed.version, chosen.release.version) >= 0) {
    return { status: "skipped", title: `Dev app ${installed.version} is current` };
  }
  sub(`Downloading the dev app ${chosen.release.version}`);
  const r = await installDevAppFromRelease(s, chosen, installed);
  const older = chosen.release.version !== s.prodVersion ? `${chosen.release.version}, the newest release with a dev app` : chosen.release.version;
  const relaunched = r.relaunchedPid !== null ? " and reopened it" : "";
  return { status: "done", title: `Installed the dev app${relaunched}`, hint: older };
}
```

- [ ] **Step 5: Implement `lib/dev/setup.ts`**

```ts
import { join } from "path";
import { UserActionableError } from "../errors.ts";
import { DEV_APP_PATH, OPEN_DEV_APP } from "../release/app-swap.ts";
import { REGISTERED_APPS } from "../release/update-machine.ts";
import { expandHome } from "../setup/repo-root.ts";
import { readPins } from "./tools.ts";
import { ensureDevApp, ensureTools, isMattstackRemote } from "./stages.ts";
import type { DevSeams, StageEnding, StageRunner } from "./seams.ts";

export type DevSetupResult = { kind: "already"; clone: string } | { kind: "done"; clone: string; stages: StageEnding[] };

const CLONE_URL = "https://github.com/m4ttstack/mattstack.git";
const DEV_DECK = `${DEV_APP_PATH}/Contents/Helpers/deck`;
const SWITCH_WAIT_S = 90;
const DECK_WAIT_S = 60;

function clonePath(s: DevSeams): string {
  const root = s.repoRoot();
  if (!root) {
    throw new UserActionableError("dev-no-repo-root", "This Mac has no repo folder chosen yet", {}, { why: "rt clones mattstack into it.", next: "rt setup repo-root" });
  }
  return join(expandHome(s.probes, root), "mattstack");
}

async function cloneIsOurs(s: DevSeams, dir: string): Promise<boolean | null> {
  if (!s.probes.exists(dir)) return null;
  const r = await s.probes.exec(["git", "-C", dir, "remote", "get-url", "origin"], { timeoutMs: 5000 });
  return r.code === 0 && isMattstackRemote(r.stdout);
}

export async function runDevSetup(s: DevSeams, stage: StageRunner): Promise<DevSetupResult> {
  const p = s.probes;
  const dir = clonePath(s);
  if (s.flavor === "dev" && s.devWrapperOwnsRt()) return { kind: "already", clone: dir };

  const stages: StageEnding[] = [];
  const ours = await cloneIsOurs(s, dir);
  if (ours === false) {
    throw new UserActionableError("dev-clone-path-taken", `${dir} already holds something that is not mattstack`, {}, { why: "Move it aside, then run this again." });
  }
  const pins = await readPins(p, ours ? dir : null);

  let bunPath = "";
  let goPath = "";
  stages.push(
    await stage("Check your tools", async (sub) => {
      const t = await ensureTools(s, pins, sub);
      bunPath = t.bunPath;
      goPath = t.goPath;
      return t.ending;
    }),
  );

  stages.push(
    await stage("Check you can push to mattstack", async () => {
      const gh = s.gh();
      if (!gh) throw new UserActionableError("dev-no-gh", "This app does not include the GitHub CLI rt needs");
      let auth = await p.exec([...gh, "auth", "status"], { timeoutMs: 15_000 });
      if (auth.code !== 0 && s.interactive && (await s.confirm("You're not logged in to GitHub. Log in now?"))) {
        await p.exec([...gh, "auth", "login", "--git-protocol", "https", "--web"], { inherit: true, timeoutMs: 600_000 });
        await p.exec([...gh, "auth", "setup-git"], { timeoutMs: 15_000 });
        auth = await p.exec([...gh, "auth", "status"], { timeoutMs: 15_000 });
      }
      if (auth.code !== 0) {
        throw new UserActionableError("dev-gh-login", "You're not logged in to GitHub", {}, { why: "Pushing your branches needs it.", next: `${gh.join(" ")} auth login` });
      }
      const push = await p.exec([...gh, "api", "repos/m4ttstack/mattstack", "--jq", ".permissions.push"], { timeoutMs: 15_000 });
      if (push.stdout.trim() !== "true") {
        throw new UserActionableError("dev-no-push-access", "You can't push to mattstack yet", {}, { why: "Ask the mattstack maintainers to add you as a collaborator." });
      }
      return { status: "done", title: "You can push to mattstack" };
    }),
  );

  stages.push(
    await stage("Clone mattstack", async (sub) => {
      if (ours) return { status: "skipped", title: "Using your clone", hint: dir };
      sub(`Cloning into ${dir}`);
      const r = await p.exec(["git", "clone", CLONE_URL, dir], { timeoutMs: 30 * 60_000 });
      if (r.code !== 0) throw new UserActionableError("dev-clone-failed", "Cloning mattstack failed", {}, { log: r.stderr || r.stdout });
      return { status: "done", title: "Cloned mattstack", hint: dir };
    }),
  );

  stages.push(
    await stage("Build your clone", async (sub) => {
      const path = `${join(goPath, "..")}:${join(bunPath, "..")}:${p.env.PATH ?? ""}`;
      sub("Installing packages");
      const install = await p.exec([bunPath, "install"], { cwd: dir, env: { PATH: path }, timeoutMs: 30 * 60_000 });
      if (install.code !== 0) throw new UserActionableError("dev-build-failed", "Installing packages in your clone failed", {}, { log: install.stderr || install.stdout });
      sub("Building rt's terminal helper");
      const ui = await p.exec([bunPath, "run", "ui:build"], { cwd: dir, env: { PATH: path }, timeoutMs: 10 * 60_000 });
      if (ui.code !== 0) throw new UserActionableError("dev-build-failed", "Building rt's terminal helper failed", {}, { log: ui.stderr || ui.stdout });
      return { status: "done", title: "Built your clone" };
    }),
  );

  stages.push(
    await stage("Point rt at your clone", async () => {
      if (s.storedSourcePath() === dir) return { status: "skipped", title: "rt already runs your clone" };
      s.saveSourcePath(dir, bunPath);
      return { status: "done", title: "rt will run your clone", hint: dir };
    }),
  );

  stages.push(await stage("Install the dev app", (sub) => ensureDevApp(s, sub, "setup")));

  stages.push(
    await stage("Switch to the dev app", async () => {
      if (s.devWrapperOwnsRt()) return { status: "skipped", title: "The dev app already runs this Mac" };
      const open = await p.exec(OPEN_DEV_APP, { timeoutMs: 30_000 });
      if (open.code !== 0) throw new UserActionableError("dev-switch-failed", "The dev app did not open", {}, { log: open.stderr, next: "open /Applications/mattstack.app" });
      for (let i = 0; i < SWITCH_WAIT_S; i++) {
        if (s.devWrapperOwnsRt()) return { status: "done", title: "Switched to the dev app" };
        await s.swap.sleep(1000);
      }
      throw new UserActionableError("dev-switch-timeout", "The dev app did not take over this Mac", {}, {
        why: "mattstack.app may still be running it. Opening mattstack.app switches you back.",
        next: "open /Applications/mattstack.app",
      });
    }),
  );

  stages.push(
    await stage("Serve the apps from your clone", async (sub) => {
      let answered = false;
      for (let i = 0; i < DECK_WAIT_S && !answered; i++) {
        answered = (await p.exec([DEV_DECK, "list"], { timeoutMs: 10_000 })).code === 0;
        if (!answered) await s.swap.sleep(1000);
      }
      if (!answered) throw new UserActionableError("dev-deck-silent", "The dev app's deck did not answer", {}, { next: "rt dev setup" });
      for (const app of REGISTERED_APPS) {
        sub(`Registering ${app}`);
        const r = await p.exec([DEV_DECK, "register", "--dir", `${dir}/apps/${app}`], { timeoutMs: 120_000 });
        if (r.code !== 0) throw new UserActionableError("dev-register-failed", `deck could not serve ${app} from your clone`, {}, { log: r.stderr || r.stdout, next: "rt dev setup" });
      }
      return { status: "done", title: "The apps run from your clone" };
    }),
  );

  return { kind: "done", clone: dir, stages };
}
```

Note the "already" check must run before `clonePath` can throw only if the stored source path is known; keep it as written (it needs the repo root to name the clone). If the test for "already" fails because `repoRoot` is consulted first, that is fine: the fake returns ROOT.

- [ ] **Step 6: Run to verify it passes**

Run: `bun test lib/dev/__tests__/setup.test.ts`
Expected: PASS. If the "offline" test fails because `cloneIsOurs` runs `git` before `readPins`, it only does so when the folder exists; the offline world has no folder, so `calls.exec` stays empty. Keep that order.

- [ ] **Step 7: Commit**

```bash
git add lib/dev/seams.ts lib/dev/stages.ts lib/dev/setup.ts lib/dev/__tests__/setup.test.ts
git commit -m "feat(dev): rt dev setup orchestration"
```

---

### Task 6: `rt dev update` orchestration

**Files:**
- Create: `lib/dev/update.ts`
- Test: `lib/dev/__tests__/update.test.ts`

**Interfaces:**
- Consumes: `DevSeams`, `StageRunner`, `StageEnding` (Task 5); `ensureTools`, `ensureDevApp` (Task 5); `readPins` (Task 1).
- Produces:
  - `async function rtUiStale(s: DevSeams, clone: string): Promise<boolean>`
  - `type DevUpdateResult = { clone: string; stages: StageEnding[] }`
  - `async function runDevUpdate(s: DevSeams, stage: StageRunner): Promise<DevUpdateResult>`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/dev/__tests__/update.test.ts
import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import type { DevSeams, StageRunner } from "../seams.ts";
import { runDevUpdate, rtUiStale } from "../update.ts";

const CLONE = "/Users/collab/Documents/GitHub/mattstack";
const BUN = "/Users/collab/.bun/bin/bun";
const GO = "/opt/homebrew/bin/go";
const runner: StageRunner = async (_t, task) => task(() => {});

function seams(opts: { flavor?: "dev" | "prod"; source?: string | null; uiBinary?: boolean; newerUnderUi?: boolean; installedVersion?: string; releaseBuild?: boolean }) {
  const files: Record<string, string> = {
    [`${CLONE}/package.json`]: JSON.stringify({ packageManager: "bun@1.4.2" }),
    [`${CLONE}/ui/go.mod`]: "go 1.26.5\n",
    "/usr/bin/git": "",
    [BUN]: "",
    [GO]: "",
    "/Applications/mattstack-dev.app/Contents/Info.plist": "",
  };
  if (opts.uiBinary !== false) files[`${CLONE}/ui/dist/rt-ui`] = "";
  const probes = fakeProbes({
    home: "/Users/collab",
    env: { PATH: "/usr/bin" },
    files,
    fetch: async () => ({ status: 200, headers: {}, body: "good  mattstack-dev-2.23.0.zip\n" }),
    exec: (argv) => {
      const a = argv.join(" ");
      if (a === "/usr/bin/git --version") return { code: 0, stdout: "git version 2.50.1", stderr: "" };
      if (a === `${BUN} --version`) return { code: 0, stdout: "1.4.2", stderr: "" };
      if (a === `${GO} version`) return { code: 0, stdout: "go version go1.26.5 darwin/arm64", stderr: "" };
      if (argv[0] === "find") return { code: 0, stdout: opts.newerUnderUi ? `${CLONE}/ui/cmd/rt-ui/main.go\n` : "", stderr: "" };
      if (a.includes("CFBundleShortVersionString")) return { code: 0, stdout: `${opts.installedVersion ?? "2.22.0"}\n`, stderr: "" };
      if (a.includes("MSDevReleaseBuild")) return opts.releaseBuild === false ? { code: 1, stdout: "", stderr: "" } : { code: 0, stdout: "true\n", stderr: "" };
      if (a.includes("api repos/m4ttstack/mattstack/releases")) {
        return { code: 0, stderr: "", stdout: JSON.stringify([{ tag_name: "v2.23.0", draft: false, prerelease: false, assets: [{ name: "mattstack-dev-2.23.0.zip", browser_download_url: "https://dl/z" }, { name: "SHA256SUMS", browser_download_url: "https://dl/s" }] }]) };
      }
      if (argv[0] === "shasum") return { code: 0, stdout: "good  x\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  const swapCmds: string[] = [];
  const s: DevSeams = {
    probes,
    swap: { exec: async (argv) => { swapCmds.push(argv.join(" ")); return { stdout: "", stderr: "", exitCode: 0 }; }, sleep: async () => {} },
    download: async () => {},
    scratchDir: () => "/scratch",
    flavor: opts.flavor ?? "dev",
    interactive: false,
    prodVersion: "dev",
    confirm: async () => false,
    repoRoot: () => "/Users/collab/Documents/GitHub",
    storedSourcePath: () => (opts.source === undefined ? CLONE : opts.source),
    saveSourcePath: () => {},
    installDevTool: async () => ({ via: "vendor", ok: true, detail: "" }),
    gh: () => ["gh"],
    devWrapperOwnsRt: () => true,
  };
  return { s, probes, swapCmds };
}

describe("runDevUpdate", () => {
  test("from prod: refuses, pointing at setup", async () => {
    const { s } = seams({ flavor: "prod" });
    await expect(runDevUpdate(s, runner)).rejects.toMatchObject({ code: "dev-not-set-up", next: "rt dev setup" });
  });

  test("swaps in a newer release dev app", async () => {
    const { s, swapCmds } = seams({});
    const r = await runDevUpdate(s, runner);
    expect(r.stages.map((x) => x.status)).toEqual(["done", "skipped", "done"]);
    expect(swapCmds.some((c) => c.startsWith("ditto") && c.endsWith("/Applications/mattstack-dev.app"))).toBe(true);
  });

  test("a locally built dev app is left alone", async () => {
    const { s, swapCmds } = seams({ releaseBuild: false });
    const r = await runDevUpdate(s, runner);
    expect(r.stages.at(-1)!.status).toBe("skipped");
    expect(swapCmds).toEqual([]);
  });

  test("never pulls, rebases or checks out the clone", async () => {
    const { s, probes } = seams({});
    await runDevUpdate(s, runner);
    expect(probes.calls.exec.some((a) => a[0] === "git" && ["pull", "rebase", "checkout", "fetch", "reset"].some((v) => a.includes(v)))).toBe(false);
  });
});

describe("rtUiStale", () => {
  test("missing binary is stale", async () => expect(await rtUiStale(seams({ uiBinary: false }).s, CLONE)).toBe(true));
  test("a newer source file is stale", async () => expect(await rtUiStale(seams({ newerUnderUi: true }).s, CLONE)).toBe(true));
  test("fresh is not stale", async () => expect(await rtUiStale(seams({}).s, CLONE)).toBe(false));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/dev/__tests__/update.test.ts`
Expected: FAIL, cannot resolve `../update.ts`.

- [ ] **Step 3: Implement `lib/dev/update.ts`**

```ts
import { join } from "path";
import { UserActionableError } from "../errors.ts";
import { readPins } from "./tools.ts";
import { ensureDevApp, ensureTools } from "./stages.ts";
import type { DevSeams, StageEnding, StageRunner } from "./seams.ts";

export type DevUpdateResult = { clone: string; stages: StageEnding[] };

export async function rtUiStale(s: DevSeams, clone: string): Promise<boolean> {
  const bin = join(clone, "ui", "dist", "rt-ui");
  if (!s.probes.exists(bin)) return true;
  const r = await s.probes.exec(["find", join(clone, "ui"), "-type", "f", "-newer", bin, "-not", "-path", `${join(clone, "ui", "dist")}/*`, "-print", "-quit"], { timeoutMs: 15_000 });
  return r.code !== 0 || r.stdout.trim() !== "";
}

export async function runDevUpdate(s: DevSeams, stage: StageRunner): Promise<DevUpdateResult> {
  const clone = s.storedSourcePath();
  if (s.flavor !== "dev" || !clone) {
    throw new UserActionableError("dev-not-set-up", "This Mac isn't set up to run mattstack from a clone", {}, { next: "rt dev setup" });
  }
  const pins = await readPins(s.probes, clone);
  const stages: StageEnding[] = [];
  let bunPath = "";
  let goPath = "";
  stages.push(
    await stage("Check your tools", async (sub) => {
      const t = await ensureTools(s, pins, sub);
      bunPath = t.bunPath;
      goPath = t.goPath;
      return t.ending;
    }),
  );
  stages.push(
    await stage("Rebuild rt's terminal helper", async () => {
      if (!(await rtUiStale(s, clone))) return { status: "skipped", title: "rt's terminal helper is current" };
      const path = `${join(goPath, "..")}:${join(bunPath, "..")}:${s.probes.env.PATH ?? ""}`;
      const r = await s.probes.exec([bunPath, "run", "ui:build"], { cwd: clone, env: { PATH: path }, timeoutMs: 10 * 60_000 });
      if (r.code !== 0) throw new UserActionableError("dev-build-failed", "Building rt's terminal helper failed", {}, { log: r.stderr || r.stdout });
      return { status: "done", title: "Rebuilt rt's terminal helper" };
    }),
  );
  stages.push(await stage("Update the dev app", (sub) => ensureDevApp(s, sub, "update")));
  return { clone, stages };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test lib/dev/__tests__/update.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dev/update.ts lib/dev/__tests__/update.test.ts
git commit -m "feat(dev): rt dev update orchestration"
```

---

### Task 7: The `rt dev` command shell

**Files:**
- Create: `commands/dev.ts`
- Modify: `lib/command-tree-def.ts` (new top-level `dev` branch), `lib/module-registry.ts`, `commands/settings.ts` (export `saveSourcePath`)
- Test: `commands/__tests__/dev.test.ts`
- Regenerate: `bun run docs:gen`

**Interfaces:**
- Consumes: `runDevSetup`, `runDevUpdate`, `DevSeams`, `StageRunner`, `DEV_REFUSAL_CODES`; `createRealProbes` (`lib/setup/probes.ts`); `installDevTool`; `resolveTool` (`lib/deps/resolve.ts`); `getSetting` (`lib/settings/resolve.ts`); `processFlavor`; `devWrapperOwnsRt` (`lib/dev-mode.ts`); `readDevModeConfig`, `saveSourcePath` (`commands/settings.ts`); `rtVersion` (`lib/setup/update.ts`); `openStep`, `settleBackground` (`lib/ui/spawn.ts`); `interactive` (`lib/ui/gate.ts`); `confirm` (`lib/ui/prompts.ts`); `envelope` (`lib/setup/contract.ts`); `exitUserError` (`lib/errors.ts`); `logCliEvent` (`lib/cli-logger.ts`); `withoutUrls` (`lib/team/redact.ts`); `runCapture`, `childEnv` (`lib/subprocess.ts`).
- Produces: `devSetup(args, ctx)`, `devUpdate(args, ctx)` handlers; `function devSetupBlocks(r: DevSetupResult): Block[]` and `function devUpdateBlocks(r: DevUpdateResult): Block[]` (pure, for tests).

- [ ] **Step 1: Write the failing tests**

```ts
// commands/__tests__/dev.test.ts
import { describe, expect, test } from "bun:test";
import { listAgentSafe } from "../../lib/command-tree-resolve.ts";
import { COMMAND_TREE } from "../../lib/command-tree-def.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { devSetupBlocks, devUpdateBlocks } from "../dev.ts";

describe("rt dev", () => {
  test("neither verb is agent-safe", () => {
    expect(listAgentSafe(COMMAND_TREE).some((e) => e.path[0] === "dev")).toBe(false);
  });

  test("the tree has dev setup and dev update with plain descriptions", () => {
    const dev = COMMAND_TREE.dev!;
    expect(Object.keys(dev.subcommands!)).toEqual(["setup", "update"]);
    expect(dev.subcommands!.setup!.description).toBe("Set this Mac up to build mattstack from your own clone");
    expect(dev.subcommands!.update!.description).toBe("Update your tools and dev app");
  });

  test("setup summary names the way back and the Rebuild limit", () => {
    const text = renderPlain(devSetupBlocks({ kind: "done", clone: "/c/mattstack", stages: [{ status: "done", title: "Cloned mattstack" }] }));
    expect(text).toContain("Cloned mattstack");
    expect(text).toContain("open /Applications/mattstack.app");
    expect(text).toContain("Rebuild");
  });

  test("already set up points at update", () => {
    const text = renderPlain(devSetupBlocks({ kind: "already", clone: "/c/mattstack" }));
    expect(text).toContain("rt dev update");
  });

  test("update summary lists each stage", () => {
    const text = renderPlain(devUpdateBlocks({ clone: "/c", stages: [{ status: "skipped", title: "Dev app 2.22.0 is current" }] }));
    expect(text).toContain("Dev app 2.22.0 is current");
  });
});
```

Check the real export names before running: `grep -n "^export" lib/command-tree-def.ts | head` (the tree constant may be named differently from `COMMAND_TREE`) and `grep -n "^export function renderPlain" lib/ui/out-plain.ts`. Use the real names in the test.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test commands/__tests__/dev.test.ts`
Expected: FAIL, cannot resolve `../dev.ts`.

- [ ] **Step 3: Export `saveSourcePath`** in `commands/settings.ts`: change `function saveSourcePath(` to `export function saveSourcePath(`.

- [ ] **Step 4: Add the tree node** in `lib/command-tree-def.ts`, next to the other top-level branches (place it alphabetically near `daemon`):

```ts
  dev: {
    description: "Build mattstack from your own clone",
    subcommands: {
      setup: {
        description: "Set this Mac up to build mattstack from your own clone",
        module: "./commands/dev.ts",
        fn: "devSetup",
        args: [SETUP_JSON_ARG],
      },
      update: {
        description: "Update your tools and dev app",
        module: "./commands/dev.ts",
        fn: "devUpdate",
        args: [SETUP_JSON_ARG],
      },
    },
  },
```

- [ ] **Step 5: Register the module** in `lib/module-registry.ts`, in alphabetical order:

```ts
  "./commands/dev.ts": () => import("../commands/dev.ts"),
```

- [ ] **Step 6: Implement `commands/dev.ts`**

```ts
/**
 * `rt dev setup` and `rt dev update`: the shell around lib/dev. One rt-ui
 * step per stage at a terminal, plain lines off one, and a frozen envelope
 * under --json. Every decision lives in lib/dev.
 */
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CommandContext } from "../lib/command-tree.ts";
import { logCliEvent } from "../lib/cli-logger.ts";
import { resolveTool } from "../lib/deps/resolve.ts";
import { devWrapperOwnsRt } from "../lib/dev-mode.ts";
import type { DevSeams, StageEnding, StageRunner } from "../lib/dev/seams.ts";
import { DEV_REFUSAL_CODES } from "../lib/dev/seams.ts";
import { runDevSetup, type DevSetupResult } from "../lib/dev/setup.ts";
import { runDevUpdate, type DevUpdateResult } from "../lib/dev/update.ts";
import { exitUserError, UserActionableError } from "../lib/errors.ts";
import { processFlavor } from "../lib/flavor.ts";
import { getSetting } from "../lib/settings/resolve.ts";
import { envelope } from "../lib/setup/contract.ts";
import { createRealProbes } from "../lib/setup/probes.ts";
import { installDevTool } from "../lib/setup/tools-install.ts";
import { rtVersion } from "../lib/setup/update.ts";
import { childEnv, runCapture } from "../lib/subprocess.ts";
import { withoutUrls } from "../lib/team/redact.ts";
import { interactive } from "../lib/ui/gate.ts";
import * as out from "../lib/ui/out.ts";
import { confirm } from "../lib/ui/prompts.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { openStep, settleBackground, type StepHandle } from "../lib/ui/spawn.ts";
import { readDevModeConfig, saveSourcePath } from "./settings.ts";

function canPrompt(json: boolean): boolean {
  return !json && !process.env.RT_BATCH && interactive();
}

function realSeams(json: boolean): DevSeams {
  const probes = createRealProbes();
  let scratch: string | null = null;
  return {
    probes,
    swap: {
      exec: (argv, opts) => runCapture(argv, { stderr: "pipe", timeoutMs: 600_000, ...opts, ...(opts?.env ? { env: { ...childEnv(), ...opts.env } } : {}) }),
      sleep: (ms) => Bun.sleep(ms),
    },
    download: async (url, dest) => {
      const r = await runCapture(["curl", "-fsSL", "--retry", "3", "-o", dest, url], { stderr: "pipe", timeoutMs: 30 * 60_000 });
      if (r.exitCode !== 0) throw new UserActionableError("dev-download-failed", "Downloading the dev app failed", {}, { log: r.stderr });
    },
    scratchDir: () => (scratch ??= mkdtempSync(join(tmpdir(), "rt-dev-"))),
    flavor: processFlavor(),
    interactive: canPrompt(json),
    prodVersion: rtVersion(),
    confirm: (message) => confirm({ message, initialValue: true }),
    repoRoot: () => getSetting<string[]>("rt.repoRoots").value?.[0] ?? null,
    storedSourcePath: () => readDevModeConfig().sourcePath ?? null,
    saveSourcePath,
    installDevTool: (tool, version) => installDevTool(probes, tool, version),
    gh: () => resolveTool(probes, "gh").exec ?? null,
    devWrapperOwnsRt,
  };
}

/** One rt-ui step per stage, the shape commands/home.ts uses; endings are collected for --json. */
function stageRunner(json: boolean, endings: StageEnding[]): StageRunner {
  return async (title, task) => {
    let step: StepHandle | null = null;
    if (!json && interactive()) {
      await settleBackground();
      try {
        step = openStep(title);
      } catch {
        step = null;
      }
    }
    const sub = (text: string) => {
      step?.sub(text);
      logCliEvent("debug", "dev", withoutUrls(text));
    };
    let ending: StageEnding;
    try {
      ending = await task(sub);
    } catch (err) {
      if (step) await step.fail(title);
      throw err;
    }
    endings.push(ending);
    if (json) return ending;
    const painted =
      step === null
        ? false
        : ending.status === "failed"
          ? await step.fail(ending.title, ending.hint)
          : await step.done(ending.title, ending.hint, ending.status === "done" ? undefined : ending.status);
    if (!painted) out.print(out.line(ending.status, ending.title, ending.hint));
    return ending;
  };
}

export function devSetupBlocks(r: DevSetupResult): Block[] {
  if (r.kind === "already") {
    return [out.line("skipped", "This Mac already runs mattstack from your clone", r.clone), out.callout("next", out.cmd("rt dev update"))];
  }
  return [
    out.blank(),
    out.line("done", "You're on the dev app, running your clone", r.clone),
    out.callout("tip", "The dev app's Rebuild menu is for tray changes and needs the maintainers' signing certificate."),
    out.callout("next", ["Switch back any time: ", out.cmd("open /Applications/mattstack.app")]),
  ];
}

export function devUpdateBlocks(r: DevUpdateResult): Block[] {
  return [out.blank(), out.line("done", "Your dev setup is up to date", r.clone)];
}

function fail(err: unknown, json: boolean): never {
  if (!(err instanceof UserActionableError)) throw err;
  if (!json && DEV_REFUSAL_CODES.has(err.code)) {
    out.note(out.line("refused", err.message, err.why), ...(err.next ? [out.callout("next", out.cmd(err.next))] : []));
    process.exit(2);
  }
  exitUserError(err, json);
}

export async function devSetup(args: string[], _ctx: CommandContext = {}): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const endings: StageEnding[] = [];
  try {
    const r = await runDevSetup(realSeams(json), stageRunner(json, endings));
    if (json) out.json(envelope({ ok: true, kind: r.kind, clone: r.clone, stages: endings }));
    else out.print(...devSetupBlocks(r));
  } catch (err) {
    fail(err, json);
  }
}

export async function devUpdate(args: string[], _ctx: CommandContext = {}): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const endings: StageEnding[] = [];
  try {
    const r = await runDevUpdate(realSeams(json), stageRunner(json, endings));
    if (json) out.json(envelope({ ok: true, clone: r.clone, stages: endings }));
    else out.print(...devUpdateBlocks(r));
  } catch (err) {
    fail(err, json);
  }
}
```

Before running, confirm each imported name exists: `grep -n "export function blank\|export function cmd\|export const cmd\|export function payloadOnStdout\|export function json" lib/ui/out.ts`, `grep -n "\"tip\"" lib/ui/protocol.ts` (the `CalloutLabel` set; use `"note"` if `"tip"` is not a label), `grep -n "export function exitUserError" lib/errors.ts`. Adjust to the real names; do not add new output primitives.

- [ ] **Step 7: Run the tests, the guards and the docs generator**

Run:
```bash
bun test commands/__tests__/dev.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/agent-safe.test.ts lib/__tests__/picker-conformance.test.ts lib/__tests__/no-eager-tui.test.ts
bun run picker:check
bun run docs:gen
```
Expected: all PASS; `docs:gen` writes the new reference pages.

- [ ] **Step 8: Commit**

```bash
git add commands/dev.ts commands/settings.ts lib/command-tree-def.ts lib/module-registry.ts commands/__tests__/dev.test.ts docs/
git commit -m "feat(dev): rt dev setup and rt dev update commands"
```

---

### Task 8: Publish the dev app from the release flow

**Files:**
- Modify: `rt-tray/build.sh` (MSDevReleaseBuild key)
- Create: `lib/release/dev-publish.ts`
- Modify: `lib/release/update-machine.ts` (`LegId` gains `"dev-publish"`; label, plan description, ordering; `runDevBundleLeg` passes `MS_DEV_RELEASE_BUILD=1` for a release run only)
- Test: `lib/release/__tests__/dev-publish.test.ts`; update `lib/release/__tests__/update-machine.test.ts` for the seventh leg

**Interfaces:**
- Consumes: `AppSwapSeams`, `execTail` (Task 3); `devZipName` (Task 4); `UpdateMachineSeams`, `RELEASE_REPO`.
- Produces:
  - `const NOTARY_PROFILE_DEFAULT = "mattstack-notary"`
  - `function mergeSums(existing: string, fileName: string, sha: string): string`
  - `interface DevPublishInput { bundleDir: string; workDir: string; tag: string; version: string; notaryProfile: string }`
  - `async function publishDevApp(seams: AppSwapSeams, input: DevPublishInput): Promise<{ ok: true; detail: string } | { ok: false; error: string }>`

- [ ] **Step 1: Add the Info.plist key** in `rt-tray/build.sh`, right after the `MS_BUILD_SHA` block (around line 399):

```bash
if [ "$IS_DEV" = true ] && [ "${MS_DEV_RELEASE_BUILD:-0}" = 1 ]; then
    plutil -replace MSDevReleaseBuild -bool true "$INFO"
    echo "  ✓ Marked as a release-built dev app"
fi
```

- [ ] **Step 2: Write the failing tests**

```ts
// lib/release/__tests__/dev-publish.test.ts
import { describe, expect, test } from "bun:test";
import { mergeSums, publishDevApp } from "../dev-publish.ts";

describe("mergeSums", () => {
  test("appends a new line", () => {
    expect(mergeSums("aaa  mattstack-2.22.0.dmg\n", "mattstack-dev-2.22.0.zip", "bbb")).toBe("aaa  mattstack-2.22.0.dmg\nbbb  mattstack-dev-2.22.0.zip\n");
  });
  test("replaces a stale line for the same file", () => {
    expect(mergeSums("old  mattstack-dev-2.22.0.zip\naaa  x\n", "mattstack-dev-2.22.0.zip", "new")).toBe("aaa  x\nnew  mattstack-dev-2.22.0.zip\n");
  });
});

describe("publishDevApp", () => {
  const input = { bundleDir: "/w/rt-dev-bundle", workDir: "/w", tag: "v2.22.0", version: "2.22.0", notaryProfile: "mattstack-notary" };
  function seams(fail?: string) {
    const cmds: string[] = [];
    return {
      cmds,
      s: {
        exec: async (argv: string[], opts?: { env?: Record<string, string> }) => {
          const cmd = argv.join(" ") + (opts?.env?.NOTARY_PROFILE ? ` [NOTARY_PROFILE=${opts.env.NOTARY_PROFILE}]` : "");
          cmds.push(cmd);
          if (fail && cmd.includes(fail)) return { stdout: "", stderr: "nope", exitCode: 1 };
          if (argv[0] === "shasum") return { stdout: "abc  /w/mattstack-dev-2.22.0.zip\n", stderr: "", exitCode: 0 };
          if (argv[0] === "cat") return { stdout: "aaa  mattstack-2.22.0.dmg\n", stderr: "", exitCode: 0 };
          return { stdout: "", stderr: "", exitCode: 0 };
        },
        sleep: async () => {},
      },
    };
  }

  test("checks the profile, notarizes, zips, uploads the zip, then the merged sums", async () => {
    const { s, cmds } = seams();
    const r = await publishDevApp(s as never, input);
    expect(r.ok).toBe(true);
    const order = [
      "xcrun notarytool history --keychain-profile mattstack-notary",
      "scripts/release/notarize.sh rt-tray/mattstack-dev.app [NOTARY_PROFILE=mattstack-notary]",
      "ditto -c -k --keepParent /w/rt-dev-bundle/rt-tray/mattstack-dev.app /w/mattstack-dev-2.22.0.zip",
      "gh release upload v2.22.0 /w/mattstack-dev-2.22.0.zip --repo m4ttstack/mattstack --clobber",
      "gh release upload v2.22.0 /w/sums/SHA256SUMS --repo m4ttstack/mattstack --clobber",
    ];
    let at = -1;
    for (const c of order) {
      const i = cmds.findIndex((x, idx) => idx > at && x.startsWith(c));
      expect(i).toBeGreaterThan(at);
      at = i;
    }
  });

  test("no notary profile stops before notarizing, naming the one-time command", async () => {
    const { s, cmds } = seams("notarytool history");
    const r = await publishDevApp(s as never, input);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain("xcrun notarytool store-credentials mattstack-notary");
    expect(cmds.some((c) => c.includes("notarize.sh"))).toBe(false);
  });

  test("a failed zip upload never touches SHA256SUMS", async () => {
    const { s, cmds } = seams("mattstack-dev-2.22.0.zip --repo");
    const r = await publishDevApp(s as never, input);
    expect(r.ok).toBe(false);
    expect(cmds.some((c) => c.includes("sums/SHA256SUMS --repo"))).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `bun test lib/release/__tests__/dev-publish.test.ts`
Expected: FAIL, cannot resolve `../dev-publish.ts`.

- [ ] **Step 4: Implement `lib/release/dev-publish.ts`**

```ts
/**
 * The dev-publish leg's work: notarize the dev app update-machine just built
 * at the tag, zip it, and attach it and its checksum to the release. Runs on
 * the maintainer's Mac (the signing identity and notary profile live there);
 * GitHub Actions never builds the dev app.
 */
import { join } from "path";
import { execTail, type AppSwapSeams } from "./app-swap.ts";

export const NOTARY_PROFILE_DEFAULT = "mattstack-notary";
const REPO = "m4ttstack/mattstack";

export function mergeSums(existing: string, fileName: string, sha: string): string {
  const kept = existing
    .split("\n")
    .filter((line) => line.trim() !== "" && line.trim().split(/\s+/).at(-1)?.replace(/^\*/, "") !== fileName);
  return [...kept, `${sha}  ${fileName}`].join("\n") + "\n";
}

export interface DevPublishInput { bundleDir: string; workDir: string; tag: string; version: string; notaryProfile: string }

export async function publishDevApp(seams: AppSwapSeams, input: DevPublishInput): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  const app = join(input.bundleDir, "rt-tray", "mattstack-dev.app");
  const zipName = `mattstack-dev-${input.version}.zip`;
  const zip = join(input.workDir, zipName);
  const sumsDir = join(input.workDir, "sums");

  const profile = await seams.exec(["xcrun", "notarytool", "history", "--keychain-profile", input.notaryProfile]);
  if (profile.exitCode !== 0) {
    return { ok: false, error: `no notary profile named ${input.notaryProfile} on this Mac; save one once with: xcrun notarytool store-credentials ${input.notaryProfile}` };
  }

  const notarize = await seams.exec(["scripts/release/notarize.sh", "rt-tray/mattstack-dev.app"], { cwd: input.bundleDir, env: { NOTARY_PROFILE: input.notaryProfile }, timeoutMs: 50 * 60_000 });
  if (notarize.exitCode !== 0) return { ok: false, error: `notarize.sh failed: ${execTail(notarize)}` };

  const zipped = await seams.exec(["ditto", "-c", "-k", "--keepParent", app, zip]);
  if (zipped.exitCode !== 0) return { ok: false, error: `zipping the dev app failed: ${execTail(zipped)}` };

  const sum = await seams.exec(["shasum", "-a", "256", zip]);
  const sha = sum.stdout.trim().split(/\s+/)[0];
  if (sum.exitCode !== 0 || !sha) return { ok: false, error: `shasum failed: ${execTail(sum)}` };

  const fetchSums = await seams.exec(["gh", "release", "download", input.tag, "--repo", REPO, "--pattern", "SHA256SUMS", "--dir", sumsDir, "--clobber"]);
  if (fetchSums.exitCode !== 0) return { ok: false, error: `downloading SHA256SUMS failed: ${execTail(fetchSums)}` };
  const current = await seams.exec(["cat", join(sumsDir, "SHA256SUMS")]);
  if (current.exitCode !== 0) return { ok: false, error: `reading SHA256SUMS failed: ${execTail(current)}` };
  const merged = mergeSums(current.stdout, zipName, sha);

  const uploadZip = await seams.exec(["gh", "release", "upload", input.tag, zip, "--repo", REPO, "--clobber"]);
  if (uploadZip.exitCode !== 0) return { ok: false, error: `uploading ${zipName} failed: ${execTail(uploadZip)}` };

  await Bun.write(join(sumsDir, "SHA256SUMS"), merged);
  const uploadSums = await seams.exec(["gh", "release", "upload", input.tag, join(sumsDir, "SHA256SUMS"), "--repo", REPO, "--clobber"]);
  if (uploadSums.exitCode !== 0) return { ok: false, error: `${zipName} is attached, but uploading the updated SHA256SUMS failed: ${execTail(uploadSums)}` };

  return { ok: true, detail: `${zipName} notarized and attached to ${input.tag}` };
}
```

`Bun.write` writes a real file even under test; in the test, `workDir` is `/w`, which does not exist. Route the write through the seam instead so tests stay off disk: add `writeFile(path: string, content: string): Promise<void>` to a `DevPublishSeams = AppSwapSeams & { writeFile(...) }` type, use it here, give the test seam a recording `writeFile`, and wire the real one in Step 5 as `(path, content) => Bun.write(path, content).then(() => {})` after `mkdir -p` of `sumsDir` via `seams.exec(["mkdir", "-p", sumsDir])`. Assert in the test that the written content equals `mergeSums("aaa  mattstack-2.22.0.dmg\n", "mattstack-dev-2.22.0.zip", "abc")`.

- [ ] **Step 5: Wire the leg into update-machine**

In `lib/release/update-machine.ts`:

1. `export type LegId = "prod-app" | "dev-bundle" | "dev-publish" | "checkout-sync" | "daemon" | "served-suite" | "verify";`
2. `const DEV_PUBLISH_LABEL = "dev app publish";`
3. `UpdateMachineSeams` gains `writeFile(path: string, content: string): Promise<void>` (real seam in `commands/release.ts`: `(path, content) => Bun.write(path, content).then(() => {})`), and the dev-bundle build passes the release flag. Change the signature to `runDevBundleLeg(seams, ctx, onNotRunning = () => {}, release = false)` and the build call to:

```ts
  const build = await seams.exec(["rt-tray/build.sh", "dev"], { cwd: bundleDir, ...(release ? { env: { MS_DEV_RELEASE_BUILD: "1" } } : {}) });
```

`runUpdateMachine` calls it with `release = true`; `runDevAppRebuild` keeps the default `false`.

4. After the dev-bundle `runGatedLeg`, add:

```ts
  await runGatedLeg("dev-publish", DEV_PUBLISH_LABEL, async () => {
    const devLeg = legs.find((l) => l.id === "dev-bundle");
    if (devLeg?.status !== "ok") return skippedLeg("dev-publish", DEV_PUBLISH_LABEL, "Not run: the dev app was not built in this run");
    const r = await publishDevApp(seams, {
      bundleDir: `${seams.workDir}/rt-dev-bundle`,
      workDir: seams.workDir,
      tag: ctx.tag,
      version: ctx.ver,
      notaryProfile: process.env.NOTARY_PROFILE || NOTARY_PROFILE_DEFAULT,
    });
    return r.ok ? okLeg("dev-publish", DEV_PUBLISH_LABEL, r.detail) : errorLeg("dev-publish", DEV_PUBLISH_LABEL, r.error);
  });
```

5. Add `"dev-publish"` to the `--plan` id list (after `"dev-bundle"`), its label to the label map, and to `describePlannedLeg`:

```ts
    case "dev-publish":
      return `Notarize that dev app, zip it, and attach it and its checksum to the ${tag} release`;
```

- [ ] **Step 6: Update the update-machine tests**

In `lib/release/__tests__/update-machine.test.ts`: the fake seam handles `xcrun notarytool history`, `scripts/release/notarize.sh`, `ditto -c`, `shasum`, `gh release download`, `cat .../SHA256SUMS`, `gh release upload` (all exit 0, `shasum` printing `abc  <path>`), plus a recording `writeFile`. Change the "runs all six legs" test to seven legs with `dev-publish` second-after `dev-bundle`, and the `--plan` test's id list. Add:

```ts
  test("dev publish: skipped when the dev bundle leg did not build", async () => {
    // build the seams with buildExit: 1 (existing option), run with yes: true
    // expect the dev-publish leg status "skipped" (halted runs report "Not run: the run stopped at dev bundle rebuild")
  });
  test("dev publish: the release build passes MS_DEV_RELEASE_BUILD=1 and a ref rebuild does not", async () => {
    // assert the exec opts for "rt-tray/build.sh dev" carry env MS_DEV_RELEASE_BUILD=1 under runUpdateMachine
    // and carry no env under runDevAppRebuild
  });
```

Write both tests out in full against the harness's real option names (`buildExit`, the exec recorder); the fake's exec must record `opts` alongside argv for the second test.

- [ ] **Step 7: Run**

Run: `bun test lib/release/__tests__/dev-publish.test.ts lib/release/__tests__/update-machine.test.ts lib/release/__tests__/app-swap.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add rt-tray/build.sh lib/release/dev-publish.ts lib/release/update-machine.ts commands/release.ts lib/release/__tests__/
git commit -m "feat(release): publish the notarized dev app from update-machine"
```

---

### Task 9: Rebuild refuses without the signing certificate

**Files:**
- Create: `lib/release/signing-identity.ts`
- Modify: `scripts/build-dev-app.ts`
- Test: `lib/release/__tests__/signing-identity.test.ts`

**Interfaces:**
- Consumes: `RunResult`; `notify` from `lib/notifier.ts`.
- Produces:
  - `const REBUILD_NEEDS_CERT: string` (the Global Constraints copy, verbatim)
  - `async function hasDeveloperIdIdentity(exec: (argv: [string, ...string[]]) => Promise<RunResult>): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

```ts
// lib/release/__tests__/signing-identity.test.ts
import { describe, expect, test } from "bun:test";
import { hasDeveloperIdIdentity, REBUILD_NEEDS_CERT } from "../signing-identity.ts";

const run = (stdout: string, exitCode = 0) => async () => ({ stdout, stderr: "", exitCode });

describe("hasDeveloperIdIdentity", () => {
  test("true when a Developer ID Application identity is listed", async () => {
    expect(await hasDeveloperIdIdentity(run('  1) ABC "Developer ID Application: Someone (TEAM)"\n     1 valid identities found\n'))).toBe(true);
  });
  test("false with only an Apple Development identity", async () => {
    expect(await hasDeveloperIdIdentity(run('  1) ABC "Apple Development: someone@x (TEAM)"\n'))).toBe(false);
  });
  test("false when security fails", async () => {
    expect(await hasDeveloperIdIdentity(run("", 1))).toBe(false);
  });
  test("the copy names no person", () => {
    expect(REBUILD_NEEDS_CERT).toBe(
      "Rebuilding the dev app needs the maintainers' signing certificate. You only need it for tray changes: your rt, app and skill changes already run from your clone.",
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/release/__tests__/signing-identity.test.ts`
Expected: FAIL, cannot resolve `../signing-identity.ts`.

- [ ] **Step 3: Implement `lib/release/signing-identity.ts`**

```ts
import type { RunResult } from "../subprocess.ts";

export const REBUILD_NEEDS_CERT =
  "Rebuilding the dev app needs the maintainers' signing certificate. You only need it for tray changes: your rt, app and skill changes already run from your clone.";

/** The same check rt-tray/build.sh makes before it signs; without one, a build is signed ad hoc and resets macOS permissions. */
export async function hasDeveloperIdIdentity(exec: (argv: [string, ...string[]]) => Promise<RunResult>): Promise<boolean> {
  const r = await exec(["security", "find-identity", "-v", "-p", "codesigning"]);
  return r.exitCode === 0 && r.stdout.includes("Developer ID Application");
}
```

- [ ] **Step 4: Guard `scripts/build-dev-app.ts`**

After `parsed` is validated and before the `if (parsed.local)` block, add:

```ts
if (parsed.yes && !(await hasDeveloperIdIdentity((argv) => runCapture(argv, { stderr: "pipe", timeoutMs: 30_000 })))) {
  console.error(`✗ ${REBUILD_NEEDS_CERT}`);
  notify("Dev app not rebuilt", REBUILD_NEEDS_CERT, undefined, "general", undefined, "dev-app-rebuild-needs-cert");
  process.exit(1);
}
```

with imports:

```ts
import { notify } from "../lib/notifier.ts";
import { hasDeveloperIdIdentity, REBUILD_NEEDS_CERT } from "../lib/release/signing-identity.ts";
```

The tray streams this script's stdout and stderr into `~/.mattstack/rt/logs/dev-app-build.log`, so the `console.error` line lands there; `notify` queues it, pushes it to the tray socket, and falls back to osascript.

- [ ] **Step 5: Verify by hand under an isolated HOME** (no identity can be faked away on this Mac, so check the refusal path with a stub `security` on PATH):

```bash
mkdir -p "$TMPDIR/rt-nocert/bin" && printf '#!/bin/sh\necho "0 valid identities found"\n' > "$TMPDIR/rt-nocert/bin/security" && chmod +x "$TMPDIR/rt-nocert/bin/security"
env -i HOME="$TMPDIR/rt-nocert" PATH="$TMPDIR/rt-nocert/bin:/usr/bin:/bin" "$HOME/.bun/bin/bun" scripts/build-dev-app.ts --local --yes; echo "exit $?"
```

Expected: prints `✗ Rebuilding the dev app needs the maintainers' signing certificate...`, `exit 1`, and no scratch build starts.

- [ ] **Step 6: Run the test and commit**

Run: `bun test lib/release/__tests__/signing-identity.test.ts`
Expected: PASS.

```bash
git add lib/release/signing-identity.ts lib/release/__tests__/signing-identity.test.ts scripts/build-dev-app.ts
git commit -m "feat(dev-app): refuse a rebuild without the signing certificate"
```

---

### Task 10: Launch-time notice for a newer dev app

**Files:**
- Create: `lib/dev/notice.ts`
- Modify: `commands/setup.ts` (`setupUpdate`), and `ApplyDeps` wherever it is declared (`grep -n "interface ApplyDeps" -r commands lib`)
- Test: `lib/dev/__tests__/notice.test.ts`; extend the existing `setupUpdate` tests (`grep -rln "setupUpdate" commands/__tests__`)

**Interfaces:**
- Consumes: `readInstalledDevApp`, `listDevReleases` (Task 4); `compareVersions` (Task 1); `Flavor`; `SETUP_UPDATE_CATEGORY`.
- Produces:
  - `interface DevAppNotice { id: string; title: string; message: string }`
  - `async function devAppNotice(s: { probes: Probes; flavor: Flavor; gh(): string[] | null }): Promise<DevAppNotice | null>`
  - `ApplyDeps.devAppNotice?: () => Promise<DevAppNotice | null>`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/dev/__tests__/notice.test.ts
import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { devAppNotice } from "../notice.ts";

function probes(installed: string | null, releaseBuild: boolean, latest: string) {
  const files: Record<string, string> = installed ? { "/Applications/mattstack-dev.app/Contents/Info.plist": "" } : {};
  return fakeProbes({
    files,
    exec: (argv) => {
      const a = argv.join(" ");
      if (a.includes("CFBundleShortVersionString")) return { code: 0, stdout: `${installed}\n`, stderr: "" };
      if (a.includes("MSDevReleaseBuild")) return releaseBuild ? { code: 0, stdout: "true\n", stderr: "" } : { code: 1, stdout: "", stderr: "" };
      if (a.includes("releases")) {
        return { code: 0, stderr: "", stdout: JSON.stringify([{ tag_name: `v${latest}`, draft: false, prerelease: false, assets: [{ name: `mattstack-dev-${latest}.zip`, browser_download_url: "u" }, { name: "SHA256SUMS", browser_download_url: "s" }] }]) };
      }
      return { code: 1, stdout: "", stderr: "" };
    },
  });
}

describe("devAppNotice", () => {
  test("a release-built dev app behind the newest release gets a notice naming rt dev update", async () => {
    const n = await devAppNotice({ probes: probes("2.22.0", true, "2.23.0"), flavor: "dev", gh: () => ["gh"] });
    expect(n).toEqual({ id: "dev_app:2.23.0", title: "A newer dev app is ready", message: "mattstack-dev 2.23.0 is out. Run rt dev update to install it." });
  });
  test("current: no notice", async () => {
    expect(await devAppNotice({ probes: probes("2.23.0", true, "2.23.0"), flavor: "dev", gh: () => ["gh"] })).toBeNull();
  });
  test("a locally built dev app: no notice", async () => {
    expect(await devAppNotice({ probes: probes("2.22.0", false, "2.23.0"), flavor: "dev", gh: () => ["gh"] })).toBeNull();
  });
  test("prod: no notice and no network", async () => {
    const p = probes("2.22.0", true, "2.23.0");
    expect(await devAppNotice({ probes: p, flavor: "prod", gh: () => ["gh"] })).toBeNull();
    expect(p.calls.exec).toEqual([]);
  });
  test("GitHub unreachable: no notice, no throw", async () => {
    const p = fakeProbes({ files: { "/Applications/mattstack-dev.app/Contents/Info.plist": "" }, exec: (argv) => (argv.join(" ").includes("Short") ? { code: 0, stdout: "2.22.0", stderr: "" } : argv.join(" ").includes("MSDev") ? { code: 0, stdout: "true", stderr: "" } : { code: 1, stdout: "", stderr: "offline" }) });
    expect(await devAppNotice({ probes: p, flavor: "dev", gh: () => ["gh"] })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/dev/__tests__/notice.test.ts`
Expected: FAIL, cannot resolve `../notice.ts`.

- [ ] **Step 3: Implement `lib/dev/notice.ts`**

```ts
import type { Flavor } from "../flavor.ts";
import type { Probes } from "../setup/probes.ts";
import { listDevReleases, readInstalledDevApp } from "./dev-app.ts";
import { compareVersions } from "./tools.ts";

export interface DevAppNotice { id: string; title: string; message: string }

/** Only a release-built dev app is told about updates: a locally built one is the maintainer's and follows main. */
export async function devAppNotice(s: { probes: Probes; flavor: Flavor; gh(): string[] | null }): Promise<DevAppNotice | null> {
  if (s.flavor !== "dev") return null;
  const installed = await readInstalledDevApp(s.probes);
  if (!installed?.releaseBuild) return null;
  const gh = s.gh();
  if (!gh) return null;
  let newest: string | undefined;
  try {
    newest = (await listDevReleases(s.probes, gh))[0]?.version;
  } catch {
    return null;
  }
  if (!newest || compareVersions(newest, installed.version) <= 0) return null;
  return { id: `dev_app:${newest}`, title: "A newer dev app is ready", message: `mattstack-dev ${newest} is out. Run rt dev update to install it.` };
}
```

- [ ] **Step 4: Wire into `setupUpdate`**

Add `devAppNotice?: () => Promise<DevAppNotice | null>` to `ApplyDeps`. In the real deps factory (`realApplyDeps`), set:

```ts
devAppNotice: () => devAppNotice({ probes, flavor: processFlavor(), gh: () => resolveTool(probes, "gh").exec ?? null }),
```

(using that factory's own probes instance). In `setupUpdate`, right after the existing `if (notification) (deps.notify ?? ...)(...)` line, add:

```ts
    const devNotice = await (deps.devAppNotice?.() ?? Promise.resolve(null)).catch(() => null);
    if (devNotice) (deps.notify ?? (() => {}))(SETUP_UPDATE_CATEGORY, devNotice.title, devNotice.message, devNotice.id);
```

It does not change `needsAttention` or the exit code.

Add a test beside the existing `setupUpdate` tests: deps with `devAppNotice: async () => ({ id: "dev_app:2.23.0", title: "t", message: "m" })` and a recording `notify`; assert `notify` was called with `("setup_update", "t", "m", "dev_app:2.23.0")` and the run did not exit 2. Copy the surrounding tests' deps builder rather than writing a new one.

- [ ] **Step 5: Run and commit**

Run: `bun test lib/dev/__tests__/notice.test.ts <the setupUpdate test file>`
Expected: PASS.

```bash
git add lib/dev/notice.ts lib/dev/__tests__/notice.test.ts commands/setup.ts <ApplyDeps file> <setupUpdate test file>
git commit -m "feat(dev): tell a collaborator when a newer dev app is out"
```

---

### Task 11: Release skill and docs

**Files:**
- Modify: `skills/rt-release/publish-and-finish.md` (the update-machine gate's leg list)
- Modify: `docs/development.md` ("Two apps" section)
- Modify: `AGENTS.md` ("Getting a change into the running dev app" gains one sentence)

**Interfaces:** none (prose).

- [ ] **Step 1: Load the writing-skills skill** (`superpowers:writing-skills`) before touching the skill file. Follow its process for a small contract change: state the RED baseline (an agent reading today's gate would tell Matt there are six legs and never mention the notary profile), make the edit, and check it reads GREEN.

- [ ] **Step 2: Edit the gate's leg list** in `skills/rt-release/publish-and-finish.md`. After the **Dev bundle** bullet, add:

```markdown
- **Dev app publish**: notarizes the dev app the previous leg built, zips it as
  `mattstack-dev-<version>.zip`, and attaches it and its line in `SHA256SUMS` to the release, so
  collaborators' `rt dev setup` and `rt dev update` can install it. It needs a saved notary profile
  (`NOTARY_PROFILE`, default `mattstack-notary`); without one the leg stops and names the one-time
  `xcrun notarytool store-credentials` command. It is skipped when the dev bundle leg did not build.
```

Also change "the dev app replace, and the daemon restart" in the paragraph above the list to "the dev app replace, the dev app upload to the release, and the daemon restart".

- [ ] **Step 3: Run the skills checks**

Run: `bun cli.ts skills check --strict` (if this skill is not covered by that check, run whatever `skills/` lint the repo's `checks.yml` runs: `grep -n "skills" .github/workflows/checks.yml`).
Expected: PASS.

- [ ] **Step 4: Edit `docs/development.md`**, at the end of "Two apps: mattstack.app and mattstack-dev.app":

```markdown
A collaborator with push access to `m4ttstack/mattstack` gets the dev app with
`rt dev setup`, run from mattstack.app: it checks git, bun and Go (offering to
install them), clones the repo into the repo root, builds it, points rt at the
clone, installs the notarized dev app from the newest release that has one,
switches the Mac over and registers the apps with deck from the clone.
`rt dev update` keeps the tools, rt-ui and the dev app current. The tray's
Rebuild menu needs the maintainers' signing certificate and refuses without it.
```

- [ ] **Step 5: Edit `AGENTS.md`**: in "Getting a change into the running dev app", after the tray rebuild bullet, add one sentence: "A collaborator's dev app comes from the release (`rt dev setup`, `rt dev update`); the `dev-publish` leg of `rt release update-machine` attaches it on the maintainer's Mac."

- [ ] **Step 6: Commit**

```bash
git add skills/rt-release/publish-and-finish.md docs/development.md AGENTS.md
git commit -m "docs: rt dev setup, the dev-publish leg and the Rebuild limit"
```

---

### Task 12: Isolated-HOME smoke run

**Files:** none (verification only).

- [ ] **Step 1: Run setup under an isolated HOME up to the access stage**

```bash
SMOKE="$(mktemp -d)"
env -i HOME="$SMOKE" PATH="/usr/bin:/bin" RT_BATCH=1 "$HOME/.bun/bin/bun" cli.ts dev setup --json; echo "exit $?"
```

Expected: exit 2 with a JSON error envelope whose code is one of `dev-no-repo-root`, `dev-tool-missing` or `dev-pins-unreadable` (whichever stage this empty HOME hits first), and nothing written outside `$SMOKE`. Check: `ls -A "$SMOKE"` shows at most rt's own `.mattstack` log files.

- [ ] **Step 2: Same run, human output**

```bash
env -i HOME="$SMOKE" PATH="/usr/bin:/bin" TERM=xterm-256color "$HOME/.bun/bin/bun" cli.ts dev setup; echo "exit $?"
```

Expected: one failure or refused block on stderr that reads in plain words and carries a `next` line.

- [ ] **Step 3: Report**

Write down what each run printed, verbatim, for the branch's PR description. The first full end-to-end run is the first collaborator's Mac; say so in the PR.
