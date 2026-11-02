import Foundation
import MattstackCore

let secretPrefixChecks: [Check] = [
    Check("SecretPrefix.fromHint: an ellipsis-ended hint names its prefix; any other hint, or none, names nothing") { c in
        c.expectEqual(SecretPrefix.fromHint("lin_api_…"), "lin_api_")
        c.expectEqual(SecretPrefix.fromHint("AGE-SECRET-KEY-1..."), "AGE-SECRET-KEY-1")
        c.expectEqual(SecretPrefix.fromHint("api"), nil)
        c.expectEqual(SecretPrefix.fromHint("…"), nil)
        c.expectEqual(SecretPrefix.fromHint(nil), nil)
    },
    Check("SecretPrefix.shown: never reveals a character unless the value starts with the whole prefix and runs past it") { c in
        c.expectEqual(SecretPrefix.shown(of: "secretvalue", prefix: "lin_api_"), "")
        c.expectEqual(SecretPrefix.shown(of: "lin_xyz123456", prefix: "lin_api_"), "")
        c.expectEqual(SecretPrefix.shown(of: "lin_", prefix: "lin_api_"), "")
        c.expectEqual(SecretPrefix.shown(of: "lin_api_", prefix: "lin_api_"), "")
        c.expectEqual(SecretPrefix.shown(of: "lin_api_abc", prefix: "lin_api_"), "lin_api_")
        c.expectEqual(SecretPrefix.shown(of: "lin_api_abc", prefix: nil), "")
    },
]
