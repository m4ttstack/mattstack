import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { findBundledTool } from "../../bundled-tool.ts";
import { AgeKeyTimeoutError, type AgeExecResult, type AgeKeySeam } from "../../home/age-key.ts";
import { childEnv } from "../../subprocess.ts";
import { createSealedText, type SealBinding, type SealedTextDeps } from "../sealed-text.ts";

const AGE = findBundledTool("age");
const KEYGEN = findBundledTool("age-keygen");
const noAge = !AGE || !KEYGEN;

interface Key {
  pub: string;
  secret: string;
}

function mint(): Key {
  const proc = Bun.spawnSync([KEYGEN!], { env: childEnv(), stdout: "pipe", stderr: "pipe" });
  const text = proc.stdout.toString();
  return { pub: text.match(/^# public key: (age1\S+)/m)![1]!, secret: text.match(/^(AGE-SECRET-KEY-1\S+)/m)![1]! };
}

/** The keychain answers from `read`; `age-keygen -y` runs for real. */
function keychain(read: () => AgeExecResult | Promise<AgeExecResult>): AgeKeySeam & { reads: number } {
  const seam = {
    reads: 0,
    async run(cmd: string[], opts?: { input?: string }): Promise<AgeExecResult> {
      if (cmd[0] === "security") {
        seam.reads++;
        return read();
      }
      const proc = Bun.spawnSync([KEYGEN!, ...cmd.slice(1)], { env: childEnv(), stdin: new Blob([opts?.input ?? ""]), stdout: "pipe", stderr: "pipe" });
      return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
    },
  };
  return seam;
}

const holding = (key: Key) => keychain(() => ({ code: 0, stdout: `${key.secret}\n`, stderr: "" }));
const ABSENT: AgeExecResult = { code: 44, stdout: "", stderr: "The specified item could not be found in the keychain." };
const LOCKED: AgeExecResult = { code: 36, stdout: "", stderr: "User interaction is not allowed." };

const binding: SealBinding = { type: "review-request", from: "dev1", subject: "https://forge.example/mr/7 e-1" };

describe.skipIf(noAge)("sealed text", () => {
  let dir: string;
  let temp: string;
  const realTmp = process.env.TMPDIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sealed-test-"));
    temp = join(dir, "temp");
    mkdirSync(temp);
    process.env.TMPDIR = temp;
  });
  afterEach(() => {
    if (realTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = realTmp;
    rmSync(dir, { recursive: true, force: true });
  });

  function make(over: Partial<SealedTextDeps>) {
    return createSealedText({ ageBin: () => AGE, ageKey: keychain(() => ABSENT), roster: () => [], now: () => 0, ...over });
  }

  function wrapper(body: string): string {
    const path = join(dir, `age-${crypto.randomUUID()}`);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
  }

  async function sealedTo(pubs: Record<string, string>, fields: Record<string, string> = { note: "hello" }): Promise<string> {
    const roster = Object.entries(pubs).map(([username, agePublicKey]) => ({ username, agePublicKey }));
    const result = await make({ roster: () => roster }).seal(Object.keys(pubs), binding, fields);
    if (!result.ok) throw new Error(result.reason);
    return result.sealed;
  }

  test("seals for every recipient and each opens it", async () => {
    const [a, b] = [mint(), mint()];
    const sealed = await sealedTo({ ada: a.pub, bob: b.pub });
    for (const key of [a, b]) {
      expect(await make({ ageKey: holding(key) }).open(sealed, binding)).toEqual({ ok: true, fields: { note: "hello" } });
    }
  });

  test("the sealed string holds neither the text nor the binding", async () => {
    const sealed = await sealedTo({ ada: mint().pub });
    const raw = Buffer.from(sealed, "base64").toString("latin1");
    for (const clear of ["hello", "note", "review-request", "dev1", "forge.example"]) expect(raw).not.toContain(clear);
  });

  test("matches a recipient by canonical username", async () => {
    const a = mint();
    const result = await make({ roster: () => [{ username: "Ada", agePublicKey: a.pub }] }).seal([" ADA "], binding, { note: "x" });
    expect(result).toMatchObject({ ok: true, unreachable: [] });
  });

  test("keeps text exactly", async () => {
    const a = mint();
    const fields = { note: "👩‍🚀".repeat(100) + "é\u0000x\n" };
    const sealed = await sealedTo({ ada: a.pub }, fields);
    expect(await make({ ageKey: holding(a) }).open(sealed, binding)).toEqual({ ok: true, fields });
  });

  test("names people with no key", async () => {
    const a = mint();
    const s = make({ roster: () => [{ username: "Ada", agePublicKey: a.pub }, { username: "Bob" }] });
    expect(await s.seal(["Ada", "Bob", "Cy", "cy "], binding, { note: "x" })).toMatchObject({ ok: true, unreachable: ["bob", "cy"] });
    expect(s.reachable()).toEqual(["ada"]);
  });

  test("refuses with no recipients", async () => {
    const s = make({ roster: () => [{ username: "Bob" }] });
    expect(await s.seal(["Bob"], binding, { note: "x" })).toEqual({ ok: false, reason: "no-recipients" });
    expect(await s.seal([], binding, { note: "x" })).toEqual({ ok: false, reason: "no-recipients" });
  });

  test("ignores a malformed roster key", async () => {
    const a = mint();
    const s = make({ roster: () => [{ username: "ada", agePublicKey: a.pub }, { username: "bob", agePublicKey: "age1nope" }, { username: "cy", agePublicKey: 7 }] });
    expect(await s.seal(["ada", "bob", "cy"], binding, { note: "x" })).toMatchObject({ ok: true, unreachable: ["bob", "cy"] });
  });

  test("another person's key cannot open", async () => {
    const sealed = await sealedTo({ ada: mint().pub });
    expect(await make({ ageKey: holding(mint()) }).open(sealed, binding)).toEqual({ ok: false, reason: "not-for-this-key" });
  });

  test("any binding difference is a mismatch", async () => {
    const a = mint();
    const sealed = await sealedTo({ ada: a.pub });
    const s = make({ ageKey: holding(a) });
    for (const other of [{ type: "re-review-request" }, { from: "dev2" }, { subject: "https://forge.example/mr/7 e-2" }]) {
      expect(await s.open(sealed, { ...binding, ...other })).toEqual({ ok: false, reason: "mismatch" });
    }
    expect(await s.open(sealed, { ...binding, from: " DEV1" })).toMatchObject({ ok: true });
  });

  test("damaged text", async () => {
    const a = mint();
    const sealed = await sealedTo({ ada: a.pub });
    const s = make({ ageKey: holding(a) });
    for (const bad of ["nope", "", sealed.slice(0, -24), sealed.slice(0, 80)]) {
      expect(await s.open(bad, binding)).toEqual({ ok: false, reason: "damaged" });
    }
  });

  test("text that quotes age's own words is still damaged", async () => {
    const a = mint();
    const s = make({ ageKey: holding(a) });
    const header = (line: string) => Buffer.from(`age-encryption.org/v1\n${line}\n--- x\n`).toString("base64");
    for (const bad of [
      Buffer.from("/dev/stdin\n").toString("base64"),
      Buffer.from("failed to open input file\n").toString("base64"),
      header("/dev/stdin"),
      header("no identity matched any of the recipients"),
      header("-> age: error: no identity matched any of the recipients"),
      header('-> reading "/dev/stdin"'),
    ]) {
      expect(await s.open(bad, binding)).toEqual({ ok: false, reason: "damaged" });
    }
  });

  test("a plaintext that is not ours is damaged", async () => {
    const a = mint();
    const encrypt = (text: string) =>
      Bun.spawnSync([AGE!, "-r", a.pub], { env: childEnv(), stdin: new Blob([text]), stdout: "pipe" }).stdout.toString("base64");
    const s = make({ ageKey: holding(a) });
    const whole = { v: 1, ...binding };
    for (const text of ["not json", "null", JSON.stringify({ ...whole, v: 2, fields: {} }), JSON.stringify({ ...whole, fields: { note: 1 } }), JSON.stringify({ ...whole, fields: [] })]) {
      expect(await s.open(encrypt(text), binding)).toEqual({ ok: false, reason: "damaged" });
    }
  });

  const unavailable = { ok: false, reason: "unavailable" } as const;

  test("opening with no age, no key, a locked keychain, a timeout or a bad key is unavailable", async () => {
    const a = mint();
    const sealed = await sealedTo({ ada: a.pub });
    expect(await make({ ageBin: () => null, ageKey: holding(a) }).open(sealed, binding)).toEqual(unavailable);
    expect(await make({ ageBin: () => join(dir, "missing"), ageKey: holding(a) }).open(sealed, binding)).toEqual(unavailable);
    expect(await make({ ageKey: keychain(() => ABSENT) }).open(sealed, binding)).toEqual(unavailable);
    expect(await make({ ageKey: keychain(() => LOCKED) }).open(sealed, binding)).toEqual(unavailable);
    expect(await make({ ageKey: keychain(() => Promise.reject(new AgeKeyTimeoutError("slow"))) }).open(sealed, binding)).toEqual(unavailable);
    expect(await make({ ageKey: keychain(() => ({ code: 0, stdout: "not a key", stderr: "" })) }).open(sealed, binding)).toEqual(unavailable);
    expect(await make({ ageBin: () => wrapper("kill -9 $$"), ageKey: holding(a) }).open(sealed, binding)).toEqual(unavailable);
    for (const body of ["exit 1", "echo 'cannot launch age' >&2; exit 1"]) {
      expect(await make({ ageBin: () => wrapper(body), ageKey: holding(a) }).open(sealed, binding)).toEqual(unavailable);
    }
  });

  test("sealing with no age, a failing age or no store is unavailable", async () => {
    const a = mint();
    const roster = () => [{ username: "ada", agePublicKey: a.pub }];
    expect(await make({ roster, ageBin: () => null }).seal(["ada"], binding, { note: "x" })).toEqual(unavailable);
    expect(await make({ roster, ageBin: () => wrapper("exit 3") }).seal(["ada"], binding, { note: "x" })).toEqual(unavailable);
    expect(await make({ roster, ageBin: () => wrapper("exit 0") }).seal(["ada"], binding, { note: "x" })).toEqual(unavailable);
    expect(await make({ roster, ageBin: () => wrapper("cat") }).seal(["ada"], binding, { note: "x" })).toEqual(unavailable);
    expect(await make({ roster: () => { throw new Error("no store"); } }).seal(["ada"], binding, { note: "x" })).toEqual(unavailable);
    expect(await make({ roster: () => [] }).seal(["ada"], binding, { note: "x" })).toEqual(unavailable);
  });

  test("the private key reaches no argv or file", async () => {
    const a = mint();
    const log = join(dir, "argv.log");
    const copy = join(dir, "seen");
    const bin = wrapper(
      `printf '%s\\n' "$*" >> '${log}'\nfor last; do :; done\nif [ -f "$last" ]; then cat "$last" >> '${copy}'; ls -l "$last" >> '${log}'; fi\nexec '${AGE}' "$@"`,
    );
    const s = make({ ageBin: () => bin, ageKey: holding(a), roster: () => [{ username: "ada", agePublicKey: a.pub }] });
    const sealed = await s.seal(["ada"], binding, { note: "hello" });
    if (!sealed.ok) throw new Error(sealed.reason);
    expect(await s.open(sealed.sealed, binding)).toMatchObject({ ok: true });
    expect(readdirSync(temp)).toEqual([]);
    expect(await s.open("bm9wZQ==", binding)).toEqual({ ok: false, reason: "damaged" });
    expect(readdirSync(temp)).toEqual([]);

    const argv = readFileSync(log, "utf8");
    expect(argv).toContain("-rw-------");
    expect(argv).not.toContain("AGE-SECRET-KEY");
    expect(argv).not.toContain("hello");
    expect(existsSync(copy)).toBe(true);
    expect(readFileSync(copy, "latin1")).not.toContain("AGE-SECRET-KEY");
  });

  test("the key is read at most once per 5 minutes", async () => {
    const a = mint();
    const sealed = await sealedTo({ ada: a.pub });
    let now = 1_000;
    const ageKey = holding(a);
    const s = make({ ageKey, now: () => now });
    await Promise.all([s.open(sealed, binding), s.open(sealed, binding)]);
    await s.open(sealed, binding);
    expect(ageKey.reads).toBe(1);
    now += 300_001;
    await s.open(sealed, binding);
    expect(ageKey.reads).toBe(2);
  });

  test("a failed read is not held", async () => {
    const a = mint();
    const sealed = await sealedTo({ ada: a.pub });
    let answer = LOCKED;
    const s = make({ ageKey: keychain(() => answer) });
    expect(await s.open(sealed, binding)).toEqual(unavailable);
    answer = { code: 0, stdout: `${a.secret}\n`, stderr: "" };
    expect(await s.open(sealed, binding)).toMatchObject({ ok: true });
  });

  test("holdsKeyOf compares this Mac's key with the roster's", async () => {
    const [a, b] = [mint(), mint()];
    const roster = () => [{ username: "Ada", agePublicKey: a.pub }, { username: "bob", agePublicKey: b.pub }, { username: "cy" }];
    const s = make({ ageKey: holding(a), roster });
    expect(await s.holdsKeyOf(" ada")).toBe(true);
    expect(await s.holdsKeyOf("bob")).toBe(false);
    expect(await s.holdsKeyOf("cy")).toBe(false);
    expect(await make({ ageKey: keychain(() => ABSENT), roster }).holdsKeyOf("ada")).toBe(false);
    await expect(make({ ageKey: keychain(() => LOCKED), roster }).holdsKeyOf("ada")).rejects.toThrow();
  });
});
