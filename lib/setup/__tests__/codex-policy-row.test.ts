import { describe, expect, test } from "bun:test";
import type { Outcome } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { PolicyInstallPlan, PolicyReview } from "../../agent-integrations/codex/policy-install.ts";
import { codexPolicyReviewBlocks } from "../../../commands/setup.ts";
import { renderPlain } from "../../ui/out-plain.ts";
import type { Action } from "../contract.ts";
import { CODEX_POLICY_PLAN_DEADLINE_MS, codexPolicyRow, withPlanDeadline } from "../validators/codex.ts";

const REVIEW: PolicyReview = {
  id: "cp-0123456789abcdef0123456789abcdef",
  codexHome: "/Users/someone/.codex",
  hooksPath: "/Users/someone/.codex/hooks.json",
  configPath: "/Users/someone/.codex/config.toml",
  executable: "/Users/someone/.mattstack/rt/codex-policy/bin/aaaa/rt",
  digest: "a".repeat(64),
  commands: [
    { event: "PreToolUse", command: "'/x/rt' agent policy-hook --installation mac-1 --event PreToolUse" },
    { event: "Stop", command: "'/x/rt' agent policy-hook --installation mac-1 --event Stop" },
  ],
  hooks: [
    { event: "PreToolUse", key: "/Users/someone/.codex/hooks.json:pre_tool_use:0:0", command: "'/x/rt' agent policy-hook --installation mac-1 --event PreToolUse", hash: `sha256:${"b".repeat(64)}` },
    { event: "Stop", key: "/Users/someone/.codex/hooks.json:stop:0:0", command: "'/x/rt' agent policy-hook --installation mac-1 --event Stop", hash: `sha256:${"c".repeat(64)}` },
  ],
};

const planAt = (stage: PolicyInstallPlan["stage"]): Outcome<PolicyInstallPlan> => ({
  ok: true,
  data: { stage, reviews: stage === "hooks" ? [REVIEW] : [], hooksPath: REVIEW.hooksPath } as unknown as PolicyInstallPlan,
});

describe("the Codex hooks row", () => {
  test("hooks awaiting review carry the review the terminal shows, and the verb the app runs", async () => {
    const r = await codexPolicyRow(async () => planAt("hooks"));
    expect(r).toMatchObject({ id: "tool.codex-policy", status: "needs-you", required: false });
    const action = r.action as Extract<Action, { type: "review-codex-hooks" }>;
    expect(action.type).toBe("review-codex-hooks");
    expect(action.verb).toEqual(["setup", "codex-policy"]);
    expect(action.review).toEqual({
      id: REVIEW.id, codexHome: REVIEW.codexHome, hooksPath: REVIEW.hooksPath, configPath: REVIEW.configPath,
      executable: REVIEW.executable, digest: REVIEW.digest,
      hooks: REVIEW.hooks.map((h) => ({ event: h.event, key: h.key, hash: h.hash, command: h.command })),
    });
  });

  test("the sheet's payload is exactly what the terminal review prints", async () => {
    const r = await codexPolicyRow(async () => planAt("hooks"));
    const review = (r.action as Extract<Action, { type: "review-codex-hooks" }>).review;
    const terminal = renderPlain(codexPolicyReviewBlocks(review));
    for (const value of [review.codexHome, review.hooksPath, review.configPath, review.executable, review.digest]) expect(terminal).toContain(value);
    for (const h of review.hooks) for (const value of [h.key, h.hash, h.command]) expect(terminal).toContain(value);
  });

  test("before rt's hooks are added, Install adds them", async () => {
    const r = await codexPolicyRow(async () => planAt("definitions"));
    expect(r.status).toBe("missing");
    expect(r.action).toEqual({ type: "run", label: "Add to Codex", verb: ["setup", "apply", "--only", "codex.policy"] });
  });

  test("trusted hooks read ready with nothing to do", async () => {
    const r = await codexPolicyRow(async () => planAt("installed"));
    expect(r.status).toBe("ready");
    expect(r.action).toBeNull();
  });

  test("a Codex that does not answer in time reads as needs-you, not a held plan", async () => {
    const started = Date.now();
    const wedged = withPlanDeadline(() => new Promise(() => {}), 50);
    const r = await codexPolicyRow(wedged);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r).toMatchObject({ status: "needs-you", detail: "rt could not ask Codex right now. Re-check in a moment.", action: null });
    expect(await withPlanDeadline(async () => planAt("installed"), 50)()).toEqual(planAt("installed"));
    expect(CODEX_POLICY_PLAN_DEADLINE_MS).toBe(5000);
  });

  test("a plan rt cannot make says why, and offers no approval", async () => {
    const notReady = await codexPolicyRow(async () => ({ ok: false, error: { code: "not-ready", message: "Codex is not running." } }));
    expect(notReady).toMatchObject({ status: "needs-you", detail: "Codex is not running.", action: null });
    const refused = await codexPolicyRow(async () => ({ ok: false, error: { code: "refused", message: "config.toml is not valid TOML." } }));
    expect(refused).toMatchObject({ status: "error", action: null });
    const threw = await codexPolicyRow(async () => {
      throw new Error("boom");
    });
    expect(threw).toMatchObject({ status: "error", action: null });
  });
});
