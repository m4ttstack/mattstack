import Foundation

// Root writes under a directory only after this has walked it: a segment the
// console user owns, can write, or has swapped for a symlink would let them
// replace what root is about to stage, check or exec.
enum RootOwned {
    /// Every segment of `url` that exists, from `/` down, must be owned by
    /// root, not a symlink, and writable by nobody else; a missing tail is
    /// fine. Returns whether `url` itself exists.
    @discardableResult
    static func check(_ url: URL, fs: FileOps) throws -> Bool {
        var exists = false
        let target = url.standardizedFileURL
        for segment in ancestorsIncludingSelf(of: target) {
            guard let info = try fs.stat(segment) else { continue }
            if info.isSymlink {
                throw ProxyInstallError("refusing to install under symlink \(segment.path)")
            }
            if info.uid != 0 {
                throw ProxyInstallError("refusing to install under \(segment.path): owned by uid \(info.uid), not root")
            }
            if info.isGroupOrWorldWritable {
                throw ProxyInstallError("refusing to install under \(segment.path): writable by group or other")
            }
            if segment.path == target.path { exists = true }
        }
        return exists
    }

    static func ancestorsIncludingSelf(of url: URL) -> [URL] {
        var chain: [URL] = []
        var current = url.standardizedFileURL
        while true {
            chain.append(current)
            let parent = current.deletingLastPathComponent().standardizedFileURL
            if parent.path == current.path { break }
            current = parent
        }
        return chain.reversed()
    }
}
