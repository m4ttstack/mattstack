# Lane 4: flock

> **Shepherd ruling (addition):** herdr-chat now emits `peek.rooms[].label` and `targets.labels` (a map from target string to display text; DM rooms read `kai ↔ remy`). Add `ChatPeekRoom.label: String?` and `ChatTargets.labels: [String: String]?` in Task 1 with decode tests (present and absent), and in Task 3 show the label on Peek room rows, popover room chips and quick-send chips when present, else the raw target. Actions keep sending the raw target.

Part of the chat identity plan. Master plan, global constraints and the frozen
contract: `docs/superpowers/plans/2026-09-27-chat-identity.md` (repo-tools).
Spec: `docs/superpowers/specs/2026-09-27-chat-identity-design.md`.

## Before you start

- **Work straight on `main` in the main checkout, `/Users/matt/Documents/GitHub/flock`.
  No worktree, no branch.** That is Matt's standing rule for flock. Finished
  work ships to Matt through `Scripts/dev-build.sh`, never a release.
- Run this lane from a session whose cwd is the flock checkout (use `/cd
  /Users/matt/Documents/GitHub/flock`). An rt-worktree session's Bash guard
  refuses git commands aimed at another repo.
- Read `/Users/matt/Documents/GitHub/flock/CLAUDE.md` first. It is a public
  repo: no ticket ids (no `RT-...`), no employer names, fixtures use `acme`.
  `Scripts/checks.sh` fails on em or en dashes and on the purity word list.
- Every `xcodebuild` uses the scratch derived data path
  `build/lane4-derived` (gitignored). If `Flock.xcodeproj` is missing, run
  `xcodegen` once. This lane adds no files, so no other `xcodegen` run is
  needed.
- Tests stay hermetic: no test spawns herdr-chat, rt or herdr.
- Never quit, kill or launch Flock or Flock Dev yourself. Never open a GUI app
  without asking.

## What this lane builds

The frozen contract for flock: `ChatStatus.name`, `ChatBuddy.name` and
`ChatJump.name`, all `String?`. Display is `name ?? handle`. Act on `handle`.

One display rule, in one place (`ChatDisplayName.text` in `ChatShapes.swift`,
exposed as `displayName` on `ChatStatus` and `ChatBuddy`): the name when
herdr-chat sent a non-empty one, else the handle, and never with a leading
`@`. Every display site uses it: the pane legend (`PaneCellView`) and its
accessibility label, the popover status line, Peek rows, Broadcast rows and
the Quick send footer ("sent as kay"). `ChatButtonModel`'s private `@` strip
is deleted and folds into the helper. Quick send chips are target strings
from `targets`, not identity text, and keep their `#`/`@` prefix. Jump and
quick-send keep acting on `handle` and the raw target string.

**Fixture rule, applied everywhere:** a `handle` in a `status`, `peek` buddy or
`jump` fixture is a bare id (`kay`, or `kay.k3f9` for a minted identity) and
never carries `@`. Only `targets.people`, quick-send `--to` and `ChatSent.to`
carry `@`. One unit test keeps the `@`-tolerance case explicit.

## File map

| File | Change |
|---|---|
| `Sources/FlockCore/Chat/ChatShapes.swift` | `name` on three shapes, `displayName`, `ChatDisplayName` |
| `Sources/FlockCore/Chat/ChatButtonModel.swift` | `.signedIn(name:unread:)`, uses `displayName`, strip deleted |
| `Sources/Flock/Views/PaneCellView.swift` | legend and accessibility label read the name |
| `Sources/Flock/Chat/ChatPopover.swift` | status line reads `displayName` |
| `Sources/Flock/Chat/ChatPeekView.swift` | row text reads `displayName`; jump keeps `handle` |
| `Sources/Flock/Chat/ChatBroadcastView.swift` | row text reads `displayName` |
| `Sources/Flock/Chat/ChatQuickSendView.swift` | footer reads `displayName` |
| `Tests/FlockCoreTests/ChatShapesTests.swift` | decode tests, name absent / null / present, the `@` rule |
| `Tests/FlockCoreTests/ChatButtonModelTests.swift` | `name:` label, id plus name, fixture rule |
| `Tests/FlockChromeRender/ChromeRenderTests.swift` | fixtures drop `@`; the legend fixture is a minted identity |
| `Tests/FlockChromeRender/ChatStoreTests.swift` | status fixtures drop `@matt` for `kay` |
| `Tests/FlockChromeRender/ChatDegradationRenderTests.swift` | status fixture drops `@` |
| `Tests/FlockChromeRender/ChatFeatureViewsRenderTests.swift` | kay is minted in the peek fixtures; pixel-equality tests; both-scheme render |
| `docs/superpowers/specs/2026-09-18-flock-chat-design.md` | verb table gains `name`; the id/name paragraph; display wording |
| `docs/superpowers/plans/2026-09-18-flock-chat.md` | contract table gains `name` |
| `docs/design/chat/measurements.md` | "name", not "handle", on every drawn identity |

---

### Task 1: Decode `name` and add the one display rule

**Files:**
- Modify: `Sources/FlockCore/Chat/ChatShapes.swift:3-33` and `:75-85`
- Test: `Tests/FlockCoreTests/ChatShapesTests.swift`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ChatStatus.name: String?` (a defaulted `var`, so every existing
    `ChatStatus(handle:state:pane:signedIn:rooms:)` call still compiles and a
    test can write `ChatStatus(handle: "kay.k3f9", name: "kay", state: ..., pane: ..., signedIn: ..., rooms: ...)`)
  - `ChatStatus.displayName: String?` (nil exactly when `handle` is nil)
  - `ChatBuddy.name: String?`, `ChatBuddy.displayName: String`
  - `ChatJump.name: String?`
  - `ChatPeekRoom.label: String?` and `ChatTargets.labels: [String: String]?` (defaulted `var`s, so existing memberwise calls still compile; shepherd ruling)
  - `enum ChatDisplayName { static func text(name: String?, handle: String) -> String }` (internal to FlockCore)

- [ ] **Step 1: Write the failing tests**

Append to `Tests/FlockCoreTests/ChatShapesTests.swift`, inside `ChatShapesTests`, after the existing two tests:

```swift
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    /// An older herdr-chat prints no `name` key at all. That must decode, and
    /// the handle (a legacy identity's own name) is what gets drawn.
    func testABuddyWithNoNameKeyDrawsItsHandle() throws {
        let buddy = try decode(
            ChatBuddy.self,
            #"{"handle":"kay","paneId":"w1:p1","status":"idle","repo":null,"branch":null,"title":null,"unread":0,"mentions":0}"#
        )
        XCTAssertNil(buddy.name)
        XCTAssertEqual(buddy.displayName, "kay")
    }

    func testABuddyWithANameDrawsTheNameAndKeepsTheIdAsItsHandle() throws {
        let buddy = try decode(
            ChatBuddy.self,
            #"{"handle":"kay.k3f9","name":"kay","paneId":"w1:p1","status":"idle","repo":null,"branch":null,"title":null,"unread":0,"mentions":0}"#
        )
        XCTAssertEqual(buddy.handle, "kay.k3f9")
        XCTAssertEqual(buddy.name, "kay")
        XCTAssertEqual(buddy.displayName, "kay")
    }

    func testAStatusDecodesItsNameAbsentNullOrPresent() throws {
        let absent = try decode(ChatStatus.self, #"{"handle":"kay","state":"live","pane":"w1:p1","signedIn":true,"rooms":[]}"#)
        XCTAssertNil(absent.name)
        XCTAssertEqual(absent.displayName, "kay")

        let explicitNull = try decode(
            ChatStatus.self, #"{"handle":"kay","name":null,"state":"live","pane":"w1:p1","signedIn":true,"rooms":[]}"#
        )
        XCTAssertNil(explicitNull.name)
        XCTAssertEqual(explicitNull.displayName, "kay")

        let present = try decode(
            ChatStatus.self, #"{"handle":"kay.k3f9","name":"kay","state":"live","pane":"w1:p1","signedIn":true,"rooms":[]}"#
        )
        XCTAssertEqual(present.handle, "kay.k3f9")
        XCTAssertEqual(present.displayName, "kay")
    }

    func testASignedOutStatusHasNoDisplayName() throws {
        let status = try decode(
            ChatStatus.self, #"{"handle":null,"name":null,"state":"not signed in","pane":null,"signedIn":false,"rooms":[]}"#
        )
        XCTAssertNil(status.displayName)
    }

    func testAJumpDecodesItsNameAbsentOrPresent() throws {
        let absent = try decode(ChatJump.self, #"{"paneId":"w1:p3","workspace":"acme","handle":"kay"}"#)
        XCTAssertNil(absent.name)
        XCTAssertEqual(absent.handle, "kay")

        let present = try decode(ChatJump.self, #"{"paneId":"w1:p3","workspace":"acme","handle":"kay.k3f9","name":"kay"}"#)
        XCTAssertEqual(present.handle, "kay.k3f9")
        XCTAssertEqual(present.name, "kay")
    }

    /// The one `@` rule: identity text never carries one, whichever field it
    /// came from, and an empty name is no name.
    func testDisplayTextDropsALeadingAtSignAndIgnoresAnEmptyName() {
        XCTAssertEqual(ChatDisplayName.text(name: nil, handle: "@kay"), "kay")
        XCTAssertEqual(ChatDisplayName.text(name: "@kay", handle: "kay.k3f9"), "kay")
        XCTAssertEqual(ChatDisplayName.text(name: "", handle: "kay"), "kay")
        XCTAssertEqual(ChatDisplayName.text(name: "remy-2", handle: "remy.k3f9"), "remy-2")
    }

    /// herdr-chat labels a DM room by its participants; an older herdr-chat
    /// sends no label, and the raw room is drawn.
    func testAPeekRoomDecodesItsLabelAbsentOrPresent() throws {
        let absent = try decode(ChatPeekRoom.self, #"{"room":"rt","unread":0,"mentions":0}"#)
        XCTAssertNil(absent.label)
        let present = try decode(ChatPeekRoom.self, #"{"room":"dm-3f9a","label":"kai ↔ remy","unread":2,"mentions":0}"#)
        XCTAssertEqual(present.room, "dm-3f9a")
        XCTAssertEqual(present.label, "kai ↔ remy")
    }

    func testTargetsDecodeTheirLabelsAbsentOrPresent() throws {
        let absent = try decode(ChatTargets.self, #"{"rooms":["#rt"],"people":["@kay"]}"#)
        XCTAssertNil(absent.labels)
        let present = try decode(
            ChatTargets.self,
            #"{"rooms":["#rt","#dm-3f9a"],"people":["@kay"],"labels":{"#rt":"#rt","#dm-3f9a":"kai ↔ remy","@kay":"@kay"}}"#
        )
        XCTAssertEqual(present.rooms, ["#rt", "#dm-3f9a"])
        XCTAssertEqual(present.labels?["#dm-3f9a"], "kai ↔ remy")
    }
```

Also change the existing `testABuddyReadsThePaneIdItWasPrintedUnder` fixture only if it carries `@` (it does not: `"handle":"kay"` stays).

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `/Users/matt/Documents/GitHub/flock`):

```bash
xcodebuild test -scheme Flock -destination 'platform=macOS' -only-testing:FlockCoreTests/ChatShapesTests -skipPackagePluginValidation -derivedDataPath build/lane4-derived 2>&1 | tail -25
```

Expected: `** TEST FAILED **`; the test build fails with `value of type 'ChatBuddy' has no member 'name'` and `cannot find 'ChatDisplayName' in scope`.

- [ ] **Step 3: Implement**

In `Sources/FlockCore/Chat/ChatShapes.swift`, replace the `ChatStatus` and `ChatBuddy` declarations (lines 3-33) with:

```swift
/// What `status` prints: whether this pane is signed in, and to what.
public struct ChatStatus: Decodable, Equatable, Sendable {
    public let handle: String?
    public var name: String? = nil
    public let state: String
    public let pane: String?
    public let signedIn: Bool
    public let rooms: [String]

    public var displayName: String? {
        handle.map { ChatDisplayName.text(name: name, handle: $0) }
    }
}

/// What `peek` prints: everyone visible, and every room's unread count.
public struct ChatPeek: Decodable, Equatable, Sendable {
    public let buddies: [ChatBuddy]
    public let rooms: [ChatPeekRoom]
}

/// One buddy on the list.
public struct ChatBuddy: Decodable, Equatable, Sendable {
    public let handle: String
    public let name: String?
    public let paneID: String
    public let status: String
    public let repo: String?
    public let branch: String?
    public let title: String?
    public let unread: Int
    public let mentions: Int

    public var displayName: String { ChatDisplayName.text(name: name, handle: handle) }

    private enum CodingKeys: String, CodingKey {
        case handle, name, status, repo, branch, title, unread, mentions
        case paneID = "paneId"
    }
}
```

Replace the `ChatPeekRoom` and `ChatTargets` declarations with:

```swift
/// One room row in `peek`. `room` is what the viewer link keys on; `label`
/// is what to draw (a DM room's participant names), absent from an older
/// herdr-chat.
public struct ChatPeekRoom: Decodable, Equatable, Sendable {
    public let room: String
    public var label: String? = nil
    public let unread: Int
    public let mentions: Int
}

/// What `targets` prints: every room and person a send could name, and
/// what to draw for each (absent from an older herdr-chat).
public struct ChatTargets: Decodable, Equatable, Sendable {
    public let rooms: [String]
    public let people: [String]
    public var labels: [String: String]? = nil
}
```

Replace the `ChatJump` declaration (lines 75-85) with:

```swift
/// What `jump` prints: where to focus to reach the named handle.
public struct ChatJump: Decodable, Equatable, Sendable {
    public let paneID: String
    public let workspace: String
    public let handle: String
    public let name: String?

    private enum CodingKeys: String, CodingKey {
        case workspace, handle, name
        case paneID = "paneId"
    }
}
```

Append at the end of the file:

```swift
/// The one rule for drawing a chat identity. `handle` is an id that only
/// acts (jump, send); it is drawn only for a legacy identity, whose id is
/// its name. Identity text never carries an `@`: that prefix belongs to
/// quick-send targets, which are not drawn through here.
enum ChatDisplayName {
    static func text(name: String?, handle: String) -> String {
        let text = name.flatMap { $0.isEmpty ? nil : $0 } ?? handle
        return text.hasPrefix("@") ? String(text.dropFirst()) : text
    }
}
```

Synthesized `Decodable` reads an optional with `decodeIfPresent`, so a missing `name` key decodes as nil; that is what the "absent" tests pin.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
xcodebuild test -scheme Flock -destination 'platform=macOS' -only-testing:FlockCoreTests/ChatShapesTests -only-testing:FlockCoreTests/ChatOutcomeTests -skipPackagePluginValidation -derivedDataPath build/lane4-derived 2>&1 | tail -25
```

Expected: `** TEST SUCCEEDED **`, 10 ChatShapesTests and 5 ChatOutcomeTests passing.

- [ ] **Step 5: Commit**

```bash
git add Sources/FlockCore/Chat/ChatShapes.swift Tests/FlockCoreTests/ChatShapesTests.swift
Scripts/checks.sh
git commit -m "Decode chat display names beside handles" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected from `checks.sh`: `all checks ok`.

---

### Task 2: The pane legend draws the name, and fixtures follow one `@` rule

**Files:**
- Modify: `Sources/FlockCore/Chat/ChatButtonModel.swift` (whole file)
- Modify: `Sources/Flock/Views/PaneCellView.swift:483-516`
- Test: `Tests/FlockCoreTests/ChatButtonModelTests.swift`
- Test: `Tests/FlockChromeRender/ChromeRenderTests.swift:92-95, 186, 407, 444`
- Test: `Tests/FlockChromeRender/ChatStoreTests.swift:83, 86`
- Test: `Tests/FlockChromeRender/ChatDegradationRenderTests.swift:191`

**Interfaces:**
- Consumes: `ChatStatus.displayName`, `ChatStatus(handle:name:state:pane:signedIn:rooms:)` from Task 1.
- Produces: `ChatButtonModel.Appearance.signedIn(name: String, unread: Int)` (the label changes from `handle:` to `name:`; `PaneCellView` is the only production reader).

- [ ] **Step 1: Write the failing tests**

In `Tests/FlockCoreTests/ChatButtonModelTests.swift`, replace the `status` helper (lines 6-11) with:

```swift
    private func status(signedIn: Bool, handle: String? = "kay", name: String? = nil) -> ChatStatus {
        ChatStatus(
            handle: signedIn ? handle : nil, name: signedIn ? name : nil, state: signedIn ? "live" : "not signed in",
            pane: "w1:p1", signedIn: signedIn, rooms: signedIn ? ["#rt"] : []
        )
    }
```

Replace `testSignedInStatusCarriesTheHandleAndUnreadCount` and `testSignedInHandleDropsTheLeadingAtSignRtPrints` (lines 44-59, with the doc comment above the second) with:

```swift
    func testSignedInStatusCarriesTheNameAndUnreadCount() {
        XCTAssertEqual(
            ChatButtonModel.appearance(
                agent: "claude", availability: true, status: status(signedIn: true, handle: "kay.k3f9", name: "kay"), unread: 3
            ),
            .signedIn(name: "kay", unread: 3)
        )
    }

    /// A legacy identity has no name row: its id is its name, so the handle
    /// is what the legend draws.
    func testALegacyStatusWithNoNameDrawsItsHandle() {
        XCTAssertEqual(
            ChatButtonModel.appearance(agent: "claude", availability: true, status: status(signedIn: true, handle: "kay"), unread: 0),
            .signedIn(name: "kay", unread: 0)
        )
    }

    /// The legend never shows an `@`, even from a herdr-chat that prints one.
    func testAnAtPrefixedHandleIsDrawnWithoutIt() {
        XCTAssertEqual(
            ChatButtonModel.appearance(agent: "claude", availability: true, status: status(signedIn: true, handle: "@kay"), unread: 0),
            .signedIn(name: "kay", unread: 0)
        )
    }
```

In `Tests/FlockChromeRender/ChromeRenderTests.swift`:

Lines 92-95 become (the legend fixture is now a minted identity; the width assertions below it still measure `"kay"`, so they fail if the id is drawn):

```swift
        // A minted identity: the button draws the name, never the id, so it
        // measures as "kay" below. "kay.k3f9" would be several glyphs wider.
        let signedInJSON = #"""
        {"handle":"kay.k3f9","name":"kay","state":"live","pane":"w1:p2","signedIn":true,"rooms":["#general"]}
        """#
```

Line 186 becomes:

```swift
            let json = ##"{"handle":"\##(handle)","state":"live","pane":"w1:p2","signedIn":true,"rooms":["#general"]}"##
```

Lines 407 and 444 each become:

```swift
        {"handle":"kay","state":"live","pane":"w1:p2","signedIn":true,"rooms":["#general"]}
```

In `Tests/FlockChromeRender/ChatStoreTests.swift`, lines 83 and 86 become:

```swift
    {"handle":"kay","state":"active","pane":"w1:p1","signedIn":true,"rooms":["#general"]}
```

```swift
    {"handle":"kay","state":"inactive","pane":"w1:p1","signedIn":false,"rooms":[]}
```

The `quickSend(to: "@matt", ...)` and `{"to":"@matt"}` lines in the same file stay: those are targets, which keep their prefix.

In `Tests/FlockChromeRender/ChatDegradationRenderTests.swift`, line 191 becomes:

```swift
                return (Data(#"{"handle":"kay","state":"live","pane":"w1:p2","signedIn":true,"rooms":[]}"#.utf8), 0)
```

Confirm no identity fixture still carries `@`:

```bash
grep -rn '"handle":"@' Tests
```

Expected: no output.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
xcodebuild test -scheme Flock -destination 'platform=macOS' -only-testing:FlockCoreTests/ChatButtonModelTests -skipPackagePluginValidation -derivedDataPath build/lane4-derived 2>&1 | tail -25
```

Expected: `** TEST FAILED **`; the build fails with `enum case 'signedIn' has no associated value labelled 'name'` (or `incorrect argument label in call (have 'name:unread:', expected 'handle:unread:')`).

- [ ] **Step 3: Implement**

Replace `Sources/FlockCore/Chat/ChatButtonModel.swift` with:

```swift
import Foundation

/// What a pane's chat button draws: the trigger and the pane's chat state in
/// one control. `unread` is a plain parameter rather than something read off
/// `status`, since the count and the sign-in status arrive from different
/// sources.
public enum ChatButtonModel {
    public enum Appearance: Equatable {
        case absent
        case signedOut
        case signedIn(name: String, unread: Int)
    }

    /// herdr's name for Claude Code in a pane's `agent`.
    public static let claudeAgent = "claude"

    /// Chat unavailable on this machine, or a pane not running Claude Code,
    /// draws no button at all. Available but with no status yet (the probe has
    /// not answered for this pane) reads as signed out, never as absent -- the
    /// two are states a caller must never collapse into one another.
    public static func appearance(agent: String?, availability: Bool, status: ChatStatus?, unread: Int) -> Appearance {
        guard availability, agent == claudeAgent else { return .absent }
        guard let status, status.signedIn, let name = status.displayName else { return .signedOut }
        return .signedIn(name: name, unread: unread)
    }
}
```

(The `--` in the kept doc comment is the file's existing text: two hyphens, not a dash character, so `checks.sh` accepts it.)

In `Sources/Flock/Views/PaneCellView.swift`, replace lines 483-495 (the `case let .signedIn` line through the handle `Text`'s modifiers) with:

```swift
        case let .signedIn(name, unread):
            Button(action: { openChatPopover() }) {
                HStack(spacing: ChromeMetrics.ChatButton.gap) {
                    // `fixedSize` as well as no width: a name is never
                    // shortened, so it has to refuse to compress even when
                    // the legend row runs out of room. What gives instead is
                    // the pane title, which truncates.
                    Text(name)
                        .font(ChromeType.chatButtonHandle)
                        .foregroundStyle(theme.green)
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                        .frame(height: ChromeMetrics.ChatButton.handleHeight, alignment: .leading)
```

and line 516 with:

```swift
            .accessibilityLabel(unread > 0 ? "Chat: \(name), \(unread) unread" : "Chat: \(name)")
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
xcodebuild test -scheme Flock -destination 'platform=macOS' -only-testing:FlockCoreTests/ChatButtonModelTests -only-testing:FlockCoreTests/ChatPresenceTests -skipPackagePluginValidation -derivedDataPath build/lane4-derived 2>&1 | tail -25
```

Expected: `** TEST SUCCEEDED **`.

```bash
xcodebuild test -scheme FlockChromeRender -destination 'platform=macOS' -only-testing:FlockChromeRender/ChromeRenderTests/testChatButtonRendersSignedInAndSignedOutAtTheirMeasuredSizeAndHex -only-testing:FlockChromeRender/ChromeRenderTests/testAWiderHandleGetsAWiderButtonRatherThanAnEllipsis -only-testing:FlockChromeRender/ChromeRenderTests/testChatButtonReadsSignedInOnFirstRenderWithNoPopoverEverOpened -only-testing:FlockChromeRender/ChromeRenderTests/testChatButtonDrawsUnreadAndSitsLeftOfTheStatusDot -only-testing:FlockChromeRender/ChatStoreTests -only-testing:FlockChromeRender/ChatDegradationRenderTests -skipPackagePluginValidation -derivedDataPath build/lane4-derived 2>&1 | tail -25
```

Expected: `** TEST SUCCEEDED **`. If `testChatButtonRendersSignedInAndSignedOutAtTheirMeasuredSizeAndHex` fails its width check, the legend is drawing the id: fix the view, not the expectation.

- [ ] **Step 5: Commit**

```bash
git add Sources/FlockCore/Chat/ChatButtonModel.swift Sources/Flock/Views/PaneCellView.swift Tests/FlockCoreTests/ChatButtonModelTests.swift Tests/FlockChromeRender/ChromeRenderTests.swift Tests/FlockChromeRender/ChatStoreTests.swift Tests/FlockChromeRender/ChatDegradationRenderTests.swift
Scripts/checks.sh
git commit -m "Draw the chat name in the pane legend, one @ rule for fixtures" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Popover, Peek, Broadcast and Quick send draw the name

**Files:**
- Modify: `Sources/Flock/Chat/ChatPopover.swift:215-219`
- Modify: `Sources/Flock/Chat/ChatPeekView.swift:82`
- Modify: `Sources/Flock/Chat/ChatBroadcastView.swift:92`
- Modify: `Sources/Flock/Chat/ChatQuickSendView.swift:22-28` (init), `:46-51` (`.task`), `:97-100` (`chip`), `:157-160`
- Modify: `Sources/Flock/Chat/ChatPeekView.swift:103` (`roomRow`)
- Test: `Tests/FlockChromeRender/ChatFeatureViewsRenderTests.swift`

**Interfaces:**
- Consumes: `ChatStatus.displayName`, `ChatBuddy.displayName`, `ChatStatus(handle:name:...)`, `ChatPeekRoom.label`, `ChatTargets.labels` from Task 1.
- Produces: `ChatQuickSendView.init(..., previewTargets:, previewLabels: [String: String] = [:])`. Peek room rows and quick-send chips draw the label when herdr-chat sent one, else the raw target; `selectedTarget`, `send()` and every action keep the raw target. The popover's room chips are unchanged: they draw `status.rooms`, where herdr-chat's `room_tokens` already collapses DM rooms, so no DM hash reaches them.
- Produces: `hostWindow(_:chatStore:size:theme:)` and `pixels(_:size:theme:)` test helpers in `ChatFeatureViewsRenderTests`, used again by Task 5.

- [ ] **Step 1: Write the failing tests**

In `Tests/FlockChromeRender/ChatFeatureViewsRenderTests.swift`:

In both `cleanPeekJSON` and `peekJSONWithGhost`, replace the kay row with a minted identity (layout is unchanged, so the existing hex tests keep passing):

```swift
        {"handle":"kay.k3f9","name":"kay","paneId":"w1:p3","status":"done","repo":"flock","branch":"phase-0","title":null,"unread":0,"mentions":0},
```

Replace `hostWindow` (the `private func hostWindow(_ view: some View, chatStore: ChatStore, size: CGSize) -> NSWindow` block) with a version that takes the theme:

```swift
    private func hostWindow(
        _ view: some View, chatStore: ChatStore, size: CGSize, theme: Theme = ChatFeatureViewsRenderTests.theme
    ) -> NSWindow {
        let chrome = view
            .background(RoundedRectangle(cornerRadius: ChromeMetrics.ChatPopover.cornerRadius).fill(Color(theme.palette.panelBg)))
            .overlay(
                RoundedRectangle(cornerRadius: ChromeMetrics.ChatPopover.cornerRadius)
                    .strokeBorder(Color(theme.palette.surface1), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: ChromeMetrics.ChatPopover.cornerRadius))
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false
        )
        window.isReleasedWhenClosed = false
        window.colorSpace = .sRGB
        window.contentView = NSHostingView(
            rootView: ZStack(alignment: .topLeading) { chrome }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .environment(chatStore)
                .environment(ToastCenter())
        )
        window.contentView?.layoutSubtreeIfNeeded()
        return window
    }
```

Add this helper next to `snapshot`:

```swift
    /// Raw pixels of `view`, hosted the way production hosts it, for comparing
    /// two renders byte for byte.
    private func pixels(_ view: some View, size: CGSize, theme: Theme = ChatFeatureViewsRenderTests.theme) async throws -> Data {
        let window = hostWindow(view, chatStore: makeInertChatStore(), size: size, theme: theme)
        defer { window.close() }
        await settle(window)
        let image = try snapshot(window)
        let bytes = try XCTUnwrap(image.bitmapData)
        return Data(bytes: bytes, count: image.bytesPerRow * image.pixelsHigh)
    }
```

Add a new section before `// MARK: - Shared harness`:

```swift
    // MARK: - Identity: the name is drawn, the id never is

    private static func decodeBuddy(_ json: String) -> ChatBuddy {
        try! JSONDecoder().decode(ChatBuddy.self, from: Data(json.utf8))
    }

    private static let legacyKay = decodeBuddy(
        #"{"handle":"kay","paneId":"w1:p3","status":"done","repo":"flock","branch":"phase-0","title":null,"unread":0,"mentions":0}"#
    )
    private static let mintedKay = decodeBuddy(
        #"{"handle":"kay.k3f9","name":"kay","paneId":"w1:p3","status":"done","repo":"flock","branch":"phase-0","title":null,"unread":0,"mentions":0}"#
    )
    private static let unnamedKay = decodeBuddy(
        #"{"handle":"kay.k3f9","paneId":"w1:p3","status":"done","repo":"flock","branch":"phase-0","title":null,"unread":0,"mentions":0}"#
    )

    /// A minted identity must draw exactly what a legacy identity with the
    /// same name draws, pixel for pixel. Each pair carries its own control:
    /// the same id with no name has to draw differently, or the comparison is
    /// not seeing the text at all.
    func testPeekAndBroadcastRowsDrawTheNameNeverTheId() async throws {
        let peek = ChatPeekView(theme: Self.theme, onBack: {}, onClose: {}, onJump: { _ in })
        let peekSize = CGSize(width: ChromeMetrics.ChatPeek.width, height: ChromeMetrics.ChatPeek.PaneRow.height)
        let peekLegacy = try await pixels(peek.paneRow(Self.legacyKay), size: peekSize)
        let peekMinted = try await pixels(peek.paneRow(Self.mintedKay), size: peekSize)
        let peekUnnamed = try await pixels(peek.paneRow(Self.unnamedKay), size: peekSize)
        XCTAssertEqual(peekMinted, peekLegacy, "a peek row drew something other than the name")
        XCTAssertNotEqual(peekUnnamed, peekLegacy, "control: an id with no name must draw differently")

        let broadcast = ChatBroadcastView(theme: Self.theme, onBack: {}, onClose: {}, previewBuddies: [])
        let broadcastSize = CGSize(width: ChromeMetrics.ChatBroadcast.width, height: ChromeMetrics.ChatBroadcast.PaneRow.height)
        let broadcastLegacy = try await pixels(broadcast.paneRow(Self.legacyKay), size: broadcastSize)
        let broadcastMinted = try await pixels(broadcast.paneRow(Self.mintedKay), size: broadcastSize)
        let broadcastUnnamed = try await pixels(broadcast.paneRow(Self.unnamedKay), size: broadcastSize)
        XCTAssertEqual(broadcastMinted, broadcastLegacy, "a broadcast row drew something other than the name")
        XCTAssertNotEqual(broadcastUnnamed, broadcastLegacy, "control: an id with no name must draw differently")
    }

    func testThePopoverStatusAndQuickSendFooterDrawTheNameNeverTheId() async throws {
        let legacy = ChatStatus(handle: "kay", state: "working", pane: "w1:p3", signedIn: true, rooms: ["#rt"])
        let minted = ChatStatus(handle: "kay.k3f9", name: "kay", state: "working", pane: "w1:p3", signedIn: true, rooms: ["#rt"])
        let unnamed = ChatStatus(handle: "kay.k3f9", state: "working", pane: "w1:p3", signedIn: true, rooms: ["#rt"])

        func statusBlock(_ status: ChatStatus) -> some View {
            ChatPopover(
                theme: Self.theme, status: status, isPresented: .constant(true), onSignIn: {}, onSignOut: {}, onOpenViewer: {}
            ).statusBlock
        }
        let statusSize = CGSize(width: ChromeMetrics.ChatPopover.width, height: ChromeMetrics.ChatPopover.Status.heightSignedIn)
        let statusLegacy = try await pixels(statusBlock(legacy), size: statusSize)
        let statusMinted = try await pixels(statusBlock(minted), size: statusSize)
        let statusUnnamed = try await pixels(statusBlock(unnamed), size: statusSize)
        XCTAssertEqual(statusMinted, statusLegacy, "the popover status line drew something other than the name")
        XCTAssertNotEqual(statusUnnamed, statusLegacy, "control: an id with no name must draw differently")

        func quickSend(_ status: ChatStatus) -> ChatQuickSendView {
            ChatQuickSendView(theme: Self.theme, status: status, onBack: {}, onClose: {}, previewTargets: ["#rt"])
        }
        XCTAssertEqual(quickSend(minted).footerHint, "sent as kay")
        let fieldSize = CGSize(width: ChromeMetrics.ChatQuickSend.width, height: ChromeMetrics.ChatQuickSend.FieldBand.height)
        let fieldLegacy = try await pixels(quickSend(legacy).fieldBand, size: fieldSize)
        let fieldMinted = try await pixels(quickSend(minted).fieldBand, size: fieldSize)
        let fieldUnnamed = try await pixels(quickSend(unnamed).fieldBand, size: fieldSize)
        XCTAssertEqual(fieldMinted, fieldLegacy, "the quick send footer drew something other than the name")
        XCTAssertNotEqual(fieldUnnamed, fieldLegacy, "control: an id with no name must draw differently")
    }

    /// A DM room's hash never reaches the screen when herdr-chat sent a
    /// label: the row and the chip draw exactly what a room literally named
    /// by the label would draw. The unlabelled hash is the control.
    func testDMRoomRowsAndChipsDrawTheLabelNeverTheHash() async throws {
        let peek = ChatPeekView(theme: Self.theme, onBack: {}, onClose: {}, onJump: { _ in })
        let rowSize = CGSize(width: ChromeMetrics.ChatPeek.width, height: ChromeMetrics.ChatPeek.PaneRow.height)
        let labelled = try await pixels(
            peek.roomRow(ChatPeekRoom(room: "dm-3f9a", label: "kai ↔ remy", unread: 0, mentions: 0), isFirst: true), size: rowSize
        )
        let literal = try await pixels(
            peek.roomRow(ChatPeekRoom(room: "kai ↔ remy", unread: 0, mentions: 0), isFirst: true), size: rowSize
        )
        let unlabelled = try await pixels(
            peek.roomRow(ChatPeekRoom(room: "dm-3f9a", unread: 0, mentions: 0), isFirst: true), size: rowSize
        )
        XCTAssertEqual(labelled, literal, "a peek DM room row drew something other than its label")
        XCTAssertNotEqual(unlabelled, literal, "control: the raw hash must draw differently")

        let status = ChatStatus(handle: "kay", state: "working", pane: "w1:p3", signedIn: true, rooms: ["#rt"])
        let chipSize = CGSize(width: ChromeMetrics.ChatQuickSend.width, height: ChromeMetrics.ChatQuickSend.TargetBand.chipHeight)
        let withLabels = ChatQuickSendView(
            theme: Self.theme, status: status, onBack: {}, onClose: {},
            previewTargets: ["#dm-3f9a"], previewLabels: ["#dm-3f9a": "kai ↔ remy"]
        )
        let literalTarget = ChatQuickSendView(theme: Self.theme, status: status, onBack: {}, onClose: {}, previewTargets: ["kai ↔ remy"])
        let noLabels = ChatQuickSendView(theme: Self.theme, status: status, onBack: {}, onClose: {}, previewTargets: ["#dm-3f9a"])
        let chipLabelled = try await pixels(withLabels.chip("#dm-3f9a"), size: chipSize)
        let chipLiteral = try await pixels(literalTarget.chip("kai ↔ remy"), size: chipSize)
        let chipRaw = try await pixels(noLabels.chip("#dm-3f9a"), size: chipSize)
        XCTAssertEqual(chipLabelled, chipLiteral, "a quick send chip drew something other than its label")
        XCTAssertNotEqual(chipRaw, chipLiteral, "control: the raw target must draw differently")
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
xcodebuild test -scheme FlockChromeRender -destination 'platform=macOS' -only-testing:FlockChromeRender/ChatFeatureViewsRenderTests -skipPackagePluginValidation -derivedDataPath build/lane4-derived 2>&1 | tail -30
```

Expected: `** TEST FAILED **`. The test build fails first on `extra argument 'previewLabels' in call`; with that one test commented out, exactly these failures: `a peek row drew something other than the name`, `a broadcast row drew something other than the name`, `the popover status line drew something other than the name`, `XCTAssertEqual failed: ("sent as kay.k3f9") is not equal to ("sent as kay")` and `the quick send footer drew something other than the name`. Every control assertion and every pre-existing test passes. Restore the commented test before Step 3.

- [ ] **Step 3: Implement**

`Sources/Flock/Chat/ChatPopover.swift`, lines 215-219 become:

```swift
                if let name = status?.displayName {
                    Text(name)
                        .font(ChromeType.chatPopoverHandle)
                        .foregroundStyle(theme.text)
                }
```

`Sources/Flock/Chat/ChatPeekView.swift`, line 82 becomes (the `jump(to:)` function at line 146-151 keeps `buddy.handle`, untouched):

```swift
                    Text(buddy.displayName).font(ChromeType.chatPeekHandle).foregroundStyle(theme.text)
```

`Sources/Flock/Chat/ChatBroadcastView.swift`, line 92 becomes:

```swift
                    Text(buddy.displayName).font(ChromeType.chatPeekHandle).foregroundStyle(theme.text)
```

`Sources/Flock/Chat/ChatPeekView.swift`, in `roomRow` (line 103), draw the label when present:

```swift
            Text(room.label ?? room.room).font(ChromeType.chatPeekRoomName).foregroundStyle(theme.subtext0)
```

(the `ForEach` at line 43 keeps `id: \.element.room`).

`Sources/Flock/Chat/ChatQuickSendView.swift`: add `@State private var labels: [String: String]` beside `targets`; extend the init with `previewLabels: [String: String] = [:]` after `previewTargets`, seeding `self._labels = State(initialValue: previewLabels)`; in `.task`, after `targets = fetched.rooms + fetched.people`, add `labels = fetched.labels ?? [:]`; and in `chip(_:)` change `Text(target)` to `Text(labels[target] ?? target)`. `selectedTarget` and `send()` keep the raw target (`@kay`, `#rt`, `#dm-3f9a`), which is what `--to` takes back.

Lines 157-160 become:

```swift
    var footerHint: String {
        guard let name = status?.displayName, status?.signedIn == true else { return "Sign in to send" }
        return "sent as \(name)"
    }
```

Confirm no view draws a raw handle any more:

```bash
grep -rn 'Text(.*handle' Sources/Flock/Chat Sources/Flock/Views/PaneCellView.swift
```

Expected: no output.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
xcodebuild test -scheme FlockChromeRender -destination 'platform=macOS' -only-testing:FlockChromeRender/ChatFeatureViewsRenderTests -only-testing:FlockChromeRender/ChatDegradationRenderTests -only-testing:FlockChromeRender/ChatPopoverAppearanceTests -skipPackagePluginValidation -derivedDataPath build/lane4-derived 2>&1 | tail -25
```

Expected: `** TEST SUCCEEDED **`.

- [ ] **Step 5: Commit**

```bash
git add Sources/Flock/Chat/ChatPopover.swift Sources/Flock/Chat/ChatPeekView.swift Sources/Flock/Chat/ChatBroadcastView.swift Sources/Flock/Chat/ChatQuickSendView.swift Tests/FlockChromeRender/ChatFeatureViewsRenderTests.swift
Scripts/checks.sh
git commit -m "Draw chat names and DM room labels in the popover, peek, broadcast and quick send" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Docs follow the id/name split

**Files:**
- Modify: `docs/superpowers/specs/2026-09-18-flock-chat-design.md:79-86`, the `targets` paragraph (~line 109), and lines ~194, ~219, ~235, ~244
- Modify: `docs/superpowers/plans/2026-09-18-flock-chat.md:118-130`
- Modify: `docs/design/chat/measurements.md:67, 115, 138-140, 210, 242`

**Interfaces:** none (docs only).

- [ ] **Step 1: Spec verb table**

In `docs/superpowers/specs/2026-09-18-flock-chat-design.md`, replace these table rows:

```markdown
| `status --json` | `--pane <id>` | `{ handle, name, state, pane, signedIn, rooms[] }` |
| `peek --json` | | `{ buddies: [{handle, name, paneId, status, repo, branch, title, unread, mentions}], rooms: [{room, label, unread, mentions}] }` |
| `targets --json` | | `{ rooms: [#name], people: [@name], labels: {target: text} }` |
| `quick-send --json` | `--to <#room\|@name> --body <text>` | `{ ok, to }` |
```

```markdown
| `jump --json` | `--handle <id or name>` | `{ paneId, workspace, handle, name }` |
```

- [ ] **Step 2: Spec paragraph on ids and names**

Directly after the paragraph that starts `**\`targets\` returns prefixed names.**`, add:

```markdown
**`handle` is an id; `name` is what is drawn.** rt chat gives every session a
hidden identity id (`kay.k3f9`) behind its display name (`kay`), so a recycled
name never inherits someone else's rooms or messages. `handle` carries the id,
and it is what flock acts on (`jump --handle`). `name` is what every surface
draws. A missing or null `name` falls back to `handle`, since a legacy
identity's id is its name. Identity text is never drawn with an `@`; the only
`@` on screen is the target prefix on a quick-send chip. A DM room's own name
is a hash, so `peek` rooms carry a `label` and `targets` a `labels` map
(`#dm-3f9a` reads `kai ↔ remy`); flock draws the label when present and
still acts on the raw room or target.
```

- [ ] **Step 3: Spec display wording**

In the same file, make these exact replacements:

- `the pane's chat handle, a divider,` becomes `the pane's chat name, a divider,`
- `**Status block:** dot, handle, state word,` becomes `**Status block:** dot, name, state word,`
- `each with its status dot, handle, where it lives,` becomes `each with its status dot, name, where it lives,`
- `The footer names the handle the message` becomes `The footer names who the message`, and the next line's `will be sent as,` stays as it is.

Check: `grep -n "handle" docs/superpowers/specs/2026-09-18-flock-chat-design.md` should now show only the verb table, the jump/handle and sign-verb paragraphs, and the new paragraph.

- [ ] **Step 4: Old plan's contract table**

In `docs/superpowers/plans/2026-09-18-flock-chat.md`, replace:

```markdown
| status | `status --json --pane <id>` | `handle`, `state`, `pane`, `signedIn`, `rooms` |
```

with:

```markdown
| status | `status --json --pane <id>` | `handle`, `name`, `state`, `pane`, `signedIn`, `rooms` |
```

replace:

```markdown
| jump | `jump --json --handle <handle>` | `paneId`, `workspace`, `handle` |
```

with:

```markdown
| jump | `jump --json --handle <handle>` | `paneId`, `workspace`, `handle`, `name` |
```

and replace `Nested: a peek buddy is \`handle\`, \`paneId\`,` with `Nested: a peek buddy is \`handle\`, \`name\`, \`paneId\`,`. After the "Nested:" paragraph add:

```markdown
`handle` is an identity id and `name` its display name; views draw `name`,
falling back to `handle`. `name` is the one exception to rule 2 below: an
older herdr-chat omits the key, so it decodes as absent.
```

- [ ] **Step 5: measurements.md**

In `docs/design/chat/measurements.md`:

- Line 67: `the handle at` becomes `the name at`.
- Line 115: `handle at 12/500 in \`text\`` becomes `name at 12/500 in \`text\``.
- Line 210, the table row, becomes:

```markdown
| Name | h12, WIDTH FROM THE TEXT | `green` | 10/600, the display name with NO `@` prefix |
```

- Line 242: `at zero the button is the handle and` becomes `at zero the button is the name and`.
- After the Quick send paragraph ending `...label at 12/600 in \`panelBg\` with \`⌘⏎\` beside it at 10/regular in \`panelBg\` at 67%.`, add:

```markdown
Every name on these surfaces is the identity's display name (`name`, falling
back to `handle`). The identity id (`kay.k3f9`) is never drawn, and no name
carries an `@`; chips keep their `#`/`@` because they are targets, not names.
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-09-18-flock-chat-design.md docs/superpowers/plans/2026-09-18-flock-chat.md docs/design/chat/measurements.md
Scripts/checks.sh
git commit -m "Document chat names versus identity ids" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: UI validation in both schemes, then the dev build

**This lane is not done until a person has looked at the renders below in a
dark and a light theme and said what looks wrong.** Green tests, pixel
equality and a clean review do not count as looking.

**Files:**
- Test: `Tests/FlockChromeRender/ChatFeatureViewsRenderTests.swift`

**Interfaces:**
- Consumes: `hostWindow(_:chatStore:size:theme:)`, `makeChatStore(peekJSON:targetsJSON:)`, `peekJSONWithGhost`, `writePNG`, `snapshot`, `hex` (Task 3 and the existing harness).
- Produces: PNGs `chat-identity-{popover,peek,quick-send,broadcast}-{dark,light}.png`.

- [ ] **Step 1: Write the both-scheme render test**

Add to the identity section of `ChatFeatureViewsRenderTests`:

```swift
    /// The UI-validation render for chat identity: the popover, Peek, Quick
    /// send and Broadcast in a dark and a light theme, with kay a minted
    /// identity (`kay.k3f9`, named `kay`). PNGs land in
    /// `FLOCK_CHROME_RENDER_DIR` for a person to look at; the assertion only
    /// proves each surface drew on its own theme's ground.
    func testChatIdentitySurfacesRenderInBothSchemes() async throws {
        let directory = ProcessInfo.processInfo.environment["FLOCK_CHROME_RENDER_DIR"].flatMap { $0.isEmpty ? nil : $0 }
        let status = ChatStatus(
            handle: "kay.k3f9", name: "kay", state: "working", pane: "w1:p3", signedIn: true, rooms: ["#rt", "#flock"]
        )
        let targetsJSON = ##"{"rooms":["#rt","#flock"],"people":["@scout","@codex","@kay"]}"##
        for (theme, scheme) in [(Theme.tokyoNight, "dark"), (Theme(.tokyoNightDay), "light")] {
            let store = await makeChatStore(peekJSON: Self.peekJSONWithGhost, targetsJSON: targetsJSON)
            let surfaces: [(String, AnyView, CGSize)] = [
                (
                    "popover",
                    AnyView(ChatPopover(theme: theme, status: status, isPresented: .constant(true), onSignIn: {}, onSignOut: {}, onOpenViewer: {})),
                    CGSize(width: ChromeMetrics.ChatPopover.width, height: ChromeMetrics.ChatPopover.signedInHeight)
                ),
                (
                    "peek",
                    AnyView(ChatPeekView(theme: theme, onBack: {}, onClose: {}, onJump: { _ in })),
                    CGSize(width: ChromeMetrics.ChatPeek.width, height: 400)
                ),
                (
                    "quick-send",
                    AnyView(ChatQuickSendView(theme: theme, status: status, onBack: {}, onClose: {})),
                    CGSize(width: ChromeMetrics.ChatQuickSend.width, height: ChromeMetrics.ChatQuickSend.height)
                ),
                (
                    "broadcast",
                    AnyView(ChatBroadcastView(theme: theme, onBack: {}, onClose: {})),
                    CGSize(width: ChromeMetrics.ChatBroadcast.width, height: 420)
                ),
            ]
            for (name, view, size) in surfaces {
                let window = hostWindow(view, chatStore: store, size: size, theme: theme)
                await settle(window)
                let image = try snapshot(window)
                if let directory {
                    try writePNG(image, to: directory, name: "chat-identity-\(name)-\(scheme).png")
                }
                XCTAssertEqual(
                    hex(image, CGPoint(x: size.width * 0.6, y: 5)), theme.palette.panelBg.hex, "\(name), \(scheme): ground"
                )
                window.close()
            }
        }
    }
```

- [ ] **Step 2: Run it and write the PNGs**

```bash
mkdir -p build/lane4-renders
TEST_RUNNER_FLOCK_CHROME_RENDER_DIR="$PWD/build/lane4-renders" xcodebuild test -scheme FlockChromeRender -destination 'platform=macOS' -only-testing:FlockChromeRender/ChatFeatureViewsRenderTests/testChatIdentitySurfacesRenderInBothSchemes -only-testing:FlockChromeRender/ChromeRenderTests/testChatButtonRendersSignedInAndSignedOutAtTheirMeasuredSizeAndHex -skipPackagePluginValidation -derivedDataPath build/lane4-derived 2>&1 | tail -20
ls build/lane4-renders
```

Expected: `** TEST SUCCEEDED **`, and the directory holds the eight `chat-identity-*.png` files plus `chat-button-signed-in.png` and `chat-button-signed-out.png`.

- [ ] **Step 3: Look at every PNG**

Open each file with the Read tool (it shows images). For each of the eight
identity renders and the signed-in button, check and write down plainly:

- No `.k3f9` anywhere. kay reads `kay` in the popover status line, the Peek row,
  the Broadcast row and the Quick send footer (`sent as kay`), and the legend
  button reads `kay`.
- No `@` on any identity text. The Quick send chips do read `@scout`,
  `@codex`, `@kay` and `#rt`, `#flock`: prefixes stay on chips.
- The light renders read as light: text legible on the `tokyoNightDay` ground,
  dots and pills in their colours, nothing dark-on-dark left over.
- Nothing clipped or overlapping in either scheme.

Report what looks wrong, even if every test is green. Fix anything wrong in
the view, re-run Step 2, and look again.

- [ ] **Step 4: Run the full gates**

```bash
xcodebuild test -scheme Flock -destination 'platform=macOS' -only-testing:FlockCoreTests -skipPackagePluginValidation -derivedDataPath build/lane4-derived 2>&1 | tail -15
xcodebuild test -scheme FlockChromeRender -destination 'platform=macOS' -skipPackagePluginValidation -derivedDataPath build/lane4-derived > build/lane4-chrome.log 2>&1; tail -15 build/lane4-chrome.log
Scripts/checks.sh
```

Expected: `** TEST SUCCEEDED **` twice and `all checks ok`. If the chrome suite
fails, `grep -n "error:\|failed" build/lane4-chrome.log` rather than
re-running it.

- [ ] **Step 5: Commit**

```bash
git add Tests/FlockChromeRender/ChatFeatureViewsRenderTests.swift
Scripts/checks.sh
git commit -m "Render chat identity surfaces in both schemes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Dev build**

```bash
Scripts/dev-build.sh
```

Expected: it ends having swapped a new `build/dev/Flock-dev.app` into place.
Do not open, quit or relaunch Flock Dev yourself.

- [ ] **Step 7: Hand to Matt for the live look**

Tell Matt, in these words or close: "Flock Dev has a new build: click the
**New build · Restart** pill (or `open build/dev/Flock-dev.app` if it is not
running). With the herdr-chat build from lane 3 installed, please open a
signed-in pane's chat button, then Peek and Quick send, once under a dark
theme and once under a light one (Theme menu, for example Tokyo Night and
Tokyo Night Day), and check: names only, no `.xxxx` ids, no `@` on names, `@`
still on the Quick send person chips."

Until lane 3's herdr-chat is installed, the live app shows legacy handles
(which equal their names), so the live look proves layout but not the id
split; the render tests from Step 2 are the proof of the split. Record the
outcome of Matt's look (or that it is still pending) in the lane report. **The
lane is not done until that look has happened and anything it found is
fixed.**

---

## Lane review focus

1. herdr-chat older than lane 3 prints no `name` key: every shape still
   decodes and draws the handle (Task 1 `absent` tests).
2. A `name` that is empty or carries `@`: drawn as the handle, or without the
   `@` (Task 1 `testDisplayTextDropsALeadingAtSignAndIgnoresAnEmptyName`).
3. Jump and quick-send must keep acting on `handle` and the raw target, never
   the display name: Peek's `jump(to:)` and Quick send's `send()` are untouched
   by Task 3; a reviewer checks the diff leaves them alone.
4. The legend width follows the name, not the id (Task 2, the minted fixture
   under the existing width assertions).
5. Light theme: the only light-theme evidence for these surfaces is Task 5's
   renders and Matt's live look; neither can be skipped.
