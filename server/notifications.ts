import webPush from 'web-push';
import cron from 'node-cron';
import { storage } from './storage';
import { sendApnsNotification } from './apns';

const lastReminderSentDate = new Map<string, string>();
const lastMoodReminderSent = new Map<string, boolean>();

const MOOD_CHECKIN_TIMES = [
  { hour: 8, minute: 0, label: "morning", title: "Good Morning!", body: "How are you feeling this morning? Take a moment to check in." },
  { hour: 13, minute: 0, label: "afternoon", title: "Afternoon Check-in", body: "How's your afternoon going? Log your mood." },
  { hour: 21, minute: 0, label: "evening", title: "Evening Reflection", body: "How was your day? Take a moment to reflect on your mood." },
];

// Check if VAPID keys are configured and valid
let isNotificationsEnabled = !!(
  process.env.VAPID_EMAIL &&
  process.env.VAPID_PUBLIC_KEY &&
  process.env.VAPID_PRIVATE_KEY
);

let currentVapidPublicKey = '';

// Configure web-push with VAPID keys if available
if (isNotificationsEnabled) {
  try {
    const vapidEmail = process.env.VAPID_EMAIL!.startsWith('mailto:')
      ? process.env.VAPID_EMAIL!
      : `mailto:${process.env.VAPID_EMAIL}`;
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY!.replace(/[^A-Za-z0-9_\-]/g, '');
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY!.replace(/[^A-Za-z0-9_\-]/g, '');
    console.log(`[Notifications] VAPID public key length: ${vapidPublicKey.length}`);

    if (vapidPublicKey.length !== 87) {
      console.log(`[Notifications] VAPID public key has invalid length (${vapidPublicKey.length}, expected 87). Generating fresh keys...`);
      const freshKeys = webPush.generateVAPIDKeys();
      console.log(`[Notifications] Generated fresh VAPID keys. Public key: ${freshKeys.publicKey.substring(0, 10)}...`);
      console.log(`[Notifications] To persist, update VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY secrets with:`);
      console.log(`[Notifications] PUBLIC: ${freshKeys.publicKey}`);
      console.log(`[Notifications] PRIVATE: ${freshKeys.privateKey}`);
      webPush.setVapidDetails(vapidEmail, freshKeys.publicKey, freshKeys.privateKey);
      currentVapidPublicKey = freshKeys.publicKey;
    } else {
      webPush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey);
      currentVapidPublicKey = vapidPublicKey;
    }
    console.log('[Notifications] VAPID keys configured successfully');
  } catch (error) {
    console.error('[Notifications] Failed to configure VAPID keys:', error);
    console.log('[Notifications] Push notifications will be disabled');
    isNotificationsEnabled = false; // Disable notifications if config fails
  }
} else {
  console.log('[Notifications] VAPID keys not configured - push notifications disabled');
  console.log('[Notifications] Set VAPID_EMAIL, VAPID_PUBLIC_KEY, and VAPID_PRIVATE_KEY to enable');
}

export function getVapidPublicKey(): string {
  return currentVapidPublicKey;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  url?: string;
  tag?: string;
}

export async function sendPushNotification(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: PushNotificationPayload
): Promise<boolean> {
  if (!isNotificationsEnabled) {
    console.log('[Notifications] Cannot send notification - VAPID keys not configured');
    return false;
  }

  try {
    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth
      }
    };

    await webPush.sendNotification(
      pushSubscription,
      JSON.stringify(payload)
    );

    return true;
  } catch (error: any) {
    console.error('Push notification error:', error);
    
    // If subscription is expired (410 Gone), delete it
    if (error.statusCode === 410) {
      console.log('Subscription expired, deleting:', subscription.endpoint);
      await storage.deletePushSubscription(subscription.endpoint);
    }
    
    return false;
  }
}

export async function sendDailyReminders() {
  const now = new Date();
  
  const allUsers = await storage.getAllUsersForReminder("");
  
  for (const user of allUsers) {
    if (!user.timezone) continue;
    
    try {
      const userDateStr = now.toLocaleDateString('en-CA', { timeZone: user.timezone });
      const userTimeStr = now.toLocaleString('en-US', {
        timeZone: user.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      
      const [currentHourStr, currentMinuteStr] = userTimeStr.split(':');
      const currentHour = parseInt(currentHourStr, 10);
      const currentMinute = parseInt(currentMinuteStr, 10);
      
      const reminderTimes = [
        { time: user.reminderTime || "09:00", slot: "1" },
        { time: user.reminderTime2 || "21:00", slot: "2" },
      ];

      for (const reminder of reminderTimes) {
        const key = `${user.id}-${reminder.slot}`;
        const lastSent = lastReminderSentDate.get(key);
        if (lastSent === userDateStr) continue;

        const [reminderHour, reminderMinute] = reminder.time.split(':').map(Number);
        
        if (reminderHour === currentHour && reminderMinute === currentMinute) {
          const isMorning = reminderHour < 14;
          const payload: PushNotificationPayload = {
            title: isMorning ? '☀️ Morning Check-in' : '🔥 Evening Reminder',
            body: isMorning
              ? 'Start your day right — set your goals and log how you feel.'
              : 'Time to log your scores and continue your streak!',
            icon: '/icon-192.png',
            url: '/',
            tag: `daily-reminder-${user.id}-${reminder.slot}`
          };

          for (const subscription of user.subscriptions) {
            if (subscription.apnsToken) {
              await sendApnsNotification(subscription.apnsToken, payload);
            } else {
              await sendPushNotification(
                {
                  endpoint: subscription.endpoint,
                  keys: { p256dh: subscription.p256dh, auth: subscription.auth }
                },
                payload
              );
            }
          }
          
          lastReminderSentDate.set(key, userDateStr);
        }
      }
    } catch (error) {
      console.error(`[Daily Reminders] Error processing user ${user.id}:`, error);
    }
  }
}

export async function sendMoodCheckinReminders() {
  const now = new Date();
  const allUsers = await storage.getAllUsersForReminder("");

  for (const user of allUsers) {
    if (!user.timezone || user.notificationsEnabled === false) continue;

    try {
      const userTimeStr = now.toLocaleString('en-US', {
        timeZone: user.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const userDateStr = now.toLocaleDateString('en-CA', { timeZone: user.timezone });
      const [currentHourStr, currentMinuteStr] = userTimeStr.split(':');
      const currentHour = parseInt(currentHourStr, 10);
      const currentMinute = parseInt(currentMinuteStr, 10);

      for (const checkinTime of MOOD_CHECKIN_TIMES) {
        if (checkinTime.hour === currentHour && checkinTime.minute === currentMinute) {
          const key = `${user.id}-${userDateStr}-${checkinTime.label}`;
          if (lastMoodReminderSent.get(key)) continue;

          const payload: PushNotificationPayload = {
            title: checkinTime.title,
            body: checkinTime.body,
            icon: '/icon-192.png',
            url: '/dashboard?mood=checkin',
            tag: `mood-${checkinTime.label}-${user.id}`
          };

          for (const subscription of user.subscriptions) {
            if (subscription.apnsToken) {
              await sendApnsNotification(subscription.apnsToken, payload);
            } else {
              await sendPushNotification(
                { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
                payload
              );
            }
          }

          lastMoodReminderSent.set(key, true);
        }
      }
    } catch (error) {
      console.error(`[Mood Reminders] Error processing user ${user.id}:`, error);
    }
  }
}

export function startNotificationScheduler() {
  if (!isNotificationsEnabled) {
    console.log('[Notification Scheduler] Disabled - VAPID keys not configured');
    return;
  }

  cron.schedule('* * * * *', async () => {
    try {
      await sendDailyReminders();
      await sendMoodCheckinReminders();
    } catch (error) {
      console.error('Error sending reminders:', error);
    }
  });

  console.log('[Notification Scheduler] Started - checking every minute for due reminders');
}
