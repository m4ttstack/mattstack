---
paths:
  - "lib/worktree/**"
---

# Worktree pool

## Worktree pool: the golden tree

Every repo with `onDeck > 0` has one `kind: "golden"` worktree under
`~/.mattstack/rt/golden/<segment>/`. New on-deck members are built by
`clonefile(2)`-ing its git-ignored artifacts and inheriting its
`readyStamp`; they never run `pnpm install` at birth. Before touching
`lib/worktree/hydrate.ts`, `lib/worktree/clonefile.ts`, or replenish, read
`docs/superpowers/specs/2026-09-21-golden-worktree-hydration-design.md`.

Three traps, each of which cost a real debugging round:

- **The golden and the pool root must share an APFS volume.** `clonefile(2)`
  fails `EXDEV` across volumes, and replenish answers that by silently
  cold-creating, so the symptom is slowness, not an error.
- **Nothing on the replenish path may create the pool root.** The volume
  probe stats the nearest EXISTING ancestor for exactly this reason: an
  existing pool root is what tells `isHeldByUnreadableMount`
  (`reconcile.ts`) that a vanished mount is live again, and that hold is
  all that stops a mount outage from pruning live claim state.
- **`pnpm install` on an already-current tree still reruns every lifecycle
  script** (~3 min on a large pnpm monorepo), so a hydrated member must inherit the
  golden's stamp rather than "verify" itself with an install.
