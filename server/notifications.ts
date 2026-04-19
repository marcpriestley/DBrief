import webPush from 'web-push';
import cron from 'node-cron';
import { storage } from './storage';
import { sendApnsNotification } from './apns';
import { sendFcmNotification, isFcmConfigured } from './fcm';
import { generateWeeklyReport, getWeekBounds } from './weekly-report';
import { habitNotificationBody, getIntervalSlots } from '../shared/habitUtils';

// In-memory cache layer (fast-path, survives hot reloads). DB is the source of truth.
const lastReminderSentDate = new Map<string, string>(); // key → dateStr (cache only)
const lastMoodReminderSent = new Map<string, boolean>();

const MOOD_CHECKIN_TIMES = [
  { hour: 8,  minute: 0, label: "morning",   title: "Good Morning!",      body: "How are you feeling this morning? Take a moment to check in." },
  { hour: 13, minute: 0, label: "afternoon",  title: "Afternoon Check-in", body: "How's your afternoon going? Log your mood." },
  { hour: 21, minute: 0, label: "evening",    title: "Evening Reflection", body: "How was your day? Take a moment to reflect on your mood." },
];

// Notifications window: fire if current time is within this many minutes AFTER
// the scheduled time. 60 min gives the server time to restart without missing slots.
// DB-backed dedup prevents double-sends within the same window.
const DELIVERY_WINDOW_MINUTES = 60;
const MOOD_DELIVERY_WINDOW_MINUTES = 60;

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
  type?: string;
  category?: string;
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
  // Priority 1: iOS native (APNs)
  // Deduplicate and only send to the most-recently-registered token.
  const seenApns = new Set<string>();
  const apnsTokens = subscriptions
    .map(s => s.apnsToken)
    .filter((t): t is string => !!t && !seenApns.has(t) && (seenApns.add(t), true));
  if (apnsTokens.length > 0) {
    await sendApnsNotification(apnsTokens[apnsTokens.length - 1], payload);
    return;
  }

  // Priority 2: Android native (FCM)
  // FCM tokens are stored with an "fcm:" prefix on the endpoint column.
  const fcmTokens = subscriptions
    .filter(s => s.endpoint.startsWith("fcm:"))
    .map(s => s.endpoint.slice(4));
  if (fcmTokens.length > 0) {
    if (isFcmConfigured()) {
      try {
        await sendFcmNotification(fcmTokens[fcmTokens.length - 1], {
          title: payload.title,
          body: payload.body,
          data: payload.url ? { url: payload.url } : {},
        });
      } catch (err) {
        console.error("[Notifications] FCM send failed:", err);
      }
    } else {
      console.warn("[Notifications] FCM token present but Firebase not configured — skipping Android push");
    }
    return;
  }

  // Priority 3: Web Push (browser)
  for (const sub of subscriptions) {
    if (sub.endpoint.startsWith("apns:") || sub.endpoint.startsWith("fcm:")) continue;
    await sendPushNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload
    );
  }
}

// ─── Daily reminders ────────────────────────────────────────────────────────

export async function sendDailyReminders(windowMinutes = DELIVERY_WINDOW_MINUTES) {
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
        const [reminderHour, reminderMinute] = reminder.time.split(':').map(Number);
        if (!isWithinDeliveryWindow(reminderHour, reminderMinute, currentHour, currentMinute, windowMinutes)) continue;

        // Dedup key includes the date so each slot fires at most once per day.
        // In-memory cache is checked first (fast-path); DB is the authoritative store
        // that survives server restarts, preventing missed or duplicate notifications.
        const dbKey = `daily_sent_${user.id}_${userDateStr}_slot${reminder.slot}`;
        const memKey = `${user.id}-${reminder.slot}`;
        if (lastReminderSentDate.get(memKey) === userDateStr) continue;
        const alreadySentInDb = await storage.getServerConfig(dbKey);
        if (alreadySentInDb) { lastReminderSentDate.set(memKey, userDateStr); continue; }

        const isMorning = reminderHour < 14;
        const payload: PushNotificationPayload = {
          title: isMorning ? '☀️ Morning Check-in' : '🔥 Evening Reminder',
          body:  isMorning
            ? 'Start your day right — log your mood and set your intentions.'
            : 'Time to log your scores and continue your streak!',
          icon: '/icon-192.png',
          url:  isMorning ? '/?mood=checkin' : '/',
          tag:  `daily-reminder-${user.id}-${reminder.slot}`,
          ...(isMorning ? { type: 'MOOD_CHECKIN', category: 'MOOD_CHECKIN' } : {}),
        };

        console.log(`[Daily Reminders] Sending slot ${reminder.slot} to user ${user.id} (${user.timezone}, ${reminder.time})`);
        await dispatchToSubscriptions(user.subscriptions, payload);
        await storage.setServerConfig(dbKey, '1');
        lastReminderSentDate.set(memKey, userDateStr);
      }
    } catch (error) {
      console.error(`[Daily Reminders] Error processing user ${user.id}:`, error);
    }
  }
}

// ─── Mood check-in reminders ────────────────────────────────────────────────

export async function sendMoodCheckinReminders(windowMinutes = MOOD_DELIVERY_WINDOW_MINUTES) {
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
        if (!isWithinDeliveryWindow(checkinTime.hour, checkinTime.minute, currentHour, currentMinute, windowMinutes)) continue;

        const key = `mood_sent_${user.id}_${userDateStr}_${checkinTime.label}`;
        // Check in-memory cache first (fast), then DB (survives server restarts)
        if (lastMoodReminderSent.get(key)) continue;
        const alreadySentInDb = await storage.getServerConfig(key);
        if (alreadySentInDb) { lastMoodReminderSent.set(key, true); continue; }

        // Skip only if the user has already checked in during THIS period of the day.
        // morning = 0–11, afternoon = 12–17, evening = 18–23 (all in user's local time).
        const PERIOD_HOURS: Record<string, [number, number]> = {
          morning:   [0,  12],
          afternoon: [12, 18],
          evening:   [18, 24],
        };
        const [pStart, pEnd] = PERIOD_HOURS[checkinTime.label] ?? [0, 24];
        const moodLogged = await storage.hasUserLoggedMoodInPeriod(user.id, userDateStr, pStart, pEnd, user.timezone);
        if (moodLogged) {
          lastMoodReminderSent.set(key, true);
          console.log(`[Mood Reminders] Skipping ${checkinTime.label} for user ${user.id} — already checked in during this period`);
          continue;
        }

        const payload: PushNotificationPayload = {
          title: checkinTime.title,
          body:  checkinTime.body,
          icon:  '/icon-192.png',
          url:   '/dashboard?mood=checkin',
          tag:   `mood-${checkinTime.label}-${user.id}`,
          category: 'MOOD_CHECKIN',
          type:     'MOOD_CHECKIN',
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

      // Determine which time slots should fire for this habit
      const hasInterval = habit.reminderInterval && habit.reminderInterval > 0 && habit.reminderEndTime;
      const slots: string[] = hasInterval
        ? getIntervalSlots(habit.reminderTime, habit.reminderInterval!, habit.reminderEndTime!)
        : [habit.reminderTime];

      // Find a slot that matches the current delivery window
      const matchingSlot = slots.find(slot => {
        const [h, m] = slot.split(':').map(Number);
        return isWithinDeliveryWindow(h, m, currentHour, currentMinute);
      });

      if (!matchingSlot) continue;

      // Skip if the habit has already been completed today
      const alreadyDone = await storage.isHabitCompletedToday(habit.id, userDateStr);
      if (alreadyDone) {
        console.log(`[Habit Reminders] Skipping "${habit.name}" for user ${habit.userId} — already completed today`);
        continue;
      }

      // Dedup key includes the specific slot to allow multiple fires per day
      const slotKey = matchingSlot.replace(':', '');
      const key = `habit-${habit.id}-${userDateStr}-${slotKey}`;

      if (lastHabitReminderSent.get(key)) continue;
      const alreadySentInDb = await storage.getServerConfig(key);
      if (alreadySentInDb) { lastHabitReminderSent.set(key, userDateStr); continue; }

      const body = habitNotificationBody(habit.anchorHabit, habit.name, habit.currentStreak ?? 0);
      const payload: PushNotificationPayload = {
        title: `${habit.emoji} Habit Check-in`,
        body,
        icon: '/icon-192.png',
        url: '/',
        tag: `habit-${habit.id}-${slotKey}`,
      };

      console.log(`[Habit Reminders] Sending reminder for "${habit.name}" (slot ${matchingSlot}) to user ${habit.userId}`);
      await dispatchToSubscriptions(habit.subscriptions, payload);
      await storage.setServerConfig(key, '1');
      lastHabitReminderSent.set(key, userDateStr);
    } catch (error) {
      console.error(`[Habit Reminders] Error for habit ${habit.id}:`, error);
    }
  }
}

// ─── Weekly Race Report notifications ────────────────────────────────────────

async function sendWeeklyReportNotifications() {
  const now = new Date();
  // Only run on Sundays (0) between 20:00–20:29 user-local time
  // We check the server clock; per-user timezone is handled by offset comparison
  const currentDay = now.getDay(); // 0 = Sunday
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  if (currentDay !== 0) return; // Not Sunday
  if (!isWithinDeliveryWindow(20, 0, currentHour, currentMinute)) return;

  const { weekStart } = getWeekBounds();

  // Check if we've already sent this week's notification (server-wide dedup key)
  // We'll use a simple in-memory flag per weekStart
  if ((sendWeeklyReportNotifications as any)._sentWeek === weekStart) return;

  try {
    const users = await storage.getAllUsersForWeeklyReport();
    let sentCount = 0;

    for (const user of users) {
      if (!user.subscriptions || user.subscriptions.length === 0) continue;

      // Generate or retrieve the report
      const report = await generateWeeklyReport(user.id);
      if (!report) continue;
      if (report.notificationSent) continue;

      const payload = {
        title: "🏁 Your Weekly Race Report is ready",
        body: "Your engineer has reviewed this week's telemetry. Tap to read your debrief.",
        icon: "/icon-192.png",
        url: "/",
        tag: `weekly-report-${weekStart}`,
      };

      let sent = false;
      for (const sub of user.subscriptions) {
        if (sub.apnsToken) {
          await sendApnsNotification(sub.apnsToken, payload.title, payload.body, { url: "/" });
          sent = true;
        } else if (sub.endpoint && sub.keys) {
          const ok = await sendPushNotification(
            { endpoint: sub.endpoint, keys: sub.keys as any },
            payload
          );
          if (ok) sent = true;
        }
      }

      if (sent) {
        await storage.markWeeklyReportNotificationSent(report.id);
        sentCount++;
      }
    }

    if (sentCount > 0) {
      (sendWeeklyReportNotifications as any)._sentWeek = weekStart;
      console.log(`[Weekly Report] Sent notifications to ${sentCount} users for week ${weekStart}`);
    }
  } catch (err) {
    console.error('[Weekly Report] Scheduler error:', err);
  }
}

// ─── Challenge reminders ─────────────────────────────────────────────────────

export async function sendChallengeReminders(windowMinutes = DELIVERY_WINDOW_MINUTES) {
  try {
    const now = new Date();
    const participants = await storage.getChallengesNeedingReminders(
      now.toISOString().split("T")[0]
    );

    for (const p of participants) {
      if (!p.notificationsEnabled || !p.timezone) continue;

      const userTimeStr = now.toLocaleString("en-US", {
        timeZone: p.timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const [currentHourStr, currentMinuteStr] = userTimeStr.split(":");
      const currentHour   = parseInt(currentHourStr, 10);
      const currentMinute = parseInt(currentMinuteStr, 10);

      const [rh, rm] = p.reminderTime.split(":").map(Number);
      if (!isWithinDeliveryWindow(rh, rm, currentHour, currentMinute, windowMinutes)) continue;

      const dedupeKey = `challenge_reminder_${p.userId}_${p.challengeId}_${now.toLocaleDateString("en-CA", { timeZone: p.timezone })}`;
      const alreadySent = lastReminderSentDate.get(dedupeKey);
      if (alreadySent) continue;
      lastReminderSentDate.set(dedupeKey, "sent");

      const payload: PushNotificationPayload = {
        title: "⚡ Challenge reminder",
        body: `Don't forget to log your entry for "${p.challengeTitle}" today.`,
        icon: "/icon-192.png",
        url: "/squad?tab=challenges",
        tag: dedupeKey,
      };

      await dispatchToSubscriptions(p.subscriptions as any, payload);
    }
  } catch (err) {
    console.error("[Challenge Reminders] Error:", err);
  }
}

// ─── Scheduler ──────────────────────────────────────────────────────────────

// Startup catch-up: run once with a wide window to deliver any notifications
// that were missed during a server restart or brief downtime.
// The DB dedup keys prevent any notification from being sent twice.
const STARTUP_CATCHUP_MINUTES = 240; // 4 hours back

async function runStartupCatchup() {
  console.log('[Notification Scheduler] Running startup catch-up (4-hour window)…');
  try {
    await Promise.all([
      sendDailyReminders(STARTUP_CATCHUP_MINUTES),
      sendMoodCheckinReminders(STARTUP_CATCHUP_MINUTES),
    ]);
    console.log('[Notification Scheduler] Startup catch-up complete');
  } catch (err) {
    console.error('[Notification Scheduler] Startup catch-up error:', err);
  }
}

export function startNotificationScheduler() {
  if (!isNotificationsEnabled) {
    console.log('[Notification Scheduler] Disabled — VAPID keys not configured');
    return;
  }

  // Run catch-up 5 seconds after startup to deliver any missed scheduled notifications
  setTimeout(runStartupCatchup, 5000);

  cron.schedule('* * * * *', () => {
    Promise.all([
      sendDailyReminders(),
      sendMoodCheckinReminders(),
      sendHabitReminders(),
      sendWeeklyReportNotifications(),
      sendChallengeReminders(),
    ]).catch(error => console.error('[Scheduler] Error:', error));
  });

  console.log('[Notification Scheduler] Started — checking every minute for due reminders');
}
