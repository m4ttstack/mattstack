/**
 * checkRtContextExtension — the editor extensions presence check (MAT-383 §5).
 *
 * Directory reads against a fixture `home` and a fixture Applications folder,
 * no subprocess and no version comparison. The rest of `rt verify` is covered
 * by e2e/tests/verify.test.ts (it needs a real compiled binary + daemon).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkRtContextExtension } from "../verify.ts";

const fixtureDirs: string[] = [];

function fixtureHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "rt-verify-vsix-"));
  fixtureDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (fixtureDirs.length > 0) {
    rmSync(fixtureDirs.pop()!, { recursive: true, force: true });
  }
});

const APPS: Record<string, [string, string]> = {
  "VS Code": ["Visual Studio Code.app", "code"],
  Cursor: ["Cursor.app", "cursor"],
  Antigravity: ["Antigravity.app", "antigravity"],
  Windsurf: ["Windsurf.app", "windsurf"],
  "Cursor Personal": ["Cursor Personal.app", "cursor"],
};

/** Puts each named editor's app in `<home>/Applications`, with the CLI detectEditors looks for. */
function installApps(home: string, ...names: (keyof typeof APPS)[]): void {
  for (const name of names) {
    const [app, cli] = APPS[name]!;
    const bin = join(home, "Applications", app, "Contents/Resources/app/bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, cli), "");
  }
}

function ext(home: string, folder: string, ...ids: string[]): void {
  for (const id of ids) mkdirSync(join(home, folder, "extensions", `${id}-0.1.0`), { recursive: true });
}

function check(home: string) {
  return checkRtContextExtension({ home, exists: existsSync, readDir: (d) => readdirSync(d) }, [join(home, "Applications")]);
}

describe("checkRtContextExtension", () => {
  test("both extensions in one editor → pass, naming that editor", () => {
    const home = fixtureHome();
    installApps(home, "VS Code");
    ext(home, ".vscode", "local.rt-context", "local.skill-blocks");

    const result = check(home);

    expect(result.status).toBe("pass");
    expect(result.detail).toContain("Visual Studio Code");
    expect(result.detail).not.toContain("Cursor");
  });

  test("both extensions under Cursor's folder → pass, naming Cursor", () => {
    const home = fixtureHome();
    installApps(home, "Cursor");
    ext(home, ".cursor", "local.rt-context", "local.skill-blocks");

    const result = check(home);

    expect(result.status).toBe("pass");
    expect(result.detail).toContain("Cursor");
  });

  test("an editor found with neither extension → warn", () => {
    const home = fixtureHome();
    installApps(home, "VS Code");
    ext(home, ".vscode", "some.other-extension");

    const result = check(home);

    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Visual Studio Code");
    expect(result.detail).toContain("rt settings extension");
  });

  test("an editor with rt-context but not skill-blocks → warn, naming that editor and the missing extension", () => {
    const home = fixtureHome();
    installApps(home, "VS Code", "Cursor");
    ext(home, ".vscode", "local.rt-context", "local.skill-blocks");
    ext(home, ".cursor", "local.rt-context");

    const result = check(home);

    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Cursor is missing skill-blocks");
    expect(result.detail).not.toContain("Visual Studio Code");
  });

  test("Antigravity missing skill-blocks is reported, though VS Code and Cursor have both", () => {
    const home = fixtureHome();
    installApps(home, "VS Code", "Cursor", "Antigravity");
    ext(home, ".vscode", "local.rt-context", "local.skill-blocks");
    ext(home, ".cursor", "local.rt-context", "local.skill-blocks");
    ext(home, ".antigravity", "local.rt-context");

    const result = check(home);

    expect(result.status).toBe("warn");
    expect(result.detail).toBe("Antigravity is missing skill-blocks. Run rt settings extension");
  });

  test("Windsurf is checked through its own folder", () => {
    const home = fixtureHome();
    installApps(home, "Windsurf");
    ext(home, ".windsurf", "local.rt-context", "local.skill-blocks");

    expect(check(home).status).toBe("pass");
  });

  test("matches the extension id prefix, not any folder holding the name", () => {
    const home = fixtureHome();
    installApps(home, "VS Code");
    ext(home, ".vscode", "someone.rt-context-fork", "someone.skill-blocks-fork");

    const result = check(home);

    expect(result.status).toBe("warn");
    expect(result.detail).toStartWith("Not installed in Visual Studio Code");
  });

  test("an editor whose folder rt does not know is named as unchecked", () => {
    const home = fixtureHome();
    installApps(home, "VS Code", "Cursor Personal");
    ext(home, ".vscode", "local.rt-context", "local.skill-blocks");

    const result = check(home);

    expect(result.status).toBe("pass");
    expect(result.detail).toBe("Installed in Visual Studio Code. rt can't check Cursor Personal");
  });

  test("no editor found → skip, even with an old extensions folder left behind", () => {
    const home = fixtureHome();
    ext(home, ".vscode", "local.rt-context");

    const result = check(home);

    expect(result.status).toBe("skip");
    expect(result.detail).toBe("No VS Code-family editor found");
  });
});
