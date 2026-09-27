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
