# Fixture 1: review a teammate's PR

You are reviewing PR #212 in `acme/storefront`, "cache per-user settings".
Post the review: each inline finding as `path:line` followed by the comment
body, then any finding with no line to anchor to as its own top-level
comment, then the one summary comment.

```diff
--- a/src/settings/cache.ts
+++ b/src/settings/cache.ts
@@ -1,20 +1,31 @@
-import { loadSettings } from "./load";
+import { loadSettings, type Settings } from "./load";
+import { logger } from "../log";
 
-export async function getSettings(tenantId: string, userId: string) {
-  return loadSettings(tenantId, userId);
+const cache = new Map<string, Settings>();
+
+export async function getSettings(tenantId: string, userId: string): Promise<Settings> {
+  const hit = cache.get(userId);
+  if (hit) return hit;
+  const settings = await loadSettings(tenantId, userId);
+  cache.set(userId, settings);
+  return settings;
 }
+
+export function clearSettings(userId: string) {
+  cache.delete(userId);
+}
```

Facts you verified while reviewing:
- `userId` values are unique only within a tenant (`src/users/ids.ts:14`
  derives them from a per-tenant counter).
- Tenants `t1` and `t2` in the seed data both have a user `u7`; calling
  `getSettings("t1", "u7")` then `getSettings("t2", "u7")` returns t1's
  settings both times.
- `logger` is imported and never used.
- The PR adds no tests.
