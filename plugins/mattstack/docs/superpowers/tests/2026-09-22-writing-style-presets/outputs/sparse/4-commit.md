ABC-481: key settings cache on tenant and user

user ids are only unique within a tenant, so keying on userId alone let
two tenants read each other's settings. clearSettings takes both now.
