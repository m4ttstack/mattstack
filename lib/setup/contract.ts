export const CONTRACT_VERSION = 1 as const;

export type RowStatus = "ready" | "missing" | "invalid" | "needs-you" | "checking" | "skipped" | "error";
export type RowKind = "permission" | "tool" | "account" | "access" | "info";
export type Recheck = "on-activate" | "on-change" | "manual";
export type GroupId = "mac" | "accounts" | "access" | "tools" | "agents" | "browser" | "repos" | "rt" | "team";
/** Where a tracked repo goes: an existing checkout, or a new clone. */
export type PlacementMode = "checkout" | "clone";
export type Integration = "github" | "gitlab" | "linear" | "slack" | "sdm" | "doppler" | "ldcli";

export interface ConnectField {
  name: string;
  label: string;
  secret: boolean;
  hint?: string;
  /** What the app prefills; the user can still edit it before submitting. */
  value?: string;
}

export interface ChooseOption {
  id: string;
  label: string;
  detail: string;
  sample?: string;
}

export type Action =
  | { type: "open-settings"; label: string; target: "fda" | "login-items" | "notifications" | "keyboard" }
  | { type: "request-permission"; label: string; which: "notifications" }
  // `create` is the service's own new-credential page with rt's needs prefilled; the app opens it in the browser and keeps the sheet up for the paste.
  // `verb`, when set, is what the app runs in place of `setup <integration> connect`: a create's own `--host`, never a team's declared one.
  // The app takes it only when it starts with `setup <integration> connect`.
  | { type: "connect"; label: string; integration: Integration; fields: ConnectField[]; alternatives?: { id: string; label: string }[]; create?: { label: string; url: string }; verb?: string[] }
  | { type: "oauth"; label: string; integration: Integration; verb: string[] }
  | { type: "owner-once"; label: string; integration: Integration; fields: ConnectField[] }
  | { type: "install"; label: string; tool: string; via: "brew" | "vendor" | "apple-clt" | "bundled-link" }
  | { type: "link-bundled"; label: string; tool: string }
  | { type: "steps"; label: string; steps: string[] }
  // `waiting` is the line the app shows once the page is open, until the row reads ready; `again`
  // labels the button that opens it again meanwhile. `primary` draws it as the row's prominent button.
  | { type: "open-url"; label: string; url: string; waiting?: string; again?: string; primary?: boolean }
  | { type: "run"; label: string; verb: string[] }
  // Collects `fields` in the app, then runs `verb --json` with the values as JSON on stdin; an
  // alternative runs the same verb with {"alternative": "<id>"} instead. `connect` without an integration.
  | { type: "form"; label: string; verb: string[]; fields: ConnectField[]; alternatives?: { id: string; label: string }[] }
  // startAt is where the panel opens, never a value rt writes.
  | { type: "choose-folder"; label: string; startAt: string | null }
  // The app answers through `rt setup repo place`, then runs `then` when set, the way it runs a `run`
  // action's verb (appending --json). `segmentRecords`: whether switching the segment alone records the
  // shown path; `oneClick` records `path` under `mode` in one press. `label` is the recorded segment's
  // button; `labels` names every segment's, so an app showing the other segment never words one itself.
  | {
      type: "place-repo";
      label: string;
      labels: PlaceRepoLabels;
      identity: string;
      repo: string;
      mode: PlacementMode;
      checkoutPath: string | null;
      clonePath: string;
      note: string;
      problem: string | null;
      then: string[] | null;
      oneClick: { label: string; mode: PlacementMode; path: string } | null;
      segmentRecords: boolean;
      // The board's repo only: the line saying the board's agents start there.
      board: string | null;
      // The member's answer is recorded and only a run is left to land it.
      awaitsRun: boolean;
    }
  // The app appends the picked id and --json to verb; "other" collects a free-text id for the same verb.
  // other.suggestions is the app's only source of completions for a typed id; it never scans the filesystem.
  | {
      type: "choose";
      label: string;
      verb: string[];
      subtitle?: string;
      footnote?: string;
      options: ChooseOption[];
      selected?: string;
      other?: { label: string; hint: string; suggestions?: string[] };
    };

export interface PlaceRepoLabels {
  checkout: string;
  /** The checkout button once rt or the app has refused that checkout. */
  checkoutAgain: string;
  clone: string;
}

export interface Row {
  id: string;
  kind: RowKind;
  title: string;
  why: string;
  required: boolean;
  optionalNote: string | null;
  status: RowStatus;
  detail: string;
  action: Action | null;
  recheck: Recheck;
  /** Blocks the wizard's Finish (never Install) until ready, skipped, or waived on this Mac. */
  finishGated?: boolean;
  /** Set on a finish-gated row the user skipped on this Mac; the app's Un-skip affordance keys on this, never on the note's wording. */
  waived?: boolean;
  /** Emitted on every finish-gated row: whether Skip for now is offered. An app reading a row without it treats a finish-gated row as waivable. */
  waivable?: boolean;
  /** Shown under "No action needed" whatever its state: never required and never finish-gated. */
  information?: true;
  /** Plan mode only: nothing on this row is the member's to do until Install has run. Never emitted by `setup status`. */
  waitsForInstall?: true;
}

export interface Group {
  id: GroupId;
  title: string;
  rows: Row[];
}

export type TeamMode = "join" | "create" | "restore" | "none";

export interface OrgRef {
  slug: string;
  name: string;
  mode: TeamMode;
}

/** No team known: the derived solo state every validator branches on. */
export function isSolo(team: Pick<OrgRef, "slug" | "mode">): boolean {
  return team.mode === "none" && team.slug === "";
}

export interface Plan {
  contract: 1;
  at: string;
  team: OrgRef;
  groups: Group[];
  canInstall: boolean;
  requiredMissing: string[];
  finishBlockedBy: string[];
}

export const GROUP_TITLES: Record<GroupId, string> = {
  mac: "Your Mac",
  accounts: "Accounts",
  access: "Access",
  tools: "Tools",
  agents: "Agents and editors",
  browser: "Browser",
  repos: "Your repos",
  rt: "rt on this Mac",
  team: "Team and backup",
};

/** The rows `rt setup waive` may skip; a stored waiver is honored only for these. */
export const WAIVABLE_ROW_IDS: readonly string[] = ["skills.overrides", "tool.chrome-signin", "tool.mission-control"];

/** The rows that gate Finish by id rather than by their `ROW_TARGETS` entry. `rt setup unwaive` refuses an id outside these, the account ids, the repos.place rows and the waivable ids. */
export const FINISH_GATED_ROW_IDS: readonly string[] = ["tool.fast-browser-extension"];

/** One `repos.place:<identity>` row per tracked repo, so those ids cannot be enumerated above. */
export const REPO_PLACE_ROW_PREFIX = "repos.place:";

/** Account rows the team's own settings declare, so a joiner's pre-Install plan cannot list them yet; `gateTeamAccounts` in finish-gate.ts. */
export const FINISH_GATED_ACCOUNT_IDS: readonly string[] = ["account.slack", "account.linear"];

export function isFinishGatedRowId(id: string): boolean {
  return FINISH_GATED_ROW_IDS.includes(id) || FINISH_GATED_ACCOUNT_IDS.includes(id) || id.startsWith(REPO_PLACE_ROW_PREFIX);
}

export type StepKind = "rt" | "app" | "privileged";
/**
 * `needs-you`: the step ran and did its part, but something is left that only the member can do; the run carries on.
 * `partial`: the step finished and the run goes on, but some of its work did not land (the detail names what).
 */
export type StepState = "pending" | "running" | "done" | "partial" | "failed" | "skipped" | "needs-you";

export const STEP_IDS = [
  "home.init",
  "home.restore",
  "team.create",
  "team.join",
  "org.folder",
  "org.pull",
  "team.identity",
  "org.forge-access",
  "secrets.write",
  "git.identity",
  "path.link",
  "settings.seed",
  "repos.clone",
  "services.register",
  "proxy.install",
  "deck.managed",
  "skills.materialize",
  "skills.link",
  "board.keys",
  "board.cwds",
  "cron.triage",
  "intercepts.install",
  "plugins.install",
  "linear.mcp",
  "claude.permissions",
  "fastbrowser.setup",
  "herdr.integration",
  "extension.install",
  "services.start",
  "board.restart",
  "snapshot.push",
  "verify",
] as const;
export type StepId = (typeof STEP_IDS)[number];

export type NeedRequest =
  | { type: "app-register-services"; plists: string[] }
  | { type: "app-unregister-services"; plists: string[] }
  | { type: "app-privileged"; op: "proxy-install" | "proxy-remove" | "proxy-trust" | "homebrew"; homebrew?: true };

/** Uninstall streams the same event shapes with these ids (contract §uninstall: "NDJSON like apply"). */
export type UninstallActionId = "services.unregister" | "deck.managed-remove" | "proxy.remove" | "path.unlink" | "shell.remove" | "extension.uninstall" | "plugins.uninstall" | "cron.uninstall" | "data" | "app.trash";

/** A one-time migration on the update stream; the tail is the migration's own id. */
export type MigrationEventId = `migration.${string}`;

export type EventId = StepId | UninstallActionId | MigrationEventId;

export type ApplyEvent =
  | { event: "plan"; steps: { id: EventId; title: string; kind: StepKind; phase?: string; weight?: number; paused?: string }[] }
  | { event: "step"; id: EventId; state: StepState; detail?: string; remedy?: string }
  | { event: "log"; id: EventId; line: string }
  | { event: "progress"; id: EventId; label: string; percent: number; note?: string }
  | { event: "need"; id: EventId; request: NeedRequest }
  | { event: "done"; ok: boolean; failedStep?: EventId; failedSteps?: EventId[]; skipped?: "not-set-up" | "current" | "running" };

export function envelope<T extends object>(body: T, now: Date = new Date()): T & { contract: 1; at: string } {
  return { contract: CONTRACT_VERSION, at: now.toISOString(), ...body };
}

/** A row button that runs one apply step; the app answers any `need` the step emits (rt-tray RowVerbRun). */
export function applyStepAction(label: string, step: StepId): Action {
  return { type: "run", label, verb: ["setup", "apply", "--only", step] };
}

export function row(r: Omit<Row, "optionalNote" | "action" | "recheck"> & Partial<Pick<Row, "optionalNote" | "action" | "recheck">>): Row {
  return { optionalNote: null, action: null, recheck: "on-change", ...r };
}

/** A finish-gated row that is neither ready nor skipped, and not waived on this Mac, blocks Finish. `skipped` means there is nothing to load into, or another row already reports the fault. A stored waiver is honored only for a waivable id. */
export function finishBlockers(groups: Group[], waived: readonly string[] = []): string[] {
  const honored = waived.filter((id) => WAIVABLE_ROW_IDS.includes(id));
  return groups.flatMap((g) =>
    g.rows.filter((r) => r.finishGated === true && r.status !== "ready" && r.status !== "skipped" && !honored.includes(r.id)).map((r) => r.id),
  );
}

/**
 * Install enables only when every required row is ready; requiredMissing lists the others in group order. A finish-gated row is Finish's
 * concern whatever its `required` reads, so it never lands here, except a gated account row: Install steps such as `linear.mcp` read it.
 */
export function finalizePlan(team: OrgRef, groups: Group[], now: Date = new Date(), waived: readonly string[] = []): Plan {
  const blocksInstall = (r: Row) => r.required && r.status !== "ready" && (!r.finishGated || FINISH_GATED_ACCOUNT_IDS.includes(r.id));
  const requiredMissing = groups.flatMap((g) => g.rows.filter(blocksInstall).map((r) => r.id));
  return envelope({ team, groups, canInstall: requiredMissing.length === 0, requiredMissing, finishBlockedBy: finishBlockers(groups, waived) }, now);
}
