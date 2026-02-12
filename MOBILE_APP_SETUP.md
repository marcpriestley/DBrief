# DBrief - Mobile App Setup Guide

## Prerequisites

To build the iOS app and submit to the App Store, you'll need:

1. **A Mac** with macOS 13 (Ventura) or later
2. **Xcode 15+** installed from the Mac App Store
3. **Apple Developer Account** ($99/year) - https://developer.apple.com
4. **Node.js 18+** installed on your Mac
5. **CocoaPods** - install with: `sudo gem install cocoapods`

## Step-by-Step Setup

### 1. Clone or Download the Project

Download this project to your Mac.

### 2. Install Dependencies

```bash
npm install
```

### 3. Build the Web App

```bash
npm run build
```

This creates the production web files in `dist/public/`.

### 4. Add the iOS Platform

```bash
npx cap add ios
```

This creates the `ios/` folder with the native Xcode project.

### 5. Sync Web Assets to iOS

```bash
npx cap sync ios
```

This copies your built web app into the native iOS project and installs any native plugins.

### 6. Open in Xcode

```bash
npx cap open ios
```

This opens the Xcode project. From here you can:
- Set your **Team** (Apple Developer account) in Signing & Capabilities
- Set your **Bundle Identifier** (e.g., `com.yourname.dbrief`)
- Configure app icons (drag your icon into the Assets catalog)
- Run on a simulator or connected device

### 7. Configure Your Backend URL

Since the app talks to your backend API, you need to update the server URL.
Edit `capacitor.config.ts` and add your production server URL:

```typescript
server: {
  url: 'https://your-app.replit.app',
  cleartext: false,
}
```

Then run `npx cap sync ios` again to apply changes.

### 8. Test on a Device

- Connect your iPhone via USB
- Select it as the build target in Xcode
- Click the Play button to build and run

### 9. Submit to App Store

1. In Xcode, select **Product > Archive**
2. Once archived, click **Distribute App**
3. Choose **App Store Connect**
4. Follow the prompts to upload
5. Go to https://appstoreconnect.apple.com to:
   - Fill in app metadata (description, screenshots, pricing)
   - Submit for review

## Updating the App

Whenever you make changes to the web app:

```bash
npm run build
npx cap sync ios
```

Then rebuild in Xcode.

## Android (Google Play)

The project is also configured for Android. To build:

```bash
npx cap add android
npx cap sync android
npx cap open android
```

This opens Android Studio where you can build and publish to Google Play.

## App Icon

App icons are included at `public/icons/`. For the App Store, you'll need a 1024x1024 icon.
Use the existing icon-512.png as a base and upscale it, or create a new one at the required size.

## Important Notes

- The app uses a web view (WKWebView on iOS) to render your web app natively
- Push notifications will need the Apple Push Notification service (APNs) certificate configured in your Apple Developer account
- The Capacitor Splash Screen plugin is configured to show a brief splash on launch
