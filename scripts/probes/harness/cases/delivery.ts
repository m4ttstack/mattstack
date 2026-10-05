import type { Evidence } from "../evidence";
import type { Lab } from "../lab";
import { judgeDelivery } from "../verdicts";
import { ready, textInput } from "./common";

export async function run(lab: Lab, ev: Evidence) {
  const w = await lab.launchWorker("d1");
  const c = await lab.connect();
  try {
    await ready(c, w);
    const clientId = crypto.randomUUID();
    const consumed = c
      .next(
        e =>
          ["item/started", "item/completed"].includes(e.method) &&
          e.params.threadId === w.threadId &&
          e.params.item?.type === "userMessage" &&
          e.params.item?.clientId === clientId,
        90000
      )
      .catch(() => undefined);
    const response = await c.call("thread/queue/add", {
      threadId: w.threadId,
      clientUserMessageId: clientId,
      input: textInput("Reply DELIVERED and nothing else."),
    });
    ev.record("G7-submitted", { threadId: w.threadId, clientId, response });
    const item = await consumed;
    ev.record("G7-consumed", item ?? { observed: false });
    return [judgeDelivery({ consumed: Boolean(item) })];
  } finally {
    c.close();
  }
}
