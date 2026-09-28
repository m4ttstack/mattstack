import Foundation

public enum DevLoginLink {
    /// mattstack://dev-logins/add?origin=<origin>. No other parameter is ever read.
    public static func origin(from url: URL) -> String? {
        guard url.scheme?.lowercased() == "mattstack", url.host?.lowercased() == "dev-logins",
              let comps = URLComponents(url: url, resolvingAgainstBaseURL: false), comps.path == "/add" else { return nil }
        let values = (comps.queryItems ?? []).filter { $0.name == "origin" }.compactMap(\.value)
        guard values.count == 1, let origin = values.first, !origin.isEmpty else { return nil }
        return origin
    }
}

/// The app-side mirror of rt's origin rules (lib/logins/origin.ts). rt stays
/// the authority on save; this decides whether the sheet may open at all.
/// Non-ASCII hosts are refused here because rt hands the app punycode.
public enum DevLoginOrigin {
    public enum Result: Equatable { case valid(origin: String, host: String); case invalid(String) }

    public static func validate(_ input: String) -> Result {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        // `host` decodes punycode to Unicode; `encodedHost` keeps the xn-- form rt stores.
        guard trimmed.allSatisfy(\.isASCII), let comps = URLComponents(string: trimmed),
              let scheme = comps.scheme?.lowercased(), let rawHost = comps.encodedHost, !rawHost.isEmpty else {
            return .invalid("Not an origin. Write it like https://login.example.com.")
        }
        let host = rawHost.lowercased()
        guard scheme == "https" || scheme == "http" else { return .invalid("Only https and http sites can hold a dev login.") }
        guard comps.user == nil, comps.password == nil else { return .invalid("An origin carries no user name or password.") }
        guard comps.path.isEmpty || comps.path == "/", comps.query == nil, comps.fragment == nil else {
            return .invalid("An origin has no path, query or fragment.")
        }
        // Foundation may report an IPv6 host with or without its brackets.
        guard !host.contains("_"), !host.hasPrefix("["), !host.contains(":") else { return .invalid("That host is not supported.") }
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.allSatisfy(isHostLabel) else {
            return .invalid("Each part of the host must be letters, digits or inner hyphens.")
        }
        // WHATWG rewrites a host that ends in a number into a canonical IPv4
        // address, so any other spelling would confirm a host rt never stores.
        if let last = labels.last, endsInNumber(last), !isCanonicalIPv4(labels) {
            return .invalid("Write an IP address as four plain numbers, like 127.0.0.1.")
        }
        guard scheme == "https" || host == "localhost" || host == "127.0.0.1" else {
            return .invalid("http is allowed only for localhost and 127.0.0.1.")
        }
        if let port = comps.port, !(1...65535).contains(port) {
            return .invalid("The port must be between 1 and 65535.")
        }
        let defaultPort = scheme == "https" ? 443 : 80
        let portPart = comps.port.map { $0 == defaultPort ? "" : ":\($0)" } ?? ""
        return .valid(origin: "\(scheme)://\(host)\(portPart)", host: host)
    }

    /// WHATWG's "ends in a number" test on the last label.
    private static func endsInNumber(_ label: Substring) -> Bool {
        if label.hasPrefix("0x") { return label.dropFirst(2).allSatisfy(\.isHexDigit) }
        return label.allSatisfy { ("0"..."9").contains($0) }
    }

    private static func isCanonicalIPv4(_ labels: [Substring]) -> Bool {
        labels.count == 4 && labels.allSatisfy { part in
            guard part.allSatisfy({ ("0"..."9").contains($0) }), part.count <= 3, let n = Int(part), n <= 255 else { return false }
            return part == "0" || !part.hasPrefix("0")
        }
    }

    /// Mirrors rt's HOST_LABEL, /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, on an already lowercased label.
    private static func isHostLabel(_ label: Substring) -> Bool {
        let isAlnum: (Character) -> Bool = { ("a"..."z").contains($0) || ("0"..."9").contains($0) }
        guard let first = label.first, let last = label.last, isAlnum(first), isAlnum(last) else { return false }
        return label.allSatisfy { isAlnum($0) || $0 == "-" }
    }
}
