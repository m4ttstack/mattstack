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

`<scripts>/ci-triage.sh` is `{{stage.dir}}/scripts/ci-triage.sh`. It and
`<forge> jobs` name a fill's old script calls; the redirects above send
each to its tool.

{{props.forge}}
