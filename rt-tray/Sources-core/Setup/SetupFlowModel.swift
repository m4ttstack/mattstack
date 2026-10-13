import Foundation
import Combine

public enum SetupStep: Int, CaseIterable, Sendable {
    case welcome, team, checklist, install, done

    public var title: String {
        switch self {
        case .welcome: return "Welcome to mattstack"
        case .team: return "Your team"
        case .checklist: return "Before we begin"
        case .install: return "Installing"
        case .done: return "All set"
        }
    }
}

/// Distinguishes onboarding from re-entering setup to upgrade an existing
/// solo install to a team (Settings' Create/Join, a join link post-install).
public enum SetupEntry: Equatable, Sendable { case firstRun, upgrade }

/// Custom page model: push transitions, Back never dismisses, the window
/// only closes once setup is done.
@MainActor
public final class SetupFlowModel: ObservableObject {
    @Published public var step: SetupStep = .welcome
    @Published public var isInstalling = false
    /// True while the checklist screen has an outstanding
    /// `readiness.becameVisible()`. Both the step-transition site (entering
    /// or leaving `.checklist`) and the window-close site read and clear
    /// this same flag, so a `becameHidden()` from either one only ever
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
    /// The Done model's `finishEnabled`, mirrored in by the setup view: the
    /// window controller observes only the flow, and restyles the titlebar's
    /// close and minimize buttons off `windowMayClose` whenever this moves.
    /// One boolean for both, so the buttons can never disagree with Finish.
    @Published public var finishGateOpen = true
    /// An upgrade re-enters at `.team` with nothing behind it to walk back
    /// into, so Back is off there even though the step itself allows it on
    /// first run.
    @Published public var entry: SetupEntry = .firstRun
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

    /// Welcome and Your team, then every page, then Install and the summary.
    /// Before a plan lands the checklist counts as one page.
    public var progress: (current: Int, total: Int)? {
        guard !readOnly else { return nil }
        let pageCount = max(pages.ids.count, 1)
        let current: Int
        switch step {
        case .welcome: current = 1
        case .team: current = 2
        case .checklist: current = 3 + (page.flatMap { pages.index(of: $0) } ?? 0)
        case .install: current = 3 + pageCount
        case .done: current = 4 + pageCount
        }
        return (current, 4 + pageCount)
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
        if let n = SetupStep(rawValue: step.rawValue + 1) { step = n }
    }

    public func back() {
        guard canGoBack else { return }
        if step == .checklist, let page, let previous = pages.previous(before: page) { show(page: previous); return }
        if let p = SetupStep(rawValue: step.rawValue - 1) { step = p }
    }

    /// `landing` is for a relaunch back into setup: the next plan to land
    /// picks the page, since the old page index did not survive the relaunch.
    public func jump(to s: SetupStep, landing: Bool = false) {
        step = s
        if landing { landsOnBlocker = true }
    }

    private func show(page id: String) {
        page = id
        lastPageIndex = pages.index(of: id)
    }
}
