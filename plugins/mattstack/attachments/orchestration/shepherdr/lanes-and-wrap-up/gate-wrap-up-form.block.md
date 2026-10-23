---
node: gate_wrap_up_form
kind: gate
---

# Gate wrap-up: the form contract

One form, per the wrap-up form contract below:

- **Close the panes** (recommended when every job is done) / **Keep them for review**.
- A multi-select of the trees to dispose, none pre-selected. An rt-provisioned tree with unmerged work is listed but noted: the guard will refuse it.
- **Delete the job dirs** (yes / no).
- **Archive the room** (yes / no).
- **Hold**.

Never auto-remove a tree or job dir; `herd_wrap_up` executes exactly the
form's answer.
