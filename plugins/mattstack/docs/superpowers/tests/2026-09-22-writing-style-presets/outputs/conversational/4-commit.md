ABC-481: Key the settings cache on tenant and user

User ids only repeat within a tenant, so keying on userId alone let two
tenants with the same id read each other's settings. clearSettings now
takes both as well.
