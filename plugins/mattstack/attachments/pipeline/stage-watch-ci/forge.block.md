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

`<scripts>` is `{{stage.dir}}/scripts/`. `<scripts>/ci-triage.sh` and
`<forge> jobs` name a fill's old script calls; the redirects above send
each to its tool.

{{props.forge}}
