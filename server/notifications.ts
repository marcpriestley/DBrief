import webPush from 'web-push';
import cron from 'node-cron';
import { storage } from './storage';

// Track last reminder sent date per user (in-memory, resets on server restart)
const lastReminderSentDate = new Map<number, string>();

// Check if VAPID keys are configured and valid
let isNotificationsEnabled = !!(
  process.env.VAPID_EMAIL &&
  process.env.VAPID_PUBLIC_KEY &&
  process.env.VAPID_PRIVATE_KEY
);

// Configure web-push with VAPID keys if available
if (isNotificationsEnabled) {
  try {
    webPush.setVapidDetails(
      `mailto:${process.env.VAPID_EMAIL}`,
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    );
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
  
  // Get all users with notifications enabled who have subscriptions
  const allUsers = await storage.getAllUsersForReminder(""); // Get all users regardless of time
  
  console.log(`[Daily Reminders] Checking ${allUsers.length} users with active subscriptions`);
  
  for (const user of allUsers) {
    // Skip if user has no reminder time set
    if (!user.reminderTime || !user.timezone) continue;
    
    try {
      // Get current date and time in user's timezone
      const userDateStr = now.toLocaleDateString('en-CA', { timeZone: user.timezone }); // YYYY-MM-DD format
      const userTimeStr = now.toLocaleString('en-US', {
        timeZone: user.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      
      // Check if we already sent a reminder today (prevents DST duplicate sends)
      const lastSent = lastReminderSentDate.get(user.id);
      if (lastSent === userDateStr) {
        continue; // Already sent today
      }
      
      // Parse current time in user's timezone (format: "HH:MM" or "HH:MM:SS")
      const [currentHourStr, currentMinuteStr] = userTimeStr.split(':');
      const currentHour = parseInt(currentHourStr, 10);
      const currentMinute = parseInt(currentMinuteStr, 10);
      
      // Parse user's reminder time
      const [reminderHour, reminderMinute] = user.reminderTime.split(':').map(Number);
      
      // Check if current time in user's timezone matches their reminder time
      if (reminderHour === currentHour && reminderMinute === currentMinute) {
        console.log(`[Daily Reminders] Sending reminder to user ${user.id} at ${user.reminderTime} ${user.timezone}`);
      
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
          console.log(`✓ Sent reminder to user ${user.id}`);
        }
      }
      
      // Mark as sent for today to prevent DST duplicates
      lastReminderSentDate.set(user.id, userDateStr);
    }
    } catch (error) {
      console.error(`[Daily Reminders] Error processing user ${user.id}:`, error);
      // Continue to next user even if this one fails
    }
  }
}

// Schedule daily reminders to run every minute (checks if any user's reminder time matches)
export function startNotificationScheduler() {
  if (!isNotificationsEnabled) {
    console.log('[Notification Scheduler] Disabled - VAPID keys not configured');
    return;
  }

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
