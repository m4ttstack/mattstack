# Setup Wizard Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First-run setup shows one short page per plan group, then Install, then the sidebar summary; Setup status uses the same sections.

**Architecture:** Three pure pieces in `MattstackCore` decide everything: `ChecklistSorting` (which section a row belongs to), `ChecklistLayout` (sections, sidebar entries, marks, summary line) and `WizardPages` (page list, order, landing page, gating). `SetupFlowModel` holds the current page inside the existing `.checklist` step. `ChecklistScreen` stays the one view that runs row actions and hosts sheets, and gains two presentations: a wizard page and the sidebar (used by Setup status and, with an Overview, by the last step). rt does not change.

**Tech Stack:** Swift 5.9, SwiftUI on AppKit, the `mattstack-checks` executable for core logic, XCUITest (`mattstackUITests`) on the stub rt, bash for the VM walkthrough driver.

**Spec:** `docs/superpowers/specs/2026-10-13-setup-wizard-pages-design.md`. Boards: `docs/apps/design/setup/setup.pen` (G0 to G2, H1 to H6).

## Global Constraints

- All work is under `rt-tray/`. No file under `lib/`, `commands/` or the plan contract changes.
- A warning mark appears only on a "Needs you" heading. Rows carry no status icon. Optional rows never carry a warning.
- Section titles, exactly: `Needs you`, `Optional`, `No action needed · N`.
- Badges, exactly: `Required`, `Before you finish`.
- Footer copy, exactly: `N required items left on this page.` (`1 required item left on this page.` for one) and `Nothing required on this page.`
- "Continue in limited mode" is removed.
- Settings > Accounts (`scope == .accounts`) keeps its flat `Form`.
- Every row keeps an element with id `setup.checklist.row.<id>.status` whose accessibility value is the status raw value, even though no icon is drawn: the VM walkthrough and the UI tests read it.
- Existing accessibility ids keep their names wherever the control survives (`AccessibilityIDs.swift` is a contract).
- Comments state only a constraint the code cannot show.
- Run core checks from `rt-tray/` with `swift run mattstack-checks`. In a fresh worktree run `bash scripts/fetch-deps.sh arm64` from the repo root first, or the Sparkle binary target is missing.
- Tray UI is looked at through `bun scripts/build-dev-app.ts --local --yes`, then Matt clicks **New build · Restart**. Never run the tray binary by hand.
- Commit after every task. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A plan that changes under the user.** A group appears or disappears after a row action (Access appears once a token is stored). Expected: the current page is kept by id; if it left the plan, the wizard shows the page now at that position, never a blank page. Pinned in Task 2.
2. **A row that is running when the user moves on.** Continue is pressed while a row's verb is still running, or its action fails after the page changed. Expected: the row's state survives; on the summary the group's sidebar entry shows running or failed. Pinned in Task 3 (marks) and Task 4 (errors kept per row).
3. **rt vetoes Install with every row ready.** `canInstall` is false though no row blocks. Expected: Install on the last page stays off and the footer says why, never a dead button with "Nothing required on this page." Pinned in Task 2.
4. **A plan with one group, or none yet.** Before the first plan lands, or a plan with a single group. Expected: the header still reads sensibly, the single page's button is Install, Back returns to Your team. Pinned in Task 2.
5. **A status from a newer rt.** An unknown status decodes as `error`. Expected: an optional row in `error` shows under Optional with its detail in red, never under No action needed. Pinned in Task 1.

---

## File Structure

| File | Responsibility |
|---|---|
| `Sources-core/Readiness/ChecklistSorting.swift` (new) | Which section a row belongs to, and its badge |
| `Sources-core/Readiness/ChecklistLayout.swift` (rewrite) | Sections, sidebar entries and marks, selection, summary line |
| `Sources-core/Setup/WizardPages.swift` (new) | Page list, order, landing page, per-page gating and footer copy |
| `Sources-core/Setup/SetupFlowModel.swift` (modify) | Current page, header title, counter, progress, next and back across pages |
| `Sources-core/Readiness/ReadinessModel.swift` (modify) | Drop `limitedModeAvailable` |
| `Sources/Setup/Components/ChecklistSections.swift` (new) | The three-section view and its row |
| `Sources/Setup/Screens/ChecklistScreen.swift` (modify) | Page and sidebar presentations; errors per row |
| `Sources/Setup/Screens/SummaryOverview.swift` (new) | The Overview pane (what the Installed screen carried) |
| `Sources/Setup/Screens/DoneScreen.swift` (delete) | Replaced; `SkipConfirmSheet` moves to `SummaryOverview.swift` |
| `Sources/Setup/SetupView.swift` (modify) | Header counter and progress bar, footer gating, wiring |
| `Sources/AccessibilityIDs.swift` (modify) | New ids; remove `continueLimited` and the `stillToDo` ids |
| `Sources/Setup/ChecklistRowSnapshot.swift` (modify) | Snapshot in the new sections |
| `Tests/MattstackCoreChecks/*` | Checks for every core piece |
| `Tests/mattstackUITests/SetupFlowUITests.swift` (modify) | Page through the wizard; summary assertions |
| `vm/run/guest/ax.sh`, `vm/run/guest/screens.sh`, `vm/check-vm-scripts.sh` (modify) | Walkthrough pages through the wizard |

---

### Task 1: Sort rows into sections, and rebuild the layout on it

**Files:**
- Create: `rt-tray/Sources-core/Readiness/ChecklistSorting.swift`
- Modify: `rt-tray/Sources-core/Readiness/ChecklistLayout.swift` (whole file)
- Create: `rt-tray/Tests/MattstackCoreChecks/ChecklistSortingChecks.swift`
- Modify: `rt-tray/Tests/MattstackCoreChecks/ChecklistLayoutChecks.swift` (whole file)
- Modify: `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift`
- Modify: `rt-tray/Sources/Setup/Screens/ChecklistScreen.swift` (compile fix only, see Step 5)

**Interfaces:**
- Produces:
  - `enum RowSection { case needsYou, optional, noAction }`
  - `enum NeedBadge: String { case required = "Required", beforeFinish = "Before you finish" }`
  - `ChecklistSorting.blocksInstall(_ row: PlanRow) -> Bool`
  - `ChecklistSorting.section(for row: PlanRow, finishBlockedBy: Set<String>) -> RowSection`
  - `ChecklistSorting.badge(for row: PlanRow, finishBlockedBy: Set<String>) -> NeedBadge?`
  - `ChecklistLayout.make(_ groups: [PlanGroup], finishBlockedBy: [String] = []) -> ChecklistLayout`
  - `ChecklistLayout.Section { id, title, needsYou: [PlanRow], optional: [PlanRow], noAction: [PlanRow], count: Int }`
  - `ChecklistLayout.attention: [Attention]` (rows in Needs you, plan order)
  - `ChecklistLayout.summary: [SummaryPart]`, `SummaryPart { kind: SummaryKind, text: String }`, `enum SummaryKind { case needsYou, ready, optional, notNeeded }`
  - Entries, marks and selection are added in Task 3.

- [ ] **Step 1: Write the failing sorting checks**

`rt-tray/Tests/MattstackCoreChecks/ChecklistSortingChecks.swift`:

```swift
import Foundation
import MattstackCore

private func row(_ id: String, _ status: RowStatus, required: Bool = false, action: ActionType? = nil,
                 finishGated: Bool = false) -> PlanRow {
    PlanRow(id: id, kind: .tool, title: id, why: "w", required: required, status: status,
            action: action.map { RowAction(type: $0, label: "Do") }, recheck: .manual, finishGated: finishGated)
}

let checklistSortingChecks: [Check] = [
    Check("ChecklistSorting: a required row that is not ready blocks Install and needs you") { c in
        let r = row("a", .missing, required: true, action: .run)
        c.expect(ChecklistSorting.blocksInstall(r))
        c.expectEqual(ChecklistSorting.section(for: r, finishBlockedBy: []), .needsYou)
        c.expectEqual(ChecklistSorting.badge(for: r, finishBlockedBy: []), .required)
    },
    Check("ChecklistSorting: a required row with no action still needs you") { c in
        c.expectEqual(ChecklistSorting.section(for: row("a", .error, required: true), finishBlockedBy: []), .needsYou)
    },
    Check("ChecklistSorting: a row blocking Finish needs you with its own badge, and never blocks Install") { c in
        let r = row("style", .needsYou, action: .choose, finishGated: true)
        c.expect(!ChecklistSorting.blocksInstall(r))
        c.expectEqual(ChecklistSorting.section(for: r, finishBlockedBy: ["style"]), .needsYou)
        c.expectEqual(ChecklistSorting.badge(for: r, finishBlockedBy: ["style"]), .beforeFinish)
    },
    Check("ChecklistSorting: a required finish-gated row does not block Install") { c in
        c.expect(!ChecklistSorting.blocksInstall(row("x", .missing, required: true, finishGated: true)))
    },
    Check("ChecklistSorting: an optional row with something to press is Optional") { c in
        c.expectEqual(ChecklistSorting.section(for: row("a", .needsYou, action: .openSettings), finishBlockedBy: []), .optional)
        c.expectEqual(ChecklistSorting.section(for: row("b", .missing, action: .openURL), finishBlockedBy: []), .optional)
        c.expectEqual(ChecklistSorting.section(for: row("c", .skipped, action: .run), finishBlockedBy: []), .optional,
                      "a skipped row that still offers an action is something the user can do")
        c.expectEqual(ChecklistSorting.badge(for: row("a", .needsYou, action: .openSettings), finishBlockedBy: []), nil)
    },
    Check("ChecklistSorting: a broken optional row with no action is Optional, never filed as no action") { c in
        c.expectEqual(ChecklistSorting.section(for: row("a", .error), finishBlockedBy: []), .optional)
        c.expectEqual(ChecklistSorting.section(for: row("b", .invalid), finishBlockedBy: []), .optional)
    },
    Check("ChecklistSorting: ready, skipped, and rows Install handles need no action") { c in
        c.expectEqual(ChecklistSorting.section(for: row("a", .ready, action: .run), finishBlockedBy: []), .noAction,
                      "a ready row is settled even when it keeps an action")
        c.expectEqual(ChecklistSorting.section(for: row("b", .skipped), finishBlockedBy: []), .noAction)
        c.expectEqual(ChecklistSorting.section(for: row("c", .missing), finishBlockedBy: []), .noAction,
                      "missing with nothing to press is Install's to set")
        c.expectEqual(ChecklistSorting.section(for: row("d", .needsYou), finishBlockedBy: []), .noAction)
        c.expectEqual(ChecklistSorting.section(for: row("e", .missing, action: .unknown), finishBlockedBy: []), .noAction,
                      "an action this app cannot draw is no action")
    },
]
```

Append `+ checklistSortingChecks` to `allChecks` in `AllChecks.swift`.

- [ ] **Step 2: Run to verify it fails**

Run (from `rt-tray/`): `swift build --target MattstackCoreChecks`
Expected: FAIL, `cannot find 'ChecklistSorting' in scope`.

- [ ] **Step 3: Write `ChecklistSorting.swift`**

```swift
import Foundation

public enum RowSection: Equatable, Sendable { case needsYou, optional, noAction }

public enum NeedBadge: String, Equatable, Sendable {
    case required = "Required"
    case beforeFinish = "Before you finish"
}

/// Where a checklist row is drawn. A warning heading sits over `needsYou`
/// only, so nothing optional may land there.
public enum ChecklistSorting {
    /// Mirrors `finalizePlan` in lib/setup/contract.ts: a finish-gated row is
    /// Finish's concern whatever its `required` reads.
    public static func blocksInstall(_ row: PlanRow) -> Bool {
        row.required && !row.finishGated && row.status != .ready
    }

    public static func section(for row: PlanRow, finishBlockedBy: Set<String>) -> RowSection {
        if blocksInstall(row) || finishBlockedBy.contains(row.id) { return .needsYou }
        if row.status == .ready { return .noAction }
        if hasUsableAction(row) || row.status == .error || row.status == .invalid { return .optional }
        return .noAction
    }

    public static func badge(for row: PlanRow, finishBlockedBy: Set<String>) -> NeedBadge? {
        if blocksInstall(row) { return .required }
        return finishBlockedBy.contains(row.id) ? .beforeFinish : nil
    }

    private static func hasUsableAction(_ row: PlanRow) -> Bool {
        guard let action = row.action else { return false }
        return action.type != .unknown
    }
}
```

- [ ] **Step 4: Rewrite `ChecklistLayoutChecks.swift` for the new sections (failing)**

Replace the whole file:

```swift
import Foundation
import MattstackCore

private func row(_ id: String, _ status: RowStatus, required: Bool = false, action: Bool = false,
                 finishGated: Bool = false) -> PlanRow {
    PlanRow(id: id, kind: .tool, title: id.uppercased(), why: "w", required: required, status: status,
            action: action ? RowAction(type: .openURL, label: "Open") : nil, recheck: .manual, finishGated: finishGated)
}

let layoutSample = [
    PlanGroup(id: "mac", title: "Your Mac", rows: [row("a", .ready), row("b", .missing, required: true, action: true), row("c", .skipped)]),
    PlanGroup(id: "accounts", title: "Accounts", rows: [row("d", .ready), row("e", .needsYou, action: true)]),
    PlanGroup(id: "agents", title: "Agents and editors", rows: [row("f", .missing), row("style", .needsYou, action: true, finishGated: true), row("h", .error)]),
    PlanGroup(id: "empty", title: "Empty", rows: []),
]

let checklistLayoutChecks: [Check] = [
    Check("ChecklistLayout: each section keeps every row of its group, split three ways in plan order") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: ["style"])
        c.expectEqual(layout.sections.map(\.id), ["mac", "accounts", "agents"], "a group with no rows has no section")
        c.expectEqual(layout.sections[0].needsYou.map(\.id), ["b"])
        c.expectEqual(layout.sections[0].optional.map(\.id), [])
        c.expectEqual(layout.sections[0].noAction.map(\.id), ["a", "c"])
        c.expectEqual(layout.sections[1].optional.map(\.id), ["e"])
        c.expectEqual(layout.sections[2].needsYou.map(\.id), ["style"])
        c.expectEqual(layout.sections[2].optional.map(\.id), ["h"])
        c.expectEqual(layout.sections[2].noAction.map(\.id), ["f"])
        c.expectEqual(layout.sections.map(\.count), [3, 2, 3])
    },
    Check("ChecklistLayout.attention: only rows that block Install or Finish, tagged with their group") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: ["style"])
        c.expectEqual(layout.attention.map(\.row.id), ["b", "style"])
        c.expectEqual(layout.attention.map(\.groupTitle), ["Your Mac", "Agents and editors"])
    },
    Check("ChecklistLayout: a finish-gated row nobody is blocked on is not attention") { c in
        let layout = ChecklistLayout.make(layoutSample)
        c.expectEqual(layout.attention.map(\.row.id), ["b"])
        c.expectEqual(layout.sections[2].optional.map(\.id), ["style", "h"])
    },
    Check("ChecklistLayout.summary: need you first and only when above zero, then ready, optional, not needed") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: ["style"])
        c.expectEqual(layout.summary.map(\.text), ["2 need you", "2 ready", "2 optional", "1 not needed here"])
        c.expectEqual(layout.summary.map(\.kind), [.needsYou, .ready, .optional, .notNeeded])
        let clean = ChecklistLayout.make([PlanGroup(id: "x", title: "X", rows: [row("a", .ready)])])
        c.expectEqual(clean.summary.map(\.text), ["1 ready"])
        let one = ChecklistLayout.make([PlanGroup(id: "x", title: "X", rows: [row("a", .missing, required: true)])])
        c.expectEqual(one.summary.map(\.text), ["1 needs you"])
        c.expectEqual(ChecklistLayout.make([]).summary.map(\.text), [])
    },
]
```

- [ ] **Step 5: Rewrite `ChecklistLayout.swift`**

```swift
import Foundation

/// How the checklist lays a plan out: each group's rows split into the ones
/// that need the user, the optional ones, and the rest.
public struct ChecklistLayout: Equatable, Sendable {
    public struct Attention: Equatable, Identifiable, Sendable {
        public let row: PlanRow
        public let groupTitle: String
        public var id: String { row.id }
    }

    public struct Section: Equatable, Identifiable, Sendable {
        public let id: String
        public let title: String
        public let needsYou: [PlanRow]
        public let optional: [PlanRow]
        public let noAction: [PlanRow]
        public var count: Int { needsYou.count + optional.count + noAction.count }
    }

    public enum SummaryKind: Equatable, Sendable { case needsYou, ready, optional, notNeeded }

    public struct SummaryPart: Equatable, Sendable {
        public let kind: SummaryKind
        public let text: String
    }

    public let attention: [Attention]
    public let sections: [Section]
    public let finishBlockedBy: Set<String>

    public static func make(_ groups: [PlanGroup], finishBlockedBy: [String] = []) -> ChecklistLayout {
        let blocked = Set(finishBlockedBy)
        var attention: [Attention] = []
        var sections: [Section] = []
        for group in groups where !group.rows.isEmpty {
            var buckets: [RowSection: [PlanRow]] = [:]
            for row in group.rows { buckets[ChecklistSorting.section(for: row, finishBlockedBy: blocked), default: []].append(row) }
            let needing = buckets[.needsYou] ?? []
            attention += needing.map { Attention(row: $0, groupTitle: group.title) }
            sections.append(Section(id: group.id, title: group.title, needsYou: needing,
                                    optional: buckets[.optional] ?? [], noAction: buckets[.noAction] ?? []))
        }
        return ChecklistLayout(attention: attention, sections: sections, finishBlockedBy: blocked)
    }

    /// A row Install will set (not ready, nothing to press) is in no count:
    /// it is neither ready nor anything the user owes.
    public var summary: [SummaryPart] {
        let settled = sections.flatMap(\.noAction)
        let ready = settled.filter { $0.status == .ready }.count
        let notNeeded = settled.filter { $0.status == .skipped }.count
        let optional = sections.reduce(0) { $0 + $1.optional.count }
        var parts: [SummaryPart] = []
        if !attention.isEmpty {
            parts.append(SummaryPart(kind: .needsYou, text: attention.count == 1 ? "1 needs you" : "\(attention.count) need you"))
        }
        if ready > 0 { parts.append(SummaryPart(kind: .ready, text: "\(ready) ready")) }
        if optional > 0 { parts.append(SummaryPart(kind: .optional, text: "\(optional) optional")) }
        if notNeeded > 0 { parts.append(SummaryPart(kind: .notNeeded, text: "\(notNeeded) not needed here")) }
        return parts
    }
}
```

`ChecklistScreen.swift` no longer compiles (it reads `entries`, `selection`, `needing`, `settled`, `folds`). Task 3 adds entries and Task 4 rewrites the view. To keep this task's commit building, wrap the body of `foldedList` in `ChecklistScreen.swift` so it returns `EmptyView()`: replace the whole `private var foldedList: some View { ... }` with

```swift
    private var foldedList: some View { EmptyView() }
```

and delete `staysOpen`, `reveal`, `rowAnchor`, `toggle`, the `@State private var selected` and `openRows` properties, and the `ChecklistSidebarEntry` and `FoldedRow` structs. Task 4 puts the view back.

- [ ] **Step 6: Run the checks**

Run (from `rt-tray/`): `swift run mattstack-checks`
Expected: PASS, with the `ChecklistSorting` and `ChecklistLayout` checks listed and no failures.

- [ ] **Step 7: Commit**

```bash
git add rt-tray/Sources-core/Readiness rt-tray/Tests/MattstackCoreChecks rt-tray/Sources/Setup/Screens/ChecklistScreen.swift
git commit -m "tray: sort checklist rows into needs you, optional and no action"
```

---

### Task 2: Wizard pages and the flow model

**Files:**
- Create: `rt-tray/Sources-core/Setup/WizardPages.swift`
- Modify: `rt-tray/Sources-core/Setup/SetupFlowModel.swift`
- Create: `rt-tray/Tests/MattstackCoreChecks/WizardPagesChecks.swift`
- Modify: `rt-tray/Tests/MattstackCoreChecks/SetupFlowChecks.swift`
- Modify: `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift`

**Interfaces:**
- Consumes: `ChecklistSorting.blocksInstall(_:)` from Task 1.
- Produces:
  - `struct WizardPages: Equatable { let ids: [String]; let titles: [String: String]; init(groups: [PlanGroup]) }`
  - `WizardPages.current(preferred: String?, lastIndex: Int?) -> String?`
  - `WizardPages.next(after: String) -> String?`, `previous(before: String) -> String?`, `isLast(_: String) -> Bool`, `index(of: String) -> Int?`
  - `WizardPages.landing(groups: [PlanGroup]) -> String?`
  - `PageGate.blockers(in group: PlanGroup) -> [PlanRow]`
  - `PageGate.footer(blockers: Int, isLast: Bool, canInstall: Bool) -> String`
  - `PageGate.continueEnabled(blockers: Int, isLast: Bool, canInstall: Bool) -> Bool`
  - On `SetupFlowModel`: `@Published var page: String?`, `func setPages(_ groups: [PlanGroup])`, `var pages: WizardPages`, `var progress: (current: Int, total: Int)?`, `var isLastPage: Bool`; `headerTitle`, `headerIndicator`, `continueTitle`, `next()`, `back()`, `canGoBack` become page-aware.

- [ ] **Step 1: Write the failing page checks**

`rt-tray/Tests/MattstackCoreChecks/WizardPagesChecks.swift`:

```swift
import Foundation
import MattstackCore

private func row(_ id: String, _ status: RowStatus, required: Bool = false) -> PlanRow {
    PlanRow(id: id, kind: .tool, title: id, why: "w", required: required, status: status, recheck: .manual)
}
private func group(_ id: String, _ rows: [PlanRow]) -> PlanGroup { PlanGroup(id: id, title: id.uppercased(), rows: rows) }

private let three = [group("mac", [row("a", .ready)]), group("accounts", [row("b", .missing, required: true)]),
                     group("empty", []), group("rt", [row("c", .ready)])]

let wizardPagesChecks: [Check] = [
    Check("WizardPages: one page per non-empty group, in plan order") { c in
        let p = WizardPages(groups: three)
        c.expectEqual(p.ids, ["mac", "accounts", "rt"])
        c.expectEqual(p.titles["accounts"], "ACCOUNTS")
        c.expectEqual(p.next(after: "mac"), "accounts")
        c.expectEqual(p.next(after: "rt"), nil)
        c.expectEqual(p.previous(before: "mac"), nil)
        c.expectEqual(p.previous(before: "rt"), "accounts")
        c.expect(p.isLast("rt")); c.expect(!p.isLast("mac"))
        c.expectEqual(p.index(of: "accounts"), 1)
    },
    Check("WizardPages.current: keeps the page by id, else the page now at its old position, else the first") { c in
        let p = WizardPages(groups: three)
        c.expectEqual(p.current(preferred: nil, lastIndex: nil), "mac")
        c.expectEqual(p.current(preferred: "accounts", lastIndex: 1), "accounts")
        c.expectEqual(p.current(preferred: "gone", lastIndex: 1), "accounts", "a page that left the plan hands over to its position")
        c.expectEqual(p.current(preferred: "gone", lastIndex: 9), "rt", "past the end clamps to the last page")
        c.expectEqual(WizardPages(groups: []).current(preferred: "mac", lastIndex: 0), nil)
    },
    Check("WizardPages.landing: the first page still holding an Install blocker, else the last page") { c in
        c.expectEqual(WizardPages.landing(groups: three), "accounts")
        c.expectEqual(WizardPages.landing(groups: [group("mac", [row("a", .ready)]), group("rt", [row("c", .ready)])]), "rt")
        c.expectEqual(WizardPages.landing(groups: []), nil)
    },
    Check("PageGate: a page holds Continue only for rows that block Install") { c in
        let g = group("x", [row("a", .missing, required: true), row("b", .missing), row("c", .ready, required: true)])
        c.expectEqual(PageGate.blockers(in: g).map(\.id), ["a"])
        c.expect(!PageGate.continueEnabled(blockers: 1, isLast: false, canInstall: false))
        c.expect(PageGate.continueEnabled(blockers: 0, isLast: false, canInstall: false), "a middle page never waits on other pages")
    },
    Check("PageGate: the last page's Install also waits on rt's own canInstall") { c in
        c.expect(PageGate.continueEnabled(blockers: 0, isLast: true, canInstall: true))
        c.expect(!PageGate.continueEnabled(blockers: 0, isLast: true, canInstall: false))
    },
    Check("PageGate.footer: counts this page's required rows, and names a veto that no row explains") { c in
        c.expectEqual(PageGate.footer(blockers: 2, isLast: false, canInstall: false), "2 required items left on this page.")
        c.expectEqual(PageGate.footer(blockers: 1, isLast: true, canInstall: false), "1 required item left on this page.")
        c.expectEqual(PageGate.footer(blockers: 0, isLast: false, canInstall: false), "Nothing required on this page.")
        c.expectEqual(PageGate.footer(blockers: 0, isLast: true, canInstall: true), "Nothing required on this page.")
        c.expectEqual(PageGate.footer(blockers: 0, isLast: true, canInstall: false),
                      "Install is not ready yet. Go back to finish the required items, or Re-check.")
    },
]
```

Append `+ wizardPagesChecks` to `allChecks`.

- [ ] **Step 2: Run to verify it fails**

Run: `swift build --target MattstackCoreChecks`
Expected: FAIL, `cannot find 'WizardPages' in scope`.

- [ ] **Step 3: Write `WizardPages.swift`**

```swift
import Foundation

/// The first-run checklist as pages: one per plan group that has rows.
public struct WizardPages: Equatable, Sendable {
    public let ids: [String]
    public let titles: [String: String]

    public init(groups: [PlanGroup] = []) {
        let shown = groups.filter { !$0.rows.isEmpty }
        ids = shown.map(\.id)
        titles = Dictionary(uniqueKeysWithValues: shown.map { ($0.id, $0.title) })
    }

    public func index(of id: String) -> Int? { ids.firstIndex(of: id) }
    public func isLast(_ id: String) -> Bool { ids.last == id }
    public func next(after id: String) -> String? {
        guard let i = index(of: id), i + 1 < ids.count else { return nil }
        return ids[i + 1]
    }
    public func previous(before id: String) -> String? {
        guard let i = index(of: id), i > 0 else { return nil }
        return ids[i - 1]
    }

    /// A plan re-read can drop the page the user is on (a group empties);
    /// the page now at that position takes over.
    public func current(preferred: String?, lastIndex: Int?) -> String? {
        if let preferred, ids.contains(preferred) { return preferred }
        guard !ids.isEmpty else { return nil }
        guard let lastIndex else { return ids[0] }
        return ids[min(max(lastIndex, 0), ids.count - 1)]
    }

    /// Where a relaunched setup reopens.
    public static func landing(groups: [PlanGroup]) -> String? {
        let shown = groups.filter { !$0.rows.isEmpty }
        return shown.first { !PageGate.blockers(in: $0).isEmpty }?.id ?? shown.last?.id
    }
}

public enum PageGate {
    public static func blockers(in group: PlanGroup) -> [PlanRow] {
        group.rows.filter(ChecklistSorting.blocksInstall)
    }

    public static func continueEnabled(blockers: Int, isLast: Bool, canInstall: Bool) -> Bool {
        blockers == 0 && (!isLast || canInstall)
    }

    public static func footer(blockers: Int, isLast: Bool, canInstall: Bool) -> String {
        if blockers == 1 { return "1 required item left on this page." }
        if blockers > 1 { return "\(blockers) required items left on this page." }
        if isLast && !canInstall { return "Install is not ready yet. Go back to finish the required items, or Re-check." }
        return "Nothing required on this page."
    }
}
```

- [ ] **Step 4: Rewrite the flow checks (failing)**

In `SetupFlowChecks.swift`, replace the first three checks (`SetupStep order, titles, indicator`, `flow header: ...`, `flow: next/back bounds ...`) with:

```swift
    Check("SetupStep order and titles") { c in
        c.expectEqual(SetupStep.allCases.map(\.rawValue), [0, 1, 2, 3, 4])
        c.expectEqual(SetupStep.team.title, "Your team")
        c.expectEqual(SetupStep.checklist.title, "Before we begin")
        c.expectEqual(SetupStep.done.title, "All set")
    },
    Check("flow header: a wizard page is named after its group and counted among every page") { c in
        await MainActor.run {
            let wizard = SetupFlowModel()
            c.expectEqual(wizard.headerIndicator, "Step 1 of 5", "before a plan there is one checklist page")
            wizard.jump(to: .checklist)
            c.expectEqual(wizard.headerTitle, "Before we begin")
            c.expectEqual(wizard.headerIndicator, "Step 3 of 5")
            wizard.setPages(flowGroups)
            c.expectEqual(wizard.page, "mac")
            c.expectEqual(wizard.headerTitle, "Your Mac")
            c.expectEqual(wizard.headerIndicator, "Step 3 of 7")
            c.expectEqual(wizard.progress?.current, 3); c.expectEqual(wizard.progress?.total, 7)
            wizard.next()
            c.expectEqual(wizard.headerTitle, "Accounts"); c.expectEqual(wizard.headerIndicator, "Step 4 of 7")
            wizard.jump(to: .done)
            c.expectEqual(wizard.headerIndicator, "Step 7 of 7")
            let status = SetupFlowModel(readOnly: true)
            status.jump(to: .checklist); status.setPages(flowGroups)
            c.expectEqual(status.headerTitle, "Setup status", "nothing is about to begin on a Mac that is already set up")
            c.expectEqual(status.headerIndicator, nil, "the status window is not a step of anything")
            c.expectEqual(status.progress == nil, true)
        }
    },
    Check("flow: Continue walks the pages, the last page installs, Back walks them in reverse") { c in
        await MainActor.run {
            let f = SetupFlowModel()
            c.expectEqual(f.step, .welcome); c.expectEqual(f.canGoBack, false); c.expectEqual(f.windowMayClose, false)
            f.back(); c.expectEqual(f.step, .welcome)
            f.next(); c.expectEqual(f.step, .team); c.expectEqual(f.canGoBack, true)
            f.next(); c.expectEqual(f.step, .checklist)
            f.setPages(flowGroups)
            c.expectEqual(f.continueTitle, "Continue"); c.expectEqual(f.isLastPage, false)
            f.next(); c.expectEqual(f.step, .checklist); c.expectEqual(f.page, "accounts")
            f.next(); c.expectEqual(f.page, "rt"); c.expectEqual(f.continueTitle, "Install"); c.expectEqual(f.isLastPage, true)
            f.back(); c.expectEqual(f.page, "accounts")
            f.next(); f.next(); c.expectEqual(f.step, .install)
            f.isInstalling = true; c.expectEqual(f.canGoBack, false)
            f.isInstalling = false; c.expectEqual(f.canGoBack, true)
            f.back(); c.expectEqual(f.step, .checklist); c.expectEqual(f.page, "rt", "Back from Install returns to the last page")
            f.back(); f.back(); c.expectEqual(f.page, "mac")
            f.back(); c.expectEqual(f.step, .team, "Back on the first page returns to Your team")
            f.jump(to: .done); c.expectEqual(f.continueTitle, "Finish")
            c.expectEqual(f.canGoBack, false); c.expectEqual(f.windowMayClose, true)
            f.next(); c.expectEqual(f.step, .done)
        }
    },
    Check("flow: a plan re-read keeps the page by id, and hands a vanished page to its position") { c in
        await MainActor.run {
            let f = SetupFlowModel()
            f.jump(to: .checklist); f.setPages(flowGroups); f.next()
            c.expectEqual(f.page, "accounts")
            f.setPages([flowGroups[0], PlanGroup(id: "access", title: "Access", rows: flowGroups[1].rows), flowGroups[1], flowGroups[2]])
            c.expectEqual(f.page, "accounts", "a group appearing ahead does not move the user")
            f.setPages([flowGroups[0], flowGroups[2]])
            c.expectEqual(f.page, "rt", "its old position is past the end, so the last page")
            f.setPages([])
            c.expectEqual(f.page, nil); c.expectEqual(f.headerTitle, "Before we begin")
        }
    },
    Check("flow: a relaunch lands on the first page still holding an Install blocker") { c in
        await MainActor.run {
            let f = SetupFlowModel()
            f.jump(to: .checklist, landing: true)
            f.setPages(flowGroups)
            c.expectEqual(f.page, "accounts")
            f.setPages(flowGroups)
            f.back(); c.expectEqual(f.page, "mac", "the landing applies once, not on every re-read")
        }
    },
    Check("flow: a plan with one group installs from its only page") { c in
        await MainActor.run {
            let f = SetupFlowModel()
            f.jump(to: .checklist); f.setPages([flowGroups[0]])
            c.expectEqual(f.continueTitle, "Install"); c.expectEqual(f.headerIndicator, "Step 3 of 5")
            f.back(); c.expectEqual(f.step, .team)
        }
    },
```

Add above `let setupFlowChecks`:

```swift
private func flowRow(_ id: String, _ status: RowStatus, required: Bool = false) -> PlanRow {
    PlanRow(id: id, kind: .tool, title: id, why: "w", required: required, status: status, recheck: .manual)
}
private let flowGroups = [
    PlanGroup(id: "mac", title: "Your Mac", rows: [flowRow("a", .ready)]),
    PlanGroup(id: "accounts", title: "Accounts", rows: [flowRow("b", .missing, required: true)]),
    PlanGroup(id: "rt", title: "rt on this Mac", rows: [flowRow("c", .ready)]),
]
```

In the remaining checks of that file, change the two `c.expectEqual(wizard.continueTitle, "Install")` / `f.continueTitle == "Install"` assertions that run with no pages set to stay as they are: with no pages the checklist is its own last page, so the title is still `Install`.

- [ ] **Step 5: Run to verify it fails**

Run: `swift build --target MattstackCoreChecks`
Expected: FAIL, `value of type 'SetupFlowModel' has no member 'setPages'`.

- [ ] **Step 6: Update `SetupFlowModel.swift`**

In `SetupStep`, change the `.done` title to `"All set"` and delete the `indicator` property.

In `SetupFlowModel`, add after `entry`:

```swift
    /// The checklist page on screen: a plan group's id. nil until a plan lands.
    @Published public var page: String?
    @Published public private(set) var pages = WizardPages()
    private var lastPageIndex: Int?
    private var landsOnBlocker = false
```

Replace `headerTitle`, `headerIndicator`, `continueTitle`, `canGoBack`, `next`, `back` and `jump` with:

```swift
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
```

`SetupFlowModel.swift` must `import Foundation` and `Combine` as it does today; `WizardPages` is in the same module.

- [ ] **Step 7: Run the checks**

Run: `swift run mattstack-checks`
Expected: PASS. The tray target does not build yet if `SetupView` used `step.indicator`; it does not (`SetupView` reads `flow.headerIndicator`), so `swift build` also passes.

- [ ] **Step 8: Commit**

```bash
git add rt-tray/Sources-core/Setup rt-tray/Tests/MattstackCoreChecks
git commit -m "tray: page the setup checklist by group in the flow model"
```

---

### Task 3: Sidebar entries, marks and selection

**Files:**
- Modify: `rt-tray/Sources-core/Readiness/ChecklistLayout.swift`
- Modify: `rt-tray/Tests/MattstackCoreChecks/ChecklistLayoutChecks.swift`

**Interfaces:**
- Consumes: `ChecklistLayout`, `layoutSample` from Task 1.
- Produces:
  - `ChecklistLayout.needsYouID = "needs-you"`, `ChecklistLayout.overviewID = "overview"`
  - `enum EntryMark { case overview, failed, running, needsYou, settled }`
  - `struct Entry { id: String; title: String; count: Int?; mark: EntryMark }`
  - `func entries(overview: Bool, running: Set<String>, failed: Set<String>) -> [Entry]`
  - `func selection(preferred: String?, overview: Bool) -> String?`

- [ ] **Step 1: Write the failing checks**

Append to `checklistLayoutChecks`:

```swift
    Check("ChecklistLayout.entries: Needs you leads when anything does, then Overview when asked, then the groups") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: ["style"])
        let wizard = layout.entries(overview: true, running: [], failed: [])
        c.expectEqual(wizard.map(\.id), [ChecklistLayout.needsYouID, ChecklistLayout.overviewID, "mac", "accounts", "agents"])
        c.expectEqual(wizard.map(\.title), ["Needs you", "Overview", "Your Mac", "Accounts", "Agents and editors"])
        c.expectEqual(wizard.map(\.count), [2, nil, 3, 2, 3])
        c.expectEqual(wizard.map(\.mark), [.needsYou, .overview, .needsYou, .settled, .needsYou])
        let status = layout.entries(overview: false, running: [], failed: [])
        c.expectEqual(status.map(\.id), [ChecklistLayout.needsYouID, "mac", "accounts", "agents"])
    },
    Check("ChecklistLayout.entries: an optional row never marks its group as needing you") { c in
        let layout = ChecklistLayout.make(layoutSample)
        c.expectEqual(layout.entries(overview: false, running: [], failed: []).first { $0.id == "accounts" }?.mark, .settled)
    },
    Check("ChecklistLayout.entries: a failed row outranks a running one, which outranks needing you") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: ["style"])
        let marks = { (running: Set<String>, failed: Set<String>) in
            Dictionary(uniqueKeysWithValues: layout.entries(overview: false, running: running, failed: failed).map { ($0.id, $0.mark) })
        }
        c.expectEqual(marks(["e"], [])["accounts"], .running)
        c.expectEqual(marks(["b"], [])["mac"], .running, "running shows over needs you")
        c.expectEqual(marks(["b"], ["a"])["mac"], .failed)
        c.expectEqual(marks(["zzz"], ["zzz"])["mac"], .needsYou, "a row id from another plan marks nothing")
        c.expectEqual(marks(["b"], [])[ChecklistLayout.needsYouID], .needsYou, "the Needs you entry keeps its own mark")
    },
    Check("ChecklistLayout.selection: Needs you, else Overview when offered, else the first group; a pick that exists is kept") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: ["style"])
        c.expectEqual(layout.selection(preferred: nil, overview: true), ChecklistLayout.needsYouID)
        c.expectEqual(layout.selection(preferred: "accounts", overview: true), "accounts")
        c.expectEqual(layout.selection(preferred: "gone", overview: false), ChecklistLayout.needsYouID)
        let clean = ChecklistLayout.make([PlanGroup(id: "x", title: "X", rows: [layoutSample[0].rows[0]])])
        c.expectEqual(clean.selection(preferred: nil, overview: true), ChecklistLayout.overviewID)
        c.expectEqual(clean.selection(preferred: nil, overview: false), "x")
        c.expectEqual(clean.selection(preferred: ChecklistLayout.needsYouID, overview: false), "x", "Needs you empties once everything is fixed")
        c.expectEqual(clean.selection(preferred: ChecklistLayout.overviewID, overview: false), "x", "Setup status has no Overview")
        c.expectEqual(ChecklistLayout.make([]).selection(preferred: nil, overview: false), nil)
    },
```

- [ ] **Step 2: Run to verify it fails**

Run: `swift build --target MattstackCoreChecks`
Expected: FAIL, `type 'ChecklistLayout' has no member 'needsYouID'`.

- [ ] **Step 3: Add entries, marks and selection to `ChecklistLayout`**

Inside the struct:

```swift
    public enum EntryMark: Equatable, Sendable { case overview, failed, running, needsYou, settled }

    public struct Entry: Equatable, Identifiable, Sendable {
        public let id: String
        public let title: String
        /// nil for an entry that is not a list of rows.
        public let count: Int?
        public let mark: EntryMark
    }

    /// No plan group can take these ids: rt's group ids never carry a hyphen,
    /// and no group is named "overview".
    public static let needsYouID = "needs-you"
    public static let overviewID = "overview"

    public func entries(overview: Bool, running: Set<String>, failed: Set<String>) -> [Entry] {
        var out: [Entry] = []
        if !attention.isEmpty {
            out.append(Entry(id: Self.needsYouID, title: "Needs you", count: attention.count, mark: .needsYou))
        }
        if overview { out.append(Entry(id: Self.overviewID, title: "Overview", count: nil, mark: .overview)) }
        out += sections.map { section in
            let ids = Set((section.needsYou + section.optional + section.noAction).map(\.id))
            let mark: EntryMark = !ids.isDisjoint(with: failed) ? .failed
                : !ids.isDisjoint(with: running) ? .running
                : section.needsYou.isEmpty ? .settled : .needsYou
            return Entry(id: section.id, title: section.title, count: section.count, mark: mark)
        }
        return out
    }

    /// The entry to show: the user's pick while it still exists, else the first.
    public func selection(preferred: String?, overview: Bool) -> String? {
        let ids = entries(overview: overview, running: [], failed: []).map(\.id)
        if let preferred, ids.contains(preferred) { return preferred }
        return ids.first
    }
```

- [ ] **Step 4: Run the checks**

Run: `swift run mattstack-checks`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rt-tray/Sources-core/Readiness/ChecklistLayout.swift rt-tray/Tests/MattstackCoreChecks/ChecklistLayoutChecks.swift
git commit -m "tray: sidebar entries carry failed and running marks"
```

---

### Task 4: The sections view, and the checklist screen's two presentations

**Files:**
- Create: `rt-tray/Sources/Setup/Components/ChecklistSections.swift`
- Modify: `rt-tray/Sources/Setup/Screens/ChecklistScreen.swift`
- Modify: `rt-tray/Sources/AccessibilityIDs.swift`
- Modify: `rt-tray/Sources/Setup/SetupView.swift`
- Modify: `rt-tray/Sources-core/Readiness/ReadinessModel.swift` (delete `limitedModeAvailable`)
- Modify: `rt-tray/Tests/MattstackCoreChecks/ReadinessModelChecks.swift` (delete the limited-mode check)

**Interfaces:**
- Consumes: `ChecklistLayout`, `ChecklistSorting`, `WizardPages`, `PageGate`, `SetupFlowModel.page/setPages/progress/isLastPage`.
- Produces:
  - `ChecklistScreen.Presentation`: `.accounts`, `.page(String?)`, `.sidebar(overview: AnyView?, onSkip: ((PlanRow) -> Void)?)`
  - `ChecklistScreen(model:permissions:rt:needs:presentation:)`
  - `struct RowIDs { row, action, status: (String) -> String }` with `RowIDs.checklist` and `RowIDs.beforeYouFinish`
  - `ChecklistSectionsView` (used again in Task 5 and Task 6)

- [ ] **Step 1: Add the ids**

In `AccessibilityIDs.swift`, delete `continueLimited`, and add under `// Checklist`:

```swift
    static func checklistPage(_ id: String) -> String { "setup.checklist.page.\(id)" }
    static func checklistSection(_ name: String) -> String { "setup.checklist.section.\(name)" }
    static let checklistNoActionToggle = "setup.checklist.noAction.toggle"
    static let progress = "setup.window.progress"
```

- [ ] **Step 2: Write `ChecklistSections.swift`**

```swift
import SwiftUI
import MattstackCore

struct RowIDs {
    let row: (String) -> String
    let action: (String) -> String
    let status: (String) -> String
    static let checklist = RowIDs(row: AXID.checklistRow, action: AXID.checklistRowAction, status: AXID.checklistRowStatus)
    static let beforeYouFinish = RowIDs(row: AXID.doneBeforeYouFinishRow, action: AXID.doneBeforeYouFinishRowAction,
                                        status: AXID.doneBeforeYouFinishRowStatus)
}

/// What a row is doing right now, beyond what the plan says about it.
struct RowActivity {
    var checking: Set<String> = []
    var waiting: [String: String] = [:]
    var errors: [String: String] = [:]
}

/// One group's rows as Needs you, Optional, No action needed.
struct ChecklistSectionsView: View {
    let section: ChecklistLayout.Section
    let finishBlockedBy: Set<String>
    let activity: RowActivity
    /// The group each row came from, for the summary's Needs you pane.
    var contexts: [String: String] = [:]
    var needsYouIDs: RowIDs = .checklist
    var onSkip: ((PlanRow) -> Void)? = nil
    let perform: (PlanRow) -> Void
    @State private var noActionOpen = false

    private var noActionShown: Bool { noActionOpen || (section.needsYou.isEmpty && section.optional.isEmpty) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !section.needsYou.isEmpty {
                ChecklistCard {
                    header("Needs you", symbol: "exclamationmark.triangle.fill", multicolor: true)
                    ForEach(section.needsYou) { row in
                        Divider()
                        SectionRow(row: row, badge: ChecklistSorting.badge(for: row, finishBlockedBy: finishBlockedBy),
                                   context: contexts[row.id], activity: activity, ids: needsYouIDs,
                                   onSkip: row.waivable && finishBlockedBy.contains(row.id) ? onSkip : nil, perform: perform)
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier(AXID.checklistSection("needsYou"))
            }
            if !section.optional.isEmpty {
                ChecklistCard {
                    header("Optional", symbol: nil, multicolor: false)
                    ForEach(section.optional) { row in
                        Divider()
                        SectionRow(row: row, badge: nil, context: nil, activity: activity, ids: .checklist, onSkip: nil, perform: perform)
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier(AXID.checklistSection("optional"))
            }
            if !section.noAction.isEmpty {
                ChecklistCard {
                    Button { noActionOpen.toggle() } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "checkmark.circle").foregroundStyle(.green)
                            Text("No action needed · \(section.noAction.count)").font(.callout.weight(.semibold))
                            if !noActionShown {
                                Text(section.noAction.map(\.title).joined(separator: ", "))
                                    .font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.tail)
                            }
                            Spacer(minLength: 8)
                            Image(systemName: noActionShown ? "chevron.down" : "chevron.right").font(.caption).foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier(AXID.checklistNoActionToggle)
                    if noActionShown {
                        ForEach(section.noAction) { row in
                            Divider()
                            SettledRow(row: row, isChecking: activity.checking.contains(row.id))
                        }
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier(AXID.checklistSection("noAction"))
            }
        }
    }

    private func header(_ title: String, symbol: String?, multicolor: Bool) -> some View {
        HStack(spacing: 8) {
            if let symbol { Image(systemName: symbol).symbolRenderingMode(multicolor ? .multicolor : .monochrome) }
            Text(title).font(.callout.weight(.semibold))
            Spacer()
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(Color.primary.opacity(0.03))
    }
}

/// An invisible element that keeps a row's status readable by id: the VM
/// walkthrough and the UI tests read `setup.checklist.row.<id>.status`, and
/// rows no longer draw a status icon.
struct RowStatusProbe: View {
    let status: RowStatus
    let id: String
    var body: some View {
        Color.clear.frame(width: 1, height: 1)
            .accessibilityElement()
            .accessibilityLabel(Text(status.rawValue))
            .accessibilityValue(Text(status.rawValue))
            .accessibilityIdentifier(id)
    }
}

struct SectionRow: View {
    let row: PlanRow
    let badge: NeedBadge?
    let context: String?
    let activity: RowActivity
    let ids: RowIDs
    let onSkip: ((PlanRow) -> Void)?
    let perform: (PlanRow) -> Void

    private var isChecking: Bool { activity.checking.contains(row.id) }
    private var isBroken: Bool { row.status == .error || row.status == .invalid }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(row.title).fontWeight(.medium)
                    if let context { Text(context).font(.caption).foregroundStyle(.secondary) }
                    if let badge {
                        Text(badge.rawValue).font(.caption2).padding(.horizontal, 6).padding(.vertical, 1)
                            .background(Capsule().fill(Color.orange.opacity(0.18)))
                    }
                }
                Text(row.why).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if let d = row.detail, !d.isEmpty {
                    Text(d).font(.caption).foregroundStyle(isBroken ? Color.red : Color.secondary)
                }
                if let n = row.optionalNote { Text(n).font(.caption).foregroundStyle(.secondary) }
                if let waiting = activity.waiting[row.id] { RowWaitingCaption(rowId: row.id, text: waiting).padding(.top, 2) }
                if let error = activity.errors[row.id] {
                    Text(error).font(.caption).foregroundStyle(.red).accessibilityIdentifier(AXID.checklistRowError(row.id))
                }
            }
            Spacer(minLength: 8)
            if isChecking { ProgressView().controlSize(.small) }
            if let onSkip {
                Button(FinishGate.skipSheetConfirm) { onSkip(row) }.controlSize(.regular)
                    .accessibilityIdentifier(AXID.doneSkipRow(row.id))
            }
            if let action = row.action, action.type != .unknown {
                Button(action.label) { perform(row) }.controlSize(.regular).disabled(isChecking)
                    .accessibilityIdentifier(ids.action(row.id))
            }
            RowStatusProbe(status: isChecking ? .checking : row.status, id: ids.status(row.id))
        }
        .padding(.horizontal, 14).padding(.vertical, 9)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(ids.row(row.id))
    }
}

struct SettledRow: View {
    let row: PlanRow
    let isChecking: Bool
    var body: some View {
        HStack(spacing: 8) {
            Text(row.title).font(.callout)
            Spacer(minLength: 8)
            if let d = row.detail, !d.isEmpty {
                Text(d).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.tail)
            }
            RowStatusProbe(status: isChecking ? .checking : row.status, id: AXID.checklistRowStatus(row.id))
        }
        .padding(.horizontal, 14).padding(.vertical, 6)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.checklistRow(row.id))
    }
}
```

If `AXID.doneBeforeYouFinishRow`, `doneBeforeYouFinishRowAction`, `doneBeforeYouFinishRowStatus` or `doneSkipRow` are spelled differently below line 90 of `AccessibilityIDs.swift`, use the names that file declares; do not rename them.

- [ ] **Step 3: Rewrite `ChecklistScreen`'s presentation**

In `ChecklistScreen.swift`:

Replace `var scope: ReadinessModel.Scope = .all` with:

```swift
    enum Presentation {
        case accounts
        /// A wizard page: one group. nil while no plan has landed.
        case page(String?)
        /// Setup status, and the wizard's last step when `overview` is set.
        case sidebar(overview: AnyView?, onSkip: ((PlanRow) -> Void)?)
    }
    var presentation: Presentation = .sidebar(overview: nil, onSkip: nil)
    private var scope: ReadinessModel.Scope { if case .accounts = presentation { return .accounts } else { return .all } }
```

Replace `@State private var actionError: (rowId: String, message: String)?` with `@State private var actionErrors: [String: String] = [:]` and add `@State private var selected: String?`. Every `actionError = nil` becomes: in `recheck()`, `actionErrors = [:]`; in `perform(_:)` and the connect sheet closure, `actionErrors[row.id] = nil` (the sheet closure uses `c.row.id`). Every `actionError = (row.id, x)` becomes `actionErrors[row.id] = x`.

In `body`, replace `if scope == .all { foldedList } else { flatList }` with:

```swift
                switch presentation {
                case .accounts: flatList
                case .page(let id): pageBody(id)
                case .sidebar(let overview, let onSkip): sidebarBody(overview: overview, onSkip: onSkip)
                }
```

In `flatList`, `fullRow(row)` keeps using `RowView`; change its error line to read `actionErrors[row.id]`:

```swift
    @ViewBuilder
    private func fullRow(_ row: PlanRow) -> some View {
        RowView(row: row, isChecking: model.checkingRowIds.contains(row.id), waiting: waitingOnYou[row.id]) { perform(row) }
        if let message = actionErrors[row.id] {
            Text(message).font(.caption).foregroundStyle(.red).accessibilityIdentifier(AXID.checklistRowError(row.id))
        }
    }
```

Replace `foldedList` (the `EmptyView` stub from Task 1) with:

```swift
    private var activity: RowActivity {
        RowActivity(checking: model.checkingRowIds, waiting: waitingOnYou, errors: actionErrors)
    }

    private var relaunchBanner: some View {
        HStack {
            Text("Full Disk Access was granted. Relaunch mattstack to apply it.").font(.caption)
            Spacer()
            Button("Relaunch mattstack") { AppRelaunch.relaunchInPlace(resumeAt: .checklist) }.accessibilityIdentifier(AXID.checklistRelaunch)
        }
    }

    private func pageBody(_ id: String?) -> some View {
        let layout = ChecklistLayout.make(model.groups, finishBlockedBy: model.finishBlockedBy)
        return ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if model.fdaNeedsRelaunch { relaunchBanner }
                if let section = layout.sections.first(where: { $0.id == id }) {
                    Text(PageLead.text(for: section)).font(.callout).foregroundStyle(.secondary)
                    ChecklistSectionsView(section: section, finishBlockedBy: layout.finishBlockedBy, activity: activity) { perform($0) }
                        .id(section.id)
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .background(Color.primary.opacity(0.035))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.checklistPage(id ?? ""))
    }

    private func sidebarBody(overview: AnyView?, onSkip: ((PlanRow) -> Void)?) -> some View {
        let layout = ChecklistLayout.make(model.groups, finishBlockedBy: model.finishBlockedBy)
        let entries = layout.entries(overview: overview != nil, running: model.checkingRowIds, failed: Set(actionErrors.keys))
        let current = layout.selection(preferred: selected, overview: overview != nil)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                ForEach(layout.summary, id: \.text) { part in
                    HStack(spacing: 4) {
                        SummaryGlyph(kind: part.kind)
                        Text(part.text).font(.callout)
                    }
                }
                Spacer()
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(AXID.checklistSummary)
            if model.fdaNeedsRelaunch { relaunchBanner }
            HStack(alignment: .top, spacing: 12) {
                ChecklistCard {
                    ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                        if index > 0 { Divider() }
                        ChecklistSidebarEntry(entry: entry, isSelected: entry.id == current) { selected = entry.id }
                    }
                }
                .frame(width: 220)
                ScrollView {
                    Group {
                        if current == ChecklistLayout.overviewID, let overview {
                            ChecklistCard { overview }
                        } else if current == ChecklistLayout.needsYouID {
                            ChecklistSectionsView(
                                section: ChecklistLayout.Section(id: ChecklistLayout.needsYouID, title: "Needs you",
                                                                 needsYou: layout.attention.map(\.row), optional: [], noAction: []),
                                finishBlockedBy: layout.finishBlockedBy, activity: activity,
                                contexts: Dictionary(uniqueKeysWithValues: layout.attention.map { ($0.row.id, $0.groupTitle) }),
                                needsYouIDs: overview != nil ? .beforeYouFinish : .checklist, onSkip: onSkip) { perform($0) }
                        } else if let section = layout.sections.first(where: { $0.id == current }) {
                            ChecklistSectionsView(section: section, finishBlockedBy: layout.finishBlockedBy, activity: activity,
                                                  onSkip: onSkip) { perform($0) }
                                .id(section.id)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                }
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.primary.opacity(0.035))
    }
```

Add these types at the bottom of the file (and restore the sidebar entry removed in Task 1, now drawing a mark):

```swift
enum PageLead {
    static func text(for section: ChecklistLayout.Section) -> String {
        let required = section.needsYou.filter(ChecklistSorting.blocksInstall).count
        if required == 1 { return "One thing here needs you before Install can run." }
        if required > 1 { return "\(required) things here need you before Install can run." }
        if !section.needsYou.isEmpty { return "Nothing here blocks Install. One thing is needed before you finish." }
        return section.optional.isEmpty ? "Nothing here needs you." : "Nothing here blocks Install."
    }
}

struct SummaryGlyph: View {
    let kind: ChecklistLayout.SummaryKind
    var body: some View {
        switch kind {
        case .needsYou: Image(systemName: "exclamationmark.triangle.fill").symbolRenderingMode(.multicolor)
        case .ready: Image(systemName: "checkmark.circle").foregroundStyle(.green)
        case .optional: Image(systemName: "circle").foregroundStyle(.secondary)
        case .notNeeded: Image(systemName: "circle.dashed").foregroundStyle(.secondary)
        }
    }
}

struct ChecklistSidebarEntry: View {
    let entry: ChecklistLayout.Entry
    let isSelected: Bool
    let onSelect: () -> Void
    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 6) {
                mark.frame(width: 20, height: 20)
                Text(entry.title).font(.callout).fontWeight(isSelected ? .semibold : .regular).lineLimit(1)
                Spacer(minLength: 6)
                if let count = entry.count { Text("\(count)").font(.caption).foregroundStyle(.secondary) }
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(isSelected ? Color.accentColor.opacity(0.16) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(AXID.checklistGroup(entry.id))
        .accessibilityValue(Text(String(describing: entry.mark)))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    @ViewBuilder private var mark: some View {
        switch entry.mark {
        case .overview: Image(systemName: "house").foregroundStyle(.secondary)
        case .failed: Image(systemName: "xmark.circle").foregroundStyle(.red)
        case .running: ProgressView().controlSize(.small)
        case .needsYou: Image(systemName: "exclamationmark.triangle.fill").symbolRenderingMode(.multicolor)
        case .settled: Image(systemName: "checkmark.circle").foregroundStyle(.green)
        }
    }
}
```

In `footerText(now:)`, the status half is only for the sidebar; the wizard page's footer comes from `PageGate` (Step 4). Replace the function with:

```swift
    private func footerText(now: Date) -> String {
        guard model.loadState == .loaded else { return "" }
        let note = ChecklistFooter.refreshNote(isRefreshing: isRefreshing, lastCheckedAt: model.lastCheckedAt, now: now)
        guard !isRefreshing else { return note ?? "" }
        let status: String?
        switch presentation {
        case .accounts: status = nil
        case .page(let id):
            let group = model.groups.first { $0.id == id }
            let isLast = WizardPages(groups: model.groups).ids.last == id
            status = PageGate.footer(blockers: group.map { PageGate.blockers(in: $0).count } ?? 0, isLast: isLast, canInstall: model.canInstall)
        case .sidebar:
            status = ChecklistFooter.text(canInstall: model.canInstall, requiredMissingCount: model.requiredMissing.count,
                                          owedBeforeFinish: ChecklistFooter.owedBeforeFinish(model.allRows))
        }
        return [note, status].compactMap { $0 }.joined(separator: " · ")
    }
```

The loading and failed titles and the two `AXID` ternaries that read `scope == .all` keep working through the computed `scope`.

Two things outside this file must follow:

- Every other call site that passes `scope:` changes to `presentation:`. Find them with `rg -n "ChecklistScreen\(" rt-tray/Sources`; the Settings Accounts pane passes `scope: .accounts` and becomes `presentation: .accounts`.
- `ReadinessModel.finishBlockedBy` must be readable from the tray target. If it is declared without `public`, change it to `@Published public private(set) var finishBlockedBy: [String] = []`.

- [ ] **Step 4: Wire `SetupView`**

In `SetupView.swift`:

Replace the `.checklist` case of the `switch flow.step`:

```swift
                case .checklist:
                    ChecklistScreen(model: readiness, permissions: permissions, rt: env.rt, needs: env.needs,
                                    presentation: flow.readOnly ? .sidebar(overview: nil, onSkip: nil) : .page(flow.page))
                        .transition(pushTransition)
```

Add, next to the other `.onChange` modifiers:

```swift
        .onChange(of: readiness.groups, initial: true) { _, groups in flow.setPages(groups) }
```

Replace `header` with:

```swift
    private var header: some View {
        VStack(spacing: 10) {
            HStack {
                Text(flow.headerTitle).font(.title2.weight(.semibold))
                Spacer()
                if let indicator = flow.headerIndicator {
                    Text(indicator).font(.caption).foregroundStyle(.secondary)
                        .accessibilityIdentifier(AXID.stepIndicator)
                }
            }
            if let progress = flow.progress {
                HStack(spacing: 4) {
                    ForEach(1...progress.total, id: \.self) { i in
                        Capsule().fill(i < progress.current ? Color.green : i == progress.current ? Color.accentColor : Color.primary.opacity(0.12))
                            .frame(height: 4)
                    }
                }
                .accessibilityElement()
                .accessibilityIdentifier(AXID.progress)
                .accessibilityValue(Text("\(progress.current) of \(progress.total)"))
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
    }
```

In `footer`, delete the whole `if flow.step == .checklist, flow.mayStartInstall, readiness.limitedModeAvailable { ... }` block.

In `continueEnabled`, replace `case .checklist: return readiness.canInstall` with:

```swift
        case .checklist:
            let group = readiness.groups.first { $0.id == flow.page }
            return PageGate.continueEnabled(blockers: group.map { PageGate.blockers(in: $0).count } ?? 0,
                                            isLast: flow.isLastPage, canInstall: readiness.canInstall)
```

In `SetupWindowController.swift`, find where `show(step:...)` calls `flow.jump(to: step)` (line 64) and pass the landing flag when the step is the checklist and the window is the wizard:

```swift
        if let step { flow.jump(to: step, landing: step == .checklist && !flow.readOnly) }
```

- [ ] **Step 5: Remove limited mode from the model**

Delete `limitedModeAvailable` and its doc comment from `ReadinessModel.swift`. In `ReadinessModelChecks.swift`, delete the three `limitedModeAvailable` assertions (lines 144, 153, 158) and, if a check is left asserting nothing else, the whole check.

- [ ] **Step 6: Build and run the checks**

Run (from `rt-tray/`): `swift build` then `swift run mattstack-checks`
Expected: both pass. `DoneScreen.swift` still compiles: it uses `RowView`, which is unchanged.

- [ ] **Step 7: Commit**

```bash
git add rt-tray/Sources rt-tray/Sources-core rt-tray/Tests/MattstackCoreChecks
git commit -m "tray: draw the setup checklist as wizard pages and a sectioned sidebar"
```

---

### Task 5: The summary replaces the Installed screen

**Files:**
- Create: `rt-tray/Sources/Setup/Screens/SummaryOverview.swift`
- Delete: `rt-tray/Sources/Setup/Screens/DoneScreen.swift`
- Modify: `rt-tray/Sources/Setup/SetupView.swift`
- Modify: `rt-tray/Sources/AccessibilityIDs.swift`

**Interfaces:**
- Consumes: `ChecklistScreen.Presentation.sidebar(overview:onSkip:)`, `DoneModel` (unchanged), `InstallRunModel.partialSteps`.
- Produces: `SummaryOverview` view; `SkipConfirmSheet` (moved, unchanged).

- [ ] **Step 1: Write `SummaryOverview.swift`**

Move `SkipConfirmSheet` from `DoneScreen.swift` into this file unchanged, then add:

```swift
import SwiftUI
import MattstackCore

/// The summary's Overview pane: what the Installed screen carried.
struct SummaryOverview: View {
    @ObservedObject var model: DoneModel
    @ObservedObject var install: InstallRunModel
    let isOwner: Bool
    /// A solo install turns board off, so the pane points at console.
    let solo: Bool
    let onInvite: () -> Void
    let onRetry: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Group {
                    if !model.hasConfirmedRows {
                        ProgressView().controlSize(.large)
                    } else if isBlocked {
                        Image(systemName: headlineSymbol).symbolRenderingMode(.multicolor)
                    } else {
                        Image(systemName: headlineSymbol).foregroundStyle(allDone ? Color.green : Color.accentColor)
                    }
                }
                .font(.system(size: 30))
                VStack(alignment: .leading, spacing: 2) {
                    Text(headline).font(.title3.weight(.semibold))
                    Text(verifySummary).foregroundStyle(.secondary)
                }
            }
            if model.refreshFailed {
                HStack {
                    Text("Couldn't confirm the checklist: \(model.refreshError ?? "unknown error")")
                        .font(.callout).foregroundStyle(.red)
                        .accessibilityIdentifier(AXID.doneRefreshError)
                    Spacer()
                    Button("Try again") { Task { await model.retryCheck() } }
                        .controlSize(.small)
                        .accessibilityIdentifier(AXID.doneRetryCheck)
                }
            }
            if !install.partialSteps.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Needs another try").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(install.partialSteps) { step in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(step.info.title)
                                    if let d = step.detail, !d.isEmpty { Text(d).font(.caption).foregroundStyle(.orange) }
                                }
                                Spacer()
                                Button("Retry from here") { onRetry(step.id) }
                                    .controlSize(.small)
                                    .disabled(install.isRunning)
                                    .accessibilityIdentifier(AXID.donePartialStepRetry(step.id))
                                RowStatusProbe(status: .missing, id: AXID.donePartialStepStatus(step.id))
                            }
                            if let r = step.remedy {
                                Text(r).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .accessibilityElement(children: .contain)
                        .accessibilityIdentifier(AXID.donePartialStep(step.id))
                    }
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Where things live").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                LabeledContent("Menu bar") { Text("the m icon, top right") }
                LabeledContent("Terminal") { Text("run rt in a new terminal window") }
                LabeledContent(homeApp.title) { Link(homeApp.host, destination: homeApp.url) }
            }
            HStack {
                Button("Open the \(homeApp.title.lowercased())", action: openHomeApp).accessibilityIdentifier(AXID.doneOpenBoard)
                if isOwner { Button("Invite teammates…", action: onInvite).accessibilityIdentifier(AXID.doneInvite) }
                Spacer()
            }
            .controlSize(.regular)
        }
        .padding(16)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.doneOverview)
    }

    private var isBlocked: Bool { !model.blockedRows.isEmpty }
    private var allDone: Bool { model.stillToDoRows.isEmpty && install.partialSteps.isEmpty }
    private var headline: String {
        guard model.hasConfirmedRows, !isBlocked, !install.partialSteps.isEmpty else { return model.headline }
        return FinishGate.retryHeadline(partial: install.partialSteps.count)
    }
    private var headlineSymbol: String { FinishGate.headlineSymbol(blocked: isBlocked, allDone: allDone) }

    private var verifySummary: String {
        let verify = install.steps.first { $0.id == "verify" }
        let n = install.steps.filter { $0.state == .done || $0.state == .needsYou }.count
        let partial = install.partialSteps.count
        let steps = partial == 0 ? "\(n) steps done" : "\(n) steps done, \(partial) need\(partial == 1 ? "s" : "") another try"
        return verify?.detail.map { "\($0) · \(steps)" } ?? steps
    }

    private var homeApp: (title: String, host: String, url: URL) {
        solo ? ("Console", "console.mattstack", URL(string: "https://console.mattstack")!)
             : ("Board", "board.mattstack", URL(string: "https://board.mattstack")!)
    }

    /// Stub mode never opens a real browser tab.
    private func openHomeApp() {
        guard !BundleFlavor.isStubActive else {
            TrayLog.info("open \(homeApp.host) skipped (stub mode)")
            return
        }
        NSWorkspace.shared.open(homeApp.url)
    }
}
```

- [ ] **Step 2: Ids**

In `AccessibilityIDs.swift` add `static let doneOverview = "setup.done.overview"` under `// Done`, and delete `doneStillToDo`, `doneStillToDoRow`, `doneStillToDoRowStatus`, `doneStillToDoRowAction`, and `doneBeforeYouFinish` if nothing else reads it after this task (search with `rg -n "doneBeforeYouFinish\b|doneStillToDo" rt-tray/Sources`).

- [ ] **Step 3: Replace the `.done` case in `SetupView`**

```swift
                case .done:
                    ChecklistScreen(
                        model: readiness, permissions: permissions, rt: env.rt, needs: env.needs,
                        presentation: .sidebar(
                            overview: AnyView(SummaryOverview(
                                model: done, install: install,
                                isOwner: DoneRole.owner(planTeam: readiness.team, choice: team.choice),
                                solo: DoneRole.solo(planTeam: readiness.team, choice: team.choice),
                                onInvite: { NotificationCenter.default.post(name: .rtShowSettingsTeam, object: nil) },
                                onRetry: { id in install.retry(from: id); flow.jump(to: .install) })),
                            onSkip: { done.requestSkip($0) }))
                        .task { await done.checkPostInstall() }
                        .sheet(item: $done.skipTarget) { _ in SkipConfirmSheet(model: done) }
                        .accessibilityElement(children: .contain)
                        .accessibilityIdentifier(AXID.doneScreen)
                        .transition(pushTransition)
```

`$done.skipTarget` needs `done` bound: `SetupView` already holds `@ObservedObject var done: DoneModel`, so `$done.skipTarget` compiles as written.

`ChecklistScreen` already sets `.accessibilityIdentifier(AXID.checklistScreen)` on its own root; the outer `.contain` container carries `doneScreen`, so both ids resolve.

In `SetupView.task(id: flow.step)`, the readiness visibility branch treats only `.checklist` as showing readiness. The summary also shows live rows, so change the condition `if flow.step == .checklist {` to `if flow.step == .checklist || flow.step == .done {` and keep `await readiness.load()` inside it only for `.checklist`:

```swift
            if flow.step == .checklist || flow.step == .done {
                if !flow.readinessIsVisible { flow.readinessIsVisible = true; readiness.becameVisible() }
                if flow.step == .checklist { await readiness.load() }
            } else if flow.readinessIsVisible {
```

Delete `DoneScreen.swift`.

- [ ] **Step 4: Build and run the checks**

Run: `swift build` then `swift run mattstack-checks`
Expected: both pass. `DoneModelChecks` is untouched: `DoneModel` did not change.

- [ ] **Step 5: Commit**

```bash
git add -A rt-tray/Sources
git commit -m "tray: end setup on the sidebar summary with an Overview"
```

---

### Task 6: UI tests and the row snapshot

**Files:**
- Modify: `rt-tray/Tests/mattstackUITests/SetupFlowUITests.swift`
- Modify: `rt-tray/Sources/Setup/ChecklistRowSnapshot.swift`

**Interfaces:**
- Consumes: ids `setup.checklist.page.<group>`, `setup.checklist.continue`, `setup.checklist.group.<id>`, `setup.done.overview`, `setup.done.skip.<row>`, `setup.checklist.row.<id>`, `setup.checklist.noAction.toggle`.

- [ ] **Step 1: Add a helper that pages to Install**

In `SetupFlowUITests.swift`, next to `waitFor`:

```swift
    /// Presses the wizard's primary button until the Install screen shows.
    /// Each press must be enabled: a page that blocks is a test failure here,
    /// since every stub scenario that calls this is installable.
    private func pageThroughChecklist(file: StaticString = #filePath, line: UInt = #line) {
        waitFor("setup.checklist.screen")
        for _ in 0..<12 {
            if el("setup.install.screen").exists { return }
            waitUntilEnabled("setup.checklist.continue", 20)
            el("setup.checklist.continue").click()
        }
        XCTFail("the checklist never reached Install", file: file, line: line)
    }
```

- [ ] **Step 2: Use it wherever a test clicked the checklist's Continue once**

Replace each `el("setup.checklist.continue").click()` that is followed by a wait on Install or Done (lines 116 to 118, 205, 225, 341) with `pageThroughChecklist()`. Replace the two lines

```swift
        waitFor("setup.checklist.summary")
        XCTAssertTrue(el("setup.checklist.continue").waitForExistence(timeout: 20))
```

with

```swift
        waitFor("setup.checklist.page.mac")
        XCTAssertTrue(el("setup.checklist.row.perm.fda").waitForExistence(timeout: 20), "the first page drew its rows")
```

This restores the row-level assertion #812 weakened.

In `testPermissionDeniedThenGrantedEnablesInstall`, the blocked row is on the Your Mac page, which is the first page, so the existing `XCTAssertFalse(el("setup.checklist.continue").isEnabled)` and the re-check loop stay as they are.

- [ ] **Step 3: Update the summary assertions**

In `testJoinHappyWalksAllFiveScreens`: after `waitFor("setup.done.screen", 60)` add `waitFor("setup.done.overview")`; replace `XCTAssertFalse(el("setup.done.beforeYouFinish").exists, ...)` with `XCTAssertFalse(el("setup.checklist.group.needs-you").exists, "join-happy's plan gates nothing")`.

In `testFinishGateSkipForNowEnablesFinish`, replace the body between the first `waitFor` and the final click with:

```swift
        waitFor("setup.done.beforeYouFinish.tool.fast-browser-extension", 30)
        XCTAssertTrue(el("setup.checklist.group.needs-you").exists, "the summary opens on Needs you")
        XCTAssertFalse(el("setup.done.continue").isEnabled, "Finish waits on the extension")
        el("setup.done.skip.tool.fast-browser-extension").click()
        waitFor("setup.done.skipConfirm")
        el("setup.done.skipConfirm.skip").click()
        waitUntilEnabled("setup.done.continue", 30)
        XCTAssertFalse(el("setup.checklist.group.needs-you").exists, "the skipped row left Needs you")
        XCTAssertFalse(el("setup.done.skipConfirm").exists, "the sheet closed on success")
        el("setup.checklist.group.browser").click()
        waitFor("setup.checklist.row.tool.fast-browser-extension")
```

If the stub plan puts the extension row in a group other than `browser`, use that group's id (read it from `Tests/stub-rt/stub.ts`, `extensionRow()` and the groups it is pushed into).

Line 194, the "Team repo reachable" absence check that #812 left vacuous: make it page to where the row would be before asserting it is absent:

```swift
        pageThroughChecklistUntil(page: "access", orInstall: true)
        XCTAssertFalse(app.staticTexts["Team repo reachable"].exists, "a solo plan has no team repo row")
```

with this helper beside `pageThroughChecklist`:

```swift
    /// Walks pages until the named page shows; stops at the last page when it never does.
    private func pageThroughChecklistUntil(page: String, orInstall: Bool) {
        waitFor("setup.checklist.screen")
        for _ in 0..<12 {
            if el("setup.checklist.page.\(page)").exists { return }
            if el("setup.checklist.continue").label == "Install" { return }
            waitUntilEnabled("setup.checklist.continue", 20)
            el("setup.checklist.continue").click()
        }
    }
```

A solo plan has no Access group, so the loop ends on the last page with every earlier page already seen; assert on each page instead by moving the `XCTAssertFalse` inside the loop before the click if the single end-of-walk assertion proves too weak in practice.

In `testFastBrowserExtensionStepsLightAndDark`, the action id `setup.done.beforeYouFinish.tool.fast-browser-extension.action` is unchanged (the summary's Needs you pane uses `RowIDs.beforeYouFinish`).

In the two light and dark screenshot tests, add shots of a page and the summary:

```swift
            waitFor("setup.checklist.page.mac"); shoot("page-mac-\(scheme)")
            pageThroughChecklist()
            waitFor("setup.done.screen", 60); waitFor("setup.done.overview"); shoot("summary-\(scheme)")
```

- [ ] **Step 4: Redraw the snapshot**

Open `rt-tray/Sources/Setup/ChecklistRowSnapshot.swift`. It builds sample `PlanRow`s and renders them in a grouped `Form` with `RowView`. Replace the rendering (keep the sample rows) so it draws one `ChecklistSectionsView`:

```swift
        let layout = ChecklistLayout.make([PlanGroup(id: "sample", title: "Sample", rows: rows)], finishBlockedBy: [])
        return ChecklistSectionsView(section: layout.sections[0], finishBlockedBy: [], activity: RowActivity()) { _ in }
            .padding(20)
            .frame(width: SetupWindowController.width)
```

where `rows` is the array of sample rows the file already declares (flatten its groups with `flatMap(\.rows)` if it declares groups).

- [ ] **Step 5: Run the UI suite**

The UI suite needs Xcode and a GUI session. Per `rt-tray/vm/run/xcuitest.sh`, from `rt-tray/`:

```bash
xcodebuild test -project mattstack.xcodeproj -scheme mattstack -destination 'platform=macOS' -only-testing:mattstackUITests CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="" ENABLE_HARDENED_RUNTIME=NO
```

This launches the app under test and takes over the screen: tell Matt before running it, and do not run it while he is using the Mac unless he says to. Expected: every test in `SetupFlowUITests` passes. Read the page and summary screenshots it attaches, both schemes, and say plainly what looks wrong.

- [ ] **Step 6: Commit**

```bash
git add rt-tray/Tests/mattstackUITests rt-tray/Sources/Setup/ChecklistRowSnapshot.swift
git commit -m "tray: UI tests page through setup and assert on rows again"
```

---

### Task 7: The VM walkthrough pages through the wizard

**Files:**
- Modify: `rt-tray/vm/run/guest/ax.sh`
- Modify: `rt-tray/vm/run/guest/screens.sh`
- Modify: `rt-tray/vm/check-vm-scripts.sh`

**Interfaces:**
- Consumes: ids `setup.checklist.page.<group>`, `setup.checklist.continue`, `setup.checklist.back`, `setup.checklist.group.<id>`, `setup.checklist.noAction.toggle`, `setup.done.overview`.

- [ ] **Step 1: Teach `ax_reveal_row` to walk pages**

In `ax.sh`, replace the body of `ax_reveal_row` so it handles both layouts. The wizard shows one group per page and has no sidebar; the summary and Setup status have a sidebar:

```bash
# A row is reachable only when its group is on screen. In the wizard that is
# a page, reached with Continue and Back; on the summary and in Setup status
# it is a sidebar entry. A row under "No action needed" is not in the
# accessibility tree until that line is opened.
ax_reveal_row() {  # <axid>; a no-op for anything outside setup.checklist.row.
  case "$1" in setup.checklist.row.*) ;; *) return 0 ;; esac
  local row="${1%.action}" g gid n
  row="${row%.status}"; row="${row%.error}"; row="${row%.waiting}"
  ax_find_raw "$row" >/dev/null 2>&1 && return 0
  ax_open_no_action; ax_find_raw "$row" >/dev/null 2>&1 && return 0
  for g in $(ax_dump_ids | grep -o 'setup\.checklist\.group\.[A-Za-z0-9._-]*' | sort -u); do
    gid=$(ax_esc "$g")
    ax_osa "$AX_WALK_AS
      tell application \"System Events\" to tell process \"$AX_APP\"
        set r to my walk(window 1, \"$gid\")
        if r is missing value then error \"axid not found: $gid\"
        click r
      end tell" >/dev/null 2>&1 || continue
    ax_find_raw "$row" >/dev/null 2>&1 && return 0
    ax_open_no_action; ax_find_raw "$row" >/dev/null 2>&1 && return 0
  done
  ax_dump_ids | grep -q 'setup\.checklist\.page\.' || return 1
  # Back to the first page, then forward one page at a time. Forward stops at
  # a page whose Continue is off or reads Install: the row is not reachable yet.
  n=12; while [ "$n" -gt 0 ] && ax_page_step back; do n=$((n-1)); done
  n=12
  while [ "$n" -gt 0 ]; do
    ax_find_raw "$row" >/dev/null 2>&1 && return 0
    ax_open_no_action; ax_find_raw "$row" >/dev/null 2>&1 && return 0
    ax_page_step continue || return 1
    n=$((n-1))
  done
  return 1
}

ax_open_no_action() {
  ax_find_raw setup.checklist.noAction.toggle >/dev/null 2>&1 || return 0
  ax_click_raw setup.checklist.noAction.toggle >/dev/null 2>&1 || true
}

# Moves one wizard page. Never presses Install, and never leaves the checklist.
ax_page_step() {  # back|continue
  local id="setup.checklist.$1" before after
  before=$(ax_dump_ids | grep -o 'setup\.checklist\.page\.[A-Za-z0-9._-]*' | head -1)
  [ -n "$before" ] || return 1
  if [ "$1" = continue ]; then
    [ "$(ax_title "$id" 2>/dev/null || true)" = "Install" ] && return 1
  else
    # The first page is step 3 (after Welcome and Your team); Back from it
    # would leave the checklist for Your team.
    case "$(ax_value setup.window.progress 2>/dev/null || true)" in "3 of "*) return 1 ;; esac
  fi
  ax_enabled "$id" >/dev/null 2>&1 || return 1
  ax_click_raw "$id" >/dev/null 2>&1 || return 1
  sleep 1
  after=$(ax_dump_ids | grep -o 'setup\.checklist\.page\.[A-Za-z0-9._-]*' | head -1)
  [ -n "$after" ] && [ "$after" != "$before" ]
}
```

`ax_click` calls `ax_reveal_row` first, so the page stepping must not recurse through it. Add `ax_click_raw` as the existing click body without the reveal call, and make `ax_click` call reveal then `ax_click_raw`:

```bash
ax_click_raw() {  # <axid>
  local id; id=$(ax_esc "$1")
  # (the existing body of ax_click from this line on, unchanged)
}

ax_click() {  # <axid>
  ax_reveal_row "$1" || true
  ax_click_raw "$1"
}
```

`ax_title` and `ax_enabled` must exist. `ax.sh` already has `ax_wait_enabled`; read how it reads the enabled attribute and add, in the same style:

```bash
ax_enabled() {  # <axid> → exit 0 when the element is enabled
  local id; id=$(ax_esc "$1")
  [ "$(ax_osa "$AX_WALK_AS
    tell application \"System Events\" to tell process \"$AX_APP\"
      set r to my walk(window 1, \"$id\")
      if r is missing value then error \"axid not found: $id\"
      return enabled of r
    end tell" 2>/dev/null)" = "true" ]
}

ax_title() {  # <axid> → the element's title
  local id; id=$(ax_esc "$1")
  ax_osa "$AX_WALK_AS
    tell application \"System Events\" to tell process \"$AX_APP\"
      set r to my walk(window 1, \"$id\")
      if r is missing value then error \"axid not found: $id\"
      return title of r
    end tell"
}
```

If `ax.sh` already defines either name, keep its definition and drop the one above.

- [ ] **Step 2: Walk to Install in `screens.sh`**

The checklist section clicks `setup.checklist.continue` once to reach Install (line 190). Replace that click with a walk, since Continue now moves one page:

```bash
  # Every page's Continue, then the last page's Install.
  n=12
  while [ "$n" -gt 0 ] && ! ax_find setup.install.screen >/dev/null 2>&1; do
    ax_wait_enabled setup.checklist.continue 60 || ax_fail "the wizard is stuck on $(ax_dump_ids | grep -o 'setup\.checklist\.page\.[A-Za-z0-9._-]*' | head -1): Continue never enabled"
    ax_click_raw setup.checklist.continue
    sleep 1; n=$((n-1))
  done
```

The row-by-row steps before it (`account.$FORGE`, `perm.fda`, `perm.login-items`, `perm.notifications`, `tool.clt`, `tool.rt`, the tools loop, `repos.root`, `tool.proxy`) keep working unchanged: `ax_status`, `ax_click`, `ax_find` and `ax_value` all reveal the row's page first. They run in an order that jumps between pages (Accounts, then Your Mac); that is correct, only slower. A row on a later page is reachable only once earlier pages' required rows are done, so reorder the steps to page order: move the `account.$FORGE` block (lines 83 to 101) to after the `tool.clt` block (after line 153), so Your Mac's rows are settled before Accounts is needed.

After the Full Disk Access relaunch (line 130), `ax_wait_screen checklist 30` still holds; the next `ax_wait_status perm.fda ready 30` reveals the Your Mac page.

The row-status dump (line 175) lists only the rows on screen. Make it walk every page so the log stays complete:

```bash
  n=12; while [ "$n" -gt 0 ] && ax_page_step back; do n=$((n-1)); done
  rows=""; n=12
  while [ "$n" -gt 0 ]; do
    ax_open_no_action
    for id in $(ax_dump_ids | grep -o 'setup\.checklist\.row\.[A-Za-z0-9._-]*' | sed -E 's/\.(action|status|error)$//' | sed 's/^setup\.checklist\.row\.//' | sort -u); do
      rows="$rows$id=$(ax_status "$id" 2>/dev/null || echo '?') "
    done
    ax_page_step continue || break
    n=$((n-1))
  done
  ax_log "checklist rows: $rows"
```

- [ ] **Step 3: The summary in `screens.sh`**

In the Done section: after `ax_wait_screen done 10` add `ax_find setup.done.overview >/dev/null 2>&1 || ax_find setup.checklist.group.needs-you >/dev/null 2>&1 || ax_fail "the summary drew neither Overview nor Needs you"`.

Line 282, the assertion that a skipped row moved to Still to do, becomes an assertion that it left Needs you and is in its group:

```bash
    ax_find setup.done.beforeYouFinish.tool.fast-browser-extension >/dev/null 2>&1 && ax_fail "the skipped row is still under Needs you"
    ax_find setup.checklist.row.tool.fast-browser-extension.status >/dev/null 2>&1 || ax_fail "the skipped row is not in its group on the summary"
```

`ax_find` on a `setup.checklist.row.*` id reveals the row through the sidebar.

In `check-vm-scripts.sh` line 163, change the pinned string from `setup.done.stillToDo.tool.fast-browser-extension.status` to `setup.checklist.row.tool.fast-browser-extension.status`.

- [ ] **Step 4: Check the scripts**

Run: `bash rt-tray/vm/check-vm-scripts.sh`
Expected: passes. Also `bash -n rt-tray/vm/run/guest/ax.sh` and `bash -n rt-tray/vm/run/guest/screens.sh` exit 0.

This does not prove the driver works: only a VM walkthrough does. Say so in the PR.

- [ ] **Step 5: Commit**

```bash
git add rt-tray/vm
git commit -m "tray vm: walkthrough pages through the setup wizard"
```

---

### Task 8: Look at it, then open the PR

**Files:** none new.

- [ ] **Step 1: Stage a dev build**

Run in the background from the worktree: `bun scripts/build-dev-app.ts --local --yes > <scratchpad>/build-dev-app.log 2>&1`. When it exits, read the last line. On `✓ staged`, tell Matt to click **New build · Restart**.

- [ ] **Step 2: Setup status on a real Mac**

Ask Matt to open Setup status. Check against boards H4 and H5: no icon on any row; a warning only on a "Needs you" heading; optional rows under Optional; "No action needed · N" folded with names, open when it is the only section; the sidebar shows a spinner on a group while one of its rows runs.

- [ ] **Step 3: First run**

First run cannot be seen on a Mac that is set up. The evidence is the UI test screenshots from Task 6 (pages and summary, both schemes) compared with boards G1, G2, H1, H2, H3 and H6. List every difference from the boards plainly.

No user doc describes the setup screens today (`rg -n "Before we begin|limited mode|Setup status" docs -g "!docs/superpowers/**" -g "!docs/apps/superpowers/**"` finds none), so there is no doc to update. Re-run that search before the PR in case one landed.

- [ ] **Step 4: Purity, push, PR**

Run `bun run purity`. Push with `mcp__plugin_mattstack_mattstack__git_push`. Open the PR with the fallback body format (the repo has no PR template), naming under Verification what was and was not seen: the UI suite result, Setup status in the dev app, and that the VM walkthrough has not been run unless it has.

- [ ] **Step 5: Reviews**

Wait for CodeRabbit and CI. If CodeRabbit is rate limited, spawn an Opus review naming model and effort. Merge only on Matt's confirmation.
