import type { StepId } from "./contract.ts";

export type StepPhase = { phase: string; weight: number; paused: string };

/** The one progress bar's words and share of the run for each apply step; the plan event carries them to the app. */
export const STEP_PHASES: Readonly<Record<StepId, StepPhase>> = {
  "home.init": { phase: "Setting up your settings folder", weight: 1, paused: "Couldn't set up your settings folder" },
  "home.restore": { phase: "Restoring your settings", weight: 2, paused: "Couldn't restore your settings" },
  "team.create": { phase: "Creating your team", weight: 1, paused: "Couldn't create your team" },
  "team.join": { phase: "Joining your team", weight: 1, paused: "Couldn't join your team" },
  "org.folder": { phase: "Getting your team's settings", weight: 1, paused: "Couldn't get your team's settings" },
  "org.pull": { phase: "Getting your team's settings", weight: 1, paused: "Couldn't get your team's settings" },
  "team.identity": { phase: "Getting your team's settings", weight: 1, paused: "Couldn't get your team's settings" },
  "org.forge-access": { phase: "Getting your team's settings", weight: 1, paused: "Couldn't get your team's settings" },
  "secrets.write": { phase: "Saving your sign-ins", weight: 1, paused: "Couldn't save your sign-ins" },
  "git.identity": { phase: "Setting up git", weight: 1, paused: "Couldn't set up git" },
  "path.link": { phase: "Setting up rt", weight: 1, paused: "Couldn't set up rt" },
  "settings.seed": { phase: "Setting up rt", weight: 1, paused: "Couldn't set up rt" },
  "intercepts.install": { phase: "Setting up rt", weight: 1, paused: "Couldn't set up rt" },
  "repos.clone": { phase: "Cloning your repos", weight: 10, paused: "Couldn't clone your repos" },
  "services.register": { phase: "Starting mattstack", weight: 1, paused: "Couldn't start mattstack" },
  "proxy.install": { phase: "Setting up fancy URLs", weight: 1, paused: "Couldn't set up fancy URLs" },
  "deck.managed": { phase: "Starting your apps", weight: 2, paused: "Couldn't start your apps" },
  "skills.materialize": { phase: "Installing skills", weight: 2, paused: "Couldn't install skills" },
  "skills.link": { phase: "Installing skills", weight: 1, paused: "Couldn't install skills" },
  "board.keys": { phase: "Setting up the board", weight: 1, paused: "Couldn't set up the board" },
  "board.cwds": { phase: "Setting up the board", weight: 1, paused: "Couldn't set up the board" },
  "cron.triage": { phase: "Setting up the board", weight: 1, paused: "Couldn't set up the board" },
  "plugins.install": { phase: "Installing Claude plugins", weight: 6, paused: "Couldn't install Claude plugins" },
  "linear.mcp": { phase: "Connecting Linear", weight: 1, paused: "Couldn't connect Linear" },
  "claude.permissions": { phase: "Setting up Claude", weight: 1, paused: "Couldn't set up Claude" },
  "fastbrowser.setup": { phase: "Setting up Fast Browser", weight: 4, paused: "Couldn't set up Fast Browser" },
  "herdr.integration": { phase: "Setting up herdr", weight: 1, paused: "Couldn't set up herdr" },
  "extension.install": { phase: "Installing editor extensions", weight: 2, paused: "Couldn't install editor extensions" },
  "services.start": { phase: "Starting mattstack", weight: 2, paused: "Couldn't start mattstack" },
  "board.restart": { phase: "Starting the board", weight: 1, paused: "Couldn't start the board" },
  "snapshot.push": { phase: "Saving a snapshot", weight: 1, paused: "Couldn't save a snapshot" },
  verify: { phase: "Checking everything", weight: 2, paused: "Couldn't check everything" },
};
