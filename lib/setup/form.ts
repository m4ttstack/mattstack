/**
 * The fast-setup form: every question setup still needs a person to answer,
 * grouped the way the app's screens draw them. rt decides each row's state and
 * action; the app only lays them out. `composeForm` never composes the full
 * plan, so the screen can re-read it every few seconds.
 */
import { applyStepAction, type Action, type Row } from "./contract.ts";
import { fancyUrlsState, type FancyUrls } from "./fancy-urls.ts";
import { readIntent } from "./intent.ts";
import { fetchPermissions, permissionRows, type PermissionsReply } from "./permissions.ts";
import { enrichSnapshotForge } from "./plan.ts";
import { readPrepare, type PrepareRecord } from "./prepare.ts";
import type { Probes } from "./probes.ts";
import { readUserIntegrationOverrides, type TeamSnapshot } from "./team-settings.ts";
import { TITLES, tokenCreateLink, tokenField } from "./token-create.ts";
import { accountRows, type SecretPresence } from "./validators/accounts.ts";
import { macRows } from "./validators/mac.ts";

export type FormSection = "macos" | "invite" | "restore" | "connect" | "this-mac";
export const FORM_SECTIONS: readonly FormSection[] = ["macos", "invite", "restore", "connect", "this-mac"];

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
  sections: { macos?: FormRow[]; invite?: FormRow[]; restore?: FormRow[]; connect?: FormRow[]; thisMac?: FormRow[] };
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
  clt: {
    title: "Command Line Tools",
    subtext: "Git and the build tools setup needs",
    installing: "Installing Command Line Tools…",
    install: "Install",
    notInstalled: "Not installed yet",
  },
  invite: {
    title: "Paste your invite",
    invitedBy: (team: string, admin: string) => `${team}, invited by ${admin}`,
    createToken: "Create token",
    tokenSubtext: (forge: Forge) => `Lets mattstack reach the team's repo and open ${reviews(forge)}`,
    connect: "Connect",
    connectedAs: (login: string) => `Connected as ${login}`,
    connected: "Connected",
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

type MacosPrepare = (PrepareRecord & { running: boolean }) | null;

const CLT_TOOL = "apple-clt";

/** Leads every section whose button starts git work, so that button waits for git. */
export function cltRow(i: { cltInstalled: boolean; prepare: MacosPrepare }): FormRow | null {
  if (i.cltInstalled) return null;
  const c = FORM_COPY.clt;
  const base = { id: "tool.clt", title: c.title, subtext: c.subtext, waiting: null, watch: true, optional: false };
  if (i.prepare?.running && i.prepare.items.includes(CLT_TOOL)) return { ...base, state: "busy", detail: c.installing, action: null };
  const failure = i.prepare?.failed.find((f) => f.tool === CLT_TOOL);
  return { ...base, state: "todo", detail: failure?.detail ?? c.notInstalled, action: { type: "install", label: c.install, tool: CLT_TOOL, via: "apple-clt" } };
}

export interface InviteInputs {
  rows: ReadonlyMap<string, Row>;
  forge: { provider: Forge; host: string } | null;
  /** The forge username the invite was made for. */
  forgeLogin: string | null;
  ghSignedIn: boolean;
  cltInstalled: boolean;
  prepare: MacosPrepare;
}

function forgeTokenRow(forge: { provider: Forge; host: string }, account: Row | undefined, login: string | null): FormRow {
  const c = FORM_COPY.invite;
  const base = { id: "forge.token", title: TITLES[forge.provider], subtext: c.tokenSubtext(forge.provider), waiting: null, watch: false, optional: false };
  if (account?.status === "ready") return { ...base, state: "done", detail: login ? c.connectedAs(login) : c.connected, action: null };
  return {
    ...base,
    state: "todo",
    detail: account?.detail ?? "",
    action: {
      type: "connect",
      label: c.connect,
      integration: forge.provider,
      fields: [tokenField(forge.provider, "member")],
      create: { label: c.createToken, url: tokenCreateLink(forge.provider, "member", forge.host).url },
    },
  };
}

export function inviteRows(i: InviteInputs): FormRow[] {
  const rows: FormRow[] = [];
  const clt = cltRow(i);
  if (clt) rows.push(clt);
  if (i.forge && (i.forge.provider === "gitlab" || !i.ghSignedIn)) rows.push(forgeTokenRow(i.forge, i.rows.get(`account.${i.forge.provider}`), i.forgeLogin));
  return rows;
}

export function restoreRows(i: { cltInstalled: boolean; prepare: MacosPrepare }): FormRow[] {
  const clt = cltRow(i);
  return clt ? [clt] : [];
}

const EMPTY_SNAPSHOT: TeamSnapshot = { slug: "", integrations: {}, trackingIdentities: [], marketplaces: [], plugins: [], remote: null };

function isReady(rows: ReadonlyMap<string, Row>, id: string): boolean {
  return rows.get(id)?.status === "ready";
}

function macosPrepare(p: Probes): MacosPrepare {
  return readPrepare(p, "macos", undefined, () => p.now());
}

/** Only this Mac's rows and the accounts: the tools group's probes are slow and nothing on this screen waits on them. */
async function inviteSection(p: Probes, secrets: SecretPresence): Promise<FormRow[]> {
  const intent = readIntent(p);
  const snapshot = enrichSnapshotForge(EMPTY_SNAPSHOT, intent);
  const [mac, accounts] = await Promise.all([macRows(p), accountRows(p, snapshot, [], secrets, intent, readUserIntegrationOverrides())]);
  const rows = new Map([...mac, ...accounts].map((r) => [r.id, r]));
  const github = rows.get("account.github");
  return inviteRows({
    rows,
    forge: snapshot.integrations.forge ?? null,
    forgeLogin: intent?.mode === "join" ? (intent.join?.pointer.username ?? null) : null,
    ghSignedIn: github?.status === "ready" && github.detail.startsWith("Signed in through the gh CLI"),
    cltInstalled: isReady(rows, "tool.clt"),
    prepare: macosPrepare(p),
  });
}

async function restoreSection(p: Probes): Promise<FormRow[]> {
  const rows = new Map((await macRows(p)).map((r) => [r.id, r]));
  return restoreRows({ cltInstalled: isReady(rows, "tool.clt"), prepare: macosPrepare(p) });
}

function joinTeam(p: Probes): SetupForm["team"] {
  const intent = readIntent(p);
  const pointer = intent?.mode === "join" ? intent.join?.pointer : undefined;
  return pointer ? { slug: pointer.team, name: pointer.name, invitedBy: pointer.owner } : null;
}

/** Every row answered, or optional. */
function allAnswered(rows: FormRow[] | undefined): boolean {
  return rows !== undefined && rows.every((r) => r.optional || r.state === "done");
}

export async function composeForm(p: Probes, opts: { sections: FormSection[]; secrets: SecretPresence; orgs: string[] }): Promise<SetupForm> {
  const sections: SetupForm["sections"] = {};
  if (opts.sections.includes("macos")) sections.macos = await macosSection(p);
  if (opts.sections.includes("invite")) sections.invite = await inviteSection(p, opts.secrets);
  if (opts.sections.includes("restore")) sections.restore = await restoreSection(p);
  return {
    path: null,
    team: joinTeam(p),
    stage: null,
    sections,
    continueReady: allAnswered(sections.connect),
    startReady: allAnswered(sections.thisMac),
    paused: null,
    home: HOME_APP,
  };
}
