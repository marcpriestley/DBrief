import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dbrief.app',
  appName: 'DBrief',
  webDir: 'dist/public',
  // No server.url — the WebView loads from https://localhost (androidScheme below).
  // queryClient.ts detects hostname === "localhost" at runtime and prepends
  // https://dbrief.replit.app to every /api/* call, sending them directly to the
  // production server without going through the Capacitor asset bridge.
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  ios: {
    preferredContentMode: 'mobile',
    backgroundColor: '#141414',
  },
  android: {
    backgroundColor: '#141414',
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    StatusBar: {
      style: 'LIGHT',
      overlaysWebView: true,
      backgroundColor: '#141414',
    },
    Keyboard: {
      resize: 'none',
    },
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#141414',
      showSpinner: false,
    },
  },
};

export default config;
