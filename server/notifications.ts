import webPush from 'web-push';
import cron from 'node-cron';
import { storage } from './storage';

// Configure web-push with VAPID keys
webPush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL}`,
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

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
  // Get current time in HH:MM format for each timezone
  const now = new Date();
  const currentHour = now.getUTCHours();
  const currentMinute = now.getUTCMinutes();
  
  // Check for users with reminder time matching current UTC time
  // Note: This is a simplified version. For production, you'd want to handle timezones properly
  const timeStr = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
  
  const users = await storage.getAllUsersForReminder(timeStr);
  
  console.log(`[Daily Reminders ${timeStr}] Found ${users.length} users to notify`);
  
  for (const user of users) {
    const payload: PushNotificationPayload = {
      title: '🔥 Daily Reminder',
      body: 'Time to log your scores and continue your streak!',
      icon: '/icon-192.png',
      url: '/',
      tag: `daily-reminder-${user.id}`
    };

    for (const subscription of user.subscriptions) {
      const success = await sendPushNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth
          }
        },
        payload
      );

      if (success) {
        console.log(`Sent reminder to user ${user.id}`);
      }
    }
  }
}

// Schedule daily reminders to run every minute (checks if any user's reminder time matches)
export function startNotificationScheduler() {
  // Run every minute
  cron.schedule('* * * * *', async () => {
    try {
      await sendDailyReminders();
    } catch (error) {
      console.error('Error sending daily reminders:', error);
    }
  });

  console.log('[Notification Scheduler] Started - checking every minute for due reminders');
}
