mattstack now installs its own updates. With the new org setting `mattstack.autoUpdate` on (the default), the app downloads and installs each new release without a prompt, waiting while setup runs or the daemon is busy, and dev Macs update themselves every hour. A daemon restart no longer fails agents' calls.

### Automatic updates

- the app installs a new release silently when `mattstack.autoUpdate` is on; it holds while setup runs or the daemon is busy and retries each minute, then reopens the windows that were open, without taking focus unless mattstack was in front (#1256)
- the app checks hourly, or every six hours with the setting off; the "Check for updates automatically" switch is gone, and a Mac that turned checking off has it switched back on (#1256)
- with the setting off, the update prompt returns and the status reads `orgOff`; an update that cannot install silently (one needing an admin password) still opens Sparkle's window (#1256)
- dev Macs: the daemon runs `rt dev update --auto` each hour, which checks the clone, the daemon and the pinned tools before it fast-forwards, installs, builds and swaps the app; a hold sends one notification per version and reason (#1256)
- the telemetry page names every hold and shows an org-off Mac as off (#1256)

### Daemon

- a daemon restart, from an app update or by hand, no longer fails agents' calls: the daemon answers "starting" and "stopping" while it boots and drains, and clients retry for up to 20 seconds without resending a request (#1255)
- `rt daemon restart` reports success once the new daemon serves, `rt daemon start` leaves a booting daemon alone, `rt agent` and `rt sync all` wait through a restart, and `rt state restore` refuses during one (#1255)

### Console

- the settings repo picker offers every registered repo, grouped by owner; a per-project row opens with no project picked, and the pick stays in the page's link (#1253)
- a slow settings read or team push no longer drops at Bun's 10 second idle timeout: the app server now allows 255 seconds (#1259, #1260)

### Endpoint

- rt merges its keys into a dev script's existing doppler `--preserve-env` list instead of skipping its own inject, and warns when it cannot find where to inject (#1254)

### Human Todos

- the Skip button is now **Dismiss**, and a dismissal no longer starts a turn: the agent hears about it with your next prompt (#1252)
- a second Send while a busy turn still holds the first one no longer sends the item twice (#1257)

### Skills

- the PR usher clears its context only at the end of a scheduled tick, so a chat message no longer swallows its next wakeup (#1250)
- the compact-before-plan rule compacts with `fresh_context`, falling back to the pane route when a chat message started the turn (#1251)

### Held pins

- bun stays at 1.4.4 (1.4.5 is out), cloudflared at 2026.11.1 (2026.11.2 is out), and Sparkle at 2.10.0 (2.10.1 is out): a Sparkle bump gets its own tested release.

### Known issues

- the silent install path first runs on the release after this one, once Macs are on v2.37.0; its live checks (a silent install with a window open behind another app, a busy hold during a provision, the org-off prompt, and the dev auto-update surviving a daemon restart) happen then

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.36.1...v2.37.0
