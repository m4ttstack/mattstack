import type { HarnessIntegration, IntegrationRegistry } from "./contracts.ts";

/** Snapshot membership without probing integrations or loading their adapters. */
export function createRegistry(items: readonly HarnessIntegration[]): IntegrationRegistry {
  const byId = new Map<string, HarnessIntegration>();
  for (const item of items) {
    if (byId.has(item.id)) throw new Error(`Duplicate harness ID: ${item.id}`);
    byId.set(item.id, item);
  }
  const registered = Object.freeze([...byId.values()]);
  return Object.freeze({
    get: (id: string) => byId.get(id),
    list: () => registered,
  });
}
