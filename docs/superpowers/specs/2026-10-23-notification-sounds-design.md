# Notification sounds you can choose

## Why

The mattstack app plays one of three bundled tones for every notification
(neutral, positive, warning), and nothing in the app changes them. The only
way out today is macOS's all-or-nothing "Play sound for notifications"
toggle. Matt likes the originals; someone else in the room does not. The fix
is to choose the sounds, not to play them less or quieter.

## Goals

- Settings gets a place to pick a sound for each of the three tiers.
- Each pick can be previewed before it is chosen.
- New choices beyond the originals: the macOS built-in sounds and the Sober
  Ringtones notification tones.
- Nothing changes for anyone who never opens the setting.

## Non-goals

- A sound per event type (about 20 of them). Tiers stay as they are.
- Volume control, or changing which events make a sound.
- The Kenney packs and Cleartones (auditioned, not chosen).
- Syncing the choice across Macs.

## Anti-goals

- A pick that silently plays something else. A missing sound falls back to
  that tier's Original, and the fallback is logged.
- Playing a tone while macOS says notification sounds are off.

## The catalog

| Source | Sounds | Shipped how |
|---|---|---|
| Original | neutral, positive, warning (today's three) | already bundled from `sounds/*.mp3` |
| Sober Ringtones | `101-notification` .. `104-notification` (4). The call tones are left out | new mp3s under `sounds/sober/`, converted to `.caf` by `rt-tray/build.sh` like the originals |
| macOS | the 14 sounds in `/System/Library/Sounds` (Glass, Tink, Pop...) | not shipped: listed and played from the system folder at runtime |
| None | silence for that tier | n/a |

Sober Ringtones are CC BY-SA 4.0 by wize.io
(github.com/frabonomi/sober-ringtones). Credit them in a license file beside
the mp3s and in a caption under the picker. They ship unmodified, apart from
the `.caf` conversion the build already does.

## Decided

- **Granularity:** one pick per tier: Neutral, Positive, Warning. Each row
  says which events it covers (for example "passed, approved, merged") so the
  tiers make sense without explanation. The category-to-tier map in
  `NotificationManager.tier(for:)` does not change.
- **Default:** each tier's Original. An unset setting behaves exactly as
  today.
- **Previewing:** a play button beside each picker plays the current choice.

## My calls (Matt to check)

- **A new Notifications tab** in Settings, next to General. The tab is the
  obvious home for any later notification options.
- **Stored per Mac,** as an rt setting with machine scope. The problem lives
  in the room the Mac is in, and another Mac can choose differently. The value
  is one object, `{neutral, positive, warning}`. Each entry is a sound id such
  as `original/warning`, `sober/102`, `macos/Glass` or `none`. The builder
  picks the key name under the settings registry's conventions.
- **Preview ignores the system mute.** It is an explicit click, and you
  can't choose a sound you can't hear. Real notifications still go through
  `NotificationSound.shouldPlay`.
- **Picker grouped by source** (Original, Sober Ringtones, macOS), then None.

## Constraints

- Playback stays on `NSSound(contentsOf:)` with `content.sound = nil`.
  `UNNotificationSound(named:)` cannot see files in `Contents/Resources/`
  on macOS.
- The burst coalescing in `playSound(for:)` stays: one tone per burst, at
  the highest tier present.
- The play path never shells out to `rt` per notification. The tray holds
  the current picks in memory, loads them at launch, and refreshes them when
  the Settings pane writes.
- id resolution and fallback are pure logic in `Sources-core` with
  `MattstackCoreChecks` coverage, like `NotificationSound.shouldPlay`.
- UI validation: render the new tab in the dev app and screenshot it in
  light and dark before calling it done.

## Left to the builder

- The setting key's name and registry entry.
- How the tray learns of a change (re-read after its own write is enough,
  since the pane is the only writer).
- The bundle layout for the Sober files (`sober-101.caf` or a subfolder) and
  the `build.sh` loop change.
- Picker control and row layout, within the existing pane style
  (`Form` + `.formStyle(.grouped)`).

## Approaches considered

| Approach | Trade-off | Outcome |
|---|---|---|
| macOS built-ins + Originals only | Nothing to ship, but few choices | Folded in |
| A new bundled set from CC0 packs (Kenney) | Many choices, about 2MB, needs grouping | Auditioned, not chosen |
| Cleartones | Best-sounding to some ears, but personal-use only | Can't ship |
| Sober Ringtones notification tones | Small, minimal, shippable with credit | **Chosen**, with Originals + macOS |

Matt picked from a local audition page of 295 candidates.
