import Foundation
import MattstackCore

/// A bound unix socket in a short scratch dir (sun_path caps a path near 104
/// bytes, so the dir is under /tmp, not the long per-user temp root).
private final class ProbeSocket {
    let dir: String
    let path: String
    private var fd: Int32 = -1

    init() {
        var template = Array("/tmp/hsp.XXXXXX".utf8CString)
        dir = String(cString: mkdtemp(&template))
        path = "\(dir)/s"
    }

    func listen() {
        fd = socket(AF_UNIX, SOCK_STREAM, 0)
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        withUnsafeMutableBytes(of: &addr.sun_path) { raw in
            let bytes = Array(path.utf8) + [0]
            raw.copyBytes(from: bytes.prefix(raw.count))
        }
        let bound = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        precondition(bound == 0 && Foundation.listen(fd, 1) == 0, "test socket must bind and listen")
    }

    func closeListener() {
        if fd >= 0 { close(fd); fd = -1 }
    }

    func cleanup() {
        closeListener()
        try? FileManager.default.removeItem(atPath: dir)
    }
}

let herdrSocketProbeChecks: [Check] = [
    Check("a listening socket reads as running") { c in
        let s = ProbeSocket()
        defer { s.cleanup() }
        s.listen()
        c.expect(HerdrSocketProbe.isListening(s.path), "a socket with a listener must answer")
    },
    Check("a regular file at the path is not running") { c in
        let s = ProbeSocket()
        defer { s.cleanup() }
        FileManager.default.createFile(atPath: s.path, contents: Data())
        c.expect(!HerdrSocketProbe.isListening(s.path), "a plain file is not a server")
    },
    // The crash leftover: herdr died, its socket file stayed behind.
    Check("a socket file whose listener closed is not running") { c in
        let s = ProbeSocket()
        defer { s.cleanup() }
        s.listen()
        s.closeListener()
        c.expect(FileManager.default.fileExists(atPath: s.path), "the leftover file stays on disk")
        c.expect(!HerdrSocketProbe.isListening(s.path), "a leftover socket file must not read as running")
    },
    Check("no file at the path is not running") { c in
        let s = ProbeSocket()
        defer { s.cleanup() }
        c.expect(!HerdrSocketProbe.isListening(s.path), "a missing path is not running")
    },
]
