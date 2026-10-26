import SwiftUI
import WidgetKit

// One widget, every size. A fetch gives a timeline of one entry per hour for the next day, so the
// widget stays right between fetches (WidgetKit allows a few dozen a day); the last good feed is
// cached in the App Group, so a failed fetch still shows it, marked "as of" once it's old.

struct Entry: TimelineEntry {
    let date: Date
    let snapshot: Snapshot
}

struct Provider: TimelineProvider {
    private static var cacheURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: WidgetSettings.appGroup)?
            .appendingPathComponent("widget-feed.json")
    }

    private static func cached() -> Feed? {
        guard let u = cacheURL, let d = try? Data(contentsOf: u) else { return nil }
        return Feed.decode(d)
    }

    private static func fetch() async -> Feed? {
        var req = URLRequest(url: Feed.url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        req.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let feed = Feed.decode(data) else { return nil }
        if let u = cacheURL { try? data.write(to: u, options: .atomic) }
        return feed
    }

    func placeholder(in context: Context) -> Entry {
        Entry(date: .now, snapshot: .make(feed: nil, settings: WidgetSettings(), at: .now))
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        Task {
            // the gallery preview wants an answer fast: the cache first there
            var feed = context.isPreview ? Self.cached() : nil
            if feed == nil { feed = await Self.fetch() }
            if feed == nil { feed = Self.cached() }
            completion(Entry(date: .now, snapshot: .make(feed: feed, settings: .load(), at: .now)))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        Task {
            let feed = await Self.fetch() ?? Self.cached()
            let settings = WidgetSettings.load()
            let now = Date.now
            let start = Dubai.startOfHour(now)
            var entries = [Entry(date: now, snapshot: .make(feed: feed, settings: settings, at: now))]
            for i in 1...24 {
                let d = start.addingTimeInterval(Double(i) * 3600)
                entries.append(Entry(date: d, snapshot: .make(feed: feed, settings: settings, at: d)))
            }
            // the feed is rebuilt every hour; ask again in about an hour (sooner if this one failed)
            let next = now.addingTimeInterval(feed == nil ? 15 * 60 : 60 * 60)
            completion(Timeline(entries: entries, policy: .after(next)))
        }
    }
}

struct OutsideWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: Entry

    var body: some View {
        Group {
            switch family {
            case .systemMedium: MediumFace(s: entry.snapshot)
            case .accessoryRectangular: RectangularFace(s: entry.snapshot)
            case .accessoryCircular: CircularFace(s: entry.snapshot)
            case .accessoryInline: InlineFace(s: entry.snapshot)
            default: SmallFace(s: entry.snapshot)
            }
        }
        .containerBackground(for: .widget) { Color(.systemBackground) }
        .widgetURL(URL(string: "abudhabioutside://today"))
    }
}

struct OutsideWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "OutsideWidget", provider: Provider()) { entry in
            OutsideWidgetView(entry: entry)
        }
        .configurationDisplayName("Outside now")
        .description("When the kids can go out: now, and the next good time.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular, .accessoryInline])
    }
}

@main
struct OutsideWidgets: WidgetBundle {
    var body: some Widget {
        OutsideWidget()
    }
}
