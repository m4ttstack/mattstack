import Foundation

/// What the tray may ask of macOS on its own. On an unfinished Mac nothing
/// asks before P1, where the person grants each permission themselves.
public enum LaunchPrompts {
    /// The notification permission prompt, login item registration and the
    /// Mission Control notice run at launch only on a finished Mac.
    public static func asksAtLaunch(setupFinished: Bool) -> Bool {
        setupFinished
    }

    /// A run that lands on P7 registers the login item even when nobody
    /// reopens the window to finish. Tools counts too: rt has recorded Finish
    /// by then, and Later closes the window without ever reaching P7.
    public static func registersLoginItem(afterRunOn stage: FormStage) -> Bool {
        stage == .ready || stage == .tools
    }
}
