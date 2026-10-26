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
