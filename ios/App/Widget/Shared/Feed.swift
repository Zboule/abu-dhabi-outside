import Foundation

// The feed the widgets draw: data/widget/v1.json, made by scripts/widget_feed.mts with the
// same rating code as the page. Shape: contract/widget-feed.v1.schema.json. The widget only
// reads it; the one thing it works out itself is the good windows within the user's day hours.

enum Level: String, Codable {
    case good, ok, bad, na
}

struct FeedHour: Codable, Equatable {
    let time: String // Dubai wall clock with offset, "2026-10-26T14:00+04:00"
    let night: Bool
    let verdict: Level
    let heat: Level
    let uv: Level
    let air: Level
    let pool: Level
    let temp: Double?
    let feels: Double?
    let uvIndex: Double?
    let airIndex: Double?
    let pollution: Double?
    let dust: Double?
    let airSource: String
    let reason: String

    var day: String { String(time.prefix(10)) }
    var hour: Int { Int(time.dropFirst(11).prefix(2)) ?? 0 }
}

struct FeedProfile: Codable {
    let hours: [FeedHour]
}

struct Feed: Codable {
    let schemaVersion: Int
    let generatedAt: String
    let lastMeasuredAir: String?
    let site: String
    let profiles: [String: FeedProfile]

    static let url = URL(string: "https://zboule.github.io/abu-dhabi-outside/data/widget/v1.json")!

    var generated: Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: generatedAt) ?? ISO8601DateFormatter().date(from: generatedAt)
    }

    static func decode(_ data: Data) -> Feed? {
        guard let feed = try? JSONDecoder().decode(Feed.self, from: data), feed.schemaVersion == 1 else { return nil }
        return feed
    }
}

/// Abu Dhabi time, whatever zone the phone is in (no daylight saving: always +04:00).
enum Dubai {
    static let zone = TimeZone(identifier: "Asia/Dubai")!
    static var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = zone
        return c
    }

    /// The feed key of the hour a date falls in.
    static func hourKey(_ date: Date) -> String {
        let c = calendar.dateComponents([.year, .month, .day, .hour], from: date)
        return String(format: "%04d-%02d-%02dT%02d:00+04:00", c.year!, c.month!, c.day!, c.hour!)
    }

    static func startOfHour(_ date: Date) -> Date {
        calendar.dateInterval(of: .hour, for: date)!.start
    }

    static func date(of key: String) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd'T'HH:mmXXXXX"
        return f.date(from: key)
    }
}

func hh(_ h: Int) -> String { String(format: "%02d:00", h % 24) }

/// The end of a window: "midnight" rather than "00:00".
func until(_ h: Int) -> String { h % 24 == 0 ? "midnight" : hh(h) }

/// A run of hours rated OK or better, within the day hours. `to` is the exclusive end hour.
struct Window: Equatable {
    let day: String
    let from: Int
    let to: Int
    let level: Level // good when every hour is good, else ok

    var text: String { "\(hh(from))-\(until(to))" }
}

/// What a widget shows at one moment.
struct Snapshot {
    enum Phase { case inDay, beforeDay, afterDay }

    let now: FeedHour?
    let phase: Phase
    let today: [FeedHour] // today's hours within the day hours, in order
    let nowHour: Int
    let window: Window? // the window we're in, or the next one
    let inWindow: Bool
    let windowDay: String // "", "Tomorrow", or a weekday
    let settings: WidgetSettings
    let stale: Bool
    let updated: Date?

    static func make(feed: Feed?, settings: WidgetSettings, at date: Date) -> Snapshot {
        let key = Dubai.hourKey(date)
        let nowHour = Int(key.dropFirst(11).prefix(2)) ?? 0
        let todayKey = String(key.prefix(10))
        let hours = feed?.profiles[settings.kids ? "kids" : "adults"]?.hours ?? []
        let inDayHours = hours.filter { settings.dayFrom <= $0.hour && $0.hour <= settings.dayTo }
        let now = hours.first { $0.time == key }
        let phase: Phase = nowHour < settings.dayFrom ? .beforeDay : nowHour > settings.dayTo ? .afterDay : .inDay

        // windows from the hourly verdicts (the feed's own are for the full day)
        var windows: [Window] = []
        for h in inDayHours where h.verdict == .good || h.verdict == .ok {
            if let last = windows.last, last.day == h.day, last.to == h.hour {
                windows[windows.count - 1] = Window(day: h.day, from: last.from, to: h.hour + 1,
                                                    level: last.level == .good && h.verdict == .good ? .good : .ok)
            } else {
                windows.append(Window(day: h.day, from: h.hour, to: h.hour + 1, level: h.verdict))
            }
        }
        let current = windows.first { $0.day == todayKey && $0.from <= nowHour && nowHour < $0.to && phase == .inDay }
        let next = current ?? windows.first { $0.day > todayKey || ($0.day == todayKey && $0.from > nowHour) }

        var label = ""
        if let w = next, w.day != todayKey {
            if let d = Dubai.date(of: "\(w.day)T12:00+04:00"), let t = Dubai.date(of: "\(todayKey)T12:00+04:00") {
                let days = Dubai.calendar.dateComponents([.day], from: t, to: d).day ?? 0
                if days == 1 { label = "Tomorrow" } else {
                    let f = DateFormatter()
                    f.locale = Locale(identifier: "en_GB")
                    f.timeZone = Dubai.zone
                    f.dateFormat = "EEEE"
                    label = f.string(from: d)
                }
            }
        }

        let updated = feed?.generated
        let stale = updated.map { date.timeIntervalSince($0) > 6 * 3600 } ?? true
        return Snapshot(now: now, phase: phase, today: inDayHours.filter { $0.day == todayKey }, nowHour: nowHour,
                        window: next, inWindow: current != nil, windowDay: label, settings: settings,
                        stale: stale, updated: updated)
    }

    // ---- words ----

    /// The big word: Good / OK / Avoid, or why there's none.
    var status: String {
        if phase != .inDay { return phase == .beforeDay ? "Too early" : "Day's over" }
        switch now?.verdict {
        case .good: return "Good"
        case .ok: return "OK"
        case .bad: return "Avoid"
        default: return "No data"
        }
    }

    var statusLevel: Level { phase == .inDay ? now?.verdict ?? .na : .na }

    /// A few words under the status: how long it lasts, or why not.
    var detail: String {
        if phase == .inDay, let n = now {
            if inWindow, let w = window { return "until \(until(w.to))" }
            if n.verdict == .bad, !n.reason.isEmpty { return Self.short(n.reason) }
        }
        return ""
    }

    /// The window line: "Next good 17:00-21:00" / "Tomorrow 06:00-09:00".
    var windowLine: String? {
        guard let w = window, !inWindow else { return nil }
        let word = w.level == .good ? "good" : "OK"
        return windowDay.isEmpty ? "Next \(word) \(w.text)" : "\(windowDay) \(w.text)"
    }

    var noWindow: Bool { window == nil }

    /// "hot, feels 38°, UV 8.1" -> "Hot, UV 8.1": the reason trimmed to fit a widget.
    static func short(_ reason: String) -> String {
        let parts = reason.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        let kept = parts.compactMap { p -> String? in
            if p.hasPrefix("feels") { return nil }
            if p.hasPrefix("hot") { return "Hot" }
            if p.hasPrefix("pollution") { return "Polluted air" }
            if p.hasPrefix("dust") { return "Dust" }
            return p
        }
        return kept.joined(separator: ", ")
    }

    var feels: String? { now?.feels.map { "Feels \(Int($0.rounded()))°" } }
}
