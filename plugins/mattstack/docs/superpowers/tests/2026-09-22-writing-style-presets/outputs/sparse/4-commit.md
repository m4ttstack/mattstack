ABC-481: key settings cache on tenant and user

userId is only unique within a tenant, so two tenants with the same
user id read each other's settings. clearSettings takes both now.
