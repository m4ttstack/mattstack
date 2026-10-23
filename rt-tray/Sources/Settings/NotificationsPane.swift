import AppKit
import SwiftUI
import UniformTypeIdentifiers
import MattstackCore

/// One sound per notification tier, each with a play button. A picked file
/// is copied into the custom sounds folder so moving the original breaks nothing.
struct NotificationsPane: View {
    let env: SettingsEnvironment
    @ObservedObject private var sounds = NotificationManager.sounds
    @State private var systemIDs: [String] = []
    @State private var customIDs: [String] = []
    @State private var fileErrors: [SoundTier: String] = [:]

    init(env: SettingsEnvironment) { self.env = env }

    var body: some View {
        NotificationsPaneForm(
            picks: sounds.picks, systemIDs: systemIDs, customIDs: customIDs,
            fileErrors: fileErrors, error: sounds.error, busy: sounds.inFlight,
            onPick: { tier, id in
                fileErrors[tier] = nil
                NotificationManager.preview(id: id, tier: tier)
                Task { await sounds.set(tier, to: id, rt: env.rt) }
            },
            onChooseFile: { tier in DispatchQueue.main.async { chooseFile(for: tier) } },
            onPreview: { tier in NotificationManager.preview(id: sounds.picks[tier], tier: tier) })
        .task {
            refreshLists()
            await sounds.load(rt: env.rt)
        }
    }

    private func refreshLists() {
        let loc = NotificationManager.soundLocations
        systemIDs = SoundCatalog.systemSoundIDs(in: loc.systemSounds)
        customIDs = SoundCatalog.customSoundIDs(in: loc.customSounds)
    }

    private func chooseFile(for tier: SoundTier) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.audio]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.prompt = "Use Sound"
        guard panel.runModal() == .OK, let source = panel.url else { return }

        guard NSSound(contentsOf: source, byReference: true) != nil else {
            fileErrors[tier] = "Can't play “\(source.lastPathComponent)”. Choose another file"
            return
        }
        let dir = NotificationManager.soundLocations.customSounds
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let taken = Set((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? [])
            let name = SoundCatalog.uniqueFileName(source.lastPathComponent, taken: taken)
            try FileManager.default.copyItem(at: source, to: dir.appendingPathComponent(name))
            fileErrors[tier] = nil
            refreshLists()
            NotificationManager.preview(id: SoundID.custom(name), tier: tier)
            Task { await sounds.set(tier, to: SoundID.custom(name), rt: env.rt) }
        } catch {
            TrayLog.error("could not add a custom sound", ["file": source.path, "err": String(describing: error)])
            fileErrors[tier] = "Couldn't add “\(source.lastPathComponent)”. Try again"
        }
    }
}

struct NotificationsPaneForm: View {
    let picks: SoundPicks
    let systemIDs: [String]
    let customIDs: [String]
    let fileErrors: [SoundTier: String]
    let error: String?
    let busy: Bool
    let onPick: (SoundTier, String) -> Void
    let onChooseFile: (SoundTier) -> Void
    let onPreview: (SoundTier) -> Void

    private static let chooseFileTag = "choose-file"

    var body: some View {
        Form {
            Section {
                ForEach(SoundTier.allCases, id: \.self) { tier in row(tier) }
            } header: {
                Text("Sounds")
            } footer: {
                VStack(alignment: .leading, spacing: 4) {
                    if let error { Text(error).foregroundStyle(.red) }
                    Text("Off when macOS notification sounds are off")
                    Text("Sober Ringtones by wize.io, CC BY-SA 4.0")
                }
                .font(.caption).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .formStyle(.grouped)
    }

    @ViewBuilder private func row(_ tier: SoundTier) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(tier.title)
                    Text(tier.covers).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button { onPreview(tier) } label: {
                    Image(systemName: "play.fill")
                        .font(.system(size: 9))
                        .foregroundStyle(.primary)
                        .frame(width: 24, height: 24)
                        .background(Circle().fill(Color(nsColor: .controlBackgroundColor)))
                        .overlay(Circle().strokeBorder(Color(nsColor: .tertiaryLabelColor)))
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .disabled(picks[tier] == SoundID.none)
                .help("Play this sound")
                .accessibilityLabel("Play \(tier.title) sound")
                .accessibilityIdentifier(AXID.settingsSoundPreview(tier.key))
                picker(tier)
            }
            if let e = fileErrors[tier] {
                Text(e).font(.caption).foregroundStyle(.red)
                    .accessibilityIdentifier(AXID.settingsSoundError(tier.key))
            }
        }
    }

    private func picker(_ tier: SoundTier) -> some View {
        var entries: [SoundPopUp.Entry] = [.item(SoundID.original)]
        entries += [.separator, .header("Sober Ringtones")] + SoundID.soberNumbers.map { .item(SoundID.sober($0)) }
        entries += [.separator, .header("macOS")] + systemIDs.map { .item($0) }
        if !customIDs.isEmpty { entries += [.separator, .header("My sounds")] + customIDs.map { .item($0) } }
        entries += [.separator, .item(SoundID.none), .action(Self.chooseFileTag, "Choose file…")]
        return SoundPopUp(entries: entries, selection: picks[tier], accessibilityLabel: "\(tier.title) sound") { id in
            id == Self.chooseFileTag ? onChooseFile(tier) : onPick(tier, id)
        }
        .frame(width: 190)
        .disabled(busy)
        .accessibilityIdentifier(AXID.settingsSoundPicker(tier.key))
    }
}

/// The boxed AppKit popup button: SwiftUI's Picker draws as plain text
/// inside a grouped Form, which reads as a label rather than a control.
struct SoundPopUp: NSViewRepresentable {
    enum Entry: Equatable {
        case item(String)
        case action(String, String)
        case header(String)
        case separator
    }

    let entries: [Entry]
    let selection: String
    let accessibilityLabel: String
    let onSelect: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> NSPopUpButton {
        let button = NSPopUpButton(frame: .zero, pullsDown: false)
        button.bezelStyle = .push
        button.isBordered = true
        button.target = context.coordinator
        button.action = #selector(Coordinator.picked(_:))
        button.setAccessibilityLabel(accessibilityLabel)
        return button
    }

    func updateNSView(_ button: NSPopUpButton, context: Context) {
        context.coordinator.onSelect = onSelect
        if context.coordinator.entries != entries {
            context.coordinator.entries = entries
            let menu = NSMenu()
            for entry in entries {
                switch entry {
                case .item(let id):
                    let item = NSMenuItem(title: SoundID.displayName(id), action: nil, keyEquivalent: "")
                    item.representedObject = id
                    menu.addItem(item)
                case .action(let id, let title):
                    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
                    item.representedObject = id
                    menu.addItem(item)
                case .header(let title):
                    menu.addItem(NSMenuItem.sectionHeader(title: title))
                case .separator:
                    menu.addItem(.separator())
                }
            }
            button.menu = menu
        }
        if let item = button.itemArray.first(where: { $0.representedObject as? String == selection }) {
            button.select(item)
        }
    }

    final class Coordinator: NSObject {
        var entries: [Entry] = []
        var onSelect: (String) -> Void = { _ in }
        @objc func picked(_ sender: NSPopUpButton) {
            guard let id = sender.selectedItem?.representedObject as? String else { return }
            onSelect(id)
        }
    }
}

/// `rt-tray --render-notifications-pane-snapshots <out-dir>` renders the pane
/// resting and with a refused file, light and dark. DEBUG builds only.
enum NotificationsPaneSnapshot {
    @MainActor
    static func runIfRequested() -> Bool {
        #if DEBUG
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: "--render-notifications-pane-snapshots") else { return false }
        guard args.count > i + 1 else {
            FileHandle.standardError.write(Data("usage: --render-notifications-pane-snapshots <out-dir>\n".utf8))
            exit(64)
        }
        let out = URL(fileURLWithPath: args[i + 1])
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        _ = NSApplication.shared
        let picks = SoundPicks(neutral: SoundID.original, positive: SoundID.sober("102"), warning: SoundID.macos("Glass"))
        let system = SoundCatalog.systemSoundIDs(in: SoundLocations.systemSoundsDir)
        let states: [(String, [SoundTier: String])] = [("resting", [:]), ("refused", [.warning: "Can't play “voice-memo.amr”. Choose another file"])]
        var count = 0
        for (name, errors) in states {
            for scheme in ["light", "dark"] {
                let view = NotificationsPaneForm(picks: picks, systemIDs: system, customIDs: [SoundID.custom("Doorbell.m4a")],
                                                 fileErrors: errors, error: nil, busy: false,
                                                 onPick: { _, _ in }, onChooseFile: { _ in }, onPreview: { _ in })
                    .frame(width: 680)
                SnapshotRenderer.render(view, appearance: scheme == "dark" ? .darkAqua : .aqua,
                                        to: out.appendingPathComponent("notifications-pane-\(name)-\(scheme).png"))
                count += 1
            }
        }
        print("wrote \(count) snapshots to \(out.path)")
        return true
        #else
        return false
        #endif
    }
}
