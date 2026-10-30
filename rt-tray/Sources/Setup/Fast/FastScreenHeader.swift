import SwiftUI

/// A fast-setup screen's top: an optional quiet uppercase label, the title, and one line under it.
struct FastScreenHeader: View {
    let label: String?
    let title: String
    let subtitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let label {
                Text(label.uppercased()).font(.caption.weight(.semibold)).tracking(0.8).foregroundStyle(.secondary)
            }
            Text(title).font(.title2.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
            if let subtitle {
                Text(subtitle).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
