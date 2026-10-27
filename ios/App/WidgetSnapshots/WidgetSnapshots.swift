import SwiftUI
import XCTest

// Renders the widget faces from a saved feed (sample-feed.json) at a few moments of its first
// day, light and dark, into PNGs for review: SNAPSHOT_DIR (the CI job sets it). ImageRenderer
// isn't a real widget host, so sizes and the background are set here: close, not exact.
// Also checks the logic the faces rely on.

@MainActor
final class WidgetSnapshots: XCTestCase {
    private func feed() throws -> Feed {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sample-feed", withExtension: "json"))
        return try XCTUnwrap(Feed.decode(Data(contentsOf: url)))
    }

    /// The sample feed with made-up bad air, to render every hazard: smog 15-16, dust 17-18,
    /// and smog on 11 (strong UV there too, so both).
    private func hazardFeed() throws -> Feed {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sample-feed", withExtension: "json"))
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        var profiles = try XCTUnwrap(json["profiles"] as? [String: Any])
        for name in ["kids", "adults"] {
            var p = try XCTUnwrap(profiles[name] as? [String: Any])
            var hours = try XCTUnwrap(p["hours"] as? [[String: Any]])
            for (i, var h) in hours.enumerated() where i < 24 {
                if [11, 15, 16].contains(i) { h["badAir"] = "smog"; h["air"] = "bad"; h["verdict"] = "bad" }
                if [17, 18].contains(i) { h["badAir"] = "dust"; h["air"] = "bad"; h["verdict"] = "bad" }
                hours[i] = h
            }
            p["hours"] = hours
            profiles[name] = p
        }
        json["profiles"] = profiles
        return try XCTUnwrap(Feed.decode(JSONSerialization.data(withJSONObject: json)))
    }

    private func at(_ feed: Feed, hour: Int) -> Date {
        let day = feed.profiles["kids"]!.hours[0].day
        return Dubai.date(of: "\(day)T\(String(format: "%02d", hour)):20+04:00")!
    }

    func testLogic() throws {
        let feed = try feed()
        let kids = feed.profiles["kids"]!.hours
        XCTAssertEqual(kids.count, 72)
        // every hour has a snapshot, and the window it reports is never in the past
        for h in 0..<24 {
            let s = Snapshot.make(feed: feed, settings: WidgetSettings(), at: at(feed, hour: h))
            XCTAssertEqual(s.now?.hour, h)
            if let w = s.window, w.day == kids[0].day { XCTAssertGreaterThan(w.to, h) }
        }
        // day hours: before the first hour there is no verdict, and windows stay inside them
        var narrow = WidgetSettings()
        narrow.dayFrom = 7
        narrow.dayTo = 20
        let early = Snapshot.make(feed: feed, settings: narrow, at: at(feed, hour: 5))
        XCTAssertEqual(early.phase, .beforeDay)
        if let w = early.window { XCTAssertGreaterThanOrEqual(w.from, 7); XCTAssertLessThanOrEqual(w.to, 21) }
        XCTAssertEqual(early.today.first?.hour, 7)
        XCTAssertEqual(early.today.last?.hour, 20)
        // no em dash anywhere a widget writes
        for h in 0..<24 {
            let s = Snapshot.make(feed: feed, settings: narrow, at: at(feed, hour: h))
            for t in [s.status, s.subline, s.ringLine] { XCTAssertFalse(t.contains("\u{2014}"), t) }
        }
        XCTAssertEqual(Snapshot.short("hot, feels 38°, UV 8.1"), "Hot, UV 8.1")
        // the clock's marks reach the widget: every day hour has its heat colour
        XCTAssertTrue(kids.filter { !$0.night }.allSatisfy { $0.heatColor != nil })
    }

    func testRender() throws {
        guard let dir = ProcessInfo.processInfo.environment["SNAPSHOT_DIR"] else { throw XCTSkip("SNAPSHOT_DIR not set") }
        let out = URL(fileURLWithPath: dir)
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        let feed = try feed()
        var adults = WidgetSettings()
        adults.kids = false
        var day = WidgetSettings()
        day.dayFrom = 7
        day.dayTo = 21

        let cases: [(String, WidgetSettings, Int)] = [
            ("kids-07h", WidgetSettings(), 7),
            ("kids-11h", WidgetSettings(), 11),
            ("kids-14h", WidgetSettings(), 14),
            ("kids-19h", WidgetSettings(), 19),
            ("adults-10h", adults, 10),
            ("day7-21-23h", day, 23),
        ]
        let hazards = try hazardFeed()
        for (name, settings, hour) in cases + [("hazards-14h", WidgetSettings(), 14)] {
            // the feed is from the past: render as if it were fresh
            let f = name.hasPrefix("hazards") ? hazards : feed
            var s = Snapshot.make(feed: f, settings: settings, at: at(f, hour: hour))
            s = Snapshot(now: s.now, phase: s.phase, today: s.today, wholeDay: s.wholeDay, nowHour: s.nowHour, window: s.window,
                         inWindow: s.inWindow, windowDay: s.windowDay, settings: s.settings, stale: false, updated: s.updated)
            for scheme in [ColorScheme.light, .dark] {
                let tag = "\(name)-\(scheme == .dark ? "dark" : "light")"
                try save(SmallFace(s: s), CGSize(width: 170, height: 170), scheme, out.appendingPathComponent("small-\(tag).png"))
                try save(MediumFace(s: s), CGSize(width: 364, height: 170), scheme, out.appendingPathComponent("medium-\(tag).png"))
            }
            try save(RectangularFace(s: s), CGSize(width: 172, height: 76), .dark, out.appendingPathComponent("lock-rect-\(name).png"), lock: true)
            try save(CircularFace(s: s), CGSize(width: 76, height: 76), .dark, out.appendingPathComponent("lock-circle-\(name).png"), lock: true)
            try save(InlineFace(s: s), CGSize(width: 300, height: 26), .dark, out.appendingPathComponent("lock-inline-\(name).png"), lock: true)
        }
    }

    private func save<V: View>(_ face: V, _ size: CGSize, _ scheme: ColorScheme, _ url: URL, lock: Bool = false) throws {
        let view = face
            .padding(lock ? 4 : 16)
            .frame(width: size.width, height: size.height)
            .background(lock ? Color.black : Color(.systemBackground))
            .foregroundStyle(lock ? Color.white : Color.primary)
            .clipShape(RoundedRectangle(cornerRadius: lock ? 12 : 22, style: .continuous))
            .environment(\.colorScheme, scheme)
        let r = ImageRenderer(content: view)
        r.scale = 3
        let png = try XCTUnwrap(r.uiImage?.pngData())
        try png.write(to: url)
    }
}
