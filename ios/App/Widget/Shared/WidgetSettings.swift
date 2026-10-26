import Foundation

/// What the app shares with its widgets: the web app's settings, pushed by WidgetSettingsPlugin
/// and read by the widget. Keys and defaults: contract/widget-settings.json (defaults match the web app).
struct WidgetSettings: Equatable {
    static let appGroup = "group.io.github.zboule.abudhabioutside"

    var kids = true
    var pool = true
    var dayFrom = 0
    var dayTo = 23

    static var store: UserDefaults? { UserDefaults(suiteName: appGroup) }

    static func load() -> WidgetSettings {
        var s = WidgetSettings()
        guard let d = store else { return s }
        if d.object(forKey: "kids") != nil { s.kids = d.bool(forKey: "kids") }
        if d.object(forKey: "pool") != nil { s.pool = d.bool(forKey: "pool") }
        if d.object(forKey: "dayFrom") != nil, d.object(forKey: "dayTo") != nil {
            let from = d.integer(forKey: "dayFrom"), to = d.integer(forKey: "dayTo")
            if 0 <= from, from <= to, to <= 23 { s.dayFrom = from; s.dayTo = to }
        }
        return s
    }

    func save() {
        guard let d = Self.store else { return }
        d.set(kids, forKey: "kids")
        d.set(pool, forKey: "pool")
        d.set(dayFrom, forKey: "dayFrom")
        d.set(dayTo, forKey: "dayTo")
    }
}
