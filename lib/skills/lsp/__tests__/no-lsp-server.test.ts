import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
});
