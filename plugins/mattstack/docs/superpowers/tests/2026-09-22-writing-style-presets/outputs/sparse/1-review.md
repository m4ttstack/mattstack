src/settings/cache.ts:2

**nitpick:** unused import.

src/settings/cache.ts:7

**issue:** i think this leaks across tenants. `userId` is only unique within a tenant (`src/users/ids.ts:14`), and seed data already has a `u7` in both t1 and t2:

```
getSettings("t1", "u7") -> t1 settings
getSettings("t2", "u7") -> t1 settings
```

could we key on tenant and user, and have `clearSettings` take both?

**suggestion:** would you mind adding a test for the two-tenant case? 👌

Left one blocker inline.
