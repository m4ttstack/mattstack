import Foundation
@testable import MattstackCore

let devLoginLinkChecks: [Check] = [
    Check("dev login link: origin is the only thing read") { c in
        let url = URL(string: "mattstack://dev-logins/add?origin=https%3A%2F%2Flogin.example.com&password=hunter2&email=a")!
        c.expectEqual(DevLoginLink.origin(from: url), "https://login.example.com")
    },
    Check("dev login link: wrong host, wrong path, no origin, or two origins is nil") { c in
        for s in ["mattstack://open/add?origin=https%3A%2F%2Fa.example",
                  "mattstack://dev-logins/remove?origin=https%3A%2F%2Fa.example",
                  "mattstack://dev-logins/add",
                  "mattstack://dev-logins/add?origin=https%3A%2F%2Fa.example&origin=https%3A%2F%2Fb.example",
                  "https://dev-logins/add?origin=https%3A%2F%2Fa.example"] {
            c.expect(DevLoginLink.origin(from: URL(string: s)!) == nil, s)
        }
    },
    Check("dev login origin: https host and local http pass, lowercased") { c in
        c.expectEqual(DevLoginOrigin.validate("https://Login.Example.com"), .valid(origin: "https://login.example.com", host: "login.example.com"))
        c.expectEqual(DevLoginOrigin.validate("http://localhost:3000"), .valid(origin: "http://localhost:3000", host: "localhost"))
        c.expectEqual(DevLoginOrigin.validate("https://login.example.com/"), .valid(origin: "https://login.example.com", host: "login.example.com"))
    },
    Check("dev login origin: IPv4 and punycode hosts pass") { c in
        c.expectEqual(DevLoginOrigin.validate("http://127.0.0.1:8080"), .valid(origin: "http://127.0.0.1:8080", host: "127.0.0.1"))
        c.expectEqual(DevLoginOrigin.validate("https://xn--bcher-kva.example"), .valid(origin: "https://xn--bcher-kva.example", host: "xn--bcher-kva.example"))
    },
    Check("dev login origin: the spec's refusals") { c in
        for s in ["http://login.example.com", "https://login.example.com/u/login", "https://login.example.com?x=1",
                  "https://login.example.com#x", "https://dev:pw@login.example.com", "https://log_in.example.com",
                  "https://bücher.example", "ftp://login.example.com", "login.example.com", ""] {
            if case .valid = DevLoginOrigin.validate(s) { c.fail("accepted \(s)") }
        }
    },
    Check("dev login origin: a host label that rt would refuse is refused") { c in
        for s in ["https://a!b.example", "https://-a.example", "https://a-.example", "https://login.example.com.",
                  "https://.login.example.com", "https://login..example.com"] {
            if case .valid = DevLoginOrigin.validate(s) { c.fail("accepted \(s)") }
        }
    },
    Check("dev login origin: a port outside 1 to 65535 is refused") { c in
        for s in ["https://a.example:65536", "https://a.example:99999999999", "https://a.example:0"] {
            if case .valid = DevLoginOrigin.validate(s) { c.fail("accepted \(s)") }
        }
        c.expectEqual(DevLoginOrigin.validate("https://a.example:8443"), .valid(origin: "https://a.example:8443", host: "a.example"))
    },
    Check("dev login origin: an IPv6 host is refused") { c in
        for s in ["https://[::1]", "https://[::1]:8443", "http://[::1]:3000"] {
            if case .valid = DevLoginOrigin.validate(s) { c.fail("accepted \(s)") }
        }
    },
]
