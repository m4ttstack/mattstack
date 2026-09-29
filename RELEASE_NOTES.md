Browser runs can sign in to your local dev sites with a saved dev login, the console renders gate context as Markdown, and board's doctors can finally prove a branch has no stacked children.

### Dev logins (RT-329)

- save one email and password per dev site in Settings > Dev logins, or with `rt logins add <origin>`; passwords are never shown again, and a new site's host must be typed before Save enables (#569)
- `rt logins list`, `rt logins remove` and `rt logins open-add` manage them; `rt logins add` reads values from hidden prompts or `--json` stdin, never argv, echoes an asterisk per password keystroke, and asks for the email in plain text (#569)
- Fast Browser fills a saved login on that site's login page through the rt daemon, so a browser run gets past a local login without a human step; the value never reaches the transcript, and fills are limited to one per login every 5 minutes and 5 a day (#569, #571)
- origins must be https, or http on localhost; `mattstack://dev-logins/add?origin=...` opens the add sheet (#569)
- a saved site's row in Settings > Dev logins reads Edit, and the pane says it can be edited or deleted there (#570)

### Board and gates

- board doctors check for stacked children with a live, unscoped read of the open MRs targeting a branch, so an auto-dispatched doctor no longer dead-ends on that check (RT-363, #566)
- answering a review gate from board now dismisses the pane's question form even when herdr's status for the pane has gone stale (#568)
- the console renders gate context as Markdown, and the gate protocol asks agents to write prose context that also reads fine unrendered (#563)

### Herds

- shepherdr's `resume` strategy splits into `from-spec` and `from-plan`, and job form labels drop the fixed half (#564)
- `herd-progress` reads progress for every shepherdr method, pipeline runs included, instead of only SDD ledgers (#565)

### Release and build

- the dev app's rebuild and every relaunch (the restart handoff, `rt release update-machine`, `rt-tray/build.sh` install) run with a clean environment, so a dev app first opened from a shell no longer fails its rebuilds (#570)
- the clean-room walkthrough fails a dropped ssh session or an overlong phase with a named reason instead of hanging, and teardown always removes the guest and the throwaway team repo (RT-362, #567)

### Bundled

- fast-browser 0.1.8 with runtime 0.1.2: the saved-login fill, the secrets channel, and redaction of every encoded form of a secret; the catalog's fast-browser plugin moves to match (#571)

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.16.0...v2.17.0
