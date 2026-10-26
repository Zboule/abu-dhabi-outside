import Capacitor

/// Capacitor's web view, with the app's own native plugin registered.
class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(WidgetSettingsPlugin())
    }
}
