import Foundation
import UserNotifications

/// The tray plays its alert tones through NSSound, outside the notification
/// system, so macOS never applies the app's own notification settings to
/// them. This is the gate that applies them by hand.
public enum NotificationSound {

    public static func shouldPlay(authorization: UNAuthorizationStatus, sound: UNNotificationSetting) -> Bool {
        switch authorization {
        case .authorized, .provisional, .ephemeral:
            return sound == .enabled
        case .denied, .notDetermined:
            return false
        @unknown default:
            return false
        }
    }
}
