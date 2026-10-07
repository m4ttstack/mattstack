import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { readInviteMovedFrom, readInviteRecords } from "../invite-records.ts";
import { readTeamLocal } from "../team-local.ts";
import { classifyLocate, cleanupMovedRecords, copyOrgRecords, runOrgMove, type LocateFn } from "../org-folder-move.ts";

const HOME = "/h";
const MS = `${HOME}/.mattstack`;
const RT = `${MS}/rt`;
const record = JSON.stringify({ createdByRt: false, joinedByRt: true, rtMayManageMembership: false, forgeUsername: "dev1" });
const invites = JSON.stringify({ dev2: { id: "i1", creatorSecret: "s", keyB64: "k", expiresAt: "2099-01-01T00:00:00.000Z" } });

/** The fake answers `exists(dir)` only for a `dirs` key, so every folder a test relies on is a key here. */
function dirsFor(root: string, folder: string): Record<string, string[]> {
  return { [root]: [folder], [`${root}/${folder}`]: [".git"], [`${root}/${folder}/.git`]: ["config"] };
}

function probes(files: Record<string, string>, dirs: Record<string, string[]> = {}) {
  return fakeProbes({ home: HOME, files, dirs: { [MS]: ["rt", "orgs", "teams"], [RT]: ["teams", "invites"], [`${RT}/teams`]: [], [`${RT}/invites`]: [], ...dirs } });
}

describe("copyOrgRecords", () => {
  test("copies both records to the org's name and stamps movedFrom", () => {
    const p = probes({ [`${RT}/teams/widgets.json`]: record, [`${RT}/invites/widgets.json`]: invites });
    expect(copyOrgRecords(p, "widgets", "acme")).toEqual({ teams: "copied", invites: "copied" });
    expect(readTeamLocal(p, "acme")).toMatchObject({ joinedByRt: true, forgeUsername: "dev1", movedFrom: "widgets" });
    expect(p.readFile(`${RT}/invites/acme.json`)).toBe(invites);
    expect(p.readFile(`${RT}/teams/widgets.json`)).toBe(record);
  });
  test("a record already under the org's name is left as it is", () => {
    const p = probes({ [`${RT}/teams/widgets.json`]: record, [`${RT}/teams/acme.json`]: '{"forgeUsername":"dev2"}' });
    expect(copyOrgRecords(p, "widgets", "acme")).toEqual({ teams: "present", invites: "none" });
    expect(p.readFile(`${RT}/teams/acme.json`)).toBe('{"forgeUsername":"dev2"}');
  });
  test("the copied record lands through a temp file renamed into place", () => {
    const p = probes({ [`${RT}/teams/widgets.json`]: record, [`${RT}/invites/widgets.json`]: invites });
    copyOrgRecords(p, "widgets", "acme");
    for (const kind of ["teams", "invites"]) {
      const target = `${RT}/${kind}/acme.json`;
      const into = p.calls.renames.find(([, b]) => b === target);
      expect(into?.[0].startsWith(`${RT}/${kind}/acme.json.`)).toBe(true);
      expect(p.exists(into![0])).toBe(false);
      expect(p.fileMode(target)).toBe(0o600);
    }
  });
  test("with no team record, the copied invites record carries movedFrom and its handles read as before", () => {
    const p = probes({ [`${RT}/invites/widgets.json`]: invites });
    expect(copyOrgRecords(p, "widgets", "acme")).toEqual({ teams: "none", invites: "copied" });
    expect(readInviteMovedFrom(p, "acme")).toBe("widgets");
    expect(Object.keys(readInviteRecords(p, "acme"))).toEqual(["dev2"]);
    expect(p.exists(`${RT}/teams/acme.json`)).toBe(false);
  });
  test("nothing to copy when folder and org agree or no record exists", () => {
    expect(copyOrgRecords(probes({ [`${RT}/teams/acme.json`]: record }), "acme", "acme")).toEqual({ teams: "present", invites: "none" });
    expect(copyOrgRecords(probes({}), "widgets", "acme")).toEqual({ teams: "none", invites: "none" });
  });
});

describe("cleanupMovedRecords", () => {
  const moved = JSON.stringify({ joinedByRt: true, forgeUsername: "dev1", movedFrom: "widgets" });
  test("removes the records movedFrom names when no folder of that name exists, then clears movedFrom", () => {
    const p = probes({ [`${RT}/teams/widgets.json`]: record, [`${RT}/teams/acme.json`]: moved, [`${RT}/invites/widgets.json`]: invites });
    expect(cleanupMovedRecords(p, "acme", () => false)).toEqual([`${RT}/teams/widgets.json`, `${RT}/invites/widgets.json`]);
    expect(p.exists(`${RT}/teams/widgets.json`)).toBe(false);
    expect(readTeamLocal(p, "acme")).toEqual({ createdByRt: false, joinedByRt: true, rtMayManageMembership: false, forgeUsername: "dev1" });
  });
  test("leaves the old records while a folder of that name still exists", () => {
    const p = probes({ [`${RT}/teams/widgets.json`]: record, [`${RT}/teams/acme.json`]: moved });
    expect(cleanupMovedRecords(p, "acme", (name) => name === "widgets")).toEqual([]);
    expect(p.exists(`${RT}/teams/widgets.json`)).toBe(true);
    expect(readTeamLocal(p, "acme").movedFrom).toBe("widgets");
  });
  test("a movedFrom on the invites record alone is honoured, and no team record is created", () => {
    const p = probes({ [`${RT}/invites/widgets.json`]: invites, [`${RT}/invites/acme.json`]: JSON.stringify({ ...JSON.parse(invites), movedFrom: "widgets" }) });
    expect(cleanupMovedRecords(p, "acme", () => false)).toEqual([`${RT}/invites/widgets.json`]);
    expect(p.exists(`${RT}/invites/widgets.json`)).toBe(false);
    expect(readInviteMovedFrom(p, "acme")).toBeUndefined();
    expect(Object.keys(readInviteRecords(p, "acme"))).toEqual(["dev2"]);
    expect(p.exists(`${RT}/teams/acme.json`)).toBe(false);
  });
  test("a movedFrom on both records is cleared from both", () => {
    const moved = JSON.stringify({ joinedByRt: true, forgeUsername: "dev1", movedFrom: "widgets" });
    const p = probes({ [`${RT}/teams/acme.json`]: moved, [`${RT}/invites/acme.json`]: JSON.stringify({ ...JSON.parse(invites), movedFrom: "widgets" }) });
    cleanupMovedRecords(p, "acme", () => false);
    expect(readTeamLocal(p, "acme").movedFrom).toBeUndefined();
    expect(readInviteMovedFrom(p, "acme")).toBeUndefined();
  });
  test("a record with no folder and no movedFrom is left alone", () => {
    const p = probes({ [`${RT}/teams/widgets.json`]: record, [`${RT}/teams/acme.json`]: record });
    expect(cleanupMovedRecords(p, "acme", () => false)).toEqual([]);
    expect(p.exists(`${RT}/teams/widgets.json`)).toBe(true);
  });
});

describe("classifyLocate", () => {
  test("nothing-lost is done; identity-mismatch and old-path-exists fail", () => {
    expect(classifyLocate("nothing-lost: rt never registered it")).toBe("done");
    expect(classifyLocate("identity-mismatch: another repo")).toBe("failed");
    expect(classifyLocate("old-path-exists: still there")).toBe("failed");
    expect(classifyLocate("locate failed")).toBe("failed");
  });
});

describe("runOrgMove", () => {
  const from = `${MS}/teams/widgets`;
  const to = `${MS}/orgs/acme`;
  const locateOk: LocateFn = async () => ({ ok: true, moved: true });

  test("copies records, moves the folder, relocates, then removes the old records, in that order", async () => {
    const order: string[] = [];
    const p = probes({ [`${RT}/teams/widgets.json`]: record, [`${from}/.git/config`]: "[core]\n" }, dirsFor(`${MS}/teams`, "widgets"));
    const rename = p.rename.bind(p);
    p.rename = (a, b) => { if (a === from) order.push("folder"); rename(a, b); };
    const locate: LocateFn = async (newPath) => { order.push(`index:${newPath}`); expect(readTeamLocal(p, "acme").movedFrom).toBe("widgets"); return { ok: true, moved: true }; };
    const result = await runOrgMove(p, { from, to, locate });
    expect(result).toMatchObject({ ok: true, from, to, records: { teams: "copied", invites: "none" }, folderMoved: true, index: "moved", removed: [`${RT}/teams/widgets.json`] });
    expect(order).toEqual(["folder", `index:${to}`]);
    expect(p.calls.renames).toContainEqual([from, to]);
    expect(p.exists(`${RT}/teams/widgets.json`)).toBe(false);
    expect(readTeamLocal(p, "acme").movedFrom).toBeUndefined();
  });
  test("creates the orgs root before the move", async () => {
    const p = fakeProbes({ home: HOME, files: { [`${from}/.git/config`]: "[core]\n" }, dirs: { [MS]: ["rt", "teams"], [RT]: ["teams"], [`${RT}/teams`]: [], ...dirsFor(`${MS}/teams`, "widgets") } });
    await runOrgMove(p, { from, to, locate: locateOk });
    expect(p.exists(`${MS}/orgs`)).toBe(true);
    expect(p.calls.renames).toContainEqual([from, to]);
  });
  test("a failed relocation keeps the old records and reports the stage", async () => {
    const p = probes({ [`${RT}/teams/widgets.json`]: record, [`${from}/.git/config`]: "[core]\n" }, dirsFor(`${MS}/teams`, "widgets"));
    const result = await runOrgMove(p, { from, to, locate: async () => ({ ok: false, error: "identity-mismatch: another repo sits there" }) });
    expect(result).toMatchObject({ ok: false, stage: "index", index: "failed", folderMoved: true, removed: [] });
    expect(result.error).toContain("identity-mismatch");
    expect(p.exists(`${RT}/teams/widgets.json`)).toBe(true);
    expect(readTeamLocal(p, "acme").movedFrom).toBe("widgets");
  });
  test("a relocation that throws reports the index stage with the folder already moved", async () => {
    const p = probes({ [`${RT}/teams/widgets.json`]: record, [`${from}/.git/config`]: "[core]\n" }, dirsFor(`${MS}/teams`, "widgets"));
    const result = await runOrgMove(p, { from, to, locate: async () => { throw new Error("daemon went away"); } });
    expect(result).toMatchObject({ ok: false, stage: "index", index: "failed", folderMoved: true, error: "daemon went away", removed: [] });
    expect(p.exists(`${RT}/teams/widgets.json`)).toBe(true);
  });
  test("a nothing-lost relocation counts as done", async () => {
    const p = probes({ [`${from}/.git/config`]: "[core]\n" }, dirsFor(`${MS}/teams`, "widgets"));
    const result = await runOrgMove(p, { from, to, locate: async () => ({ ok: false, error: "nothing-lost: rt never registered it" }) });
    expect(result).toMatchObject({ ok: true, index: "already" });
  });
  test("a folder already at its target is not renamed again and only the other pieces run", async () => {
    const p = probes({ [`${RT}/teams/widgets.json`]: record, [`${to}/.git/config`]: "[core]\n" }, dirsFor(`${MS}/orgs`, "acme"));
    const result = await runOrgMove(p, { from: `${MS}/orgs/widgets`, to, locate: locateOk });
    expect(result).toMatchObject({ ok: true, folderMoved: false, records: { teams: "copied", invites: "none" }, removed: [`${RT}/teams/widgets.json`] });
    expect(p.calls.renames.find(([a]) => a === `${MS}/orgs/widgets`)).toBeUndefined();
  });
  test("refuses to rename over a target that exists while the source is still there", async () => {
    const p = probes({ [`${from}/.git/config`]: "[core]\n", [`${to}/.git/config`]: "[core]\n" }, { ...dirsFor(`${MS}/teams`, "widgets"), ...dirsFor(`${MS}/orgs`, "acme") });
    const result = await runOrgMove(p, { from, to, locate: locateOk });
    expect(result).toMatchObject({ ok: false, stage: "folder" });
    expect(p.calls.renames).toEqual([]);
  });
});
