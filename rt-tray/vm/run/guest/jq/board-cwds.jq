# jq -r --argjson cwds <rt settings get board.cwds --json> --arg want <identity or ""> --arg home "$HOME" -f board-cwds.jq < <rt setup status --json>
# Install points all three of the board's folders at the placed checkout of
# the board's repo: the tracked repo `want` names, else the row that carries
# the board line. Prints one "ok<TAB>msg" or "bad<TAB>msg" line.
def ok($m): "ok\t" + $m;
def bad($m): "bad\t" + $m;
def expand: if type == "string" and startswith("~/") then $home + .[1:] elif . == "~" then $home else . end;

[.groups[]?.rows[]? | select(.id | startswith("repos.place:"))] as $repos
| ($cwds.value // {}) as $v
| if ($repos | length) == 0 then
    bad("board.cwds: the team tracks no repo, so nothing shows where the board starts")
  else
    (if $want != "" then [$repos[] | select(.action.identity == $want)] else [$repos[] | select(.action.board != null)] end | first) as $row
    | if $row == null then
        bad("board.cwds: no repos.place row for the board's repo \(if $want != "" then $want else "(none carries the board line)" end)")
      elif ($row.action.checkoutPath // null) == null then
        bad("board.cwds: \($row.action.identity) has no placed checkout")
      else
        ($row.action.checkoutPath | expand) as $placed
        | [$v.review, $v.respond, $v.doctor] | map(expand) as $got
        | if ($got | all(. == $placed)) then ok("board.cwds: review, respond and doctor start in \($placed), the placed \($row.action.identity)")
          else bad("board.cwds: wanted review, respond and doctor all at \($placed), got \($got | tojson)") end
      end
  end
