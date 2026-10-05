import Foundation
import UserNotifications
@testable import MattstackCore

let notificationSoundChecks: [Check] = [
    Check("a tone plays only when the app may notify and its sound toggle is on") { c in
        c.expect(NotificationSound.shouldPlay(authorization: .authorized, sound: .enabled), "authorized with sound on")
        c.expect(NotificationSound.shouldPlay(authorization: .provisional, sound: .enabled), "provisional with sound on")
    },
    Check("turning off Play sound for notifications in System Settings silences the tone") { c in
        c.expect(!NotificationSound.shouldPlay(authorization: .authorized, sound: .disabled), "sound toggled off")
        c.expect(!NotificationSound.shouldPlay(authorization: .authorized, sound: .notSupported), "sound not supported")
    },
    Check("notifications turned off or never granted play no tone either") { c in
        c.expect(!NotificationSound.shouldPlay(authorization: .denied, sound: .enabled), "denied")
        c.expect(!NotificationSound.shouldPlay(authorization: .notDetermined, sound: .enabled), "not determined")
    },
]
