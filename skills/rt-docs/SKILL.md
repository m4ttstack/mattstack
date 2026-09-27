---
name: rt:docs
description: Use when updating the rt.cool documentation for a release or after command/behavior changes ... regenerate the generated command reference, update the concept guides that changed, and leave everything staged for review.
---

# Updating rt.cool docs

The rt.cool docs site lives in `website/` (a Docusaurus site served at the site root; the CLI reference is not under a docs subpath the way some sites nest it). Two kinds of content live side by side there, and mixing them up is the main way this goes wrong.

## Context

- `website/docs/reference/` is GENERATED. `scripts/gen-docs.ts` builds every page under it from `lib/command-tree-def.ts`, the single source of truth for command names, subcommands, flags, and args. Never hand-edit a generated page; your edit is silently discarded the next time someone runs the generator.
- `website/docs/guides/*`, `website/docs/getting-started/*`, `website/docs/intro.mdx`, and `website/docs/reference/global.mdx` are hand-written. These are where prose, rationale, and workflow explanation live.
- `website/docs/reference/_partials/<relpath>.mdx` files are hand-written worked examples spliced into an otherwise-generated reference page (`<relpath>` mirrors the command's path, e.g. `_partials/worktree/new.mdx` for the `worktree new` command). The generator checks whether a partial exists for a given command and, if so, imports it into the generated page rather than overwriting it. These files are never clobbered by generation, so they are the one place you can add worked prose underneath a generated flag table.

## The rule

You never write or edit a command flag/arg table by hand, anywhere, for any reason. Those tables come only from regenerating against `lib/command-tree-def.ts`. If a table is wrong or incomplete, the fix is a code change to the command tree definition (out of scope for this skill) or a `docs:check` coverage note, never a hand patch to the rendered Markdown. Your job is the part a script cannot do: writing and updating guide prose, adding worked examples in `_partials`, and recognizing when a genuinely new subsystem needs a whole new guide page rather than a paragraph tacked onto an existing one. Judgment, not transcription.

## Process

```dot
digraph rt_docs {
    rankdir=TB;

    "Held: the turn ends naming the gate" [shape=doublecircle];
    "Handed back to Matt" [shape=doublecircle];
    "Staged for review" [shape=doublecircle style=filled fillcolor=lightgreen];
    "Trigger: docs need updating" [shape=ellipse];
    "bun run docs:gen" [shape=plaintext];
    "docs:gen result?" [shape=diamond];
    "Base given?" [shape=diamond];
    "git describe --tags --abbrev=0" [shape=plaintext];
    "git log --oneline <base>..HEAD" [shape=plaintext];
    "Read the diff of each behavior change" [shape=box];
    "Update the hand-written pages" [shape=box];
    "bun run docs:check" [shape=plaintext];
    "docs:check result?" [shape=diamond];
    "List the commands missing args as a TODO" [shape=box];
    "Regeneration rounds = 2?" [shape=diamond];
    "bun run docs:gen, rerun for the drift" [shape=plaintext];
    "STOP: flag tables come only from docs:gen" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "git add <each changed file>" [shape=plaintext];
    "Off-script gate: docs:gen failed" [shape=box];
    "Docs:gen failed: gate rounds = 2?" [shape=diamond];
    "Off-script gate: drift docs:gen cannot clear" [shape=box];
    "Drift docs:gen cannot clear: gate rounds = 2?" [shape=diamond];
    "Off-script gate: docs:check failed" [shape=box];
    "Docs:check failed: gate rounds = 2?" [shape=diamond];

    "Trigger: docs need updating" -> "bun run docs:gen";
    "bun run docs:gen" -> "docs:gen result?";
    "docs:gen result?" -> "Base given?" [label="ok"];
    "Off-script gate: docs:gen failed" -> "Base given?" [label="take: Matt fixed the generator and ran it"];
    "Off-script gate: docs:gen failed" -> "Docs:gen failed: gate rounds = 2?" [label="iterate: Matt fixed the cause"];
    "Off-script gate: docs:gen failed" -> "Held: the turn ends naming the gate" [label="hold"];
    "Off-script gate: docs:gen failed" -> "Handed back to Matt" [label="hand back"];
    "Docs:gen failed: gate rounds = 2?" -> "bun run docs:gen" [label="no: retry"];
    "Docs:gen failed: gate rounds = 2?" -> "Handed back to Matt" [label="yes: budget spent"];
    "docs:gen result?" -> "Off-script gate: docs:gen failed" [label="failed"];
    "Base given?" -> "git log --oneline <base>..HEAD" [label="yes"];
    "Base given?" -> "git describe --tags --abbrev=0" [label="no"];
    "git describe --tags --abbrev=0" -> "git log --oneline <base>..HEAD";
    "git log --oneline <base>..HEAD" -> "Read the diff of each behavior change";
    "Read the diff of each behavior change" -> "Update the hand-written pages";
    "Update the hand-written pages" -> "bun run docs:check";
    "bun run docs:check" -> "docs:check result?";
    "bun run docs:gen, rerun for the drift" -> "bun run docs:check";
    "docs:check result?" -> "git add <each changed file>" [label="clean"];
    "docs:check result?" -> "List the commands missing args as a TODO" [label="coverage gaps"];
    "List the commands missing args as a TODO" -> "git add <each changed file>";
    "docs:check result?" -> "Regeneration rounds = 2?" [label="reference drift"];
    "Regeneration rounds = 2?" -> "bun run docs:gen, rerun for the drift" [label="no"];
    "Off-script gate: drift docs:gen cannot clear" -> "git add <each changed file>" [label="take: Matt accepts the drift for now"];
    "Off-script gate: drift docs:gen cannot clear" -> "Drift docs:gen cannot clear: gate rounds = 2?" [label="iterate: Matt fixed the cause"];
    "Off-script gate: drift docs:gen cannot clear" -> "Held: the turn ends naming the gate" [label="hold"];
    "Off-script gate: drift docs:gen cannot clear" -> "Handed back to Matt" [label="hand back"];
    "Drift docs:gen cannot clear: gate rounds = 2?" -> "bun run docs:gen, rerun for the drift" [label="no: retry"];
    "Drift docs:gen cannot clear: gate rounds = 2?" -> "Handed back to Matt" [label="yes: budget spent"];
    "Regeneration rounds = 2?" -> "Off-script gate: drift docs:gen cannot clear" [label="yes: budget spent"];
    "Off-script gate: docs:check failed" -> "git add <each changed file>" [label="take: Matt ran it clean himself"];
    "Off-script gate: docs:check failed" -> "Docs:check failed: gate rounds = 2?" [label="iterate: Matt fixed the cause"];
    "Off-script gate: docs:check failed" -> "Held: the turn ends naming the gate" [label="hold"];
    "Off-script gate: docs:check failed" -> "Handed back to Matt" [label="hand back"];
    "Docs:check failed: gate rounds = 2?" -> "bun run docs:check" [label="no: retry"];
    "Docs:check failed: gate rounds = 2?" -> "Handed back to Matt" [label="yes: budget spent"];
    "docs:check result?" -> "Off-script gate: docs:check failed" [label="failed outright"];
    "docs:check result?" -> "STOP: flag tables come only from docs:gen" [label="tempted to patch a generated table"];
    "STOP: flag tables come only from docs:gen" -> "bun run docs:gen, rerun for the drift";
    "git add <each changed file>" -> "Staged for review";
}
```

### Read the diff of each behavior change

For any commit in the range that touches a command handler or `lib/command-tree-def.ts`, read its diff so you understand the actual behavior change, not just the commit subject.

### Update the hand-written pages

For every changed, added, or removed command or behavior, decide:

- Does an existing guide under `website/docs/guides/*` (or a getting-started page) describe this and now need updating? Edit it.
- Would a worked example help under the command's generated reference page? Add or update `website/docs/reference/_partials/<relpath>.mdx`.
- Is this a genuinely new subsystem with no existing home? Propose a new guide file under `website/docs/guides/`, giving it a `sidebar_position` in its frontmatter so it slots into the sidebar correctly.

When nothing hand-written needs to change for a given command, that's a valid outcome; do not pad guides with restatements of the generated flag table. Never invent or guess behavior to fill a gap; if you are not certain a claim is true, go read the actual command handler source before writing the sentence. No em dashes or en dashes in anything you write; use commas, periods, or "..." instead.

### List the commands missing args as a TODO

`docs:check` reports command coverage (commands still missing declared `args`). List the specific commands still missing `args` as a TODO in your report; do not fabricate flags or invent behavior just to close the gap.

### Off-script gate: docs:gen failed

Quote the `docs:gen` failure output. Take means Matt fixed the generator and ran it himself; the graph continues at `Base given?` on his result. Iterate means he fixed the cause and `bun run docs:gen` runs again, counted by `Docs:gen failed: gate rounds = 2?`. Hold ends the turn naming this gate. Hand back reports the failure to whoever is driving the release, unresolved.

### Off-script gate: drift docs:gen cannot clear

Quote the reference drift `docs:check` still reports after two regeneration rounds. Take means Matt accepts the drift for now; the add proceeds on the files as they stand. Iterate means he fixed the cause and `bun run docs:gen, rerun for the drift` runs again, counted by `Drift docs:gen cannot clear: gate rounds = 2?`. Hold ends the turn naming this gate. Hand back reports the unresolved drift.

### Off-script gate: docs:check failed

Quote the `docs:check` failure output (a failure outright, not reference drift or coverage gaps). Take means Matt ran it clean himself; the add proceeds. Iterate means he fixed the cause and `bun run docs:check` runs again, counted by `Docs:check failed: gate rounds = 2?`. Hold ends the turn naming this gate. Hand back reports the failure.

## URL facts

Use these when cross-linking between docs so links resolve correctly:

- Reference pages resolve at `/reference/<path>` (e.g. the page generated for `worktree new` resolves at `/reference/worktree/new`).
- Guides resolve at `/guides/<name>`.
- A `_partials` file is pulled into its generated page with `import Notes from '@site/docs/reference/_partials/<relpath>.mdx';`; you do not link to a partial directly, it only ever appears spliced into its parent reference page.

`git add <each changed file>` stages the specific files you changed or generated, no wildcard adds. It never commits; that's for whoever is driving the release.
