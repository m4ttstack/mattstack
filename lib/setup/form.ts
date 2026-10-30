/**
 * The fast-setup form: every question setup still needs a person to answer,
 * grouped the way the app's screens draw them. rt decides each row's state and
 * action; the app only lays them out. `composeForm` never composes the full
 * plan, so the screen can re-read it every few seconds.
 */
import { applyStepAction, type Action, type Row } from "./contract.ts";
import { fancyUrlsState, type FancyUrls } from "./fancy-urls.ts";
import { fetchPermissions, permissionRows, type PermissionsReply } from "./permissions.ts";
import type { Probes } from "./probes.ts";
import type { SecretPresence } from "./validators/accounts.ts";

export type FormSection = "macos" | "invite" | "connect" | "this-mac";
export const FORM_SECTIONS: readonly FormSection[] = ["macos", "invite", "connect", "this-mac"];

export type FormRowState = "done" | "todo" | "busy" | "waiting";

export interface FormRow {
  id: string;
  title: string;
  subtext: string;
  state: FormRowState;
  detail: string;
  action: Action | null;
  /** The line the app shows while this row's action runs. */
  waiting: string | null;
  /** Re-read the form unprompted while this row is waiting or busy: its answer lands outside the app. */
  watch: boolean;
  /** Never holds Continue. */
  optional: boolean;
}

export type FormStage = "macos" | "path" | "invite" | "waiting" | "connect" | "this-mac" | "running" | "paused" | "ready";
export type FormPath = "join" | "create" | "solo" | "restore";

export interface FormPaused {
  step: string;
  title: string;
  detail: string;
  remedy: string | null;
}

export interface SetupForm {
  path: FormPath | null;
  team: { slug: string; name: string; invitedBy: string | null } | null;
  stage: FormStage | null;
  sections: { macos?: FormRow[]; invite?: FormRow[]; connect?: FormRow[]; thisMac?: FormRow[] };
  continueReady: boolean;
  startReady: boolean;
  paused: FormPaused | null;
  home: { label: string; url: string };
}

type Forge = "github" | "gitlab";

function reviews(forge: Forge): string {
  return forge === "gitlab" ? "MRs" : "PRs";
}

export const FORM_COPY = {
  installing: "Installing…",
  macos: {
    title: "Three things from macOS",
    fda: { title: "Full Disk Access", subtext: "Reads your repos and Chrome's profile" },
    notifications: { title: "Notifications", subtext: "Tells you when setup is done" },
    fancyUrls: { title: "Fancy URLs", subtext: "Grant mattstack apps permission to use .mattstack" },
    openSettings: "Open settings",
    allow: "Allow",
    adminWaiting: "Waiting for your admin password in the macOS dialog…",
    granted: "Granted",
    allowed: "Allowed",
    turnedOff: "Turned off",
    notAsked: "Not asked yet",
    notGranted: "Not granted",
    trayDown: "Not checked: mattstack.app is not running",
  },
  invite: {
    title: "Paste your invite",
    invitedBy: (team: string, admin: string) => `${team}, invited by ${admin}`,
    createToken: "Create token",
    tokenSubtext: (forge: Forge) => `Lets mattstack reach the team's repo and open ${reviews(forge)}`,
    join: "Join",
  },
  connect: {
    title: "You're in. Connect your accounts",
    subtitle: "One click each. Most open in your browser",
    connectedFromInvite: (login: string) => `Connected as ${login} from your invite`,
    slack: { label: "Connect Slack", subtext: (forge: Forge) => `Lets mattstack track and post ${reviews(forge)} in Slack` },
    claude: { label: "Sign in to Claude", subtext: "You know, to do agentic stuff." },
    teamTool: { label: "Sign in", subtext: "For running your dev servers" },
    linear: { label: "Create token", subtext: "So mattstack can read and write Linear tickets" },
    fastBrowser: { label: "Add to Chrome", subtext: "Lets agents drive your real Chrome", waiting: "Waiting for Chrome…", done: "Added", getChrome: "Get Chrome" },
    footer: "Continue unlocks once each one is connected",
    continue: "Continue",
  },
  thisMac: {
    title: "Last bit: this Mac",
    subtitle: (team: string) => `Where ${team}'s repos and your settings live`,
    repos: { title: "Your repos", current: "Current checkout", locate: "Locate…", fresh: "New checkout", choose: "Choose…", board: "The board starts here" },
    settings: {
      title: "Your settings",
      local: "Keep on this Mac",
      remote: "Store in a remote repo",
      subtext: "mattstack keeps your settings in one folder. A private remote copy lets you restore them on a new Mac. You can turn this on later",
    },
    footer: "About 10 minutes once you start",
    start: "Set up this Mac",
  },
} as const;

const HOME_APP = { label: "Open the board", url: "https://board.mattstack" };

type NotificationStatus = PermissionsReply["notifications"]["status"];

function fdaRow(permissions: Row[]): FormRow {
  const c = FORM_COPY.macos;
  const fda = permissions.find((r) => r.id === "perm.fda");
  const done = fda?.status === "ready";
  return {
    id: "perm.fda",
    ...c.fda,
    state: done ? "done" : "todo",
    detail: done ? c.granted : (fda?.detail ?? c.notGranted),
    action: done ? null : { type: "open-settings", label: c.openSettings, target: "fda" },
    waiting: null,
    watch: true,
    optional: false,
  };
}

function notificationsRow(status: NotificationStatus | null): FormRow {
  const c = FORM_COPY.macos;
  const base = { id: "perm.notifications", ...c.notifications, waiting: null, watch: false, optional: false };
  switch (status) {
    case "authorized":
    case "provisional":
      return { ...base, state: "done", detail: c.allowed, action: null };
    case "denied":
      return { ...base, state: "done", detail: c.turnedOff, action: { type: "open-settings", label: c.openSettings, target: "notifications" } };
    default:
      return {
        ...base,
        state: "todo",
        detail: status === null ? c.trayDown : c.notAsked,
        action: { type: "request-permission", label: c.allow, which: "notifications" },
      };
  }
}

function fancyUrlsRow(f: FancyUrls): FormRow {
  const c = FORM_COPY.macos;
  const done = f.state === "done";
  return {
    id: "mac.fancy-urls",
    ...c.fancyUrls,
    state: f.state,
    detail: f.detail,
    action: done ? null : applyStepAction(c.allow, "proxy.install"),
    waiting: c.adminWaiting,
    watch: true,
    optional: false,
  };
}

export function macosRows(i: { permissions: Row[]; notifications: NotificationStatus | null; fancyUrls: FancyUrls }): FormRow[] {
  return [fdaRow(i.permissions), notificationsRow(i.notifications), fancyUrlsRow(i.fancyUrls)];
}

async function macosSection(p: Probes): Promise<FormRow[]> {
  const reply = await fetchPermissions(p.tray);
  return macosRows({ permissions: permissionRows(reply, null), notifications: reply?.notifications.status ?? null, fancyUrls: await fancyUrlsState(p) });
}

/** Every row answered, or optional. */
function allAnswered(rows: FormRow[] | undefined): boolean {
  return rows !== undefined && rows.every((r) => r.optional || r.state === "done");
}

export async function composeForm(p: Probes, opts: { sections: FormSection[]; secrets: SecretPresence; orgs: string[] }): Promise<SetupForm> {
  const sections: SetupForm["sections"] = {};
  if (opts.sections.includes("macos")) sections.macos = await macosSection(p);
  return {
    path: null,
    team: null,
    stage: null,
    sections,
    continueReady: allAnswered(sections.connect),
    startReady: allAnswered(sections.thisMac),
    paused: null,
    home: HOME_APP,
  };
}
