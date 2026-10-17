import Foundation
import MattstackCore

private func place(mode: String, problem: String? = nil) -> RowAction {
    RowAction(type: .placeRepo, label: "Locate…", identity: "gitlab.com/acme/widgets", repo: "widgets", mode: mode,
              checkoutPath: mode == "checkout" ? "~/code/widgets" : nil, clonePath: "~/code/widgets-2",
              note: problem ?? "Found your widgets checkout", problem: problem, segmentRecords: true)
}

let repoPlacementStateChecks: [Check] = [
    Check("RepoPlacementState.buttonLabel: each mode's button, and its again-wording after a refused pick") { c in
        c.expectEqual(RepoPlacementState.buttonLabel(mode: "checkout", lastError: nil), "Locate…")
        c.expectEqual(RepoPlacementState.buttonLabel(mode: "clone", lastError: nil), "Choose location…")
        c.expectEqual(RepoPlacementState.buttonLabel(mode: "checkout", lastError: "~/foo isn't a git checkout."), "Locate again…")
        c.expectEqual(RepoPlacementState.buttonLabel(mode: "clone", lastError: "~/code/acme-api already exists."), "Choose another location…")
    },
    Check("RepoPlacementState.noteStyle: a problem or a refused pick is red, a ready checkout green, a clone secondary") { c in
        c.expectEqual(RepoPlacementState.noteStyle(action: place(mode: "checkout", problem: "~/foo isn't a git checkout."), shown: "checkout", lastError: nil), .problem)
        c.expectEqual(RepoPlacementState.noteStyle(action: place(mode: "checkout"), shown: "checkout", lastError: "~/foo isn't a git checkout."), .problem)
        c.expectEqual(RepoPlacementState.noteStyle(action: place(mode: "checkout"), shown: "checkout", lastError: nil), .ok)
        c.expectEqual(RepoPlacementState.noteStyle(action: place(mode: "clone"), shown: "clone", lastError: nil), .secondary)
    },
    Check("RepoPlacementState.noteStyle: off rt's recorded segment, its problem and its green do not apply") { c in
        c.expectEqual(RepoPlacementState.noteStyle(action: place(mode: "checkout", problem: "~/foo isn't a git checkout."), shown: "clone", lastError: nil), .secondary)
        c.expectEqual(RepoPlacementState.noteStyle(action: place(mode: "checkout"), shown: "clone", lastError: nil), .secondary)
        c.expectEqual(RepoPlacementState.noteStyle(action: place(mode: "clone"), shown: "checkout", lastError: "~/foo isn't a git checkout."), .problem)
    },
]
