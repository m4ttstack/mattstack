---
node: mr_create
label: Create MR
props:
  rules:
    merge: add
    default: ""
---

# mr_create {repoName: <root>, sourceBranch, targetBranch: <resolved target>, title, description, draft, squash?, labels?, ifExists: return}

{{props.rules}}

`squash` is GitLab only: GitHub refuses it, so on GitHub leave it out and
`squashApplied` never comes back `false`.
