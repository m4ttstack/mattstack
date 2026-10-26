---
node: point_user_at_tab
---

# Point the user at the job's tab

The job's pane in `herd_status` has no `bg:` prefix: the herd is visible,
so the pane is already a tab in the herd's workspace and `herd_attend`,
which opens tabs only for a hidden herd's panes, would refuse. Tell the
user in one message which job, its pane ref and tab, and what waits on
them (the diagnosis reason, or the parked dialog).
