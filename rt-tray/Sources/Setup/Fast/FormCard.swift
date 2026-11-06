import SwiftUI
import MattstackCore

/// One rounded card of fast-setup rows in one of the mocks' two layouts.
/// A tile card's title sits above it, and a row repeating that title draws
/// only its subtext. A labelled card puts the title in the label column of
/// its run of repo rows (P5b's "Your repos"); with no repo rows, it sits
/// above the card unless a row already carries it as its label.
struct FormCard: View {
    let title: String?
    let rows: [FormRow]
    var waiting: [String: String] = [:]
    var errors: [String: String] = [:]
    var style: FormRowStyle = .labelled
    let onAction: FormRowPerform

    private enum Piece {
        case row(FormRow)
        case repos([FormRow])

        var id: String {
            switch self {
            case .row(let row): return row.id
            case .repos(let rows): return "repos:" + (rows.first?.id ?? "")
            }
        }
    }

    /// Consecutive repo rows share one labelled row, as P5b draws them.
    private var pieces: [Piece] {
        guard style == .labelled else { return rows.map(Piece.row) }
        var out: [Piece] = []
        for row in rows {
            if row.action?.type == .placeRepo {
                if case .repos(let run) = out.last {
                    out[out.count - 1] = .repos(run + [row])
                } else {
                    out.append(.repos([row]))
                }
            } else {
                out.append(.row(row))
            }
        }
        return out
    }

    private var titleAbove: String? {
        guard let title else { return nil }
        if style == .tile { return title }
        let labelled = pieces.contains { if case .repos = $0 { return true } else { return false } } || rows.contains { $0.title == title }
        return labelled ? nil : title
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let titleAbove { Text(titleAbove).font(FastTheme.cardTitle).foregroundColor(FastTheme.textSecondary) }
            FastCard {
                ForEach(Array(pieces.enumerated()), id: \.element.id) { index, piece in
                    // A row and the divider above it come and go together: they fade in from just above and fade out.
                    VStack(spacing: 0) {
                        if index > 0 { FastRowDivider() }
                        pieceView(piece)
                    }
                    .transition(.asymmetric(insertion: .opacity.combined(with: .offset(y: -6)), removal: .opacity))
                }
            }
            .animation(.spring(response: 0.4, dampingFraction: 0.9), value: pieces.map(\.id))
        }
    }

    @ViewBuilder private func pieceView(_ piece: Piece) -> some View {
        switch piece {
        case .row(let row):
            FormRowView(row: row, waiting: waiting[row.id], error: errors[row.id], style: style,
                        showsTitle: style == .labelled || row.title != title, onAction: onAction)
        case .repos(let run):
            FastLabelledRow(label: title) {
                // P5b's CSS gap is 14, but SF's 11-point note line is 2 taller than Inter's, so the blocks pitch as the mock's at 12.
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(run, id: \.id) { row in
                        FormRowView(row: row, waiting: waiting[row.id], error: errors[row.id], style: style,
                                    bare: true, onAction: onAction)
                            .transition(.opacity.combined(with: .offset(y: -6)))
                    }
                }
                .animation(.spring(response: 0.4, dampingFraction: 0.9), value: run.map(\.id))
            }
        }
    }
}
