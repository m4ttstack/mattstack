---
name: acme-evidence
description: "Evidence rules for the acme-queue app: what to show for a change and how to attach it. Loaded by the evidence stage; not for direct invocation."
disable-model-invocation: true
metadata:
  provides: evidence-domain@1
---

# acme-queue evidence

acme-queue is a job queue web app. A change that shows in the browser is
proved with a screenshot of the job page, taken before the change and again
after it.

At: Gate evidence

Ask which job id shows the change. Offer the case ids from the plan.

At: Gate evidence-attach

When the MR is open, attach the BEFORE now. Otherwise hand it back to ship.
Annotate the screenshot with one short note per changed value.

At: Capture the BEFORE

Run the dev server, open the job page, and take a screenshot of the job row.
Save it in the evidence folder as `<case>-preview.png`.

## Browser target

### Reach the view

- Servers: `bun run dev` in the worktree; the app answers on `http://localhost:5173`.
- Sign in: the saved login for `http://localhost:5173`. With none, ask the developer.
- URL: `http://localhost:5173/jobs/<job id>`; the job's detail panel opens with `?panel=details`.
- State: retry the job once with the Retry button and wait for the badge to update.

### What proves a change

| Kind of change | View | Elements |
|---|---|---|
| a job badge or counter | the job page | the badge and the job row's header |
| an export | the export dialog | the totals row and the Export button |

Intake: which job id shows the change.

### Captions

Use the page's own field names ("Retries", "Owner"), never internal ids.

### Personal data

Always hidden: the owner's email and phone. May show: job ids and the test owner "Dev Tester".
