---
name: creating-a-pack
description: Use when a team wants the mattstack pipeline on a repo that has no pack yet -- "make a pack", "set up /<team>:work", "we want the work pipeline on our repo", "onboard our team to mattstack", or when no pack of the team's is installed. Not for adding rules or verbs to a pack that already exists.
---

# Creating a pack

A pack is a plugin in the team's folder of the org repo: a verb roster, a
bindings fragment, and (later) domain fills. `rt skills init` writes all of
it; this skill runs that verb, proves the result, and offers the first
rules. One team folder holds one pack, named after the team: the widgets
team in the acme org has its pack at
`~/.mattstack/orgs/acme/mattstack/teams/widgets/plugin/`, and the org
clone's `.claude-plugin/marketplace.json` lists it with the source
`./mattstack/teams/widgets/plugin`.

Walk this map to the end; a pack is not done until it is published. A
successful init publishes the new pack itself: it commits the pack, the
team's claim and the marketplace entry in one commit and pushes the org
clone, and says how that went in the envelope's `published`. Whenever init
stops short of that (a failed share, or a failure after it wrote the pack),
`rt team publish --team <org>` finishes it: init remembered the share on
this Mac before it compiled.

```dot
digraph create_pack {
    rankdir=TB;

    team_wants_pack [label="Trigger: a team wants the pipeline on a repo with no pack" shape=ellipse];
    rt_verb_daemon_status [label="rt_verb {args: [\"daemon\", \"status\"]}" shape=plaintext];
    claude_plugin_list [label="claude plugin list --json" shape=plaintext];
    git_remote_origin [label="git remote get-url origin" shape=plaintext];
    prerequisites_pass [label="Every prerequisite passes?" shape=diamond];
    name_misses [label="Name each miss and the command that installs it" shape=box];
    stop_substitute_prerequisite [label="STOP: never improvise a substitute" shape=octagon style=filled fillcolor=red fontcolor=white];
    team_org_known [label="Team and its org known?" shape=diamond];
    ask_which_team [label="Ask the author which team" shape=box];
    team_folder_exists [label="The team's folder exists?" shape=diamond];
    rt_team_create [label="rt team create <Name> --remote <url> --first-team <team>" shape=plaintext];
    author_is_admin [label="Author is an org admin?" shape=diamond];
    rt_team_add [label="rt team add <team> --owner <username>" shape=plaintext];
    ask_admin_add_team [label="Ask an org admin to add the team" shape=box];
    rt_skills_init [label="rt skills init --json --team <team> --repo <repo-path> [--extends <base>]" shape=plaintext];
    init_envelope [label="Envelope?" shape=diamond];
    published_pushed [label="published.pushed?" shape=diamond];
    relay_publish_reason [label="Relay published.reason" shape=box];
    rt_team_publish [label="rt team publish --team <org> --json" shape=plaintext];
    publish_envelope [label="Publish envelope?" shape=diamond];
    pulled_for_share [label="Pulled for this share already?" shape=diamond];
    rt_team_pull [label="rt team pull --team <org> --json" shape=plaintext];
    gate_share_failed [label="Gate: share did not land" shape=box];
    relay_error_message [label="Relay error.message verbatim" shape=box];
    refusal_code [label="Refusal code?" shape=diamond];
    init_runs_spent [label="Init runs = 2?" shape=diamond];
    gate_init_budget [label="Gate: init budget spent" shape=box];
    values_filled_once [label="Filled the listed values once already?" shape=diamond];
    fill_listed_values [label="Fill in each listed value with the author" shape=box];
    base_name_asked [label="Asked for the base name once already?" shape=diamond];
    fix_base_name [label="Ask the author for the base name" shape=box];
    relay_error_wrote [label="Relay error.message and error.wrote" shape=box];
    write_failed [label="write-failed?" shape=diamond];
    pack_dir_removed [label="Removed the pack dir once already?" shape=diamond];
    gate_write_failed [label="Gate: write failed after cleanup" shape=box];
    remove_pack_dir [label="Remove the pack dir" shape=box];
    stop_rerun_init [label="STOP: never re-run init on a written pack" shape=octagon style=filled fillcolor=red fontcolor=white];
    follow_remedy [label="Follow the printed remedy" shape=box];
    remedy_completed [label="The remedy completed the pack?" shape=diamond];
    gate_remedy_failed [label="Gate: remedy did not complete the pack" shape=box];
    in_herdr_pane [label="In a herdr pane?" shape=diamond];
    rt_pane_send_reload [label="rt pane send self --text \"/reload-plugins\" --then \"Continue: <tryNext> with a small real ticket\"" shape=plaintext];
    end_turn [label="End the turn" shape=box];
    continue_resumes [label="The queued Continue line resumes this pane" shape=ellipse];
    run_trynext [label="Run tryNext on a small real ticket" shape=box];
    run_reached_verdict [label="The run reached a CI verdict?" shape=diamond];
    name_fallbacks [label="Name each fallback the run took" shape=box];
    ask_author_reload [label="Ask the author to type /reload-plugins, then paste tryNext" shape=box];
    scaffolded_proof_pending [label="Report: scaffolded, proof pending" shape=box];
    ask_first_rules [label="Ask the first-rules question once" shape=box];
    rules_written [label="Rules written down?" shape=diamond];
    hand_rules_over [label="Hand each rule to extending-a-pack, one per round" shape=box];
    say_rules_anytime [label="Say rules can be added any time" shape=box];
    stopped_prerequisites [label="Stopped at prerequisites" shape=doublecircle];
    stopped_refusal [label="Stopped: refusal relayed" shape=doublecircle];
    handed_to_author [label="Handed to the author" shape=doublecircle];
    pack_published [label="Pack published" shape=doublecircle style=filled fillcolor=lightgreen];

    team_wants_pack -> rt_verb_daemon_status;
    rt_verb_daemon_status -> claude_plugin_list;
    claude_plugin_list -> git_remote_origin;
    git_remote_origin -> prerequisites_pass;
    prerequisites_pass -> team_org_known [label="yes"];
    prerequisites_pass -> name_misses [label="no"];
    name_misses -> stop_substitute_prerequisite;
    stop_substitute_prerequisite -> stopped_prerequisites;
    team_org_known -> rt_skills_init [label="yes"];
    team_org_known -> ask_which_team [label="team unclear, or no team folder yet"];
    ask_which_team -> team_folder_exists;
    team_folder_exists -> rt_skills_init [label="yes"];
    team_folder_exists -> author_is_admin [label="no: the org is on this Mac"];
    team_folder_exists -> rt_team_create [label="no org on this Mac: their remote, never an invented one"];
    author_is_admin -> rt_team_add [label="yes"];
    author_is_admin -> ask_admin_add_team [label="no"];
    ask_admin_add_team -> handed_to_author;
    rt_team_add -> rt_skills_init;
    rt_team_create -> rt_skills_init;
    rt_skills_init -> init_envelope;
    init_envelope -> published_pushed [label="ok: true"];
    published_pushed -> in_herdr_pane [label="true"];
    published_pushed -> relay_publish_reason [label="false"];
    relay_publish_reason -> rt_team_publish;
    rt_team_publish -> publish_envelope;
    publish_envelope -> in_herdr_pane [label="pushed: true"];
    publish_envelope -> pulled_for_share [label="error.code org-moved"];
    publish_envelope -> gate_share_failed [label="any other error.code"];
    pulled_for_share -> rt_team_pull [label="no"];
    pulled_for_share -> gate_share_failed [label="yes"];
    rt_team_pull -> rt_team_publish;
    gate_share_failed -> rt_team_publish [label="retry: author fixed it"];
    gate_share_failed -> handed_to_author [label="author takes over"];
    init_envelope -> relay_error_message [label="refused: true"];
    init_envelope -> relay_error_wrote [label="refused: false, after a write"];
    relay_error_message -> refusal_code;
    refusal_code -> init_runs_spent [label="zone-missing or zone-ambiguous"];
    refusal_code -> values_filled_once [label="params-missing"];
    refusal_code -> base_name_asked [label="base-missing"];
    refusal_code -> stopped_refusal [label="any other code"];
    values_filled_once -> fill_listed_values [label="no"];
    values_filled_once -> gate_init_budget [label="yes"];
    fill_listed_values -> rt_skills_init;
    base_name_asked -> fix_base_name [label="no"];
    base_name_asked -> gate_init_budget [label="yes"];
    fix_base_name -> rt_skills_init;
    init_runs_spent -> ask_which_team [label="no"];
    init_runs_spent -> gate_init_budget [label="yes"];
    gate_init_budget -> rt_skills_init [label="retry: author fixed it"];
    gate_init_budget -> handed_to_author [label="author takes over"];
    relay_error_wrote -> write_failed;
    write_failed -> pack_dir_removed [label="yes"];
    write_failed -> follow_remedy [label="no"];
    write_failed -> stop_rerun_init [label="tempted to re-run init"];
    stop_rerun_init -> follow_remedy;
    pack_dir_removed -> remove_pack_dir [label="no"];
    pack_dir_removed -> gate_write_failed [label="yes"];
    gate_write_failed -> remove_pack_dir [label="retry: author fixed it"];
    gate_write_failed -> handed_to_author [label="author takes over"];
    remove_pack_dir -> rt_skills_init;
    follow_remedy -> remedy_completed;
    remedy_completed -> rt_team_publish [label="yes"];
    remedy_completed -> gate_remedy_failed [label="no"];
    gate_remedy_failed -> follow_remedy [label="retry with their note"];
    gate_remedy_failed -> handed_to_author [label="author takes over"];
    in_herdr_pane -> rt_pane_send_reload [label="yes"];
    in_herdr_pane -> ask_author_reload [label="no"];
    rt_pane_send_reload -> end_turn;
    end_turn -> continue_resumes [style=dashed];
    continue_resumes -> run_trynext;
    run_trynext -> run_reached_verdict;
    run_reached_verdict -> name_fallbacks [label="yes"];
    run_reached_verdict -> scaffolded_proof_pending [label="no"];
    name_fallbacks -> ask_first_rules;
    ask_author_reload -> scaffolded_proof_pending;
    scaffolded_proof_pending -> ask_first_rules;
    ask_first_rules -> rules_written;
    rules_written -> hand_rules_over [label="yes"];
    rules_written -> say_rules_anytime [label="no"];
    hand_rules_over -> pack_published;
    say_rules_anytime -> pack_published;
}
```

## Prerequisites

| check | command | pass |
| --- | --- | --- |
| rt daemon | `rt_verb {args: ["daemon", "status"]}` | `"state":"running"` |
| mattstack plugin | `claude plugin list --json` | an id starting `mattstack@` |
| superpowers | `claude plugin list --json` | an id starting `superpowers@` |
| a GitLab remote | `git remote get-url origin` | host is a GitLab host |

## Steps

### Name each miss and the command that installs it

Report the missing thing and the command that installs it: `rt setup pack`,
run once and not routine, covers only the first three rows. A missing or
non-GitLab `origin` is the author's to fix: name the miss and say the remote
must be the repo on its GitLab host. Never set a remote yourself. Do not
improvise a substitute.

### Ask the author which team

The org repo is cloned at `~/.mattstack/orgs/<org>/` (its
`mattstack/mattstack.jsonc` says `role: org`), and each team is a folder
under its `mattstack/teams/`, named in lowercase letters, digits and
hyphens (`widgets`, `gadgets`). When the team is unclear, ask which team
this is before running anything.

When the org has no folder for the team,
`rt team add <team> --owner <username>` adds one, pack skeleton included,
and init carries that skeleton on. `--owner` is required: the forge
usernames (comma separated) who may change the team's settings and pack,
usually the author. Only an org admin can run it; when you do not know
whether the author is one, ask.

When this Mac has no org at all,
`rt team create <Name> --remote <url> --first-team <team>` makes the org
with the author's team as its first folder (without `--first-team` the
first folder is named after the org). It is a one-time setup call, not
routine, and the remote is an empty repo the org owns. Ask the author for
that URL; never invent one.

### Ask an org admin to add the team

The author is not an org admin, so `rt team add` would be refused. Say the
team needs a folder, give the command an admin runs
(`rt team add <team> --owner <username>`, with the author as owner), and
stop until the folder exists.

### Relay published.reason

`published` is `{ "pushed": false, "reason", "next" }` when the commit or
the push failed. The pack is installed on this Mac but not shared yet. Say
so, relay `published.reason`, and run the publish on Bash:
`rt team publish --team <org> --json` makes the commit init could not, then
pushes. Read its envelope, never its text: `{ "pushed": true, ... }` means
the pack is shared; a failure exits 2 with `{ "error": { "code", "message" } }`.
`org-moved` means someone else pushed first: pull with
`rt team pull --team <org> --json`, then publish again, once.

### Gate: share did not land

Quote the publish envelope's `error.code` and `error.message` and propose
the next move: `team-pull-only` means this Mac may not write the team's
files (an org admin or the team's owner finishes it); `org-moved` after a
pull means the org repo moved again. Never force. Retry: the author fixed
it; run `rt team publish --team <org> --json` again. Takes over: the pack
stays on this Mac for the author to share.

### Relay error.message verbatim

A refusal is `{ "error": { "code", "message", "refused": true } }`.
Relay `error.message` word for word (it ends with the command to run, when
there is one). A refusal with an `error.wrote` list (`params-missing`)
wrote the pack and the files that list names: tell the author the pack
exists uncompiled and relay each path. A refusal with no `error.wrote`
wrote nothing. Then read `error.code`:

- `zone-missing`: no org on this Mac, no team folder yet, or no team by the
  name given. The message's command is the one to run (`rt team add` only
  as an org admin).
- `other-org`: `--zone` named an org other than the one this Mac uses. rt
  works with one org per Mac, so a pack for that org is made from a Mac
  that uses it. Never re-run init without `--zone` to get past this: the
  pack would land in this Mac's org instead.
- `zone-ambiguous`: more than one team could hold the pack; name one with
  `--team`.
- `pack-exists`: this team's pack has already compiled, and init never
  changes it. Rules and verbs go through `mattstack:extending-a-pack`.
- `base-missing`: the org has no base pack by the name `--extends` gave.
  The message lists the org's base packs, when it has any.
- `base-chained`: the base `--extends` gave itself extends another base,
  which only an org admin can fix. Stop there: the author or an org admin
  decides whether to fix that base or extend one the message lists. Never
  pick another base for the author.
- `extends-conflict`: this team's pack is already written, uncompiled,
  with a different base (or none) than `--extends` gave. The message's
  command is the one that resumes it. Never edit the pack's `extends` to
  get past this.
- `params-missing`: the base named by `--extends` asks for values only
  this team can give. Init wrote the pack but did not compile it, and
  `error.wrote` lists the places it seeded for them.

### Ask the author for the base name

Show the author the base packs the message lists and ask which one this
team extends. Run the same init again with that name in `--extends`, or
without `--extends` when the team extends no base. Never pick a base for
the author.

### Fill in each listed value with the author

Ask the author for each value the message lists, and write it in the file
the message names beside it: a key in `pack/params.jsonc` (seeded as `""`,
one line each) or a seeded empty `pack/sections/<name>.md` (a block of
markdown).
An empty value or a blank section still counts as missing. Then run the
same init again: it resumes on the written pack and leaves the files alone.

### Relay error.message and error.wrote

A post-write failure is
`{ "error": { "code", "message", "refused": false, "wrote": [...] } }`:
init wrote files before it failed. Relay `error.message` and the
`error.wrote` list so the author sees what exists now.

### Remove the pack dir

Only after `write-failed`: that code's remedy is to remove the pack dir and
run init again. Remove the pack dir the `error.wrote` paths sit in, and
nothing else in the org clone.

### Follow the printed remedy

Do exactly what the printed remedy says. Never re-run init on a written
pack. Once the pack compiles and installs, the remedy's last step is
`rt team publish --team <org>`, which shares the pack with its entry; run
it with `--json` and read its envelope as `Relay published.reason` says.

### End the turn

The `rt pane send self` call above is the rt:herdr-inject pattern and has
already queued the reload; end the turn now. `/reload-plugins` loads the new
pack in place.

### Run tryNext on a small real ticket

Run `tryNext` with a small real ticket. "Works" means, after the reload: a
branch or worktree, an APPROACH block printed, a commit, an MR, and a CI
verdict. Every stage runs its generic path; that is the expected shape of a
pack with no fills.

### Name each fallback the run took

Name each fallback in the report, for example: the provisioner did not know
the repo, so the branch was made in the checkout.

The `work` verb's description in `pack/stubs.jsonc` is a placeholder seeded
from the engine. Rewording it in the team's words is the first, smallest
edit; `mattstack:extending-a-pack` covers it.

The seed declares one pipeline, `feature`, and plain `work` runs it. A kind
of work that needs its own stages or fills (accessibility, a bug fix) gets
a specialized pipeline and its own `work-<kind>` verb later, through the
recipe Add a specialized pipeline in `mattstack:extending-a-pack`, once
this first `feature` run has reported back.

### Ask the author to type /reload-plugins, then paste tryNext

`/reload-plugins` loads the new pack in the author's session in place.
Then they paste `tryNext` with a small real ticket.

### Report: scaffolded, proof pending

Until the first `/<pack>:work` run has reported back, the pack is
scaffolded, not proven: say "scaffolded, proof pending". When the run in
this pane stopped short of a CI verdict, name the stage it stopped at.
When the author runs it, their reloaded session owns the report. A hand-off
is not a proof.

### Ask the first-rules question once

Ask exactly this:

> Are any of your team's rules already written down (CONTRIBUTING, a review
> checklist, branch rules, a release checklist)?

### Hand each rule to extending-a-pack, one per round

Each yes is one round of `mattstack:extending-a-pack`, one rule per round.

### Say rules can be added any time

No is a complete answer. Say that rules can be added any time with
`mattstack:extending-a-pack`.

### Gate: init budget spent

Quote each init envelope's `error.message` and propose the next move: the
team (and org) to use, or what to clear. Retry: the author fixed it; run
init again, with `Init runs` starting again at zero. Takes over: the author
runs init.

### Gate: write failed after cleanup

Quote both init envelopes' `error.message` and `error.wrote`, and propose
the fix for the write failure (permissions, disk space). Retry: the author
fixed it; remove the pack dir again and run init once more. Takes over: the
author finishes the pack.

### Gate: remedy did not complete the pack

Quote the remedy and what is still missing, and propose the next move.
Retry: follow the remedy again with the author's note, and a remedy that
still leaves the pack incomplete comes back here. Takes over: the pack stays
as init and the remedy left it, for the author.

## What the graph cannot show

- Name the team and the app repo explicitly on init, never relying on the
  current directory. Without `--team`, init takes your own team, else
  detects one (the team that declares this repo, else the one team on the
  host with no compiled pack), which can land the pack in another team's
  folder. rt works with one org per Mac (the first clone by name when a
  Mac has several), so `--zone <org>` only ever names that org.
- When the org has a base pack this team builds on (a folder under
  `mattstack/org/packs/` in the org clone, say `acme-base`), add
  `--extends acme-base`: init writes `"extends": "acme-base"` into the
  fragment and seeds any values the base asks the team for.
- The pack binds the repos in its team's `board.projects` (the org's list
  unless the team sets its own), on the org's forge host. Init adds this
  repo to the team's list.
- An ok envelope is `{ "ok": true, ... }` and carries `pack.name`,
  `pack.dir`, `tryNext`, `restartNeeded` and `published`.
  `restartNeeded` is always true; the reload runs in place, never a
  restart.
- At `Pack published`, say that the team's members receive the pack
  through `rt setup` (a Mac installs only its active team's pack), unless
  their app is below the pack's engine floor (`pack/requires.json`
  `minEngine`, which compile writes): that Mac holds the pack, and its
  `pack.<name>` setup row says the pack needs a newer mattstack app and to
  update the app when it's offered. The pack installs once they do. Every
  later change to the pack goes out through the pack's own publish in
  `mattstack:editing-skills` (bump, commit, push, then
  `rt_verb {args: ["skills", "sync", "--pack", "<pack>"]}`), never through
  the daemon or `rt team publish`; a rule made and GREEN in a
  `mattstack:extending-a-pack` round enters it at `What changed?`.

## Writing fills later

Before a fill tells an agent to run a command, open
`${CLAUDE_SKILL_DIR}/../../../attachments/mcp-tools/reference.md` (the
`mcp-tools` reference): every rt call, forge call and git write a pipeline
needs has a tool there, except the few its header lists as staying on Bash
(`git commit` is one). The fill's sentence names that tool (a push is
`git_push {tree: <checkout>}`), not the command, and `rt skills check` <!-- mcp-lint: allow -->
flags the shell form. `rt skills audit --pack <pack>` is the slower read
for plain-words instructions.

A fill or pack skill that describes a process of its own (a trigger, steps,
an end) gets a digraph map per mattstack:process-digraphs. A fill that only
adds rules to one engine step carries just the rules, and the pack binds it
to that step's block, so they land in that step's section; it never adds a
move the engine's graph marks STOP. Init seeds `pack/skills.jsonc` at
`"version": 2` with two bindings (none the base already sets), each keyed by the plugin and the block id
with the prop inside; a step's fill joins them the same way (the last
line):

```jsonc
"bindings": {
  "mattstack:work/sub-agent-tiering": { "tiering": "mattstack:model-tiering" },
  "mattstack:stage-watch-ci/forge": { "forge": "mattstack:ci-forge-gitlab" },
  "mattstack:stage-ship/domain-fast-checks": { "rules": "widgets:lint-changed" }
}
```

`mattstack:extending-a-pack` writes it with one bind call, and its
`props.md` lists every block and prop.

## Red flags

- Creating directories or `plugin.json` by hand: init writes them.
- Copying another team's pack: its fills carry that team's rules.
- A `.mattstack/skills.jsonc` inside the repo: the compiler reads the
  pack's bindings file at `~/.mattstack/repos/<slug>/packs/<pack>/skills.jsonc`,
  not the repo.
- Writing a fill "to have something there": fills are optional and each one
  is written through `superpowers:writing-skills` when the rule exists.
