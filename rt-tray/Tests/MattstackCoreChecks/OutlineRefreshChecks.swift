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

private func describe(_ step: OutlineRefresh<Node>.Step) -> String {
    switch step {
    case .node(let node): return "node \(node.name)"
    case .subtree(let node): return "subtree \(node.name)"
    }
}

let outlineRefreshChecks: [Check] = [
    Check("outline refresh: a tick that changed no structure reloads every node one by one, never the whole tree") { c in
        let plan = OutlineRefresh.plan(structureChanged: false, roots: tree, children: { $0.children }, childrenChanged: { _ in false })
        guard case .reload(let steps) = plan else { return c.fail("expected reload, got \(plan)") }
        c.expectEqual(steps.map(describe), ["node repo-a", "node bun", "node node", "node claude", "node repo-b", "node deck"])
    },
    Check("outline refresh: a parent whose children changed reloads with its subtree, and nothing below it is visited again") { c in
        let plan = OutlineRefresh.plan(structureChanged: false, roots: tree, children: { $0.children }, childrenChanged: { $0.name == "bun" })
        guard case .reload(let steps) = plan else { return c.fail("expected reload, got \(plan)") }
        c.expectEqual(steps.map(describe), ["node repo-a", "subtree bun", "node claude", "node repo-b", "node deck"])
    },
    Check("outline refresh: a changed structure rebuilds the tree") { c in
        let plan = OutlineRefresh.plan(structureChanged: true, roots: tree, children: { $0.children }, childrenChanged: { _ in true })
        guard case .rebuild = plan else { return c.fail("expected rebuild, got \(plan)") }
    },
]
