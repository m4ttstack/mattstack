# Console fixture generators

`blocks-fixtures.sh` rebuilds `src/server/fixtures/design/blocks.<skill>.json`
from the real mattstack engines, so the block view's fixtures show the
engines' current gates, labels and prose. Run it after an engine block under
`plugins/mattstack/attachments` changes.

```sh
bash apps/console/scripts/fixtures/blocks-fixtures.sh . "$(mktemp -d)" ship stage-plan
```

Arguments: the repo root, a scratch directory, then the skills to rebuild.
`--anatomy <skill>[=<name>]` (repeatable) also writes `anatomy.<name>.json`
(the name defaults to the skill) from `rt skills anatomy`. The `blocks`
scenario serves `anatomy.ship.json` this way, so the block view's pack line
names the engine's version, and `anatomy.work.rt.json` for the pipeline map
(`anatomy.work.json` stays the older scenarios' hand-made one):

```sh
bash apps/console/scripts/fixtures/blocks-fixtures.sh . "$(mktemp -d)" --anatomy ship --anatomy work=work.rt ship stage-plan
```

What it does:

- Copies `plugins/mattstack` and builds a small `widgets` pack beside it in the scratch directory.
- Runs `bun cli.ts skills blocks --json` under a throwaway `HOME` inside the scratch directory, so `~/.mattstack` is never read or written.
- `fixture_paths.py` places the scratch paths: the scratch pack becomes `/fixture/packs/acme`, the design fixture's own pack, so a block's prop files sit in the pack the history route reads. The fills the manifest takes from the `base:acme-base` layer go to `/fixture/orgbase/acme-base`, outside the team pack, where rt keeps an org base's fills. The rest goes under `/Users/acme/.mattstack-fixture`.
- `place-anatomy-fixture.py` tags a prop source the manifest takes from the `base:acme-base` layer as the org base's (`origin`, `base`, `baseVersion`), as rt tags a fill from a real org base pack.
- `place-blocks-fixture.py` adds the `acme-base` layer and its `lines` row (rt emits both for a pack that extends a real org base; the scratch pack binds through `layered` instead).

It writes only into the scratch directory and the fixture directory. Run
`bun run console:test` afterwards: `blocksPayload.test.ts` checks every layer
a payload uses is declared and counted.
