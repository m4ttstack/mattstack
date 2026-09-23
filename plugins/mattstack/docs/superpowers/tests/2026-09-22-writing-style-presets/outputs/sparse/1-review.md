src/settings/cache.ts:7

**issue:** this leaks settings across tenants. `userId` is only unique per tenant (`src/users/ids.ts:14` derives it from a per-tenant counter), so two tenants with the same id share one entry. the seed data hits it:

```
getSettings("t1", "u7") -> t1 settings
getSettings("t2", "u7") -> t1 settings
```

could we key on both and have `clearSettings` take the tenant too?

```ts
const key = `${tenantId}:${userId}`;
```

---

src/settings/cache.ts:2

**nitpick:** `logger` isn't used.

---

**suggestion:** would you mind adding a test for the two-tenant case? it'd have caught the key collision.

---

Left one blocker inline.
