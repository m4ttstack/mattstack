ABC-481: key settings cache on tenant and user

user ids are only unique within a tenant, so two tenants sharing an id
read each other's settings.
