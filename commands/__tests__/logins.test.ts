import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { devLoginAddUrl, loginsAdd, loginsList, loginsOpenAdd, loginsRemove, type LoginsDeps } from "../logins.ts";
import type { LoginsBackend } from "../../lib/logins/store.ts";
import { NoAgeKeyError } from "../../lib/secrets/store.ts";
import { readStdinJson } from "../../lib/setup/probes.ts";
import { capturePlain } from "./helpers/json-line.ts";

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
    openUrl: (u) => { opened.push(u); return true; },
    json: (v) => { out.push(JSON.stringify(v)); },
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

  test("add --json keeps JSON-special and URL-special characters through the real stdin parser", async () => {
    const piped = JSON.stringify({ email: "dev@example.com", password: CANARY });
    const t = deps({ readStdin: () => readStdinJson(new Response(piped).body!) });
    await loginsAdd(["https://login.example.com", "--json"], {}, t.d);
    expect(JSON.parse(t.data["login.example.com"]!).password).toBe(CANARY);
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
    const message = JSON.parse(t.out.join("")).error.message;
    expect(message).toContain("rt home init");
    expect(message).not.toMatch(/[\u2013\u2014]/);
  });

  test("add in a terminal prompts for both the email and the password hidden", async () => {
    const asked: string[] = [];
    const answers = ["dev@example.com", CANARY];
    const t = deps({
      isTTY: true,
      promptText: async (m) => { asked.push(`text:${m}`); return answers.shift()!; },
      promptSecret: async (m, opts) => { asked.push(`secret:${m}:${opts?.mask ?? ""}`); return answers.shift()!; },
    });
    const cap = capturePlain();
    let printed: string;
    try {
      await loginsAdd(["https://login.example.com"], {}, t.d);
      printed = cap.stdout();
    } finally {
      cap.restore();
    }
    expect(printed).toBe("[ok] Saved the dev login for https://login.example.com\n");
    expect(asked).toEqual(["text:Email for https://login.example.com", "secret:Password for https://login.example.com:*"]);
    expect(JSON.parse(t.data["login.example.com"]!)).toEqual({ origin: "https://login.example.com", email: "dev@example.com", password: CANARY });
    expect(printed).not.toContain(CANARY);
    expect(printed).not.toContain("dev@example.com");
  });

  test("open-add opens the app link and answers with it", async () => {
    const t = deps();
    await loginsOpenAdd(["https://login.example.com:8443/", "--json"], {}, t.d);
    const url = "mattstack://dev-logins/add?origin=https%3A%2F%2Flogin.example.com%3A8443";
    expect(t.opened).toEqual([url]);
    expect(JSON.parse(t.out.pop()!)).toEqual({ ok: true, url });
    expect(devLoginAddUrl("https://login.example.com")).toBe("mattstack://dev-logins/add?origin=https%3A%2F%2Flogin.example.com");
  });

  test("open-add that could not open the app exits 2 with the envelope, never ok", async () => {
    trapExit();
    const t = deps({ openUrl: () => false });
    await expect(loginsOpenAdd(["https://login.example.com", "--json"], {}, t.d)).rejects.toThrow("exit 2");
    const printed = t.out.join("\n");
    expect(JSON.parse(printed).error.code).toBe("open-failed");
    expect(printed).not.toContain('"ok":true');
  });

  test("remove reports whether a login existed", async () => {
    const t = deps({ readStdin: async () => ({ email: "a@example.com", password: "x" }) });
    await loginsAdd(["https://login.example.com", "--json"], {}, t.d);
    await loginsRemove(["https://login.example.com", "--json"], {}, t.d);
    expect(JSON.parse(t.out.pop()!)).toEqual({ ok: true, removed: true });
    await loginsRemove(["https://login.example.com", "--json"], {}, t.d);
    expect(JSON.parse(t.out.pop()!)).toEqual({ ok: true, removed: false });
  });

  test("list for a person is a table, and an empty list points at add", async () => {
    const cap = capturePlain();
    try {
      const t = deps({ readStdin: async () => ({ email: "a@example.com", password: "x" }) });
      await loginsList([], {}, t.d);
      expect(cap.stdout()).toBe("[not yet] No dev logins saved yet\n  next: rt logins add <origin>\n");
      await loginsAdd(["https://login.example.com", "--json"], {}, t.d);
      await loginsList([], {}, t.d);
      expect(cap.stdout()).toContain("https://login.example.com  a@example.com\n");
    } finally {
      cap.restore();
    }
  });

  test("off a TTY with no origin remove fails with usage on stderr and exit 2", async () => {
    const cap = capturePlain();
    trapExit();
    try {
      await expect(loginsRemove([], {}, deps().d)).rejects.toThrow("exit 2");
      expect(cap.stdout()).toBe("");
      expect(cap.stderr()).toBe("Which site?\n  next: rt logins remove <origin>\n");
    } finally {
      cap.restore();
    }
  });
});
