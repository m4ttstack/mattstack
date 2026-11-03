import Foundation

/// How an outline applies a refreshed tree. On macOS 27 a whole-tree reload
/// (`reloadData()`, `reloadItem(nil, reloadChildren: true)`) leaks one
/// disclosure button per expandable row: AppKit keeps the discarded button
/// registered as a key-window observer, so every activation retints all of
/// them and the app takes seconds to come forward after a few hours of
/// polling. Reloading each node on its own leaks nothing, so only a change
/// in structure may rebuild the tree.
public enum OutlineRefresh<Node> {
    case rebuild
    case reloadEach([Node])

    public static func plan(structureChanged: Bool, roots: [Node], children: (Node) -> [Node]) -> OutlineRefresh<Node> {
        guard !structureChanged else { return .rebuild }
        var nodes: [Node] = []
        func visit(_ node: Node) {
            nodes.append(node)
            children(node).forEach(visit)
        }
        roots.forEach(visit)
        return .reloadEach(nodes)
    }
}
