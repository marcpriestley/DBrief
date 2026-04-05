import webPush from 'web-push';
import cron from 'node-cron';
import { storage } from './storage';
import { sendApnsNotification } from './apns';

// Per-user, per-slot, per-date deduplication — prevents duplicate sends within
// a single server process lifetime and across the 5-minute delivery window.
const lastReminderSentDate = new Map<string, string>();
const lastMoodReminderSent = new Map<string, boolean>();

const MOOD_CHECKIN_TIMES = [
  { hour: 8,  minute: 0, label: "morning",   title: "Good Morning!",      body: "How are you feeling this morning? Take a moment to check in." },
  { hour: 13, minute: 0, label: "afternoon",  title: "Afternoon Check-in", body: "How's your afternoon going? Log your mood." },
  { hour: 21, minute: 0, label: "evening",    title: "Evening Reflection", body: "How was your day? Take a moment to reflect on your mood." },
];

// Notifications window: fire if current time is within this many minutes AFTER
// the scheduled time. Protects against server restarts near the reminder time.
const DELIVERY_WINDOW_MINUTES = 5;

// Mood check-ins use a wider window (30 min) so restarts during the 1pm/9pm slot
// don't cause the reminder to be silently dropped.
const MOOD_DELIVERY_WINDOW_MINUTES = 30;

// ─── VAPID / Web Push setup ────────────────────────────────────────────────

let isNotificationsEnabled = !!(
  process.env.VAPID_EMAIL &&
  process.env.VAPID_PUBLIC_KEY &&
  process.env.VAPID_PRIVATE_KEY
);

let currentVapidPublicKey = '';

if (isNotificationsEnabled) {
  try {
    const vapidEmail = process.env.VAPID_EMAIL!.startsWith('mailto:')
      ? process.env.VAPID_EMAIL!
      : `mailto:${process.env.VAPID_EMAIL}`;
    const vapidPublicKey  = process.env.VAPID_PUBLIC_KEY!.replace(/[^A-Za-z0-9_\-]/g, '');
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY!.replace(/[^A-Za-z0-9_\-]/g, '');
    console.log(`[Notifications] VAPID public key length: ${vapidPublicKey.length}`);

    if (vapidPublicKey.length !== 87) {
      console.log(`[Notifications] VAPID key invalid length (${vapidPublicKey.length}), generating fresh keys...`);
      const freshKeys = webPush.generateVAPIDKeys();
      webPush.setVapidDetails(vapidEmail, freshKeys.publicKey, freshKeys.privateKey);
      currentVapidPublicKey = freshKeys.publicKey;
      console.log(`[Notifications] Fresh keys generated — update VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY secrets.`);
    } else {
      webPush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey);
      currentVapidPublicKey = vapidPublicKey;
    }
    console.log('[Notifications] VAPID keys configured successfully');
  } catch (error) {
    console.error('[Notifications] Failed to configure VAPID keys:', error);
    isNotificationsEnabled = false;
  }
} else {
  console.log('[Notifications] VAPID keys not configured — web push disabled');
}

export function getVapidPublicKey(): string {
  return currentVapidPublicKey;
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  url?: string;
  tag?: string;
}

// ─── Send helpers ──────────────────────────────────────────────────────────

export async function sendPushNotification(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: PushNotificationPayload
): Promise<boolean> {
  if (!isNotificationsEnabled) return false;

  try {
    await webPush.sendNotification(
      { endpoint: subscription.endpoint, keys: subscription.keys },
      JSON.stringify(payload)
    );
    return true;
  } catch (error: any) {
    console.error('[Push] Send error:', error?.statusCode, error?.message);
    if (error.statusCode === 410) {
      await storage.deletePushSubscription(subscription.endpoint);
    }
    return false;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Returns true if the scheduled reminder time falls within the delivery window
 * ending at `now` (i.e., now is 0–DELIVERY_WINDOW_MINUTES minutes after the
 * scheduled time). This lets the system catch up after brief server restarts.
 */
function isWithinDeliveryWindow(
  scheduledHour: number,
  scheduledMinute: number,
  currentHour: number,
  currentMinute: number,
  windowMinutes: number = DELIVERY_WINDOW_MINUTES
): boolean {
  const scheduledTotalMinutes = scheduledHour * 60 + scheduledMinute;
  const currentTotalMinutes   = currentHour   * 60 + currentMinute;
  const diff = currentTotalMinutes - scheduledTotalMinutes;
  return diff >= 0 && diff < windowMinutes;
}

export async function dispatchToUser(
  subscriptions: Array<{ apnsToken?: string | null; endpoint: string; p256dh: string; auth: string }>,
  payload: PushNotificationPayload
) {
  return dispatchToSubscriptions(subscriptions, payload);
}

async function dispatchToSubscriptions(
  subscriptions: Array<{ apnsToken?: string | null; endpoint: string; p256dh: string; auth: string }>,
  payload: PushNotificationPayload
) {
  for (const sub of subscriptions) {
    if (sub.apnsToken) {
      await sendApnsNotification(sub.apnsToken, payload);
    } else {
      await sendPushNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
    }
  }
}

// ─── Daily reminders ────────────────────────────────────────────────────────

export async function sendDailyReminders() {
  const now = new Date();
  const allUsers = await storage.getAllUsersForReminder("");

  for (const user of allUsers) {
    if (!user.timezone || !user.notificationsEnabled) continue;

    try {
      const userDateStr = now.toLocaleDateString('en-CA', { timeZone: user.timezone });
      const userTimeStr = now.toLocaleString('en-US', {
        timeZone: user.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });

      const [currentHourStr, currentMinuteStr] = userTimeStr.split(':');
      const currentHour   = parseInt(currentHourStr, 10);
      const currentMinute = parseInt(currentMinuteStr, 10);

      const reminderTimes = [
        { time: user.reminderTime  || "09:00", slot: "1" },
        { time: user.reminderTime2 || "21:00", slot: "2" },
      ];

      for (const reminder of reminderTimes) {
        // Skip if already sent today for this slot
        const key = `${user.id}-${reminder.slot}`;
        if (lastReminderSentDate.get(key) === userDateStr) continue;

        const [reminderHour, reminderMinute] = reminder.time.split(':').map(Number);

        if (!isWithinDeliveryWindow(reminderHour, reminderMinute, currentHour, currentMinute)) continue;

        const isMorning = reminderHour < 14;
        const payload: PushNotificationPayload = {
          title: isMorning ? '☀️ Morning Check-in' : '🔥 Evening Reminder',
          body:  isMorning
            ? 'Start your day right — set your goals and log how you feel.'
            : 'Time to log your scores and continue your streak!',
          icon: '/icon-192.png',
          url:  '/',
          tag:  `daily-reminder-${user.id}-${reminder.slot}`,
        };

        console.log(`[Daily Reminders] Sending slot ${reminder.slot} to user ${user.id} (${user.timezone}, ${reminder.time})`);
        await dispatchToSubscriptions(user.subscriptions, payload);
        lastReminderSentDate.set(key, userDateStr);
      }
    } catch (error) {
      console.error(`[Daily Reminders] Error processing user ${user.id}:`, error);
    }
  }
}

// ─── Mood check-in reminders ────────────────────────────────────────────────

export async function sendMoodCheckinReminders() {
  const now = new Date();
  const allUsers = await storage.getAllUsersForReminder("");

  for (const user of allUsers) {
    if (!user.timezone || !user.notificationsEnabled || user.moodRemindersEnabled === false) continue;

    try {
      const userDateStr = now.toLocaleDateString('en-CA', { timeZone: user.timezone });
      const userTimeStr = now.toLocaleString('en-US', {
        timeZone: user.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });

      const [currentHourStr, currentMinuteStr] = userTimeStr.split(':');
      const currentHour   = parseInt(currentHourStr, 10);
      const currentMinute = parseInt(currentMinuteStr, 10);

      for (const checkinTime of MOOD_CHECKIN_TIMES) {
        if (!isWithinDeliveryWindow(checkinTime.hour, checkinTime.minute, currentHour, currentMinute, MOOD_DELIVERY_WINDOW_MINUTES)) continue;

        const key = `mood_sent_${user.id}_${userDateStr}_${checkinTime.label}`;
        // Check in-memory cache first (fast), then DB (survives server restarts)
        if (lastMoodReminderSent.get(key)) continue;
        const alreadySentInDb = await storage.getServerConfig(key);
        if (alreadySentInDb) { lastMoodReminderSent.set(key, true); continue; }

        const payload: PushNotificationPayload = {
          title: checkinTime.title,
          body:  checkinTime.body,
          icon:  '/icon-192.png',
          url:   '/dashboard?mood=checkin',
          tag:   `mood-${checkinTime.label}-${user.id}`,
          category: 'MOOD_CHECKIN',
        };

        console.log(`[Mood Reminders] Sending ${checkinTime.label} check-in to user ${user.id}`);
        await dispatchToSubscriptions(user.subscriptions, payload);
        // Persist dedup to DB so a server restart doesn't re-send
        await storage.setServerConfig(key, '1');
        lastMoodReminderSent.set(key, true);
      }
    } catch (error) {
      console.error(`[Mood Reminders] Error processing user ${user.id}:`, error);
    }
  }
}

// ─── Habit reminders ────────────────────────────────────────────────────────

const lastHabitReminderSent = new Map<string, string>();

export async function sendHabitReminders() {
  const now = new Date();
  const habitsForReminder = await storage.getAllHabitsForReminder();

  for (const habit of habitsForReminder) {
    if (!habit.reminderTime || !habit.user.timezone) continue;

    try {
      const userDateStr = now.toLocaleDateString('en-CA', { timeZone: habit.user.timezone });
      const userTimeStr = now.toLocaleString('en-US', {
        timeZone: habit.user.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });

      const [currentHourStr, currentMinuteStr] = userTimeStr.split(':');
      const currentHour   = parseInt(currentHourStr, 10);
      const currentMinute = parseInt(currentMinuteStr, 10);
      const [reminderHour, reminderMinute] = habit.reminderTime.split(':').map(Number);

      if (!isWithinDeliveryWindow(reminderHour, reminderMinute, currentHour, currentMinute)) continue;

      const key = `habit-${habit.id}-${userDateStr}`;
      if (lastHabitReminderSent.get(key)) continue;

      const anchor = habit.anchorHabit ? ` After ${habit.anchorHabit}, it's time to` : " Time to";
      const payload: PushNotificationPayload = {
        title: `${habit.emoji} Habit Check-in`,
        body: `${anchor} ${habit.name.toLowerCase()}.${habit.currentStreak && habit.currentStreak > 0 ? ` Keep your ${habit.currentStreak}-day streak alive!` : ""}`,
        icon: '/icon-192.png',
        url: '/',
        tag: `habit-${habit.id}`,
      };

      console.log(`[Habit Reminders] Sending reminder for "${habit.name}" to user ${habit.userId}`);
      await dispatchToSubscriptions(habit.subscriptions, payload);
      lastHabitReminderSent.set(key, userDateStr);
    } catch (error) {
      console.error(`[Habit Reminders] Error for habit ${habit.id}:`, error);
    }
  }
}

// ─── Scheduler ──────────────────────────────────────────────────────────────

export function startNotificationScheduler() {
  if (!isNotificationsEnabled) {
    console.log('[Notification Scheduler] Disabled — VAPID keys not configured');
    return;
  }

  cron.schedule('* * * * *', async () => {
    try {
      await sendDailyReminders();
      await sendMoodCheckinReminders();
      await sendHabitReminders();
    } catch (error) {
      console.error('[Scheduler] Error:', error);
    }
  });

  console.log('[Notification Scheduler] Started — checking every minute for due reminders');
}
