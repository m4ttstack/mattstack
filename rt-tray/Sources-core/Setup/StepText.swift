import Foundation

/// A row's steps travel as plain strings; an inline `[text](https://…)` link
/// renders as that text, linked, so a step can carry a one-click URL without
/// printing it. Nothing else in a step is read as markdown.
public enum StepText {
    private static let link = try! NSRegularExpression(pattern: #"\[([^\]]+)\]\((https://[^)\s]+)\)"#)

    public static func attributed(_ step: String) -> AttributedString {
        var out = AttributedString()
        var cursor = step.startIndex
        for match in link.matches(in: step, range: NSRange(step.startIndex..., in: step)) {
            guard let whole = Range(match.range, in: step), let text = Range(match.range(at: 1), in: step),
                  let target = Range(match.range(at: 2), in: step), let url = URL(string: String(step[target])) else { continue }
            out += AttributedString(step[cursor..<whole.lowerBound])
            var linked = AttributedString(step[text])
            linked.link = url
            out += linked
            cursor = whole.upperBound
        }
        out += AttributedString(step[cursor...])
        return out
    }
}
