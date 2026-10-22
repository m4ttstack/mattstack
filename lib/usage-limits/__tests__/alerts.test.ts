import { describe, expect, test } from "bun:test";
import { evaluateUsage, runUsageAlertSweep, thresholdsFor, type FiredState, type UsageAlert, type UsageAlertConfig } from "../alerts.ts";
import type { AccountUsage } from "../read.ts";

const CONFIG: UsageAlertConfig = { thresholds: [80, 95], accounts: {} };

function spendAt(pct: number, account = "dev@example.com"): AccountUsage {
  return {
    account,
    orgUuid: "org-1",
    limits: [{ kind: "spend", pct, used: pct * 10, limit: 1000, currency: "USD" }],
  };
}

describe("thresholdsFor", () => {
  test("falls back to the shared thresholds", () => {
    expect(thresholdsFor(spendAt(10), CONFIG)).toEqual([80, 95]);
  });

  test("an override keyed by email wins over the shared thresholds", () => {
    const config = { ...CONFIG, accounts: { "dev@example.com": [50] } };
    expect(thresholdsFor(spendAt(10), config)).toEqual([50]);
  });

  test("an override keyed by org UUID applies when the email has none", () => {
    const config = { ...CONFIG, accounts: { "org-1": [60, 90] } };
    expect(thresholdsFor(spendAt(10), config)).toEqual([60, 90]);
  });
});

describe("evaluateUsage", () => {
  test("nothing fires below the lowest threshold", () => {
    const { alerts, fired } = evaluateUsage([spendAt(40)], CONFIG, {});
    expect(alerts).toEqual([]);
    expect(fired).toEqual({ "dev@example.com|org-1|spend": 0 });
  });

  test("crossing a threshold fires once", () => {
    const first = evaluateUsage([spendAt(82)], CONFIG, {});
    expect(first.alerts).toHaveLength(1);
    expect(first.alerts[0]!.threshold).toBe(80);

    const second = evaluateUsage([spendAt(85)], CONFIG, first.fired);
    expect(second.alerts).toEqual([]);
  });

  test("jumping past two thresholds fires once, for the highest", () => {
    const { alerts } = evaluateUsage([spendAt(100)], CONFIG, {});
    expect(alerts.map((a) => a.threshold)).toEqual([95]);
  });

  test("the next threshold fires after the first", () => {
    const first = evaluateUsage([spendAt(82)], CONFIG, {});
    const second = evaluateUsage([spendAt(96)], CONFIG, first.fired);
    expect(second.alerts.map((a) => a.threshold)).toEqual([95]);
  });

  test("dropping back below re-arms, so the next crossing fires again", () => {
    const crossed = evaluateUsage([spendAt(96)], CONFIG, {});
    const reset = evaluateUsage([spendAt(5)], CONFIG, crossed.fired);
    expect(reset.alerts).toEqual([]);
    const again = evaluateUsage([spendAt(81)], CONFIG, reset.fired);
    expect(again.alerts.map((a) => a.threshold)).toEqual([80]);
  });

  test("a raised limit that lowers the percentage re-arms only the thresholds now clear", () => {
    const crossed = evaluateUsage([spendAt(100)], CONFIG, {});
    const raised = evaluateUsage([spendAt(85)], CONFIG, crossed.fired);
    expect(raised.alerts).toEqual([]);
    const climbing = evaluateUsage([spendAt(97)], CONFIG, raised.fired);
    expect(climbing.alerts.map((a) => a.threshold)).toEqual([95]);
  });

  test("each limit on each account is tracked on its own", () => {
    const usage: AccountUsage[] = [
      spendAt(90, "a@example.com"),
      { account: "b@example.com", limits: [{ kind: "five_hour", pct: 81 }, { kind: "seven_day", pct: 20 }] },
    ];
    const { alerts } = evaluateUsage(usage, CONFIG, {});
    expect(alerts.map((a) => `${a.account}|${a.limit.kind}|${a.threshold}`)).toEqual([
      "a@example.com|spend|80",
      "b@example.com|five_hour|80",
    ]);
  });

  test("one email in two orgs is two accounts", () => {
    const usage: AccountUsage[] = [
      { account: "dev@example.com", orgUuid: "org-a", limits: [{ kind: "seven_day", pct: 90 }] },
      { account: "dev@example.com", orgUuid: "org-b", limits: [{ kind: "seven_day", pct: 10 }] },
    ];
    const first = evaluateUsage(usage, CONFIG, {});
    const second = evaluateUsage(usage, CONFIG, first.fired);
    expect(first.alerts).toHaveLength(1);
    expect(second.alerts).toEqual([]);
  });

  test("an empty override silences that account", () => {
    const { alerts } = evaluateUsage([spendAt(100)], { ...CONFIG, accounts: { "dev@example.com": [] } }, {});
    expect(alerts).toEqual([]);
  });

  test("a config with no accounts map uses the shared thresholds", () => {
    const { alerts } = evaluateUsage([spendAt(90)], { thresholds: [80] }, {});
    expect(alerts.map((a) => a.threshold)).toEqual([80]);
  });

  test("a limit missing from one poll keeps its fired state", () => {
    const crossed = evaluateUsage([spendAt(90)], CONFIG, {});
    const missing = evaluateUsage([{ account: "dev@example.com", limits: [] }], CONFIG, crossed.fired);
    const back = evaluateUsage([spendAt(90)], CONFIG, missing.fired);
    expect(back.alerts).toEqual([]);
  });

  test("no thresholds means no alerts", () => {
    const { alerts } = evaluateUsage([spendAt(100)], { thresholds: [], accounts: {} }, {});
    expect(alerts).toEqual([]);
  });
});

describe("alert copy", () => {
  test("a spend alert names the account and the dollar amounts", () => {
    const { alerts } = evaluateUsage([spendAt(96)], CONFIG, {});
    expect(alerts[0]!.title).toBe("Claude usage at 96%");
    expect(alerts[0]!.message).toBe("dev@example.com: monthly spend $960.00 of $1,000.00.");
  });

  test("a window alert names the window", () => {
    const usage: AccountUsage[] = [{ account: "b@example.com", limits: [{ kind: "scoped:Fable", pct: 85 }] }];
    const { alerts } = evaluateUsage(usage, CONFIG, {});
    expect(alerts[0]!.message).toBe("b@example.com: weekly Fable limit at 85%.");
  });

  test("one email in two orgs is told apart by org name", () => {
    const usage: AccountUsage[] = [
      { account: "dev@example.com", orgUuid: "org-a", orgName: "Acme", limits: [{ kind: "seven_day", pct: 90 }] },
      { account: "dev@example.com", orgUuid: "org-b", orgName: "Personal", limits: [{ kind: "seven_day", pct: 10 }] },
    ];
    const { alerts } = evaluateUsage(usage, CONFIG, {});
    expect(alerts[0]!.message).toBe("dev@example.com (Acme): weekly limit at 90%.");
  });

  test("the configured hint follows the message", () => {
    const { alerts } = evaluateUsage([spendAt(96)], { ...CONFIG, hint: "Ask your admin for more usage." }, {});
    expect(alerts[0]!.message).toBe("dev@example.com: monthly spend $960.00 of $1,000.00. Ask your admin for more usage.");
  });
});

describe("runUsageAlertSweep", () => {
  function harness(pcts: number[]) {
    let fired: FiredState = {};
    const sent: UsageAlert[] = [];
    let i = 0;
    const tick = () => runUsageAlertSweep({
      read: async () => ({ accounts: [spendAt(pcts[i++]!)], problems: [] }),
      onProblems: () => {},
      config: () => CONFIG,
      loadFired: () => fired,
      saveFired: (f) => { fired = f; },
      notify: (a) => { sent.push(a); },
    });
    return { tick, sent };
  }

  test("notifies once across polls and persists what fired", async () => {
    const h = harness([82, 84, 96]);
    await h.tick();
    await h.tick();
    await h.tick();
    expect(h.sent.map((a) => a.threshold)).toEqual([80, 95]);
  });

  test("a read with no accounts leaves fired state alone", async () => {
    let saved = false;
    let reported: string[] = [];
    await runUsageAlertSweep({
      read: async () => ({ accounts: [], problems: ["cswap: list exited 1"] }),
      onProblems: (p) => { reported = p; },
      config: () => CONFIG,
      loadFired: () => ({}),
      saveFired: () => { saved = true; },
      notify: () => {},
    });
    expect(saved).toBe(false);
    expect(reported).toEqual(["cswap: list exited 1"]);
  });
});
