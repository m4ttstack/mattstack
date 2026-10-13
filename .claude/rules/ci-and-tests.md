---
paths:
  - "scripts/ci/**"
  - ".github/workflows/checks.yml"
  - "test-timings.json"
  - "lib/__tests__/no-*.test.ts"
  - "commands/__tests__/no-*.test.ts"
  - "scripts/__tests__/no-*.test.ts"
  - "e2e/**"
---

# CI shards and test scope

CI runs the unit suite as three macOS shards (`bun test --shard=i/3
--timings=test-timings.json`, balanced by the committed timings file,
which the Timings workflow regenerates) and runs the non-Mac gates on
ubuntu. `scripts/ci/test-scope.ts` decides a PR's scope from its diff, for
the shards and for every path-gated job (`go`, `deck-macos`, `e2e-tests`,
`glitter-pty`, `website`, the plugin jobs); `docs/ci.md` has the table.
Its "The unit shards' modes" section says which diffs skip the shards,
which run `--changed=HEAD^1` and which run the full suite. Whenever the shards
do not run in full, the ubuntu `guards` job runs every `no-*.test.ts`
guard in the unit directories.
Any other test that spawns
`cli.ts` or reads source as text is not selected by `--changed`, so it
must be named `no-*` to run on a PR at all; an un-prefixed one only runs
on main, so a TypeScript-only PR can go green and break main there. When
the shards' printed wall times drift more than a minute apart, refresh
the timings file by running the Timings workflow
(`gh workflow run timings.yml`) and committing its artifact;
`bun run test:timings` on a laptop produces a laptop-balanced file,
which is not the same thing.
