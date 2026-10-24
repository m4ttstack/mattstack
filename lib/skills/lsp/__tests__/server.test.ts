import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { isSkillFile, PUBLISH_DEBOUNCE_MS, startServer } from "../server.ts";
import { Workspace } from "../workspace.ts";

const FIXTURES = join(import.meta.dir, "../../__tests__/fixtures/blocks");

type Message = { id?: number; method?: string; params?: any; result?: any };

/**
 * The server runs in this process over two pipes, so a test can count what the workspace does. The
 * pipes are never ended: the library exits the process when its input closes.
 */
class InProcess {
  readonly messages: Message[] = [];
  readonly walked: string[] = [];
  private readonly seen = new Set<object>();
  private readonly input = new PassThrough();
  private raw = Buffer.alloc(0);

  constructor(roots: string[], opts: { debounceMs?: number; home?: string } = {}) {
    const output = new PassThrough();
    output.on("data", (chunk: Buffer) => {
      this.raw = Buffer.concat([this.raw, chunk]);
      this.parse();
    });
    const counted = this;
    startServer({
      roots,
      input: this.input,
      output,
      debounceMs: opts.debounceMs,
      workspace: (given) =>
        new (class extends Workspace {
          override analysis() {
            const a = super.analysis();
            counted.seen.add(a);
            return a;
          }
        })(given, undefined, { walked: (dir) => counted.walked.push(dir), home: opts.home }),
    });
  }

  private parse() {
    for (;;) {
      const header = this.raw.indexOf("\r\n\r\n");
      if (header < 0) return;
      const length = Number(/Content-Length: (\d+)/.exec(this.raw.subarray(0, header).toString())?.[1]);
      if (this.raw.length < header + 4 + length) return;
      this.messages.push(JSON.parse(this.raw.subarray(header + 4, header + 4 + length).toString()));
      this.raw = this.raw.subarray(header + 4 + length);
    }
  }

  /** Each fresh analysis is a new object; a memoized read returns the same one. */
  get analyses(): number {
    return this.seen.size;
  }

  send(message: Message) {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    this.input.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  async waitFor(match: (m: Message) => boolean, since = 0, ms = 10_000): Promise<Message> {
    const deadline = Date.now() + ms;
    for (;;) {
      const hit = this.messages.slice(since).find(match);
      if (hit) return hit;
      if (Date.now() > deadline) throw new Error(`no matching message; got ${JSON.stringify(this.messages.map((m) => m.method ?? m.id))}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  async start() {
    this.send({ id: 1, method: "initialize", params: { processId: null, capabilities: {} } });
    await this.waitFor((m) => m.id === 1);
    this.send({ method: "initialized", params: {} });
  }

  publishes(uri: string) {
    return this.messages.filter((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri);
  }

  async stop() {
    this.send({ id: 99, method: "shutdown" });
    await this.waitFor((m) => m.id === 99);
  }
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

let tmp: string;
let plugin: string;
let gate: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "lsp-server-unit-"));
  plugin = join(tmp, "mattstack");
  cpSync(join(FIXTURES, "plugins/mattstack"), plugin, { recursive: true });
  gate = join(plugin, "attachments/pipeline/mini/gate.block.md");
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("rt skills lsp publishing", () => {
  test("two quick changes publish once, after the burst settles", async () => {
    const server = new InProcess([plugin]);
    await server.start();
    const uri = pathToFileURL(gate).href;
    const text = readFileSync(gate, "utf8");
    server.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "markdown", version: 1, text } } });
    await server.waitFor((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri);
    const before = server.publishes(uri).length;
    const analyses = server.analyses;
    server.send({ method: "textDocument/didChange", params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: `${text}\n{{props.no}}\n` }] } });
    server.send({ method: "textDocument/didChange", params: { textDocument: { uri, version: 3 }, contentChanges: [{ text: `${text}\n{{props.nope}}\n` }] } });
    await settle(PUBLISH_DEBOUNCE_MS * 4);
    const after = server.publishes(uri).slice(before);
    expect(after).toHaveLength(1);
    expect(after[0]!.params.diagnostics.map((d: { message: string }) => d.message)).toEqual([expect.stringContaining('"nope"')]);
    expect(server.analyses).toBe(analyses + 1);
    await server.stop();
  });

  test("a content edit does not walk the folders again; a watched file created does", async () => {
    const server = new InProcess([plugin], { debounceMs: 20 });
    await server.start();
    const uri = pathToFileURL(gate).href;
    const text = readFileSync(gate, "utf8");
    server.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "markdown", version: 1, text } } });
    await server.waitFor((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri);
    const walks = server.walked.length;
    expect(walks).toBeGreaterThan(0);
    let since = server.messages.length;
    server.send({ method: "textDocument/didChange", params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: `${text}\nMore.\n` }] } });
    await server.waitFor((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri, since);
    expect(server.walked.length).toBe(walks);

    const later = join(plugin, "attachments/pipeline/mini/later.block.md");
    writeFileSync(later, "# Later\n");
    since = server.messages.length;
    server.send({ method: "workspace/didChangeWatchedFiles", params: { changes: [{ uri: pathToFileURL(later).href, type: 1 }] } });
    await server.waitFor((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri, since);
    expect(server.walked.length).toBeGreaterThan(walks);
    await server.stop();
  });
});

const put = (file: string, text: string) => {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
};

describe("isSkillFile", () => {
  test("needs a plugin above the file, outside any dot folder", () => {
    const outside = join(tmp, "repo");
    put(join(outside, ".claude/skills/notes/SKILL.md"), "# notes\n");
    expect(isSkillFile(join(outside, ".claude/skills/notes/SKILL.md"))).toBe(false);
    expect(isSkillFile(join(outside, "docs/skills/guide.md"))).toBe(false);
    expect(isSkillFile(join(outside, "attachments/x/SKILL.md"))).toBe(false);
    expect(isSkillFile(join(outside, "skills.jsonc"))).toBe(false);
    expect(isSkillFile(join(outside, "notes/a.block.md"))).toBe(false);

    expect(isSkillFile(gate)).toBe(true);
    expect(isSkillFile(join(plugin, "attachments/style-floor/SKILL.md"))).toBe(true);
    expect(isSkillFile(join(plugin, "skills/model-tiering/SKILL.md"))).toBe(true);
    expect(isSkillFile(join(plugin, "pack/skills.jsonc"))).toBe(true);
    expect(isSkillFile(join(plugin, "README.md"))).toBe(false);
    expect(isSkillFile(join(plugin, ".claude/skills/notes/SKILL.md"))).toBe(false);
  });
});

describe("rt skills lsp stays idle", () => {
  test("a skill under .claude/skills/ with no plugin above it never wakes the server", async () => {
    const repo = join(tmp, "repo");
    const skill = join(repo, ".claude/skills/notes/SKILL.md");
    put(skill, "# notes\n");
    const server = new InProcess([repo], { debounceMs: 20 });
    await server.start();
    const uri = pathToFileURL(skill).href;
    server.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "markdown", version: 1, text: "# notes\n" } } });
    server.send({ method: "textDocument/didChange", params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: "# notes\nmore\n" }] } });
    server.send({ id: 2, method: "textDocument/hover", params: { textDocument: { uri }, position: { line: 0, character: 1 } } });
    expect((await server.waitFor((m) => m.id === 2)).result).toBeNull();
    await settle(200);
    expect(server.messages.filter((m) => m.method === "textDocument/publishDiagnostics")).toEqual([]);
    expect(server.walked).toEqual([]);
    expect(server.analyses).toBe(0);
    await server.stop();
  });

  test("a code action on a plain markdown file and a rename before any skill file opens run no analysis", async () => {
    const readme = join(plugin, "README.md");
    put(readme, "# mattstack\n");
    const server = new InProcess([plugin], { debounceMs: 20 });
    await server.start();
    const uri = pathToFileURL(readme).href;
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
    server.send({ id: 2, method: "textDocument/codeAction", params: { textDocument: { uri }, range, context: { diagnostics: [] } } });
    expect((await server.waitFor((m) => m.id === 2)).result).toEqual([]);
    const files = [{ oldUri: pathToFileURL(join(plugin, "attachments/style-floor")).href, newUri: pathToFileURL(join(plugin, "attachments/style-base")).href }];
    server.send({ id: 3, method: "workspace/willRenameFiles", params: { files } });
    expect((await server.waitFor((m) => m.id === 3)).result).toBeNull();
    expect(server.analyses).toBe(0);
    expect(server.walked).toEqual([]);
    await server.stop();
  });

  test("a workspace root that is the home folder is never walked; an opened skill file's plugin is", async () => {
    const home = join(tmp, "home");
    const inHome = join(home, "work/mattstack");
    cpSync(join(FIXTURES, "plugins/mattstack"), inHome, { recursive: true });
    const file = join(inHome, "attachments/pipeline/mini/gate.block.md");
    for (const root of [home, "/"]) {
      const server = new InProcess([root], { debounceMs: 20, home });
      await server.start();
      const uri = pathToFileURL(file).href;
      server.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "markdown", version: 1, text: `${readFileSync(file, "utf8")}\n{{props.nope}}\n` } } });
      const published = await server.waitFor((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri && m.params.diagnostics.length > 0);
      expect(published.params.diagnostics[0]).toMatchObject({ code: "unknown-prop" });
      expect(server.walked).not.toContain(home);
      expect(server.walked).not.toContain("/");
      expect(server.walked).toContain(inHome);
      await server.stop();
    }
  });
});
