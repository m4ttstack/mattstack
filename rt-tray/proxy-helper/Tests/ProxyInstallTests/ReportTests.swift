import XCTest
@testable import ProxyInstall

final class ReportTests: XCTestCase {
    func testTrailerLineShape() {
        XCTAssertEqual(Report.trailer(3), "MATTSTACK_EXIT=3")
    }
    func testUsageIsExit64() {
        XCTAssertEqual(ProxyInstallMain.parse(argv: ["x"]), .usage)
        XCTAssertEqual(ProxyInstallMain.parse(argv: ["x", "bogus"]), .usage)
        XCTAssertEqual(ProxyInstallMain.parse(argv: ["x", "--version"]), .version)
        XCTAssertEqual(ProxyInstallMain.parse(argv: ["x", "install"]), .install(homebrew: false))
        XCTAssertEqual(ProxyInstallMain.parse(argv: ["x", "remove"]), .remove)
        XCTAssertEqual(ProxyInstallMain.parse(argv: ["x", "trust"]), .trust(homebrew: false))
    }
    func testTheHomebrewFlagRidesOnlyInstallAndTrust() {
        XCTAssertEqual(ProxyInstallMain.parse(argv: ["x", "install", "--homebrew"]), .install(homebrew: true))
        XCTAssertEqual(ProxyInstallMain.parse(argv: ["x", "trust", "--homebrew"]), .trust(homebrew: true))
        XCTAssertEqual(ProxyInstallMain.parse(argv: ["x", "homebrew"]), .homebrew)
        XCTAssertEqual(ProxyInstallMain.parse(argv: ["x", "remove", "--homebrew"]), .usage)
        XCTAssertEqual(ProxyInstallMain.parse(argv: ["x", "install", "--bogus"]), .usage)
        XCTAssertEqual(ProxyInstallMain.parse(argv: ["x", "install", "--homebrew", "https://example.com/x.pkg"]), .usage)
    }
    func testHomebrewLineShape() {
        XCTAssertEqual(Report.homebrewLine(.ok), "MATTSTACK_HOMEBREW=ok")
        XCTAssertEqual(Report.homebrewLine(.present), "MATTSTACK_HOMEBREW=present")
        XCTAssertEqual(Report.homebrewLine(.failed), "MATTSTACK_HOMEBREW=failed")
    }
    func testTrustLineShape() {
        XCTAssertEqual(Report.trustLine(.ok), "MATTSTACK_TRUST=ok")
        XCTAssertEqual(Report.trustLine(.declined), "MATTSTACK_TRUST=declined")
        XCTAssertEqual(Report.trustLine(.failed), "MATTSTACK_TRUST=failed")
    }
}
