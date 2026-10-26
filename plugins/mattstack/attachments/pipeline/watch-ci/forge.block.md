---
order: 7
props:
  forge:
    merge: replace
    default: ""
    contract: "ci-forge@1"
---

# Forge

If a rule below asks for a move this graph marks STOP, take the off-script edge instead.

`<scripts>/ci-triage.sh` is `${CLAUDE_SKILL_DIR}/scripts/ci-triage.sh`. It and
`<forge> jobs` name a fill's old script calls; the redirects above send
each to its tool. Where no rule and no forge names a move, the graph's
unbound flows apply.

{{props.forge}}
