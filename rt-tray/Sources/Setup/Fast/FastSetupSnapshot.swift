import AppKit
import SwiftUI
import MattstackCore

/// `rt-tray --render-fast-setup-snapshots <out-dir>` renders the fast setup
/// views from fixture rows as `<name>-<light|dark>.png`, then exits before any
/// window, status item, socket or daemon work exists. The window is dark only,
/// so both files draw the dark design. Screens render at their own height in
/// the mock's window chrome, at 2x and blended in sRGB like the mocks, so a
/// render lines up with its mock. DEBUG builds only.
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
                        .background(FastTheme.windowBackground)
                        .environment(\.colorScheme, .dark)
                        .environment(\.fastFlipsShadows, true)
                        .environment(\.fastHidesScrollers, true)
                        .controlSize(.large),
                    appearance: FastAppearance.window.name,
                    to: out.appendingPathComponent("\(name)-\(scheme).png"),
                    scale: 2, colorSpace: .sRGB)
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
    private static let registered: [@MainActor () -> [(String, AnyView)]] = [themePages, rowPages, macosPages, pathPages, invitePages, createPages, restorePages, waitingPages, connectPages, thisMacPages, runPages, readyPages, containerPages, testDrivePages]

    /// A screen body in the window the mocks draw: outline, rounded corners, title bar dots, glow.
    static func window(_ view: some View, _ screen: FastSetupScreen, path: String? = nil) -> AnyView {
        AnyView(FastSnapshotWindow { FastWindowChrome(step: FastStep.counter(for: screen, path: path)) { view } })
    }

    /// A card at a screen's 48-point side gutter, so its rows line up with the mocks' x positions.
    static func card(_ rows: [FormRow], title: String? = nil, waiting: [String: String] = [:], errors: [String: String] = [:],
                     style: FormRowStyle = .labelled) -> AnyView {
        AnyView(FormCard(title: title, rows: rows, waiting: waiting, errors: errors, style: style) { _, _, _ in }
            .padding(.horizontal, 48).padding(.vertical, 20))
    }

    /// FastTheme's shared views on their own, for the screens that build on them.
    @MainActor
    private static func themePages() -> [(String, AnyView)] {
        let kit = VStack(alignment: .leading, spacing: 18) {
            FastScreenHeader(title: "Three things from macOS", subtitle: "mattstack can't do these itself. It notices the moment you do")
            HStack(spacing: 10) {
                Button("Allow") {}.buttonStyle(FastPrimaryButtonStyle(size: .small))
                Button("Continue") {}.buttonStyle(FastPrimaryButtonStyle())
                Button("Continue") {}.buttonStyle(FastPrimaryButtonStyle()).disabled(true)
                Button("Hide") {}.buttonStyle(FastSecondaryButtonStyle(size: .large))
                Button("Retry") {}.buttonStyle(FastPrimaryButtonStyle(glow: false, shape: .retry))
                Button("Show log") {}.buttonStyle(FastSecondaryButtonStyle(size: .large, shape: .log))
            }
            HStack(spacing: 10) {
                Button { } label: { Label("Connect Slack", systemImage: "message") }.buttonStyle(FastOutlineButtonStyle())
                Button { } label: { Label("Sign in to Claude", systemImage: "arrow.right.to.line") }.buttonStyle(FastOutlineButtonStyle())
                Button("Create token") {}.buttonStyle(FastSecondaryButtonStyle())
                FastBusyChip(text: "Installing…")
            }
            HStack(spacing: 8) {
                FastField("API key", text: .constant("lin_api_\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}"), monospaced: true)
                FastField("Team name", text: .constant("Widgets"), size: .large)
                Button("Create token") {}.buttonStyle(FastSecondaryButtonStyle(shape: .besideLargeField))
            }
            HStack(spacing: 8) {
                FastField("Path", text: .constant("~/Documents/GitHub/widgets"), size: .slim, monospaced: true)
                Button("Change") {}.buttonStyle(FastSecondaryButtonStyle(shape: .slim))
            }
            FastField("Invite code", text: .constant("01234-56789-ABCDE"), size: .invite, monospaced: true)
            HStack(spacing: 12) {
                FastSegmented(options: [(id: "gitlab", label: "GitLab"), (id: "github", label: "GitHub")], selection: .constant("gitlab"))
                FastSegmented(options: [(id: "current", label: "Current checkout"), (id: "new", label: "New checkout")],
                              selection: .constant("new"), size: .small)
                FastTeamChip(name: "Mithrandir")
            }
            HStack(spacing: 14) {
                FastIconTile(symbol: "internaldrive", done: true)
                FastIconTile(symbol: "bell")
                FastIconTile(symbol: "globe")
                VStack(alignment: .leading, spacing: 6) {
                    FastHint("So mattstack can read and write Linear tickets")
                    FastDoneLine("Connected as janedoe from your invite")
                    FastDoneLine("On", size: 13, weight: .semibold, iconSize: 16)
                }
            }
            FormCard(title: "Your repos", rows: [Rows.gitlab, Rows.fastBrowserAdded]) { _, _, _ in }
        }
        return [("theme-kit", window(kit.padding(FastTheme.bodyInsets), .macos))]
    }

    @MainActor
    private static func rowPages() -> [(String, AnyView)] {
        [
            ("rows-tile", card([Rows.fdaGranted, Rows.notificationsAsk, Rows.fancyUrls], style: .tile)),
            ("rows-tile-long-done", card([Rows.fdaGranted, Rows.notificationsAllowed, Rows.fancyUrlsBrewFailed], style: .tile)),
            ("rows-tile-states", card([Rows.notificationsOff, Rows.fancyUrls, Rows.fda],
                                      waiting: [Rows.fancyUrls.id: Rows.fancyUrls.waiting ?? ""],
                                      errors: [Rows.fda.id: "System Settings did not open. Open it yourself, then come back"], style: .tile)),
            ("rows-p5", card([MockRows.gitlab, MockRows.slack, MockRows.claude, MockRows.doppler, MockRows.linear, MockRows.fastBrowser])),
            ("rows-p5s", card([MockRows.github, MockRows.claude, MockRows.repoRoot, MockRows.backup, MockRows.fastBrowser])),
            ("rows-p3-forge", AnyView(card([Rows.gitlabToken]).environment(\.fastLinkIcon, true))),
            ("rows-p5b", card([ThisMacRows.boardFound, ThisMacRows.widgetsClone, ThisMacRows.backupLocal], title: "Your repos")),
            ("rows-todo-reason", card([ConnectRows.slack, ConnectRows.dopplerSignIn, ConnectRows.sdm, ConnectRows.linear])),
            ("rows-repo-problem", card([ThisMacRows.widgetsMoved, ThisMacRows.boardFound], title: "Your repos",
                                       errors: [ThisMacRows.boardFound.id: "That folder is not a git checkout of acme-api"])),
            ("rows-off", card([Rows.notificationsOff, Rows.fdaGranted])),
            ("rows-busy-long", card([MockRows.busyLong, MockRows.waitingLong],
                                    waiting: [MockRows.waitingLong.id: MockRows.waitingLong.detail])),
            ("rows-todo", card([Rows.notifications, Rows.slack])),
            ("rows-busy", card([Rows.claudeInstalling])),
            ("rows-waiting", card([Rows.doppler, Rows.claudeCode])),
            ("rows-done", card([Rows.gitlab, Rows.fastBrowserAdded])),
            ("rows-todo-waiting", card([Rows.fastBrowser], waiting: [Rows.fastBrowser.id: "Waiting for Chrome…"])),
            ("rows-error", card([Rows.slack], errors: [Rows.slack.id: "Slack didn't answer. Try again"])),
            ("rows-running", AnyView(card([ConnectRows.slack, Rows.clt], waiting: [ConnectRows.slack.id: "Waiting for Slack…", Rows.clt.id: "Installing Command Line Tools…"])
                .environment(\.formRowsRunning, [ConnectRows.slack.id, Rows.clt.id]))),
            ("rows-connect", card([Rows.linear])),
            ("rows-choose", card([Rows.backup, Rows.remote])),
            ("rows-repo", card([Rows.repo, Rows.repoClone], title: "Your repos")),
            ("rows-folder", card([Rows.repoRoot])),
            ("rows-done-action", card([Rows.repoRootLong])),
            ("rows-done-long-path", card([ThisMacRows.repoRootLongPath, ThisMacRows.remoteDoneLongURL])),
            ("rows-choose-waiting", card([Rows.backup], waiting: [Rows.backup.id: "Saving…"])),
            ("card-connect", AnyView(connectScreen)),
            ("footer-ready", AnyView(FastFooter(screen: "this-mac", note: "About 10 minutes once you start",
                                                secondary: ("Back", {}), primary: ("Set up this Mac", true, {})))),
        ]
    }

    /// P5 with the mock's own rows, so the render lines up with P5-connect.png.
    @MainActor
    private static var connectScreen: some View {
        window(ConnectScreenBody(teamFirst: true, rows: [MockRows.gitlab, MockRows.slack, MockRows.claude, MockRows.doppler,
                                                         MockRows.linear, MockRows.fastBrowser],
                                 waiting: [:], errors: [:], continueReady: true,
                                 onAction: { _, _, _ in }, onBack: nil, onContinue: {}),
               .connect, path: "join")
    }

    @MainActor
    private static func macosPages() -> [(String, AnyView)] {
        func page(_ rows: [FormRow], waiting: [String: String] = [:]) -> AnyView {
            window(MacOSScreenBody(rows: rows, waiting: waiting, errors: [:]) { _, _, _ in }, .macos)
        }
        return [
            ("macos-fresh", page([Rows.fda, Rows.notificationsAsk, Rows.fancyUrls])),
            ("macos-as-mock", page([Rows.fdaGranted, Rows.notificationsAsk, Rows.fancyUrls])),
            ("macos-waiting-admin", page([Rows.fdaGranted, Rows.notificationsAllowed, Rows.fancyUrls],
                                         waiting: [Rows.fancyUrls.id: Rows.fancyUrls.waiting ?? ""])),
            ("macos-done", page([Rows.fdaGranted, Rows.notificationsAllowed, Rows.fancyUrlsAllowed])),
            ("macos-notifications-off", page([Rows.fdaGranted, Rows.notificationsOff, Rows.fancyUrls])),
            ("macos-fancy-urls-long-detail", window(VStack(spacing: 0) {
                MacOSScreenBody(rows: [Rows.fdaGranted, Rows.notificationsAllowed, Rows.fancyUrlsNoInstaller], waiting: [:], errors: [:]) { _, _, _ in }
                card([Rows.fancyUrlsBrewFailed]).padding(.top, -32)
            }, .macos)),
        ]
    }

    @MainActor
    private static func pathPages() -> [(String, AnyView)] {
        [
            ("path", window(PathScreenBody(showsSolo: true) { _ in }, .path)),
            ("path-picked", window(PathScreenBody(showsSolo: true, selected: .create) { _ in }, .path)),
            ("path-upgrade", window(PathScreenBody(showsSolo: false) { _ in }, .path)),
            ("path-failure", window(PathScreenBody(showsSolo: true, failure: "rt couldn't record the choice: the settings store is locked by another run") { _ in }, .path)),
        ]
    }

    @MainActor
    private static func invitePages() -> [(String, AnyView)] {
        let code = "01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567-89ABC-DEFGH-JKMNP-QRSTV-WXYZ0-12345-6789A-BC"
        let line = "Mithrandir, invited by Jane Doe"
        /// `hasGoodVerdict` is what the container reads from `TeamChoiceModel.hasGoodVerdict`.
        func page(_ code: String, hasGoodVerdict: Bool = false, line: String? = nil, failure: String? = nil, checking: Bool = false,
                  rows: [FormRow]? = nil, waiting: [String: String] = [:]) -> AnyView {
            let enabled = FastSetupFlow.joinEnabled(verdictOK: hasGoodVerdict, rows: rows)
            return window(InviteScreenBody(code: .constant(code), inviteLine: line, failure: failure, isChecking: checking,
                                           rows: rows, waiting: waiting, errors: [:], joinEnabled: enabled,
                                           onPaste: {}, onAction: { _, _, _ in }, onBack: {}, onJoin: {}), .invite)
        }
        return [
            ("invite-empty", page("")),
            ("invite-as-mock", page("ms-join-7KQ4-XW2P-9D", hasGoodVerdict: true, line: line, rows: [Rows.gitlabToken])),
            ("invite-checking", page(code, checking: true)),
            ("invite-failed", page(code, failure: "Invite not recognized or expired: ask Jane Doe for a new one.")),
            ("invite-read-no-section", page(code, hasGoodVerdict: true, line: line)),
            ("invite-read", page(code, hasGoodVerdict: true, line: line, rows: [Rows.gitlabToken])),
            ("invite-clt-busy", page(code, hasGoodVerdict: true, line: line, rows: [Rows.cltInstalling, Rows.gitlabTokenConnected])),
            ("invite-clt-todo", page(code, hasGoodVerdict: true, line: line, rows: [Rows.clt, Rows.githubToken])),
            ("invite-ready", page(code, hasGoodVerdict: true, line: line, rows: [Rows.gitlabTokenConnected])),
            ("invite-self-hosted", page(code, hasGoodVerdict: true, line: line, rows: [Rows.gitlabTokenUnconfirmed])),
        ]
    }

    @MainActor
    private static func createPages() -> [(String, AnyView)] {
        /// `canCreateTeam` is what the container reads from `TeamChoiceModel.canCreateTeam`.
        func page(name: String = "", forge: String = "gitlab", group: String = "", rows: [FormRow]?,
                  creating: Bool = false, failure: String? = nil) -> AnyView {
            let canCreateTeam = !Slug.make(name).isEmpty && !group.trimmingCharacters(in: .whitespaces).isEmpty
            let enabled = FastSetupFlow.createEnabled(nameAndGroup: canCreateTeam, rows: rows)
            return window(CreateTeamScreenBody(name: .constant(name), forge: .constant(forge), group: .constant(group), rows: rows,
                                               waiting: [:], errors: [:], isCreating: creating, failure: failure, createEnabled: enabled,
                                               onAction: { _, _, _ in }, onBack: {}, onCreate: {}), .createTeam)
        }
        return [
            ("create-empty", page(rows: [Rows.gitlabToken])),
            ("create-as-mock", page(name: "Mithrandir", group: "acme", rows: [Rows.gitlabToken])),
            ("create-clt-busy", page(name: "Widgets", group: "acme", rows: [Rows.cltInstalling, Rows.gitlabToken])),
            ("create-github", page(name: "Widgets", forge: "github", group: "acme", rows: [Rows.githubToken])),
            ("create-filled", page(name: "Widgets", group: "acme", rows: [Rows.gitlabTokenCreated])),
            ("create-creating", page(name: "Widgets", group: "acme", rows: [Rows.gitlabTokenCreated], creating: true)),
            ("create-error", page(name: "Widgets", group: "acme", rows: [Rows.gitlabTokenCreated],
                                  failure: "This token cannot see acme on GitLab")),
        ]
    }

    @MainActor
    private static func restorePages() -> [(String, AnyView)] {
        let repo = "janedoe/mattstack-home"
        /// A stand-in, never a real-looking key: the field only draws dots.
        let key = "placeholder"
        func page(repo: String = "", key: String = "", rows: [FormRow]?, restoring: Bool = false, failure: String? = nil) -> AnyView {
            let enabled = FastSetupFlow.restoreEnabled(repo: repo, key: key, rows: rows)
            return window(RestoreScreenBody(repo: .constant(repo), key: .constant(key), rows: rows, waiting: [:], errors: [:],
                                            isRestoring: restoring, failure: failure, restoreEnabled: enabled,
                                            onAction: { _, _, _ in }, onBack: {}, onRestore: {}), .restore)
        }
        return [
            ("restore-empty", page(rows: [])),
            ("restore-as-mock", page(repo: "gitlab.com/janedoe/mattstack-home", key: "AGE-SECRET-KEY-1PLACEHOLDERVALUE", rows: [])),
            ("restore-clt-busy", page(repo: repo, key: key, rows: [Rows.cltInstalling])),
            ("restore-ready", page(repo: repo, key: key, rows: [])),
            ("restore-restoring", page(repo: repo, key: key, rows: [], restoring: true)),
            ("restore-error", page(repo: repo, key: key, rows: [],
                                   failure: "That recovery key does not unlock janedoe/mattstack-home")),
        ]
    }

    @MainActor
    private static func waitingPages() -> [(String, AnyView)] {
        [
            ("waiting", window(WaitingScreenBody(team: "Mithrandir", admin: "Jane Doe", onHide: {}), .waiting)),
            ("waiting-no-admin", window(WaitingScreenBody(team: "Mithrandir", admin: nil, onHide: {}), .waiting)),
            ("waiting-no-team", window(WaitingScreenBody(team: "", admin: "Jane Doe", onHide: {}), .waiting)),
        ]
    }

    @MainActor
    private static func connectPages() -> [(String, AnyView)] {
        typealias C = ConnectRows
        func page(team: Bool = true, _ rows: [FormRow], waiting: [String: String] = [:], ready: Bool = false) -> AnyView {
            window(ConnectScreenBody(teamFirst: team, rows: rows, waiting: waiting, errors: [:], continueReady: ready,
                                     onAction: { _, _, _ in }, onBack: team ? nil : {}, onContinue: {}),
                   .connect, path: team ? "join" : "solo")
        }
        return [
            ("connect-fresh", page([C.forge, C.slack, C.claudeInstalling, C.dopplerSignIn, C.herdrInstalling, C.sdm, C.linear, C.fastBrowser])),
            ("connect-waiting", page([C.forge, C.slack, C.claudePasteCode, C.dopplerCode, C.sdm, C.linearDone, C.fastBrowser],
                                     waiting: [C.slack.id: C.slack.waiting ?? "", C.fastBrowser.id: C.fastBrowser.waiting ?? ""])),
            ("connect-done", page([C.forge, C.slackDone, C.claudeDone, C.dopplerDone, C.linearDone, C.fastBrowserDone], ready: true)),
            ("connect-solo", page(team: false, [C.soloForge, C.claudeSignIn, C.soloFastBrowser])),
            ("connect-solo-mock", page(team: false, [MockRows.github, MockRows.claude, MockRows.fastBrowser])),
            ("connect-get-chrome", page([C.forge, C.slackDone, C.claudeDone, C.dopplerDone, C.linearDone, C.getChrome])),
            ("connect-steps", page([C.forge, C.slackDone, C.claudeDone, C.newerAction, C.linearDone, C.fastBrowserSteps])),
            ("connect-newer-action-only", page([C.forge, C.slackDone, C.claudeDone, C.newerAction, C.linearDone, C.fastBrowserDone])),
            ("sheet-steps", sheet(StepsSheet(title: C.fastBrowserSteps.title, steps: C.fastBrowserSteps.action?.steps ?? []))),
            ("sheet-steps-terminal", sheet(StepsSheet(title: Rows.gitlabTokenUnconfirmed.title, steps: Rows.gitlabTokenUnconfirmed.action?.steps ?? []))),
            ("sheet-choose", sheet(ChooseSheet(row: FormRowPlan.planRow(Self.wideChoice), submitLabel: "Choose") { _ in nil })),
            ("sheet-choose-suggestions", sheet(ChooseSheet(row: FormRowPlan.planRow(Self.ownChoice), submitLabel: "Choose",
                                                           suggestionsOpen: true) { _ in nil })),
            ("sheet-choose-styles", sheet(ChooseSheet(row: FormRowPlan.planRow(Self.styleChoice)) { _ in nil })),
            ("sheet-log", sheet(LogSheet(title: RunPaused.clone.title, lines: RunPaused.clone.log))),
        ]
    }

    /// A sheet as fast setup opens it, in a sheet's rounded outline on the window fill.
    static func sheet(_ view: some View) -> AnyView {
        let shape = RoundedRectangle(cornerRadius: FastTheme.windowRadius, style: .continuous)
        return AnyView(view.environment(\.fastSheet, true)
            .clipShape(shape)
            .overlay(shape.strokeBorder(FastTheme.outline, lineWidth: 1))
            .padding(.vertical, 24))
    }

    @MainActor
    private static func thisMacPages() -> [(String, AnyView)] {
        typealias T = ThisMacRows
        func page(team: String? = "Mithrandir", _ rows: [FormRow], ready: Bool) -> AnyView {
            window(ThisMacScreenBody(teamName: team, solo: team == nil, rows: rows, waiting: [:], errors: [:], startReady: ready,
                                     onAction: { _, _, _ in }, onBack: {}, onStart: {}),
                   .thisMac, path: team == nil ? "solo" : "join")
        }
        return [
            ("this-mac", page([T.boardFound, T.widgetsClone, T.backupLocal], ready: true)),
            ("this-mac-as-mock", page([T.mockWidgetsFound, T.mockApiClone, T.backupLocal], ready: true)),
            ("this-mac-unanswered", page([T.widgetsUnanswered, T.apiUnanswered, T.backupUnanswered], ready: false)),
            ("this-mac-backup-on-mac", page([T.boardFound, T.widgetsClone, T.backupOnMac], ready: true)),
            ("this-mac-backup-github", page([T.boardFound, T.widgetsClone, T.backupGitHub, T.remoteCreates], ready: true)),
            ("this-mac-found-and-unanswered", page([T.boardFound, T.widgetsUnanswered, T.backupLocal], ready: false)),
            ("this-mac-remote", page([T.boardFound, T.widgetsClone, T.backupRemote, T.remoteTodo], ready: false)),
            ("this-mac-solo", page(team: nil, [Rows.cltInstalling, T.repoRoot, T.backupSolo], ready: false)),
            ("this-mac-repo-problem", page([T.boardFound, T.widgetsMoved, T.backupLocal], ready: false)),
            ("this-mac-leftover", page([T.boardFoundAfterRun, T.widgetsFoundAfterRun, T.backupLocal, T.shellLeftover], ready: false)),
            ("this-mac-backup-leftover", page([T.boardFoundAfterRun, T.widgetsFoundAfterRun, T.backupLocal, T.backupLeftover], ready: false)),
        ]
    }

    /// A choose wider than a segment, which the fast screens open in a sheet.
    static let wideChoice = FormRow(id: "editor", title: "Your editor", subtext: "Where Open in editor goes", state: .done, detail: "Zed",
                                    action: RowAction(type: .choose, label: "Change", verb: ["setup", "editor"], options: [
                                        ChooseOption(id: "zed", label: "Zed", detail: "Opens files at the line"),
                                        ChooseOption(id: "cursor", label: "Cursor", detail: "Opens the folder, then the file"),
                                        ChooseOption(id: "vscode", label: "VS Code", detail: "Opens the folder, then the file"),
                                    ], selected: "zed"))

    /// rt's writing-style presets with their samples; the last sample carries a link, which draws in the accent.
    static let styleChoice = FormRow(id: "skills.writing-style", title: "Writing style", subtext: "How drafted replies read", state: .todo,
                                     detail: "Not chosen yet",
                                     action: RowAction(type: .choose, label: "Choose style…", verb: ["skills", "writing-style", "use"], options: [
                                         ChooseOption(id: "mattstack:writing-style-sparse", label: "Sparse",
                                                      detail: "Terse, lowercase for technical points, one tight paragraph per finding.",
                                                      sample: "**issue:** cache is keyed on userId alone, so two tenants share an entry. key on (tenant, id)?"),
                                         ChooseOption(id: "mattstack:writing-style-conversational", label: "Conversational",
                                                      detail: "Short, friendly sentences in sentence case, like talking to a teammate.",
                                                      sample: "**issue:** The cache is keyed on userId alone, so two tenants can share an entry. Could we key on both?"),
                                         ChooseOption(id: "mattstack:writing-style-structured", label: "Structured",
                                                      detail: "Labelled lines and short bullets for teams that like formal write-ups.",
                                                      sample: "**issue:** Settings leak across tenants. Why: the cache key omits the tenant. Suggestion: key on (tenant, id). See [the cache notes](https://example.com/cache)."),
                                     ], selected: "mattstack:writing-style-sparse",
                                     other: ChooseOther(label: "Use my own skill…", hint: "Any installed skill id. Start one with rt skills writing-style new."),
                                     subtitle: "The voice agents use for reviews, replies and PR descriptions posted under your name.",
                                     footnote: "You can also choose from a terminal: rt skills writing-style use"))

    /// A choose whose own-id card is open on a partial id, so its suggestions show.
    static let ownChoice = FormRow(id: "skills.writing-style", title: "Writing style", subtext: "How drafted replies read", state: .done,
                                   detail: "acme:writing",
                                   action: RowAction(type: .choose, label: "Change", verb: ["skills", "writing-style", "use"], options: [
                                       ChooseOption(id: "mattstack:writing-style-sparse", label: "Sparse", detail: "Short and plain"),
                                   ], selected: "acme:writing",
                                   other: ChooseOther(label: "Use my own skill…", hint: "A skill id from an installed plugin",
                                                      suggestions: ["acme:writing-plain", "acme:writing-terse", "widgets:acme-writing"])))

    @MainActor
    private static func readyPages() -> [(String, AnyView)] {
        func page(_ home: FormHome) -> AnyView {
            window(ReadyScreenBody(home: home, onOpen: {}), .ready)
        }
        return [
            ("ready", page(FormHome(label: "Open the board", url: "https://board.mattstack"))),
            ("ready-solo", page(FormHome(label: "Open the console", url: "https://console.mattstack"))),
        ]
    }

    @MainActor
    private static func runPages() -> [(String, AnyView)] {
        func page(_ bar: RunBar?, paused: FormPaused? = nil) -> AnyView {
            window(RunScreenBody(bar: bar, paused: paused, onHide: {}, onShowLog: {}, onRetry: {}, onPausedAction: { _ in }),
                   paused == nil ? .running : .paused, path: "join")
        }
        let cloning = RunBar(fraction: 0.42, message: "Cloning your repos", secondsLeft: 230)
        return [
            ("run-starting", page(nil)),
            ("run-early", page(RunBar(fraction: 0.03, message: "Getting your team's settings", secondsLeft: nil))),
            ("run-mid", page(cloning)),
            ("run-late", page(RunBar(fraction: 0.93, message: "Installing Claude plugins", secondsLeft: 40))),
            ("paused", page(cloning, paused: RunPaused.clone)),
            ("paused-login-items", page(RunBar(fraction: 0.97, message: "Starting mattstack", secondsLeft: nil), paused: RunPaused.loginItems)),
            ("paused-after-relaunch", page(nil, paused: RunPaused.clone)),
            ("paused-after-progress", page(RunPaused.heldBar(), paused: RunPaused.clone)),
            ("run-as-mock", page(RunBar(fraction: 0.58, message: "Cloning your repos", secondsLeft: 240))),
            ("paused-as-mock", window(RunScreenBody(bar: RunBar(fraction: 0.64, message: "Cloning your repos", secondsLeft: nil),
                                                    paused: RunPaused.mockClone, onHide: {}, onShowLog: {}, onRetry: {}, onPausedAction: { _ in }),
                                      .paused, path: "create")),
        ]
    }

    /// The whole window, through `FastSetupView`, on each screen rt's fixture form lands on.
    @MainActor
    private static func containerPages() -> [(String, AnyView)] {
        typealias C = ConnectRows
        typealias T = ThisMacRows
        let code = "01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567-89ABC-DEFGH-JKMNP-QRSTV-WXYZ0-12345-6789A-BC"
        return [
            ("container-loading", Container().window()),
            ("container-loading-failed", Container(failing: true).loaded(nil).window()),
            ("container-macos", Container().landed(.macos, Container.whole(.macos, sections: FormSections(macos: [Rows.fdaGranted, Rows.notificationsAsk, Rows.fancyUrls]))).window()),
            ("container-path", Container().landed(.path, Container.whole(.path)).window()),
            ("container-invite", Container().landed(.invite, Container.whole(.invite, sections: FormSections(invite: [Rows.cltInstalling, Rows.gitlabTokenConnected])))
                .invite(code).window()),
            ("container-create-team", Container().landed(.path, Container.whole(.path)).picking(.create)
                .absorbing(Container.section(FormSections(create: [Rows.gitlabTokenCreated]))).named("Widgets", group: "acme").window()),
            ("container-restore", Container().landed(.path, Container.whole(.path)).picking(.restore)
                .absorbing(Container.section(FormSections(restore: []))).restoring("janedoe/mattstack-home").window()),
            ("container-waiting", Container().landed(.waiting, Container.whole(.waiting)).window()),
            ("container-connect", Container().landed(.connect, Container.whole(.connect, sections: FormSections(
                connect: [C.forge, C.slack, C.claudeInstalling, C.dopplerSignIn, C.linear, C.fastBrowser]))).window()),
            ("container-this-mac", Container().landed(.thisMac, Container.whole(.thisMac, sections: FormSections(
                thisMac: [T.boardFound, T.widgetsClone, T.backupLocal]), startReady: true)).window()),
            ("container-running", Container().landed(.running, Container.whole(.running)).running(Container.cloning, startedAgo: 120).window()),
            ("container-paused", Container().landed(.paused, Container.whole(.paused, paused: RunPaused.clone))
                .running(Container.cloning + Container.cloneFailed, startedAgo: 140).window()),
            ("container-paused-after-relaunch", Container().landed(.paused, Container.whole(.paused, paused: RunPaused.clone)).window()),
            ("container-ready", Container().landed(.ready, Container.whole(.ready)).window()),
            ("container-connect-short", Container().landed(.connect, Container.whole(.connect, sections: FormSections(
                connect: [C.forge, C.slack, C.claudeInstalling, C.dopplerSignIn, C.linear, C.fastBrowser]))).window(height: 420)),
        ]
    }

    /// One window's models, built from fixtures. Its rt answers only the invite's dry run and never spawns.
    @MainActor
    final class Container {
        let flow = FastSetupFlow(entry: .firstRun)
        let form: SetupFormModel
        let actions: FormActionRunner
        let install: InstallRunModel
        let team: TeamChoiceModel
        let status = FastSetupStatus()
        private let rt: SnapshotRt
        private var lines: [String] = []

        init(failing: Bool = false) {
            let rt = SnapshotRt(failing: failing)
            self.rt = rt
            let needs = NeedBroker(services: StubServicesProvider(), privileged: StubPrivilegedInstaller())
            form = SetupFormModel(rt: rt)
            actions = FormActionRunner(rt: rt, needs: needs, effects: SnapshotEffects(), reload: {})
            install = InstallRunModel(stream: { _ in rt.stream([], stdin: nil) }, needs: needs)
            team = TeamChoiceModel(rt: rt, pasteboard: SystemPasteboard())
        }

        func landed(_ stage: FormStage, _ read: SetupForm) -> Container {
            form.absorb(read)
            flow.land(on: stage)
            return self
        }

        func loaded(_ section: String?) -> Container {
            Task { await form.load(section: section) }
            Container.settle { !self.form.isLoading && self.form.error != nil }
            return self
        }

        func absorbing(_ read: SetupForm) -> Container {
            form.absorb(read)
            return self
        }

        func picking(_ choice: TeamChoice) -> Container {
            team.choice = choice
            flow.choose(choice)
            return self
        }

        func named(_ name: String, group: String) -> Container {
            team.teamName = name
            team.group = group
            return self
        }

        func restoring(_ repo: String) -> Container {
            team.restoreRepo = repo
            team.restoreAgeKey = "placeholder"
            return self
        }

        func invite(_ code: String) -> Container {
            team.choice = .join
            team.inviteCode = code
            Task { await team.previewInvite() }
            Container.settle { self.team.hasGoodVerdict }
            return self
        }

        func running(_ lines: [String], startedAgo seconds: TimeInterval) -> Container {
            rt.streamLines = lines
            status.runStartedAt = Date().addingTimeInterval(-seconds)
            install.start()
            let ends = lines.contains { $0.contains(#""event":"done""#) }
            Container.settle {
                self.install.steps.contains { $0.id == "repos.clone" && ($0.progress != nil || $0.state == .failed) }
                    && (!ends || !self.install.isRunning)
            }
            return self
        }

        /// The window's content at its own height, as the live window fits it.
        func page() -> AnyView {
            AnyView(FastSetupView(flow: flow, form: form, actions: actions, install: install, team: team, status: status, handlers: .inert))
        }

        /// `page` in the mock's window outline; `height` caps it as a short screen would, to show the body scrolling.
        func window(height: CGFloat? = nil) -> AnyView {
            AnyView(FastSnapshotWindow { page().frame(height: height) })
        }

        /// Lets the models' main-actor work land before the page renders.
        static func settle(until done: () -> Bool) {
            let deadline = Date().addingTimeInterval(2)
            while !done(), Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.02)) }
        }

        static let home = FormHome(label: "Open the board", url: "https://board.mattstack")
        static let team = FormTeam(slug: "mithrandir", name: "Mithrandir", invitedBy: "Jane Doe")

        static func whole(_ stage: FormStage, sections: FormSections = FormSections(), startReady: Bool = false, paused: FormPaused? = nil) -> SetupForm {
            SetupForm(path: stage == .path ? nil : "join", team: stage == .path ? nil : team, stage: stage, sections: sections,
                      continueReady: false, startReady: startReady, paused: paused, home: home)
        }

        static func section(_ sections: FormSections) -> SetupForm {
            SetupForm(path: nil, team: nil, stage: nil, sections: sections, home: home)
        }

        private static func plan() -> String {
            let steps = [("org.pull", "Getting your team's settings", 2), ("path.link", "Setting up rt", 3), ("repos.clone", "Cloning your repos", 10),
                         ("plugins.install", "Installing Claude plugins", 6), ("verify", "Checking everything", 2)]
            let listed = steps.map { #"{"id":"\#($0.0)","title":"\#($0.0)","kind":"rt","phase":"\#($0.1)","weight":\#($0.2)}"# }
            return #"{"event":"plan","steps":[\#(listed.joined(separator: ","))]}"#
        }

        static let cloning = [
            plan(),
            #"{"event":"step","id":"org.pull","state":"done"}"#,
            #"{"event":"step","id":"path.link","state":"done"}"#,
            #"{"event":"step","id":"repos.clone","state":"running","detail":"Cloning acme-api (1 of 2)"}"#,
            #"{"event":"progress","id":"repos.clone","label":"Receiving objects","percent":60}"#,
        ]
        static let cloneFailed = [
            #"{"event":"step","id":"repos.clone","state":"failed","detail":"GitLab says your token can't see acme/acme-api"}"#,
            #"{"event":"done","ok":false,"failedStep":"repos.clone"}"#,
        ]
    }

    /// Answers the invite's dry run, fails the form read when asked to, and streams only the lines a page sets.
    final class SnapshotRt: RtRunning, @unchecked Sendable {
        let failing: Bool
        var streamLines: [String] = []
        init(failing: Bool) { self.failing = failing }

        func run(_ args: [String], stdin: Data?) async throws -> RtResult {
            if args.starts(with: ["team", "join", "--dry-run"]) {
                let reply = #"{"team":{"slug":"mithrandir","name":"Mithrandir","owner":"Jane Doe"},"access":"ok","intent":"written","message":"Joining Mithrandir"}"#
                return RtResult(exitCode: 0, stdout: Data(reply.utf8), stderr: Data())
            }
            if failing { return RtResult(exitCode: 1, stdout: Data(), stderr: Data("could not read ~/.mattstack/rt/setup-state.json".utf8)) }
            throw RtClientError.spawnFailed("snapshots run no rt")
        }

        /// Never finishes: a page's run stays live, as one still streaming would.
        func stream(_ args: [String], stdin: Data?) -> AsyncThrowingStream<String, Error> {
            let lines = streamLines
            return AsyncThrowingStream { cont in for line in lines { cont.yield(line) } }
        }
    }

    struct SnapshotEffects: FormEffects {
        @MainActor func openURL(_ url: URL) {}
        @MainActor func openSettings(_ target: String) {}
        func requestPermission(_ which: String) async -> Bool { false }
    }

    /// What `pausedFor` in lib/setup/form.ts emits, its titles from `STEP_PHASES` in lib/setup/run-phases.ts.
    enum RunPaused {
        static let clone = FormPaused(step: "repos.clone", title: "Couldn't clone your repos",
                                      detail: "GitLab says your token can't see acme/acme-api",
                                      log: ["cloning acme/widgets", "cloning acme/acme-api", "remote: The project you were looking for could not be found"])
        /// P6b's own words, for the parity page.
        static let mockClone = FormPaused(step: "repos.clone", title: "Couldn't clone acme-api",
                                          detail: "GitLab says your token can't see acme/acme-api")
        static let loginItems = FormPaused(step: "services.start", title: "Couldn't start mattstack",
                                           detail: "The daemon is waiting for approval in Login Items",
                                           remedy: "Approve the background item in Login Items, then Retry",
                                           action: RowAction(type: .openSettings, label: "Open Login Items…", target: "login-items"))

        /// The clone fails at 60% of its own work: the raw bar drops that share, the drawn bar holds where it was.
        static func heldBar() -> RunBar {
            func steps(clone state: StepState, percent: Int?) -> [InstallStep] {
                func step(_ id: String, _ phase: String, _ weight: Double, _ state: StepState, _ percent: Int? = nil) -> InstallStep {
                    InstallStep(info: StepInfo(id: id, title: id, kind: .rt, phase: phase, weight: weight), state: state,
                                progress: percent.map { StepProgress(label: "", percent: $0, note: nil) })
                }
                return [step("org.pull", "Getting your team's settings", 2, .done), step("path.link", "Setting up rt", 3, .done),
                        step("repos.clone", "Cloning your repos", 10, state, percent), step("plugins.install", "Installing Claude plugins", 6, .pending),
                        step("verify", "Checking everything", 2, .pending)]
            }
            let before = RunProgress.bar(steps: steps(clone: .running, percent: 60), elapsed: 120)
            return RunProgress.monotonic(previous: before.fraction, current: RunProgress.bar(steps: steps(clone: .failed, percent: nil), elapsed: 121))
        }
    }

    /// What `thisMacRows` in lib/setup/form.ts emits, its repo rows from `repos.place` in lib/setup/validators/repos.ts.
    enum ThisMacRows {
        /// rt sends absolute paths and the screen shortens them under HOME, so the render reads `~/code/acme-api` like the mock.
        static let home = NSHomeDirectory()
        private static let settingsSubtext = "mattstack keeps your settings in one folder. A private remote copy lets you restore them on a new Mac. You can turn this on later"
        private static func backupAction(_ selected: String) -> RowAction {
            RowAction(type: .choose, label: "Change", verb: ["setup", "home-backup"], options: [
                ChooseOption(id: "local", label: "Keep on this Mac", detail: ""),
                ChooseOption(id: "remote", label: "Store in a remote repo", detail: ""),
            ], selected: selected)
        }
        private static let labels = PlaceRepoLabels(checkout: "Locate…", checkoutAgain: "Locate again…", clone: "Choose…")
        /// Before Install has run, a segment switch records and no `then` run follows.
        static let boardFound = FormRow(id: "repos.place:github.com/acme/acme-api", title: "acme-api", subtext: "The board starts here",
                                        state: .done, detail: "Found your acme-api checkout",
                                        action: RowAction(type: .placeRepo, label: "Locate…", identity: "github.com/acme/acme-api", repo: "acme-api",
                                                          mode: "checkout", checkoutPath: "\(home)/code/acme-api",
                                                          clonePath: "\(home)/Documents/GitHub/acme-api", note: "Found your acme-api checkout",
                                                          segmentRecords: true, board: "The board starts here", awaitsRun: false, labels: labels))
        static let widgetsClone = FormRow(id: "repos.place:github.com/acme/widgets", title: "widgets", subtext: "github.com/acme",
                                          state: .done, detail: "rt clones it here when setup runs",
                                          action: RowAction(type: .placeRepo, label: "Choose…", identity: "github.com/acme/widgets", repo: "widgets",
                                                            mode: "clone", clonePath: "\(home)/Documents/GitHub/widgets",
                                                            note: "rt clones it here when setup runs", segmentRecords: true, awaitsRun: false, labels: labels))
        static let boardFoundAfterRun = FormRow(id: "repos.place:github.com/acme/acme-api", title: "acme-api", subtext: "The board starts here",
                                                state: .done, detail: "Found your acme-api checkout",
                                                action: RowAction(type: .placeRepo, label: "Locate…", identity: "github.com/acme/acme-api", repo: "acme-api",
                                                                  mode: "checkout", checkoutPath: "\(home)/code/acme-api",
                                                                  clonePath: "\(home)/Documents/GitHub/acme-api", note: "Found your acme-api checkout",
                                                                  then: ["setup", "apply", "--only", "board.restart"], segmentRecords: false,
                                                                  board: "The board starts here", awaitsRun: false, labels: labels))
        static let widgetsFoundAfterRun = FormRow(id: "repos.place:github.com/acme/widgets", title: "widgets", subtext: "github.com/acme",
                                                  state: .done, detail: "Found your widgets checkout",
                                                  action: RowAction(type: .placeRepo, label: "Locate…", identity: "github.com/acme/widgets", repo: "widgets",
                                                                    mode: "checkout", checkoutPath: "\(home)/Documents/GitHub/widgets",
                                                                    clonePath: "\(home)/Documents/GitHub/widgets-2", note: "Found your widgets checkout",
                                                                    then: ["setup", "apply", "--only", "repos.clone"], segmentRecords: false, awaitsRun: false, labels: labels))
        /// The P5b mock's two repos, in its order and words, so a render lines up with the mock.
        static let mockWidgetsFound = FormRow(id: "repos.place:github.com/acme/widgets", title: "widgets", subtext: "The board starts here",
                                              state: .done, detail: "Found your checkout",
                                              action: RowAction(type: .placeRepo, label: "Locate…", identity: "github.com/acme/widgets", repo: "widgets",
                                                                mode: "checkout", checkoutPath: "\(home)/code/widgets",
                                                                clonePath: "\(home)/Documents/GitHub/widgets", note: "Found your checkout",
                                                                segmentRecords: true, board: "The board starts here", awaitsRun: false, labels: labels))
        static let mockApiClone = FormRow(id: "repos.place:github.com/acme/acme-api", title: "acme-api", subtext: "",
                                          state: .done, detail: "Cloned here when you click Set up this Mac",
                                          action: RowAction(type: .placeRepo, label: "Choose…", identity: "github.com/acme/acme-api", repo: "acme-api",
                                                            mode: "clone", clonePath: "\(home)/code/acme-api",
                                                            note: "Cloned here when you click Set up this Mac", segmentRecords: true, awaitsRun: false,
                                                            labels: labels))
        /// A new Mac: rt's clone path is only its default, so the row asks clone-or-checkout first.
        static let widgetsUnanswered = FormRow(id: "repos.place:github.com/acme/widgets", title: "widgets", subtext: "github.com/acme",
                                               state: .todo, detail: "rt clones it here when setup runs",
                                               action: RowAction(type: .placeRepo, label: "Choose…", identity: "github.com/acme/widgets", repo: "widgets",
                                                                 mode: "clone", clonePath: "\(home)/Documents/GitHub/widgets",
                                                                 note: "rt clones it here when setup runs", segmentRecords: true, awaitsRun: false,
                                                                 answered: false, labels: labels))
        static let apiUnanswered = FormRow(id: "repos.place:github.com/acme/acme-api", title: "acme-api", subtext: "The board starts here",
                                           state: .todo, detail: "rt clones it here when setup runs",
                                           action: RowAction(type: .placeRepo, label: "Choose…", identity: "github.com/acme/acme-api", repo: "acme-api",
                                                             mode: "clone", clonePath: "\(home)/Documents/GitHub/acme-api",
                                                             note: "rt clones it here when setup runs", segmentRecords: true,
                                                             board: "The board starts here", awaitsRun: false, answered: false, labels: labels))
        /// A recorded checkout that moved since: rt's problem is the row's detail and note.
        static let widgetsMoved = FormRow(id: "repos.place:github.com/acme/widgets", title: "widgets", subtext: "github.com/acme",
                                          state: .todo, detail: "~/old/widgets isn't a git checkout.",
                                          action: RowAction(type: .placeRepo, label: "Locate again…", identity: "github.com/acme/widgets", repo: "widgets",
                                                            mode: "checkout", checkoutPath: "\(home)/old/widgets",
                                                            clonePath: "\(home)/Documents/GitHub/widgets", note: "~/old/widgets isn't a git checkout.",
                                                            problem: "~/old/widgets isn't a git checkout.", segmentRecords: true, awaitsRun: false,
                                                            labels: labels))
        static let repoRoot = FormRow(id: "repos.root", title: "Repos go in", subtext: "Where new clones go", state: .done,
                                      detail: "\(home)/Documents/GitHub",
                                      action: RowAction(type: .chooseFolder, label: "Choose…", startAt: "\(home)/Documents/GitHub"))
        static let repoRootLongPath = FormRow(id: "repos.root", title: "Repos go in", subtext: "Where new clones go", state: .done,
                                              detail: "\(home)/Library/Mobile Documents/com~apple~CloudDocs/Projects/clients/acme/engineering/checkouts/team-widgets",
                                              action: RowAction(type: .chooseFolder, label: "Choose…", startAt: "\(home)/Documents/GitHub"))
        private static func backupTiles(_ selected: String?) -> RowAction {
            RowAction(type: .choose, label: "Change", verb: ["setup", "home-backup"], options: [
                ChooseOption(id: "remote", label: "Store in a GitHub repo", detail: "Private. A new Mac restores from it"),
                ChooseOption(id: "local", label: "Store on your Mac", detail: "Your settings won't be backed up", warn: true),
            ], selected: selected)
        }
        static let backupUnanswered = FormRow(id: "settings.backup", title: "Your settings", subtext: settingsSubtext, state: .todo,
                                              detail: "", action: backupTiles(nil))
        static let backupOnMac = FormRow(id: "settings.backup", title: "Your settings", subtext: settingsSubtext, state: .done,
                                         detail: "Store on your Mac", action: backupTiles("local"))
        static let backupGitHub = FormRow(id: "settings.backup", title: "Your settings", subtext: settingsSubtext, state: .done,
                                          detail: "Store in a GitHub repo", action: backupTiles("remote"))
        static let remoteCreates = FormRow(id: "settings.remote", title: "Remote repo", subtext: "Where the private copy lives", state: .done,
                                           detail: "rt creates a private GitHub repo when setup runs", action: nil)
        static let backupLocal = FormRow(id: "settings.backup", title: "Your settings", subtext: settingsSubtext, state: .done,
                                         detail: "Keep on this Mac", action: backupAction("local"))
        static let backupSolo = FormRow(id: "settings.backup", title: "Back up home", subtext: settingsSubtext, state: .done,
                                        detail: "Keep on this Mac", action: backupAction("local"))
        static let backupRemote = FormRow(id: "settings.backup", title: "Your settings", subtext: settingsSubtext, state: .done,
                                          detail: "Store in a remote repo", action: backupAction("remote"))
        static let remoteTodo = FormRow(id: "settings.remote", title: "Remote repo", subtext: "Where the private copy lives", state: .todo, detail: "",
                                        action: RowAction(type: .form, label: "Use this repo", fields: [
                                            ActionField(name: "url", label: "Repo URL", secret: false, hint: "git@github.com:janedoe/mattstack-home.git"),
                                        ], alternatives: [ActionAlternative(id: "create", label: "Create a private GitHub repo")],
                                        verb: ["home", "remote", "set"]))
        static let remoteDoneLongURL = FormRow(id: "settings.remote", title: "Remote repo", subtext: "Where the private copy lives", state: .done,
                                               detail: "https://gitlab.example.com/janedoe/personal/backups/machines/laptop/mattstack-home-settings-backup.git")
        /// A leftover keeps rt's own row copy and action: `extraRow` in lib/setup/form.ts.
        static let shellLeftover = FormRow(id: "tool.shell", title: "Shell integration",
                                           subtext: "The rtcd alias and PATH precedence come from your shell rc file.", state: .todo,
                                           detail: "Shell integration not added yet",
                                           action: RowAction(type: .run, label: "Add to shell", verb: ["setup", "apply", "--only", "path.link"]),
                                           watch: true)
        /// A push that did not land: `HOME_BACKUP_PUSH_ACTION` in lib/setup/validators/rt-health.ts.
        static let backupLeftover = FormRow(id: "home.backup", title: "Home repo backup",
                                            subtext: "Shows whether your settings are backed up off this Mac. Keeping them local only is fine.",
                                            state: .todo, detail: "Remote set, nothing pushed yet",
                                            action: RowAction(type: .steps, label: "Show steps…", steps: [
                                                "git -C ~/.mattstack/user push origin HEAD, or wait for the daemon to push on its next cycle (up to 30 minutes)",
                                            ]), watch: true)
    }

    /// What `connectRows` in lib/setup/form.ts emits for a GitLab team with Doppler, StrongDM and Linear, and for Just me.
    enum ConnectRows {
        static let forge = FormRow(id: "forge", title: "GitLab", subtext: "Lets mattstack reach the team's repo and open MRs",
                                   state: .done, detail: "Connected as janedoe from your invite")
        static let soloForge = FormRow(id: "forge", title: "GitHub", subtext: "Optional. Lets mattstack open PRs and MRs",
                                       state: .todo, detail: "No GitHub account connected yet", action: Rows.githubToken.action, optional: true)
        static let slack = FormRow(id: "slack", title: "Slack", subtext: "Lets mattstack track and post MRs in Slack", state: .todo,
                                   detail: "No Slack account connected yet. If Slack rejects the redirect, add http://localhost:11234/callback in the app's OAuth settings",
                                   action: RowAction(type: .oauth, label: "Connect Slack", integration: "slack", verb: ["setup", "slack", "connect"]),
                                   waiting: "Waiting for Slack…", watch: true)
        static let slackDone = FormRow(id: "slack", title: "Slack", subtext: "Lets mattstack track and post MRs in Slack", state: .done,
                                       detail: "Connected", waiting: "Waiting for Slack…", watch: true)
        static let claudeInstalling = FormRow(id: "claude", title: "Claude", subtext: "You know, to do agentic stuff.", state: .busy,
                                              detail: "Installing…", watch: true)
        static let claudeSignIn = FormRow(id: "claude", title: "Claude", subtext: "You know, to do agentic stuff.", state: .todo,
                                          detail: "Not signed in yet",
                                          action: RowAction(type: .run, label: "Sign in to Claude", verb: ["setup", "claude", "connect"]), watch: true)
        static let claudePasteCode = FormRow(id: "claude", title: "Claude", subtext: "You know, to do agentic stuff.", state: .waiting,
                                             detail: "Finish signing in in your browser",
                                             action: RowAction(type: .form, label: "Paste code", fields: [
                                                 ActionField(name: "code", label: "Code from your browser", secret: true),
                                             ], verb: ["setup", "claude", "code"]), watch: true)
        static let claudeDone = FormRow(id: "claude", title: "Claude", subtext: "You know, to do agentic stuff.", state: .done,
                                        detail: "Claude Code 2.1.0, signed in", watch: true)
        static let dopplerSignIn = FormRow(id: "signin.doppler", title: "Doppler", subtext: "For running your dev servers", state: .todo,
                                           detail: "Not signed in to doppler",
                                           action: RowAction(type: .run, label: "Sign in", verb: ["setup", "doppler", "connect"]), watch: true)
        static let dopplerCode = FormRow(id: "signin.doppler", title: "Doppler", subtext: "For running your dev servers", state: .waiting,
                                         detail: "Your code is WXYZ-1234. Confirm it in your browser",
                                         action: RowAction(type: .openURL, label: "Open again", url: "https://dashboard.doppler.com/workplace/auth/cli"),
                                         watch: true)
        static let dopplerDone = FormRow(id: "signin.doppler", title: "Doppler", subtext: "For running your dev servers", state: .done,
                                         detail: "Signed in to doppler", watch: true)
        static let herdrInstalling = FormRow(id: "tool.herdr", title: "herdr", subtext: "Drives Herdr panes for remote-control and multi-agent workflows.",
                                             state: .busy, detail: "Installing…", watch: true)
        static let sdm = FormRow(id: "account.sdm", title: "StrongDM",
                                 subtext: "Lets rt confirm you're logged into StrongDM before driving database tunnels.", state: .todo,
                                 detail: "No StrongDM account connected yet",
                                 action: RowAction(type: .connect, label: "Connect", integration: "sdm", fields: [
                                     ActionField(name: "email", label: "StrongDM email", secret: false),
                                 ]), watch: true)
        static let linear = FormRow(id: "linear", title: "Linear", subtext: "So mattstack can read and write Linear tickets", state: .todo,
                                    detail: "No Linear account connected yet",
                                    action: RowAction(type: .connect, label: "Connect", integration: "linear", fields: [
                                        ActionField(name: "apiKey", label: "Linear API key", secret: true, hint: "lin_api_…"),
                                    ], create: ActionLink(label: "Create token", url: "https://linear.app/settings/account/security")))
        static let linearDone = FormRow(id: "linear", title: "Linear", subtext: "So mattstack can read and write Linear tickets", state: .done,
                                        detail: "Connected")
        private static let addToChrome = RowAction(type: .openURL, label: "Add to Chrome",
                                                   url: "https://chromewebstore.google.com/detail/fnfikoifhimpdedpdepehibjjkcfbacm",
                                                   waiting: "Waiting for Chrome…", again: "Open again", primary: true)
        static let fastBrowser = FormRow(id: "fast-browser", title: "Fast Browser", subtext: "Lets agents drive your real Chrome", state: .todo,
                                         detail: "Not installed in Chrome", action: addToChrome, waiting: "Waiting for Chrome…", watch: true)
        static let soloFastBrowser = FormRow(id: "fast-browser", title: "Fast Browser", subtext: "Lets agents drive your real Chrome", state: .todo,
                                             detail: "Not installed in Chrome", action: addToChrome, waiting: "Waiting for Chrome…", watch: true,
                                             optional: true)
        static let fastBrowserDone = FormRow(id: "fast-browser", title: "Fast Browser", subtext: "Lets agents drive your real Chrome", state: .done,
                                             detail: "Added", watch: true)
        static let getChrome = FormRow(id: "fast-browser", title: "Fast Browser", subtext: "Lets agents drive your real Chrome", state: .todo,
                                       detail: "Google Chrome is not installed",
                                       action: RowAction(type: .openURL, label: "Get Chrome", url: "https://www.google.com/chrome/"), watch: true)
        /// doctor can't read Chrome's profile: `FAST_BROWSER_PROFILE_ACCESS_STEPS` in lib/setup/validators/tools.ts.
        static let fastBrowserSteps = FormRow(id: "fast-browser", title: "Fast Browser", subtext: "Lets agents drive your real Chrome", state: .todo,
                                              detail: "Installed, but Fast Browser can't read Chrome's profile yet",
                                              action: RowAction(type: .steps, label: "Show steps…", steps: [
                                                  "Turn on Full Disk Access for mattstack in System Settings, then Re-check",
                                              ]), watch: true)
        /// An action type from an rt newer than this app.
        static let newerAction = FormRow(id: "tool.team.acme-cli", title: "acme-cli", subtext: "Runs acme's dev servers", state: .todo,
                                         detail: "Not installed", action: RowAction(type: .unknown, label: "Install"), watch: true)
    }

    /// The rows the P5 and P5s mocks draw, with no reason lines, so a render lines up with its mock row by row.
    enum MockRows {
        /// Lines wider than the control column: each wraps inside its chip and never leaves the card.
        static let busyLong = FormRow(id: "tool.team.acme-cli", title: "acme-cli", subtext: "Runs acme's dev servers", state: .busy,
                                      detail: "Installing acme-cli from the team's Homebrew tap, then linking it into your PATH so every shell finds it…")
        static let waitingLong = FormRow(id: "signin.doppler", title: "Doppler", subtext: "For running your dev servers", state: .waiting,
                                         detail: "Your code is WXYZ-1234. Confirm it in your browser, then come back here and this row turns green",
                                         action: RowAction(type: .openURL, label: "Sign in", url: "https://example.com/login", again: "Open again"))
        static let gitlab = FormRow(id: "forge", title: "GitLab", subtext: "Lets mattstack reach the team's repo and open MRs", state: .done,
                                    detail: "Connected as janedoe from your invite")
        static let github = FormRow(id: "forge", title: "GitHub", subtext: "Optional. Lets mattstack open PRs and MRs", state: .done,
                                    detail: "Using your gh sign-in. Optional", optional: true)
        static let slack = FormRow(id: "slack", title: "Slack", subtext: "Lets mattstack track and post MRs in Slack", state: .todo, detail: "",
                                   action: RowAction(type: .oauth, label: "Connect Slack", integration: "slack", verb: ["setup", "slack", "connect"]))
        static let claude = FormRow(id: "claude", title: "Claude", subtext: "You know, to do agentic stuff.", state: .todo, detail: "",
                                    action: RowAction(type: .run, label: "Sign in to Claude", verb: ["setup", "claude", "connect"]))
        static let doppler = FormRow(id: "signin.doppler", title: "Doppler", subtext: "For running your dev servers", state: .busy,
                                     detail: "Installing…")
        static let linear = FormRow(id: "linear", title: "Linear", subtext: "So mattstack can read and write Linear tickets", state: .todo,
                                    detail: "", action: RowAction(type: .connect, label: "Connect", integration: "linear", fields: [
                                        ActionField(name: "apiKey", label: "Linear API key", secret: true, hint: "lin_api_…",
                                                    value: "lin_api_placeholders"),
                                    ], create: ActionLink(label: "Create token", url: "https://example.com/settings/api")))
        static let fastBrowser = FormRow(id: "fast-browser", title: "Fast Browser", subtext: "Lets agents drive your real Chrome", state: .todo,
                                         detail: "", action: RowAction(type: .openURL, label: "Add to Chrome", url: "https://example.com/store"))
        static let repoRoot = FormRow(id: "repos.root", title: "Repos go in", subtext: "Where mattstack keeps the repos you add", state: .done,
                                      detail: "~/code", action: RowAction(type: .chooseFolder, label: "Change", startAt: "~/code"))
        static let backup = FormRow(id: "settings.backup", title: "Back up home", subtext: "Keeps your settings safe if this Mac is lost",
                                    state: .done, detail: "Private GitHub repo",
                                    action: RowAction(type: .choose, label: "Change", verb: ["setup", "home-backup"], options: [
                                        ChooseOption(id: "remote", label: "Private GitHub repo", detail: ""),
                                        ChooseOption(id: "local", label: "Only this Mac", detail: ""),
                                    ], selected: "remote"))
    }

    enum Rows {
        static let clt = FormRow(id: "tool.clt", title: "Git tools", subtext: "Gives setup git and Apple's build tools",
                                 state: .todo, detail: "Not installed yet",
                                 action: RowAction(type: .install, label: "Install", tool: "apple-clt", via: "apple-clt"), watch: true)
        static let cltInstalling = FormRow(id: "tool.clt", title: "Git tools", subtext: "Gives setup git and Apple's build tools",
                                           state: .busy, detail: "Installing Command Line Tools…", watch: true)
        static let gitlabToken = FormRow(id: "forge.token", title: "GitLab", subtext: "Lets mattstack reach the team's repo and open MRs",
                                         state: .todo, detail: "No GitLab account connected yet",
                                         action: RowAction(type: .connect, label: "Connect", integration: "gitlab", fields: [
                                             ActionField(name: "token", label: "GitLab token", secret: true, hint: "api"),
                                         ], create: ActionLink(label: "Create token",
                                                               url: "https://gitlab.com/-/user_settings/personal_access_tokens?name=mattstack&scopes=api%2Cread_api%2Cread_user%2Cread_repository%2Cwrite_repository%2Cai_features")))
        static let gitlabTokenConnected = FormRow(id: "forge.token", title: "GitLab", subtext: "Lets mattstack reach the team's repo and open MRs",
                                                  state: .done, detail: "Connected as janedoe")
        /// A self-hosted invite host this Mac has not confirmed: `forgeAccountRow` in lib/setup/form.ts.
        static let gitlabTokenUnconfirmed = FormRow(id: "forge.token", title: "GitLab", subtext: "Lets mattstack reach the team's repo and open MRs",
                                                    state: .todo, detail: "Connect gitlab.example.com from the terminal first",
                                                    action: RowAction(type: .steps, label: "Show steps…", steps: [
                                                        "Run: rt setup gitlab connect --host gitlab.example.com",
                                                        "This confirms the host yourself before rt talks to it",
                                                    ]))
        static let gitlabTokenCreated = FormRow(id: "forge.token", title: "GitLab", subtext: "Lets mattstack reach the team's repo and open MRs",
                                                state: .done, detail: "Connected")
        static let githubToken = FormRow(id: "forge.token", title: "GitHub", subtext: "Lets mattstack reach the team's repo and open PRs",
                                         state: .todo, detail: "No GitHub account connected yet",
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
                                              state: .done, tone: .off, detail: "Turned off",
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
        static let repo = ThisMacRows.boardFound
        static let repoClone = ThisMacRows.widgetsClone
        static let repoRoot = FormRow(id: "repos.root", title: "Repos go in", subtext: "Where new clones go", state: .done,
                                      detail: "~/Documents/GitHub",
                                      action: RowAction(type: .chooseFolder, label: "Choose…", startAt: "~/Documents/GitHub"))
        static let repoRootLong = FormRow(id: "repos.root", title: "Repos go in",
                                          subtext: "Where new clones go. Every repo mattstack clones for you lands in this folder, and you can move it later",
                                          state: .done, detail: "~/Documents/GitHub",
                                          action: RowAction(type: .chooseFolder, label: "Choose…", startAt: "~/Documents/GitHub"))
    }
    #endif
}
