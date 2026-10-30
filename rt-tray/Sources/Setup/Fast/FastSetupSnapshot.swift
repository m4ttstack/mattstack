import AppKit
import SwiftUI
import MattstackCore

/// `rt-tray --render-fast-setup-snapshots <out-dir>` renders the fast setup
/// views from fixture rows, light and dark, as `<name>-<light|dark>.png`, then
/// exits before any window, status item, socket or daemon work exists. DEBUG builds only.
enum FastSetupSnapshot {
    @MainActor
    static func runIfRequested() -> Bool {
        #if DEBUG
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: "--render-fast-setup-snapshots") else { return false }
        guard args.count > i + 1 else {
            FileHandle.standardError.write(Data("usage: --render-fast-setup-snapshots <out-dir>\n".utf8))
            exit(64)
        }
        let out = URL(fileURLWithPath: args[i + 1])
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        _ = NSApplication.shared
        let pages = registered.flatMap { $0() }
        for (name, page) in pages {
            for scheme in ["light", "dark"] {
                SnapshotRenderer.render(
                    page.frame(width: SetupWindowController.width)
                        .background(Color(nsColor: .windowBackgroundColor))
                        .controlSize(.large),
                    appearance: scheme == "dark" ? .darkAqua : .aqua,
                    to: out.appendingPathComponent("\(name)-\(scheme).png"))
            }
        }
        print("wrote \(pages.count * 2) snapshots to \(out.path)")
        return true
        #else
        return false
        #endif
    }

    #if DEBUG
    /// Each screen adds its own pages here.
    private static let registered: [@MainActor () -> [(String, AnyView)]] = [rowPages, macosPages, pathPages, invitePages]

    static func card(_ rows: [FormRow], title: String? = nil, waiting: [String: String] = [:], errors: [String: String] = [:]) -> AnyView {
        AnyView(FormCard(title: title, rows: rows, waiting: waiting, errors: errors) { _, _, _ in }.padding(20))
    }

    @MainActor
    private static func rowPages() -> [(String, AnyView)] {
        [
            ("rows-todo", card([Rows.notifications, Rows.slack])),
            ("rows-busy", card([Rows.claudeInstalling])),
            ("rows-waiting", card([Rows.doppler, Rows.claudeCode])),
            ("rows-done", card([Rows.gitlab, Rows.fastBrowserAdded])),
            ("rows-todo-waiting", card([Rows.fastBrowser], waiting: [Rows.fastBrowser.id: "Waiting for Chrome…"])),
            ("rows-error", card([Rows.slack], errors: [Rows.slack.id: "Slack didn't answer. Try again"])),
            ("rows-connect", card([Rows.linear])),
            ("rows-choose", card([Rows.backup, Rows.remote])),
            ("rows-repo", card([Rows.repo, Rows.repoClone], title: "Your repos")),
            ("rows-folder", card([Rows.repoRoot])),
            ("rows-done-action", card([Rows.repoRootLong])),
            ("rows-choose-waiting", card([Rows.backup], waiting: [Rows.backup.id: "Saving…"])),
            ("card-connect", AnyView(connectScreen)),
            ("footer-ready", AnyView(FastFooter(screen: "this-mac", note: "About 10 minutes once you start",
                                                secondary: ("Back", {}), primary: ("Set up this Mac", true, {})))),
        ]
    }

    @MainActor
    private static var connectScreen: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 18) {
                FastScreenHeader(label: "widgets", title: "You're in. Connect your accounts",
                                 subtitle: "One click each. Most open in your browser")
                FormCard(title: nil, rows: [Rows.gitlab, Rows.slack, Rows.claudeInstalling, Rows.doppler, Rows.linear, Rows.fastBrowser]) { _, _, _ in }
            }
            .padding(24)
            FastFooter(screen: "connect", note: "Continue unlocks once each one is connected",
                       secondary: ("Back", {}), primary: ("Continue", false, {}))
        }
    }

    @MainActor
    private static func macosPages() -> [(String, AnyView)] {
        func page(_ rows: [FormRow], waiting: [String: String] = [:]) -> AnyView {
            AnyView(MacOSScreenBody(rows: rows, waiting: waiting, errors: [:]) { _, _, _ in })
        }
        return [
            ("macos-fresh", page([Rows.fda, Rows.notificationsAsk, Rows.fancyUrls])),
            ("macos-waiting-admin", page([Rows.fdaGranted, Rows.notificationsAllowed, Rows.fancyUrls],
                                         waiting: [Rows.fancyUrls.id: Rows.fancyUrls.waiting ?? ""])),
            ("macos-done", page([Rows.fdaGranted, Rows.notificationsAllowed, Rows.fancyUrlsAllowed])),
            ("macos-notifications-off", page([Rows.fdaGranted, Rows.notificationsOff, Rows.fancyUrls])),
            ("macos-fancy-urls-long-detail", AnyView(VStack(spacing: 0) {
                MacOSScreenBody(rows: [Rows.fdaGranted, Rows.notificationsAllowed, Rows.fancyUrlsNoInstaller], waiting: [:], errors: [:]) { _, _, _ in }
                card([Rows.fancyUrlsBrewFailed]).padding(.horizontal, 4).padding(.top, -20)
            })),
        ]
    }

    @MainActor
    private static func pathPages() -> [(String, AnyView)] {
        [
            ("path", AnyView(PathScreenBody(showsSolo: true) { _ in })),
            ("path-upgrade", AnyView(PathScreenBody(showsSolo: false) { _ in })),
        ]
    }

    @MainActor
    private static func invitePages() -> [(String, AnyView)] {
        let code = "01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567-89ABC-DEFGH-JKMNP-QRSTV-WXYZ0-12345-6789A-BC"
        let line = "Mithrandir, invited by Jane Doe"
        func page(_ code: String, line: String? = nil, failure: String? = nil, checking: Bool = false,
                  rows: [FormRow] = [], waiting: [String: String] = [:]) -> AnyView {
            let enabled = FastSetupFlow.joinEnabled(verdictOK: line != nil, rows: rows)
            return AnyView(InviteScreenBody(code: .constant(code), inviteLine: line, failure: failure, isChecking: checking,
                                            rows: rows, waiting: waiting, errors: [:], joinEnabled: enabled,
                                            onPaste: {}, onAction: { _, _, _ in }, onBack: {}, onJoin: {}))
        }
        return [
            ("invite-empty", page("")),
            ("invite-checking", page(code, checking: true)),
            ("invite-failed", page(code, failure: "Invite not recognized or expired: ask Jane Doe for a new one.")),
            ("invite-read", page(code, line: line, rows: [Rows.gitlabToken])),
            ("invite-clt-busy", page(code, line: line, rows: [Rows.cltInstalling, Rows.gitlabTokenConnected])),
            ("invite-clt-todo", page(code, line: line, rows: [Rows.clt, Rows.githubToken])),
            ("invite-ready", page(code, line: line, rows: [Rows.gitlabTokenConnected])),
        ]
    }

    enum Rows {
        static let clt = FormRow(id: "tool.clt", title: "Command Line Tools", subtext: "Git and the build tools setup needs",
                                 state: .todo, detail: "Not installed yet",
                                 action: RowAction(type: .install, label: "Install", tool: "apple-clt", via: "apple-clt"), watch: true)
        static let cltInstalling = FormRow(id: "tool.clt", title: "Command Line Tools", subtext: "Git and the build tools setup needs",
                                           state: .busy, detail: "Installing Command Line Tools…", watch: true)
        static let gitlabToken = FormRow(id: "forge.token", title: "GitLab", subtext: "Lets mattstack reach the team's repo and open MRs",
                                         state: .todo, detail: "",
                                         action: RowAction(type: .connect, label: "Connect", integration: "gitlab", fields: [
                                             ActionField(name: "token", label: "GitLab token", secret: true, hint: "api"),
                                         ], create: ActionLink(label: "Create token",
                                                               url: "https://gitlab.com/-/user_settings/personal_access_tokens?name=mattstack&scopes=api%2Cread_api%2Cread_user%2Cread_repository%2Cwrite_repository%2Cai_features")))
        static let gitlabTokenConnected = FormRow(id: "forge.token", title: "GitLab", subtext: "Lets mattstack reach the team's repo and open MRs",
                                                  state: .done, detail: "Connected as janedoe")
        static let githubToken = FormRow(id: "forge.token", title: "GitHub", subtext: "Lets mattstack reach the team's repo and open PRs",
                                         state: .todo, detail: "",
                                         action: RowAction(type: .connect, label: "Connect", integration: "github", fields: [
                                             ActionField(name: "token", label: "GitHub token", secret: true, hint: "repo, read:org"),
                                         ], create: ActionLink(label: "Create token",
                                                               url: "https://github.com/settings/tokens/new?description=mattstack&scopes=repo%2Cread%3Aorg")))

        static let fda = FormRow(id: "perm.fda", title: "Full Disk Access", subtext: "Reads your repos and Chrome's profile",
                                 state: .todo, detail: "Not granted",
                                 action: RowAction(type: .openSettings, label: "Open settings", target: "fda"), watch: true)
        static let fdaGranted = FormRow(id: "perm.fda", title: "Full Disk Access", subtext: "Reads your repos and Chrome's profile",
                                        state: .done, detail: "Granted", watch: true)
        static let notificationsAsk = FormRow(id: "perm.notifications", title: "Notifications", subtext: "Tells you when setup is done",
                                              state: .todo, detail: "Not asked yet",
                                              action: RowAction(type: .requestPermission, label: "Allow", which: "notifications"))
        static let notificationsAllowed = FormRow(id: "perm.notifications", title: "Notifications",
                                                  subtext: "Tells you when setup is done", state: .done, detail: "Allowed")
        static let notificationsOff = FormRow(id: "perm.notifications", title: "Notifications", subtext: "Tells you when setup is done",
                                              state: .done, detail: "Turned off",
                                              action: RowAction(type: .openSettings, label: "Open settings", target: "notifications"))
        static let fancyUrls = FormRow(id: "mac.fancy-urls", title: "Fancy URLs", subtext: "Grant mattstack apps permission to use .mattstack",
                                       state: .todo, detail: "Not set up yet",
                                       action: RowAction(type: .run, label: "Allow", verb: ["setup", "apply", "--only", "proxy.install"]),
                                       waiting: "Waiting for your admin password in the macOS dialog…", watch: true)
        static let fancyUrlsNoInstaller = FormRow(id: "mac.fancy-urls", title: "Fancy URLs",
                                                  subtext: "Grant mattstack apps permission to use .mattstack", state: .done,
                                                  detail: "This build has no local proxy installer, so apps serve on their own ports",
                                                  waiting: "Waiting for your admin password in the macOS dialog…", watch: true)
        static let fancyUrlsBrewFailed = FormRow(id: "mac.fancy-urls", title: "Fancy URLs",
                                                 subtext: "Grant mattstack apps permission to use .mattstack", state: .done,
                                                 detail: "Homebrew did not install. Tools that need it say so on their own rows",
                                                 waiting: "Waiting for your admin password in the macOS dialog…", watch: true)
        static let fancyUrlsAllowed = FormRow(id: "mac.fancy-urls", title: "Fancy URLs",
                                              subtext: "Grant mattstack apps permission to use .mattstack", state: .done, detail: "Allowed",
                                              waiting: "Waiting for your admin password in the macOS dialog…", watch: true)

        static let notifications = FormRow(id: "notifications", title: "Notifications", subtext: "Tells you when setup is done",
                                           state: .todo, detail: "Not asked yet",
                                           action: RowAction(type: .requestPermission, label: "Allow", which: "notifications", primary: true))
        static let slack = FormRow(id: "slack", title: "Slack", subtext: "Lets mattstack track and post MRs in Slack", state: .todo, detail: "",
                                   action: RowAction(type: .oauth, label: "Connect Slack", integration: "slack", verb: ["setup", "slack", "connect"]),
                                   waiting: "Waiting for Slack…", watch: true)
        static let claudeInstalling = FormRow(id: "claude", title: "Claude", subtext: "You know, to do agentic stuff.", state: .busy,
                                              detail: "Installing…", watch: true)
        static let claudeCode = FormRow(id: "claude", title: "Claude", subtext: "You know, to do agentic stuff.", state: .waiting,
                                        detail: "Finish signing in in your browser",
                                        action: RowAction(type: .form, label: "Paste code", fields: [
                                            ActionField(name: "code", label: "Code from your browser", secret: true),
                                        ], verb: ["setup", "claude", "code"]), watch: true)
        static let doppler = FormRow(id: "signin.doppler", title: "Doppler", subtext: "For running your dev servers", state: .waiting,
                                     detail: "Your code is WXYZ-1234. Confirm it in your browser",
                                     action: RowAction(type: .openURL, label: "Open again", url: "https://example.com/login"), watch: true)
        static let gitlab = FormRow(id: "forge", title: "GitLab", subtext: "Lets mattstack reach the team's repo and open MRs", state: .done,
                                    detail: "Connected as janedoe from your invite")
        static let fastBrowser = FormRow(id: "fast-browser", title: "Fast Browser", subtext: "Lets agents drive your real Chrome", state: .todo,
                                         detail: "", action: RowAction(type: .openURL, label: "Add to Chrome", url: "https://example.com/store"),
                                         waiting: "Waiting for Chrome…", watch: true)
        static let fastBrowserAdded = FormRow(id: "fast-browser", title: "Fast Browser", subtext: "Lets agents drive your real Chrome",
                                              state: .done, detail: "Added")
        static let linear = FormRow(id: "linear", title: "Linear", subtext: "So mattstack can read and write Linear tickets", state: .todo,
                                    detail: "", action: RowAction(type: .connect, label: "Connect", integration: "linear", fields: [
                                        ActionField(name: "apiKey", label: "API key", secret: true),
                                    ], create: ActionLink(label: "Create token", url: "https://example.com/settings/api")))
        static let backup = FormRow(id: "settings.backup", title: "Your settings",
                                    subtext: "mattstack keeps your settings in one folder. A private remote copy lets you restore them on a new Mac. You can turn this on later",
                                    state: .done, detail: "Keep on this Mac",
                                    action: RowAction(type: .choose, label: "Change", verb: ["setup", "home-backup"], options: [
                                        ChooseOption(id: "local", label: "Keep on this Mac", detail: ""),
                                        ChooseOption(id: "remote", label: "Store in a remote repo", detail: ""),
                                    ], selected: "local"))
        static let remote = FormRow(id: "settings.remote", title: "Remote repo", subtext: "Where the private copy lives", state: .todo,
                                    detail: "", action: RowAction(type: .form, label: "Use this repo", fields: [
                                        ActionField(name: "url", label: "Repo URL", secret: false, hint: "git@github.com:janedoe/mattstack-home.git"),
                                    ], alternatives: [ActionAlternative(id: "create", label: "Create a private GitHub repo")],
                                    verb: ["home", "remote", "set"]))
        static let repo = FormRow(id: "repos.place:github.com/acme/acme-api", title: "acme-api", subtext: "The board starts here", state: .done,
                                  detail: "~/code/acme-api",
                                  action: RowAction(type: .placeRepo, label: "Locate…", identity: "github.com/acme/acme-api", repo: "acme/acme-api",
                                                    mode: "checkout", checkoutPath: "~/code/acme-api", clonePath: "~/Documents/GitHub/acme-api",
                                                    note: "Found your checkout", board: "The board starts here", awaitsRun: true))
        static let repoClone = FormRow(id: "repos.place:github.com/acme/widgets", title: "widgets", subtext: "Shared settings and packs",
                                       state: .todo, detail: "",
                                       action: RowAction(type: .placeRepo, label: "Choose…", identity: "github.com/acme/widgets", repo: "acme/widgets",
                                                         mode: "clone", clonePath: "~/Documents/GitHub/widgets", note: "Clones when setup runs"))
        static let repoRoot = FormRow(id: "repos.root", title: "Your repos", subtext: "Where new clones go", state: .done,
                                      detail: "~/Documents/GitHub",
                                      action: RowAction(type: .chooseFolder, label: "Choose…", startAt: "~/Documents/GitHub"))
        static let repoRootLong = FormRow(id: "repos.root", title: "Your repos",
                                          subtext: "Where new clones go. Every repo mattstack clones for you lands in this folder, and you can move it later",
                                          state: .done, detail: "~/Documents/GitHub",
                                          action: RowAction(type: .chooseFolder, label: "Choose…", startAt: "~/Documents/GitHub"))
    }
    #endif
}
