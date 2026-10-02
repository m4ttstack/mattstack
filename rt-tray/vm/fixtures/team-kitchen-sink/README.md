# team-kitchen-sink

Everything the team scope can declare without a second live service: two
tracked private repos, two team-authored plugins plus one team-chosen plugin
from a public marketplace (`claude.marketplaces` + `claude.plugins`, team
scope: installed on the joiner, never auto-enabled), three secrets across
two domains, a team-scope board title, and a declared Slack app.

`mattstack.integrations.slack` is fake (`A0VMTESTFAKE` and an obviously
invalid client id) ... it exists only so `declaredIntegrations()`
(`lib/setup/validators/accounts.ts`) requires `account.slack`, the same as a
real team declares. This is deliberate: a real team's fixture must declare
what a real team declares, or H1 (`assert-team.sh`'s `requiredMissing`
check) has nothing to catch. **Running this fixture will make H1 FAIL until
the joiner has a working way to satisfy that row**, since there is no fake
credential that reads as `ready` for Slack today. That failure is this
fixture doing its job: it is the gap an audit found, made visible instead of invisible.

Not here yet, each needing an input the harness does not hold: a Linear key
for `mattstack.integrations.tracking`, per-repo `rt.roles`/`rt.intercepts`
(needs the owner to have the repo cloned and indexed first), and the team
pack (served from outside mattstack-marketplace).
