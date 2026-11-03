import type { StepId } from "./contract.ts";

export type StepPhase = { weight: number; paused: string };

/** Each apply step's share of the run and the title a pause names it by; the plan event carries them to the app. */
export const STEP_PHASES: Readonly<Record<StepId, StepPhase>> = {
  "home.init": { weight: 1, paused: "Couldn't set up your settings folder" },
  "home.restore": { weight: 2, paused: "Couldn't restore your settings" },
  "team.create": { weight: 1, paused: "Couldn't create your team" },
  "team.join": { weight: 1, paused: "Couldn't join your team" },
  "org.folder": { weight: 1, paused: "Couldn't get your team's settings" },
  "org.pull": { weight: 1, paused: "Couldn't get your team's settings" },
  "team.identity": { weight: 1, paused: "Couldn't get your team's settings" },
  "org.forge-access": { weight: 1, paused: "Couldn't get your team's settings" },
  "secrets.write": { weight: 1, paused: "Couldn't save your sign-ins" },
  "git.identity": { weight: 1, paused: "Couldn't set up git" },
  "path.link": { weight: 1, paused: "Couldn't set up rt" },
  "settings.seed": { weight: 1, paused: "Couldn't set up rt" },
  "intercepts.install": { weight: 1, paused: "Couldn't set up rt" },
  "repos.clone": { weight: 10, paused: "Couldn't clone your repos" },
  "services.register": { weight: 1, paused: "Couldn't start mattstack" },
  "proxy.install": { weight: 1, paused: "Couldn't set up fancy URLs" },
  "deck.managed": { weight: 2, paused: "Couldn't start your apps" },
  "skills.materialize": { weight: 2, paused: "Couldn't install skills" },
  "skills.link": { weight: 1, paused: "Couldn't install skills" },
  "board.keys": { weight: 1, paused: "Couldn't set up the board" },
  "board.cwds": { weight: 1, paused: "Couldn't set up the board" },
  "cron.triage": { weight: 1, paused: "Couldn't set up the board" },
  "plugins.install": { weight: 6, paused: "Couldn't install Claude plugins" },
  "linear.mcp": { weight: 1, paused: "Couldn't connect Linear" },
  "claude.permissions": { weight: 1, paused: "Couldn't set up Claude" },
  "fastbrowser.setup": { weight: 4, paused: "Couldn't set up Fast Browser" },
  "herdr.integration": { weight: 1, paused: "Couldn't set up herdr" },
  "extension.install": { weight: 2, paused: "Couldn't install editor extensions" },
  "services.start": { weight: 2, paused: "Couldn't start mattstack" },
  "board.restart": { weight: 1, paused: "Couldn't start the board" },
  "snapshot.push": { weight: 1, paused: "Couldn't save a snapshot" },
  verify: { weight: 2, paused: "Couldn't check everything" },
  "apps.restart": { weight: 1, paused: "Couldn't restart your apps" },
};

/** What the bar says while a step runs: never what the step is doing, which only a pause names. */
export const PHASE_WORDS: readonly string[] = [
  "Bloviating…", "Prognosticating…", "Vibing…", "Noodling…", "Percolating…", "Ruminating…", "Finagling…", "Schlepping…",
  "Moseying…", "Cogitating…", "Puttering…", "Spelunking…", "Wrangling…", "Tinkering…", "Discombobulating…", "Hornswoggling…",
  "Marinating…", "Doodling…", "Galumphing…", "Lollygagging…", "Shimmying…", "Bamboozling…", "Flummoxing…", "Canoodling…",
  "Pontificating…", "Dillydallying…", "Skedaddling…", "Gallivanting…", "Hobnobbing…", "Kibitzing…", "Mulling…", "Musing…",
  "Daydreaming…", "Woolgathering…", "Fiddling…", "Futzing…", "Jiggering…", "Rejiggering…", "Tootling…", "Sashaying…",
  "Waltzing…", "Boogieing…", "Jitterbugging…", "Moonwalking…", "Pirouetting…", "Cartwheeling…", "Somersaulting…", "Frolicking…",
  "Gamboling…", "Capering…", "Cavorting…", "Romping…", "Scampering…", "Skipping…", "Hopscotching…", "Tiptoeing…",
  "Meandering…", "Rambling…", "Wandering…", "Sauntering…", "Strolling…", "Ambling…", "Dawdling…", "Loitering…",
  "Pondering…", "Contemplating…", "Philosophizing…", "Theorizing…", "Hypothesizing…", "Speculating…", "Conjecturing…", "Divining…",
  "Auguring…", "Soothsaying…", "Stargazing…", "Crystal-balling…", "Tea-leafing…", "Brainstorming…", "Daisy-chaining…", "Untangling…",
  "Unspooling…", "Knitting…", "Crocheting…", "Whittling…", "Baking…", "Simmering…", "Steeping…", "Fermenting…",
  "Proofing…", "Kneading…", "Whisking…", "Sprinkling…", "Garnishing…", "Glazing…", "Caramelizing…", "Toasting…",
  "Brewing…", "Concocting…", "Alchemizing…", "Conjuring…", "Enchanting…", "Hocus-pocusing…", "Abracadabra-ing…", "Wizarding…",
  "Gesticulating…", "Harrumphing…", "Kerfuffling…", "Shenaniganing…", "Tomfoolering…", "Hullabalooing…", "Razzle-dazzling…", "Twiddling…",
];

/** One phase word per step for one run: random, and no word shows twice in a run until the pool runs out. */
export function drawPhaseWords(count: number, random: () => number = Math.random): string[] {
  const pool = [...PHASE_WORDS];
  const drawn: string[] = [];
  for (let i = 0; i < count; i++) {
    if (pool.length === 0) pool.push(...PHASE_WORDS.filter((w) => w !== drawn[drawn.length - 1]));
    const [word] = pool.splice(Math.floor(random() * pool.length), 1);
    drawn.push(word!);
  }
  return drawn;
}
