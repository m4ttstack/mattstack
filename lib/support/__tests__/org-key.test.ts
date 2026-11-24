import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { seedOrg } from "../../../packages/rt-client/test/org-fixture.ts";
import { seamsWithKey, type FakeTeamExecSeam } from "../../secrets/__tests__/team-fakes.ts";
import { readTeamSecret, teamSecretsFile, writeTeamRecipients, writeTeamSecret } from "../../secrets/team-store.ts";
import type { SecretsSeams } from "../../secrets/store.ts";
import { closeStateDb } from "../../state/index.ts";
import { SUPPORT_TTL_MS } from "../../../packages/rt-client/src/support.ts";
import { ensureSupportKey, readSupportKeys, rotateSupportKey, usableKeys } from "../org-key.ts";

const GOOD = Buffer.alloc(32, 7).toString("base64");

let fixtureHome: string;
let priorHome: string | undefined;
let exec: FakeTeamExecSeam;
let seams: SecretsSeams;

beforeEach(() => {
  priorHome = process.env.HOME;
  closeStateDb();
  fixtureHome = realpathSync(mkdtempSync(`${tmpdir()}/rt-support-key-`));
  process.env.HOME = fixtureHome;
  seedOrg({ org: "acme", username: "dev1", roles: { admins: ["dev1"], teams: {} } });
  ({ execSeam: exec, seams } = seamsWithKey());
  writeTeamRecipients("acme", ["age1dev1"], seams);
});
afterEach(() => {
  closeStateDb();
  process.env.HOME = priorHome;
  rmSync(fixtureHome, { recursive: true, force: true });
});

describe("the org's support key", () => {
  test("there is none until it is made, and reading never makes it", async () => {
    expect(await readSupportKeys("acme", seams)).toBeNull();
    expect(exec.files.has(teamSecretsFile("acme", "support"))).toBe(false);
  });

  test("ensure makes a 32 byte key every member's recipients file covers", async () => {
    await ensureSupportKey("acme", seams);
    const keys = await readSupportKeys("acme", seams);
    expect(Buffer.from(keys!.current, "base64")).toHaveLength(32);
    expect(keys).toEqual({ current: keys!.current, retired: [] });
    expect(JSON.parse((await readTeamSecret("acme", "support", "requestKey", seams))!)).toEqual(keys!);
  });

  test("ensure keeps an existing key", async () => {
    await ensureSupportKey("acme", seams);
    const before = await readSupportKeys("acme", seams);
    await ensureSupportKey("acme", seams);
    expect(await readSupportKeys("acme", seams)).toEqual(before);
  });

  test("rotate with no key writes nothing and returns false", async () => {
    expect(await rotateSupportKey("acme", seams, 1000)).toBe(false);
    expect(exec.files.has(teamSecretsFile("acme", "support"))).toBe(false);
  });

  test("rotation keeps the old key usable for 7 days and not after", async () => {
    await ensureSupportKey("acme", seams);
    const before = (await readSupportKeys("acme", seams))!;
    expect(await rotateSupportKey("acme", seams, 1000)).toBe(true);
    const after = (await readSupportKeys("acme", seams))!;
    expect(after.current).not.toBe(before.current);
    expect(after.retired).toEqual([{ key: before.current, retiredAt: 1000 }]);
    expect(usableKeys(after, 1000 + SUPPORT_TTL_MS - 1)).toEqual([after.current, before.current]);
    expect(usableKeys(after, 1000 + SUPPORT_TTL_MS)).toEqual([after.current]);
    expect(usableKeys(before, 1000)).toEqual([before.current]);
  });

  test("two rotations inside 7 days keep both old keys, each for its own 7 days", async () => {
    await ensureSupportKey("acme", seams);
    const first = (await readSupportKeys("acme", seams))!.current;
    await rotateSupportKey("acme", seams, 1000);
    const second = (await readSupportKeys("acme", seams))!.current;
    await rotateSupportKey("acme", seams, 5000);
    const keys = (await readSupportKeys("acme", seams))!;
    expect(usableKeys(keys, 5000)).toEqual([keys.current, second, first]);
    expect(usableKeys(keys, 1000 + SUPPORT_TTL_MS)).toEqual([keys.current, second]);
    expect(usableKeys(keys, 5000 + SUPPORT_TTL_MS)).toEqual([keys.current]);
  });

  test("a rotation forgets the keys past their 7 days", async () => {
    await ensureSupportKey("acme", seams);
    await rotateSupportKey("acme", seams, 1000);
    await rotateSupportKey("acme", seams, 1000 + SUPPORT_TTL_MS);
    expect((await readSupportKeys("acme", seams))!.retired).toHaveLength(1);
  });

  test("a stored value that is not a key reads as none, and ensure replaces it", async () => {
    for (const bad of ["not json", "null", "{}", '{"current":""}', '{"current":"k","retired":[]}', `{"current":"${GOOD}"}`, `{"current":"${GOOD}","retired":[{"key":"","retiredAt":1}]}`, `{"current":"${GOOD}","retired":[{"key":"${GOOD}","retiredAt":"now"}]}`]) {
      await writeTeamSecret("acme", "support", "requestKey", bad, seams);
      expect(await readSupportKeys("acme", seams)).toBeNull();
    }
    await ensureSupportKey("acme", seams);
    expect(await readSupportKeys("acme", seams)).not.toBeNull();
  });
});
