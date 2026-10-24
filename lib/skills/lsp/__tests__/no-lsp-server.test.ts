import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { childEnv } from "../../../subprocess.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const FIXTURES = join(import.meta.dir, "../../__tests__/fixtures/blocks");

type Message = { id?: number; method?: string; params?: any; result?: any };

class Client {
  private readonly proc;
  private raw = Buffer.alloc(0);
  readonly messages: Message[] = [];
  private head = Buffer.alloc(0);
  private waiters: (() => void)[] = [];

  constructor(args: string[], home: string) {
    this.proc = Bun.spawn(["bun", "cli.ts", "skills", "lsp", ...args], {
      cwd: ROOT,
      env: { ...childEnv(), HOME: home, RT_SKIP_SETUP: "1" },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    void this.read();
  }

  private async read() {
    for await (const chunk of this.proc.stdout) {
      if (this.head.length < 15) this.head = Buffer.concat([this.head, Buffer.from(chunk)]);
      this.raw = Buffer.concat([this.raw, Buffer.from(chunk)]);
      this.parse();
    }
  }

  private parse() {
    for (;;) {
      const header = this.raw.indexOf("\r\n\r\n");
      if (header < 0) return;
      const length = Number(/Content-Length: (\d+)/.exec(this.raw.subarray(0, header).toString())?.[1]);
      if (this.raw.length < header + 4 + length) return;
      this.messages.push(JSON.parse(this.raw.subarray(header + 4, header + 4 + length).toString()));
      this.raw = this.raw.subarray(header + 4 + length);
      this.waiters.splice(0).forEach((w) => w());
    }
  }

  get firstBytes(): string {
    return this.head.subarray(0, 15).toString();
  }

  send(message: Message) {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    this.proc.stdin.flush();
  }

  async waitFor(match: (m: Message) => boolean, since = 0, ms = 20_000): Promise<Message> {
    const deadline = Date.now() + ms;
    for (;;) {
      const hit = this.messages.slice(since).find(match);
      if (hit) return hit;
      if (Date.now() > deadline) throw new Error(`no matching message; got ${JSON.stringify(this.messages.map((m) => m.method ?? m.id))}`);
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 200);
      });
    }
  }

  async stop() {
    this.send({ id: 99, method: "shutdown" });
    await this.waitFor((m) => m.id === 99).catch(() => undefined);
    this.send({ method: "exit" });
    const exited = await Promise.race([this.proc.exited, new Promise((r) => setTimeout(() => r(null), 5000))]);
    if (exited === null) this.proc.kill();
    return exited;
  }

  kill() {
    this.proc.kill();
  }
}

let tmp: string;
let plugin: string;
let home: string;
let gate: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "lsp-server-"));
  home = join(tmp, "home");
  plugin = join(tmp, "mattstack");
  cpSync(join(FIXTURES, "plugins/mattstack"), plugin, { recursive: true });
  gate = join(plugin, "attachments/pipeline/mini/gate.block.md");
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

async function unknownPropRoundTrip(client: Client, initialize: Record<string, unknown>) {
  try {
    await roundTrip(client, initialize);
  } finally {
    client.kill();
  }
}

async function roundTrip(client: Client, initialize: Record<string, unknown>) {
  client.send({ id: 1, method: "initialize", params: { processId: null, capabilities: {}, ...initialize } });
  const init = await client.waitFor((m) => m.id === 1);
  expect(client.firstBytes).toBe("Content-Length:");
  expect(init.result.capabilities.textDocumentSync).toBe(2);
  client.send({ method: "initialized", params: {} });
  const uri = pathToFileURL(gate).href;
  const text = `${readFileSync(gate, "utf8")}\n{{props.nope}}\n`;
  client.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "markdown", version: 1, text } } });
  const published = await client.waitFor((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri && m.params.diagnostics.length > 0);
  expect(published.params.diagnostics).toHaveLength(1);
  expect(published.params.diagnostics[0]).toMatchObject({ code: "unknown-prop", source: "skill-blocks", severity: 1 });
  const since = client.messages.length;
  client.send({ method: "textDocument/didChange", params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: readFileSync(gate, "utf8") }] } });
  const cleared = await client.waitFor((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri, since);
  expect(cleared.params.diagnostics).toEqual([]);
  expect(await client.stop()).toBe(0);
}

describe("rt skills lsp", () => {
  test("an unknown prop on an opened block file comes back as one published diagnostic", async () => {
    await unknownPropRoundTrip(new Client(["--root", plugin], home), {});
  }, 30_000);

  test("with no --root the initialize request's workspace folders are the roots", async () => {
    await unknownPropRoundTrip(new Client([], home), { rootUri: null, workspaceFolders: [{ uri: pathToFileURL(plugin).href, name: "mattstack" }] });
  }, 30_000);

  test("a hover on a props marker answers with markdown over the marker", async () => {
    const client = new Client(["--root", plugin], home);
    try {
      client.send({ id: 1, method: "initialize", params: { processId: null, capabilities: {} } });
      const init = await client.waitFor((m) => m.id === 1);
      expect(init.result.capabilities.hoverProvider).toBe(true);
      client.send({ method: "initialized", params: {} });
      const uri = pathToFileURL(gate).href;
      const text = readFileSync(gate, "utf8");
      client.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "markdown", version: 1, text } } });
      const line = text.split("\n").indexOf("{{props.tiering}}");
      client.send({ id: 2, method: "textDocument/hover", params: { textDocument: { uri }, position: { line, character: 4 } } });
      const hover = await client.waitFor((m) => m.id === 2);
      expect(hover.result.contents.kind).toBe("markdown");
      expect(hover.result.contents.value).toContain("**tiering** · replace");
      expect(hover.result.range).toEqual({ start: { line, character: 0 }, end: { line, character: "{{props.tiering}}".length } });
      expect(await client.stop()).toBe(0);
    } finally {
      client.kill();
    }
  }, 30_000);

  test("definition and completion answer over the wire", async () => {
    const client = new Client(["--root", plugin], home);
    try {
      client.send({ id: 1, method: "initialize", params: { processId: null, capabilities: {} } });
      const init = await client.waitFor((m) => m.id === 1);
      expect(init.result.capabilities.definitionProvider).toBe(true);
      expect(init.result.capabilities.completionProvider).toEqual({ triggerCharacters: [".", ":", '"', "/"] });
      client.send({ method: "initialized", params: {} });
      const uri = pathToFileURL(gate).href;
      const text = `${readFileSync(gate, "utf8")}\n{{props.\n`;
      client.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "markdown", version: 1, text } } });
      const lines = text.split("\n");
      client.send({ id: 2, method: "textDocument/definition", params: { textDocument: { uri }, position: { line: 1, character: 8 } } });
      const definition = await client.waitFor((m) => m.id === 2);
      const index = join(plugin, "attachments/pipeline/mini/index.block.md");
      expect(definition.result.map((l: { uri: string }) => l.uri)).toEqual([pathToFileURL(index).href]);
      const line = lines.indexOf("{{props.");
      client.send({ id: 3, method: "textDocument/completion", params: { textDocument: { uri }, position: { line, character: "{{props.".length } } });
      const completion = await client.waitFor((m) => m.id === 3);
      expect(completion.result.map((c: { label: string }) => c.label)).toEqual(["tiering"]);
      expect(completion.result[0].filterText).toBe("tiering");
      expect(completion.result[0].textEdit).toEqual({
        range: { start: { line, character: "{{props.".length }, end: { line, character: "{{props.".length } },
        newText: "tiering",
      });
      expect(await client.stop()).toBe(0);
    } finally {
      client.kill();
    }
  }, 30_000);

  test("prepareRename and rename answer over the wire, with the mattstack warning and a refusal", async () => {
    const plugins = join(tmp, "plugins/mattstack");
    cpSync(plugin, plugins, { recursive: true });
    const file = join(plugins, "attachments/pipeline/mini/gate.block.md");
    const client = new Client(["--root", plugins], home);
    try {
      client.send({ id: 1, method: "initialize", params: { processId: null, capabilities: {} } });
      const init = await client.waitFor((m) => m.id === 1);
      expect(init.result.capabilities.renameProvider).toEqual({ prepareProvider: true });
      client.send({ method: "initialized", params: {} });
      const uri = pathToFileURL(file).href;
      const text = readFileSync(file, "utf8");
      client.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "markdown", version: 1, text } } });
      const line = text.split("\n").indexOf("{{props.tiering}}");
      const position = { line, character: 10 };
      client.send({ id: 2, method: "textDocument/prepareRename", params: { textDocument: { uri }, position } });
      const prepared = await client.waitFor((m) => m.id === 2);
      expect(prepared.result).toEqual({ range: { start: { line, character: 8 }, end: { line, character: 15 } }, placeholder: "tiering" });
      client.send({ id: 3, method: "textDocument/rename", params: { textDocument: { uri }, position, newName: "model" } });
      const renamed = await client.waitFor((m) => m.id === 3);
      expect(renamed.result.changes[uri]).toHaveLength(2);
      expect(renamed.result.changes[uri]).toContainEqual({ range: { start: { line, character: 0 }, end: { line, character: 17 } }, newText: "{{props.model}}" });
      const shown = await client.waitFor((m) => m.method === "window/showMessageRequest");
      expect(shown.params).toMatchObject({ type: 2, message: expect.stringContaining("props-change: mini/gate.tiering: renamed to model") });
      client.send({ id: 4, method: "textDocument/rename", params: { textDocument: { uri }, position, newName: "Bad" } });
      const refused = (await client.waitFor((m) => m.id === 4)) as Message & { error?: { message: string } };
      expect(refused.result).toBeUndefined();
      expect(refused.error?.message).toContain('"Bad" is not a prop name');
      expect(await client.stop()).toBe(0);
    } finally {
      client.kill();
    }
  }, 30_000);

  test("a block rename answers with documentChanges, and a client that cannot rename files is refused", async () => {
    const root = join(tmp, "ws");
    const plugins = join(root, "plugins/mattstack");
    cpSync(plugin, plugins, { recursive: true });
    const mini = join(plugins, "attachments/pipeline/mini");
    const manifest = join(root, "skills.jsonc");
    writeFileSync(manifest, '{\n  "version": 2,\n  "bindings": {\n    "mattstack:mini/gate": { "tiering": "" }\n  }\n}\n');
    const uri = pathToFileURL(manifest).href;
    const position = { line: 3, character: 22 };
    const capable = { workspace: { workspaceEdit: { documentChanges: true, resourceOperations: ["create", "rename", "delete"] } } };
    for (const [capabilities, renames] of [[capable, true], [{}, false]] as const) {
      const client = new Client(["--root", root], home);
      try {
        client.send({ id: 1, method: "initialize", params: { processId: null, capabilities } });
        await client.waitFor((m) => m.id === 1);
        client.send({ method: "initialized", params: {} });
        client.send({ id: 2, method: "textDocument/prepareRename", params: { textDocument: { uri }, position } });
        const prepared = (await client.waitFor((m) => m.id === 2)) as Message & { error?: { message: string } };
        client.send({ id: 3, method: "textDocument/rename", params: { textDocument: { uri }, position, newName: "ask" } });
        const renamed = (await client.waitFor((m) => m.id === 3)) as Message & { error?: { message: string } };
        if (renames) {
          expect(prepared.result).toEqual({ range: { start: { line: 3, character: 20 }, end: { line: 3, character: 24 } }, placeholder: "gate" });
          expect(renamed.result.changes).toBeUndefined();
          expect(renamed.result.documentChanges).toEqual([
            { textDocument: { uri, version: null }, edits: [{ range: { start: { line: 3, character: 5 }, end: { line: 3, character: 24 } }, newText: "mattstack:mini/ask" }] },
            { kind: "rename", oldUri: pathToFileURL(join(mini, "gate.block.md")).href, newUri: pathToFileURL(join(mini, "ask.block.md")).href },
          ]);
          const shown = await client.waitFor((m) => m.method === "window/showMessageRequest");
          expect(shown.params.message).toContain("props-change: mini/gate.tiering: block renamed to mini/ask");
        } else {
          expect(prepared.error?.message).toBe("this editor cannot rename files, so it cannot rename a block");
          expect(renamed.error?.message).toBe("this editor cannot rename files, so it cannot rename a block");
        }
        expect(await client.stop()).toBe(0);
      } finally {
        client.kill();
      }
    }
  }, 60_000);

  test("a block moved on disk is followed through didRenameFiles and watched file changes", async () => {
    const root = join(tmp, "ws");
    const plugins = join(root, "plugins/mattstack");
    cpSync(plugin, plugins, { recursive: true });
    const mini = join(plugins, "attachments/pipeline/mini");
    const manifest = join(root, "skills.jsonc");
    const keyed = (id: string) => `{\n  "version": 2,\n  "bindings": {\n    "mattstack:mini/${id}": { "tiering": "" }\n  }\n}\n`;
    writeFileSync(manifest, keyed("gate"));
    const uri = pathToFileURL(manifest).href;
    const capabilities = { workspace: { workspaceEdit: { resourceOperations: ["rename"] }, didChangeWatchedFiles: { dynamicRegistration: true } } };
    const client = new Client(["--root", root], home);
    const diagnosticsFor = async (since: number) => (await client.waitFor((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri, since)).params.diagnostics;
    try {
      client.send({ id: 1, method: "initialize", params: { processId: null, capabilities } });
      const init = await client.waitFor((m) => m.id === 1);
      const filters = [
        { pattern: { glob: "**/*.block.md", matches: "file" } },
        { pattern: { glob: "**/*", matches: "folder" } },
        { pattern: { glob: "**/attachments/**", matches: "file" } },
        { pattern: { glob: "**/skills/**", matches: "file" } },
      ];
      expect(init.result.capabilities.workspace.fileOperations.didRename.filters).toEqual(filters);
      expect(init.result.capabilities.workspace.fileOperations.willRename.filters).toEqual(filters);
      client.send({ method: "initialized", params: {} });
      const registered = await client.waitFor((m) => m.method === "client/registerCapability");
      client.send({ id: registered.id, result: null });
      expect(registered.params.registrations[0]).toMatchObject({
        method: "workspace/didChangeWatchedFiles",
        registerOptions: { watchers: [{ globPattern: "**/*.block.md" }, { globPattern: "**/skills.jsonc" }, { globPattern: "**/.claude-plugin/plugin.json" }] },
      });

      let since = client.messages.length;
      client.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "jsonc", version: 1, text: keyed("ask") } } });
      expect((await diagnosticsFor(since)).map((d: { code: string }) => d.code)).toEqual(["missing-block"]);
      renameSync(join(mini, "gate.block.md"), join(mini, "ask.block.md"));
      since = client.messages.length;
      const files = [{ oldUri: pathToFileURL(join(mini, "gate.block.md")).href, newUri: pathToFileURL(join(mini, "ask.block.md")).href }];
      client.send({ method: "workspace/didRenameFiles", params: { files } });
      expect(await diagnosticsFor(since)).toEqual([]);

      since = client.messages.length;
      client.send({ method: "textDocument/didChange", params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: keyed("later") }] } });
      expect((await diagnosticsFor(since)).map((d: { code: string }) => d.code)).toEqual(["missing-block"]);
      const later = join(mini, "later.block.md");
      writeFileSync(later, '---\nprops:\n  tiering:\n    merge: replace\n    default: ""\n---\n\n# Later\n\n{{props.tiering}}\n');
      since = client.messages.length;
      client.send({ method: "workspace/didChangeWatchedFiles", params: { changes: [{ uri: pathToFileURL(later).href, type: 1 }] } });
      expect(await diagnosticsFor(since)).toEqual([]);
      expect(await client.stop()).toBe(0);
    } finally {
      client.kill();
    }
  }, 30_000);

  test("a plain markdown file outside any plugin stays silent and scans nothing until a block file opens", async () => {
    writeFileSync(gate, `${readFileSync(gate, "utf8")}\n{{props.nope}}\n`);
    const readme = join(tmp, "README.md");
    writeFileSync(readme, "# notes\n");
    const client = new Client(["--root", plugin], home);
    try {
      client.send({ id: 1, method: "initialize", params: { processId: null, capabilities: {} } });
      await client.waitFor((m) => m.id === 1);
      client.send({ method: "initialized", params: {} });
      const readmeUri = pathToFileURL(readme).href;
      client.send({ method: "textDocument/didOpen", params: { textDocument: { uri: readmeUri, languageId: "markdown", version: 1, text: "# notes\n" } } });
      client.send({ method: "textDocument/didChange", params: { textDocument: { uri: readmeUri, version: 2 }, contentChanges: [{ text: "# notes\nmore\n" }] } });
      client.send({ id: 2, method: "textDocument/hover", params: { textDocument: { uri: readmeUri }, position: { line: 0, character: 1 } } });
      expect((await client.waitFor((m) => m.id === 2)).result).toBeNull();
      await new Promise((r) => setTimeout(r, 1000));
      expect(client.messages.filter((m) => m.method === "textDocument/publishDiagnostics")).toEqual([]);
      const since = client.messages.length;
      const uri = pathToFileURL(gate).href;
      client.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "markdown", version: 1, text: readFileSync(gate, "utf8") } } });
      const published = await client.waitFor((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri && m.params.diagnostics.length > 0, since);
      expect(published.params.diagnostics[0]).toMatchObject({ code: "unknown-prop" });
      expect(await client.stop()).toBe(0);
    } finally {
      client.kill();
    }
  }, 30_000);

  test("a fill markdown file under attachments/ gets diagnostics and a quick fix", async () => {
    const pack = join(tmp, "widgets");
    cpSync(join(FIXTURES, "pack"), pack, { recursive: true });
    const fill = join(pack, "attachments/mini-rules/fast.md");
    const text = `${readFileSync(fill, "utf8")}\nRead ../../attachments/mini-rules/lint.sh first.\n`;
    writeFileSync(fill, text);
    const client = new Client(["--root", plugin, "--root", pack], home);
    try {
      client.send({ id: 1, method: "initialize", params: { processId: null, capabilities: {} } });
      await client.waitFor((m) => m.id === 1);
      client.send({ method: "initialized", params: {} });
      const uri = pathToFileURL(fill).href;
      client.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "markdown", version: 1, text } } });
      const published = await client.waitFor((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri && m.params.diagnostics.length > 0);
      const [diagnostic] = published.params.diagnostics;
      expect(diagnostic.code).toBe("hand-typed-path");
      client.send({ id: 2, method: "textDocument/codeAction", params: { textDocument: { uri }, range: diagnostic.range, context: { diagnostics: [diagnostic] } } });
      const actions = await client.waitFor((m) => m.id === 2);
      expect(actions.result).toHaveLength(1);
      expect(actions.result[0].kind).toBe("quickfix");
      expect(await client.stop()).toBe(0);
    } finally {
      client.kill();
    }
  }, 30_000);

  test("a hand-typed path's quick fix and a moved attachment's edits answer over the wire", async () => {
    const pack = join(tmp, "widgets");
    cpSync(join(FIXTURES, "pack"), pack, { recursive: true });
    const client = new Client(["--root", plugin, "--root", pack], home);
    try {
      client.send({ id: 1, method: "initialize", params: { processId: null, capabilities: {} } });
      const init = await client.waitFor((m) => m.id === 1);
      expect(init.result.capabilities.codeActionProvider).toEqual({ codeActionKinds: ["quickfix"] });
      client.send({ method: "initialized", params: {} });
      const uri = pathToFileURL(gate).href;
      const text = `${readFileSync(gate, "utf8")}\nRead ../../attachments/mini-rules/fast.md first.\n`;
      client.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "markdown", version: 1, text } } });
      const published = await client.waitFor((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri && m.params.diagnostics.length > 0);
      const [diagnostic] = published.params.diagnostics;
      expect(diagnostic.code).toBe("hand-typed-path");
      client.send({ id: 2, method: "textDocument/codeAction", params: { textDocument: { uri }, range: diagnostic.range, context: { diagnostics: [diagnostic] } } });
      const actions = await client.waitFor((m) => m.id === 2);
      expect(actions.result).toEqual([
        {
          title: "Use {{pack.path:mini-rules/fast.md}}",
          kind: "quickfix",
          diagnostics: [diagnostic],
          isPreferred: true,
          edit: { changes: { [uri]: [{ range: diagnostic.range, newText: "{{pack.path:mini-rules/fast.md}}" }] } },
        },
      ]);
      client.send({ method: "textDocument/didChange", params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: `${readFileSync(gate, "utf8")}\nRead {{pack.path:mini-rules/fast.md}} first.\n` }] } });
      const files = [{ oldUri: pathToFileURL(join(pack, "attachments/mini-rules")).href, newUri: pathToFileURL(join(pack, "attachments/quick-rules")).href }];
      client.send({ id: 3, method: "workspace/willRenameFiles", params: { files } });
      const will = await client.waitFor((m) => m.id === 3);
      expect(will.result.changes[uri]).toEqual([{ range: expect.any(Object), newText: "{{pack.path:quick-rules/fast.md}}" }]);
      expect(await client.stop()).toBe(0);
    } finally {
      client.kill();
    }
  }, 30_000);
});
