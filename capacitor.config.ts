import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dbrief.app',
  appName: 'DBrief',
  webDir: 'dist/public',
  server: {
    // Load directly from the production server so all API calls are same-origin.
    // This bypasses Capacitor's asset bridge entirely and avoids all CORS /
    // URL-rewriting issues on Android.  The local web assets are still bundled
    // in the APK as a fallback but the WebView will load from this URL.
    url: 'https://dbrief.replit.app',
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
