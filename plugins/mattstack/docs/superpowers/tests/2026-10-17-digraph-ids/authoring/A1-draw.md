# A1: draw a new graph

Tests whether an agent with the process-digraphs skill writes a fresh graph
in the short-id form. The prompt is everything below the line.

---

Here is a process for a skill called hotfix-push.

It starts when the fast tests go green. The agent pushes the tree with the
call `git_push {tree, setUpstream: true}`. The push can be refused. If it was
not refused, the agent opens the MR with
`mr_create {repoName, sourceBranch, targetBranch, title, description}`, and
the process ends with the MR open. If the push was refused, the agent checks
the attempt counter: on the first refusal it switches to the repo root that
git_push printed and pushes again; once two attempts have been refused, the
process ends with the refusal reported to the caller. When a push is refused
the agent may be tempted to push from the shell instead; that is forbidden,
and the agent must go back to git_push.

Write the dot block for this process, following the skill. Output only the
fenced block.
