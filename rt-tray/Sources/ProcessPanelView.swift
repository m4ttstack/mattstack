import SwiftUI
import AppKit
import MattstackCore
import ServiceManagement

// MARK: - Main View

struct ProcessPanelView: View {
    /// True when hosted in the standalone window, where the pop-out
    /// button would be a no-op pointing at itself.
    var isDetached: Bool = false

    @StateObject private var controller = ProcessPanelController()
    @StateObject private var columnSettings = ColumnSettings()
    @ObservedObject private var trayState = TrayState.shared
    @State private var showColumnPicker = false

    var body: some View {
        VStack(spacing: 0) {
            statusStrip
            if trayState.needsApproval {
                approvalRow
            }
            if !trayState.readyHeldRepos.isEmpty {
                readyHeldRow
            }
            if let notice = trayState.handDeckBlocked {
                handDeckBlockedRow(notice)
            }
            Divider()
            headerBar
            Divider()
            if controller.isLoading || !controller.scannerReady {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if controller.filteredGroups.isEmpty {
                emptyState
            } else {
                processTable
            }
            Divider()
            footerBar
        }
        .frame(minWidth: 600, idealWidth: 900, maxWidth: .infinity,
               minHeight: 400, idealHeight: 600, maxHeight: .infinity)
        .onAppear { controller.startPolling() }
        .onDisappear { controller.stopPolling() }
    }

    // MARK: - Status Strip

    /// Daemon health and status on the left, the process filter on the right.
    private var statusStrip: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(trayState.healthColor)
                .frame(width: 9, height: 9)
            Text(trayState.statusText)
                .font(.system(size: 12))
                .foregroundColor(.secondary)

            Spacer(minLength: 4)
            SearchField(text: $controller.searchText)
                .frame(width: 180)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var approvalRow: some View {
        HStack(spacing: 6) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundColor(.orange)
            Text("The rt daemon needs approval to run at login.")
                .font(.caption)
            Spacer()
            PanelButton(label: "Open Login Items…", icon: nil, action: {
                SMAppService.openSystemSettingsLoginItems()
            })
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.orange.opacity(0.08))
    }

    /// The half of RT-98 that cannot be dismissed. Its notification can be
    /// swiped away; this stays until someone approves, because every worktree
    /// claim in these repos silently skips the team's declared steps meanwhile.
    private var readyHeldRow: some View {
        HStack(spacing: 6) {
            Image(systemName: "hand.raised.fill")
                .font(.caption)
                .foregroundColor(.orange)
            Text(readyHeldSummary)
                .font(.caption)
            Spacer()
            PanelButton(label: "Copy Command", icon: nil, action: copyReadyHeldCommands)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.orange.opacity(0.08))
    }

    private func handDeckBlockedRow(_ notice: HandDeckBlockedNotice) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundColor(.orange)
            Text(notice.summary)
                .font(.caption)
                .help(notice.reason)
            Spacer()
            PanelButton(label: "Copy Command", icon: nil, action: {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(notice.fixCommand, forType: .string)
            })
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.orange.opacity(0.08))
    }

    private var readyHeldSummary: String {
        let names = trayState.readyHeldRepos.map(\.label).joined(separator: ", ")
        return "Team ready steps held for \(names) — worktree claims are skipping them."
    }

    private func copyReadyHeldCommands() {
        let commands = trayState.readyHeldRepos.map(\.approveCommand).joined(separator: "\n")
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(commands, forType: .string)
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack(spacing: 6) {
            // Scrolls so a long repo list can never push the action
            // cluster off the right edge.
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    PanelChip("All", selected: controller.selectedRepo == nil) {
                        controller.selectedRepo = nil
                    }
                    ForEach(controller.repoNames, id: \.self) { repo in
                        PanelChip(repo, selected: controller.selectedRepo == repo) {
                            controller.selectedRepo = repo
                        }
                    }
                }
            }

            Spacer(minLength: 12)

            if !controller.selection.isEmpty {
                PanelButton(
                    label: "Kill \(controller.selection.count)",
                    icon: "xmark.circle",
                    role: .destructive,
                    action: { controller.killSelected() }
                )
                .help("Kill the selected processes")
            }

            Text(processCountText)
                .font(.system(size: 12))
                .foregroundColor(.secondary)

            PanelButton(label: nil, icon: "slider.horizontal.3", action: {
                showColumnPicker.toggle()
            })
            .help("Configure columns")
            .popover(isPresented: $showColumnPicker) {
                columnPickerView
            }

            PanelButton(
                label: nil,
                icon: "arrow.clockwise",
                isLoading: controller.isRefreshing,
                action: { controller.refresh(userInitiated: true) }
            )
            .help("Refresh")

            if !isDetached {
                PanelButton(label: nil, icon: "arrow.up.left.and.arrow.down.right", action: {
                    NotificationCenter.default.post(name: .detachProcessPanel, object: nil)
                })
                .help("Open in window")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var processCountText: String {
        let total = controller.totalProcessCount
        if controller.searchText.isEmpty {
            return total == 1 ? "1 process" : "\(total) processes"
        }
        return "\(controller.filteredProcessCount) of \(total)"
    }

    private var columnPickerView: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Columns")
                .font(.caption.weight(.semibold))
                .padding(.bottom, 2)
            ForEach(ProcessColumn.allCases, id: \.self) { col in
                Toggle(col.rawValue, isOn: Binding(
                    get: { columnSettings.visibleColumns.contains(col) },
                    set: { _ in columnSettings.toggle(col) }
                ))
                .font(.caption)
                .toggleStyle(.checkbox)
                // ColumnSettings.toggle refuses to hide the last column;
                // disable the checkbox so that isn't a silent no-op.
                .disabled(columnSettings.visibleColumns == [col])
            }
        }
        .padding(12)
    }

    // MARK: - Process Table (NSOutlineView)

    private var processTable: some View {
        ProcessOutlineView(
            groups: controller.filteredGroups,
            visibleColumns: columnSettings.visibleColumns,
            killingPids: controller.killingPids,
            herdrPids: controller.herdrRowPids,
            selection: controller.selection,
            dataVersion: controller.dataVersion,
            searchText: controller.searchText,
            controller: controller
        )
    }

    // MARK: - Empty & Footer

    private var emptyState: some View {
        VStack(spacing: 8) {
            if controller.lastRefreshFailed {
                Image(systemName: "exclamationmark.triangle")
                    .font(.title)
                    .foregroundColor(.secondary)
                Text("Can't reach the rt daemon")
                    .font(.caption)
                    .foregroundColor(.secondary)
                PanelButton(label: "Retry", icon: "arrow.clockwise", action: {
                    controller.refresh(userInitiated: true)
                })
            } else {
                Image(systemName: "checkmark.circle")
                    .font(.title)
                    .foregroundColor(.secondary)
                Text("No processes running")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var footerBar: some View {
        HStack {
            Text("Updated \(controller.lastUpdated, style: .relative) ago")
                .font(.caption2)
                .foregroundColor(.secondary)
            Spacer()
            if let status = controller.status {
                Text(status.text)
                    .font(.caption2)
                    .foregroundColor(status.isError ? .red : .secondary)
                    .transition(.opacity)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .animation(.easeInOut(duration: 0.2), value: controller.status)
    }
}

// MARK: - Reusable UI Components

struct PanelChip: View {
    let label: String
    let selected: Bool
    let action: () -> Void

    @State private var isHovering = false

    init(_ label: String, selected: Bool, action: @escaping () -> Void) {
        self.label = label
        self.selected = selected
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 12))
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(chipBackground)
                .cornerRadius(5)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .onHover { isHovering = $0 }
    }

    private var chipBackground: Color {
        if selected {
            return Color.accentColor.opacity(isHovering ? 0.28 : 0.2)
        }
        if isHovering {
            return Color.primary.opacity(0.06)
        }
        return Color.clear
    }
}

/// NSMenuItem that runs a closure — NSMenu wants target/selector pairs.
final class ActionMenuItem: NSMenuItem {
    private let handler: () -> Void

    init(_ title: String, state: NSControl.StateValue = .off, axid: String? = nil,
         keyEquivalent: String = "", keyEquivalentModifierMask: NSEvent.ModifierFlags? = nil,
         handler: @escaping () -> Void) {
        self.handler = handler
        super.init(title: title, action: #selector(invoke), keyEquivalent: keyEquivalent)
        self.target = self
        self.state = state
        if let keyEquivalentModifierMask { self.keyEquivalentModifierMask = keyEquivalentModifierMask }
        if let axid { setAccessibilityIdentifier(axid) }
    }

    required init(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    @objc private func invoke() {
        handler()
    }
}

struct SearchField: NSViewRepresentable {
    @Binding var text: String

    func makeNSView(context: Context) -> KeyableSearchField {
        let field = KeyableSearchField()
        field.placeholderString = "Filter"
        field.controlSize = .small
        field.font = .systemFont(ofSize: 12)
        field.focusRingType = .none
        field.delegate = context.coordinator
        field.sendsSearchStringImmediately = true
        field.sendsWholeSearchString = false
        return field
    }

    func updateNSView(_ nsView: KeyableSearchField, context: Context) {
        if nsView.stringValue != text {
            nsView.stringValue = text
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text)
    }

    class Coordinator: NSObject, NSSearchFieldDelegate {
        let text: Binding<String>

        init(text: Binding<String>) {
            self.text = text
        }

        func controlTextDidChange(_ notification: Notification) {
            guard let field = notification.object as? NSSearchField else { return }
            text.wrappedValue = field.stringValue
        }
    }
}

/// NSSearchField that handles Cmd+A/C/V/X/Z itself so they work in
/// menu-bar panels where the app menu's key equivalents intercept them.
final class KeyableSearchField: NSSearchField {
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard event.modifierFlags.contains(.command),
              let chars = event.charactersIgnoringModifiers else {
            return super.performKeyEquivalent(with: event)
        }
        switch chars {
        case "a": currentEditor()?.selectAll(nil); return true
        case "c": currentEditor()?.copy(nil); return true
        case "v": currentEditor()?.paste(nil); return true
        case "x": currentEditor()?.cut(nil); return true
        case "z":
            if event.modifierFlags.contains(.shift) {
                currentEditor()?.undoManager?.redo()
            } else {
                currentEditor()?.undoManager?.undo()
            }
            return true
        default: return super.performKeyEquivalent(with: event)
        }
    }
}

struct PanelButton: View {
    let label: String?
    let icon: String?
    var role: ButtonRole? = nil
    var isLoading: Bool = false
    let action: () -> Void

    @State private var isHovering = false

    enum ButtonRole {
        case destructive
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 3) {
                // Fixed slot: the spinner and the icon it replaces render
                // at slightly different sizes, which otherwise makes the
                // whole header shuffle on every refresh.
                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .scaleEffect(0.8)
                        .frame(width: 16, height: 16)
                } else if let icon = icon {
                    Image(systemName: icon)
                        .font(.system(size: 13))
                        .frame(width: 16, height: 16)
                }
                if let label = label {
                    Text(label)
                        .font(.system(size: 12))
                }
            }
            .foregroundColor(foregroundColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(isHovering ? hoverBackground : Color.clear)
            .cornerRadius(4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .disabled(isLoading)
        .onHover { isHovering = $0 }
    }

    private var foregroundColor: Color {
        if isLoading { return .secondary }
        if role == .destructive { return .red }
        return isHovering ? .primary : .secondary
    }

    private var hoverBackground: Color {
        if role == .destructive { return Color.red.opacity(0.1) }
        return Color.primary.opacity(0.06)
    }
}
