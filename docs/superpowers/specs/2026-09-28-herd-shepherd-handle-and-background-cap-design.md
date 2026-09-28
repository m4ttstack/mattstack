# Herd briefs name the shepherd; the background-work exemption expires

Tickets: RT-356, RT-359. Two small, independent herd fixes shipped in one PR.

## RT-356: every brief names the shepherd's chat handle

### Problem

A worker's brief says "reply to the shepherd" but never names the shepherd in
chat. Workers guess the bare handle `shepherd`, and when another session holds
it their reports go to the wrong session.

### Decision (shepherd gate 72397f4c)

Spawn fills the handle, not `rt herd brief`. The herd row is the one source of
truth for who the shepherd is, and it is read at every launch, so a respawn
after `herd_resume` names the new shepherd. No `lib/mcp` change is needed.

Shepherd gate 42b3a594 added the id: a shepherd `herd_start` signs in is
displayed as `shepherd`, so a DM by name reaches whoever holds that name now.
The brief names the shepherd by display name and tells the worker to DM its id.

### Design

- **Template.** `job-template.md`'s `## Messages` section gains prose, outside
  any backtick or quote span, that names two slots: the shepherd is
  `<shepherd handle>` in chat (id `<shepherd id>`), and anything sent to the
  shepherd outside a gate, milestone or report goes by `chat_dm` to
  `<shepherd id>`, never to a handle guessed from the role. The compiled copy under
  `plugins/mattstack/skills/shepherdr/` is regenerated from it.
- **Brief assembly** (`lib/herd-brief.ts`). A spawn-filled slot set,
  exported as `SPAWN_FILLED_SLOTS = ["shepherd handle", "shepherd id"]`. `substituteMarkers`
  never records these as leftovers, so `rt herd brief` and the `herd_brief`
  tool succeed and pass the marker through verbatim. An explicit
  `--fill "shepherd handle=<x>"` (or `shepherd id`) still fills it (fills
  win; spawn then finds nothing to replace).
- **Spawn fill** (`lib/herd-brief.ts`, `fillSpawnSlots(brief, values)`). Replaces
  every spawn-filled marker (inner whitespace may wrap across lines,
  matching `normalizeMarkerName`) with the value. A brief with no marker is
  returned unchanged.
- **Spawn** (`lib/daemon/handlers/herd.ts`, `herd:spawn`). After the brief is
  resolved (passed or stored), the prompt handed to `agent:start` is
  `fillSpawnSlots(brief, { "shepherd handle": name, "shepherd id":
  herd.shepherdHandle })`, where `name` is
  `deps.identityNames([herd.shepherdHandle]).get(herd.shepherdHandle) ??
  herd.shepherdHandle`, the same display-name resolution `herd:status` uses.
  The stored `job.md` keeps both markers, so the next respawn refills from
  the then-current herd row.

### Acceptance

- A brief spawned in a herd whose shepherd is `shepherd.k3f9` (displayed
  `shepherd`) names `shepherd` and tells the worker to DM `shepherd.k3f9`
  (handler test with a fake `identityNames`).
- Assembling the real template: neither slot is a leftover, and no line tells
  the worker to DM the bare word `shepherd`.
- A respawn with no `--brief` reuses the stored brief and fills the current
  shepherd name.

## RT-359: the background-work exemption expires

### Problem

Since RT-355 a job pane showing a background shell, monitor or subagent counts
as working, with no limit. A stray shell silences the done nag and the backstop
for as long as it runs.

### Decision (shepherd gate 72397f4c)

A fixed `backgroundCapMins: 60` in the watchdog's default config. No new
setting: `readWatchdogConfig` returns the default for it.

### Design

- **Sensor** (`WatchdogSensors.backgroundWork`) returns
  `{ task: string; sinceMs: number } | null` instead of a boolean.
- **Adapter.** `hasBackgroundWork(screen)` becomes
  `backgroundTask(screen): string | null`, same detection rules, returning the
  task's own text: the footer segment carrying the count (`1 shell, 1 monitor`)
  or, for the agents panel, `subagent` plus the first running row with its
  glyph removed. The sensor keeps a `pane -> { task, since }` map: a pane first
  seen busy is stamped with the sweep time, a pane still busy keeps its stamp,
  and a pane not busy on a sweep (working, gone, or background cleared) drops
  it. A turn the pane works therefore restarts the clock.
- **Evaluator.** One helper decides the exemption. The work's age runs from
  the later of the sensor's stamp and the pane's last idle transition, so a
  turn that ended between two sweeps still restarts the clock. Background
  work younger than `backgroundCapMins` exempts the pane exactly as today; older work does
  not, and the nag and both backstop evidences gain
  `; background <task> for <N>m`. The fast paths (unread DMs, unconsumed
  answers) are unchanged.

### Acceptance

- Background work younger than the cap: no nag, no backstop (current tests
  keep passing with a fresh `sinceMs`).
- Older than the cap: the done nag, the job backstop and the shepherd backstop
  fire, and each evidence names the task.
- The adapter stamps, keeps and drops the clock across sweeps (fake herdr).

## Out of scope

- The shepherdr `SKILL.md` prose about fills (outside the write fence); the
  brief refusal still lists only real leftovers, so its instructions stay true.
- A settings key for the cap.
- Plugin version: `plugins/mattstack/.claude-plugin/plugin.json` patch bump and
  regenerated `apps/board/skills` ride the same PR.
