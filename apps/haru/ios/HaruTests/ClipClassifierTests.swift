import XCTest
@testable import Haru

/// Parity with the Python prototype: prototypes/tidy/expected.json is produced by
/// `python prototypes/tidy/tidy.py --export-expected`. Regenerate it whenever
/// Resources/clip_lexicon.json changes; both sides must agree on every case.
final class ClipClassifierTests: XCTestCase {
    private struct Golden: Decodable {
        struct Case: Decodable {
            let text: String
            let drawer: String
            let score: Double
            let expiry: String?
        }

        let today: String
        let cases: [Case]
    }

    private func load<T: Decodable>(_ name: String, extension fileExtension: String, as type: T.Type) throws -> T {
        let bundle = Bundle(for: Self.self)
        let url = try XCTUnwrap(bundle.url(forResource: name, withExtension: fileExtension), "\(name).\(fileExtension) not in test bundle")
        return try JSONDecoder().decode(T.self, from: Data(contentsOf: url))
    }

    private func classifier() throws -> ClipClassifier {
        let bundle = Bundle(for: Self.self)
        let url = try XCTUnwrap(bundle.url(forResource: "clip_lexicon", withExtension: "json"))
        return try ClipClassifier(lexiconData: Data(contentsOf: url))
    }

    func testDrawersAndScoresMatchPython() throws {
        let golden = try load("expected", extension: "json", as: Golden.self)
        let classifier = try classifier()
        XCTAssertEqual(golden.cases.count, 60)
        for testCase in golden.cases {
            let result = classifier.classify(testCase.text)
            XCTAssertEqual(result.drawer.rawValue, testCase.drawer, testCase.text)
            XCTAssertEqual(result.score, testCase.score, accuracy: 0.001, testCase.text)
        }
    }

    func testExpiryMatchesPython() throws {
        let golden = try load("expected", extension: "json", as: Golden.self)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let parser = DateFormatter()
        parser.calendar = calendar
        parser.timeZone = calendar.timeZone
        parser.dateFormat = "yyyy-MM-dd"
        let today = try XCTUnwrap(parser.date(from: golden.today))

        for testCase in golden.cases {
            let found = ExpiryFinder.expiry(in: testCase.text, today: today, calendar: calendar)
            XCTAssertEqual(found.map(parser.string(from:)), testCase.expiry, testCase.text)
        }
    }

    func testMinimumScoreFallsBackToOther() throws {
        let result = try classifier().classify("12345 67890")
        XCTAssertEqual(result.drawer, .other)
    }
}
