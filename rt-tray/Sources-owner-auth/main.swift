import Foundation
import LocalAuthentication
import OwnerAuthLogic

/// One LAContext for the probe and the prompt, as LocalAuthentication expects.
final class SystemOwnerAuthenticator: OwnerAuthenticator {
    private let context = LAContext()

    func canEvaluate() -> Int? {
        var error: NSError?
        return context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) ? nil : (error?.code ?? OwnerAuthContract.authenticationFailed)
    }

    func evaluate(reason: String) -> Int? {
        let done = DispatchSemaphore(value: 0)
        var failure: Int?
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, error in
            if !ok { failure = (error as NSError?)?.code ?? OwnerAuthContract.authenticationFailed }
            done.signal()
        }
        done.wait()
        return failure
    }
}

switch OwnerAuthContract.parse(Array(CommandLine.arguments.dropFirst())) {
case .usage(let message):
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(OwnerAuthContract.usageExit)
case .reason(let reason):
    let outcome = runOwnerAuth(reason: reason, with: SystemOwnerAuthenticator())
    print(OwnerAuthContract.word(outcome))
    if let message = OwnerAuthContract.message(outcome) {
        FileHandle.standardError.write(Data((message + "\n").utf8))
    }
    exit(OwnerAuthContract.exitCode(outcome))
}
