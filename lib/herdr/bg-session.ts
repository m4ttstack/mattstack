/** herdr session name of the daemon-owned background server. Lives apart from
    lib/daemon/bg-service.ts so the CLI can read it without the daemon's imports. */
export const BG_SESSION = "mattstack-bg";
