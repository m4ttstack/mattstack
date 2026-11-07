import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildCodexPaneCommand, buildPaneCommand, resolveNodePin } from "../index.ts";

const UUID = "6e225e74-4cb7-4aea-8807-6aa9011d4112";

let root: string;
let repo: string;
let nvmDir: string;

function install(...versions: string[]) {
  for (const v of versions) mkdirSync(join(nvmDir, "versions", "node", v, "bin"), { recursive: true });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "node-pin-"));
  repo = join(root, "repo");
  nvmDir = join(root, "nvm");
  mkdirSync(repo);
  mkdirSync(join(nvmDir, "versions", "node"), { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const env = () => ({ NVM_DIR: nvmDir, PATH: "/usr/bin:/bin" });

describe("resolveNodePin", () => {
  test("an exact .nvmrc version nvm has installed pins its bin dir", () => {
    install("v22.22.0", "v22.23.4");
    writeFileSync(join(repo, ".nvmrc"), "22.23.4\n");
    expect(resolveNodePin(repo, env())).toEqual({ kind: "bin", dir: join(nvmDir, "versions", "node", "v22.23.4", "bin") });
  });

  test("a leading v and surrounding whitespace are accepted", () => {
    install("v22.23.4");
    writeFileSync(join(repo, ".nvmrc"), "  v22.23.4  \n");
    expect(resolveNodePin(repo, env())).toEqual({ kind: "bin", dir: join(nvmDir, "versions", "node", "v22.23.4", "bin") });
  });

  test("a partial version takes the highest installed match", () => {
    install("v20.9.0", "v22.9.1", "v22.23.4", "v22.10.0");
    writeFileSync(join(repo, ".nvmrc"), "22");
    expect(resolveNodePin(repo, env())).toEqual({ kind: "bin", dir: join(nvmDir, "versions", "node", "v22.23.4", "bin") });
  });

  test("a version nvm has not installed is reported missing", () => {
    install("v22.22.0");
    writeFileSync(join(repo, ".nvmrc"), "22.23.4");
    expect(resolveNodePin(repo, env())).toEqual({ kind: "missing", version: "22.23.4" });
  });

  test("an nvm alias file resolves to the version it names", () => {
    install("v20.18.0", "v22.23.4");
    mkdirSync(join(nvmDir, "alias", "lts"), { recursive: true });
    writeFileSync(join(nvmDir, "alias", "lts", "jod"), "v22.23.4\n");
    writeFileSync(join(repo, ".nvmrc"), "lts/jod");
    expect(resolveNodePin(repo, env())).toEqual({ kind: "bin", dir: join(nvmDir, "versions", "node", "v22.23.4", "bin") });
  });

  test("lts/* resolves through nvm's lts/* alias file", () => {
    install("v20.18.0", "v22.23.4");
    mkdirSync(join(nvmDir, "alias", "lts"), { recursive: true });
    writeFileSync(join(nvmDir, "alias", "lts", "*"), "lts/jod\n");
    writeFileSync(join(nvmDir, "alias", "lts", "jod"), "v22.23.4\n");
    writeFileSync(join(repo, ".nvmrc"), "lts/*");
    expect(resolveNodePin(repo, env())).toEqual({ kind: "bin", dir: join(nvmDir, "versions", "node", "v22.23.4", "bin") });
  });

  test("a custom stable alias wins over the highest installed version", () => {
    install("v18.20.0", "v22.23.4");
    mkdirSync(join(nvmDir, "alias"), { recursive: true });
    writeFileSync(join(nvmDir, "alias", "stable"), "18\n");
    writeFileSync(join(repo, ".nvmrc"), "stable");
    expect(resolveNodePin(repo, env())).toEqual({ kind: "bin", dir: join(nvmDir, "versions", "node", "v18.20.0", "bin") });
  });

  test("stable with no alias file takes the highest installed version", () => {
    install("v18.20.0", "v22.23.4");
    writeFileSync(join(repo, ".nvmrc"), "stable");
    expect(resolveNodePin(repo, env())).toEqual({ kind: "bin", dir: join(nvmDir, "versions", "node", "v22.23.4", "bin") });
  });

  test("an alias it cannot resolve leaves the pane alone", () => {
    install("v22.23.4");
    writeFileSync(join(repo, ".nvmrc"), "lts/*");
    expect(resolveNodePin(repo, env())).toBeUndefined();
  });

  test("no .nvmrc leaves the pane alone", () => {
    install("v22.23.4");
    expect(resolveNodePin(repo, env())).toBeUndefined();
  });

  test("a machine without nvm's versions dir leaves the pane alone", () => {
    rmSync(join(nvmDir, "versions"), { recursive: true });
    writeFileSync(join(repo, ".nvmrc"), "22.23.4");
    expect(resolveNodePin(repo, env())).toBeUndefined();
  });

  test("a machine with mise on PATH leaves the pane alone", () => {
    install("v22.23.4");
    writeFileSync(join(repo, ".nvmrc"), "22.23.4");
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "mise"), "#!/bin/sh\n", { mode: 0o755 });
    expect(resolveNodePin(repo, { ...env(), PATH: `${bin}:/usr/bin` })).toBeUndefined();
  });

  test("NVM_DIR defaults to ~/.nvm", () => {
    const home = join(root, "home");
    mkdirSync(join(home, ".nvm", "versions", "node", "v22.23.4", "bin"), { recursive: true });
    writeFileSync(join(repo, ".nvmrc"), "22.23.4");
    expect(resolveNodePin(repo, { HOME: home, PATH: "/usr/bin" }))
      .toEqual({ kind: "bin", dir: join(home, ".nvm", "versions", "node", "v22.23.4", "bin") });
  });
});

describe("pane commands carry the node pin", () => {
  const start = { session: { kind: "start" as const, sessionId: UUID }, headless: false };

  test("claude: a bin pin prepends the dir to the pane's PATH", () => {
    const cmd = buildPaneCommand("/r", { ...start, nodePin: { kind: "bin", dir: "/n/v22.23.4/bin" } });
    expect(cmd).toBe(`cd '/r' && PATH='/n/v22.23.4/bin':"$PATH" claude '--session-id' '${UUID}'`);
  });

  test("claude: a missing pin names the version and the nvm install command, then starts the agent", () => {
    const cmd = buildPaneCommand("/r", { ...start, nodePin: { kind: "missing", version: "22.23.4" } });
    expect(cmd).toBe(
      `cd '/r' && echo 'rt: .nvmrc asks for node 22.23.4, which nvm has not installed. Run: nvm install 22.23.4' >&2 && claude '--session-id' '${UUID}'`,
    );
  });

  test("claude: the pin sits beside other env, before cswap", () => {
    const cmd = buildPaneCommand("/r", { ...start, account: "a@b.c", env: { A: "1" }, nodePin: { kind: "bin", dir: "/n/bin" } });
    expect(cmd).toBe(`cd '/r' && A='1' PATH='/n/bin':"$PATH" cswap run 'a@b.c' -- '--session-id' '${UUID}'`);
  });

  test("codex: a bin pin prepends the dir to the pane's PATH", () => {
    const cmd = buildCodexPaneCommand("/r", { ...start, nodePin: { kind: "bin", dir: "/n/bin" } });
    expect(cmd).toStartWith(`cd '/r' && PATH='/n/bin':"$PATH" codex`);
  });

  test("no pin leaves the command as it was", () => {
    expect(buildPaneCommand("/r", start)).toBe(`cd '/r' && claude '--session-id' '${UUID}'`);
  });
});
