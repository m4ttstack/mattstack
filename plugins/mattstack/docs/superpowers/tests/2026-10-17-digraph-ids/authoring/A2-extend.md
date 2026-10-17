# A2: extend a short-id graph

Tests whether an agent extending a graph already in the short-id form keeps
that form for the nodes it adds. The starting graph passes check-dot.py. The
prompt is everything below the line.

---

Here is the dot block from a skill called release-tag.

```dot
digraph release_tag {
    trigger [label="Trigger: release branch green" shape=ellipse];
    changelog_ready [label="Changelog covers every merged PR?" shape=diamond];
    write_notes [label="Write the missing release notes" shape=box];
    notes_rounds [label="Notes rounds = 2?" shape=diamond];
    notes_blocked [label="Release blocked: notes incomplete" shape=doublecircle];
    git_tag [label="git_tag {tree, name}" shape=plaintext];
    git_push [label="git_push {tree, tags: true}" shape=plaintext];
    push_refused [label="git_push refused the tag?" shape=diamond];
    fix_remote [label="Fix the remote the refusal names" shape=box];
    stop_shell_push [label="STOP: push tags only with git_push" shape=octagon style=filled fillcolor=red fontcolor=white];
    gh_release_create [label="gh_release_create {tag, notes}" shape=plaintext];
    release_published [label="Release published" shape=doublecircle style=filled fillcolor=lightgreen];

    trigger -> changelog_ready;
    changelog_ready -> git_tag [label="yes"];
    changelog_ready -> write_notes [label="no"];
    write_notes -> notes_rounds;
    notes_rounds -> changelog_ready [label="no: check again"];
    notes_rounds -> notes_blocked [label="yes: budget spent"];
    git_tag -> git_push;
    git_push -> push_refused;
    push_refused -> gh_release_create [label="no: pushed"];
    push_refused -> fix_remote [label="yes"];
    push_refused -> stop_shell_push [label="tempted to push from the shell"];
    fix_remote -> git_push;
    stop_shell_push -> git_push;
    gh_release_create -> release_published;
}
```

Add a `run_budget {key: push-retries, limit: 2}` call before the retry and a
`Budget spent?` decision whose yes edge goes to a new outcome
`Push refused: reported`. Output the whole updated block.
