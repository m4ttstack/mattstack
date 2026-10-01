/**
 * The pure renderers of `rt settings list` (commands/settings-keys.ts).
 *
 * Rendering is where the two "loud degrade" labels live, and they are easy to
 * get wrong in exactly one direction: an UNREGISTERED key has no registry
 * entry, so `migrated` comes back false for it by default — the naive
 * `if (!s.migrated)` branch then tells the user the key "reads legacy",
 * naming a migration window that does not exist for a key rt has never heard
 * of. These tests pin both labels apart.
 */

import { describe, expect, test } from "bun:test";
import { renderExplainRow, renderListRow } from "../settings-keys.ts";
import type { ExplainRow, ListedSetting } from "../../lib/settings/resolve.ts";
import * as out from "../../lib/ui/out.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";

const listText = (s: ListedSetting) => renderPlain([out.table([renderListRow(s)])]);
const explainText = (r: ExplainRow, current?: string) => renderPlain([out.tree(out.key("k"), renderExplainRow(r, current))]);

const row = (over: Partial<ListedSetting>): ListedSetting =>
  ({ key: "rt.roles", value: 1, provenance: [], migrated: true, ...over }) as ListedSetting;

describe("renderListRow", () => {
  test("an unregistered key is labelled ONLY unregistered — never 'reads legacy'", () => {
    const text = listText(row({ key: "rt.fromTheFuture", migrated: false, unregistered: true }));

    expect(text).toContain("unregistered");
    expect(text).not.toContain("legacy");
  });

  test("a registered migrated:false key still carries its legacy note", () => {
    const text = listText(row({ key: "rt.someLegacyKey", migrated: false }));

    expect(text).toMatch(/legacy|not writable/);
    expect(text).not.toContain("unregistered");
  });

  test("a plain migrated key renders with no label at all", () => {
    expect(listText(row({ value: { a: 1 } }))).toBe('rt.roles  {"a":1}\n');
  });

  test("list labels nonconforming layers and merged issues", () => {
    const text = listText(row({
      key: "rt.homeSnapshot", value: { enabled: "yes" }, provenance: [{ scope: "machine", file: "/tmp/x" }], migrated: true,
      nonconforming: [{ scope: "machine", file: "/tmp/x", issues: [{ path: ["enabled"], message: "expected boolean, got string" }] }],
      mergedIssues: [{ path: ["enabled"], message: "expected boolean, got string" }],
    }));

    expect(text).toContain("nonconforming[machine]: enabled: expected boolean, got string");
    expect(text).toContain("merged: enabled: expected boolean, got string");
  });
});

describe("renderExplainRow", () => {
  test("explain shows a nonconforming layer with its first issue", () => {
    const text = explainText({
      scope: "machine", file: "/tmp/settings.local.jsonc", present: true, value: { enabled: "yes" },
      nonconforming: [{ path: ["enabled"], message: "expected boolean, got string" }],
    });

    expect(text).toContain("[nonconforming: enabled: expected boolean, got string]");
  });
});

describe("renderExplainRow over store names", () => {
  const base = { scope: "user", file: "/home/user/settings.user.jsonc", present: true } as const;

  test("a row read from an older name says so; one read from the current name does not", () => {
    const migrated = explainText({ ...base, value: [1], storeName: "rt.x", storedVersion: 1, authored: [0] } as ExplainRow, "rt.x@2");
    expect(migrated).toContain("[read from rt.x, version 1]");
    const current = explainText({ ...base, value: [1], storeName: "rt.x@2", storedVersion: 2, authored: [1] } as ExplainRow, "rt.x@2");
    expect(current).not.toContain("read from");
  });

  test("an invalid row still shows the store-name suffix and its older-name lines", () => {
    const text = explainText({
      ...base,
      value: [1],
      invalid: "migration 1 -> 2 threw: boom; expected object, got array",
      storeName: "rt.x",
      storedVersion: 1,
      authored: [1],
      olderNames: [{ storeName: "rt.x", storedVersion: 1, label: "diverged", value: [9], authored: [8] }],
    } as ExplainRow, "rt.x@2");
    expect(text).toContain("[invalid: migration 1 -> 2 threw: boom; expected object, got array]");
    expect(text).toContain("[read from rt.x, version 1]");
    expect(text).toContain("older rt.x: diverged  [9]");
  });

  test("older names print one per line, a diverged one with its value", () => {
    const text = explainText({
      ...base,
      value: [1],
      storeName: "rt.x@2",
      storedVersion: 2,
      authored: [1],
      olderLabel: "diverged",
      olderNames: [{ storeName: "rt.x", storedVersion: 1, label: "diverged", value: [9], authored: [8] }],
    } as ExplainRow, "rt.x@2");
    expect(text).toContain("older rt.x: diverged  [9]");
  });
});

describe("renderListRow over store names", () => {
  test("a diverged layer and a newer-rt name are labeled", () => {
    expect(listText(row({ diverged: [{ scope: "user", file: null, storeNames: ["rt.roles"] }] }))).toContain("diverged[user]: rt.roles");
    expect(listText(row({ key: "rt.roles@3", migrated: false, unregistered: true, newer: true }))).toContain("from a newer rt");
  });
});
