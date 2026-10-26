import type { CapacitorConfig } from '@capacitor/cli';

// The iOS app (and Android later) wraps the same web app: `npm run build:app` builds it into
// dist-app with relative paths, and the station data comes from the published site.
const config: CapacitorConfig = {
  appId: 'io.github.zboule.abudhabioutside',
  appName: 'Abu Dhabi Outside',
  webDir: 'dist-app',
};

export default config;
