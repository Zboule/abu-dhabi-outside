import Capacitor
import WidgetKit

/// The web app's settings, for the widgets (src/native/widgetSettings.ts calls `set` on every
/// change and at start). Stored in the App Group, then the widgets redraw.
@objc(WidgetSettingsPlugin)
public class WidgetSettingsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetSettingsPlugin"
    public let jsName = "WidgetSettings"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
    ]

    @objc func set(_ call: CAPPluginCall) {
        var s = WidgetSettings()
        s.kids = call.getBool("kids") ?? s.kids
        s.pool = call.getBool("pool") ?? s.pool
        s.dayFrom = call.getInt("dayFrom") ?? s.dayFrom
        s.dayTo = call.getInt("dayTo") ?? s.dayTo
        guard 0 <= s.dayFrom, s.dayFrom <= s.dayTo, s.dayTo <= 23 else {
            call.reject("bad day hours")
            return
        }
        if s != WidgetSettings.load() {
            s.save()
            WidgetCenter.shared.reloadAllTimelines()
        }
        call.resolve()
    }
}
