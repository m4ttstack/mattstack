import Foundation
import Combine

public enum SetupStep: Int, CaseIterable, Sendable {
    case welcome, fullDiskAccess, team, join, checklist, install, done

    public var title: String {
        switch self {
        case .welcome: return "Welcome to mattstack"
        case .fullDiskAccess: return "Full Disk Access"
        case .team: return "Your team"
        case .join: return "Join your team"
        case .checklist: return "Before we begin"
        case .install: return "Installing"
        case .done: return "Summary"
        }
    }
}

/// Distinguishes onboarding from re-entering setup to upgrade an existing
/// solo install to a team (Settings' Create/Join, a join link post-install),
/// and from opening Setup status on a Mac that may already be set up.
public enum SetupEntry: Equatable, Sendable { case firstRun, upgrade, status }

/// Custom page model: push transitions, Back never dismisses, the window
/// only closes once setup is done.
@MainActor
public final class SetupFlowModel: ObservableObject {
    @Published public var step: SetupStep = .welcome
    @Published public var isInstalling = false
    /// True while a screen that reads readiness (Full Disk Access, the
    /// checklist, the summary) has an outstanding
    /// `readiness.becameVisible()`. Both the step-transition site and the
    /// window-close site read and clear this same flag, so a
    /// `becameHidden()` from either one only ever
    /// fires when a matching `becameVisible()` is still open — never an
    /// extra decrement that could steal another window's share of
    /// `ReadinessModel`'s shared visibility depth count.
    public var readinessIsVisible = false
    /// The "Setup status…" window renders screen 3 as a health view, not as a
    /// wizard step: there is no flow behind it to walk back into, and its
    /// primary button closes. A Continue here would advance into `.install`
    /// and start a real `rt setup apply` — whose next `start()` SIGTERMs the
    /// previous process, killing a live install the onboarding window owns.
    public let readOnly: Bool
    /// `DoneModel.finishEnabled`, mirrored in by the setup view: the
    /// window controller observes only the flow, and restyles the titlebar's
    /// close and minimize buttons off `windowMayClose` whenever this moves.
    /// One boolean for both, so the buttons can never disagree with Finish.
    @Published public var finishGateOpen = true
    /// An upgrade re-enters at `.team` with nothing behind it to walk back
    /// into, so Back is off there even though the step itself allows it on
    /// first run.
    @Published public var entry: SetupEntry = .firstRun
    @Published public var joining = false
    /// Set while a window opening on the checklist asks whether this Mac is
    /// still waiting on its team admin: nothing on the checklist may run
    /// before that answer, since approval-wait rows block Finish, not Install.
    @Published public var resolvingJoin = false
    public var holdsChecklist: Bool { resolvingJoin && step == .checklist }
    /// The checklist page on screen: a plan group's id. nil until a plan lands.
    @Published public var page: String?
    @Published public private(set) var pages = WizardPages()
    private var lastPageIndex: Int?
    private var landsOnBlocker = false
    public init(readOnly: Bool = false) { self.readOnly = readOnly }

    public var headerTitle: String {
        if readOnly { return "Setup status" }
        if step == .checklist, let page, let title = pages.titles[page] { return title }
        return step.title
    }

    /// An upgrade re-enters a Mac that already granted Full Disk Access on
    /// its first run, so that step is first run only.
    public var steps: [SetupStep] {
        SetupStep.allCases.filter { s in
            switch s {
            case .fullDiskAccess: return entry == .firstRun
            case .join: return joining
            default: return true
            }
        }
    }

    /// Every step in `steps`, with the checklist counted as each of its
    /// pages. Before a plan lands the checklist counts as one page.
    public var progress: (current: Int, total: Int)? {
        guard !readOnly else { return nil }
        let steps = steps
        let pageCount = max(pages.ids.count, 1)
        let index = steps.firstIndex(of: step) ?? steps.filter { $0.rawValue < step.rawValue }.count
        let pagesBefore = steps[..<index].contains(.checklist) ? pageCount - 1 : 0
        let pageOffset = step == .checklist ? (page.flatMap { pages.index(of: $0) } ?? 0) : 0
        return (index + 1 + pagesBefore + pageOffset, steps.count + pageCount - 1)
    }

    public var headerIndicator: String? { progress.map { "Step \($0.current) of \($0.total)" } }

    public var isLastPage: Bool { page.map { pages.isLast($0) } ?? true }

    public var showsBack: Bool { !readOnly }
    public var primaryClosesWindow: Bool { readOnly }
    public var mayStartInstall: Bool { !readOnly }

    public var canGoBack: Bool {
        guard !readOnly else { return false }
        switch step {
        case .welcome, .done: return false
        case .install: return !isInstalling
        case .team: return entry == .firstRun
        default: return true
        }
    }
    public var continueTitle: String {
        if readOnly { return "Close" }
        switch step {
        case .checklist: return isLastPage ? "Install" : "Continue"
        case .done: return "Finish"
        default: return "Continue"
        }
    }
    public var windowMayClose: Bool { step == .done && finishGateOpen }

    public func setPages(_ groups: [PlanGroup]) {
        pages = WizardPages(groups: groups)
        if landsOnBlocker, !pages.ids.isEmpty {
            landsOnBlocker = false
            page = WizardPages.landing(groups: groups)
        } else {
            page = pages.current(preferred: page, lastIndex: lastPageIndex)
        }
        lastPageIndex = page.flatMap { pages.index(of: $0) }
    }

    public func next() {
        if step == .checklist, let page, let following = pages.next(after: page) { show(page: following); return }
        guard let n = steps.first(where: { $0.rawValue > step.rawValue }) else { return }
        // The window outlives a finished run, so the page it ended on is still set when setup is entered again.
        if n == .checklist { page = pages.ids.first; lastPageIndex = page == nil ? nil : 0 }
        step = n
    }

    public func back() {
        guard canGoBack else { return }
        if step == .checklist, let page, let previous = pages.previous(before: page) { show(page: previous); return }
        if let p = steps.last(where: { $0.rawValue < step.rawValue }) { step = p }
    }

    /// `landing` is for a relaunch back into setup: the next plan to land
    /// picks the page, since the old page index did not survive the relaunch.
    /// A wizard that already has its pages keeps the one it is on: a latch
    /// set there would move the person at the next re-read, right after they
    /// pressed a row's button.
    public func jump(to s: SetupStep, landing: Bool = false) {
        step = s
        if landing, pages.ids.isEmpty { landsOnBlocker = true }
    }

    private func show(page id: String) {
        page = id
        lastPageIndex = pages.index(of: id)
    }
}
