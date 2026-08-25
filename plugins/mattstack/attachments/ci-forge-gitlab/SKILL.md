---
name: ci-forge-gitlab
description: "Forge adapter: GitLab implementation of ci-forge@1 for the watch-ci stage's forge slot. Reached only through a slot binding; not for direct invocation."
disable-model-invocation: true
metadata:
  provides: "ci-forge@1"
---

# ci-forge-gitlab

GitLab implementation of `ci-forge@1`: pipelines for a ref, whole-tree job
listing (recursive bridge walk covering nested/downstream pipelines), job
traces, job retries, and MR target-branch lookup.

## Entry point

```
${CLAUDE_SKILL_DIR}/scripts/ci-forge.sh <verb> [args]
```

Example, list every failed job across the whole pipeline tree for pipeline
4711:

```
${CLAUDE_SKILL_DIR}/scripts/ci-forge.sh jobs 4711 --scope failed
```

Full verb syntax, TSV row shapes, and the status vocabulary are normative in
`${CLAUDE_SKILL_DIR}/references/ci-forge-contract.md`; read that
doc before writing an invocation for any verb not shown above.

## Requirements

Authenticated `glab`, `jq`, and a working directory where
`glab api projects/:fullpath/...` resolves (inside the target GitLab
project's checkout).

## Exit codes

| exit code | meaning |
|---|---|
| `0` | the queried object exists and the answer is on stdout, including a legitimately empty answer |
| `1` | the queried object does not exist |
| `2` | usage error |
| `3` | forge CLI missing or unauthenticated |
