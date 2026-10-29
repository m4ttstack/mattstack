import SwiftUI
import MattstackCore

struct JoinScreen: View {
    static let teamRepoRow = "access.team-repo"
    @ObservedObject var model: JoinPageModel
    @ObservedObject var readiness: ReadinessModel
    let permissions: PermissionsService
    let rt: RtRunning
    let needs: NeedBroker

    var body: some View {
        JoinPageBody(
            display: JoinPageDisplay(model: model, teamName: readiness.team?.name ?? readiness.team?.slug,
                                     teamRepoChecked: readiness.row(Self.teamRepoRow) != nil || readiness.loadState != .loading),
            teamRepo: AnyView(ChecklistScreen(model: readiness, permissions: permissions, rt: rt, needs: needs,
                                              presentation: .rows([Self.teamRepoRow]))),
            onJoin: {
                Task {
                    await model.join()
                    // The checklist pages read the cloned team's rows.
                    if model.joinLanded { await readiness.load() }
                }
            },
            onCheckAgain: { Task { await model.check() } })
            .onAppear {
                model.update(teamRepoRow: readiness.row(Self.teamRepoRow))
                model.startPolling()
            }
            .onDisappear { model.stopPolling() }
            .onChange(of: readiness.row(Self.teamRepoRow)) { _, row in model.update(teamRepoRow: row) }
    }
}

/// What the page draws, apart from the model, so the snapshot flag can draw each phase.
struct JoinPageDisplay {
    var phase: JoinPageModel.Phase
    var teamName: String?
    var teamRepoChecked = true
    var logLines: [String] = []
    var needWaiting: String?
    var checkError: String?
    var waitingSince: String?
    var isChecking = false
    var joinLanded = false
    var lastStatus: JoinStatus?
}

@MainActor
extension JoinPageDisplay {
    init(model: JoinPageModel, teamName: String?, teamRepoChecked: Bool) {
        self.init(phase: model.phase, teamName: teamName, teamRepoChecked: teamRepoChecked, logLines: model.logLines,
                  needWaiting: model.needWaiting, checkError: model.checkError, waitingSince: model.waitingSince,
                  isChecking: model.isChecking, joinLanded: model.joinLanded, lastStatus: model.lastStatus)
    }
}

struct JoinPageBody: View {
    let display: JoinPageDisplay
    let teamRepo: AnyView
    let onJoin: () -> Void
    let onCheckAgain: () -> Void

    private enum Mark { case pending(Int), running, done, waiting, unknown }

    private var team: String {
        switch display.phase {
        case .waiting(let s), .unreadable(let s): return s.team.name
        case .approved(let name): return name
        default: return display.teamName ?? "your team"
        }
    }

    private var status: JoinStatus? {
        switch display.phase {
        case .waiting(let s), .unreadable(let s): return s
        case .approved: return display.lastStatus
        default: return nil
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    heading
                    content
                }
                .padding(EdgeInsets(top: 28, leading: 32, bottom: 24, trailing: 32))
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            if display.phase.awaitsApproval {
                Divider()
                checkStrip
            }
        }
        .background(Color.primary.opacity(0.035))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.joinScreen)
    }

    // MARK: heading

    private var heading: some View {
        let (symbol, tint, title, sub) = headingParts
        return HStack(alignment: .top, spacing: 16) {
            Image(systemName: symbol)
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(tint)
                .frame(width: 44, height: 44)
                .background(RoundedRectangle(cornerRadius: 10).fill(tint.opacity(0.12)))
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.title3.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                Text(sub).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var headingParts: (String, Color, String, String) {
        switch display.phase {
        case .needsToken:
            return ("key", .accentColor, "Connect your team's repo",
                    "mattstack copies your team's settings from it, so it needs a token first")
        case .ready:
            return ("person.badge.plus", .accentColor, "Join \(team)",
                    "Joining accepts your invite and copies your team's settings")
        case .joining:
            return ("person.badge.plus", .accentColor, "Joining \(team)…",
                    "Accepting your invite and copying your team's settings")
        case .waiting:
            return ("hourglass", .accentColor, "Waiting for your team admin to approve your request to join the team",
                    "Your team admin gets your request in mattstack. Continue unlocks once they approve.")
        case .unreadable:
            return ("questionmark.circle", .accentColor, "You joined \(team)",
                    "mattstack can't tell yet whether your team admin approved you. The checklist shows what still waits on them.")
        case .approved(let name):
            return ("checkmark", .green, "You're in the \(name) team",
                    "Next, the checklist: everything your team uses, set up in one Install.")
        case .failed:
            return ("xmark", .red, "Couldn't join \(team)", "Try again, or go back to use another invite")
        }
    }

    // MARK: content

    @ViewBuilder private var content: some View {
        switch display.phase {
        case .needsToken:
            if display.teamRepoChecked {
                teamRepo
            } else {
                progressLine("Checking your team repo")
            }
        case .ready:
            steps
            Button(action: onJoin) { Text("Join \(team)").frame(minWidth: 120) }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier(AXID.joinRun)
        case .joining:
            steps
            if let waiting = display.needWaiting {
                Label(waiting, systemImage: "hourglass").font(.callout).foregroundStyle(.secondary)
            }
            if !display.logLines.isEmpty { logBox }
        case .waiting:
            steps
            Label("Taking a while? Ask your team admin to open mattstack", systemImage: "person.wave.2")
                .font(.callout).foregroundStyle(.secondary)
            checkErrorLine
        case .unreadable(let s):
            steps
            warningLine(unreadableReason(s))
            checkErrorLine
        case .approved:
            steps
                .accessibilityIdentifier(AXID.joinApproved)
        case .failed(let detail, let remedy):
            VStack(alignment: .leading, spacing: 6) {
                Text(detail).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                if let remedy { Text(remedy).font(.callout).foregroundStyle(.secondary) }
            }
            if !display.logLines.isEmpty { logBox }
            if display.joinLanded {
                Button("Check again", action: onCheckAgain).disabled(display.isChecking)
                    .accessibilityIdentifier(AXID.joinCheckAgain)
            } else {
                Button("Try again", action: onJoin).accessibilityIdentifier(AXID.joinRun)
            }
        }
    }

    private var steps: some View {
        let (first, second, third) = marks
        return ChecklistCard {
            stepRow(first, "Invite accepted", trailing: status?.team.name)
            Divider()
            stepRow(second, "Team settings copied", trailing: status.map { JoinPageModel.usesText($0.uses) }.flatMap { $0.isEmpty ? nil : $0 })
            Divider()
            thirdRow(third)
        }
    }

    @ViewBuilder private func thirdRow(_ mark: Mark) -> some View {
        switch display.phase {
        case .approved:
            stepRow(mark, "Approved", trailing: nil)
        case .unreadable:
            stepRow(mark, "Approval not known yet", trailing: nil)
        case .waiting:
            stepRow(mark, "Waiting for approval", trailing: display.waitingSince.map { "Asked \($0)" }, emphasis: true)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(AXID.joinWaiting)
        default:
            stepRow(mark, "Approved by your team admin", trailing: nil)
        }
    }

    private var marks: (Mark, Mark, Mark) {
        switch display.phase {
        case .joining: return (.running, .pending(2), .pending(3))
        case .waiting: return (.done, .done, .waiting)
        case .unreadable: return (.done, .done, .unknown)
        case .approved: return (.done, .done, .done)
        default: return (.pending(1), .pending(2), .pending(3))
        }
    }

    private func stepRow(_ mark: Mark, _ label: String, trailing: String?, emphasis: Bool = false) -> some View {
        HStack(spacing: 12) {
            markView(mark).frame(width: 22, height: 22)
            Text(label).fontWeight(emphasis ? .medium : .regular)
            Spacer(minLength: 8)
            if let trailing { Text(trailing).font(.caption).foregroundStyle(.secondary) }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
    }

    @ViewBuilder private func markView(_ mark: Mark) -> some View {
        switch mark {
        case .pending(let n):
            ZStack {
                Circle().fill(Color.primary.opacity(0.08))
                Text("\(n)").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
        case .running:
            ProgressView().controlSize(.small)
        case .done:
            ZStack {
                Circle().fill(Color.green.opacity(0.15))
                Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(.green)
            }
        case .waiting:
            Image(systemName: "hourglass").font(.system(size: 13, weight: .semibold)).foregroundStyle(Color.accentColor)
        case .unknown:
            ZStack {
                Circle().fill(Color.primary.opacity(0.08))
                Image(systemName: "questionmark").font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary)
            }
        }
    }

    private var logBox: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(display.logLines.suffix(6).enumerated()), id: \.offset) { _, line in
                Text(line).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary).lineLimit(1).truncationMode(.tail)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
    }

    private func unreadableReason(_ s: JoinStatus) -> String {
        let base = "mattstack couldn't read who your team has approved"
        guard s.pull.outcome == "failed" || s.pull.outcome == "held", !s.pull.detail.isEmpty else { return base }
        return "\(base). \(s.pull.detail)"
    }

    private func warningLine(_ text: String) -> some View {
        Label {
            Text(text).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
        } icon: {
            Image(systemName: "exclamationmark.triangle.fill").symbolRenderingMode(.multicolor)
        }
    }

    @ViewBuilder private var checkErrorLine: some View {
        if let error = display.checkError { warningLine(error) }
    }

    private func progressLine(_ text: String) -> some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text(text).font(.callout).foregroundStyle(.secondary)
        }
    }

    private var checkStrip: some View {
        HStack(spacing: 6) {
            if display.isChecking { ProgressView().controlSize(.small) }
            Text(display.phase.isUnreadable ? "Check again, or continue" : "Continue unlocks once they approve")
                .font(.caption).foregroundStyle(.secondary)
            Spacer()
            Button("Check again", action: onCheckAgain).controlSize(.small).disabled(display.isChecking)
                .accessibilityIdentifier(AXID.joinCheckAgain)
        }
        .padding(.horizontal, 20).padding(.vertical, 6)
    }
}

private extension JoinPageModel.Phase {
    var isUnreadable: Bool { if case .unreadable = self { return true } else { return false } }

    var awaitsApproval: Bool {
        switch self {
        case .waiting, .unreadable: return true
        default: return false
        }
    }
}
