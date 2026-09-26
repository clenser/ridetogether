import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ridetogether.app',
  appName: 'RideTogether',
  webDir: 'dist',
  // The WebView serves the local `dist` folder over this scheme, which is why the
  // shell's origin is `https://localhost` on Android and `capacitor://localhost`
  // on iOS. Native OAuth must never build a redirect from that origin - it is a
  // local scheme with nothing listening on it. Keep in step with `SHELL_ORIGINS`
  // in src/services/nativeAuth.ts, and with the `custom_url_scheme` value in the
  // Android manifest, which must also read `com.ridetogether.app`.
  server: {
    androidScheme: 'https'
  }
};

export default config;
