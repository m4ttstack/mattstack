import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ApplyContext } from "../apply.ts";
import { finalizePlan } from "../contract.ts";
import { applyExpectations } from "../expectations.ts";
import type { ExecResult, Probes } from "../probes.ts";
import { readSetupState } from "../state.ts";
import { NERD_FONT_ARCHIVE } from "../tools-install.ts";
import { runEditorFont } from "../steps/editor-font.ts";
import { editorFontRow } from "../validators/tools.ts";
import { realFsProbes } from "./fakes.ts";

const NERD = "'JetBrainsMonoNL Nerd Font'";

let root: string;
let home: string;
let apps: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-editor-font-step-")));
  home = join(root, "home");
  apps = join(home, "Applications");
  mkdirSync(home);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Real filesystem probes that answer only under the temp root, so /Applications and /Library/Fonts read as empty. */
function confined(exec?: (argv: string[]) => ExecResult): Probes {
  const base = realFsProbes(home);
  const inside = (path: string) => path.startsWith(`${root}/`);
  const run = async (argv: string[]) => exec?.(argv) ?? { code: 0, stdout: "", stderr: "" };
  return {
    ...base,
    env: { ...base.env, TMPDIR: join(root, "tmp") },
    exists: (path) => inside(path) && base.exists(path),
    readDir: (path) => (inside(path) ? base.readDir(path) : []),
    readFile: (path) => (inside(path) ? base.readFile(path) : null),
    statPath: (path) => (inside(path) ? base.statPath(path) : null),
    exec: run,
    execStreaming: run,
  };
}

function install(app: string, cli: string): void {
  const bin = join(apps, app, "Contents", "Resources", "app", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, cli), "");
}
const settingsPath = (dir: string) => join(home, "Library", "Application Support", dir, "User", "settings.json");
function seed(dir: string, text: string): string {
  const path = settingsPath(dir);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  return path;
}
function placeFont(): void {
  const fonts = join(home, "Library", "Fonts");
  mkdirSync(fonts, { recursive: true });
  writeFileSync(join(fonts, "JetBrainsMonoNLNerdFont-Regular.ttf"), "");
}

function makeCtx(p: Probes, overrides: Partial<ApplyContext> = {}): { ctx: ApplyContext; logs: string[] } {
  const logs: string[] = [];
  const ctx = {
    p,
    emit: () => {},
    log: (_id: string, line: string) => logs.push(line),
    redact: () => {},
    ...overrides,
  } as unknown as ApplyContext;
  return { ctx, logs };
}

const fetchFails = (argv: string[]): ExecResult | undefined => (argv[0] === "curl" ? { code: 6, stdout: "", stderr: "curl: (6) Could not resolve host" } : undefined);

describe("editor.terminal-font step", () => {
  test("a full run with no font installs it and writes both editors", async () => {
    install("Visual Studio Code.app", "code");
    install("Cursor.app", "cursor");
    const code = seed("Code", `{\n  "terminal.integrated.fontFamily": "Fira Code"\n}\n`);
    const calls: string[][] = [];
    // Stands in for curl, shasum, tar and cp: the archive "unpacks" one font file and cp lands it in ~/Library/Fonts.
    const p = confined((argv) => {
      calls.push(argv);
      if (argv[0] === "shasum") return { code: 0, stdout: `${NERD_FONT_ARCHIVE.sha256}  ${argv[3]}\n`, stderr: "" };
      if (argv[0] === "tar") writeFileSync(join(argv[argv.length - 1]!, "JetBrainsMonoNLNerdFont-Regular.ttf"), "");
      if (argv[0] === "cp") placeFont();
      return { code: 0, stdout: "", stderr: "" };
    });
    const outcome = await runEditorFont(makeCtx(p).ctx, [apps]);
    expect(calls.some((a) => a[0] === "curl")).toBe(true);
    expect(outcome).toEqual({ state: "done", detail: "Added the Nerd Font to the terminal in VS Code and Cursor" });
    expect(readFileSync(code, "utf8")).toContain(`"Fira Code, ${NERD}"`);
    expect(readFileSync(settingsPath("Cursor"), "utf8")).toContain(NERD);
  });

  test("a full run with the font present writes both editors and records what it wrote", async () => {
    install("Visual Studio Code.app", "code");
    install("Cursor.app", "cursor");
    placeFont();
    const code = seed("Code", `{\n  // mine\n  "terminal.integrated.fontFamily": "Fira Code"\n}\n`);
    const calls: string[][] = [];
    const { ctx } = makeCtx(confined((argv) => (calls.push(argv), { code: 0, stdout: "", stderr: "" })));
    const outcome = await runEditorFont(ctx, [apps]);
    expect(outcome).toEqual({ state: "done", detail: "Added the Nerd Font to the terminal in VS Code and Cursor" });
    expect(calls.some((a) => a[0] === "curl")).toBe(false);
    expect(readFileSync(code, "utf8")).toBe(`{\n  // mine\n  "terminal.integrated.fontFamily": "Fira Code, ${NERD}"\n}\n`);
    expect(JSON.parse(readFileSync(settingsPath("Cursor"), "utf8"))["terminal.integrated.fontFamily"]).toBe(`Menlo, Monaco, 'Courier New', monospace, ${NERD}`);
    expect(readSetupState(confined()).editorFontWritten).toEqual({
      [code]: `Fira Code, ${NERD}`,
      [settingsPath("Cursor")]: `Menlo, Monaco, 'Courier New', monospace, ${NERD}`,
    });
  });

  test("a full run whose font download fails edits no editor and names the retry", async () => {
    install("Visual Studio Code.app", "code");
    const code = seed("Code", `{}\n`);
    const { ctx } = makeCtx(confined(fetchFails as (argv: string[]) => ExecResult));
    const outcome = await runEditorFont(ctx, [apps]);
    expect(outcome.state).toBe("failed");
    expect(outcome).toMatchObject({ remedy: expect.stringContaining("rt setup apply --only editor.terminal-font") });
    expect(readFileSync(code, "utf8")).toBe(`{}\n`);
  });

  test("an update run whose font download fails is skipped and writes nothing", async () => {
    install("Visual Studio Code.app", "code");
    const code = seed("Code", `{}\n`);
    const { ctx } = makeCtx(confined(fetchFails as (argv: string[]) => ExecResult), { update: true });
    const outcome = await runEditorFont(ctx, [apps]);
    expect(outcome.state).toBe("skipped");
    expect(outcome.detail).toContain("Downloading the font failed");
    expect(readFileSync(code, "utf8")).toBe(`{}\n`);
    expect(readSetupState(confined()).editorFontWritten).toBeUndefined();
  });

  test("an undo sticks: a second update run leaves the editor the member changed byte-identical", async () => {
    install("Visual Studio Code.app", "code");
    install("Cursor.app", "cursor");
    placeFont();
    await runEditorFont(makeCtx(confined(), { update: true }).ctx, [apps]);
    const undone = `{\n    "terminal.integrated.fontFamily": "Fira Code"\n}\n`;
    writeFileSync(settingsPath("Cursor"), undone);
    const codeBefore = readFileSync(settingsPath("Code"), "utf8");

    const outcome = await runEditorFont(makeCtx(confined(), { update: true }).ctx, [apps]);
    expect(outcome.state).toBe("done");
    expect(readFileSync(settingsPath("Cursor"), "utf8")).toBe(undone);
    expect(readFileSync(settingsPath("Code"), "utf8")).toBe(codeBefore);
  });

  test("no supported editor installed is skipped", async () => {
    const outcome = await runEditorFont(makeCtx(confined()).ctx, [apps]);
    expect(outcome).toEqual({ state: "skipped", detail: "No supported editor is installed" });
  });

  test("an editor whose write fails makes the step partial and names it", async () => {
    install("Visual Studio Code.app", "code");
    install("Cursor.app", "cursor");
    placeFont();
    const base = confined();
    const p: Probes = { ...base, rename: (from, to) => (to === settingsPath("Cursor") ? (() => { throw new Error("EACCES: permission denied"); })() : base.rename(from, to)) };
    const outcome = await runEditorFont(makeCtx(p).ctx, [apps]);
    expect(outcome.state).toBe("partial");
    expect(outcome.detail).toContain("Added the Nerd Font to the terminal in VS Code");
    expect(outcome.detail).toContain("Could not update Cursor (Cursor: EACCES: permission denied)");
  });
});

describe("editor.terminal-font row", () => {
  test("missing with the run action before the step, ready after", async () => {
    install("Visual Studio Code.app", "code");
    placeFont();
    const before = editorFontRow(confined(), [apps]);
    expect(before).toMatchObject({
      id: "editor.terminal-font",
      status: "missing",
      required: false,
      recheck: "on-activate",
      action: { type: "run", verb: ["setup", "apply", "--only", "editor.terminal-font"] },
    });
    await runEditorFont(makeCtx(confined()).ctx, [apps]);
    expect(editorFontRow(confined(), [apps])).toMatchObject({ status: "ready", action: null, required: false });
  });

  test("skipped with no supported editor", () => {
    expect(editorFontRow(confined(), [apps])).toMatchObject({ status: "skipped", required: false });
  });

  test("a member undo still reads ready", async () => {
    install("Visual Studio Code.app", "code");
    placeFont();
    await runEditorFont(makeCtx(confined()).ctx, [apps]);
    writeFileSync(settingsPath("Code"), `{ "terminal.integrated.fontFamily": "Fira Code" }`);
    expect(editorFontRow(confined(), [apps]).status).toBe("ready");
  });

  test("an unreadable settings file reads ready and names the editor", () => {
    install("Cursor.app", "cursor");
    seed("Cursor", "{ not json");
    const r = editorFontRow(confined(), [apps]);
    expect(r.status).toBe("ready");
    expect(r.detail).toContain("Cursor");
  });

  test("missing never blocks Install or Finish after expectations", () => {
    install("Visual Studio Code.app", "code");
    const groups = applyExpectations([{ id: "agents", title: "Agents and editors", rows: [editorFontRow(confined(), [apps])] }]);
    const out = groups[0]!.rows[0]!;
    expect(out).toMatchObject({ status: "missing", required: false, action: { type: "run" } });
    expect(out.finishGated).toBeUndefined();
    const plan = finalizePlan({ slug: "", name: "", mode: "none" } as never, groups);
    expect(plan.canInstall).toBe(true);
    expect(plan.finishBlockedBy).toEqual([]);
  });
});
