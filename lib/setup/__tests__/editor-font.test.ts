import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  applyEditorFonts,
  EDITOR_DEFAULT_FONT,
  type EditorFontResult,
  hasNerdFont,
  installNerdFont,
  nerdFontInstalled,
  nextTerminalFont,
  planEditorFonts,
} from "../editor-font";
import { createRealProbes, type Probes } from "../probes";
import { NERD_FONT_ARCHIVE, type NerdFontArchive } from "../tools-install";
import { fakeProbes, realFsProbes } from "./fakes";

const NERD = "'JetBrainsMonoNL Nerd Font'";

describe("hasNerdFont", () => {
  test("true for Nerd Font and NF families", () => {
    expect(hasNerdFont("JetBrainsMonoNL Nerd Font")).toBe(true);
    expect(hasNerdFont("Hack Nerd Font Mono")).toBe(true);
    expect(hasNerdFont("FiraCode NF")).toBe(true);
    expect(hasNerdFont("Menlo, 'hack nerd font'")).toBe(true);
  });
  test("false otherwise", () => {
    expect(hasNerdFont("Fira Code, Menlo")).toBe(false);
  });
});

describe("nextTerminalFont", () => {
  test("appends to a set font", () => {
    expect(nextTerminalFont({ terminal: "Fira Code", editor: undefined, lastWritten: undefined })).toEqual({
      action: "write",
      value: `Fira Code, ${NERD}`,
      reason: "appended",
    });
  });
  test("seeds from the editor font", () => {
    expect(nextTerminalFont({ terminal: undefined, editor: "SF Mono", lastWritten: undefined })).toEqual({
      action: "write",
      value: `SF Mono, ${NERD}`,
      reason: "seeded",
    });
  });
  test("seeds from the editor default", () => {
    expect(nextTerminalFont({ terminal: undefined, editor: undefined, lastWritten: undefined })).toEqual({
      action: "write",
      value: `Menlo, Monaco, 'Courier New', monospace, ${NERD}`,
      reason: "seeded",
    });
  });
  test("an empty terminal seeds from the editor", () => {
    expect(nextTerminalFont({ terminal: "", editor: "SF Mono", lastWritten: undefined })).toEqual({
      action: "write",
      value: `SF Mono, ${NERD}`,
      reason: "seeded",
    });
  });
  test("a whitespace terminal with an empty editor seeds from the default", () => {
    expect(nextTerminalFont({ terminal: "   ", editor: " ", lastWritten: undefined })).toEqual({
      action: "write",
      value: `Menlo, Monaco, 'Courier New', monospace, ${NERD}`,
      reason: "seeded",
    });
  });
  test("strips a trailing comma from the base", () => {
    expect(nextTerminalFont({ terminal: "Fira Code,", editor: undefined, lastWritten: undefined }).value).toBe(
      `Fira Code, ${NERD}`,
    );
  });
  test("trims surrounding whitespace", () => {
    expect(nextTerminalFont({ terminal: "  Fira Code  ", editor: undefined, lastWritten: undefined }).value).toBe(
      `Fira Code, ${NERD}`,
    );
  });
  test("a quoted mixed-case NF family counts as Nerd", () => {
    expect(nextTerminalFont({ terminal: "'FiraCode NF'", editor: undefined, lastWritten: undefined })).toEqual({
      action: "keep",
      reason: "has-nerd",
    });
  });
  test("keeps a font that already has a Nerd Font", () => {
    expect(nextTerminalFont({ terminal: "Hack Nerd Font", editor: undefined, lastWritten: undefined })).toEqual({
      action: "keep",
      reason: "has-nerd",
    });
  });
  test("keeps when the member changed what rt wrote", () => {
    expect(nextTerminalFont({ terminal: "Fira Code", editor: undefined, lastWritten: `Menlo, ${NERD}` })).toEqual({
      action: "keep",
      reason: "member-undid",
    });
  });
  test("keeps when the member deleted the key rt wrote", () => {
    expect(nextTerminalFont({ terminal: undefined, editor: "SF Mono", lastWritten: `Menlo, ${NERD}` })).toEqual({
      action: "keep",
      reason: "member-undid",
    });
  });
  test("an unset terminal inheriting a Nerd Font editor font is kept", () => {
    expect(nextTerminalFont({ terminal: undefined, editor: "Hack Nerd Font Mono", lastWritten: undefined })).toEqual({
      action: "keep",
      reason: "has-nerd",
    });
    expect(nextTerminalFont({ terminal: " ", editor: "Menlo, 'FiraCode NF'", lastWritten: undefined })).toEqual({
      action: "keep",
      reason: "has-nerd",
    });
  });
  test("keeps the value rt wrote", () => {
    const written = `Menlo, ${NERD}`;
    expect(nextTerminalFont({ terminal: written, editor: undefined, lastWritten: written })).toEqual({
      action: "keep",
      reason: "has-nerd",
    });
  });
});

describe("nerdFontInstalled", () => {
  test("true only when a JetBrainsMonoNLNerdFont-*.ttf sits in a fonts dir", () => {
    const withFont = fakeProbes({ home: "/h", dirs: { "/h/Library/Fonts": ["JetBrainsMonoNLNerdFont-Regular.ttf"] } });
    expect(nerdFontInstalled(withFont)).toBe(true);
    const systemFont = fakeProbes({ home: "/h", dirs: { "/Library/Fonts": ["JetBrainsMonoNLNerdFont-Bold.ttf"] } });
    expect(nerdFontInstalled(systemFont)).toBe(true);
    const otherFont = fakeProbes({ home: "/h", dirs: { "/h/Library/Fonts": ["JetBrainsMonoNerdFont-Regular.ttf", "JetBrainsMonoNLNerdFont-Regular.otf"] } });
    expect(nerdFontInstalled(otherFont)).toBe(false);
  });
});

describe("installNerdFont", () => {
  let root: string;
  let archive: string;
  let sha: string;
  const PIN_URL = "https://github.com/ryanoasis/nerd-fonts/releases/download/v3.5.1/JetBrainsMono.tar.xz";

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "rt-nerd-font-")));
    const src = join(root, "src");
    mkdirSync(join(src, "nested"), { recursive: true });
    writeFileSync(join(src, "JetBrainsMonoNLNerdFont-Regular.ttf"), "regular");
    writeFileSync(join(src, "nested", "JetBrainsMonoNLNerdFont-Bold.ttf"), "bold");
    writeFileSync(join(src, "JetBrainsMonoNerdFont-Regular.ttf"), "ligatures");
    archive = join(root, "fixture.tar.xz");
    execFileSync("tar", ["-cJf", archive, "-C", src, "."]);
    sha = createHash("sha256").update(readFileSync(archive)).digest("hex");
    mkdirSync(join(root, "home"));
    mkdirSync(join(root, "tmp"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function probes(curlCode = 0): Probes & { argv: string[][] } {
    const real = createRealProbes();
    const argv: string[][] = [];
    const exec: Probes["exec"] = async (cmd, opts) => {
      argv.push(cmd);
      if (cmd[0] === "curl") {
        if (curlCode !== 0) return { code: curlCode, stdout: "", stderr: "curl: (6) Could not resolve host" };
        copyFileSync(archive, cmd[cmd.indexOf("-o") + 1]!);
        return { code: 0, stdout: "", stderr: "" };
      }
      return real.exec(cmd, opts);
    };
    return { ...real, home: join(root, "home"), env: { TMPDIR: join(root, "tmp") }, exec, execStreaming: exec, argv };
  }
  const pin = (over: Partial<NerdFontArchive> = {}): NerdFontArchive => ({ ...NERD_FONT_ARCHIVE, url: PIN_URL, sha256: sha, ...over });
  const fonts = () => readdirSync(join(root, "home", "Library", "Fonts")).sort();

  test("the real pin is the tar.xz from the v3.5.1 release, gated on its own hosts", () => {
    expect(NERD_FONT_ARCHIVE.url).toBe(PIN_URL);
    expect(NERD_FONT_ARCHIVE.sha256).toBe("04d5e8f903693f9dd13e16f867e994834e681eb3c72c0d337a770dcda09010cf");
    expect([...NERD_FONT_ARCHIVE.allowedHosts].sort()).toEqual(["github.com", "release-assets.githubusercontent.com"]);
  });

  test("copies only the JetBrainsMonoNLNerdFont files into ~/Library/Fonts and cleans its temp dir", async () => {
    const p = probes();
    const lines: string[] = [];
    expect(await installNerdFont(p, (l) => lines.push(l), pin())).toEqual({ ok: true });
    expect(fonts()).toEqual(["JetBrainsMonoNLNerdFont-Bold.ttf", "JetBrainsMonoNLNerdFont-Regular.ttf"]);
    expect(readFileSync(join(root, "home", "Library", "Fonts", "JetBrainsMonoNLNerdFont-Bold.ttf"), "utf8")).toBe("bold");
    expect(readdirSync(join(root, "tmp"))).toEqual([]);
    expect(p.argv.find((a) => a[0] === "curl")).toEqual(expect.arrayContaining(["--proto", "=https", "--proto-redir", "=https", PIN_URL]));
    expect(lines.length).toBeGreaterThan(0);
  });

  test("a sha256 mismatch installs nothing", async () => {
    const p = probes();
    const res = await installNerdFont(p, () => {}, pin({ sha256: "0".repeat(64) }));
    expect(res).toEqual({ ok: false, reason: "other", detail: expect.stringContaining("sha256") });
    expect(existsSync(join(root, "home", "Library", "Fonts"))).toBe(false);
    expect(p.argv.some((a) => a[0] === "tar")).toBe(false);
    expect(readdirSync(join(root, "tmp"))).toEqual([]);
  });

  test("a url off the font hosts runs nothing", async () => {
    const p = probes();
    const res = await installNerdFont(p, () => {}, pin({ url: "https://evil.example/JetBrainsMono.tar.xz" }));
    expect(res).toEqual({ ok: false, reason: "other", detail: expect.stringContaining("evil.example") });
    expect(p.argv).toEqual([]);
  });

  test("a probe that throws is reported as a failure, not thrown", async () => {
    const p: Probes = { ...probes(), mkdirp: () => { throw new Error("EACCES: permission denied"); } };
    const res = await installNerdFont(p, () => {}, pin());
    expect(res).toEqual({ ok: false, reason: "other", detail: expect.stringContaining("EACCES: permission denied") });
  });

  test("an empty TMPDIR falls back to /tmp, in a directory only this run uses", async () => {
    const argv: string[][] = [];
    const exec: Probes["exec"] = async (cmd) => (argv.push(cmd), { code: 6, stdout: "", stderr: "offline" });
    const p: Probes = { ...probes(), env: { TMPDIR: "" }, exec, execStreaming: exec, mkdirp: () => {} };
    await installNerdFont(p, () => {}, pin());
    const removed = argv.filter((a) => a[0] === "rm").map((a) => a[2]);
    expect(removed.length).toBe(2);
    expect(removed[0]).toBe(`/tmp/rt-nerd-font-${process.pid}`);
    expect(removed[1]).toBe(removed[0]);
  });

  test("a download that times out is a download failure", async () => {
    const res = await installNerdFont(probes(124), () => {}, pin());
    expect(res).toEqual({ ok: false, reason: "download", detail: "Downloading the font did not finish in time" });
  });

  test("a failed download reports it and installs nothing", async () => {
    const p = probes(6);
    const res = await installNerdFont(p, () => {}, pin());
    expect(res).toEqual({ ok: false, reason: "download", detail: expect.stringContaining("Downloading") });
    expect(existsSync(join(root, "home", "Library", "Fonts"))).toBe(false);
  });
});

describe("planEditorFonts / applyEditorFonts", () => {
  let root: string;
  let home: string;
  let apps: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "rt-editor-font-")));
    home = join(root, "home");
    apps = join(root, "Applications");
    mkdirSync(home);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

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
  const p = () => realFsProbes(home);
  const only = (results: EditorFontResult[], editor: string) => results.find((r) => r.editor === editor)!;

  test("lists every supported editor, and one whose app is absent is not-installed and gets no file", () => {
    install("Visual Studio Code.app", "code");
    const results = applyEditorFonts(p(), {}, [apps]);
    expect(results.map((r) => r.editor)).toEqual(["VS Code", "Cursor", "Antigravity", "Antigravity IDE"]);
    expect(only(results, "Cursor")).toEqual({ editor: "Cursor", path: settingsPath("Cursor"), outcome: "not-installed" });
    expect(existsSync(settingsPath("Cursor"))).toBe(false);
  });

  test("an edit changes only the one value; comments and trailing commas survive byte for byte", () => {
    install("Cursor.app", "cursor");
    const before = `{\n  // my font\n  "editor.fontSize": 13,\n  "terminal.integrated.fontFamily": "Fira Code", // keep me\n  /* block */\n  "x": [1, 2,],\n}\n`;
    const path = seed("Cursor", before);
    const results = applyEditorFonts(p(), {}, [apps]);
    expect(only(results, "Cursor")).toEqual({ editor: "Cursor", path, outcome: "written", value: `Fira Code, ${NERD}` });
    expect(readFileSync(path, "utf8")).toBe(before.replace(`"Fira Code"`, JSON.stringify(`Fira Code, ${NERD}`)));
  });

  test("an unset key is seeded from editor.fontFamily, keeping comments and the file's tab indent", () => {
    install("Cursor.app", "cursor");
    const before = `{\n\t// mine\n\t"editor.fontFamily": "SF Mono"\n}\n`;
    const path = seed("Cursor", before);
    applyEditorFonts(p(), {}, [apps]);
    expect(readFileSync(path, "utf8")).toBe(`{\n\t"terminal.integrated.fontFamily": "SF Mono, ${NERD}",\n\t// mine\n\t"editor.fontFamily": "SF Mono"\n}\n`);
  });

  describe("an unset key goes in as the first property and every other byte stays", () => {
    const KEY = `"terminal.integrated.fontFamily": ${JSON.stringify(`${EDITOR_DEFAULT_FONT}, ${NERD}`)}`;
    const cases: [string, string, string][] = [
      [
        "a compact last value with a trailing comment",
        `{\n  "editor.fontSize": 13,\n  "x": {"b":1,"c":[1,2]} // c\n}\n`,
        `{\n  ${KEY},\n  "editor.fontSize": 13,\n  "x": {"b":1,"c":[1,2]} // c\n}\n`,
      ],
      ["a one-line file", `{"a":1,"b":2}`, `{\n    ${KEY},"a":1,"b":2}`],
      ["a CRLF file", `{\r\n  "a": 1\r\n}\r\n`, `{\r\n  ${KEY},\r\n  "a": 1\r\n}\r\n`],
      ["a tab-indented file", `{\n\t"x": [\n\t\t1\n\t]\n}\n`, `{\n\t${KEY},\n\t"x": [\n\t\t1\n\t]\n}\n`],
      ["an empty object", `{}`, `{\n    ${KEY}\n}`],
      ["an empty object with a space and a newline after", `{ }\n`, `{\n    ${KEY}\n}\n`],
      ["an object holding only a comment", `{\n  // nothing yet\n}\n`, `{\n    ${KEY}\n  // nothing yet\n}\n`],
      [
        "a first indented line deeper than the properties",
        `{\n    // four-space comment\n  "[markdown]": {\n      "a": 1\n  }\n}\n`,
        `{\n  ${KEY},\n    // four-space comment\n  "[markdown]": {\n      "a": 1\n  }\n}\n`,
      ],
      ["a comment holding a brace before the object", `// {\n{\n  "a": 1\n}\n`, `// {\n{\n  ${KEY},\n  "a": 1\n}\n`],
    ];
    for (const [name, before, after] of cases) {
      test(name, () => {
        install("Cursor.app", "cursor");
        const path = seed("Cursor", before);
        expect(only(applyEditorFonts(p(), {}, [apps]), "Cursor").outcome).toBe("written");
        expect(readFileSync(path, "utf8")).toBe(after);
      });
    }
  });

  test("a key set to a non-string is replaced in place, never duplicated", () => {
    install("Cursor.app", "cursor");
    const path = seed("Cursor", `{ "a": 1, "terminal.integrated.fontFamily": null }`);
    applyEditorFonts(p(), {}, [apps]);
    expect(readFileSync(path, "utf8")).toBe(`{ "a": 1, "terminal.integrated.fontFamily": ${JSON.stringify(`${EDITOR_DEFAULT_FONT}, ${NERD}`)} }`);
  });

  test("a one-line file with the key set changes only the value", () => {
    install("Cursor.app", "cursor");
    const path = seed("Cursor", `{"terminal.integrated.fontFamily":"Fira Code","x":{"y":1}}`);
    applyEditorFonts(p(), {}, [apps]);
    expect(readFileSync(path, "utf8")).toBe(`{"terminal.integrated.fontFamily":"Fira Code, ${NERD}","x":{"y":1}}`);
  });

  test("a file starting with a UTF-8 BOM is read and keeps its BOM", () => {
    install("Cursor.app", "cursor");
    const path = seed("Cursor", `\uFEFF{\n  "terminal.integrated.fontFamily": "Fira Code"\n}\n`);
    expect(only(applyEditorFonts(p(), {}, [apps]), "Cursor").outcome).toBe("written");
    expect(readFileSync(path, "utf8")).toBe(`\uFEFF{\n  "terminal.integrated.fontFamily": "Fira Code, ${NERD}"\n}\n`);
  });

  test("a BOM file with the key unset gets it after the brace and keeps its BOM", () => {
    install("Cursor.app", "cursor");
    const path = seed("Cursor", `\uFEFF{\n  "a": 1\n}\n`);
    applyEditorFonts(p(), {}, [apps]);
    expect(readFileSync(path, "utf8")).toBe(`\uFEFF{\n  "terminal.integrated.fontFamily": ${JSON.stringify(`${EDITOR_DEFAULT_FONT}, ${NERD}`)},\n  "a": 1\n}\n`);
  });

  test("an unparseable file is left untouched and reported unreadable", () => {
    install("Cursor.app", "cursor");
    const broken = `{ "terminal.integrated.fontFamily": "Fira Code" "x": 1 }`;
    const path = seed("Cursor", broken);
    expect(only(applyEditorFonts(p(), {}, [apps]), "Cursor").outcome).toBe("unreadable");
    expect(readFileSync(path, "utf8")).toBe(broken);
  });

  test("a file holding a non-object is unreadable", () => {
    install("Cursor.app", "cursor");
    const path = seed("Cursor", "[1, 2]");
    expect(only(applyEditorFonts(p(), {}, [apps]), "Cursor").outcome).toBe("unreadable");
    expect(readFileSync(path, "utf8")).toBe("[1, 2]");
  });

  test("a missing User dir gets a new settings.json holding only the key", () => {
    install("Antigravity IDE.app", "antigravity-ide");
    const result = only(applyEditorFonts(p(), {}, [apps]), "Antigravity IDE");
    const value = `${EDITOR_DEFAULT_FONT}, ${NERD}`;
    expect(result).toEqual({ editor: "Antigravity IDE", path: settingsPath("Antigravity IDE"), outcome: "written", value });
    expect(readFileSync(settingsPath("Antigravity IDE"), "utf8")).toBe(`{\n    "terminal.integrated.fontFamily": ${JSON.stringify(value)}\n}\n`);
  });

  test("a value the member changed after rt wrote it is left alone", () => {
    install("Cursor.app", "cursor");
    const before = `{ "terminal.integrated.fontFamily": "Menlo" }`;
    const path = seed("Cursor", before);
    const results = applyEditorFonts(p(), { [path]: `Menlo, ${NERD}` }, [apps]);
    expect(only(results, "Cursor").outcome).toBe("member-undid");
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  test("a value that already names a Nerd Font is kept", () => {
    install("Antigravity.app", "antigravity");
    const path = seed("Antigravity", `{ "terminal.integrated.fontFamily": "Hack Nerd Font" }`);
    expect(only(applyEditorFonts(p(), {}, [apps]), "Antigravity")).toEqual({ editor: "Antigravity", path, outcome: "kept" });
  });

  test("an unset terminal whose editor font names a Nerd Font is kept and gets no file", () => {
    install("Cursor.app", "cursor");
    const before = `{ "editor.fontFamily": "Hack Nerd Font Mono" }`;
    const path = seed("Cursor", before);
    expect(only(planEditorFonts(p(), {}, [apps]), "Cursor")).toEqual({ editor: "Cursor", path, outcome: "kept" });
    expect(only(applyEditorFonts(p(), {}, [apps]), "Cursor").outcome).toBe("kept");
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  test("Antigravity IDE is found by its own CLI", () => {
    install("Antigravity IDE.app", "antigravity-ide");
    expect(only(planEditorFonts(p(), {}, [apps]), "Antigravity IDE").outcome).toBe("written");
  });

  test("planEditorFonts reports what it would write and writes nothing", () => {
    install("Cursor.app", "cursor");
    install("Visual Studio Code.app", "code");
    const path = seed("Cursor", `{ "terminal.integrated.fontFamily": "Fira Code" }`);
    const results = planEditorFonts(p(), {}, [apps]);
    expect(only(results, "Cursor")).toEqual({ editor: "Cursor", path, outcome: "written", value: `Fira Code, ${NERD}` });
    expect(only(results, "VS Code").outcome).toBe("written");
    expect(readFileSync(path, "utf8")).toBe(`{ "terminal.integrated.fontFamily": "Fira Code" }`);
    expect(existsSync(settingsPath("Code"))).toBe(false);
  });

  test("a rewrite keeps the file's mode and leaves no temp file behind", () => {
    install("Cursor.app", "cursor");
    const path = seed("Cursor", `{ "terminal.integrated.fontFamily": "Fira Code" }`);
    chmodSync(path, 0o600);
    applyEditorFonts(p(), {}, [apps]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(path, ".."))).toEqual(["settings.json"]);
  });

  test("a write that throws marks that editor failed, cleans its temp file, and the next editor is still written", () => {
    install("Visual Studio Code.app", "code");
    install("Cursor.app", "cursor");
    const codePath = seed("Code", `{ "terminal.integrated.fontFamily": "Fira Code" }`);
    const cursorPath = seed("Cursor", `{ "terminal.integrated.fontFamily": "Fira Code" }`);
    const base = realFsProbes(home);
    const probes: Probes = {
      ...base,
      rename(from, to) {
        if (to === codePath) throw new Error("EACCES: permission denied");
        base.rename(from, to);
      },
    };
    const results = applyEditorFonts(probes, {}, [apps]);
    expect(only(results, "VS Code")).toEqual({ editor: "VS Code", path: codePath, outcome: "failed", detail: "EACCES: permission denied" });
    expect(readdirSync(join(codePath, ".."))).toEqual(["settings.json"]);
    expect(readFileSync(codePath, "utf8")).toBe(`{ "terminal.integrated.fontFamily": "Fira Code" }`);
    expect(only(results, "Cursor").outcome).toBe("written");
    expect(readFileSync(cursorPath, "utf8")).toContain(`Fira Code, ${NERD}`);
  });

  test("a symlinked settings.json is edited through the link, which stays a link", () => {
    install("Cursor.app", "cursor");
    const target = join(root, "dotfiles", "settings.json");
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, `{ "terminal.integrated.fontFamily": "Fira Code" }`);
    const path = settingsPath("Cursor");
    mkdirSync(join(path, ".."), { recursive: true });
    symlinkSync(target, path);
    applyEditorFonts(p(), {}, [apps]);
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, "utf8")).toContain(`Fira Code, ${NERD}`);
  });

  test("a settings.json linked to a missing file is unreadable and nothing is written", () => {
    install("Cursor.app", "cursor");
    const target = join(root, "dotfiles", "gone", "settings.json");
    const path = settingsPath("Cursor");
    mkdirSync(join(path, ".."), { recursive: true });
    symlinkSync(target, path);
    expect(only(applyEditorFonts(p(), {}, [apps]), "Cursor").outcome).toBe("unreadable");
    expect(existsSync(join(root, "dotfiles"))).toBe(false);
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
  });
});
