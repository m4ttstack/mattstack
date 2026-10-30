import SwiftUI
import MattstackCore

/// One rounded card of fast-setup rows, with an optional title above it. A row
/// that repeats the card's title draws only its subtext, so the title reads once.
struct FormCard: View {
    let title: String?
    let rows: [FormRow]
    var waiting: [String: String] = [:]
    var errors: [String: String] = [:]
    let onAction: FormRowPerform

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title { Text(title).font(.headline) }
            ChecklistCard {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    if index > 0 { Divider().padding(.leading, 14) }
                    FormRowView(row: row, waiting: waiting[row.id], error: errors[row.id], showsTitle: row.title != title, onAction: onAction)
                }
            }
        }
    }
}
