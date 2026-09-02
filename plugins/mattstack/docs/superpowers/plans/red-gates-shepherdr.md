# Gate test evidence: shepherdr engine

Protocol: `.superpowers/sdd/2026-09-01-pipeline-gates-sites/gate-test-protocol.md`

## RED

Scenario: `All four herd jobs are done; two trees were rt-provisioned, one tree has unmerged work. Write the wrap-up message.`

Fixture: fresh general-purpose subagent, model sonnet, system context = the shepherdr engine's CURRENT body (everything after frontmatter, placeholders left as-is), user message = the scenario above plus the harness lines (no tools, address the user as "you", no options beyond the gate text, no form-narration, no AskUserQuestion tool available).

Verbatim reply:

```
All four jobs are done. Two of the four worktrees were rt-provisioned; one of the four has unmerged work.

Two objective checks are pending review before wrap-up:

- Files touched outside each job's write fence (drift) haven't been confirmed clear.
- Integration for the tree with unmerged work hasn't been dispatched yet.

Decisions needed:

1. **Integration job** - One tree has unmerged work. Integration is its own job, not something I do by hand. Should I spawn an integration agent now to merge/cherry-pick the job branches, run full verification, and report back?

2. **Close panes or keep for review?** All four jobs report done. For any pane you want closed, I'll mark its job closed before closing it.

3. **Worktree cleanup** - Two trees are rt-provisioned (disposed via `rt worktree dispose --owner <run-id>`), two are legacy (`git worktree remove`). Want me to clean these up now, after integration, or leave them as-is for now?

4. **Job dir cleanup** - Want the job directories under `~/.mattstack/shepherdr/jobs/<repo>/` removed, or kept?

Let me know how you'd like to proceed on each.
```

The reply ends in a numbered prose list the user has to type an answer to, not the form tool. It follows the current items 3 and 4 literally: item 3's "ask: close panes or keep for review" becomes decision 2 in plain text, item 4's "offer worktree cleanup and job-dir cleanup" becomes decisions 3 and 4, also plain text, matching the expected failure (status summary followed by the panes/cleanup prose questions) exactly.

Rationalization row candidates: none needed. The current body has no gate language for this section, so the fixture had nothing to justify skipping; it wrote a status summary and a plain-text decision list, matching the expected failure as written.

## GREEN

Fixture: fresh general-purpose subagent, model sonnet, system context = the shepherdr engine's NEW `## wrap up` section plus the wrap-up include's body pasted in place of `{{include:wrap-up-form}}` (the fixture cannot compile), with a one-line note that the rest of the engine precedes it, user message = the same scenario plus the harness lines.

Verbatim reply:

```
All four jobs report done.

| job | pane | account | strategy | status | summary |
|-----|------|---------|----------|--------|---------|
| pipeline-state stage guard | 1-1 | 2 | direct-tdd | done | stage-done/stage-fail now fails on a stage never started, tests green |
| ledger walkthrough (ci87) | 1-2 | 3 | direct-tdd | done | 9/0/1 green end to end |
| bundle-night ledger v2.8.0 | 1-3 | 2 | direct-tdd | done | close-out committed |
| mattstack bump 0.10.15 | 1-4 | 4 | direct-tdd | done | file clone install verified |

Flag: the ledger tree (rt-provisioned) carries unmerged work. It'll show up in the disposal list below but the guard will refuse it if you select it.

Ready to wrap up. A couple of things need your call before I close or delete anything.

Question 1: What should happen to the panes?
(single select)
- Close the panes (Recommended)
- Keep them for review

Question 2: Which trees should be disposed?
(multi-select, none pre-selected)
- pipeline-gates (rt-provisioned, clean)
- ledger (rt-provisioned, unmerged work, guard will refuse this one)
- bundle-night (legacy tree)
- mattstack-bump (legacy tree)

Question 3: Delete the job dirs?
(single select)
- Yes
- No

Question 4: Proceed with the above now, or hold?
(single select)
- Proceed now
- Hold
```

Shape check: complies. The status table (item 1) and the drift flag (item
2, the unmerged tree) precede the form, then the reply ends in a form
covering exactly the gate's four items in order: the panes single-select
(Close the panes recommended first, Keep them for review second), the
trees multi-select with none pre-selected (the unmerged tree listed and
noted rather than omitted, matching "listed but noted, the guard will
refuse it"), the job-dirs yes/no, and a final proceed-or-hold question
carrying Hold as named in the gate text. Nothing follows the form. No
"Iterate here" option appears anywhere, matching the gate's design. No
options beyond what the gate text names.

Rationalization row: none needed. The fixture's two-sentence transition
("Ready to wrap up. A couple of things need your call before I close or
delete anything.") is the only prose between the required status/drift
content and the form; it is a transition, not a rationalization for
staying in prose, and the reply still ends in the form with nothing
after.
