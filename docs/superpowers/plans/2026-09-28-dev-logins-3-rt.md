# Dev logins (rt) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give rt a place to keep dev-server logins per site (sops store), a daemon verb that releases one value only to a matching page, `rt logins` verbs, and a Dev logins pane plus `mattstack://dev-logins/add` link in mattstack.app.

**Architecture:** A `dev-logins` domain in the personal sops store holds one JSON value per origin. `lib/logins/` owns origin rules, the store facade and the in-memory attempt limiter; `lib/daemon/handlers/logins.ts` serves `logins:fill` over the unix socket only; `commands/logins.ts` is the CLI. The app gets a core model (`DevLoginsModel`), a link parser, and a SwiftUI pane and sheet that drive `rt logins` with values on stdin.

**Tech Stack:** Bun + TypeScript (rt CLI and daemon), `bun:test`; Swift 6 / SwiftUI / AppKit (rt-tray), MattstackCoreChecks via `swift run mattstack-checks`, XCUITest with the stub rt.

**Spec:** `docs/superpowers/specs/2026-09-28-dev-logins-design.md` (sections 1, 2 and 6 are this plan; sections 3 to 5 are the Playwright fork, Fast Browser and team pack plans).

## Global Constraints

Cross-repo contracts, verbatim:

- B. Daemon verb `logins:fill`, socket transport only (never in REST_ROUTES): standard `POST http://localhost/logins:fill`, body `{"token","client","pid","name","frameOrigin","elementKind":"password"|"text"}`. Token-gated like secrets:read. Order: resolve name (unknown -> refused unknown) -> origin/kind check (mismatch -> refused mismatch, no value, no attempt counted) -> for password names the attempt limit (1 per login per 5 min, 5 per login per day, in daemon memory, reset when `add` replaces that login; limited -> refused limited with `until` epoch ms) -> `{origin, kind, value}`. Refusals are `ok:true` data `{refused, until?}`; `ok:false` only for bad token or malformed input. Log every answer/refusal at info with name, origin, caller-declared client+pid marked unverified, never the value.
- C. Names `devlogin:<key>:email|password`; key = host, then `_<port>` if not scheme default, then `_http` if http; hosts containing `_` refused; https any host, http only localhost/127.0.0.1; lowercase + punycode; no path/query/fragment. `rt logins list --json` -> `[{origin, email, fields:{email, password}}]`.
- F. Link `mattstack://dev-logins/add?origin=<encodeURIComponent(origin)>`; only `origin` read; `rt logins open-add <origin> --json` -> `{"ok":true,"url"}` and opens it; agent-safe leaf. `add` (hidden prompts; `--json` reads `{email,password}` on stdin) and `remove` are not agent-safe. Storage: user secrets domain `dev-logins`, value JSON `{origin,email,password}`, never team store.
- App: Settings window gets a Dev logins pane (post-install), rows origin/email/dots, Add/Replace/Delete, no reveal; add sheet with SecureField; first-time origin requires typing the host before Save enables; warnings for xn-- and http; link route buffered for launch-by-link.

Repo rules:

- rt is public. Fixtures use neutral names only (`login.example.com`, `acme`, `dev@example.com`). Run `scripts/repo-purity.sh` before every push.
- No em dashes or en dashes anywhere (code, comments, commit messages, UI copy).
- Clean-code comments: a comment states a constraint the code cannot show; no narration, no review or task references, no decision history.
- Never run a built binary without an isolated HOME (`env -i HOME=<temp> ...`). Never rebuild, re-sign or reinstall `/Applications/mattstack.app` or `/Applications/mattstack-dev.app` from this plan; tray work builds and tests from the worktree's `rt-tray/` with `swift run` and `xcodebuild test`.
- Run `bun test` from the repo root only (bunfig preload isolates HOME). Name any test that reads source as text `no-*.test.ts`.
- A value (email or password) never appears in argv, a log line, a bus event, an error message, or `rt logins list` output.
- Every security test must fail when its protection is removed; after writing one, break the code once and watch it fail.
- No `SCHEMA_VERSION` change: the attempt limit lives in daemon memory.
- UI validation is mandatory: screenshot the Dev logins pane (empty and with a row), the add sheet (first-time, Save disabled until the host is typed) and the replace sheet, in light and dark, and look at them before calling Task 9 done.
- After touching `packages/rt-client/src`, run `bun run build` in `packages/rt-client`.

## Review Focus

1. The same site typed differently (`https://Login.Example.com:443/`) must land on the same saved login as `https://login.example.com`, so a re-save replaces instead of duplicating. Test in Task 2.
2. `http://localhost:3000` and `https://localhost:3000` are different logins with different keys. Test in Task 2.
3. A password with JSON-special and URL-special characters (`p@ss"\&+% ü`) survives `rt logins add --json` stdin verbatim. Test in Task 6.
4. `rt logins add` on a machine with no age key yet prints the `rt home init` pointer and exits non-zero instead of a stack trace. Test in Task 6.
5. An identifier-first page fills the email first: an email fill never consumes a password attempt. Test in Task 5.

---

### Task 1: `removeSecret` in the personal secrets store

**Files:**
- Modify: `lib/secrets/store.ts` (`encryptAtLocation` around line 299; add `encryptVerifiedAtLocation` and `removeSecret` after `writeSecret` at line 420)
- Test: `lib/secrets/__tests__/store.test.ts` (append a `describe("removeSecret")`)

**Interfaces:**
- Produces: `removeSecret(domain: string, key: string, seams: SecretsSeams): Promise<boolean>` (true when the key existed and was removed).

- [ ] **Step 1: Write the failing tests**

Append to `lib/secrets/__tests__/store.test.ts` (reuses the file's `FakeSecretsExecSeam`, `fakeAgeKeySeamWithKey` and `stagingPath` helpers; add `removeSecret` to the import list at the top):

```ts
describe("removeSecret", () => {
  test("re-encrypts the domain without the key and publishes it", async () => {
    const domain = "rt";
    let staged: string | undefined;
    const execSeam: FakeSecretsExecSeam = new FakeSecretsExecSeam({
      decrypt: () => ({ code: 0, stdout: JSON.stringify({ a: "1", b: "2" }), stderr: "" }),
      encrypt: () => {
        staged = execSeam.files.get(stagingPath(domain));
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    execSeam.writeFile(secretsFilePath(domain), "ciphertext");
    const seams: SecretsSeams = { ageKeySeam: fakeAgeKeySeamWithKey("AGE-X"), execSeam };

    expect(await removeSecret(domain, "a", seams)).toBe(true);
    expect(JSON.parse(staged!)).toEqual({ b: "2" });
    expect(execSeam.fsyncAndRenameCalls.map((c) => c.to)).toEqual([secretsFilePath(domain)]);
    expect(execSeam.files.has(stagingPath(domain))).toBe(false);
  });

  test("an absent key is a no-op: false, no encrypt", async () => {
    const execSeam = new FakeSecretsExecSeam({ decrypt: () => ({ code: 0, stdout: JSON.stringify({ b: "2" }), stderr: "" }) });
    execSeam.writeFile(secretsFilePath("rt"), "ciphertext");
    const seams: SecretsSeams = { ageKeySeam: fakeAgeKeySeamWithKey("AGE-X"), execSeam };

    expect(await removeSecret("rt", "a", seams)).toBe(false);
    expect(execSeam.calls.some((c) => c.cmd[1] === "-e")).toBe(false);
  });

  test("a missing domain file is false with no sops or keychain call", async () => {
    const execSeam = new FakeSecretsExecSeam();
    const seams: SecretsSeams = { ageKeySeam: fakeAgeKeySeamThrows(), execSeam };

    expect(await removeSecret("rt", "a", seams)).toBe(false);
    expect(execSeam.calls).toEqual([]);
  });

  test("a read-back that still holds the key refuses and leaves the target untouched", async () => {
    const execSeam = new FakeSecretsExecSeam({
      decrypt: () => ({ code: 0, stdout: JSON.stringify({ a: "1" }), stderr: "" }),
      encryptOutputContent: "garbled",
    });
    execSeam.writeFile(secretsFilePath("rt"), "ciphertext");
    const seams: SecretsSeams = { ageKeySeam: fakeAgeKeySeamWithKey("AGE-X"), execSeam };

    await expect(removeSecret("rt", "a", seams)).rejects.toThrow(/read-back/);
    expect(execSeam.fsyncAndRenameCalls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/secrets/__tests__/store.test.ts -t removeSecret`
Expected: FAIL with `removeSecret` not exported.

- [ ] **Step 3: Implement**

In `lib/secrets/store.ts`, split the read-back check out of `encryptAtLocation` so a delete can verify absence. Replace the body of `encryptAtLocation` with a call into a new verified variant:

```ts
export async function encryptAtLocation(
  location: SecretsLocation,
  stagingKey: string,
  payload: Record<string, string>,
  key: string,
  value: string,
  env: Record<string, string>,
  execSeam: SecretsExecSeam,
): Promise<void> {
  await encryptVerifiedAtLocation(location, stagingKey, payload, (rt) => rt?.[key] === value, `round-trip "${key}"`, env, execSeam);
}

export async function encryptVerifiedAtLocation(
  location: SecretsLocation,
  stagingKey: string,
  payload: Record<string, string>,
  verify: (roundTripped: Record<string, string> | undefined) => boolean,
  expectation: string,
  env: Record<string, string>,
  execSeam: SecretsExecSeam,
): Promise<void> {
  const stagingDir = join(rtDir(), "tmp");
  execSeam.ensureDir(stagingDir, 0o700);
  execSeam.ensureDir(dirname(location.filePath), 0o700);

  const stagingPath = join(stagingDir, `${stagingKey}.${process.pid}.json`);
  const outputTmpPath = `${location.filePath}.${process.pid}.tmp`;

  try {
    execSeam.writeFile(stagingPath, JSON.stringify(payload, null, 2));

    const result = await execSeam.run(
      ["sops", "-e", "--filename-override", location.filenameOverride, "--output", outputTmpPath, stagingPath],
      { sensitive: true },
    );
    if (result.code !== 0) {
      throw new Error(
        `sops -e ${stagingKey}: encryption failed: ${result.stderr}\n` +
          "no plaintext was left on disk (staging files are always cleaned up)",
      );
    }

    execSeam.chmod(outputTmpPath, 0o600);

    const decryptResult = await execSeam.run(
      ["sops", "-d", "--input-type", "json", "--output-type", "json", outputTmpPath],
      { env, sensitive: true },
    );
    let roundTripped: Record<string, string> | undefined;
    if (decryptResult.code === 0) {
      try {
        roundTripped = JSON.parse(decryptResult.stdout);
      } catch {
        roundTripped = undefined;
      }
    }
    if (!verify(roundTripped)) {
      throw new Error(
        `sops -e ${stagingKey}: post-encrypt read-back of ${outputTmpPath} does not ${expectation}; ` +
          `refusing to declare success (${location.filePath} was left untouched)`,
      );
    }

    execSeam.fsyncAndRename(outputTmpPath, location.filePath);
    execSeam.chmod(location.filePath, 0o600);
  } finally {
    execSeam.removeFile(stagingPath);
    execSeam.removeFile(outputTmpPath);
  }
}
```

Move the existing doc comment on `encryptAtLocation` and its two inline comments (the umask `chmod` one and the `.tmp` store-type one) onto `encryptVerifiedAtLocation` verbatim; the code above omits them only to keep this plan short. Before replacing the error strings, run `rg -n "encryption failed|does not round-trip" lib/ packages/ e2e/` and update any test that matches the old wording. Then add after `writeSecret`:

```ts
export async function removeSecret(domain: string, key: string, seams: SecretsSeams): Promise<boolean> {
  validateKey(key);
  const location = personalLocation(domain);
  if (!seams.execSeam.fileExists(location.filePath)) return false;
  const env = await sopsAgeKeyEnv(seams.ageKeySeam);
  const existing = freshMemoEntry(domain, location.filePath, seams) ?? (await sopsDecrypt(location.filePath, env, seams.execSeam));
  if (!(key in existing)) return false;
  domainMemo.delete(domain);
  const { [key]: _removed, ...rest } = existing;
  await encryptVerifiedAtLocation(location, domain, rest, (rt) => rt !== undefined && !(key in rt), `drop "${key}"`, env, seams.execSeam);
  return true;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/secrets/__tests__/store.test.ts lib/secrets/__tests__/team-store.test.ts`
Expected: PASS (team-store still passes, proving the refactor kept `encryptAtLocation`'s behavior).

- [ ] **Step 5: Commit**

```bash
git add lib/secrets/store.ts lib/secrets/__tests__/store.test.ts
git commit -m "secrets: add removeSecret with an absence read-back"
```

---

### Task 2: Origin rules and placeholder names

**Files:**
- Create: `lib/logins/origin.ts`
- Test: `lib/logins/__tests__/origin.test.ts`

**Interfaces:**
- Produces:
  - `class InvalidOriginError extends Error`
  - `normalizeOrigin(input: string): { origin: string; key: string }` (throws `InvalidOriginError`)
  - `type LoginKind = "email" | "password"`
  - `placeholderName(key: string, kind: LoginKind): string`
  - `parsePlaceholder(name: string): { key: string; kind: LoginKind } | null`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import { InvalidOriginError, normalizeOrigin, parsePlaceholder, placeholderName } from "../origin.ts";

describe("normalizeOrigin", () => {
  test("https host keys to the bare host", () => {
    expect(normalizeOrigin("https://login.example.com")).toEqual({ origin: "https://login.example.com", key: "login.example.com" });
  });

  test("case, trailing slash and an explicit default port collapse to one login", () => {
    expect(normalizeOrigin("https://Login.Example.com:443/")).toEqual(normalizeOrigin("https://login.example.com"));
  });

  test("non-default port and http localhost get distinct keys", () => {
    expect(normalizeOrigin("http://localhost:3000").key).toBe("localhost_3000_http");
    expect(normalizeOrigin("https://localhost:3000").key).toBe("localhost_3000");
    expect(normalizeOrigin("http://127.0.0.1:8080").key).toBe("127.0.0.1_8080_http");
  });

  test("an international host is stored as punycode", () => {
    expect(normalizeOrigin("https://bücher.example").key).toBe("xn--bcher-kva.example");
  });

  test.each([
    ["http for a non-local host", "http://login.example.com"],
    ["a path", "https://login.example.com/u/login"],
    ["a query", "https://login.example.com/?state=x"],
    ["a fragment", "https://login.example.com/#x"],
    ["user info", "https://dev:pw@login.example.com"],
    ["an underscore host", "https://log_in.example.com"],
    ["an IPv6 host", "https://[::1]"],
    ["another scheme", "ftp://login.example.com"],
    ["no scheme", "login.example.com"],
    ["an empty string", ""],
  ])("refuses %s", (_label, input) => {
    expect(() => normalizeOrigin(input)).toThrow(InvalidOriginError);
  });

  test("a refusal never echoes user info from the input", () => {
    try {
      normalizeOrigin("https://dev:hunter2@login.example.com");
      throw new Error("expected a refusal");
    } catch (err) {
      expect(String((err as Error).message)).not.toContain("hunter2");
    }
  });
});

describe("placeholders", () => {
  test("round-trip", () => {
    expect(placeholderName("localhost_3000_http", "password")).toBe("devlogin:localhost_3000_http:password");
    expect(parsePlaceholder("devlogin:login.example.com:email")).toEqual({ key: "login.example.com", kind: "email" });
  });

  test.each(["login.example.com:password", "devlogin:login.example.com", "devlogin:a/b:password", "devlogin:x:token", "DEVLOGIN:x:email"])(
    "rejects %s",
    (name) => expect(parsePlaceholder(name)).toBeNull(),
  );
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/logins/__tests__/origin.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/logins/origin.ts`**

```ts
export type LoginKind = "email" | "password";

export class InvalidOriginError extends Error {}

const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1"]);

// The WHATWG URL parser lowercases the host, IDN-encodes it to punycode and
// drops a default port, so equal sites produce equal keys.
export function normalizeOrigin(input: string): { origin: string; key: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new InvalidOriginError("not an origin; write it like https://login.example.com");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new InvalidOriginError("only https and http origins can hold a dev login");
  if (url.username || url.password) throw new InvalidOriginError("an origin carries no user name or password");
  if (url.pathname !== "/" || url.search || url.hash) throw new InvalidOriginError("an origin has no path, query or fragment");
  const host = url.hostname;
  if (!host || host.startsWith("[")) throw new InvalidOriginError("the host must be a name or an IPv4 address");
  if (host.includes("_")) throw new InvalidOriginError("hosts containing _ are not supported");
  if (url.protocol === "http:" && !LOCAL_HTTP_HOSTS.has(host)) {
    throw new InvalidOriginError("http is allowed only for localhost and 127.0.0.1; use https");
  }
  const key = `${host}${url.port ? `_${url.port}` : ""}${url.protocol === "http:" ? "_http" : ""}`;
  return { origin: url.origin, key };
}

export function placeholderName(key: string, kind: LoginKind): string {
  return `devlogin:${key}:${kind}`;
}

export function parsePlaceholder(name: string): { key: string; kind: LoginKind } | null {
  const m = /^devlogin:([A-Za-z0-9][A-Za-z0-9_.-]*):(email|password)$/.exec(name);
  return m ? { key: m[1]!, kind: m[2] as LoginKind } : null;
}
```

If the punycode test fails under Bun, import `domainToASCII` from `node:url` and apply it to `url.hostname` before the checks; keep the test as written.

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/logins/__tests__/origin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/logins/origin.ts lib/logins/__tests__/origin.test.ts
git commit -m "logins: origin rules, keys and devlogin placeholder names"
```

---

### Task 3: The dev-logins store facade

**Files:**
- Create: `lib/logins/store.ts`
- Test: `lib/logins/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `normalizeOrigin`, `placeholderName` (Task 2); `readSecret`, `writeSecret`, `listSecretNames`, `removeSecret` (Task 1).
- Produces:
  - `DEV_LOGINS_DOMAIN = "dev-logins"`
  - `interface DevLogin { origin: string; email: string; password: string }`
  - `interface DevLoginSummary { origin: string; email: string; fields: { email: string; password: string } }`
  - `interface LoginsBackend { read(key: string): Promise<string | null>; names(): Promise<string[]>; write(key: string, value: string): Promise<void>; remove(key: string): Promise<boolean> }`
  - `secretsBackend(seams: SecretsSeams): LoginsBackend`
  - `class InvalidLoginError extends Error`, `class CorruptLoginError extends Error`
  - `listLogins(b): Promise<DevLoginSummary[]>`, `getLogin(b, key): Promise<DevLogin | null>`, `saveLogin(b, origin, email, password): Promise<{ origin: string; key: string; replaced: boolean }>`, `removeLogin(b, origin): Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import { CorruptLoginError, InvalidLoginError, getLogin, listLogins, removeLogin, saveLogin, type LoginsBackend } from "../store.ts";
import { InvalidOriginError } from "../origin.ts";

const CANARY = "Canary p@ss&+% ü";

function memoryBackend(seed: Record<string, string> = {}): LoginsBackend & { data: Record<string, string>; writes: number } {
  const b = {
    data: { ...seed },
    writes: 0,
    async read(key: string) { return b.data[key] ?? null; },
    async names() { return Object.keys(b.data); },
    async write(key: string, value: string) { b.writes++; b.data[key] = value; },
    async remove(key: string) { const had = key in b.data; delete b.data[key]; return had; },
  };
  return b;
}

describe("dev logins store", () => {
  test("save then list shows origin, email and placeholder names, never the password", async () => {
    const b = memoryBackend();
    expect(await saveLogin(b, "https://login.example.com/", " dev@example.com ", CANARY)).toEqual({
      origin: "https://login.example.com", key: "login.example.com", replaced: false,
    });
    const list = await listLogins(b);
    expect(list).toEqual([{
      origin: "https://login.example.com",
      email: "dev@example.com",
      fields: { email: "devlogin:login.example.com:email", password: "devlogin:login.example.com:password" },
    }]);
    expect(JSON.stringify(list)).not.toContain(CANARY);
  });

  test("saving the same site again replaces it", async () => {
    const b = memoryBackend();
    await saveLogin(b, "https://login.example.com", "a@example.com", "one");
    expect((await saveLogin(b, "https://LOGIN.example.com:443", "b@example.com", "two")).replaced).toBe(true);
    expect(await getLogin(b, "login.example.com")).toEqual({ origin: "https://login.example.com", email: "b@example.com", password: "two" });
  });

  test("a bad origin or empty field is refused before anything is written", async () => {
    const b = memoryBackend();
    await expect(saveLogin(b, "http://login.example.com", "a@example.com", "pw")).rejects.toThrow(InvalidOriginError);
    await expect(saveLogin(b, "https://login.example.com", "  ", "pw")).rejects.toThrow(InvalidLoginError);
    await expect(saveLogin(b, "https://login.example.com", "a@example.com", "")).rejects.toThrow(InvalidLoginError);
    expect(b.writes).toBe(0);
  });

  test("remove reports whether a login existed; listing an empty store is []", async () => {
    const b = memoryBackend();
    await saveLogin(b, "https://login.example.com", "a@example.com", "pw");
    expect(await removeLogin(b, "https://login.example.com")).toBe(true);
    expect(await removeLogin(b, "https://login.example.com")).toBe(false);
    expect(await listLogins(b)).toEqual([]);
  });

  test("a corrupt entry names its key and never its content", async () => {
    const b = memoryBackend({ "login.example.com": `{"origin":"https://other.example.com","email":"a@example.com","password":"${CANARY}"}` });
    const err = await getLogin(b, "login.example.com").catch((e) => e);
    expect(err).toBeInstanceOf(CorruptLoginError);
    expect(String(err.message)).toContain("login.example.com");
    expect(String(err.message)).not.toContain(CANARY);
  });

  test("an unknown key is null", async () => {
    expect(await getLogin(memoryBackend(), "login.example.com")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/logins/__tests__/store.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/logins/store.ts`**

```ts
import { listSecretNames, readSecret, removeSecret, writeSecret, type SecretsSeams } from "../secrets/store.ts";
import { normalizeOrigin, placeholderName } from "./origin.ts";

export const DEV_LOGINS_DOMAIN = "dev-logins";

export interface DevLogin { origin: string; email: string; password: string }
export interface DevLoginSummary { origin: string; email: string; fields: { email: string; password: string } }

export interface LoginsBackend {
  read(key: string): Promise<string | null>;
  names(): Promise<string[]>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<boolean>;
}

export class InvalidLoginError extends Error {}
export class CorruptLoginError extends Error {}

export function secretsBackend(seams: SecretsSeams): LoginsBackend {
  return {
    read: (key) => readSecret(DEV_LOGINS_DOMAIN, key, seams),
    names: () => listSecretNames(DEV_LOGINS_DOMAIN, seams),
    write: (key, value) => writeSecret(DEV_LOGINS_DOMAIN, key, value, seams),
    remove: (key) => removeSecret(DEV_LOGINS_DOMAIN, key, seams),
  };
}

function parse(key: string, raw: string): DevLogin {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new CorruptLoginError(`dev login "${key}" is not valid JSON; replace it with rt logins add`);
  }
  const o = v as Partial<DevLogin>;
  if (typeof o.origin !== "string" || typeof o.email !== "string" || typeof o.password !== "string") {
    throw new CorruptLoginError(`dev login "${key}" is missing a field; replace it with rt logins add`);
  }
  let normalizedKey: string;
  try {
    normalizedKey = normalizeOrigin(o.origin).key;
  } catch {
    normalizedKey = "";
  }
  if (normalizedKey !== key) throw new CorruptLoginError(`dev login "${key}" is stored under the wrong site; replace it with rt logins add`);
  return { origin: o.origin, email: o.email, password: o.password };
}

export async function getLogin(b: LoginsBackend, key: string): Promise<DevLogin | null> {
  const raw = await b.read(key);
  return raw === null ? null : parse(key, raw);
}

export async function listLogins(b: LoginsBackend): Promise<DevLoginSummary[]> {
  const out: DevLoginSummary[] = [];
  for (const key of (await b.names()).sort()) {
    const login = await getLogin(b, key);
    if (!login) continue;
    out.push({
      origin: login.origin,
      email: login.email,
      fields: { email: placeholderName(key, "email"), password: placeholderName(key, "password") },
    });
  }
  return out;
}

export async function saveLogin(b: LoginsBackend, originInput: string, email: string, password: string): Promise<{ origin: string; key: string; replaced: boolean }> {
  const { origin, key } = normalizeOrigin(originInput);
  const cleanEmail = email.trim();
  if (!cleanEmail) throw new InvalidLoginError("the email is empty");
  if (!password) throw new InvalidLoginError("the password is empty");
  const replaced = (await b.read(key)) !== null;
  await b.write(key, JSON.stringify({ origin, email: cleanEmail, password }));
  return { origin, key, replaced };
}

export async function removeLogin(b: LoginsBackend, originInput: string): Promise<boolean> {
  return b.remove(normalizeOrigin(originInput).key);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/logins/__tests__/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/logins/store.ts lib/logins/__tests__/store.test.ts
git commit -m "logins: dev-logins store facade over the sops secrets store"
```

---

### Task 4: The attempt limiter

**Files:**
- Create: `lib/logins/attempt-limit.ts`
- Test: `lib/logins/__tests__/attempt-limit.test.ts`

**Interfaces:**
- Produces:
  - `ATTEMPT_WINDOW_MS = 300_000`, `ATTEMPT_DAY_MS = 86_400_000`, `ATTEMPTS_PER_DAY = 5`
  - `class AttemptLimiter { constructor(now?: () => number); take(key: string, fingerprint: string): { ok: true } | { ok: false; until: number } }`
  - `loginFingerprint(login: { email: string; password: string }): string`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import { ATTEMPT_DAY_MS, ATTEMPT_WINDOW_MS, AttemptLimiter, loginFingerprint } from "../attempt-limit.ts";

function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t };
  return c;
}

describe("AttemptLimiter", () => {
  test("one grant per login per five minutes", () => {
    const c = clock();
    const l = new AttemptLimiter(c.now);
    expect(l.take("a", "f")).toEqual({ ok: true });
    expect(l.take("a", "f")).toEqual({ ok: false, until: c.t + ATTEMPT_WINDOW_MS });
    c.t += ATTEMPT_WINDOW_MS;
    expect(l.take("a", "f")).toEqual({ ok: true });
  });

  test("five per day, the sixth refused until the first ages out", () => {
    const c = clock();
    const l = new AttemptLimiter(c.now);
    const first = c.t;
    for (let i = 0; i < 5; i++) {
      expect(l.take("a", "f").ok).toBe(true);
      c.t += ATTEMPT_WINDOW_MS;
    }
    expect(l.take("a", "f")).toEqual({ ok: false, until: first + ATTEMPT_DAY_MS });
    c.t = first + ATTEMPT_DAY_MS;
    expect(l.take("a", "f").ok).toBe(true);
  });

  test("a replaced login (new fingerprint) starts fresh", () => {
    const l = new AttemptLimiter(clock().now);
    l.take("a", "old");
    expect(l.take("a", "new")).toEqual({ ok: true });
  });

  test("logins are counted separately", () => {
    const l = new AttemptLimiter(clock().now);
    l.take("a", "f");
    expect(l.take("b", "f")).toEqual({ ok: true });
  });

  test("the fingerprint changes with email or password and never contains either", () => {
    const f = loginFingerprint({ email: "a@example.com", password: "Canary" });
    expect(f).not.toBe(loginFingerprint({ email: "a@example.com", password: "Canary2" }));
    expect(f).not.toBe(loginFingerprint({ email: "b@example.com", password: "Canary" }));
    expect(f).not.toContain("Canary");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/logins/__tests__/attempt-limit.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/logins/attempt-limit.ts`**

```ts
export const ATTEMPT_WINDOW_MS = 5 * 60_000;
export const ATTEMPT_DAY_MS = 24 * 60 * 60_000;
export const ATTEMPTS_PER_DAY = 5;

export function loginFingerprint(login: { email: string; password: string }): string {
  return new Bun.CryptoHasher("sha256").update(`${login.email}\0${login.password}`).digest("hex");
}

// Counters reset when the stored login's fingerprint changes, which is how a
// replacement through rt logins add lifts the limit without the CLI having
// to reach into the daemon.
export class AttemptLimiter {
  private readonly entries = new Map<string, { fingerprint: string; times: number[] }>();

  constructor(private readonly now: () => number = Date.now) {}

  take(key: string, fingerprint: string): { ok: true } | { ok: false; until: number } {
    const t = this.now();
    let entry = this.entries.get(key);
    if (!entry || entry.fingerprint !== fingerprint) {
      entry = { fingerprint, times: [] };
      this.entries.set(key, entry);
    }
    entry.times = entry.times.filter((x) => t - x < ATTEMPT_DAY_MS);
    const last = entry.times.at(-1);
    if (last !== undefined && t - last < ATTEMPT_WINDOW_MS) return { ok: false, until: last + ATTEMPT_WINDOW_MS };
    if (entry.times.length >= ATTEMPTS_PER_DAY) return { ok: false, until: entry.times[0]! + ATTEMPT_DAY_MS };
    entry.times.push(t);
    return { ok: true };
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/logins/__tests__/attempt-limit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/logins/attempt-limit.ts lib/logins/__tests__/attempt-limit.test.ts
git commit -m "logins: in-memory attempt limiter"
```

---

### Task 5: The `logins:fill` daemon verb

**Files:**
- Modify: `packages/rt-client/src/commands.ts` (add the type after `"secrets:read"` near line 637; add `"logins:fill"` to `COMMAND_NAMES` after `"secrets:read"` near line 1009)
- Create: `lib/daemon/handlers/logins.ts`
- Modify: `lib/daemon/command-router.ts` (import next to line 22; spread next to line 261)
- Test: `lib/daemon/__tests__/logins-handler.test.ts`, `lib/daemon/__tests__/no-logins-over-http.test.ts`

**Interfaces:**
- Consumes: `getLogin`, `secretsBackend`, `DevLogin` (Task 3); `AttemptLimiter`, `loginFingerprint` (Task 4); `parsePlaceholder` (Task 2); `getApiToken`, `tokenOk` from `lib/daemon/api-auth.ts`.
- Produces: `createLoginsHandlers(ctx: Pick<HandlerContext, "log">, overrides?: { apiToken?: () => string; readLogin?: (key: string) => Promise<DevLogin | null>; limiter?: AttemptLimiter })` returning `{ "logins:fill": (payload: unknown) => Promise<CommandResult<"logins:fill">> }`.

- [ ] **Step 1: Write the failing tests**

`lib/daemon/__tests__/logins-handler.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createLoginsHandlers } from "../handlers/logins.ts";
import { AttemptLimiter, ATTEMPT_WINDOW_MS } from "../../logins/attempt-limit.ts";
import type { DevLogin } from "../../logins/store.ts";

const TOKEN = "t0ken";
const CANARY = "Canary p@ss&+% ü";
const EMAIL = "dev@example.com";
const ORIGIN = "https://login.example.com";

function setup(login: DevLogin | null = { origin: ORIGIN, email: EMAIL, password: CANARY }) {
  const logged: unknown[] = [];
  const log = { info: (...a: unknown[]) => logged.push(a), debug: (...a: unknown[]) => logged.push(a), warn: (...a: unknown[]) => logged.push(a) };
  const clock = { t: 1_000_000 };
  let reads = 0;
  const state = { login };
  const h = createLoginsHandlers({ log } as any, {
    apiToken: () => TOKEN,
    readLogin: async () => { reads++; return state.login; },
    limiter: new AttemptLimiter(() => clock.t),
  })["logins:fill"];
  return { h, logged, clock, state, reads: () => reads };
}

const pw = { token: TOKEN, client: "fast-browser", pid: 42, name: "devlogin:login.example.com:password", frameOrigin: ORIGIN, elementKind: "password" as const };
const em = { ...pw, name: "devlogin:login.example.com:email", elementKind: "text" as const };

describe("logins:fill", () => {
  test("a missing or wrong token is ok:false and reads nothing", async () => {
    const s = setup();
    expect(await s.h({ ...pw, token: undefined })).toEqual({ ok: false, error: "missing-token" });
    expect(await s.h({ ...pw, token: "nope" })).toEqual({ ok: false, error: "bad-token" });
    expect(s.reads()).toBe(0);
  });

  test.each([
    ["a non-devlogin name", { name: "PASSWORD" }],
    ["no frameOrigin", { frameOrigin: undefined }],
    ["an unknown elementKind", { elementKind: "button" }],
  ])("malformed input (%s) is ok:false bad-payload", async (_l, patch) => {
    expect(await setup().h({ ...pw, ...patch })).toEqual({ ok: false, error: "bad-payload" });
  });

  test("an unsaved site is refused unknown", async () => {
    expect(await setup(null).h(pw)).toEqual({ ok: true, data: { refused: "unknown" } });
  });

  test("the right page gets the value", async () => {
    const s = setup();
    expect(await s.h(em)).toEqual({ ok: true, data: { origin: ORIGIN, kind: "email", value: EMAIL } });
    expect(await s.h(pw)).toEqual({ ok: true, data: { origin: ORIGIN, kind: "password", value: CANARY } });
  });

  test.each([
    "https://login.example.com.evil.test",
    "http://login.example.com",
    "https://login.example.com:8443",
    "null",
    "https://LOGIN.example.com",
  ])("frame origin %s is refused mismatch", async (frameOrigin) => {
    expect(await setup().h({ ...pw, frameOrigin })).toEqual({ ok: true, data: { refused: "mismatch" } });
  });

  test("a password name aimed at a text element is refused mismatch", async () => {
    expect(await setup().h({ ...pw, elementKind: "text" })).toEqual({ ok: true, data: { refused: "mismatch" } });
  });

  test("mismatches never use up an attempt", async () => {
    const s = setup();
    for (let i = 0; i < 6; i++) await s.h({ ...pw, frameOrigin: "https://evil.test" });
    expect(await s.h(pw)).toMatchObject({ ok: true, data: { kind: "password" } });
  });

  test("a second password fill inside five minutes is limited; an email fill never counts", async () => {
    const s = setup();
    await s.h(em);
    await s.h(em);
    expect((await s.h(pw)).ok).toBe(true);
    expect(await s.h(pw)).toEqual({ ok: true, data: { refused: "limited", until: s.clock.t + ATTEMPT_WINDOW_MS } });
    expect(await s.h(em)).toMatchObject({ ok: true, data: { kind: "email" } });
  });

  test("replacing the login lifts the limit", async () => {
    const s = setup();
    await s.h(pw);
    s.state.login = { origin: ORIGIN, email: EMAIL, password: "new-password" };
    expect(await s.h(pw)).toMatchObject({ ok: true, data: { value: "new-password" } });
  });

  test("logs name the caller as unverified and never carry a value", async () => {
    const s = setup();
    await s.h(em);
    await s.h(pw);
    await s.h(pw);
    await s.h({ ...pw, frameOrigin: "https://evil.test" });
    const text = JSON.stringify(s.logged);
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain(EMAIL);
    expect(text).toContain('"verified":false');
    expect(text).toContain("fast-browser");
  });
});
```

`lib/daemon/__tests__/no-logins-over-http.test.ts`:

```ts
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

test("no HTTP route reaches a logins verb", () => {
  const src = readFileSync(join(import.meta.dir, "..", "api-server.ts"), "utf8");
  expect(src).not.toContain("logins:");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/daemon/__tests__/logins-handler.test.ts lib/daemon/__tests__/no-logins-over-http.test.ts`
Expected: the handler test FAILS (module not found); the guard PASSES already (it pins the current state).

- [ ] **Step 3: Implement**

In `packages/rt-client/src/commands.ts`, after the `"secrets:read"` entry:

```ts
  /**
   * Socket-only, never in the daemon's REST routes: the Fast Browser
   * launcher's per-fill read of one saved dev login. The daemon compares the
   * page's frame origin and element kind before releasing anything, and only
   * a released password fill counts against the attempt limit.
   */
  "logins:fill": {
    payload: {
      token?: string;
      client?: string;
      pid?: number;
      name?: string;
      frameOrigin?: string;
      elementKind?: "password" | "text";
    };
    data:
      | { origin: string; kind: "email" | "password"; value: string }
      | { refused: "unknown" | "mismatch" | "limited"; until?: number };
  };
```

and add `"logins:fill",` to `COMMAND_NAMES` right after `"secrets:read",`.

Create `lib/daemon/handlers/logins.ts`:

```ts
import { getApiToken, tokenOk } from "../api-auth.ts";
import { createRealSecretsExecSeam, type SecretsSeams } from "../../secrets/store.ts";
import { createRealAgeKeySeam } from "../../home/age-key.ts";
import { getLogin, secretsBackend, type DevLogin } from "../../logins/store.ts";
import { parsePlaceholder } from "../../logins/origin.ts";
import { AttemptLimiter, loginFingerprint } from "../../logins/attempt-limit.ts";
import type { Commands } from "../../../packages/rt-client/src/commands.ts";
import type { CommandResult, HandlerContext } from "./types.ts";

let seamsSingleton: SecretsSeams | null = null;
function defaultSeams(): SecretsSeams {
  return seamsSingleton ??= { ageKeySeam: createRealAgeKeySeam(), execSeam: createRealSecretsExecSeam() };
}

export interface LoginsHandlerOverrides {
  apiToken?: () => string;
  readLogin?: (key: string) => Promise<DevLogin | null>;
  limiter?: AttemptLimiter;
}

export function createLoginsHandlers(
  ctx: Pick<HandlerContext, "log">,
  overrides: LoginsHandlerOverrides = {},
): { "logins:fill": (payload: unknown) => Promise<CommandResult<"logins:fill">> } {
  const apiToken = overrides.apiToken ?? (() => getApiToken());
  const readLogin = overrides.readLogin ?? ((key: string) => getLogin(secretsBackend(defaultSeams()), key));
  const limiter = overrides.limiter ?? new AttemptLimiter();

  return {
    "logins:fill": async (raw: unknown) => {
      const p = (raw ?? {}) as Commands["logins:fill"]["payload"];
      if (!p.token) return { ok: false as const, error: "missing-token" };
      if (!tokenOk(p.token, apiToken())) return { ok: false as const, error: "bad-token" };
      const parsed = typeof p.name === "string" ? parsePlaceholder(p.name) : null;
      if (!parsed || typeof p.frameOrigin !== "string" || (p.elementKind !== "password" && p.elementKind !== "text")) {
        return { ok: false as const, error: "bad-payload" };
      }
      // The daemon cannot see who is on the other end of its socket; the
      // caller's own claim is logged and labelled as such.
      const caller = { client: typeof p.client === "string" ? p.client : null, pid: typeof p.pid === "number" ? p.pid : null, verified: false };
      const note = (fields: Record<string, unknown>) => ctx.log.info({ name: p.name, caller, ...fields }, "logins:fill");

      const login = await readLogin(parsed.key);
      if (!login) {
        note({ refused: "unknown" });
        return { ok: true as const, data: { refused: "unknown" as const } };
      }
      const kindOk = parsed.kind !== "password" || p.elementKind === "password";
      if (p.frameOrigin !== login.origin || !kindOk) {
        note({ origin: login.origin, frameOrigin: p.frameOrigin, elementKind: p.elementKind, refused: "mismatch" });
        return { ok: true as const, data: { refused: "mismatch" as const } };
      }
      if (parsed.kind === "password") {
        const grant = limiter.take(parsed.key, loginFingerprint(login));
        if (!grant.ok) {
          note({ origin: login.origin, refused: "limited", until: grant.until });
          return { ok: true as const, data: { refused: "limited" as const, until: grant.until } };
        }
      }
      note({ origin: login.origin, released: parsed.kind });
      return {
        ok: true as const,
        data: { origin: login.origin, kind: parsed.kind, value: parsed.kind === "email" ? login.email : login.password },
      };
    },
  };
}
```

In `lib/daemon/command-router.ts`, add `import { createLoginsHandlers } from "./handlers/logins.ts";` below the secrets import and `...createLoginsHandlers({ log: ctx.log }),` directly below `...createSecretsHandlers({ log: ctx.log }),`.

Then rebuild the client: `cd packages/rt-client && bun run build && cd ../..`.

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/daemon/__tests__/logins-handler.test.ts lib/daemon/__tests__/no-logins-over-http.test.ts lib/daemon/__tests__/rt-client-commands.test.ts packages/rt-client/test/dist-freshness.test.ts`
Expected: PASS. Then remove the `frameOrigin` comparison temporarily, rerun, and confirm the mismatch tests fail; restore it.

- [ ] **Step 5: Commit**

```bash
git add packages/rt-client/src/commands.ts lib/daemon/handlers/logins.ts lib/daemon/command-router.ts lib/daemon/__tests__/logins-handler.test.ts lib/daemon/__tests__/no-logins-over-http.test.ts
git commit -m "daemon: logins:fill releases a saved dev login only to a matching page"
```

---

### Task 6: `rt logins` verbs

**Files:**
- Create: `commands/logins.ts`
- Modify: `lib/command-tree-def.ts` (new top-level `logins` node right after the `secrets` node ending near line 2090)
- Modify: `lib/module-registry.ts` (next to the `./commands/secrets.ts` entry at line 37)
- Modify: `lib/__tests__/agent-safe.test.ts` (the sorted list in the first test)
- Test: `commands/__tests__/logins.test.ts`

**Interfaces:**
- Consumes: Task 2 and Task 3 exports; `exitUserError`, `UserActionableError` from `lib/setup/errors.ts`; `readStdinJson` from `lib/setup/probes.ts`; `promptSecret` from `lib/prompt-secret.ts`; `NoAgeKeyError` from `lib/secrets/store.ts`.
- Produces: `loginsList`, `loginsAdd`, `loginsOpenAdd`, `loginsRemove`, each `(args: string[], ctx?: CommandContext, deps?: Partial<LoginsDeps>) => Promise<void>`; `devLoginAddUrl(origin: string): string`.

- [ ] **Step 1: Write the failing tests**

`commands/__tests__/logins.test.ts`:

```ts
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { devLoginAddUrl, loginsAdd, loginsList, loginsOpenAdd, loginsRemove, type LoginsDeps } from "../logins.ts";
import type { LoginsBackend } from "../../lib/logins/store.ts";
import { NoAgeKeyError } from "../../lib/secrets/store.ts";

const CANARY = 'p@ss"\\&+% ü';

class Exit extends Error { constructor(public code: number) { super(`exit ${code}`); } }
let exitSpy: ReturnType<typeof spyOn> | undefined;
afterEach(() => exitSpy?.mockRestore());
function trapExit() {
  exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => { throw new Exit(code ?? 0); }) as never);
}

function deps(over: Partial<LoginsDeps> = {}) {
  const data: Record<string, string> = {};
  const out: string[] = [];
  const opened: string[] = [];
  const backend: LoginsBackend = {
    read: async (k) => data[k] ?? null,
    names: async () => Object.keys(data),
    write: async (k, v) => { data[k] = v; },
    remove: async (k) => { const had = k in data; delete data[k]; return had; },
  };
  const d: LoginsDeps = {
    backend: () => backend,
    readStdin: async () => null,
    promptSecret: async () => { throw new Error("no prompt expected"); },
    promptText: async () => { throw new Error("no prompt expected"); },
    openUrl: (u) => { opened.push(u); },
    print: (s) => { out.push(s); },
    isTTY: false,
    ...over,
  };
  return { d, data, out, opened };
}

describe("rt logins", () => {
  test("add --json reads the values from stdin verbatim and list never prints the password", async () => {
    const t = deps({ readStdin: async () => ({ email: "dev@example.com", password: CANARY }) });
    await loginsAdd(["https://login.example.com", "--json"], {}, t.d);
    expect(JSON.parse(t.out.pop()!)).toEqual({ ok: true, origin: "https://login.example.com", replaced: false });
    expect(JSON.parse(t.data["login.example.com"]!).password).toBe(CANARY);

    await loginsList(["--json"], {}, t.d);
    const listed = t.out.pop()!;
    expect(JSON.parse(listed)).toEqual([{
      origin: "https://login.example.com",
      email: "dev@example.com",
      fields: { email: "devlogin:login.example.com:email", password: "devlogin:login.example.com:password" },
    }]);
    expect(listed).not.toContain("ss&+%");
  });

  test("add refuses a value passed as an argument and writes nothing", async () => {
    trapExit();
    const t = deps();
    await expect(loginsAdd(["https://login.example.com", "dev@example.com", "hunter2", "--json"], {}, t.d)).rejects.toThrow("exit 2");
    const printed = t.out.join("\n");
    expect(JSON.parse(printed).error.code).toBe("usage");
    expect(printed).not.toContain("hunter2");
    expect(t.data).toEqual({});
  });

  test("add refuses a bad origin before reading any value", async () => {
    trapExit();
    let read = false;
    const t = deps({ readStdin: async () => { read = true; return { email: "a@example.com", password: "x" }; } });
    await expect(loginsAdd(["http://login.example.com", "--json"], {}, t.d)).rejects.toThrow("exit 2");
    expect(JSON.parse(t.out.join("")).error.code).toBe("bad-origin");
    expect(read).toBe(false);
  });

  test("add with no age key points at rt home init", async () => {
    trapExit();
    const t = deps({ readStdin: async () => ({ email: "a@example.com", password: "x" }) });
    const failing: LoginsBackend = { ...t.d.backend(), read: async () => { throw new NoAgeKeyError(); } };
    await expect(loginsAdd(["https://login.example.com", "--json"], {}, { ...t.d, backend: () => failing })).rejects.toThrow("exit 2");
    expect(JSON.parse(t.out.join("")).error.message).toContain("rt home init");
  });

  test("add in a terminal prompts for the email in the clear and the password hidden", async () => {
    const asked: string[] = [];
    const t = deps({
      isTTY: true,
      promptText: async (m) => { asked.push(`text:${m}`); return "dev@example.com"; },
      promptSecret: async (m) => { asked.push(`secret:${m}`); return CANARY; },
    });
    await loginsAdd(["https://login.example.com"], {}, t.d);
    expect(asked).toEqual(["text:Email for https://login.example.com", "secret:Password for https://login.example.com"]);
    expect(t.out.join("\n")).not.toContain(CANARY);
  });

  test("open-add opens the app link and answers with it", async () => {
    const t = deps();
    await loginsOpenAdd(["https://login.example.com:8443/", "--json"], {}, t.d);
    const url = "mattstack://dev-logins/add?origin=https%3A%2F%2Flogin.example.com%3A8443";
    expect(t.opened).toEqual([url]);
    expect(JSON.parse(t.out.pop()!)).toEqual({ ok: true, url });
    expect(devLoginAddUrl("https://login.example.com")).toBe("mattstack://dev-logins/add?origin=https%3A%2F%2Flogin.example.com");
  });

  test("remove reports whether a login existed", async () => {
    const t = deps({ readStdin: async () => ({ email: "a@example.com", password: "x" }) });
    await loginsAdd(["https://login.example.com", "--json"], {}, t.d);
    await loginsRemove(["https://login.example.com", "--json"], {}, t.d);
    expect(JSON.parse(t.out.pop()!)).toEqual({ ok: true, removed: true });
    await loginsRemove(["https://login.example.com", "--json"], {}, t.d);
    expect(JSON.parse(t.out.pop()!)).toEqual({ ok: true, removed: false });
  });
});
```

Update `lib/__tests__/agent-safe.test.ts`'s expected list to include `"logins list"` and `"logins open-add"` in sorted position (between `"intercept status"` and `"pane list"`).

- [ ] **Step 2: Run to verify failure**

Run: `bun test commands/__tests__/logins.test.ts lib/__tests__/agent-safe.test.ts`
Expected: FAIL (module not found; agent-safe list mismatch).

- [ ] **Step 3: Implement `commands/logins.ts`**

```ts
/**
 * rt logins: dev-server logins that browser runs fill on a matching page.
 * Values never travel in argv: a terminal prompts (the password hidden), and
 * --json reads {email, password} from stdin.
 */

import { spawnSync } from "child_process";
import type { CommandContext } from "../lib/command-tree.ts";
import { createRealAgeKeySeam } from "../lib/home/age-key.ts";
import { InvalidOriginError, normalizeOrigin } from "../lib/logins/origin.ts";
import {
  CorruptLoginError, InvalidLoginError, listLogins, removeLogin, saveLogin, secretsBackend, type LoginsBackend,
} from "../lib/logins/store.ts";
import { promptSecret } from "../lib/prompt-secret.ts";
import { InvalidSecretsSegmentError, NoAgeKeyError, createRealSecretsExecSeam } from "../lib/secrets/store.ts";
import { UserActionableError, exitUserError } from "../lib/setup/errors.ts";
import { readStdinJson } from "../lib/setup/probes.ts";

export interface LoginsDeps {
  backend: () => LoginsBackend;
  readStdin: () => Promise<unknown>;
  promptSecret: (message: string) => Promise<string>;
  promptText: (message: string) => Promise<string>;
  openUrl: (url: string) => void;
  print: (s: string) => void;
  isTTY: boolean;
}

function realDeps(): LoginsDeps {
  return {
    backend: () => secretsBackend({ ageKeySeam: createRealAgeKeySeam(), execSeam: createRealSecretsExecSeam() }),
    readStdin: () => readStdinJson(),
    promptSecret: (m) => promptSecret(m),
    promptText: async (m) => {
      const { textInput } = await import("../lib/rt-render.ts");
      return (await textInput({ message: m, stderr: true })).trim();
    },
    openUrl: (u) => { spawnSync("open", [u]); },
    print: (s) => console.log(s),
    isTTY: Boolean(process.stdin.isTTY) && !process.env.RT_BATCH,
  };
}

function resolveDeps(over?: Partial<LoginsDeps>): LoginsDeps {
  return { ...realDeps(), ...over };
}

function positionals(args: string[]): string[] {
  return args.filter((a) => !a.startsWith("--"));
}

export function devLoginAddUrl(origin: string): string {
  return `mattstack://dev-logins/add?origin=${encodeURIComponent(origin)}`;
}

function fail(verb: string, json: boolean, d: LoginsDeps, err: unknown): never {
  if (err instanceof UserActionableError) exitUserError(err, json, `logins ${verb}`, d.print);
  if (err instanceof InvalidOriginError) exitUserError(new UserActionableError("bad-origin", err.message), json, `logins ${verb}`, d.print);
  if (err instanceof InvalidLoginError) exitUserError(new UserActionableError("bad-login", err.message), json, `logins ${verb}`, d.print);
  if (err instanceof NoAgeKeyError || err instanceof CorruptLoginError || err instanceof InvalidSecretsSegmentError) {
    exitUserError(new UserActionableError("store", err.message), json, `logins ${verb}`, d.print);
  }
  throw err;
}

async function originArg(verb: string, args: string[], json: boolean, d: LoginsDeps): Promise<string> {
  let [origin] = positionals(args);
  if (!origin && d.isTTY && !json) origin = await d.promptText("Origin (https://login.example.com)");
  if (!origin) throw new UserActionableError("usage", `usage: rt logins ${verb} <origin>`);
  return normalizeOrigin(origin).origin;
}

export async function loginsList(args: string[], _ctx: CommandContext = {}, over?: Partial<LoginsDeps>): Promise<void> {
  const d = resolveDeps(over);
  const json = args.includes("--json");
  try {
    const rows = await listLogins(d.backend());
    if (json) return d.print(JSON.stringify(rows));
    if (rows.length === 0) return d.print("No dev logins saved. Add one with: rt logins add <origin>");
    for (const r of rows) d.print(`${r.origin}  ${r.email}`);
  } catch (err) {
    fail("list", json, d, err);
  }
}

export async function loginsAdd(args: string[], _ctx: CommandContext = {}, over?: Partial<LoginsDeps>): Promise<void> {
  const d = resolveDeps(over);
  const json = args.includes("--json");
  try {
    if (positionals(args).length > 1) {
      throw new UserActionableError("usage", "rt logins add takes the origin only; the email and password are prompted, or read as JSON from stdin with --json");
    }
    const origin = await originArg("add", args, json, d);
    let email: string;
    let password: string;
    if (json) {
      const body = (await d.readStdin()) as { email?: unknown; password?: unknown } | null;
      if (!body || typeof body.email !== "string" || typeof body.password !== "string") {
        throw new UserActionableError("bad-stdin", "--json expects {\"email\": \"...\", \"password\": \"...\"} on stdin");
      }
      email = body.email;
      password = body.password;
    } else if (d.isTTY) {
      email = await d.promptText(`Email for ${origin}`);
      password = await d.promptSecret(`Password for ${origin}`);
    } else {
      throw new UserActionableError("needs-tty", "no terminal to prompt in; pass --json and pipe {email, password} on stdin");
    }
    const saved = await saveLogin(d.backend(), origin, email, password);
    d.print(json ? JSON.stringify({ ok: true, origin: saved.origin, replaced: saved.replaced }) : `${saved.replaced ? "Replaced" : "Saved"} the dev login for ${saved.origin}`);
  } catch (err) {
    fail("add", json, d, err);
  }
}

export async function loginsOpenAdd(args: string[], _ctx: CommandContext = {}, over?: Partial<LoginsDeps>): Promise<void> {
  const d = resolveDeps(over);
  const json = args.includes("--json");
  try {
    const origin = await originArg("open-add", args, json, d);
    const url = devLoginAddUrl(origin);
    d.openUrl(url);
    d.print(json ? JSON.stringify({ ok: true, url }) : `Opened mattstack to save a dev login for ${origin}`);
  } catch (err) {
    fail("open-add", json, d, err);
  }
}

export async function loginsRemove(args: string[], _ctx: CommandContext = {}, over?: Partial<LoginsDeps>): Promise<void> {
  const d = resolveDeps(over);
  const json = args.includes("--json");
  try {
    let [origin] = positionals(args);
    if (!origin && d.isTTY && !json) {
      const rows = await listLogins(d.backend());
      if (rows.length > 0) {
        const { filterableSelect } = await import("../lib/pick-wrappers.ts");
        const picked = await filterableSelect({ message: "Dev login to delete", options: rows.map((r) => ({ value: r.origin, label: `${r.origin}  ${r.email}` })), stderr: true });
        if (!picked) return;
        origin = picked;
      }
    }
    if (!origin) throw new UserActionableError("usage", "usage: rt logins remove <origin>");
    const removed = await removeLogin(d.backend(), origin);
    d.print(json ? JSON.stringify({ ok: true, removed }) : removed ? `Deleted the dev login for ${normalizeOrigin(origin).origin}` : "No dev login saved for that site");
  } catch (err) {
    fail("remove", json, d, err);
  }
}
```

In `lib/command-tree-def.ts`, after the `secrets` node:

```ts
  logins: {
    description: "Save dev-server logins that browser runs can use on a login page",
    subcommands: {
      list: {
        description: "Show your saved dev logins, never the passwords",
        module: "./commands/logins.ts",
        fn: "loginsList",
        agentSafe: true,
        args: [{ name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Output as JSON" }],
      },
      add: {
        description: "Save or replace the dev login for a site",
        module: "./commands/logins.ts",
        fn: "loginsAdd",
        omitBehavior: "prompt",
        args: [
          { name: "Origin", type: "text", placeholder: "https://login.example.com", hint: "The login page's origin" },
          { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Read {email, password} as JSON from stdin; answer in JSON" },
        ],
      },
      "open-add": {
        description: "Open mattstack to save a dev login for a site",
        module: "./commands/logins.ts",
        fn: "loginsOpenAdd",
        agentSafe: true,
        omitBehavior: "prompt",
        args: [
          { name: "Origin", type: "text", placeholder: "https://login.example.com", hint: "The login page's origin" },
          { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Output as JSON" },
        ],
      },
      remove: {
        description: "Delete a saved dev login",
        module: "./commands/logins.ts",
        fn: "loginsRemove",
        omitBehavior: "picker",
        args: [
          { name: "Origin", type: "text", placeholder: "https://login.example.com", hint: "The login page's origin" },
          { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Output as JSON" },
        ],
      },
    },
  },
```

In `lib/module-registry.ts`, add `"./commands/logins.ts": () => import("../commands/logins.ts"),` next to the secrets entry.

- [ ] **Step 4: Run to verify pass, then the tree gates**

Run: `bun test commands/__tests__/logins.test.ts lib/__tests__/agent-safe.test.ts lib/__tests__/picker-conformance.test.ts lib/__tests__/no-eager-tui.test.ts && bun run picker:check`
Expected: PASS.

Run: `bun run docs:gen` and include the generated reference pages in the commit.

Run: `bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md` and `git diff --stat plugins/mattstack`. If the reference changed, bump the patch version in `plugins/mattstack/.claude-plugin/plugin.json` in the same commit (the `plugin-mattstack` CI job requires it).

Run: `bun run test:e2e` (usage and help output snapshots live there).

- [ ] **Step 5: Commit**

```bash
git add commands/logins.ts commands/__tests__/logins.test.ts lib/command-tree-def.ts lib/module-registry.ts lib/__tests__/agent-safe.test.ts docs plugins/mattstack
git commit -m "rt logins: list, add, open-add and remove dev logins"
```

---

### Task 7: The app link parser and origin check

**Files:**
- Create: `rt-tray/Sources-core/Launch/DevLoginLink.swift`
- Create: `rt-tray/Tests/MattstackCoreChecks/DevLoginLinkChecks.swift`
- Modify: `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift` (append `+ devLoginLinkChecks`)

**Interfaces:**
- Produces:
  - `DevLoginLink.origin(from url: URL) -> String?`
  - `DevLoginOrigin.validate(_ input: String) -> DevLoginOrigin.Result` where `enum Result: Equatable { case valid(origin: String, host: String); case invalid(String) }`

- [ ] **Step 1: Write the failing checks**

```swift
import Foundation
@testable import MattstackCore

let devLoginLinkChecks: [Check] = [
    Check("dev login link: origin is the only thing read") { c in
        let url = URL(string: "mattstack://dev-logins/add?origin=https%3A%2F%2Flogin.example.com&password=hunter2&email=a")!
        c.expectEqual(DevLoginLink.origin(from: url), "https://login.example.com")
    },
    Check("dev login link: wrong host, wrong path, no origin, or two origins is nil") { c in
        for s in ["mattstack://open/add?origin=https%3A%2F%2Fa.example",
                  "mattstack://dev-logins/remove?origin=https%3A%2F%2Fa.example",
                  "mattstack://dev-logins/add",
                  "mattstack://dev-logins/add?origin=https%3A%2F%2Fa.example&origin=https%3A%2F%2Fb.example",
                  "https://dev-logins/add?origin=https%3A%2F%2Fa.example"] {
            c.expect(DevLoginLink.origin(from: URL(string: s)!) == nil, s)
        }
    },
    Check("dev login origin: https host and local http pass, lowercased") { c in
        c.expectEqual(DevLoginOrigin.validate("https://Login.Example.com"), .valid(origin: "https://login.example.com", host: "login.example.com"))
        c.expectEqual(DevLoginOrigin.validate("http://localhost:3000"), .valid(origin: "http://localhost:3000", host: "localhost"))
        c.expectEqual(DevLoginOrigin.validate("https://login.example.com/"), .valid(origin: "https://login.example.com", host: "login.example.com"))
    },
    Check("dev login origin: the spec's refusals") { c in
        for s in ["http://login.example.com", "https://login.example.com/u/login", "https://login.example.com?x=1",
                  "https://login.example.com#x", "https://dev:pw@login.example.com", "https://log_in.example.com",
                  "https://bücher.example", "ftp://login.example.com", "login.example.com", ""] {
            if case .valid = DevLoginOrigin.validate(s) { c.fail("accepted \(s)") }
        }
    },
]
```

Append `+ devLoginLinkChecks` to `allChecks` in `AllChecks.swift`.

- [ ] **Step 2: Run to verify failure**

Run: `cd rt-tray && swift run mattstack-checks "dev login"`
Expected: build FAILS (`DevLoginLink` not found).

- [ ] **Step 3: Implement `rt-tray/Sources-core/Launch/DevLoginLink.swift`**

```swift
import Foundation

public enum DevLoginLink {
    /// mattstack://dev-logins/add?origin=<origin>. No other parameter is ever read.
    public static func origin(from url: URL) -> String? {
        guard url.scheme?.lowercased() == "mattstack", url.host?.lowercased() == "dev-logins",
              let comps = URLComponents(url: url, resolvingAgainstBaseURL: false), comps.path == "/add" else { return nil }
        let values = (comps.queryItems ?? []).filter { $0.name == "origin" }.compactMap(\.value)
        guard values.count == 1, let origin = values.first, !origin.isEmpty else { return nil }
        return origin
    }
}

/// The app-side mirror of rt's origin rules (lib/logins/origin.ts). rt stays
/// the authority on save; this decides whether the sheet may open at all.
/// Non-ASCII hosts are refused here because rt hands the app punycode.
public enum DevLoginOrigin {
    public enum Result: Equatable { case valid(origin: String, host: String); case invalid(String) }

    public static func validate(_ input: String) -> Result {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.allSatisfy(\.isASCII), let comps = URLComponents(string: trimmed),
              let scheme = comps.scheme?.lowercased(), let rawHost = comps.host, !rawHost.isEmpty else {
            return .invalid("Not an origin. Write it like https://login.example.com.")
        }
        let host = rawHost.lowercased()
        guard scheme == "https" || scheme == "http" else { return .invalid("Only https and http sites can hold a dev login.") }
        guard comps.user == nil, comps.password == nil else { return .invalid("An origin carries no user name or password.") }
        guard comps.path.isEmpty || comps.path == "/", comps.query == nil, comps.fragment == nil else {
            return .invalid("An origin has no path, query or fragment.")
        }
        guard !host.contains("_"), !host.hasPrefix("[") else { return .invalid("That host is not supported.") }
        guard scheme == "https" || host == "localhost" || host == "127.0.0.1" else {
            return .invalid("http is allowed only for localhost and 127.0.0.1.")
        }
        let defaultPort = scheme == "https" ? 443 : 80
        let portPart = comps.port.map { $0 == defaultPort ? "" : ":\($0)" } ?? ""
        return .valid(origin: "\(scheme)://\(host)\(portPart)", host: host)
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd rt-tray && swift run mattstack-checks "dev login"`
Expected: all dev login checks pass.

- [ ] **Step 5: Commit**

```bash
git add rt-tray/Sources-core/Launch/DevLoginLink.swift rt-tray/Tests/MattstackCoreChecks/DevLoginLinkChecks.swift rt-tray/Tests/MattstackCoreChecks/AllChecks.swift
git commit -m "tray: parse mattstack://dev-logins/add and check the origin"
```

---

### Task 8: `DevLoginsModel` and the save rules

**Files:**
- Create: `rt-tray/Sources-core/Settings/DevLoginsModel.swift`
- Create: `rt-tray/Tests/MattstackCoreChecks/DevLoginsModelChecks.swift`
- Modify: `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift` (append `+ devLoginsModelChecks`)

**Interfaces:**
- Consumes: `RtRunning`, `RtResult.userError(redactStderr:)`, `RtResult.failureCopy(verb:redactStderr:)` (`Sources-core/Rt/RtFailureCopy.swift`).
- Produces:
  - `struct DevLoginRow: Codable, Equatable, Sendable, Identifiable { origin, email, fields: Fields { email, password } }`
  - `@MainActor final class DevLoginsModel: ObservableObject` with `rows`, `loaded`, `error`, `addRequest: String?`, `load()`, `save(origin:email:password:) async -> String?`, `remove(origin:) async -> String?`, `isSaved(_:) -> Bool`
  - `enum DevLoginConfirm { static func canSave(host:typedHost:isFirstTime:email:password:) -> Bool; static func warnings(origin: String) -> [String] }`

- [ ] **Step 1: Write the failing checks**

```swift
import Foundation
@testable import MattstackCore

private let listJSON = #"[{"origin":"https://login.example.com","email":"dev@example.com","fields":{"email":"devlogin:login.example.com:email","password":"devlogin:login.example.com:password"}}]"#

let devLoginsModelChecks: [Check] = [
    Check("dev logins model: load decodes rt logins list") { c in
        let rt = ScriptedRt(); rt.answers["logins list"] = (0, listJSON)
        let model = await DevLoginsModel(rt: rt)
        await model.load()
        let rows = await model.rows
        try c.requireEqual(rows.count, 1)
        c.expectEqual(rows[0].origin, "https://login.example.com")
        c.expectEqual(rt.calls.first?.args ?? [], ["logins", "list", "--json"])
    },
    Check("dev logins model: save sends values on stdin only") { c in
        let rt = ScriptedRt(); rt.answers["logins add"] = (0, #"{"ok":true}"#); rt.answers["logins list"] = (0, "[]")
        let model = await DevLoginsModel(rt: rt)
        let err = await model.save(origin: "https://login.example.com", email: "dev@example.com", password: "Canary p@ss")
        c.expect(err == nil)
        let add = try c.requireSome(rt.calls.first { $0.args.starts(with: ["logins", "add"]) })
        c.expectEqual(add.args, ["logins", "add", "https://login.example.com", "--json"])
        c.expect(!add.args.joined().contains("Canary"))
        let body = try JSONSerialization.jsonObject(with: Data((add.stdin ?? "").utf8)) as? [String: String]
        c.expectEqual(body ?? [:], ["email": "dev@example.com", "password": "Canary p@ss"])
    },
    Check("dev logins model: a refused save returns rt's message") { c in
        let rt = ScriptedRt(); rt.answers["logins add"] = (2, #"{"contract":1,"at":"x","error":{"code":"bad-origin","message":"http is allowed only for localhost and 127.0.0.1; use https"}}"#)
        let model = await DevLoginsModel(rt: rt)
        let err = await model.save(origin: "http://login.example.com", email: "a", password: "b")
        c.expectEqual(err, "http is allowed only for localhost and 127.0.0.1; use https")
    },
    Check("dev logins confirm: first-time origins need the typed host") { c in
        c.expect(!DevLoginConfirm.canSave(host: "login.example.com", typedHost: "", isFirstTime: true, email: "a", password: "b"))
        c.expect(!DevLoginConfirm.canSave(host: "login.example.com", typedHost: "login-example.com", isFirstTime: true, email: "a", password: "b"))
        c.expect(DevLoginConfirm.canSave(host: "login.example.com", typedHost: " Login.Example.com ", isFirstTime: true, email: "a", password: "b"))
        c.expect(DevLoginConfirm.canSave(host: "login.example.com", typedHost: "", isFirstTime: false, email: "a", password: "b"))
        c.expect(!DevLoginConfirm.canSave(host: "login.example.com", typedHost: "", isFirstTime: false, email: " ", password: "b"))
        c.expect(!DevLoginConfirm.canSave(host: "login.example.com", typedHost: "", isFirstTime: false, email: "a", password: ""))
    },
    Check("dev logins confirm: warnings for punycode and http") { c in
        c.expectEqual(DevLoginConfirm.warnings(origin: "https://login.example.com"), [])
        c.expectEqual(DevLoginConfirm.warnings(origin: "https://xn--bcher-kva.example").count, 1)
        c.expectEqual(DevLoginConfirm.warnings(origin: "http://localhost:3000").count, 1)
    },
]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd rt-tray && swift run mattstack-checks "dev logins"`
Expected: build FAILS.

- [ ] **Step 3: Implement `rt-tray/Sources-core/Settings/DevLoginsModel.swift`**

```swift
import Foundation
import Combine

public struct DevLoginRow: Codable, Equatable, Sendable, Identifiable {
    public struct Fields: Codable, Equatable, Sendable { public var email: String; public var password: String }
    public var origin: String
    public var email: String
    public var fields: Fields
    public var id: String { origin }
}

@MainActor
public final class DevLoginsModel: ObservableObject {
    @Published public private(set) var rows: [DevLoginRow] = []
    @Published public private(set) var loaded = false
    @Published public private(set) var error: String?
    /// Set by the mattstack://dev-logins/add route; the pane opens the add sheet for it.
    @Published public var addRequest: String?
    private let rt: RtRunning
    public init(rt: RtRunning) { self.rt = rt }

    public func isSaved(_ origin: String) -> Bool { rows.contains { $0.origin == origin } }

    public func load() async {
        do {
            let r = try await rt.run(["logins", "list", "--json"], stdin: nil)
            guard r.exitCode == 0, let decoded = try? r.decode([DevLoginRow].self) else {
                error = r.userError?.message ?? r.failureCopy(verb: "logins list")
                return
            }
            rows = decoded
            loaded = true
            error = nil
        } catch {
            self.error = "Couldn't run rt: \(error.localizedDescription)"
        }
    }

    /// Values go on stdin only, and a failure's stderr is never shown, since it could echo them.
    public func save(origin: String, email: String, password: String) async -> String? {
        guard let body = try? JSONSerialization.data(withJSONObject: ["email": email, "password": password]) else {
            return "Couldn't encode the login."
        }
        return await mutate(["logins", "add", origin, "--json"], stdin: body, verb: "logins add")
    }

    public func remove(origin: String) async -> String? {
        await mutate(["logins", "remove", origin, "--json"], stdin: nil, verb: "logins remove")
    }

    private func mutate(_ args: [String], stdin: Data?, verb: String) async -> String? {
        do {
            let r = try await rt.run(args, stdin: stdin)
            guard r.exitCode == 0 else {
                return r.userError(redactStderr: true)?.message ?? r.failureCopy(verb: verb, redactStderr: true)
            }
            await load()
            return nil
        } catch {
            return "Couldn't run rt."
        }
    }
}

public enum DevLoginConfirm {
    public static func canSave(host: String, typedHost: String, isFirstTime: Bool, email: String, password: String) -> Bool {
        guard !email.trimmingCharacters(in: .whitespaces).isEmpty, !password.isEmpty else { return false }
        return !isFirstTime || typedHost.trimmingCharacters(in: .whitespaces).lowercased() == host
    }

    public static func warnings(origin: String) -> [String] {
        var out: [String] = []
        if origin.contains("xn--") {
            out.append("This site's name uses international characters. Check it is the site you expect, not a lookalike.")
        }
        if origin.hasPrefix("http://") {
            out.append("This login is sent without https. Save it only for an app on this Mac that hosts its own login.")
        }
        return out
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd rt-tray && swift run mattstack-checks "dev logins"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rt-tray/Sources-core/Settings/DevLoginsModel.swift rt-tray/Tests/MattstackCoreChecks/DevLoginsModelChecks.swift rt-tray/Tests/MattstackCoreChecks/AllChecks.swift
git commit -m "tray: DevLoginsModel and first-time origin confirmation rules"
```

---

### Task 9: Settings pane, sheet, link route and screenshots

**Files:**
- Modify: `rt-tray/Sources/Settings/SettingsWindowController.swift` (`SettingsPane` enum: add `devLogins` after `fastBrowser`, title "Dev logins", symbol "key"; `SettingsEnvironment`: add `let devLogins: DevLoginsModel`)
- Modify: `rt-tray/Sources/Settings/SettingsView.swift` (`case .devLogins: DevLoginsPane(env: env)`)
- Create: `rt-tray/Sources/Settings/DevLoginsPane.swift`, `rt-tray/Sources/Settings/DevLoginSheet.swift`
- Modify: `rt-tray/Sources/AccessibilityIDs.swift` (new ids below)
- Modify: `rt-tray/Sources/Setup/SetupCoordinator.swift` (own a `DevLoginsModel`, pass it into `SettingsEnvironment`, add `showDevLoginAdd(origin:)`)
- Modify: `rt-tray/Sources/AppDelegate.swift` (route in `handleGetURL` before the `OpenLink` branch; `pendingDevLoginOrigin` drained next to `pendingJoinCode` in `buildServices()`)
- Modify: `rt-tray/Tests/stub-rt/stub.ts`, `rt-tray/Tests/stub-rt/stub.test.ts` (a `logins` branch)
- Modify: `rt-tray/Tests/mattstackUITests/SetupFlowUITests.swift` (`testDevLoginsPaneLightAndDark`)

**Interfaces:**
- Consumes: `DevLoginsModel`, `DevLoginConfirm` (Task 8); `DevLoginLink`, `DevLoginOrigin` (Task 7).
- Produces: AXIDs `settings.devLogins.add`, `settings.devLogins.empty`, `settings.devLogins.row.<origin>`, `settings.devLogins.replace.<origin>`, `settings.devLogins.delete.<origin>`, `settings.devLogins.error`, `devLogin.sheet.origin`, `devLogin.sheet.email`, `devLogin.sheet.password`, `devLogin.sheet.confirmHost`, `devLogin.sheet.save`, `devLogin.sheet.cancel`, `devLogin.sheet.warning`, `devLogin.sheet.invalid`.

- [ ] **Step 1: Stub rt support, test first**

Append to `rt-tray/Tests/stub-rt/stub.test.ts`:

```ts
test("logins: add, list and remove keep state and list prints a bare array without passwords", async () => {
  const state = mkdtempSync(join(tmpdir(), "stub-"));
  const empty = await run("solo", ["logins", "list", "--json"], "", state);
  expect(JSON.parse(empty.out)).toEqual([]);
  const add = await run("solo", ["logins", "add", "https://login.example.com", "--json"], JSON.stringify({ email: "dev@example.com", password: "pw" }), state);
  expect(add.code).toBe(0);
  const listed = await run("solo", ["logins", "list", "--json"], "", state);
  expect(JSON.parse(listed.out)).toEqual([{ origin: "https://login.example.com", email: "dev@example.com",
    fields: { email: "devlogin:login.example.com:email", password: "devlogin:login.example.com:password" } }]);
  expect(listed.out).not.toContain("pw\"");
  await run("solo", ["logins", "remove", "https://login.example.com", "--json"], "", state);
  expect(JSON.parse((await run("solo", ["logins", "list", "--json"], "", state)).out)).toEqual([]);
});
```

Run: `bun test ./rt-tray/Tests/stub-rt` (FAILS). Then add to `stub.ts`, before the final unknown-verb fallback in the dispatch chain:

```ts
else if (a0 === "logins") {
  const path = join(stateDir, "logins.json");
  const saved: Record<string, { email: string }> = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const origin = args[2];
  if (a1 === "list") {
    const rows = Object.entries(saved).sort().map(([o, v]) => {
      const key = new URL(o).host.replace(":", "_");
      return { origin: o, email: v.email, fields: { email: `devlogin:${key}:email`, password: `devlogin:${key}:password` } };
    });
    process.stdout.write(JSON.stringify(rows) + "\n");
  } else if (a1 === "add" && origin) {
    const body = await readStdinJSON();
    saved[origin] = { email: String(body.email ?? "") };
    writeFileSync(path, JSON.stringify(saved));
    process.stdout.write(JSON.stringify({ ok: true, origin, replaced: false }) + "\n");
  } else if (a1 === "remove" && origin) {
    const removed = origin in saved;
    delete saved[origin];
    writeFileSync(path, JSON.stringify(saved));
    process.stdout.write(JSON.stringify({ ok: true, removed }) + "\n");
  } else fail("usage", "rt logins list|add|remove");
}
```

Run: `bun test ./rt-tray/Tests/stub-rt` (PASS).

- [ ] **Step 2: Write the failing UI test**

Add to `SetupFlowUITests`:

```swift
    func testDevLoginsPaneLightAndDark() {
        for scheme in ["Light", "Dark"] {
            prepare("solo")
            app.launchEnvironment["RT_STUB_APPEARANCE"] = scheme.lowercased()
            app.launch()
            waitFor("setup.welcome.screen"); el("setup.welcome.continue").click()
            waitFor("setup.team.screen"); el("setup.team.card.solo").click()
            el("setup.team.continue").click(); waitFor("setup.checklist.screen")
            el("setup.checklist.continue").click(); waitFor("setup.done.screen", 60)
            app.typeKey(",", modifierFlags: .command)
            waitFor("settings.tab.devLogins"); el("settings.tab.devLogins").click()
            waitFor("settings.devLogins.empty"); shoot("devlogins-empty-\(scheme)")

            el("settings.devLogins.add").click(); waitFor("devLogin.sheet.origin")
            el("devLogin.sheet.origin").click(); el("devLogin.sheet.origin").typeText("https://login.example.com")
            el("devLogin.sheet.email").click(); el("devLogin.sheet.email").typeText("dev@example.com")
            el("devLogin.sheet.password").click(); el("devLogin.sheet.password").typeText("pw")
            XCTAssertFalse(el("devLogin.sheet.save").isEnabled, "a first-time origin needs the typed host")
            shoot("devlogins-sheet-first-time-\(scheme)")
            el("devLogin.sheet.confirmHost").click(); el("devLogin.sheet.confirmHost").typeText("login.example.com")
            waitUntilEnabled("devLogin.sheet.save"); el("devLogin.sheet.save").click()

            waitFor("settings.devLogins.row.https://login.example.com"); shoot("devlogins-list-\(scheme)")
            el("settings.devLogins.replace.https://login.example.com").click(); waitFor("devLogin.sheet.email")
            XCTAssertFalse(el("devLogin.sheet.confirmHost").exists, "replacing a saved site skips the typed host")
            shoot("devlogins-sheet-replace-\(scheme)")
            el("devLogin.sheet.cancel").click()
            app.terminate()
        }
    }
```

Run: `cd rt-tray && xcodegen generate && xcodebuild -project mattstack.xcodeproj -scheme mattstack -only-testing:mattstackUITests/SetupFlowUITests/testDevLoginsPaneLightAndDark test`
Expected: FAIL (`settings.tab.devLogins` missing).

- [ ] **Step 3: Implement the pane, sheet, ids, coordinator and route**

`AccessibilityIDs.swift` additions (inside the existing `AXID` enum, following its style):

```swift
    static let settingsDevLoginsAdd = "settings.devLogins.add"
    static let settingsDevLoginsEmpty = "settings.devLogins.empty"
    static let settingsDevLoginsError = "settings.devLogins.error"
    static func settingsDevLoginsRow(_ origin: String) -> String { "settings.devLogins.row.\(origin)" }
    static func settingsDevLoginsReplace(_ origin: String) -> String { "settings.devLogins.replace.\(origin)" }
    static func settingsDevLoginsDelete(_ origin: String) -> String { "settings.devLogins.delete.\(origin)" }
    static let devLoginSheetOrigin = "devLogin.sheet.origin"
    static let devLoginSheetEmail = "devLogin.sheet.email"
    static let devLoginSheetPassword = "devLogin.sheet.password"
    static let devLoginSheetConfirmHost = "devLogin.sheet.confirmHost"
    static let devLoginSheetSave = "devLogin.sheet.save"
    static let devLoginSheetCancel = "devLogin.sheet.cancel"
    static let devLoginSheetWarning = "devLogin.sheet.warning"
    static let devLoginSheetInvalid = "devLogin.sheet.invalid"
```

`DevLoginSheet.swift`:

```swift
import SwiftUI
import MattstackCore

/// The one place a dev login's values are typed. `fixedOrigin` is set for a
/// link or a Replace; the human types the origin only for a fresh Add.
struct DevLoginSheet: View {
    let fixedOrigin: String?
    let isSaved: (String) -> Bool
    let onSave: (String, String, String) async -> String?
    @State private var originText = ""
    @State private var email = ""
    @State private var password = ""
    @State private var typedHost = ""
    @State private var error: String?
    @State private var saving = false
    @Environment(\.dismiss) private var dismiss

    private var validated: DevLoginOrigin.Result { DevLoginOrigin.validate(fixedOrigin ?? originText) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(fixedOrigin.map { isSaved($0) ? "Replace dev login" : "Save a dev login" } ?? "Save a dev login").font(.headline)
            if let fixedOrigin {
                if case .invalid(let why) = validated {
                    Text("mattstack can't save a login for \(fixedOrigin): \(why)").foregroundStyle(.red)
                        .accessibilityIdentifier(AXID.devLoginSheetInvalid)
                } else {
                    Text(fixedOrigin).font(.title2.monospaced()).textSelection(.enabled)
                }
            } else {
                SetupField(label: "Site", note: "The login page's origin, like https://login.example.com") {
                    TextField("", text: $originText).labelsHidden().textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier(AXID.devLoginSheetOrigin)
                }
            }
            if case .valid(let origin, let host) = validated {
                ForEach(DevLoginConfirm.warnings(origin: origin), id: \.self) { w in
                    Label(w, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange)
                        .accessibilityIdentifier(AXID.devLoginSheetWarning)
                }
                SetupField(label: "Email", note: nil) {
                    TextField("", text: $email).labelsHidden().textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier(AXID.devLoginSheetEmail)
                }
                SetupField(label: "Password", note: "Use a password that only this dev site uses.") {
                    SecureField("", text: $password).labelsHidden().textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier(AXID.devLoginSheetPassword)
                }
                if !isSaved(origin) {
                    SetupField(label: "Type \(host) to confirm", note: "Browser runs will fill this login only on this exact site.") {
                        TextField("", text: $typedHost).labelsHidden().textFieldStyle(.roundedBorder)
                            .accessibilityIdentifier(AXID.devLoginSheetConfirmHost)
                    }
                }
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction).accessibilityIdentifier(AXID.devLoginSheetCancel)
                Button(saving ? "Saving…" : "Save") { save() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(!canSave || saving)
                    .accessibilityIdentifier(AXID.devLoginSheetSave)
            }
        }
        .padding(20)
        .frame(width: 460)
    }

    private var canSave: Bool {
        guard case .valid(let origin, let host) = validated else { return false }
        return DevLoginConfirm.canSave(host: host, typedHost: typedHost, isFirstTime: !isSaved(origin), email: email, password: password)
    }

    private func save() {
        guard case .valid(let origin, _) = validated else { return }
        saving = true
        Task {
            error = await onSave(origin, email, password)
            saving = false
            if error == nil { password = ""; dismiss() }
        }
    }
}
```

`DevLoginsPane.swift`:

```swift
import SwiftUI
import MattstackCore

struct DevLoginsPane: View {
    let env: SettingsEnvironment
    @ObservedObject private var model: DevLoginsModel
    @State private var sheetOrigin: SheetTarget?
    @State private var confirmDelete: String?
    @State private var actionError: String?

    private struct SheetTarget: Identifiable { let origin: String?; var id: String { origin ?? "new" } }

    init(env: SettingsEnvironment) { self.env = env; self.model = env.devLogins }

    var body: some View {
        Form {
            Section {
                if model.rows.isEmpty {
                    Text(model.loaded ? "No dev logins yet. When a browser run hits a dev site's login page, it can fill a login saved here instead of stopping to ask you." : "Loading…")
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier(AXID.settingsDevLoginsEmpty)
                }
                ForEach(model.rows) { row in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(row.origin).font(.body.monospaced())
                            Text("\(row.email)   ••••••").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Replace") { sheetOrigin = SheetTarget(origin: row.origin) }
                            .accessibilityIdentifier(AXID.settingsDevLoginsReplace(row.origin))
                        Button("Delete", role: .destructive) { confirmDelete = row.origin }
                            .accessibilityIdentifier(AXID.settingsDevLoginsDelete(row.origin))
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier(AXID.settingsDevLoginsRow(row.origin))
                }
            } header: {
                HStack {
                    Text("Dev logins")
                    Spacer()
                    Button("Add…") { sheetOrigin = SheetTarget(origin: nil) }.accessibilityIdentifier(AXID.settingsDevLoginsAdd)
                }
            } footer: {
                Text("Saved encrypted on this Mac. Passwords are never shown again; replace or delete them here.").font(.caption)
            }
            if let e = actionError ?? model.error {
                Text(e).font(.caption).foregroundStyle(.red).accessibilityIdentifier(AXID.settingsDevLoginsError)
            }
        }
        .formStyle(.grouped)
        .task { await model.load() }
        .onReceive(model.$addRequest.compactMap { $0 }) { origin in
            model.addRequest = nil
            sheetOrigin = SheetTarget(origin: origin)
        }
        .sheet(item: $sheetOrigin) { target in
            DevLoginSheet(fixedOrigin: target.origin, isSaved: { model.isSaved($0) }) { origin, email, password in
                await model.save(origin: origin, email: email, password: password)
            }
        }
        .confirmationDialog("Delete the dev login for \(confirmDelete ?? "")?", isPresented: Binding(
            get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } })) {
            Button("Delete", role: .destructive) {
                guard let origin = confirmDelete else { return }
                Task { actionError = await model.remove(origin: origin) }
            }
        }
    }
}
```

`SetupCoordinator.swift`: add `let devLogins: DevLoginsModel` initialised in `init` next to `teamSettings` (`devLogins = DevLoginsModel(rt: rt)`), pass `devLogins: devLogins` into the `SettingsEnvironment(...)` call in `showSettings`, and add:

```swift
    func showDevLoginAdd(origin: String) {
        showSettings(pane: .devLogins)
        devLogins.addRequest = origin
    }
```

`AppDelegate.swift`: add `private var pendingDevLoginOrigin: String?` next to `pendingJoinCode` (same doc style: stashed for launch-by-link, drained at the end of `buildServices()`). In `handleGetURL`, directly after the `JoinLink` branch:

```swift
        if let origin = DevLoginLink.origin(from: url) {
            Task { @MainActor in
                guard let coordinator else { pendingDevLoginOrigin = origin; return }
                coordinator.showDevLoginAdd(origin: origin)
            }
            return
        }
```

In `buildServices()`, inside `if let rt = rtClient { ... }` after the `pendingJoinCode` drain:

```swift
            if let origin = pendingDevLoginOrigin {
                pendingDevLoginOrigin = nil
                coordinator?.showDevLoginAdd(origin: origin)
            }
```

and in the `else` branch drop it with `TrayLog.warn("mattstack://dev-logins link received but rt could not be resolved; dropping")` when non-nil. The log names no origin value beyond that sentence.

- [ ] **Step 4: Run the UI test, export and look at the screenshots**

Run: `cd rt-tray && xcodegen generate && xcodebuild -project mattstack.xcodeproj -scheme mattstack -only-testing:mattstackUITests/SetupFlowUITests/testDevLoginsPaneLightAndDark test -resultBundlePath /tmp/devlogins.xcresult && xcrun xcresulttool export attachments --path /tmp/devlogins.xcresult --output-path /tmp/devlogins-shots`
Expected: PASS, eight screenshots.

Open every PNG in `/tmp/devlogins-shots` with the Read tool and write down plainly what looks wrong in each (clipped text, contrast, a field without a label, the dots misaligned, the warning color unreadable in dark). Fix and rerun until both schemes read cleanly. Also run `cd rt-tray && swift run mattstack-checks` (the whole registry) and `bun test ./rt-tray/Tests/stub-rt`.

- [ ] **Step 5: Commit**

```bash
git add rt-tray/Sources rt-tray/Tests
git commit -m "tray: Dev logins settings pane, add sheet and mattstack://dev-logins/add"
```

---

### Task 10: Whole-branch verification

**Files:** none new.

- [ ] **Step 1: Full suites**

Run: `bun run test:all` (unit, e2e and pty) and `bun run check`.
Expected: PASS. A failure elsewhere gets checked against clean `main` before being called pre-existing.

- [ ] **Step 2: Canary sweep**

With an isolated HOME, exercise the CLI end to end and grep every sink for the canary:

```bash
T=$(mktemp -d) && env -i HOME="$T" PATH="$PATH" bun cli.ts logins list --json
```

Expected: `[]` (no age key and no domain file means an empty list, no keychain prompt). Then confirm by reading `lib/daemon/handlers/logins.ts` and `commands/logins.ts` that no path prints or logs `login.password` or `login.email`; the unit tests already assert the daemon log and CLI output.

- [ ] **Step 3: Purity and dashes**

Run: `scripts/repo-purity.sh && git diff origin/main --name-only | xargs grep -nP "[\x{2013}\x{2014}]" || echo "no dashes"`
Expected: purity passes; no new em or en dashes in added lines (pre-existing ones in untouched lines of `lib/secrets/store.ts` are not this branch's).

- [ ] **Step 4: Ask Matt before the real-app check**

The link route and pane have only been seen through the stub. Ask Matt whether to build the dev app with the `rt:build-dev-app` skill so he can run `open "mattstack://dev-logins/add?origin=https%3A%2F%2Flogin.example.com"` against the real daemon; never replace `/Applications/mattstack-dev.app` without that go-ahead.
