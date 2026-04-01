import apn from 'node-apn';
import { storage } from './storage';

export interface PushNotificationPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

let apnProvider: apn.Provider | null = null;

function getApnProvider(): apn.Provider | null {
  if (apnProvider) return apnProvider;

  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const key = process.env.APNS_AUTH_KEY;
  const bundleId = 'com.dbrief.app';

  if (!keyId || !teamId || !key) {
    return null;
  }

  try {
    // TestFlight builds use the APNs SANDBOX endpoint.
    // Set APNS_PRODUCTION=true in secrets only when you ship to the App Store.
    const useProduction = process.env.APNS_PRODUCTION === 'true';
    console.log(`[APNs] Initialising provider — environment: ${useProduction ? 'production' : 'sandbox'}`);
    const token: apn.ProviderOptions = {
      token: {
        key: Buffer.from(key.replace(/\\n/g, '\n'), 'utf8'),
        keyId,
        teamId,
      },
      production: useProduction,
    };
    apnProvider = new apn.Provider(token);
    console.log('[APNs] Provider initialised successfully');
    return apnProvider;
  } catch (err) {
    console.error('[APNs] Failed to initialise provider:', err);
    return null;
  }
}

export async function sendApnsNotification(
  deviceToken: string,
  payload: PushNotificationPayload
): Promise<boolean> {
  const provider = getApnProvider();
  if (!provider) {
    console.log('[APNs] Provider not configured — skipping APNs notification');
    return false;
  }

  const note = new apn.Notification();
  note.expiry = Math.floor(Date.now() / 1000) + 3600;
  note.badge = 1;
  note.sound = 'default';
  note.alert = { title: payload.title, body: payload.body };
  note.topic = 'com.dbrief.app';
  if (payload.url) {
    note.payload = { url: payload.url };
  }

  try {
    const result = await provider.send(note, deviceToken);
    if (result.failed.length > 0) {
      const failure = result.failed[0];
      console.error('[APNs] Send failed:', failure.error || failure.response);
      if (failure.response?.reason === 'BadDeviceToken' || failure.response?.reason === 'Unregistered') {
        await storage.deleteApnsToken(deviceToken);
      }
      return false;
    }
    return true;
  } catch (err) {
    console.error('[APNs] Send error:', err);
    return false;
  }
}

export function isApnsConfigured(): boolean {
  return !!(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_AUTH_KEY);
}
