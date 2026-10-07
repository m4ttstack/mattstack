import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { closeStateDb } from "../../state/index.ts";
import * as memberActions from "../members.ts";
import { withRosterKey, withoutMember } from "../members.ts";
import { seedOrg } from "../../../packages/rt-client/test/org-fixture.ts";
import { afterEach, beforeEach, describe, test, expect } from "bun:test";
import { join } from "path";
import { fakeProbes as rawFakeProbes } from "../../setup/__tests__/fakes.ts";
import type { AgeExecResult, AgeKeySeam } from "../../home/age-key.ts";
import { readTeamRecipients, teamSecretsFile, writeTeamRecipients } from "../../secrets/team-store.ts";
import type { SecretsExecResult, SecretsExecSeam, SecretsSeams } from "../../secrets/store.ts";
import { UserActionableError } from "../../errors.ts";
import { orgsDir } from "../../rt-paths.ts";
import { seal, sealReply } from "../invite-crypto.ts";
import { upsertInviteRecord, type InviteRecord } from "../invite-records.ts";
import { membersRemove, membersSync, MembersSyncAbortedError, type MembersSeams } from "../members.ts";
import { teamLocalPath } from "../team-local.ts";
import type { RelayClient } from "../relay-client.ts";

let fixtureHome: string;
let priorHome: string | undefined;
beforeEach(() => {
  priorHome = process.env.HOME;
  closeStateDb();
  fixtureHome = realpathSync(mkdtempSync(`${tmpdir()}/rt-org-fixture-`));
  process.env.HOME = fixtureHome;
  seedOrg({ org: "acme", username: "dev1", roles: { admins: ["dev1"], teams: {} } });
});
afterEach(() => {
  closeStateDb();
  process.env.HOME = priorHome;
  rmSync(fixtureHome, { recursive: true, force: true });
});

const HOME = "/home/x";
const SLUG = "acme";
const OWNER_PUBLIC_KEY = "age19gmvtjcupd0gq46003yh9tepvlj4fr97pfg4zh024fpq0kqfqyys5ftxdh";
const ALICE_PUBLIC_KEY = "age1g7smmpu6s9480mmmczw9vvcukwetteh3s7grduzr2zw74d8j99msrdyzhx";
const ID_HEX = "0102030405060708090a0b0c0d0e0f10";
const KEY = new Uint8Array(32).fill(9);
const CREATOR_SECRET = "creator-secret-alice";

function fakeProbes(opts: Parameters<typeof rawFakeProbes>[0] = {}) {
  const home = opts.home ?? HOME;
  return rawFakeProbes({ ...opts, files: {
    [`${home}/.mattstack/teams/acme/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.org": { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } } }),
    [teamLocalPath(home, "acme")]: JSON.stringify({ forgeUsername: "dev1" }),
    ...opts.files,
  } });
}

function teamCloneRootFor(slug: string): string {
  return join(orgsDir(), slug);
}

function probesWithJoinedTeam(slug = SLUG, username = "dev2") {
  return fakeProbes({
    home: HOME,
    files: { [teamLocalPath(HOME, slug)]: JSON.stringify({ createdByRt: false, joinedByRt: true, rtMayManageMembership: false, forgeUsername: username }) },
  });
}

function fakeAgeKeySeam(privateKey = "AGE-SECRET-KEY-1OWNER", publicKey = OWNER_PUBLIC_KEY): AgeKeySeam {
  return {
    async run(cmd): Promise<AgeExecResult> {
      if (cmd[0] === "security" && cmd[1] === "find-generic-password") return { code: 0, stdout: `${privateKey}\n`, stderr: "" };
      if (cmd[0] === "age-keygen" && cmd[1] === "-y") return { code: 0, stdout: `${publicKey}\n`, stderr: "" };
      throw new Error(`fakeAgeKeySeam: unexpected call ${cmd.join(" ")}`);
    },
  };
}

/**
 * A keychain with provably no key yet (readAgeKey's `{absent: true}`
 * outcome) — every command it sees is recorded, so a test can assert
 * `membersRemove`'s own-key guard never mints (never calls
 * `security add-generic-password`/`age-keygen` with no `-y`) just to check
 * whether a removal target is this machine's own key.
 */
function fakeAgeKeySeamAbsent(): AgeKeySeam & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async run(cmd): Promise<AgeExecResult> {
      calls.push(cmd);
      if (cmd[0] === "security" && cmd[1] === "find-generic-password") {
        return { code: 44, stdout: "", stderr: "The specified item could not be found in the keychain." };
      }
      throw new Error(`fakeAgeKeySeamAbsent: unexpected call ${cmd.join(" ")} — a removal must never provision a keychain item`);
    },
  };
}

/** Mirrors lib/secrets/__tests__/team-store.test.ts's own fake — a minimal round-trippable-plaintext sops/age stand-in, local to this file since that one isn't exported. */
class FakeTeamExecSeam implements SecretsExecSeam {
  calls: { cmd: string[]; opts?: { env?: Record<string, string>; sensitive?: boolean } }[] = [];
  files = new Map<string, string>();
  private mtimeCounter = 0;
  private stats = new Map<string, { mtimeMs: number; size: number }>();
  private roundTrippablePlaintext = new Map<string, string>();
  private updatekeysCallCount = 0;
  private failUpdatekeysOnCall?: number;

  constructor(opts: { failUpdatekeysOnCall?: number } = {}) {
    this.failUpdatekeysOnCall = opts.failUpdatekeysOnCall;
  }

  fileExists(path: string): boolean {
    return this.files.has(path);
  }

  listDir(dirPath: string): string[] {
    const prefix = dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
    const names: string[] = [];
    for (const p of this.files.keys()) {
      if (p.startsWith(prefix) && !p.slice(prefix.length).includes("/")) names.push(p.slice(prefix.length));
    }
    return names;
  }

  private touch(path: string): void {
    this.mtimeCounter += 1;
    this.stats.set(path, { mtimeMs: this.mtimeCounter, size: this.files.get(path)?.length ?? 0 });
  }

  statFile(path: string): { mtimeMs: number; size: number } | null {
    return this.stats.get(path) ?? null;
  }

  readFile(path: string): string {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`FakeTeamExecSeam: readFile of missing path ${path}`);
    return content;
  }

  writeFile(path: string, content: string): void {
    this.files.set(path, content);
    this.touch(path);
  }

  ensureDir(): void {}
  chmod(): void {}

  fsyncAndRename(from: string, to: string): void {
    const content = this.files.get(from);
    if (content !== undefined) {
      this.files.set(to, content);
      this.files.delete(from);
      this.stats.delete(from);
      this.touch(to);
    }
    const plaintext = this.roundTrippablePlaintext.get(from);
    if (plaintext !== undefined) {
      this.roundTrippablePlaintext.set(to, plaintext);
      this.roundTrippablePlaintext.delete(from);
    }
  }

  removeFile(path: string): void {
    this.files.delete(path);
    this.stats.delete(path);
  }

  async run(cmd: string[], runOpts?: { env?: Record<string, string>; sensitive?: boolean }): Promise<SecretsExecResult> {
    this.calls.push({ cmd, opts: runOpts });

    if (cmd[0] === "sops" && cmd[1] === "-d") {
      const target = cmd[cmd.length - 1]!;
      const staged = this.roundTrippablePlaintext.get(target);
      return { code: 0, stdout: staged ?? "{}", stderr: "" };
    }
    if (cmd[0] === "sops" && cmd[1] === "-e") {
      const outputIdx = cmd.indexOf("--output");
      const outputPath = cmd[outputIdx + 1]!;
      const stagingInputPath = cmd[cmd.length - 1]!;
      this.files.set(outputPath, JSON.stringify({ data: "opaque", sops: {} }));
      this.touch(outputPath);
      const staged = this.files.get(stagingInputPath);
      if (staged !== undefined) this.roundTrippablePlaintext.set(outputPath, staged);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (cmd[0] === "sops" && cmd[1] === "updatekeys") {
      this.updatekeysCallCount += 1;
      if (this.failUpdatekeysOnCall === this.updatekeysCallCount) {
        return { code: 1, stdout: "", stderr: "sops: boom" };
      }
      return { code: 0, stdout: "", stderr: "" };
    }

    throw new Error(`FakeTeamExecSeam: unexpected call ${cmd.join(" ")}`);
  }
}

function seamsWithClone(slug = SLUG, opts: { failUpdatekeysOnCall?: number } = {}): { execSeam: FakeTeamExecSeam; secrets: SecretsSeams } {
  const execSeam = new FakeTeamExecSeam(opts);
  execSeam.files.set(teamCloneRootFor(slug), "");
  return { execSeam, secrets: { ageKeySeam: fakeAgeKeySeam(), execSeam } };
}

function fakeMembersSeams(overrides: Partial<MembersSeams> = {}): { seams: MembersSeams; writes: { key: string; value: unknown; scope: string; opts: unknown }[] } {
  const writes: { key: string; value: unknown; scope: string; opts: unknown }[] = [];
  let store: Record<string, unknown> = {};
  const seams: MembersSeams = {
    readTeamStore: () => store,
    writeSetting: ((key: string, value: unknown, scope: string, opts?: unknown) => {
      writes.push({ key, value, scope, opts });
      if (key === "mattstack.roster") store = { ...store, [key]: value };
    }) as MembersSeams["writeSetting"],
    currentOrg: () => SLUG,
    revokeRead: async () => ({ access: "revoked", manualSteps: [] }),
    readTeamLocal: () => ({ createdByRt: true, joinedByRt: false, rtMayManageMembership: true }),
    forgeToken: async () => null,
    warn: () => {},
    readLocalSecret: async () => null,
    ...overrides,
  };
  return { seams, writes };
}

interface FakeRelayOpts {
  readReply?: RelayClient["readReply"];
}

function fakeRelay(opts: FakeRelayOpts = {}): RelayClient {
  return {
    async create() {
      throw new Error("create not used by members sync/remove");
    },
    async fetch() {
      throw new Error("fetch not used by members sync/remove");
    },
    async redeem() {
      throw new Error("redeem not used by members sync/remove");
    },
    async reply() {
      throw new Error("reply not used by members sync/remove");
    },
    async readReply(id, creatorSecret) {
      if (opts.readReply) return opts.readReply(id, creatorSecret);
      return "none";
    },
    async delete() {
      throw new Error("delete not used by members sync/remove");
    },
  };
}

function aliceRecord(overrides: Partial<InviteRecord> = {}): InviteRecord {
  return { id: ID_HEX, creatorSecret: CREATOR_SECRET, keyB64: Buffer.from(KEY).toString("base64"), expiresAt: "2026-12-01T00:00:00.000Z", ...overrides };
}

async function replyBlob(agePublicKey: string, handle?: string): Promise<string> {
  return sealReply({ v: 1, agePublicKey, handle }, KEY, ID_HEX);
}

describe("membersSync", () => {
  test("a record whose reply exists gets added (alongside the owner's own bootstrap key), sops updatekeys runs, and the invite record is removed", async () => {
    const p = fakeProbes({ home: HOME });
    upsertInviteRecord(p, SLUG, "alice", aliceRecord());
    const { execSeam, secrets } = seamsWithClone();
    execSeam.writeFile(teamSecretsFile(SLUG, "board"), JSON.stringify({ data: "opaque", sops: {} }));
    const { seams, writes } = fakeMembersSeams();
    const blob = await replyBlob(ALICE_PUBLIC_KEY, "alice");
    const relay = fakeRelay({ readReply: async () => ({ blob }) });

    const result = await membersSync(p, relay, secrets, SLUG, seams);

    // Owner's own bootstrap add is reported too — a fresh team's first sync
    // must not read as "added 0 key(s)".
    expect(result.added).toEqual([OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY]);
    // Handles, not keys: the tray's outcome banner matches the invitee it named against this list.
    expect(result.addedHandles).toEqual(["alice"]);
    expect(result.pending).toEqual([]);
    expect(execSeam.calls.some((c) => c.cmd[0] === "sops" && c.cmd[1] === "updatekeys")).toBe(true);
    expect(p.readFile(join(HOME, ".mattstack", "rt", "invites", `${SLUG}.json`))).toBe("{}");
    // Roster gained alice with her age key, via writeSetting("mattstack.roster", ..., "org").
    const rosterWrite = writes.find((w) => w.key === "mattstack.roster" && (w.value as { username: string }[]).some((m) => m.username === "alice"));
    expect(rosterWrite).toBeDefined();
    expect((rosterWrite!.value as { username: string; agePublicKey?: string }[]).find((m) => m.username === "alice")?.agePublicKey).toBe(ALICE_PUBLIC_KEY);
    expect(rosterWrite!.scope).toBe("org");
    expect(rosterWrite!.opts).toBeUndefined();
    expect(Object.keys(result).sort()).toEqual(["added", "addedHandles", "pending", "reencrypted"]);
    expect(Object.values(result).every(Array.isArray)).toBe(true);
  });

  test("a second sync run with no new replies reports nothing added (the owner's key is already a recipient)", async () => {
    const p = fakeProbes({ home: HOME });
    const { secrets } = seamsWithClone();
    const { seams } = fakeMembersSeams();
    const relay = fakeRelay();

    await membersSync(p, relay, secrets, SLUG, seams); // bootstrap run
    const result = await membersSync(p, relay, secrets, SLUG, seams); // second run

    expect(result.added).toEqual([]);
  });

  test("no reply yet -> the handle is reported pending, the invite record stays", async () => {
    const p = fakeProbes({ home: HOME });
    upsertInviteRecord(p, SLUG, "alice", aliceRecord());
    const { secrets } = seamsWithClone();
    const { seams } = fakeMembersSeams();
    const relay = fakeRelay(); // readReply -> "none"

    const result = await membersSync(p, relay, secrets, SLUG, seams);

    expect(result.added).toEqual([OWNER_PUBLIC_KEY]); // just the bootstrap add
    expect(result.pending).toEqual(["alice"]);
    const raw = p.readFile(join(HOME, ".mattstack", "rt", "invites", `${SLUG}.json`));
    expect(JSON.parse(raw!)).toHaveProperty("alice");
  });

  test("the owner's own key is always a recipient afterwards, even with zero invite records", async () => {
    const p = fakeProbes({ home: HOME });
    const { secrets } = seamsWithClone();
    const { seams } = fakeMembersSeams();
    const relay = fakeRelay();

    await membersSync(p, relay, secrets, SLUG, seams);

    expect(readTeamRecipients(SLUG, secrets)).toContain(OWNER_PUBLIC_KEY);
  });

  test("a reply that decrypts but carries a malformed age key never reaches .sops.yaml, and stays pending for a retry", async () => {
    const p = fakeProbes({ home: HOME });
    upsertInviteRecord(p, SLUG, "alice", aliceRecord());
    const { secrets } = seamsWithClone();
    const { seams } = fakeMembersSeams();
    // A structurally-valid reply (decrypts, has a string agePublicKey) but the string is not a real age1 recipient.
    const blob = await replyBlob("not-an-age-key\nage: age1attacker", "alice");
    const relay = fakeRelay({ readReply: async () => ({ blob }) });

    const result = await membersSync(p, relay, secrets, SLUG, seams);

    expect(result.added).toEqual([OWNER_PUBLIC_KEY]);
    expect(result.pending).toEqual(["alice"]);
    expect(readTeamRecipients(SLUG, secrets)).not.toContain("not-an-age-key\nage: age1attacker");
    // The invite record survives so a legitimate reply can still be picked up next sync.
    const raw = p.readFile(join(HOME, ".mattstack", "rt", "invites", `${SLUG}.json`));
    expect(JSON.parse(raw!)).toHaveProperty("alice");
  });

  test("a reply that fails to decrypt (wrong key material) is treated the same as malformed, not a crash", async () => {
    const p = fakeProbes({ home: HOME });
    upsertInviteRecord(p, SLUG, "alice", aliceRecord());
    const { secrets } = seamsWithClone();
    const { seams } = fakeMembersSeams();
    const wrongKey = new Uint8Array(32).fill(1);
    const blob = await sealReply({ v: 1, agePublicKey: ALICE_PUBLIC_KEY }, wrongKey, ID_HEX); // sealed under a DIFFERENT key than the record's keyB64
    const relay = fakeRelay({ readReply: async () => ({ blob }) });

    const result = await membersSync(p, relay, secrets, SLUG, seams);

    expect(result.added).toEqual([OWNER_PUBLIC_KEY]);
    expect(result.pending).toEqual(["alice"]);
  });

  describe("the age-key bech32 checksum gate", () => {
    test("age1 + 50 junk characters (the old regex's minimum) is rejected", async () => {
      const p = fakeProbes({ home: HOME });
      upsertInviteRecord(p, SLUG, "alice", aliceRecord());
      const { secrets } = seamsWithClone();
      const { seams } = fakeMembersSeams();
      const junk = `age1${"q".repeat(50)}`;
      const blob = await replyBlob(junk);
      const relay = fakeRelay({ readReply: async () => ({ blob }) });

      const result = await membersSync(p, relay, secrets, SLUG, seams);

      expect(result.pending).toEqual(["alice"]);
      expect(readTeamRecipients(SLUG, secrets)).not.toContain(junk);
    });

    test("age1 + 200 junk characters (no upper bound under the old regex) is rejected", async () => {
      const p = fakeProbes({ home: HOME });
      upsertInviteRecord(p, SLUG, "alice", aliceRecord());
      const { secrets } = seamsWithClone();
      const { seams } = fakeMembersSeams();
      const junk = `age1${"q".repeat(200)}`;
      const blob = await replyBlob(junk);
      const relay = fakeRelay({ readReply: async () => ({ blob }) });

      const result = await membersSync(p, relay, secrets, SLUG, seams);

      expect(result.pending).toEqual(["alice"]);
      expect(readTeamRecipients(SLUG, secrets)).not.toContain(junk);
    });

    test("a real key with its checksum corrupted (right length, right charset, wrong checksum) is rejected", async () => {
      const p = fakeProbes({ home: HOME });
      upsertInviteRecord(p, SLUG, "alice", aliceRecord());
      const { secrets } = seamsWithClone();
      const { seams } = fakeMembersSeams();
      const corrupted = `${ALICE_PUBLIC_KEY.slice(0, -1)}${ALICE_PUBLIC_KEY.at(-1) === "x" ? "y" : "x"}`;
      expect(corrupted).not.toBe(ALICE_PUBLIC_KEY);
      expect(corrupted.length).toBe(ALICE_PUBLIC_KEY.length);
      const blob = await replyBlob(corrupted);
      const relay = fakeRelay({ readReply: async () => ({ blob }) });

      const result = await membersSync(p, relay, secrets, SLUG, seams);

      expect(result.pending).toEqual(["alice"]);
      expect(readTeamRecipients(SLUG, secrets)).not.toContain(corrupted);
    });

    test("a forged key with a VALID checksum but a dirty final padding group (BIP-173's non-zero-padding rule) is rejected", async () => {
      // A real key (last payload group's low bits legitimately zero) with those bits set and the checksum recomputed to match — real `age -r` rejects this exact key with "non-zero padding".
      const forged = "age1dxgc42vutd4a6q5zqkdg6q4jccysl8q9lqg7j5r78cd9y5m2usq0wmgpdc";
      expect(forged.length).toBe(62);

      const p = fakeProbes({ home: HOME });
      upsertInviteRecord(p, SLUG, "alice", aliceRecord());
      const { secrets } = seamsWithClone();
      const { seams } = fakeMembersSeams();
      const blob = await replyBlob(forged);
      const relay = fakeRelay({ readReply: async () => ({ blob }) });

      const result = await membersSync(p, relay, secrets, SLUG, seams);

      expect(result.pending).toEqual(["alice"]);
      expect(readTeamRecipients(SLUG, secrets)).not.toContain(forged);
    });

    test("the real key the forged one above was derived from is still accepted — the padding check must not over-reject a genuine age-keygen key", async () => {
      const real = "age1dxgc42vutd4a6q5zqkdg6q4jccysl8q9lqg7j5r78cd9y5m2usqq3kmajq";
      expect(real.length).toBe(62);

      const p = fakeProbes({ home: HOME });
      upsertInviteRecord(p, SLUG, "alice", aliceRecord());
      const { secrets } = seamsWithClone();
      const { seams } = fakeMembersSeams();
      const blob = await replyBlob(real, "alice");
      const relay = fakeRelay({ readReply: async () => ({ blob }) });

      const result = await membersSync(p, relay, secrets, SLUG, seams);

      expect(result.added).toContain(real);
      expect(result.pending).toEqual([]);
      expect(readTeamRecipients(SLUG, secrets)).toContain(real);
    });
  });

  describe("first-claim-wins: a reply echoing an already-recorded key", () => {
    test("a reply that echoes the OWNER's own key is rejected at sync time, never recorded on the handle's roster entry", async () => {
      const p = fakeProbes({ home: HOME });
      upsertInviteRecord(p, SLUG, "alice", aliceRecord());
      const { secrets } = seamsWithClone();
      const { seams, writes } = fakeMembersSeams();
      // The owner's .sops.yaml is public in the team repo — this is the exact echo attack.
      const blob = await replyBlob(OWNER_PUBLIC_KEY, "alice");
      const relay = fakeRelay({ readReply: async () => ({ blob }) });

      const result = await membersSync(p, relay, secrets, SLUG, seams);

      expect(result.added).toEqual([OWNER_PUBLIC_KEY]); // only the owner's own bootstrap add, not a second "add" of the same key for alice
      expect(result.pending).toEqual(["alice"]);
      // The invite record is retained so a legitimate reply can still land.
      const raw = p.readFile(join(HOME, ".mattstack", "rt", "invites", `${SLUG}.json`));
      expect(JSON.parse(raw!)).toHaveProperty("alice");
      // No roster entry was ever written recording the owner's key as alice's.
      const aliceRosterWrite = writes.find((w) => w.key === "mattstack.roster" && (w.value as { username: string }[]).some((m) => m.username === "alice"));
      expect(aliceRosterWrite).toBeUndefined();
      expect(readTeamRecipients(SLUG, secrets)).toEqual([OWNER_PUBLIC_KEY]);
    });

    test("a reply echoing another member's already-synced key is likewise rejected, not just the owner's", async () => {
      const p = fakeProbes({ home: HOME });
      upsertInviteRecord(p, SLUG, "alice", aliceRecord());
      upsertInviteRecord(p, SLUG, "mallory", aliceRecord({ id: "1102030405060708090a0b0c0d0e0f10", creatorSecret: "creator-secret-mallory" }));
      const { secrets } = seamsWithClone();
      const { seams } = fakeMembersSeams();
      const aliceBlob = await replyBlob(ALICE_PUBLIC_KEY, "alice");
      const malloryBlob = await replyBlob(ALICE_PUBLIC_KEY, "mallory"); // echoes alice's key, not the owner's
      const relay = fakeRelay({
        readReply: async (id) => ({ blob: id === ID_HEX ? aliceBlob : malloryBlob }),
      });

      const result = await membersSync(p, relay, secrets, SLUG, seams);

      expect(result.added).toEqual([OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY]);
      expect(result.pending).toEqual(["mallory"]);
      expect(readTeamRecipients(SLUG, secrets)).toEqual([ALICE_PUBLIC_KEY, OWNER_PUBLIC_KEY].sort());
    });
  });

  test("reencrypted lists every file touched across the owner-ensure call and every added invite, deduped", async () => {
    const p = fakeProbes({ home: HOME });
    upsertInviteRecord(p, SLUG, "alice", aliceRecord());
    const { execSeam, secrets } = seamsWithClone();
    const { seams } = fakeMembersSeams();
    execSeam.writeFile(teamSecretsFile(SLUG, "board"), JSON.stringify({ data: "opaque", sops: {} }));
    const blob = await replyBlob(ALICE_PUBLIC_KEY);
    const relay = fakeRelay({ readReply: async () => ({ blob }) });

    const result = await membersSync(p, relay, secrets, SLUG, seams);

    expect(result.reencrypted).toEqual([teamSecretsFile(SLUG, "board")]);
  });

  test("multiple pending handles are all reported, sorted by iteration order", async () => {
    const p = fakeProbes({ home: HOME });
    upsertInviteRecord(p, SLUG, "alice", aliceRecord());
    upsertInviteRecord(p, SLUG, "bob", aliceRecord({ id: "1102030405060708090a0b0c0d0e0f10", creatorSecret: "creator-secret-bob" }));
    const { secrets } = seamsWithClone();
    const { seams } = fakeMembersSeams();
    const relay = fakeRelay();

    const result = await membersSync(p, relay, secrets, SLUG, seams);

    expect(result.pending.sort()).toEqual(["alice", "bob"]);
  });

  test("a mid-sync infrastructure failure throws MembersSyncAbortedError carrying what already landed", async () => {
    const p = fakeProbes({ home: HOME });
    upsertInviteRecord(p, SLUG, "alice", aliceRecord());
    upsertInviteRecord(p, SLUG, "bob", aliceRecord({ id: "1102030405060708090a0b0c0d0e0f10", creatorSecret: "creator-secret-bob" }));
    // Call 1: owner's bootstrap add (no domain files yet, no updatekeys call).
    // Call 2: alice's add — the first real updatekeys call — force IT to fail.
    const { execSeam, secrets } = seamsWithClone(SLUG, { failUpdatekeysOnCall: 1 });
    execSeam.writeFile(teamSecretsFile(SLUG, "board"), JSON.stringify({ data: "opaque", sops: {} }));
    const { seams } = fakeMembersSeams();
    const aliceBlob = await replyBlob(ALICE_PUBLIC_KEY, "alice");
    const bobBlob = await replyBlob("age1g7smmpu6s9480mmmczw9vvcukwetteh3s7grduzr2zw74d8j99msrdyzhx", "bob"); // never reached
    const relay = fakeRelay({ readReply: async (id) => ({ blob: id === ID_HEX ? aliceBlob : bobBlob }) });

    let thrown: unknown;
    try {
      await membersSync(p, relay, secrets, SLUG, seams);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(MembersSyncAbortedError);
    const err = thrown as MembersSyncAbortedError;
    // Nothing landed before the failing add — the owner's own bootstrap add had no domain file to re-encrypt yet.
    expect(err.added).toEqual([]);
    expect(err.pending).toEqual([]);
    expect(err.message).toBe("rt stopped syncing members partway, after adding 0 keys");
    expect(err.detail).toStartWith("added none; pending none; ");
  });

  test("sync and remove refuse an org this Mac does not read settings from, writing nothing", async () => {
    const p = fakeProbes({ home: HOME });
    const { secrets } = seamsWithClone();
    const { seams, writes } = fakeMembersSeams({ currentOrg: () => "zeta" });

    await expect(membersSync(p, fakeRelay(), secrets, SLUG, seams)).rejects.toMatchObject({ code: "org-not-current", next: "rt team members sync --team zeta" });
    await expect(membersRemove(p, secrets, SLUG, "alice", undefined, seams)).rejects.toMatchObject({
      code: "org-not-current",
      next: "rt team members remove alice --team zeta",
    });
    expect(writes).toEqual([]);
  });

  test("membersSync refuses on a joined clone", async () => {
    const p = probesWithJoinedTeam();
    const { secrets } = seamsWithClone();
    const { seams } = fakeMembersSeams();
    const relay = fakeRelay();

    await expect(membersSync(p, relay, secrets, SLUG, seams)).rejects.toMatchObject({ code: "team-pull-only", message: "The org's shared files belong to its admins" });
  });
});

describe("membersRemove", () => {
  function gitConfigWithRemote(remote: string): string {
    return `[remote "origin"]\n\turl = ${remote}\n`;
  }

  // MAT-387: removal FAILS OPEN — the person keeps repo access when rt is not
  // permitted to revoke it. Silence there would read as "removed" while they
  // could still clone, so the warning is the point of these two tests.
  test("without the membership permission: never calls the forge, and says they still have access", async () => {
    const remote = "git@github.com:acme/widgets.git";
    const p = fakeProbes({ home: HOME, files: { [join(HOME, ".mattstack", "teams", SLUG, ".git", "config")]: gitConfigWithRemote(remote) } });
    const { execSeam, secrets } = seamsWithClone();
    writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY], secrets);
    execSeam.writeFile(teamSecretsFile(SLUG, "board"), JSON.stringify({ data: "opaque", sops: {} }));

    const revokeCalls: unknown[] = [];
    const { seams } = fakeMembersSeams({
      readTeamStore: () => ({ "mattstack.roster": [{ username: "matt" }, { username: "alice", agePublicKey: ALICE_PUBLIC_KEY }] }),
      readTeamLocal: () => ({ createdByRt: false, joinedByRt: false, rtMayManageMembership: false }),
      revokeRead: async (...args) => {
        revokeCalls.push(args);
        return { access: "revoked", manualSteps: [] };
      },
    });

    const result = await membersRemove(p, secrets, SLUG, "alice", undefined, seams);

    expect(revokeCalls).toEqual([]);
    expect(result.forgeAccess).toBe("skipped");
    expect(result.manualSteps.join(" ")).toContain("can still see the team repo");
    expect(result.manualSteps[0]).toStartWith("alice ");
    // The rest of the removal still happens — declining to administer someone
    // else's repo must not leave the member half-removed locally.
    expect(result.rosterRemoved).toBe(true);
    expect(readTeamRecipients(SLUG, secrets)).toEqual([OWNER_PUBLIC_KEY]);
  });

  // Mirrors the mint side's own regression test (MAT-387): the permission
  // alone must not be enough on a repo rt did not create, since the record
  // is a file a human can hand-edit.
  test("the permission alone, without createdByRt, still never calls the forge", async () => {
    const remote = "git@github.com:acme/widgets.git";
    const p = fakeProbes({ home: HOME, files: { [join(HOME, ".mattstack", "teams", SLUG, ".git", "config")]: gitConfigWithRemote(remote) } });
    const { execSeam, secrets } = seamsWithClone();
    writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY], secrets);
    execSeam.writeFile(teamSecretsFile(SLUG, "board"), JSON.stringify({ data: "opaque", sops: {} }));

    const revokeCalls: unknown[] = [];
    const { seams } = fakeMembersSeams({
      readTeamStore: () => ({ "mattstack.roster": [{ username: "matt" }, { username: "alice", agePublicKey: ALICE_PUBLIC_KEY }] }),
      readTeamLocal: () => ({ createdByRt: false, joinedByRt: false, rtMayManageMembership: true }),
      revokeRead: async (...args) => {
        revokeCalls.push(args);
        return { access: "revoked", manualSteps: [] };
      },
    });

    const result = await membersRemove(p, secrets, SLUG, "alice", undefined, seams);

    expect(revokeCalls).toEqual([]);
    expect(result.forgeAccess).toBe("skipped");
    expect(result.manualSteps.join(" ")).toContain("can still see the team repo");
  });

  test("without the permission, the key recorded on mattstack.roster is still revoked and the row removed", async () => {
    const remote = "git@github.com:acme/widgets.git";
    const p = fakeProbes({ home: HOME, files: { [join(HOME, ".mattstack", "teams", SLUG, ".git", "config")]: gitConfigWithRemote(remote) } });
    const { execSeam, secrets } = seamsWithClone();
    writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY], secrets);
    execSeam.writeFile(teamSecretsFile(SLUG, "board"), JSON.stringify({ data: "opaque", sops: {} }));

    const written: { key: string; value: unknown }[] = [];
    const { seams } = fakeMembersSeams({
      readTeamStore: () => ({ "mattstack.roster": [{ username: "matt" }, { username: "alice", agePublicKey: ALICE_PUBLIC_KEY }] }),
      readTeamLocal: () => ({ createdByRt: false, joinedByRt: false, rtMayManageMembership: false }),
      writeSetting: ((key: string, value: unknown) => {
        written.push({ key, value });
      }) as MembersSeams["writeSetting"],
    });

    const result = await membersRemove(p, secrets, SLUG, "alice", undefined, seams);

    expect(result.rosterRemoved).toBe(true);
    expect(readTeamRecipients(SLUG, secrets)).toEqual([OWNER_PUBLIC_KEY]);
    expect(written.some((w) => w.key === "mattstack.roster" && JSON.stringify(w.value) === JSON.stringify([{ username: "matt" }]))).toBe(true);
  });

  test("revokes forge access, writes the roster without the handle, re-encrypts, and returns a non-empty residue note", async () => {
    const remote = "git@github.com:acme/widgets.git";
    const p = fakeProbes({ home: HOME, files: { [join(HOME, ".mattstack", "teams", SLUG, ".git", "config")]: gitConfigWithRemote(remote) } });
    const { execSeam, secrets } = seamsWithClone();
    // alice is already a recipient (as if membersSync had run for her already), with a real domain file to re-encrypt.
    writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY], secrets);
    execSeam.writeFile(teamSecretsFile(SLUG, "board"), JSON.stringify({ data: "opaque", sops: {} }));

    const revokeCalls: { remote: string; handle: string; token: string | null | undefined }[] = [];
    const { seams, writes } = fakeMembersSeams({
      readTeamStore: () => ({ "mattstack.roster": [{ username: "matt" }, { username: "alice", agePublicKey: ALICE_PUBLIC_KEY }] }),
      readTeamLocal: () => ({ createdByRt: true, joinedByRt: false, rtMayManageMembership: true }),
      forgeToken: async () => "ghp-secret",
      revokeRead: async (_p, r, h, token) => {
        revokeCalls.push({ remote: r, handle: h, token });
        return { access: "revoked", manualSteps: [] };
      },
    });

    const result = await membersRemove(p, secrets, SLUG, "alice", undefined, seams);

    expect(revokeCalls).toEqual([{ remote, handle: "alice", token: "ghp-secret" }]);
    expect(result.forgeAccess).toBe("revoked");
    expect(result.rosterRemoved).toBe(true);
    const rosterWrite = writes.find((w) => w.key === "mattstack.roster");
    expect((rosterWrite!.value as { username: string }[]).map((m) => m.username)).toEqual(["matt"]);
    expect(result.reencrypted).toEqual([teamSecretsFile(SLUG, "board")]);
    expect(execSeam.calls.some((c) => c.cmd[0] === "sops" && c.cmd[1] === "updatekeys")).toBe(true);
    expect(readTeamRecipients(SLUG, secrets)).toEqual([OWNER_PUBLIC_KEY]);
    expect(result.residueNote.length).toBeGreaterThan(0);
    expect(result.residueNote).toContain("Rotate those values to shut them out.");
    expect(Object.keys(result).sort()).toEqual(["boardPeering", "forgeAccess", "manualSteps", "reencrypted", "residueNote", "rosterRemoved"]);
    expect({ forgeAccess: typeof result.forgeAccess, residueNote: typeof result.residueNote, rosterRemoved: typeof result.rosterRemoved }).toEqual({ forgeAccess: "string", residueNote: "string", rosterRemoved: "boolean" });
  });

  test("an explicit agePublicKey overrides whatever the roster carries", async () => {
    const p = fakeProbes({ home: HOME });
    const { secrets } = seamsWithClone();
    writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY], secrets);
    const { seams } = fakeMembersSeams({ readTeamStore: () => ({ "mattstack.roster": [] }) });

    const result = await membersRemove(p, secrets, SLUG, "alice", ALICE_PUBLIC_KEY, seams);

    expect(readTeamRecipients(SLUG, secrets)).toEqual([OWNER_PUBLIC_KEY]);
    expect(result.rosterRemoved).toBe(false); // no roster entry to remove, but the recipient still comes out
  });

  test("an explicit --key with no roster entry removes a recipient the roster never recorded", async () => {
    const p = fakeProbes({ home: HOME });
    const { secrets } = seamsWithClone();
    // A recipient with no roster entry at all — a hand-edited store, or a key that was never legitimately assigned to any handle.
    writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY], secrets);
    const { seams } = fakeMembersSeams({ readTeamStore: () => ({ "mattstack.roster": [] }) });

    const result = await membersRemove(p, secrets, SLUG, "unrecorded-recipient", ALICE_PUBLIC_KEY, seams);

    expect(result.rosterRemoved).toBe(false);
    expect(readTeamRecipients(SLUG, secrets)).toEqual([OWNER_PUBLIC_KEY]);
  });

  test("an explicit --key that fails the bech32 checksum is refused before any mutation", async () => {
    const p = fakeProbes({ home: HOME });
    const { secrets } = seamsWithClone();
    writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY], secrets);
    const { seams, writes } = fakeMembersSeams({ readTeamStore: () => ({ "mattstack.roster": [] }) });

    await expect(membersRemove(p, secrets, SLUG, "alice", `age1${"q".repeat(50)}`, seams)).rejects.toThrow(UserActionableError);

    expect(writes).toEqual([]);
    expect(readTeamRecipients(SLUG, secrets)).toEqual([OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY]);
  });

  test("a private key passed as --key never reaches the error's log", async () => {
    const p = fakeProbes({ home: HOME });
    const { secrets } = seamsWithClone();
    const { seams } = fakeMembersSeams({ readTeamStore: () => ({ "mattstack.roster": [] }) });
    const privateKey = `AGE-SECRET-KEY-1${"Q7X".repeat(20)}`;

    const err = await membersRemove(p, secrets, SLUG, "alice", privateKey, seams).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UserActionableError);
    const actionable = err as UserActionableError;
    expect(actionable.code).toBe("invalid-age-key");
    expect(actionable.log ?? "").not.toContain(privateKey);
    expect(`${actionable.message} ${actionable.why ?? ""} ${actionable.next ?? ""}`).not.toContain(privateKey);
  });

  test("no git remote configured -> forge access is skipped, never a crash", async () => {
    const p = fakeProbes({ home: HOME }); // no .git/config at all
    const { secrets } = seamsWithClone();
    const { seams } = fakeMembersSeams({ readTeamStore: () => ({ "mattstack.roster": [] }) });

    const result = await membersRemove(p, secrets, SLUG, "alice", undefined, seams);

    expect(result.forgeAccess).toBe("skipped");
  });

  test("no agePublicKey anywhere (never synced) -> no recipient-removal call, still reports the residue note honestly", async () => {
    const p = fakeProbes({ home: HOME });
    const { execSeam, secrets } = seamsWithClone();
    const { seams } = fakeMembersSeams({ readTeamStore: () => ({ "mattstack.roster": [{ username: "alice" }] }) });
    execSeam.calls.length = 0;

    const result = await membersRemove(p, secrets, SLUG, "alice", undefined, seams);

    expect(result.reencrypted).toEqual([]);
    expect(execSeam.calls.filter((c) => c.cmd[1] === "updatekeys")).toEqual([]);
    expect(result.residueNote).toContain("Rotate those values to shut them out.");
  });

  test("a machine with no local age key yet removes cleanly, without minting one — the own-key guard skips the comparison rather than provisioning a keychain item", async () => {
    const p = fakeProbes({ home: HOME });
    const { execSeam } = seamsWithClone();
    const absentAgeKeySeam = fakeAgeKeySeamAbsent();
    const secrets: SecretsSeams = { ageKeySeam: absentAgeKeySeam, execSeam };
    writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY], secrets);
    const { seams } = fakeMembersSeams({ readTeamStore: () => ({ "mattstack.roster": [{ username: "alice", agePublicKey: ALICE_PUBLIC_KEY }] }) });

    const result = await membersRemove(p, secrets, SLUG, "alice", undefined, seams);

    expect(result.rosterRemoved).toBe(true);
    expect(readTeamRecipients(SLUG, secrets)).toEqual([OWNER_PUBLIC_KEY]);
    // fakeAgeKeySeamAbsent throws on anything but find-generic-password, so
    // reaching here at all already proves no mint was attempted — asserted
    // explicitly too, and pinned to exactly one lookup (no retry-as-mint).
    expect(absentAgeKeySeam.calls).toEqual([["security", "find-generic-password", "-a", "mattstack", "-s", "mattstack-age-key", "-w"]]);
  });

  describe("refusing to remove the operator's own key", () => {
    test("a roster entry that carries the owner's OWN key (e.g. from a poisoned echo, or hand-edited data) refuses removal outright — no revoke, no roster write, no recipient change", async () => {
      const remote = "git@github.com:acme/widgets.git";
      const p = fakeProbes({ home: HOME, files: { [join(HOME, ".mattstack", "teams", SLUG, ".git", "config")]: gitConfigWithRemote(remote) } });
      const { secrets } = seamsWithClone();
      writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY], secrets);
      const revokeCalls: unknown[] = [];
      const { seams, writes } = fakeMembersSeams({
        // Simulates the roster having already recorded the owner's key under "alice" — the exact end state the echo attack (defense i) exists to prevent, tested here in isolation so defense ii is proven to hold even if defense i were bypassed.
        readTeamStore: () => ({ "mattstack.roster": [{ username: "alice", agePublicKey: OWNER_PUBLIC_KEY }] }),
        readTeamLocal: () => ({ createdByRt: true, joinedByRt: false, rtMayManageMembership: true }),
        revokeRead: async (...args) => {
          revokeCalls.push(args);
          return { access: "revoked", manualSteps: [] };
        },
      });

      await expect(membersRemove(p, secrets, SLUG, "alice", undefined, seams)).rejects.toThrow(UserActionableError);

      expect(revokeCalls).toEqual([]); // refused before forge revoke ever ran
      expect(writes).toEqual([]); // refused before the roster was touched
      expect(readTeamRecipients(SLUG, secrets)).toEqual([OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY]); // untouched
    });

    test("carries the own-key-removal-refused code", async () => {
      const p = fakeProbes({ home: HOME });
      const { secrets } = seamsWithClone();
      writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY], secrets);
      const { seams } = fakeMembersSeams({ readTeamStore: () => ({ "mattstack.roster": [{ username: "alice", agePublicKey: OWNER_PUBLIC_KEY }] }) });

      let caught: unknown;
      try {
        await membersRemove(p, secrets, SLUG, "alice", undefined, seams);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(UserActionableError);
      expect((caught as UserActionableError).code).toBe("own-key-removal-refused");
    });

    test("also refuses an explicit --key matching the owner's own key, not just a roster-recorded one", async () => {
      const p = fakeProbes({ home: HOME });
      const { secrets } = seamsWithClone();
      writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY], secrets);
      const { seams } = fakeMembersSeams({ readTeamStore: () => ({ "mattstack.roster": [] }) });

      await expect(membersRemove(p, secrets, SLUG, "whoever", OWNER_PUBLIC_KEY, seams)).rejects.toThrow(UserActionableError);
      expect(readTeamRecipients(SLUG, secrets)).toEqual([OWNER_PUBLIC_KEY]);
    });

    test("full attack sequence: an echoed owner key is rejected at sync time, so the later routine remove is a safe no-op and the owner stays a recipient throughout", async () => {
      const remote = "git@github.com:acme/widgets.git";
      const p = fakeProbes({ home: HOME, files: { [join(HOME, ".mattstack", "teams", SLUG, ".git", "config")]: gitConfigWithRemote(remote) } });
      const { secrets } = seamsWithClone();
      upsertInviteRecord(p, SLUG, "alice", aliceRecord());
      const { seams } = fakeMembersSeams();
      const echoBlob = await replyBlob(OWNER_PUBLIC_KEY, "alice"); // alice's reply echoes the owner's public key

      // 1. echo → sync: defense (i) catches it, alice stays pending, nothing poisoned.
      const syncResult = await membersSync(p, fakeRelay({ readReply: async () => ({ blob: echoBlob }) }), secrets, SLUG, seams);
      expect(syncResult.pending).toEqual(["alice"]);
      expect(readTeamRecipients(SLUG, secrets)).toEqual([OWNER_PUBLIC_KEY]);

      // 2. remove: alice was never actually assigned a key, so removal is a genuine no-op — never touches the owner's recipient entry.
      const removeResult = await membersRemove(p, secrets, SLUG, "alice", undefined, seams);
      expect(removeResult.reencrypted).toEqual([]);

      // 3. owner still a recipient throughout.
      expect(readTeamRecipients(SLUG, secrets)).toContain(OWNER_PUBLIC_KEY);
    });
  });

  test("membersRemove refuses on a joined clone, and never reaches the switchboard even with its admin token", async () => {
    const p = probesWithJoinedTeam();
    const { secrets } = seamsWithClone();
    const { seams } = fakeMembersSeams({ readLocalSecret: async (key) => (key === "switchboardAdminToken" ? "admin-secret" : null) });

    await expect(membersRemove(p, secrets, SLUG, "zaphod", undefined, seams)).rejects.toMatchObject({ code: "team-pull-only", message: "The org's shared files belong to its admins" });
    expect(p.calls.fetch).toEqual([]);
  });
});


test("an invited admin may sync members", async () => {
  const { secrets } = seamsWithClone();
  const { seams } = fakeMembersSeams();
  await expect(membersSync(probesWithJoinedTeam(SLUG, "dev1"), fakeRelay(), secrets, SLUG, seams)).resolves.toBeDefined();
});


test("an invited admin may remove a roster member", async () => {
  const { secrets } = seamsWithClone();
  const { seams, writes } = fakeMembersSeams({ readTeamStore: () => ({ "mattstack.roster": [{ username: "dev3" }] }) });
  await membersRemove(probesWithJoinedTeam(SLUG, "dev1"), secrets, SLUG, "dev3", undefined, seams);
  expect(writes.find(w => w.key === "mattstack.roster")).toMatchObject({ value: [] });
});

describe("roster edits compare usernames without case", () => {
  const roster = [{ username: "Dev2", name: "Z", teams: ["widgets"] }, { username: "dev1" }];

  test("recording a key for a member already listed in another case updates that entry", () => {
    expect(withRosterKey(roster, "dev2", "age1zzz")).toEqual([{ username: "Dev2", name: "Z", teams: ["widgets"], agePublicKey: "age1zzz" }, { username: "dev1" }]);
  });
  test("recording a key for someone new adds an entry", () => {
    expect(withRosterKey(roster, "dev3", "age1fff").at(-1)).toEqual({ username: "dev3", agePublicKey: "age1fff" });
  });
  test("removing finds the member in any case and hands back what it removed", () => {
    expect(withoutMember(roster, "DEV2")).toEqual({ roster: [{ username: "dev1" }], removed: roster[0]! });
    expect(withoutMember(roster, "dev3")).toEqual({ roster, removed: null });
  });
});

describe("a malformed roster row never stops a roster edit", () => {
  const malformed = [null, { name: "no username" }, { username: 7 }] as unknown as { username: string }[];
  const roster = [...malformed, { username: " Dev2 ", agePublicKey: ALICE_PUBLIC_KEY }];

  test("recording a key skips the malformed rows and keeps them", () => {
    expect(withRosterKey(roster, "dev2", "age1zzz")).toEqual([...malformed, { username: " Dev2 ", agePublicKey: "age1zzz" }]);
  });
  test("removing skips the malformed rows and keeps them", () => {
    expect(withoutMember(roster, "dev2")).toEqual({ roster: malformed, removed: roster[3]! });
  });
  test("membersRemove removes the member and revokes their key past a malformed row", async () => {
    const p = fakeProbes({ home: HOME });
    const { execSeam, secrets } = seamsWithClone();
    writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY], secrets);
    execSeam.writeFile(teamSecretsFile(SLUG, "board"), JSON.stringify({ data: "opaque", sops: {} }));
    const { seams, writes } = fakeMembersSeams({ readTeamStore: () => ({ "mattstack.roster": roster }) });

    const result = await membersRemove(p, secrets, SLUG, "dev2", undefined, seams);

    expect(result.rosterRemoved).toBe(true);
    expect(readTeamRecipients(SLUG, secrets)).toEqual([OWNER_PUBLIC_KEY]);
    expect(writes.find((w) => w.key === "mattstack.roster")).toMatchObject({ value: malformed });
  });
});

test("removing mixed-case duplicate rows revokes every recorded key and preserves unrelated order", async () => {
  const secondKey = "age1dxgc42vutd4a6q5zqkdg6q4jccysl8q9lqg7j5r78cd9y5m2usqq3kmajq";
  const p = fakeProbes({ home: HOME });
  const { execSeam, secrets } = seamsWithClone();
  writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY, secondKey], secrets);
  execSeam.writeFile(teamSecretsFile(SLUG, "board"), JSON.stringify({ data: "opaque", sops: {} }));
  const roster = [
    { username: "dev1", teams: ["widgets"] },
    { username: "Dev2", agePublicKey: ALICE_PUBLIC_KEY },
    { username: "dev3", teams: ["gadgets"] },
    { username: "DEV2", agePublicKey: secondKey },
  ];
  const { seams, writes } = fakeMembersSeams({ readTeamStore: () => ({ "mattstack.roster": roster }) });
  const result = await membersRemove(p, secrets, SLUG, "dev2", undefined, seams);
  expect(result.rosterRemoved).toBe(true);
  expect(writes).toEqual([{ key: "mattstack.roster", value: [roster[0]!, roster[2]!], scope: "org", opts: undefined }]);
  expect(readTeamRecipients(SLUG, secrets)).toEqual([OWNER_PUBLIC_KEY]);
  expect(result.reencrypted).toEqual([teamSecretsFile(SLUG, "board")]);
  expect(execSeam.calls.filter((call) => call.cmd[0] === "sops" && call.cmd[1] === "updatekeys")).toHaveLength(2);
});


describe("membersSetTeams", () => {
  const roster = [
    { username: "dev1", teams: ["widgets"] },
    { username: "Dev2", name: "Dev Two", agePublicKey: "age1...", extra: { keep: true }, teams: ["widgets"] },
  ];

  function world(username = "dev1", currentOrg: string | null = "acme") {
    const p = fakeProbes({ home: HOME, files: {
      [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: username }),
      [`${HOME}/.mattstack/teams/acme/mattstack/teams/widgets/settings.team.jsonc`]: "{}",
      [`${HOME}/.mattstack/teams/acme/mattstack/teams/gadgets/settings.team.jsonc`]: "{}",
    } });
    return { p, ...fakeMembersSeams({ readTeamStore: () => ({ "mattstack.roster": roster }), currentOrg: () => currentOrg }) };
  }

  test("replaces ordered teams case insensitively while preserving roster order and metadata", () => {
    const { p, seams, writes } = world("DEV1");
    expect(memberActions.membersSetTeams(p, seams, "acme", "dev2", ["gadgets", "widgets", "gadgets"])).toEqual({ username: "Dev2", teams: ["gadgets", "widgets"], previous: ["widgets"] });
    expect(writes).toEqual([{ key: "mattstack.roster", value: [roster[0], { ...roster[1], teams: ["gadgets", "widgets"] }], scope: "org", opts: undefined }]);
    expect(roster[1]!.teams).toEqual(["widgets"]);
  });

  test.each(["dev2", "stranger", ""])("refuses non-admin %s before any roster read or write", (username) => {
    const { p, seams, writes } = world(username);
    seams.readTeamStore = () => { throw new Error("must not read roster"); };
    expect(() => memberActions.membersSetTeams(p, seams, "acme", "dev1", ["gadgets"])).toThrow(UserActionableError);
    expect(writes).toEqual([]);
  });

  test.each([null, "gadgets"])("refuses a resolver org mismatch %s before writing", (currentOrg) => {
    const { p, seams, writes } = world("dev1", currentOrg);
    expect(() => memberActions.membersSetTeams(p, seams, "acme", "dev2", ["gadgets"])).toThrow("roster can't change here");
    expect(writes).toEqual([]);
  });

  test.each([
    ["stranger", ["widgets"], "stranger is not in this org yet"],
    ["dev2", ["sprockets"], "This org has no sprockets team"],
    ["dev2", ["../x"], "cannot be a team name"],
    ["dev2", ["widgets", "../x"], "cannot be a team name"],
  ] as [string, string[], string][])("refuses %s with %j without writing", (handle, teams, message) => {
    const { p, seams, writes } = world();
    expect(() => memberActions.membersSetTeams(p, seams, "acme", handle, teams)).toThrow(message);
    expect(writes).toEqual([]);
  });

  test("an empty list leaves the member in the org with no team", () => {
    const { p, seams, writes } = world();
    expect(memberActions.membersSetTeams(p, seams, "acme", "dev2", [])).toEqual({ username: "Dev2", teams: [], previous: ["widgets"] });
    expect(writes[0]!.value).toEqual([roster[0], { ...roster[1], teams: [] }]);
  });

  test("checks admin ownership again immediately before writing", () => {
    const { p, seams, writes } = world();
    seams.readTeamStore = () => {
      p.writeFile(teamLocalPath(HOME, "acme"), JSON.stringify({ forgeUsername: "dev2" }));
      return { "mattstack.roster": roster };
    };
    expect(() => memberActions.membersSetTeams(p, seams, "acme", "dev2", ["widgets"])).toThrow("The org's shared files belong to its admins");
    expect(writes).toEqual([]);
  });

  test("an old roster entry with no teams reports an empty previous list", () => {
    const { p, seams } = world();
    seams.readTeamStore = () => ({ "mattstack.roster": [{ username: "dev2", name: "Dev Two" }] });
    expect(memberActions.membersSetTeams(p, seams, "acme", "dev2", ["widgets"])).toEqual({ username: "dev2", teams: ["widgets"], previous: [] });
  });
});

describe("membersRemove: the member's board on the switchboard", () => {
  async function removeAlice(fetch: NonNullable<NonNullable<Parameters<typeof fakeProbes>[0]>["fetch"]>, adminToken: string | null) {
    const p = fakeProbes({ home: HOME, fetch });
    const { execSeam, secrets } = seamsWithClone();
    writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY], secrets);
    execSeam.writeFile(teamSecretsFile(SLUG, "board"), JSON.stringify({ data: "opaque", sops: {} }));
    const { seams } = fakeMembersSeams({
      readTeamStore: () => ({ "mattstack.roster": [{ username: "matt" }, { username: "alice", agePublicKey: ALICE_PUBLIC_KEY }] }),
      readLocalSecret: async (key) => (key === "switchboardAdminToken" ? adminToken : null),
    });
    const result = await membersRemove(p, secrets, SLUG, "alice", undefined, seams);
    return { p, result };
  }

  test("disconnects the board with the admin token", async () => {
    const { p, result } = await removeAlice(async () => ({ status: 200, body: "", headers: {} }), "admin-secret");
    expect(result.boardPeering).toBe("revoked");
    const call = p.calls.fetchInits.find((c) => c.url.endsWith("/boards/alice"))!;
    expect(call.init?.method).toBe("DELETE");
    expect(call.init?.headers?.Authorization).toBe("Bearer admin-secret");
    expect(result.manualSteps.join(" ")).not.toContain("board");
  });

  test("a board the switchboard does not know was never connected, not a failure", async () => {
    const { result } = await removeAlice(async () => ({ status: 404, body: "no such board", headers: {} }), "admin-secret");
    expect(result.boardPeering).toBe("not-peered");
    expect(result.manualSteps.join(" ")).not.toContain("board");
  });

  test("without the admin token: the rest still happens, and it says the board is still connected", async () => {
    const { p, result } = await removeAlice(async () => ({ status: 200, body: "", headers: {} }), null);
    expect(result.boardPeering).toBe("left-peered");
    expect(p.calls.fetch.some((u) => u.includes("/boards/"))).toBe(false);
    expect(result.manualSteps.join(" ")).toContain("alice's board is still connected");
    expect(result.rosterRemoved).toBe(true);
  });

  test("an unreachable switchboard says so, not that it answered 0", async () => {
    const { result } = await removeAlice(async () => ({ status: 0, body: "", headers: {} }), "admin-secret");
    expect(result.boardPeering).toBe("failed");
    expect(result.manualSteps.join(" ")).toContain("rt could not reach the switchboard");
    expect(result.manualSteps.join(" ")).not.toContain("answered 0");
  });

  test("without the admin token the step names the command the token holder runs", async () => {
    const { result } = await removeAlice(async () => ({ status: 200, body: "", headers: {} }), null);
    expect(result.manualSteps.join(" ")).toContain("rt team members remove alice there");
  });

  test("a handle in another case still finds its roster entry and key, and the board is revoked under the canonical name", async () => {
    const p = fakeProbes({ home: HOME, fetch: async () => ({ status: 200, body: "", headers: {} }) });
    const { execSeam, secrets } = seamsWithClone();
    writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY], secrets);
    execSeam.writeFile(teamSecretsFile(SLUG, "board"), JSON.stringify({ data: "opaque", sops: {} }));
    const { seams, writes } = fakeMembersSeams({
      readTeamStore: () => ({ "mattstack.roster": [{ username: "matt" }, { username: "grace", agePublicKey: ALICE_PUBLIC_KEY }] }),
      readLocalSecret: async (key) => (key === "switchboardAdminToken" ? "admin-secret" : null),
    });

    const result = await membersRemove(p, secrets, SLUG, "Grace", undefined, seams);

    expect(result.rosterRemoved).toBe(true);
    expect(readTeamRecipients(SLUG, secrets)).toEqual([OWNER_PUBLIC_KEY]);
    expect((writes.find((w) => w.key === "mattstack.roster")!.value as { username: string }[]).map((m) => m.username)).toEqual(["matt"]);
    expect(p.calls.fetchInits.some((c) => c.url.endsWith("/boards/grace") && c.init?.method === "DELETE")).toBe(true);
  });

  test("a handle on no roster still has its board revoked, since the CLI is the only way to drop it", async () => {
    const p = fakeProbes({ home: HOME, fetch: async () => ({ status: 200, body: "", headers: {} }) });
    const { secrets } = seamsWithClone();
    writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY], secrets);
    const { seams } = fakeMembersSeams({
      readTeamStore: () => ({ "mattstack.roster": [{ username: "matt" }] }),
      readLocalSecret: async (key) => (key === "switchboardAdminToken" ? "admin-secret" : null),
    });

    const result = await membersRemove(p, secrets, SLUG, "smoketest", undefined, seams);

    expect(result.rosterRemoved).toBe(false);
    expect(result.boardPeering).toBe("revoked");
  });

  test("a switchboard error is a failure with a retry step", async () => {
    const { result } = await removeAlice(async () => ({ status: 500, body: "", headers: {} }), "admin-secret");
    expect(result.boardPeering).toBe("failed");
    expect(result.manualSteps.join(" ")).toContain("answered 500");
    expect(result.rosterRemoved).toBe(true);
  });
});
