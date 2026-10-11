# StrongDM (`rt sdm`)

`rt sdm` is a StrongDM auth-and-connect module: it logs you in, lists the
datasources you can reach, and connects you fast with friendly names.

```bash
rt sdm connect            # pick a datasource and connect (auto-logs-in if your session expired)
rt sdm status             # StrongDM auth health + connected tunnels
rt sdm connections        # list the tunnels you currently have open
rt sdm login              # log in (browser popup, terminal fallback)
rt sdm set-email <email>  # set the email rt logs in with
rt sdm refresh            # re-scan the catalog
rt sdm enrichment         # see how many connections have labels
```

rt reads your resources straight from the StrongDM CLI (`sdm access catalog`
plus `sdm status`), so there is nothing to configure and no list to maintain.
Every real datasource you can reach shows up in the picker. If `rt sdm connect`
only shows recents, your session expired; it logs you back in automatically
before listing.

## What the picker shows

The picker groups every resource under an `<Environment> · <Carrier>` header, read from the `env` and `tenant` tags StrongDM already holds on each resource. You set nothing up. Each row shows the domain, your access and the resource, with `write` in peach and `admin` in coral. Recently used rows come first. Resources with no `tenant` tag are marked `old` when rt can guess their carrier from the name.

A resource tagged `env=prod` counts as production: you get a confirmation prompt, and agents are refused. A resource override can turn that off with `"production": false`.

## Overrides and carrier names (optional)

Two team settings tune what the picker shows. Edit them in console settings under StrongDM, or from the terminal with `rt settings set ... --scope team`.

`sdm.resources` gives a resource a nicer label and connect defaults:

```bash
rt settings set sdm.resources '{"acme-db-staging":{"label":"acme staging","tier":"staging","db":{"schema":"public"}},"acme-db-prod":{"label":"acme prod","tier":"production","production":true}}' --scope team
```

| Field | Meaning |
|---|---|
| `label` | Shown in the picker (defaults to a name built from the resource's tags, or its raw name when it has none) |
| `tier` | `development` / `qa` / `staging` / `production` / anything: groups the picker |
| `production` | `true` adds a confirm guard before connecting; `false` lifts the one a `prod` tag adds |
| `reasonSuggestion` | Prefill for the access-request reason prompt |
| `db` | `{ database, schema, user }` hints used to verify the tunnel after connecting |

`sdm.carriers` names a carrier. The key is the `tenant` tag value:

```bash
rt settings set sdm.carriers '{"acme":{"label":"Acme Insurance"}}' --scope team
```

A tag with no entry shows capitalised, so `acme` appears as `Acme`. A resource missing from `sdm.resources` shows the name built from its tags (its raw name when it has none) and connects with Postgres defaults.

rt reads overrides only from `sdm.resources` in your team's settings. `rt setup update` moved the older `rt.sdmEnrichment` key there on the Mac of the team's owner, and rt no longer reads it. rt no longer reads the local file `~/.mattstack/rt/sdm/enrichment.jsonc` either. If one is still there and your team has no overrides, rt prints the `rt settings set` command your team's owner can run to move it. `rt sdm enrichment` shows how many of your connections have labels.
