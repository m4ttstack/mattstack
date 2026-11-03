import Foundation

/// How an outline applies a refreshed tree. On macOS 27 a whole-tree reload
/// (`reloadData()`, `reloadItem(nil, reloadChildren: true)`) leaks one
/// disclosure button per expandable row: AppKit keeps the discarded button
/// registered as a key-window observer, so every activation retints all of
/// them and the app takes seconds to come forward after a few hours of
/// polling. Reloading a node on its own, or a parent with its subtree, leaks
/// nothing, so only a change among the roots may rebuild the tree.
public enum OutlineRefresh<Node> {
    public enum Step {
        /// Redraw the node in place; its children are unchanged.
        case node(Node)
        /// Re-read the node's children (membership or order changed) and
        /// everything below them.
        case subtree(Node)
    }

    case rebuild
    case reload([Step])

    public static func plan(structureChanged: Bool, roots: [Node], children: (Node) -> [Node],
                            childrenChanged: (Node) -> Bool) -> OutlineRefresh<Node> {
        guard !structureChanged else { return .rebuild }
        var steps: [Step] = []
        func visit(_ node: Node) {
            if childrenChanged(node) {
                steps.append(.subtree(node))
                return
            }
            steps.append(.node(node))
            children(node).forEach(visit)
        }
        roots.forEach(visit)
        return .reload(steps)
    }
}
