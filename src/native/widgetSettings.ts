// The phone widgets follow the app's settings: inside the iOS app, every change (and the
// values at start) goes to the native WidgetSettings plugin (ios/App/App/WidgetSettingsPlugin.swift),
// which stores them where the widget reads them and redraws it. On the website this does nothing.
// Defaults and keys are in contract/widget-settings.json.
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface WidgetSettings {
  kids: boolean;
  pool: boolean;
  dayFrom: number;
  dayTo: number;
}

const plugin = registerPlugin<{ set(s: WidgetSettings): Promise<void> }>('WidgetSettings');

export function pushWidgetSettings(s: WidgetSettings) {
  if (!Capacitor.isNativePlatform()) return;
  plugin.set(s).catch(() => {
    /* an older app build without the plugin: the widget keeps its defaults */
  });
}
