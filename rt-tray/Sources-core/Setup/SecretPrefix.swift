import Foundation

/// A secret's public prefix (`lin_api_`, `AGE-SECRET-KEY-1`), which a masked field may show in place of its first dots.
public enum SecretPrefix {
    /// A format hint that ends in an ellipsis (`lin_api_…`) names a prefix; any other hint (a token's scopes) names none.
    public static func fromHint(_ hint: String?) -> String? {
        guard let hint else { return nil }
        for ellipsis in ["…", "..."] where hint.hasSuffix(ellipsis) {
            let prefix = String(hint.dropLast(ellipsis.count))
            return prefix.isEmpty ? nil : prefix
        }
        return nil
    }

    /// All or nothing: the whole prefix only when the value starts with it and runs past it, else nothing,
    /// so no character of a value that differs from the prefix, or is only the prefix, ever shows.
    public static func shown(of value: String, prefix: String?) -> String {
        guard let prefix, value.hasPrefix(prefix), value.count > prefix.count else { return "" }
        return prefix
    }
}
