ABC-481: key settings cache on tenant and user

user ids are only unique within a tenant, so two tenants with the same
id read each other's settings. clearSettings now takes both.
