import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { breakingChanges, checkPropsSignature, propKey, signatureOf, type Signature } from "../signature.ts";

function tmpTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "blocks-signature-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

const engineRoot = '---\nname: launch\ntype: pipeline-step\nprops:\n  rules: { merge: add, default: "" }\n---\n# launch\n';

test("signatureOf keys blocks by engine-prefixed id and records merge, required and contract", () => {
  const dir = tmpTree({
    "index.block.md": engineRoot,
    "flow/index.block.md": "---\n---\n# Flow\n",
    "flow/quick-checks.block.md":
      "---\nprops:\n  rules: { merge: replace }\n  domain: { merge: add, default: none, contract: launch-domain@1 }\n---\n# Quick checks\n",
  });
  expect(signatureOf([{ engine: "launch", dir }])).toEqual({
    launch: { rules: { merge: "add", required: false, contract: null } },
    "launch/flow": {},
    "launch/flow/quick-checks": {
      rules: { merge: "replace", required: true, contract: null },
      domain: { merge: "add", required: false, contract: "launch-domain@1" },
    },
  });
});

test("propKey joins the block id and the prop with a dot", () => {
  expect(propKey("launch", "rules")).toBe("launch.rules");
  expect(propKey("launch/flow/quick-checks", "rules")).toBe("launch/flow/quick-checks.rules");
});

const before: Signature = {
  ship: { rules: { merge: "add", required: false, contract: null } },
  "ship/flow/fast-checks": {
    rules: { merge: "add", required: false, contract: null },
    domain: { merge: "replace", required: false, contract: "ship-domain@1" },
  },
};

function after(edit: (s: Signature) => void): Signature {
  const copy = structuredClone(before);
  edit(copy);
  return copy;
}

test("no change is not breaking", () => {
  expect(breakingChanges(before, structuredClone(before))).toEqual([]);
});

test("a removed prop is breaking", () => {
  const next = after((s) => delete s["ship/flow/fast-checks"]!.rules);
  expect(breakingChanges(before, next)).toEqual([{ key: "ship/flow/fast-checks.rules", what: "removed" }]);
});

test("a renamed block removes every prop under the old id", () => {
  const next = after((s) => {
    s["ship/flow/quick-checks"] = s["ship/flow/fast-checks"]!;
    delete s["ship/flow/fast-checks"];
  });
  expect(breakingChanges(before, next)).toEqual([
    { key: "ship/flow/fast-checks.domain", what: "removed" },
    { key: "ship/flow/fast-checks.rules", what: "removed" },
  ]);
});

test("a new required prop is breaking", () => {
  const next = after((s) => (s["ship/flow/fast-checks"]!.gate = { merge: "replace", required: true, contract: null }));
  expect(breakingChanges(before, next)).toEqual([{ key: "ship/flow/fast-checks.gate", what: "newly-required" }]);
});

test("an optional prop that loses its default is newly required", () => {
  const next = after((s) => (s.ship!.rules!.required = true));
  expect(breakingChanges(before, next)).toEqual([{ key: "ship.rules", what: "newly-required" }]);
});

test("a new block carrying a required prop in an engine present before is breaking", () => {
  const next = after((s) => (s["ship/flow/lint"] = { rules: { merge: "add", required: true, contract: null } }));
  expect(breakingChanges(before, next)).toEqual([{ key: "ship/flow/lint.rules", what: "newly-required" }]);
});

test("a new optional prop is not breaking", () => {
  const next = after((s) => (s["ship/flow/fast-checks"]!.notes = { merge: "add", required: false, contract: null }));
  expect(breakingChanges(before, next)).toEqual([]);
});

test("an add to replace flip is breaking", () => {
  const next = after((s) => (s["ship/flow/fast-checks"]!.rules!.merge = "replace"));
  expect(breakingChanges(before, next)).toEqual([{ key: "ship/flow/fast-checks.rules", what: "merge-flipped" }]);
});

test("a contract bump is breaking", () => {
  const next = after((s) => (s["ship/flow/fast-checks"]!.domain!.contract = "ship-domain@2"));
  expect(breakingChanges(before, next)).toEqual([{ key: "ship/flow/fast-checks.domain", what: "contract-changed" }]);
});

test("an engine absent before is skipped, required props and all", () => {
  const next = after((s) => {
    s.review = { rules: { merge: "add", required: true, contract: null } };
    s["review/scan"] = { depth: { merge: "replace", required: true, contract: null } };
  });
  expect(breakingChanges(before, next)).toEqual([]);
});

test("an engine whose name extends another engine's is still its own engine", () => {
  const next = after((s) => (s["ship-it"] = { rules: { merge: "add", required: true, contract: null } }));
  expect(breakingChanges(before, next)).toEqual([]);
});

test("includes are keyed by include name the same way", () => {
  const was: Signature = { "gate-protocol/ask": { tiering: { merge: "replace", required: false, contract: null } } };
  expect(breakingChanges(was, { "gate-protocol/ask": {} })).toEqual([{ key: "gate-protocol/ask.tiering", what: "removed" }]);
});

const change = [{ key: "ship/flow/fast-checks.rules", what: "removed" as const }];

test("a props-change line waives the change", () => {
  const body = "Renames the prop.\n\nprops-change: ship/flow/fast-checks.rules: renamed to checks\n";
  expect(checkPropsSignature({ changes: change, prBody: body })).toEqual([]);
});

test("without the line the change fails, telling the author to edit the body then push", () => {
  const errors = checkPropsSignature({ changes: change, prBody: "Renames the prop." });
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain("ship/flow/fast-checks.rules");
  expect(errors[0]).toContain("removed");
  expect(errors[0]).toContain('"props-change: ship/flow/fast-checks.rules: <reason>"');
  expect(errors[0]).toContain("Edit the PR body, then push a commit (re-running the job reads the old body).");
});

test("a waiver with no text does not waive", () => {
  expect(checkPropsSignature({ changes: change, prBody: "props-change: ship/flow/fast-checks.rules:   " })).toHaveLength(1);
});

test("a waiver must sit on its own line", () => {
  expect(checkPropsSignature({ changes: change, prBody: "see props-change: ship/flow/fast-checks.rules: renamed" })).toHaveLength(1);
});

test("a waiver for another key does not waive, and a waiver with no change is ignored", () => {
  const body = "props-change: ship/flow/fast-checks.domain: bumped\nprops-change: ship.unknown: nothing";
  expect(checkPropsSignature({ changes: change, prBody: body })).toHaveLength(1);
  expect(checkPropsSignature({ changes: [], prBody: body })).toEqual([]);
});

test("a waiver line with CRLF endings still waives", () => {
  const body = "intro\r\nprops-change: ship/flow/fast-checks.rules: renamed to checks\r\n";
  expect(checkPropsSignature({ changes: change, prBody: body })).toEqual([]);
});
