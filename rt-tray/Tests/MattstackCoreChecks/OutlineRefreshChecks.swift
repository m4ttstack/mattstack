import Foundation
@testable import MattstackCore

private struct Node {
    let name: String
    var children: [Node] = []
}

private let tree = [
    Node(name: "repo-a", children: [Node(name: "bun", children: [Node(name: "node")]), Node(name: "claude")]),
    Node(name: "repo-b", children: [Node(name: "deck")]),
]

let outlineRefreshChecks: [Check] = [
    Check("outline refresh: a tick that changed no structure reloads every node one by one, never the whole tree") { c in
        let plan = OutlineRefresh.plan(structureChanged: false, roots: tree, children: { $0.children })
        guard case .reloadEach(let nodes) = plan else { return c.fail("expected reloadEach, got \(plan)") }
        c.expectEqual(nodes.map(\.name), ["repo-a", "bun", "node", "claude", "repo-b", "deck"])
    },
    Check("outline refresh: a changed structure rebuilds the tree") { c in
        let plan = OutlineRefresh.plan(structureChanged: true, roots: tree, children: { $0.children })
        guard case .rebuild = plan else { return c.fail("expected rebuild, got \(plan)") }
    },
]
