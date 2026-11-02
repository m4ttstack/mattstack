import Foundation

enum Op: Equatable { case version, install(homebrew: Bool), remove, trust(homebrew: Bool), homebrew, usage }

enum ProxyInstallMain {
    /// Exact shapes only: this argv reaches a root process, so anything it
    /// does not recognise in full is usage, never a guess.
    static func parse(argv: [String]) -> Op {
        switch Array(argv.dropFirst()) {
        case ["--version"]: return .version
        case ["install"]: return .install(homebrew: false)
        case ["install", "--homebrew"]: return .install(homebrew: true)
        case ["remove"]: return .remove
        case ["trust"]: return .trust(homebrew: false)
        case ["trust", "--homebrew"]: return .trust(homebrew: true)
        case ["homebrew"]: return .homebrew
        default: return .usage
        }
    }
}

switch ProxyInstallMain.parse(argv: CommandLine.arguments) {
case .version:
    print("mattstack-proxy-install \(HelperVersion.value) protocol 1")
    exit(0)
case .usage:
    Report.step("usage: mattstack-proxy-install install [--homebrew]|remove|trust [--homebrew]|homebrew|--version")
    Report.finish(ExitCode.usage)
case .install(let homebrew):
    Report.finish(InstallOp.run(homebrew: homebrew))
case .remove:
    Report.finish(RemoveOp.run())
case .trust(let homebrew):
    Report.finish(TrustOp.run(homebrew: homebrew))
case .homebrew:
    Report.finish(HomebrewOp.run())
}
