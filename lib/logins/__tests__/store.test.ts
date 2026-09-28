import { describe, expect, test } from "bun:test";
import { CorruptLoginError, DEV_LOGINS_DOMAIN, InvalidLoginError, getLogin, listLogins, removeLogin, saveLogin, secretsBackend, type LoginsBackend } from "../store.ts";
import { InvalidOriginError } from "../origin.ts";
import { resetSecretsMemo, secretsFilePath, type SecretsExecSeam, type SecretsSeams } from "../../secrets/store.ts";

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

function decryptOnlySeams(domainFile: Record<string, string>): SecretsSeams {
  const path = secretsFilePath(DEV_LOGINS_DOMAIN);
  const execSeam: Partial<SecretsExecSeam> = {
    fileExists: (p) => p === path,
    statFile: () => null,
    async run(cmd) {
      if (cmd[0] === "sops" && cmd[1] === "-d" && cmd[2] === path) return { code: 0, stdout: JSON.stringify(domainFile), stderr: "" };
      throw new Error(`unexpected call ${cmd.join(" ")}`);
    },
  };
  return {
    ageKeySeam: { async run() { return { code: 0, stdout: "AGE-SECRET-KEY-TEST\n", stderr: "" }; } },
    execSeam: execSeam as SecretsExecSeam,
  };
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

describe("secrets backend", () => {
  test("a site whose key shares a name with an object built-in reads as absent", async () => {
    resetSecretsMemo();
    const b = secretsBackend(decryptOnlySeams({}));
    expect(await b.read("constructor")).toBeNull();
    expect(await getLogin(b, "constructor")).toBeNull();
  });

  test("reads a stored login through the dev-logins domain", async () => {
    resetSecretsMemo();
    const stored = JSON.stringify({ origin: "https://login.example.com", email: "dev@example.com", password: "pw" });
    const b = secretsBackend(decryptOnlySeams({ "login.example.com": stored }));
    expect(await b.names()).toEqual(["login.example.com"]);
    expect(await getLogin(b, "login.example.com")).toEqual({ origin: "https://login.example.com", email: "dev@example.com", password: "pw" });
  });
});
