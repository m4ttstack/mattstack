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

    private static let chooseFileTag = "choose-file"

    init(env: SettingsEnvironment) { self.env = env }

    var body: some View {
        Form {
            Section {
                ForEach(SoundTier.allCases, id: \.self) { tier in row(tier) }
            } header: {
                Text("Sounds")
            } footer: {
                VStack(alignment: .leading, spacing: 4) {
                    if let e = sounds.error { Text(e).foregroundStyle(.red) }
                    Text("Off when macOS notification sounds are off")
                    Text("Sober Ringtones by wize.io, CC BY-SA 4.0")
                }
                .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .task {
            refreshLists()
            await sounds.load(rt: env.rt)
        }
    }

    @ViewBuilder private func row(_ tier: SoundTier) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(tier.title)
                    Text(tier.covers).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button { NotificationManager.preview(id: sounds.picks[tier], tier: tier) } label: {
                    Image(systemName: "play.fill")
                }
                .buttonStyle(.borderless)
                .disabled(sounds.picks[tier] == SoundID.none)
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
        Picker("", selection: binding(tier)) {
            Text("Original").tag(SoundID.original)
            Section("Sober Ringtones") {
                ForEach(SoundID.soberNumbers, id: \.self) { n in Text(SoundID.displayName(SoundID.sober(n))).tag(SoundID.sober(n)) }
            }
            Section("macOS") {
                ForEach(systemIDs, id: \.self) { id in Text(SoundID.displayName(id)).tag(id) }
            }
            if !customIDs.isEmpty {
                Section("My sounds") {
                    ForEach(customIDs, id: \.self) { id in Text(SoundID.displayName(id)).tag(id) }
                }
            }
            Divider()
            Text("None").tag(SoundID.none)
            Text("Choose file…").tag(Self.chooseFileTag)
        }
        .labelsHidden()
        .pickerStyle(.menu)
        .frame(width: 190)
        .disabled(sounds.inFlight)
        .accessibilityIdentifier(AXID.settingsSoundPicker(tier.key))
    }

    private func binding(_ tier: SoundTier) -> Binding<String> {
        Binding(
            get: { sounds.picks[tier] },
            set: { id in
                if id == Self.chooseFileTag {
                    DispatchQueue.main.async { chooseFile(for: tier) }
                    return
                }
                fileErrors[tier] = nil
                Task { await sounds.set(tier, to: id, rt: env.rt) }
            })
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
            Task { await sounds.set(tier, to: SoundID.custom(name), rt: env.rt) }
        } catch {
            TrayLog.error("could not add a custom sound", ["file": source.path, "err": String(describing: error)])
            fileErrors[tier] = "Couldn't add “\(source.lastPathComponent)”. Try again"
        }
    }
}
