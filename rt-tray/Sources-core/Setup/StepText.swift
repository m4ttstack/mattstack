import Foundation

/// A row's steps travel as plain strings; a URL inside one renders as a link
/// so a step like the Web Store install is one click, not a copy and paste.
public enum StepText {
    public static func attributed(_ step: String) -> AttributedString {
        var out = AttributedString(step)
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return out }
        for match in detector.matches(in: step, range: NSRange(step.startIndex..., in: step)) {
            guard let url = match.url, url.scheme == "https",
                  let range = Range(match.range, in: step), let linked = Range(range, in: out) else { continue }
            out[linked].link = url
        }
        return out
    }
}
