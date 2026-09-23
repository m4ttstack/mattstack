ABC-481: Key the settings cache on tenant and user

User ids are only unique within a tenant, so two tenants with the same
id were reading each other's settings. clearSettings takes both now.
