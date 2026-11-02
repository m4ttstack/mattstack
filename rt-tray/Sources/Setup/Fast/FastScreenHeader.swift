import SwiftUI

/// A fast-setup screen's top: the heading and one line under it.
/// `spacing` is the screen body's gap, as the mocks space heading and sub like the content below.
struct FastScreenHeader: View {
    let title: String
    var subtitle: String? = nil
    var spacing: CGFloat = FastTheme.bodyGap
    var alignment: HorizontalAlignment = .leading

    var body: some View {
        VStack(alignment: alignment, spacing: spacing) {
            FastTheme.heading(title).fixedSize(horizontal: false, vertical: true)
            if let subtitle {
                FastTheme.sub(subtitle).fixedSize(horizontal: false, vertical: true)
            }
        }
        .multilineTextAlignment(alignment == .center ? .center : .leading)
        .frame(maxWidth: .infinity, alignment: Alignment(horizontal: alignment, vertical: .top))
    }
}
