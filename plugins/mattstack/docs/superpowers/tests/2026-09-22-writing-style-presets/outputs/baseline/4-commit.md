Key settings cache on (tenantId, userId)

The cache was keyed on userId alone, but user ids are only unique
within a tenant. Two tenants with the same user id read each other's
settings: whichever loaded first won.

Key entries on both tenantId and userId, and make clearSettings take
both so eviction removes the right entry.

ABC-481
