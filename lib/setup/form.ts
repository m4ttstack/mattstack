/**
 * The fast-setup form: every question setup still needs a person to answer,
 * grouped the way the app's screens draw them, and which screen setup is on.
 * rt decides each row's state and action; the app only lays them out. The
 * macos, invite, restore and create sections read only what their screen needs; the
 * connect section is built from the full plan, which one call composes at most
 * once and shares between sections.
 */
import { join } from "path";
import { approvalState, type ApprovalState } from "../team/approval.ts";
import { readTeamLocal, type TeamLocalRecord } from "../team/team-local.ts";
import { warn } from "../ui/warn.ts";
import { applyEventsPath } from "./apply-run.ts";
import { readLogin, FINISH_IN_BROWSER, type LoginSession, type LoginTool } from "./cli-login.ts";
import { applyStepAction, REPO_PLACE_ROW_PREFIX, type Action, type Plan, type Row } from "./contract.ts";
import { fancyUrlsState, type FancyUrls } from "./fancy-urls.ts";
import { homeGitDir } from "./home-paths.ts";
import { integrationDef } from "./integrations.ts";
import { readIntent, type SetupIntent } from "./intent.ts";
import { fetchPermissions, permissionRows, type PermissionsReply } from "./permissions.ts";
import { composePlan, enrichSnapshotForge } from "./plan.ts";
import { readPrepare, type PrepareRecord } from "./prepare.ts";
import type { Probes } from "./probes.ts";
import { configuredRepoRoots } from "./repo-placement.ts";
import { detectCandidate, readStagedRepoRoot } from "./repo-root.ts";
import { readPackRequirements, type ToolRequirement } from "./requirements.ts";
import { STEP_PHASES } from "./run-phases.ts";
import { CLI_SESSION_INTEGRATIONS, signInTools } from "./sign-in-tools.ts";
import { installHasRun, isSetupFinished, markSetupFinished, readSetupState, type HomeBackupChoice, type SetupRun, type SetupState } from "./state.ts";
import { probeUserSettingsReader, readTeamSnapshot, readUserIntegrationOverrides, type TeamSnapshot } from "./team-settings.ts";
import { TITLES, tokenCreateLink, tokenField, type ForgeRole } from "./token-create.ts";
import { accountRows, type SecretPresence } from "./validators/accounts.ts";
import { macRows } from "./validators/mac.ts";
import { CLAUDE_SIGNIN_ACTION, FAST_BROWSER_ADD_ACTION } from "./validators/tools.ts";

export type FormSection = "macos" | "invite" | "restore" | "connect" | "this-mac" | "create";
/** A whole read's sections. The create section needs a forge picked first, so only a section read asks for it. */
export const FORM_SECTIONS: readonly FormSection[] = ["macos", "invite", "restore", "connect", "this-mac"];
export const SECTION_READS: readonly FormSection[] = [...FORM_SECTIONS, "create"];

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
  /** The failed step's last lines from the events file, so Show log has them after a relaunch. */
  log: string[];
  /** Open Login Items, beside Retry, while macOS holds the background item. */
  action: Action | null;
}

export interface SetupForm {
  path: FormPath | null;
  team: { slug: string; name: string; invitedBy: string | null } | null;
  stage: FormStage | null;
  sections: { macos?: FormRow[]; invite?: FormRow[]; restore?: FormRow[]; connect?: FormRow[]; thisMac?: FormRow[]; create?: FormRow[] };
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
    soloForge: "Optional. Lets mattstack open PRs and MRs",
    slackApp: { title: "Slack app", subtext: "Lets your team connect Slack. One owner makes it once" },
    slack: { title: "Slack", label: "Connect Slack", subtext: (forge: Forge) => `Lets mattstack track and post ${reviews(forge)} in Slack`, waiting: "Waiting for Slack…" },
    connected: "Connected",
    claude: { title: "Claude", label: "Sign in to Claude", subtext: "You know, to do agentic stuff.", pasteCode: "Paste code", codeField: "Code from your browser" },
    teamTool: { label: "Sign in", subtext: "For running your dev servers", code: (code: string) => `Your code is ${code}. Confirm it in your browser`, openAgain: "Open again" },
    linear: { title: "Linear", label: "Create token", subtext: "So mattstack can read and write Linear tickets" },
    fastBrowser: { title: "Fast Browser", label: "Add to Chrome", subtext: "Lets agents drive your real Chrome", waiting: "Waiting for Chrome…", done: "Added", getChrome: "Get Chrome" },
    footer: "Continue unlocks once each one is connected",
    continue: "Continue",
  },
  thisMac: {
    title: "Last bit: this Mac",
    subtitle: (team: string) => `Where ${team}'s repos and your settings live`,
    repos: { title: "Your repos", current: "Current checkout", locate: "Locate…", fresh: "New checkout", choose: "Choose…", board: "The board starts here", root: "Where new clones go" },
    settings: {
      title: "Your settings",
      local: "Keep on this Mac",
      remote: "Store in a remote repo",
      subtext: "mattstack keeps your settings in one folder. A private remote copy lets you restore them on a new Mac. You can turn this on later",
      change: "Change",
    },
    remote: {
      title: "Remote repo",
      subtext: "Where the private copy lives",
      use: "Use this repo",
      field: "Repo URL",
      hint: "git@github.com:janedoe/mattstack-home.git",
      create: "Create a private GitHub repo",
      creates: "rt creates a private GitHub repo when setup runs",
    },
    footer: "About 10 minutes once you start",
    start: "Set up this Mac",
  },
  home: {
    board: { label: "Open the board", url: "https://board.mattstack" },
    console: { label: "Open the console", url: "https://console.mattstack" },
  },
} as const;

export function homeApp(path: FormPath | null): { label: string; url: string } {
  return path === "solo" ? FORM_COPY.home.console : FORM_COPY.home.board;
}

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

async function macosSection(p: Probes, reply: PermissionsReply | null): Promise<FormRow[]> {
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

function forgeAccountRow(o: { id: string; forge: { provider: Forge; host: string }; account: Row | undefined; role: ForgeRole; subtext: string; connected: string }): FormRow {
  const c = FORM_COPY.invite;
  const base = { id: o.id, title: TITLES[o.forge.provider], subtext: o.subtext, waiting: null, watch: false, optional: false };
  if (o.account?.status === "ready") return { ...base, state: "done", detail: o.connected, action: null };
  return {
    ...base,
    state: "todo",
    detail: o.account?.detail ?? "",
    action: {
      type: "connect",
      label: c.connect,
      integration: o.forge.provider,
      fields: [tokenField(o.forge.provider, o.role)],
      create: { label: c.createToken, url: tokenCreateLink(o.forge.provider, o.role, o.forge.host).url },
    },
  };
}

export function inviteRows(i: InviteInputs): FormRow[] {
  const rows: FormRow[] = [];
  const clt = cltRow(i);
  if (clt) rows.push(clt);
  if (i.forge && (i.forge.provider === "gitlab" || !i.ghSignedIn)) {
    const c = FORM_COPY.invite;
    rows.push(
      forgeAccountRow({
        id: "forge.token",
        forge: i.forge,
        account: i.rows.get(`account.${i.forge.provider}`),
        role: "member",
        subtext: c.tokenSubtext(i.forge.provider),
        connected: i.forgeLogin ? c.connectedAs(i.forgeLogin) : c.connected,
      }),
    );
  }
  return rows;
}

export interface CreateInputs {
  rows: ReadonlyMap<string, Row>;
  forge: { provider: Forge; host: string };
  ghSignedIn: boolean;
  cltInstalled: boolean;
  prepare: MacosPrepare;
}

/** Create team clones the new repo with git, and makes it with the token unless gh is signed in on GitHub. */
export function createRows(i: CreateInputs): FormRow[] {
  const rows: FormRow[] = [];
  const clt = cltRow(i);
  if (clt) rows.push(clt);
  if (i.forge.provider === "gitlab" || !i.ghSignedIn) {
    const c = FORM_COPY.invite;
    rows.push(
      forgeAccountRow({
        id: "forge.token",
        forge: i.forge,
        account: i.rows.get(`account.${i.forge.provider}`),
        role: "owner",
        subtext: c.tokenSubtext(i.forge.provider),
        connected: c.connected,
      }),
    );
  }
  return rows;
}

/** The rows a full run sets up itself, so no form screen asks for them first. */
export const RUN_FIXES: ReadonlySet<string> = new Set([
  "perm.login-items",
  "tool.daemon",
  "tool.plugins",
  "tool.rt-link",
  "tool.shell",
  "tool.intercepts",
  "tool.proxy",
  "tool.extension",
  "tool.vsix",
  "tool.fast-browser",
  "tool.linear-mcp",
  "team.sync",
  "team.marketplace",
  "team.identity",
  "tool.state-backup",
  "home.backup",
  "skills.writing-style",
]);

/** herdr reading needs-you is installed with only its Claude integration missing, which the run's herdr.integration step adds. */
export function runFixes(r: Row): boolean {
  return RUN_FIXES.has(r.id) || r.id.startsWith("pack.") || r.waitsForInstall === true || (r.id === "tool.herdr" && r.status === "needs-you");
}

function planRows(plan: Plan): Row[] {
  return plan.groups.flatMap((g) => g.rows);
}

type FormForge = { provider: Forge; host: string };

/** What a path's screens draw as their own rows; ownership reads it so a row they do not draw falls through to the extra rows. */
export interface DrawnContext {
  path: FormPath;
  /** The team's forge; Just me always draws GitHub. */
  forge: FormForge | null;
  signIn: readonly ToolRequirement[];
}

function drawnForge(d: Pick<DrawnContext, "path" | "forge">): FormForge | null {
  return d.path === "solo" ? { provider: "github", host: "github.com" } : d.forge;
}

/**
 * Every plan row a section draws as its own row on this path. `home.backup`
 * stays out: its plan row is what says whether a push landed.
 */
export function formOwnedIds(plan: Plan, d: DrawnContext): Set<string> {
  const owned = new Set(["perm.fda", "perm.notifications", "tool.clt", "tool.claude", "tool.chrome", "tool.fast-browser-extension"]);
  const forge = drawnForge(d);
  if (forge) owned.add(`account.${forge.provider}`);
  if (d.path === "create") owned.add("account.slack-app");
  if (d.path === "solo") return owned;
  owned.add("account.slack");
  owned.add("account.linear");
  for (const tool of d.signIn) {
    owned.add(`tool.team.${tool.name}`);
    const session = sessionIntegration(tool);
    if (session) owned.add(`account.${session}`);
  }
  for (const r of planRows(plan)) if (r.id.startsWith(REPO_PLACE_ROW_PREFIX)) owned.add(r.id);
  return owned;
}

type AccountsPrepare = (PrepareRecord & { running: boolean }) | null;

function preparedTool(rowId: string): string | null {
  if (rowId === "tool.herdr") return "herdr";
  return rowId.startsWith("tool.team.") ? rowId.slice("tool.team.".length) : null;
}

function installing(prepare: AccountsPrepare, tool: string | null): boolean {
  return tool !== null && prepare?.running === true && prepare.items.includes(tool);
}

function installFailure(prepare: AccountsPrepare, tool: string | null): string | null {
  return (tool !== null && prepare?.failed.find((f) => f.tool === tool)?.detail) || null;
}

function extraRow(r: Row, prepare: AccountsPrepare): FormRow {
  const tool = preparedTool(r.id);
  const base = { id: r.id, title: r.title, subtext: r.why, waiting: null, watch: true };
  if (installing(prepare, tool)) return { ...base, state: "busy", detail: FORM_COPY.installing, action: null, optional: false };
  return { ...base, state: "todo", detail: installFailure(prepare, tool) ?? r.detail, action: r.action, optional: r.action === null };
}

/**
 * The rows holding Install or Finish that no section draws. Before a run only
 * those a run cannot set up; after one, only those it should have and did not.
 */
export function extraRows(plan: Plan, owned: Set<string>, opts: { afterRun: boolean; prepare: AccountsPrepare }): FormRow[] {
  const blocking = new Set([...plan.requiredMissing, ...plan.finishBlockedBy]);
  return planRows(plan)
    .filter((r) => blocking.has(r.id) && !owned.has(r.id) && runFixes(r) === opts.afterRun)
    .map((r) => extraRow(r, opts.prepare));
}

export interface ConnectInputs extends DrawnContext {
  plan: Plan;
  forgeLogin: string | null;
  signIn: ToolRequirement[];
  /** The accounts stage. */
  prepare: AccountsPrepare;
  logins: Partial<Record<LoginTool, LoginSession>>;
}

type ConnectRow = Omit<FormRow, "optional"> & { optional?: boolean };

/** A row nobody can press anything on never holds Continue; a busy row will turn into one they can. */
function settle(r: ConnectRow): FormRow {
  return { ...r, optional: r.optional ?? (r.state === "todo" && r.action === null) };
}

const GH_LOGIN = /^Signed in through the gh CLI as (\S+)/;

function forgeRow(i: ConnectInputs, rows: ReadonlyMap<string, Row>): ConnectRow | null {
  const c = FORM_COPY.connect;
  const forge = drawnForge(i);
  if (forge === null) return null;
  const account = rows.get(`account.${forge.provider}`);
  const login = (account?.status === "ready" ? GH_LOGIN.exec(account.detail)?.[1] : undefined) ?? i.forgeLogin;
  const connected = login === null ? c.connected : i.path === "join" ? c.connectedFromInvite(login) : FORM_COPY.invite.connectedAs(login);
  const role: ForgeRole = i.path === "create" ? "owner" : "member";
  if (i.path === "solo") return { ...forgeAccountRow({ id: "forge", forge, account, role, subtext: c.soloForge, connected }), optional: true };
  return forgeAccountRow({ id: "forge", forge, account, role, subtext: FORM_COPY.invite.tokenSubtext(forge.provider), connected });
}

function slackAppRow(i: ConnectInputs, rows: ReadonlyMap<string, Row>): ConnectRow | null {
  const app = rows.get("account.slack-app");
  if (i.path !== "create" || !app) return null;
  const c = FORM_COPY.connect.slackApp;
  const done = app.status === "ready";
  return { id: "slack-app", title: c.title, subtext: c.subtext, state: done ? "done" : "todo", detail: done ? FORM_COPY.connect.connected : app.detail, action: done ? null : app.action, waiting: null, watch: false };
}

const SLACK_CONNECT: Action = { type: "oauth", label: FORM_COPY.connect.slack.label, integration: "slack", verb: ["setup", "slack", "connect"] };

/** Before the team's Slack app exists, or while the owner still has to share its secret, Connect Slack cannot work: the row keeps the plan's own wait. */
function slackRow(i: ConnectInputs, rows: ReadonlyMap<string, Row>): ConnectRow | null {
  const slack = rows.get("account.slack");
  if (!slack) return null;
  const c = FORM_COPY.connect.slack;
  const base = { id: "slack", title: c.title, subtext: c.subtext(i.forge?.provider ?? "github"), waiting: c.waiting, watch: true };
  if (slack.status === "ready") return { ...base, state: "done", detail: FORM_COPY.connect.connected, action: null };
  if (slack.action?.type === "oauth") return { ...base, state: "todo", detail: slack.detail, action: SLACK_CONNECT };
  return { ...base, state: "todo", detail: slack.detail, action: slack.action, waiting: null, optional: slack.action === null || !slack.required };
}

const CLAUDE_INSTALL: Action = { type: "install", label: "Install", tool: "claude", via: "vendor" };

function claudeRow(i: ConnectInputs, rows: ReadonlyMap<string, Row>): ConnectRow {
  const c = FORM_COPY.connect.claude;
  const claude = rows.get("tool.claude");
  const base = { id: "claude", title: c.title, subtext: c.subtext, waiting: null, watch: true };
  if (claude?.status === "ready") return { ...base, state: "done", detail: claude.detail, action: null };
  if (claude?.status === "missing") {
    if (installing(i.prepare, "claude")) return { ...base, state: "busy", detail: FORM_COPY.installing, action: null };
    return { ...base, state: "todo", detail: installFailure(i.prepare, "claude") ?? claude.detail, action: CLAUDE_INSTALL };
  }
  if (i.logins.claude) {
    return {
      ...base,
      state: "waiting",
      detail: FINISH_IN_BROWSER,
      action: { type: "form", label: c.pasteCode, verb: ["setup", "claude", "code"], fields: [{ name: "code", label: c.codeField, secret: true }] },
    };
  }
  return { ...base, state: "todo", detail: claude?.detail ?? "", action: CLAUDE_SIGNIN_ACTION };
}

function sessionIntegration(tool: ToolRequirement): LoginTool | null {
  const connect = tool.connect;
  if (!connect || !("integration" in connect) || !CLI_SESSION_INTEGRATIONS.includes(connect.integration)) return null;
  return connect.integration as LoginTool;
}

/**
 * A tool with its own sign-in verb has no check rt can read, so once it is
 * installed its row offers the verb without holding Continue.
 */
function signInRow(i: ConnectInputs, rows: ReadonlyMap<string, Row>, tool: ToolRequirement): ConnectRow {
  const c = FORM_COPY.connect.teamTool;
  const session = sessionIntegration(tool);
  const base = { id: `signin.${tool.name}`, title: session ? integrationDef(session).title : tool.name, subtext: tool.why.trim() || c.subtext, waiting: null, watch: true };
  const installed = rows.get(`tool.team.${tool.name}`);
  if (installed && installed.status !== "ready") {
    if (installed.status === "missing" && installing(i.prepare, tool.name)) return { ...base, state: "busy", detail: FORM_COPY.installing, action: null };
    return { ...base, state: "todo", detail: installFailure(i.prepare, tool.name) ?? installed.detail, action: installed.action };
  }
  if (session === null) {
    const connect = tool.connect as { verb: string[]; label: string };
    return { ...base, state: "todo", detail: installed?.detail ?? "", action: { type: "run", label: connect.label, verb: connect.verb }, optional: true };
  }
  const account = rows.get(`account.${session}`);
  if (account?.status === "ready") return { ...base, state: "done", detail: account.detail, action: null };
  const live = i.logins[session];
  if (live) {
    const detail = live.code ? c.code(live.code) : FINISH_IN_BROWSER;
    const action: Action = live.url ? { type: "open-url", label: c.openAgain, url: live.url } : { type: "run", label: c.label, verb: ["setup", session, "connect"] };
    return { ...base, state: "waiting", detail, action };
  }
  return { ...base, state: "todo", detail: account?.detail ?? "", action: { type: "run", label: c.label, verb: ["setup", session, "connect"] } };
}

const LINEAR_CREATE = { label: FORM_COPY.connect.linear.label, url: "https://linear.app/settings/account/security" };

function linearRow(rows: ReadonlyMap<string, Row>): ConnectRow | null {
  const linear = rows.get("account.linear");
  if (!linear) return null;
  const c = FORM_COPY.connect.linear;
  const base = { id: "linear", title: c.title, subtext: c.subtext, waiting: null, watch: false };
  if (linear.status === "ready") return { ...base, state: "done", detail: FORM_COPY.connect.connected, action: null };
  return {
    ...base,
    state: "todo",
    detail: linear.detail,
    action: { type: "connect", label: FORM_COPY.invite.connect, integration: "linear", fields: integrationDef("linear").fields, create: LINEAR_CREATE },
  };
}

const GET_CHROME: Action = { type: "open-url", label: FORM_COPY.connect.fastBrowser.getChrome, url: "https://www.google.com/chrome/" };

function isStoreInstall(action: Action | null): boolean {
  return action?.type === "open-url" && FAST_BROWSER_ADD_ACTION.type === "open-url" && action.url === FAST_BROWSER_ADD_ACTION.url;
}

function fastBrowserRow(rows: ReadonlyMap<string, Row>): ConnectRow {
  const c = FORM_COPY.connect.fastBrowser;
  const base = { id: "fast-browser", title: c.title, subtext: c.subtext, waiting: null, watch: true };
  const chrome = rows.get("tool.chrome");
  if (chrome && chrome.status !== "ready") return { ...base, state: "todo", detail: chrome.detail, action: GET_CHROME };
  const extension = rows.get("tool.fast-browser-extension");
  if (extension?.status === "ready") return { ...base, state: "done", detail: c.done, action: null };
  if (isStoreInstall(extension?.action ?? null)) return { ...base, state: "todo", detail: extension!.detail, action: FAST_BROWSER_ADD_ACTION, waiting: c.waiting };
  return { ...base, state: "todo", detail: extension?.detail ?? "", action: extension?.action ?? null };
}

/** Fast Browser is optional on solo, so its row never holds a solo Continue. */
export function connectRows(i: ConnectInputs): FormRow[] {
  const rows = new Map(planRows(i.plan).map((r) => [r.id, r]));
  const team = i.path !== "solo";
  const list: (ConnectRow | null)[] = [
    forgeRow(i, rows),
    team ? slackAppRow(i, rows) : null,
    team ? slackRow(i, rows) : null,
    claudeRow(i, rows),
    ...(team ? i.signIn.map((tool) => signInRow(i, rows, tool)) : []),
    ...extraRows(i.plan, formOwnedIds(i.plan, i), { afterRun: false, prepare: i.prepare }),
    team ? linearRow(rows) : null,
    team ? fastBrowserRow(rows) : { ...fastBrowserRow(rows), optional: true },
  ];
  return list.filter((r): r is ConnectRow => r !== null).map(settle);
}

/** `forge` and `signIn` are the connect screen's, so a run's leftovers never draw one of its rows twice. */
export interface ThisMacInputs extends DrawnContext {
  plan: Plan;
  signIn: ToolRequirement[];
  /** The last run ended ok. */
  ranOk: boolean;
  cltInstalled: boolean;
  prepare: MacosPrepare;
  backup: HomeBackupChoice | undefined;
  /** The home repo's origin, or the staged url before the repo exists. */
  homeRemote: string | null;
  ghSignedIn: boolean;
  repoRoot: { configured: string | null; staged: string | null; candidate: string | null };
}

/** An answer only the run is left to land is done here: Set up this Mac starts that run. */
function placeRow(r: Row): FormRow {
  const place = r.action?.type === "place-repo" ? r.action : null;
  const done = r.status === "ready" || place?.awaitsRun === true;
  return { id: r.id, title: r.title, subtext: place?.board ?? r.why, state: done ? "done" : "todo", detail: r.detail, action: r.action, waiting: null, watch: false, optional: false };
}

function repoRootRow(i: ThisMacInputs): FormRow {
  const c = FORM_COPY.thisMac.repos;
  const chosen = i.repoRoot.staged ?? i.repoRoot.configured;
  return {
    id: "repos.root",
    title: c.title,
    subtext: c.root,
    state: chosen ? "done" : "todo",
    detail: chosen ?? "",
    action: { type: "choose-folder", label: c.choose, startAt: i.repoRoot.candidate },
    waiting: null,
    watch: false,
    optional: false,
  };
}

function backupRow(i: ThisMacInputs): FormRow {
  const c = FORM_COPY.thisMac.settings;
  const selected = i.backup?.mode ?? "local";
  return {
    id: "settings.backup",
    title: c.title,
    subtext: c.subtext,
    state: "done",
    detail: c[selected],
    action: {
      type: "choose",
      label: c.change,
      verb: ["setup", "home-backup"],
      options: [
        { id: "local", label: c.local, detail: "" },
        { id: "remote", label: c.remote, detail: "" },
      ],
      selected,
    },
    waiting: null,
    watch: false,
    optional: false,
  };
}

/** Choosing remote alone stages nothing, so the row stays open until a url or a create is staged. */
function remoteRow(i: ThisMacInputs): FormRow | null {
  if (i.backup?.mode !== "remote") return null;
  const c = FORM_COPY.thisMac.remote;
  const base = { id: "settings.remote", title: c.title, subtext: c.subtext, waiting: null, watch: false, optional: false };
  if (i.homeRemote !== null) return { ...base, state: "done", detail: i.homeRemote, action: null };
  if (i.backup.create) return { ...base, state: "done", detail: c.creates, action: null };
  return {
    ...base,
    state: "todo",
    detail: "",
    action: {
      type: "form",
      label: c.use,
      verb: ["home", "remote", "set"],
      fields: [{ name: "url", label: c.field, secret: false, hint: c.hint }],
      ...(i.ghSignedIn ? { alternatives: [{ id: "create", label: c.create }] } : {}),
    },
  };
}

/** Git leads on every path: Just me's run refuses before its first step without it. */
export function thisMacRows(i: ThisMacInputs): FormRow[] {
  const repos = i.path === "solo" ? [repoRootRow(i)] : planRows(i.plan).filter((r) => r.id.startsWith(REPO_PLACE_ROW_PREFIX)).map(placeRow);
  const list: (FormRow | null)[] = [
    cltRow(i),
    ...repos,
    backupRow(i),
    remoteRow(i),
    ...(i.ranOk ? extraRows(i.plan, formOwnedIds(i.plan, i), { afterRun: true, prepare: i.prepare }) : []),
  ];
  return list.filter((r): r is FormRow => r !== null);
}

export function restoreRows(i: { cltInstalled: boolean; prepare: MacosPrepare }): FormRow[] {
  const clt = cltRow(i);
  return clt ? [clt] : [];
}

const EMPTY_SNAPSHOT: TeamSnapshot = { slug: "", integrations: {}, trackingIdentities: [], marketplaces: [], plugins: [], remote: null };

function isReady(rows: ReadonlyMap<string, Row>, id: string): boolean {
  return rows.get(id)?.status === "ready";
}

function ghSignedIn(rows: ReadonlyMap<string, Row>): boolean {
  const github = rows.get("account.github");
  return github?.status === "ready" && github.detail.startsWith("Signed in through the gh CLI");
}

function macosPrepare(p: Probes): MacosPrepare {
  return readPrepare(p, "macos", undefined, () => p.now());
}

/** Only this Mac's rows and the accounts: the tools group's probes are slow and nothing on this screen waits on them. */
async function inviteSection(p: Probes, secrets: SecretPresence): Promise<FormRow[]> {
  const intent = readIntent(p);
  const snapshot = enrichSnapshotForge(EMPTY_SNAPSHOT, intent);
  const [mac, accounts] = await Promise.all([macRows(p), accountRows(p, snapshot, [], secrets, intent, readUserIntegrationOverrides({ read: probeUserSettingsReader(p) }))]);
  const rows = new Map([...mac, ...accounts].map((r) => [r.id, r]));
  return inviteRows({
    rows,
    forge: snapshot.integrations.forge ?? null,
    forgeLogin: intent?.mode === "join" ? (intent.join?.pointer.username ?? null) : null,
    ghSignedIn: ghSignedIn(rows),
    cltInstalled: isReady(rows, "tool.clt"),
    prepare: macosPrepare(p),
  });
}

export interface CreateChoice {
  forge: Forge;
  /** A self-hosted forge's host; null reads the forge's own. */
  host: string | null;
}

const DEFAULT_HOST: Record<Forge, string> = { github: "github.com", gitlab: "gitlab.com" };

async function createSection(p: Probes, secrets: SecretPresence, choice: CreateChoice): Promise<FormRow[]> {
  const forge = { provider: choice.forge, host: choice.host ?? DEFAULT_HOST[choice.forge] };
  const snapshot: TeamSnapshot = { ...EMPTY_SNAPSHOT, integrations: { forge } };
  const [mac, accounts] = await Promise.all([macRows(p), accountRows(p, snapshot, [], secrets, null, readUserIntegrationOverrides({ read: probeUserSettingsReader(p) }))]);
  const rows = new Map([...mac, ...accounts].map((r) => [r.id, r]));
  return createRows({ rows, forge, ghSignedIn: ghSignedIn(rows), cltInstalled: isReady(rows, "tool.clt"), prepare: macosPrepare(p) });
}

async function restoreSection(p: Probes): Promise<FormRow[]> {
  const rows = new Map((await macRows(p)).map((r) => [r.id, r]));
  return restoreRows({ cltInstalled: isReady(rows, "tool.clt"), prepare: macosPrepare(p) });
}

interface Clone {
  slug: string;
  record: TeamLocalRecord;
}

/** The redeem clears the join intent, so the joined team's own record keeps the names the wait and this-Mac screens show. */
function formTeam(intent: SetupIntent | null, joined: Clone | undefined): SetupForm["team"] {
  const pointer = intent?.mode === "join" ? intent.join?.pointer : undefined;
  if (pointer) return { slug: pointer.team, name: pointer.name, invitedBy: pointer.owner };
  if (!joined) return null;
  return { slug: joined.slug, name: joined.record.teamName ?? joined.slug, invitedBy: joined.record.invitedBy ?? null };
}

/** With several joined teams, one still waiting on its admin comes first: a Join from Settings lands on the wait. */
function joinedClone(p: Probes, clones: Clone[]): { clone: Clone; approval: ApprovalState } | undefined {
  const joined = clones.filter((c) => c.record.joinedByRt).map((clone) => ({ clone, approval: approvalState(p, clone.slug) }));
  return joined.find((j) => j.approval.kind === "waiting") ?? joined[0];
}

/** Every row answered, or optional. */
export function allAnswered(rows: FormRow[] | undefined): boolean {
  return rows !== undefined && rows.every((r) => r.optional || r.state === "done");
}

/**
 * The choice from the four cards while it is pending. A run that ends ok
 * clears it, so the team on disk answers after that, and a Mac with no team
 * that has run or finished is Just me.
 */
export function formPath(i: { intent: SetupIntent | null; joined: boolean; created: boolean; orgs: string[]; ranOrFinished: boolean }): FormPath | null {
  const mode = i.intent?.mode;
  if (mode === "join" || mode === "create" || mode === "solo" || mode === "restore") return mode;
  if (i.joined) return "join";
  if (i.created) return "create";
  if (i.orgs.length > 0) return "join";
  return i.ranOrFinished ? "solo" : null;
}

export interface StageInputs {
  finished: boolean;
  path: FormPath | null;
  macosDone: boolean;
  join: "unredeemed" | ApprovalState["kind"] | null;
  run: SetupRun | undefined;
  connectDone: boolean;
  thisMacDone: boolean;
  needsRun: boolean;
}

/**
 * The screen setup is on. An approval rt cannot read lets the member on. A run
 * that ended ok with rows left standing lands on this-mac, where its leftovers
 * are, never back on the bar: `--resume` against an ended run runs it all again.
 */
export function formStage(i: StageInputs): FormStage {
  if (i.finished) return finishedStage(i);
  if (!i.macosDone) return "macos";
  const bar = runStage(i.run);
  if (bar) return bar;
  if (i.path === null) return "path";
  if (i.join === "unredeemed") return "invite";
  if (i.join === "waiting") return "waiting";
  if (i.path === "restore" && i.run === undefined) return "running";
  if (!i.connectDone) return "connect";
  return "this-mac";
}

function runStage(run: SetupRun | undefined): "running" | "paused" | null {
  if (run === undefined) return null;
  if (run.endedAt === undefined) return "running";
  return run.ok === true ? null : "paused";
}

/**
 * A Join from Settings in flight outranks the finished state, and a run
 * outranks the sections: a failed run here started after Finish (nothing
 * finishes a failed run), so its Retry is the way on.
 */
function finishedStage(i: StageInputs): FormStage {
  if (i.join === "unredeemed") return "invite";
  if (i.join === "waiting") return "waiting";
  const bar = runStage(i.run);
  if (bar) return bar;
  if (!i.macosDone) return "macos";
  if (!i.connectDone) return "connect";
  if (!i.thisMacDone || i.needsRun) return "this-mac";
  return "ready";
}

/** A row only the bar sets up still blocks Install or Finish. Before an ok run no screen draws it, so Set up this Mac is its fix. */
export function needsRun(plan: Plan): boolean {
  const blocking = new Set([...plan.requiredMissing, ...plan.finishBlockedBy]);
  return planRows(plan).some((r) => blocking.has(r.id) && runFixes(r));
}

const PAUSED_LOG_LINES = 50;

function stepLog(events: string | null, step: string): string[] {
  const lines: string[] = [];
  for (const raw of (events ?? "").split("\n")) {
    if (raw === "") continue;
    try {
      const ev = JSON.parse(raw) as { event?: unknown; id?: unknown; line?: unknown } | null;
      if (ev?.event === "log" && ev.id === step && typeof ev.line === "string") lines.push(ev.line);
    } catch {
      // A line a crash cut off mid-write.
    }
  }
  return lines.slice(-PAUSED_LOG_LINES);
}

export function pausedFor(run: SetupRun | undefined, extras: { events: string | null; loginItems: Row | undefined }): FormPaused | null {
  const failed = run?.failed;
  if (!failed) return null;
  return {
    step: failed.step,
    // A record an older rt wrote can name a step this one no longer has.
    title: STEP_PHASES[failed.step]?.paused ?? failed.detail,
    detail: failed.detail,
    remedy: failed.remedy ?? null,
    log: stepLog(extras.events, failed.step),
    action: extras.loginItems?.status === "needs-you" ? extras.loginItems.action : null,
  };
}

const LOGIN_TOOLS: readonly LoginTool[] = ["claude", "doppler", "ldcli"];

function teamForge(p: Probes, plan: Plan, intent: SetupIntent | null): FormForge | null {
  const slug = plan.team.slug;
  return enrichSnapshotForge(slug ? readTeamSnapshot(p, slug) : EMPTY_SNAPSHOT, intent).integrations.forge ?? null;
}

async function connectSection(p: Probes, plan: Plan, orgs: string[], path: FormPath): Promise<FormRow[]> {
  const intent = readIntent(p);
  const slug = plan.team.slug;
  const pointerLogin = intent?.mode === "join" ? (intent.join?.pointer.username ?? null) : null;
  const logins: ConnectInputs["logins"] = {};
  for (const tool of LOGIN_TOOLS) {
    const live = readLogin(p, tool);
    if (live) logins[tool] = live;
  }
  return connectRows({
    path,
    plan,
    forge: teamForge(p, plan, intent),
    forgeLogin: (slug && orgs.includes(slug) ? readTeamLocal(p, slug).forgeUsername : undefined) ?? pointerLogin,
    signIn: signInTools(readPackRequirements(p, slug)),
    prepare: readPrepare(p, "accounts", undefined, () => p.now()),
    logins,
  });
}

/** A url staged before Install still counts once the Join page has made the repo without an origin. */
async function homeRemote(p: Probes, backup: HomeBackupChoice | undefined): Promise<string | null> {
  const staged = backup?.mode === "remote" ? (backup.url ?? null) : null;
  if (!p.exists(homeGitDir(p.home))) return staged;
  const origin = await p.exec(["git", "-C", join(p.home, ".mattstack", "user"), "remote", "get-url", "origin"]);
  return (origin.code === 0 && origin.stdout.trim()) || staged;
}

async function thisMacSection(p: Probes, plan: Plan, path: FormPath, state: SetupState): Promise<FormRow[]> {
  const rows = new Map(planRows(plan).map((r) => [r.id, r]));
  const backup = state.homeBackup;
  return thisMacRows({
    path,
    plan,
    forge: teamForge(p, plan, readIntent(p)),
    signIn: signInTools(readPackRequirements(p, plan.team.slug)),
    ranOk: state.run?.ok === true,
    cltInstalled: isReady(rows, "tool.clt"),
    prepare: macosPrepare(p),
    backup,
    homeRemote: await homeRemote(p, backup),
    ghSignedIn: ghSignedIn(rows),
    repoRoot: { configured: configuredRepoRoots(p)[0] ?? null, staged: readStagedRepoRoot(p), candidate: detectCandidate(p) },
  });
}

export type PlanMode = "plan" | "status";

export interface FormOptions {
  /** Only these sections. Without it the form is whole: every section, the stage, what paused, and Finish once nothing blocks it. */
  sections?: readonly FormSection[];
  secrets: SecretPresence;
  orgs: string[];
  plan?: (mode: PlanMode) => Promise<Plan>;
  /** The forge the create section reads; that section is left out without it. */
  create?: CreateChoice;
}

/**
 * A whole read decides Finish first, then builds every section and the stage
 * from the plan the Mac reads from then on (status mode once finished), so the
 * next read lands on the same screen. `requiredMissing` is not read for
 * Finish: a row a section draws as done, such as denied notifications, can sit
 * there for good.
 */
export async function composeForm(p: Probes, opts: FormOptions): Promise<SetupForm> {
  const wanted = opts.sections ?? FORM_SECTIONS;
  const state = readSetupState(p);
  const plans = new Map<PlanMode, Promise<Plan>>();
  const planFor = (mode: PlanMode): Promise<Plan> => {
    let planned = plans.get(mode);
    if (!planned) {
      planned = opts.plan?.(mode) ?? composePlan({ p, secrets: opts.secrets, ci: p.env.CI === "true", mode, orgs: opts.orgs });
      plans.set(mode, planned);
    }
    return planned;
  };
  const finished = isSetupFinished(state) || (opts.sections === undefined && (await finishOnRead(p, state, planFor)));
  const intent = readIntent(p);
  const clones: Clone[] = opts.orgs.map((slug) => ({ slug, record: readTeamLocal(p, slug) }));
  const joined = joinedClone(p, clones);
  const path = formPath({
    intent,
    joined: clones.some((c) => c.record.joinedByRt),
    created: clones.some((c) => c.record.createdByRt),
    orgs: opts.orgs,
    ranOrFinished: state.run !== undefined || finished,
  });
  const plan = () => planFor(finished ? "status" : "plan");

  const permissions = wanted.includes("macos") ? await fetchPermissions(p.tray) : null;
  const sections: SetupForm["sections"] = {};
  if (wanted.includes("macos")) sections.macos = await macosSection(p, permissions);
  if (wanted.includes("invite")) sections.invite = await inviteSection(p, opts.secrets);
  if (wanted.includes("restore")) sections.restore = await restoreSection(p);
  if (wanted.includes("connect")) sections.connect = await connectSection(p, await plan(), opts.orgs, path ?? "solo");
  if (wanted.includes("this-mac")) sections.thisMac = await thisMacSection(p, await plan(), path ?? "solo", state);
  if (wanted.includes("create") && opts.create) sections.create = await createSection(p, opts.secrets, opts.create);
  const form: SetupForm = {
    path,
    team: formTeam(intent, joined?.clone),
    stage: null,
    sections,
    continueReady: allAnswered(sections.connect),
    startReady: allAnswered(sections.thisMac),
    paused: null,
    home: homeApp(path),
  };
  if (opts.sections !== undefined) return form;

  const run = state.run;
  const loginItems = permissionRows(permissions, null).find((r) => r.id === "perm.login-items");
  const paused = pausedFor(run, { events: run?.failed ? p.readFile(applyEventsPath(p.home)) : null, loginItems });
  const stage = formStage({
    finished,
    path,
    macosDone: allAnswered(sections.macos),
    join: intent?.mode === "join" ? "unredeemed" : (joined?.approval.kind ?? null),
    run,
    connectDone: allAnswered(sections.connect),
    thisMacDone: allAnswered(sections.thisMac),
    needsRun: finished && needsRun(await plan()),
  });
  return { ...form, stage, paused };
}

/**
 * Finish after a run that ended ok, once Install has run and nothing blocks
 * Finish: the same test the run's own finish makes. Install's stamp guards a
 * run record that outlived it. False when the write fails, so the read stays
 * on the unfinished screens.
 */
async function finishOnRead(p: Probes, state: SetupState, planFor: (mode: PlanMode) => Promise<Plan>): Promise<boolean> {
  if (state.run?.ok !== true || !installHasRun(state)) return false;
  if ((await planFor("plan")).finishBlockedBy.length > 0) return false;
  try {
    markSetupFinished(p);
    return true;
  } catch (err) {
    warn("setup.form", `setup not marked finished: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
