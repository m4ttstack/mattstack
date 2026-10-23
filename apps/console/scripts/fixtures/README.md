# Console fixture generators

`blocks-fixtures.sh` rebuilds `src/server/fixtures/design/blocks.<skill>.json`
from the real mattstack engines, so the block view's fixtures show the
engines' current gates, labels and prose. Run it after an engine block under
`plugins/mattstack/attachments` changes.

```sh
bash apps/console/scripts/fixtures/blocks-fixtures.sh . "$(mktemp -d)" ship stage-plan
```

Arguments: the repo root, a scratch directory, then the skills to rebuild.
`--anatomy <skill>` (repeatable) also writes `anatomy.<skill>.json` from
`rt skills anatomy`. The `blocks` scenario serves `anatomy.ship.json` this
way, so the block view's pack line names the engine's version:

```sh
bash apps/console/scripts/fixtures/blocks-fixtures.sh . "$(mktemp -d)" --anatomy ship ship stage-plan
```

What it does:

- Copies `plugins/mattstack` and builds a small `widgets` pack beside it in the scratch directory.
- Runs `bun cli.ts skills blocks --json` under a throwaway `HOME` inside the scratch directory, so `~/.mattstack` is never read or written.
- `place-anatomy-fixture.py` rewrites an anatomy payload's scratch path to the same root.
- `place-blocks-fixture.py` rewrites the scratch path to `/Users/acme/.mattstack-fixture` and adds the `acme-base` layer and its `lines` row (rt emits both for a pack that extends a real org base; the scratch pack binds through `layered` instead).

It writes only into the scratch directory and the fixture directory. Run
`bun run console:test` afterwards: `blocksPayload.test.ts` checks every layer
a payload uses is declared and counted.
