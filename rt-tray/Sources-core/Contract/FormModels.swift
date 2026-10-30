import Foundation

/// Unknown values decode as `.todo` so one new state from a newer rt
/// cannot blank a whole screen.
public enum FormRowState: String, Decodable, Sendable {
    case done, todo, busy, waiting

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = FormRowState(rawValue: raw) ?? .todo
    }
}

public enum FormStage: String, Decodable, Sendable {
    case macos, path, invite, waiting, connect, running, paused, ready
    case thisMac = "this-mac"
}

/// One question on a fast-setup screen; rt decides its state and action.
public struct FormRow: Decodable, Equatable, Identifiable, Sendable {
    public var id: String
    public var title: String
    public var subtext: String
    public var state: FormRowState
    public var detail: String
    public var action: RowAction?
    /// The line the app shows while this row's action runs.
    public var waiting: String?
    /// Re-read the form unprompted while this row is waiting or busy: its answer lands outside the app.
    public var watch: Bool
    /// Never holds Continue.
    public var optional: Bool
    public init(id: String, title: String, subtext: String, state: FormRowState, detail: String,
                action: RowAction? = nil, waiting: String? = nil, watch: Bool = false, optional: Bool = false) {
        self.id = id; self.title = title; self.subtext = subtext; self.state = state; self.detail = detail
        self.action = action; self.waiting = waiting; self.watch = watch; self.optional = optional
    }
}

public struct FormTeam: Decodable, Equatable, Sendable {
    public var slug: String
    public var name: String
    public var invitedBy: String?
    public init(slug: String, name: String, invitedBy: String? = nil) {
        self.slug = slug; self.name = name; self.invitedBy = invitedBy
    }
}

/// A section rt left out of the read decodes as nil, never as empty.
public struct FormSections: Decodable, Equatable, Sendable {
    public var macos: [FormRow]?
    public var invite: [FormRow]?
    public var restore: [FormRow]?
    public var create: [FormRow]?
    public var connect: [FormRow]?
    public var thisMac: [FormRow]?
    public init(macos: [FormRow]? = nil, invite: [FormRow]? = nil, restore: [FormRow]? = nil,
                create: [FormRow]? = nil, connect: [FormRow]? = nil, thisMac: [FormRow]? = nil) {
        self.macos = macos; self.invite = invite; self.restore = restore
        self.create = create; self.connect = connect; self.thisMac = thisMac
    }

    /// `section` is the name `rt setup form --section` takes.
    public func rows(for section: String) -> [FormRow]? {
        switch section {
        case "macos": return macos
        case "invite": return invite
        case "restore": return restore
        case "create": return create
        case "connect": return connect
        case "this-mac": return thisMac
        default: return nil
        }
    }

    public var all: [FormRow] {
        [macos, invite, restore, create, connect, thisMac].compactMap { $0 }.flatMap { $0 }
    }
}

public struct FormPaused: Decodable, Equatable, Sendable {
    public var step: String
    public var title: String
    public var detail: String
    public var remedy: String?
    /// The failed step's last lines, so Show log has them after a relaunch.
    public var log: [String]
    /// Drawn beside Retry while macOS holds the background item.
    public var action: RowAction?
    public init(step: String, title: String, detail: String, remedy: String? = nil, log: [String] = [], action: RowAction? = nil) {
        self.step = step; self.title = title; self.detail = detail; self.remedy = remedy; self.log = log; self.action = action
    }
    private enum CodingKeys: String, CodingKey { case step, title, detail, remedy, log, action }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        step = try c.decode(String.self, forKey: .step)
        title = try c.decode(String.self, forKey: .title)
        detail = try c.decode(String.self, forKey: .detail)
        remedy = try c.decodeIfPresent(String.self, forKey: .remedy)
        log = try c.decodeIfPresent([String].self, forKey: .log) ?? []
        action = try c.decodeIfPresent(RowAction.self, forKey: .action)
    }
}

/// What the ready screen opens.
public struct FormHome: Decodable, Equatable, Sendable {
    public var label: String
    public var url: String
    public init(label: String, url: String) { self.label = label; self.url = url }
}

/// `rt setup form --json`. A section read carries only that section, with
/// `stage` and `paused` null; a whole read carries every section but create.
public struct SetupForm: Decodable, Equatable, Sendable {
    /// join | create | solo | restore
    public var path: String?
    public var team: FormTeam?
    /// nil on a section read, and for a stage this app does not know.
    public var stage: FormStage?
    public var sections: FormSections
    public var continueReady: Bool
    public var startReady: Bool
    public var paused: FormPaused?
    public var home: FormHome
    public init(path: String? = nil, team: FormTeam? = nil, stage: FormStage? = nil, sections: FormSections = FormSections(),
                continueReady: Bool = false, startReady: Bool = false, paused: FormPaused? = nil, home: FormHome) {
        self.path = path; self.team = team; self.stage = stage; self.sections = sections
        self.continueReady = continueReady; self.startReady = startReady; self.paused = paused; self.home = home
    }
    private enum CodingKeys: String, CodingKey { case path, team, stage, sections, continueReady, startReady, paused, home }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        path = try c.decodeIfPresent(String.self, forKey: .path)
        team = try c.decodeIfPresent(FormTeam.self, forKey: .team)
        stage = try c.decodeIfPresent(String.self, forKey: .stage).flatMap(FormStage.init(rawValue:))
        sections = try c.decode(FormSections.self, forKey: .sections)
        continueReady = try c.decode(Bool.self, forKey: .continueReady)
        startReady = try c.decode(Bool.self, forKey: .startReady)
        paused = try c.decodeIfPresent(FormPaused.self, forKey: .paused)
        home = try c.decode(FormHome.self, forKey: .home)
    }
}
