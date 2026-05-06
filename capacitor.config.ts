import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dbrief.app',
  appName: 'DBrief',
  webDir: 'dist/public',
  // server.url points the native WebView at the deployed server for both iOS
  // and Android.  This is required on Android because the WebView intercepts
  // ALL requests to the configured hostname (including /api/* calls) and tries
  // to serve them from the bundle — returning the SPA's index.html instead of
  // JSON.  iOS's WKWebView lets non-file requests fall through to the network,
  // so it happened to work there, but Android does not.  With server.url set,
  // the WebView loads the real deployed app and all relative API paths resolve
  // correctly to the production server.
  server: {
    url: 'https://dbrief.replit.app',
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
