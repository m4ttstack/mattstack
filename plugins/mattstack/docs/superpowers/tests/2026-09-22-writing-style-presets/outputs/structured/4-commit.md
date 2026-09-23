ABC-481: Key settings cache on tenant and user

userId is unique only within a tenant, so two tenants with the same
user id read each other's cached settings. clearSettings now takes
both ids so eviction hits the right entry.
