# rt Output Layer, Phase 6: Handoff for an Executing Agent

You are building phase 6 of RT-369, one slice at a time. Another agent (the shepherd) reviews and merges every PR you open. Read this file first, then the scoping doc, then the plan for your slice.

## Read in this order

1. `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md`: the spec. It wins over any plan.
2. `docs/superpowers/plans/2026-10-02-rt-output-layer-phase-6-scoping.md`: what phase 6 is, the standing rules, who owns which file, the order, and Matt's three rulings.
3. Your slice's plan: `docs/superpowers/plans/2026-10-02-rt-output-layer-phase-6<letter>-<name>.md`.
4. `AGENTS.md`, sections "Output layer" and "Operating on this machine".

Every plan was reviewed twice, and the review rulings are already in its text. Since the plans merged, main has changed only the board, the glitter checkout guard and one `MissionModel` field, so every file and line the plans cite still matches main as of 2026-10-04.

## Order

| Step | Slices | Gate |
|---|---|---|
| 1 | 6a | Nothing else merges before 6a. 6b needs `out.diagnostic` on main. |
| 2 | 6b, 6c, 6d, 6e, 6g, 6h, 6i, 6j | At most three in flight at once, each on its own branch and worktree. |
| 3 | 6f | Its PR merges only after 6h is on main and Matt has checked `rt cd` and `rt nav` by hand. Its tasks can run earlier. |
| 4 | 6k | Only after every other slice is on main. Its first task stops unless the allowlist is empty on `origin/main`. |

Shared files that two slices both edit are resolved by hand on rebase: the allowlist JSON, the `AGENTS.md` "Output layer" section (append only), `docs/design/output-layer/README.md`, `lib/ui/out.ts` with `lib/ui/__tests__/out.test.ts` (6a and 6f), and `commands/__tests__/intercept-output.test.ts` (6d and 6h).

## Running a slice

- One slice is one branch, one worktree and one PR. Get the worktree from the repo with `rt worktree provision --branch rt-369-phase-6<letter>-<name> --owner codex --wait`, then work in the path it prints; never work in the shared checkout at `~/Documents/GitHub/repo-tools`.
- Run the plan task by task, test first. Where the plan and main disagree, main wins: decide, then write the decision in your report as `Ruling: <what> ... <why>`. Nobody is waiting to answer questions mid-plan.
- Stop and report instead of guessing only for something irreversible, a change to a `--json` shape or an exit code the plan does not already state, or a plan so wrong that every way forward is a guess.
- The plans tell you to end commits with a `Co-Authored-By: Claude ...` trailer. Ignore that line and use your own attribution.
- The plans name Fast Browser for screenshots. Any headless browser will do: serve the HTML over `http://127.0.0.1`, because `file:` URLs are blocked.

## Rules that cost the most when broken

- A built `rt` binary runs only under an isolated HOME: `env -i HOME=<temp> PATH="$PATH" ...`. A run against the real `~/.mattstack` starts a real daemon that acts on this Mac.
- Never start a second daemon, and never rebuild, re-sign or reinstall `/Applications/mattstack.app` or `mattstack-dev.app`.
- Run `bun test` from the worktree root only, so the preload isolates HOME.
- After a pull or rebase, run `bun run ui:build`. An older `rt-ui` leaves a `done` row where a transient step should vanish.
- `--json` stdout and exit codes stay byte-identical unless the plan names the change and the ruling behind it.
- No em or en dashes anywhere: code, copy, commits or the PR. A comment only states a constraint the code cannot show, never what a line does or why a reviewer should accept it.
- Never use `git add -A`, `git add .` or `git add -u`. Add files by name.
- Never read files under `~/.claude`, `~/.claude-swap-backup` or `~/.codex`.

## Known flakes

These rotate in the full unit suite. A failure that passes when its file runs alone, in a file you did not touch, is a flake: say so in the report with both results.

- `flavor-takeover`, `sync-stack-guard`, `git reset`, `setup-connect` oauth, `daemon-logdy-config`, and hydrate load tests.
- In CI: Go's `TestTextValidatesPatternThenAccepts` and the `exitcode-guard` fixture. Rerun only the failed job.
- The `rt plugin new` e2e fails on this Mac with a mise shim error. That failure is not yours.

`e2e/tests` needs `--preload ./e2e/setup.ts`. Before calling a slice verified, run the e2e or pty file that covers what you changed, as well as `bun run test`.

## Before you open the PR

1. A final review of the whole branch has come back clean.
2. You have rebased on `origin/main` and run the slice's tests again.
3. If the slice changes what a person sees, it has a render. Render through `ui/dist/rt-ui render` with `COLORTERM=truecolor` and screenshot it on a dark and a light background. Save both under `docs/design/output-layer/`, and say in the PR what reads wrong.
4. If the slice touches `plugins/mattstack`, bump `.claude-plugin/plugin.json` to one patch above `origin/main`. After every rebase, run `bun scripts/ci/plugin-version-bumped.ts --base origin/main --plugin plugins/mattstack` again.

## The PR

- Title: `RT-369: output layer phase 6<letter>, <name>`.
- Body: one framing paragraph, bold-labelled bullet groups, the renders, how you verified it, and every `Ruling:` line from your report.
- Never merge. The shepherd watches CI and CodeRabbit (or an Opus review when CodeRabbit is rate limited), checks the renders, merges, and posts to Linear.
- When the PR is open, tell Matt the PR number. Then fix what review finds on the same branch until the shepherd merges it.
