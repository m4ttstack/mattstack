# jq -r -f join-rows.jq < <rt setup status --json>
# The rows a joined machine has after Install. Prints one "ok<TAB>msg" or
# "bad<TAB>msg" line per assertion.
def ok($m): "ok\t" + $m;
def bad($m): "bad\t" + $m;

[.groups[]?.rows[]?] as $rows
| def row($id): [$rows[] | select(.id == $id)] | first;
  def ready($id; $what):
    row($id) as $r
    | if $r == null then bad("\($id): no row (\($what))")
      elif $r.status == "ready" then ok("\($id): ready (\($r.detail))")
      else bad("\($id): \($r.status), wanted ready (\($what)): \($r.detail)") end;
  # A repo the joiner cannot clone yet is a partial, not a failure, as long as
  # the row says why and, unless it was skipped, offers the next step.
  def clear_partial($r):
    ($r.detail // "" | length) > 0
    and $r.status != "checking"
    and ($r.status == "skipped" or $r.action != null);

  if ($rows | length) == 0 then
    bad("rt setup status --json carried no rows")
  else
    ready("tool.plugins"; "team plugins installed"),
    ready("access.team-repo"; "the joined team repo is reachable"),
    (row("team.marketplace") as $m
     | if $m == null then ok("team.marketplace: no row (the team declares no marketplace)")
       elif $m.status == "ready" then ok("team.marketplace: ready (\($m.detail))")
       else bad("team.marketplace: \($m.status), wanted ready: \($m.detail)") end),
    ([$rows[] | select(.id | startswith("access.repo."))] as $repos
     | if ($repos | length) == 0 then ok("access.repo.*: the team tracks no repos")
       else
         $repos[]
         | if .status == "ready" then ok("\(.id): ready")
           elif clear_partial(.) then ok("\(.id): partial, \(.status): \(.detail)")
           else bad("\(.id): \(.status) with no clear next step: \(.detail | tojson)") end
       end)
  end
