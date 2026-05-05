import express from "express";
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage, todayInTz } from "./storage";
import { updateUserStreak, checkActivityPointFreeze } from "./streakHelper";
import { authLimiter, aiLimiter, generalLimiter } from "./rate-limit";
import { 
  insertJournalEntrySchema, insertDailyScoreSchema, 
  insertUserMetricSchema, insertAIInsightSchema,
  insertPushSubscriptionSchema, insertHabitSchema,
  infiniteGoals, longTermGoals, challengeParticipants,
  habits, habitLogs, dailyGoals,
} from "@shared/schema";
import { orgChallenges } from "@shared/corporate-schema";
const CORPORATE_ENABLED = process.env.CORPORATE_TIER_ENABLED === "true";
import OpenAI from "openai";
import type { HealthData } from "./oura";
import { sendPushNotification, getVapidPublicKey } from "./notifications";
import { sendApnsNotification, sendSilentBadgeClear, isApnsConfigured, clearApnsCache } from "./apns";
import bcrypt from "bcrypt";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { createPublicKey } from "crypto";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { registerChatRoutes } from "./replit_integrations/chat/routes";
import { registerDebriefRoutes } from "./debrief-routes";
import { registerRealtimeVoiceWS } from "./realtime-voice";
import { registerSubscriptionRoutes } from "./subscription-routes";
import { registerCorporateRoutes } from "./corporate-routes";
import { generateWeeklyReport, generatePerformancePatterns } from "./weekly-report";
import { db } from "./db";
import { eq, and, desc, gte } from "drizzle-orm";
import { encrypt, decrypt } from "./encryption";

const openai = new OpenAI({ 
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Whisper audio transcription requires the standard OpenAI API (not Azure).
// Azure OpenAI only supports model deployments, and whisper-1 is not deployed.
const whisperOpenai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ── Push notification helper ───────────────────────────────────────────────
// Sends a push to ALL registered devices for a user (APNs first, then web).
// Silently swallows errors so callers don't need try/catch.
async function notifyUser(
  userId: number,
  payload: { title: string; body: string; url: string; tag: string }
): Promise<void> {
  try {
    const subs = await storage.getPushSubscriptions(userId);
    console.log(`[Notify] user=${userId} subs=${subs.length} title="${payload.title}"`);

    // Try every APNs token registered for this user (multiple devices possible)
    const apnsSubs = subs.filter(s => !!s.apnsToken);
    let apnsOk = false;
    for (const sub of apnsSubs) {
      const ok = await sendApnsNotification(sub.apnsToken!, payload);
      console.log(`[Notify] APNs token=${sub.apnsToken!.slice(0, 8)}… result=${ok}`);
      if (ok) apnsOk = true;
    }

    // Always also attempt web push — belt-and-suspenders for browsers / PWA installs
    const webSubs = subs.filter(s => s.p256dh && s.auth);
    for (const sub of webSubs) {
      try {
        await sendPushNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh!, auth: sub.auth! } },
          payload
        );
        console.log(`[Notify] Web push sent for user=${userId} endpoint=${sub.endpoint.slice(-20)}`);
      } catch (e) {
        console.warn(`[Notify] Web push failed for user=${userId}:`, e);
      }
    }

    if (apnsSubs.length === 0 && webSubs.length === 0) {
      console.log(`[Notify] No usable subscription for user=${userId}`);
    }
  } catch (err) {
    console.error(`[Notify] Error notifying user=${userId}:`, err);
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // Global rate limit on all /api routes — baseline DDoS/abuse protection
  app.use("/api", generalLimiter);

  registerObjectStorageRoutes(app);

  // Authentication — brute-force protected
  app.post("/api/auth/register", authLimiter, async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(409).json({ message: "An account with this email already exists" });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUser({ username, password: hashedPassword });
      
      // Initialize streak
      await storage.createStreak({ userId: user.id, currentStreak: 0, longestStreak: 0, lastEntryDate: null });

      // Seed default daily goal and habits
      await storage.createGoalTemplate({ userId: user.id, title: "Make my bed", recurring: true, isActive: true, sortOrder: 0 });
      await storage.createHabit({ userId: user.id, name: "Make someone smile", emoji: "😊", category: "daily", anchorHabit: null, reminderEnabled: false });
      await storage.createHabit({ userId: user.id, name: "Make my bed", emoji: "🛏️", category: "morning", anchorHabit: "I wake up", reminderEnabled: false });
      
      (req.session as any).userId = user.id;
      res.json({
        id: user.id,
        username: user.username,
        hasCompletedOnboarding: user.hasCompletedOnboarding ?? false,
        journalPreference: user.journalPreference ?? "evening",
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Failed to create account" });
    }
  });

  app.post("/api/auth/login", authLimiter, async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      (req.session as any).userId = user.id;
      res.json({
        id: user.id,
        username: user.username,
        hasCompletedOnboarding: user.hasCompletedOnboarding ?? false,
        journalPreference: user.journalPreference ?? "evening",
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to sign in" });
    }
  });

  // Google Sign-In — validates an ID token issued by Google's Identity Services SDK on the client
  app.post("/api/auth/google", async (req, res) => {
    try {
      const { credential } = req.body;
      if (!credential) return res.status(400).json({ message: "Missing credential" });

      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) return res.status(503).json({ message: "Google Sign-In is not configured on this server." });

      // Accept tokens from both the web client and the native iOS OAuth client
      const iosClientId = process.env.GOOGLE_IOS_CLIENT_ID;
      const validAudiences = [clientId, ...(iosClientId ? [iosClientId] : [])];
      const googleClient = new OAuth2Client(clientId);
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: validAudiences });
      const payload = ticket.getPayload();
      if (!payload?.email) return res.status(400).json({ message: "No email in Google token" });

      const email = payload.email.toLowerCase();
      let user = await storage.getUserByUsername(email);

      if (!user) {
        // Create new account — store a random unusable password (Google users authenticate via token)
        const randomPw = await bcrypt.hash(Math.random().toString(36), 10);
        user = await storage.createUser({ username: email, password: randomPw });
        await storage.createStreak({ userId: user.id, currentStreak: 0, longestStreak: 0, lastEntryDate: null });
        await storage.createGoalTemplate({ userId: user.id, title: "Make my bed", recurring: true, isActive: true, sortOrder: 0 });
        await storage.createHabit({ userId: user.id, name: "Make someone smile", emoji: "😊", category: "daily", anchorHabit: null, reminderEnabled: false });
        await storage.createHabit({ userId: user.id, name: "Make my bed", emoji: "🛏️", category: "morning", anchorHabit: "I wake up", reminderEnabled: false });
      }

      (req.session as any).userId = user.id;
      res.json({
        id: user.id,
        username: user.username,
        hasCompletedOnboarding: user.hasCompletedOnboarding ?? false,
        journalPreference: user.journalPreference ?? "evening",
      });
    } catch (error: any) {
      console.error("Google auth error:", error);
      res.status(401).json({ message: "Google sign-in failed. Please try again." });
    }
  });

  // Apple Sign-In — verifies the identity token from Sign In with Apple (native iOS)
  app.post("/api/auth/apple", async (req, res) => {
    try {
      const { identityToken, user: appleUserId, email, givenName, familyName } = req.body;
      if (!identityToken) return res.status(400).json({ message: "Missing identity token" });

      // Decode JWT header to find key ID
      const decoded = jwt.decode(identityToken, { complete: true }) as any;
      if (!decoded?.header?.kid) return res.status(400).json({ message: "Invalid identity token format" });

      // Fetch Apple's public keys
      const appleKeysRes = await fetch("https://appleid.apple.com/auth/keys");
      const { keys } = await appleKeysRes.json() as { keys: any[] };
      const jwk = keys.find((k: any) => k.kid === decoded.header.kid);
      if (!jwk) return res.status(401).json({ message: "Apple signing key not found" });

      // Convert JWK to PEM using built-in crypto
      const pubKey = createPublicKey({ key: jwk, format: "jwk" });
      const pem = pubKey.export({ type: "spki", format: "pem" });

      // Verify the token
      const payload = jwt.verify(identityToken, pem, {
        algorithms: ["RS256"],
        issuer: "https://appleid.apple.com",
        audience: "com.dbrief.app",
      }) as any;

      // Use a stable Apple user ID as the account key (email only comes on first sign-in)
      const emailKey = `apple:${appleUserId}`;

      let user = await storage.getUserByUsername(emailKey);
      if (!user) {
        // Try finding by email in case user signed in with email before
        if (email) {
          user = await storage.getUserByUsername(email.toLowerCase());
        }
        if (!user) {
          const randomPw = await bcrypt.hash(Math.random().toString(36), 10);
          user = await storage.createUser({ username: emailKey, password: randomPw });
          const displayName = [givenName, familyName].filter(Boolean).join(" ") || undefined;
          if (displayName) await storage.updateUserSettings(user.id, { displayName });
          await storage.createStreak({ userId: user.id, currentStreak: 0, longestStreak: 0, lastEntryDate: null });
          await storage.createGoalTemplate({ userId: user.id, title: "Make my bed", recurring: true, isActive: true, sortOrder: 0 });
          await storage.createHabit({ userId: user.id, name: "Make someone smile", emoji: "😊", category: "daily", anchorHabit: null, reminderEnabled: false });
          await storage.createHabit({ userId: user.id, name: "Make my bed", emoji: "🛏️", category: "morning", anchorHabit: "I wake up", reminderEnabled: false });
        }
      }

      (req.session as any).userId = user.id;
      res.json({
        id: user.id,
        username: user.username,
        hasCompletedOnboarding: user.hasCompletedOnboarding ?? false,
        journalPreference: user.journalPreference ?? "evening",
      });
    } catch (error: any) {
      console.error("Apple auth error:", error);
      res.status(401).json({ message: "Apple sign-in failed. Please try again." });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      // Check corporate org membership — org members get isPremium regardless of their own subscriptionStatus
      let orgInfo: { orgId: number; orgRole: string; orgName: string; accentColour: string | null; aiPersonaName: string | null; orgSubscriptionStatus: string } | null = null;
      if (process.env.CORPORATE_TIER_ENABLED === "true") {
        try {
          const adminOrg = await storage.getOrganisationByAdmin(user.id);
          if (adminOrg) {
            orgInfo = { orgId: adminOrg.id, orgRole: "admin", orgName: adminOrg.name, accentColour: adminOrg.accentColour, aiPersonaName: adminOrg.aiPersonaName, orgSubscriptionStatus: adminOrg.subscriptionStatus };
          } else {
            const membership = await storage.getOrgMembershipByUser(user.id);
            if (membership) {
              orgInfo = { orgId: membership.organisation.id, orgRole: "member", orgName: membership.organisation.name, accentColour: membership.organisation.accentColour, aiPersonaName: membership.organisation.aiPersonaName, orgSubscriptionStatus: membership.organisation.subscriptionStatus };
            }
          }
        } catch {}
      }

      const orgIsPremium = orgInfo !== null && orgInfo.orgSubscriptionStatus === "active";
      res.json({
        id: user.id,
        username: user.username,
        displayName: user.displayName ?? null,
        driverHandle: user.driverHandle ?? null,
        hasCompletedOnboarding: user.hasCompletedOnboarding ?? false,
        journalPreference: user.journalPreference ?? "evening",
        userProfile: user.userProfile ?? null,
        subscriptionStatus: user.subscriptionStatus ?? 'free',
        isPremium: user.subscriptionStatus === 'premium' || user.subscriptionStatus === 'beta' || orgIsPremium,
        subscriptionCurrentPeriodEnd: user.subscriptionCurrentPeriodEnd ?? null,
        ...(orgInfo ? { orgId: orgInfo.orgId, orgRole: orgInfo.orgRole, orgName: orgInfo.orgName } : {}),
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get user" });
    }
  });

  app.get("/api/me/points", async (req, res) => {
    try {
      const userId = getUserId(req);
      const [points, weeklyPoints] = await Promise.all([
        storage.getUserPoints(userId),
        storage.getWeeklyActivityPoints(userId),
      ]);
      res.json({ points, weeklyPoints });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch points" });
    }
  });

  app.get("/api/me/global-rank", async (req, res) => {
    try {
      const userId = getUserId(req);
      const rank = await storage.getGlobalWeeklyRank(userId);
      res.json(rank);
    } catch (error: any) {
      console.error("[global-rank] error:", error?.message ?? error);
      res.status(500).json({ message: "Failed to fetch global rank" });
    }
  });

  app.get("/api/me/daily-points", async (req, res) => {
    try {
      const userId = getUserId(req);
      const days = Math.min(365, parseInt((req.query.days as string) || "30"));
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      const [allScores, habitLogsAll, allGoals, activeHabitsAll] = await Promise.all([
        storage.getDailyScoresByUser(userId),
        db.select({ date: habitLogs.date, habitId: habitLogs.habitId })
          .from(habitLogs)
          .where(and(eq(habitLogs.userId, userId), gte(habitLogs.date, startDate))),
        db.select().from(dailyGoals)
          .where(and(eq(dailyGoals.userId, userId), gte(dailyGoals.date, startDate))),
        db.select({ id: habits.id }).from(habits)
          .where(and(eq(habits.userId, userId), eq(habits.isArchived, false))),
      ]);

      const totalActiveHabits = activeHabitsAll.length;
      const scoreDays = new Set(
        allScores.filter(s => s.date >= startDate && s.value > 0 && !s.isAutoSynced).map(s => s.date)
      );

      const habitByDate = new Map<string, Set<number>>();
      for (const log of habitLogsAll) {
        if (!habitByDate.has(log.date)) habitByDate.set(log.date, new Set());
        habitByDate.get(log.date)!.add(log.habitId);
      }

      const goalsByDate = new Map<string, { total: number; completed: number }>();
      for (const goal of allGoals) {
        const entry = goalsByDate.get(goal.date) ?? { total: 0, completed: 0 };
        goalsByDate.set(goal.date, {
          total: entry.total + 1,
          completed: entry.completed + (goal.completed ? 1 : 0),
        });
      }

      const result: { date: string; points: number }[] = [];
      const current = new Date(startDate + "T12:00:00");
      const end = new Date();
      end.setHours(23, 59, 59, 999);

      while (current <= end) {
        const d = current.toISOString().split("T")[0];
        let pts = 0;
        if (scoreDays.has(d)) pts += 10;
        const habitsForDay = habitByDate.get(d);
        if (habitsForDay) {
          pts += habitsForDay.size * 5;
          if (totalActiveHabits > 0 && habitsForDay.size >= totalActiveHabits) pts += 20;
        }
        const goalsForDay = goalsByDate.get(d);
        if (goalsForDay && goalsForDay.completed > 0) {
          pts += goalsForDay.completed * 5;
          if (goalsForDay.completed >= goalsForDay.total) pts += 20;
        }
        result.push({ date: d, points: pts });
        current.setDate(current.getDate() + 1);
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch daily points" });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    try {
      req.session.destroy((err) => {
        if (err) {
          return res.status(500).json({ message: "Failed to sign out" });
        }
        res.json({ success: true });
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to sign out" });
    }
  });

  app.delete("/api/auth/account", authLimiter, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Not authenticated" });
      await storage.deleteUser(userId);
      req.session.destroy((err) => {
        if (err) console.error("[deleteAccount] session destroy error:", err);
        res.clearCookie("connect.sid");
        res.json({ success: true });
      });
    } catch (error) {
      console.error("[deleteAccount] error:", error);
      res.status(500).json({ message: "Failed to delete account" });
    }
  });

  app.post("/api/onboarding/complete", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { journalPreference, goalPreference, userProfile, displayName, driverHandle } = req.body;
      const pref = journalPreference === "morning" ? "morning" : "evening";
      const goalPref = goalPreference === "evening" ? "evening" : "morning";

      let cleanHandle: string | undefined;
      if (driverHandle) {
        const h = driverHandle.trim().toLowerCase().replace(/^@/, "");
        if (!/^[a-z0-9_]{3,20}$/.test(h)) {
          return res.status(400).json({ message: "Invalid handle format" });
        }
        const available = await storage.isHandleAvailable(h, userId);
        if (!available) return res.status(409).json({ message: "That callsign is already taken" });
        cleanHandle = h;
      }

      const updatedUser = await storage.updateUserSettings(userId, {
        hasCompletedOnboarding: true,
        journalPreference: pref,
        goalPreference: goalPref,
        ...(userProfile && { userProfile }),
        ...(displayName && { displayName: displayName.trim() }),
        ...(cleanHandle && { driverHandle: cleanHandle }),
      });
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json({ success: true, journalPreference: pref });
    } catch (error) {
      res.status(500).json({ message: "Failed to complete onboarding" });
    }
  });

  app.get("/api/user/profile", async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json({ userProfile: user.userProfile || {}, goalPreference: user.goalPreference || "morning" });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  app.put("/api/user/profile", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { userProfile, goalPreference } = req.body;
      const updated = await storage.updateUserSettings(userId, {
        ...(userProfile !== undefined && { userProfile }),
        ...(goalPreference !== undefined && { goalPreference }),
      });
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json({ success: true, userProfile: updated.userProfile || {}, goalPreference: updated.goalPreference || "morning" });
    } catch (error) {
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // Lightweight endpoint for clients to keep their timezone in sync on each app launch.
  // Used by the front-end on startup so the notification scheduler always has a valid tz.
  app.post("/api/user/timezone", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { timezone } = req.body;
      if (!timezone || typeof timezone !== "string") return res.status(400).json({ message: "Invalid timezone" });
      await storage.updateUserSettings(userId, { timezone });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to update timezone" });
    }
  });

  app.get("/api/infinite-goal", async (req, res) => {
    try {
      const userId = getUserId(req);
      const [goal] = await db.select().from(infiniteGoals)
        .where(eq(infiniteGoals.userId, userId))
        .orderBy(desc(infiniteGoals.updatedAt))
        .limit(1);
      if (!goal) return res.json(null);
      res.json({ ...goal, content: decrypt(goal.content) });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch infinite goal" });
    }
  });

  app.post("/api/infinite-goal", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { content } = req.body;
      if (!content?.trim()) {
        return res.status(400).json({ message: "Content is required" });
      }
      const existing = await db.select().from(infiniteGoals)
        .where(eq(infiniteGoals.userId, userId));
      if (existing.length > 0) {
        const [updated] = await db.update(infiniteGoals)
          .set({ content: encrypt(content.trim()), updatedAt: new Date() })
          .where(eq(infiniteGoals.id, existing[0].id))
          .returning();
        return res.json({ ...updated, content: content.trim() });
      }
      const [goal] = await db.insert(infiniteGoals)
        .values({ userId, content: encrypt(content.trim()) })
        .returning();
      res.json({ ...goal, content: content.trim() });
    } catch (error) {
      res.status(500).json({ message: "Failed to save infinite goal" });
    }
  });

  app.post("/api/infinite-goal/ai-assist", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { input } = req.body;
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You help people articulate their infinite goal — an overarching aspiration that can never be fully achieved but always drives them forward. Think of it like a Formula 1 team's mission: they never stop pursuing perfection.

The infinite goal should be:
- Personal and meaningful, not generic
- Aspirational yet authentic — it should feel like THEM
- Impossible to fully "complete" — it's a direction, not a destination
- Concise — one powerful sentence, no more than 15 words

If the user gives you a rough idea, refine it. If they're unsure, ask one pointed question to help them find it. Return ONLY the refined goal text, nothing else. If you need more info, ask ONE short question.`
          },
          { role: "user", content: input || "Help me figure out my infinite goal" },
        ],
        max_tokens: 100,
      });
      res.json({ suggestion: response.choices[0].message.content });
    } catch (error) {
      res.status(500).json({ message: "Failed to generate suggestion" });
    }
  });

  app.get("/api/long-term-goals", async (req, res) => {
    try {
      const userId = getUserId(req);
      const goals = await db.select().from(longTermGoals)
        .where(and(eq(longTermGoals.userId, userId), eq(longTermGoals.isActive, true)))
        .orderBy(longTermGoals.sortOrder);
      const decrypted = goals.map(g => ({
        ...g,
        title: decrypt(g.title),
        description: g.description ? decrypt(g.description) : null,
      }));
      res.json(decrypted);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch long-term goals" });
    }
  });

  app.post("/api/long-term-goals", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { title, description } = req.body;
      if (!title?.trim()) {
        return res.status(400).json({ message: "Title is required" });
      }
      const existing = await db.select().from(longTermGoals)
        .where(and(
          eq(longTermGoals.userId, userId),
          eq(longTermGoals.isActive, true),
          eq(longTermGoals.isCompleted, false),
        ));
      if (existing.length >= 3) {
        return res.status(400).json({ message: "Maximum of 3 long-term goals allowed" });
      }
      const [goal] = await db.insert(longTermGoals)
        .values({
          userId,
          title: encrypt(title.trim()),
          description: description ? encrypt(description.trim()) : null,
          sortOrder: existing.length,
        })
        .returning();
      res.json({ ...goal, title: title.trim(), description: description?.trim() || null });
    } catch (error) {
      res.status(500).json({ message: "Failed to create long-term goal" });
    }
  });

  app.put("/api/long-term-goals/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      const id = parseInt(req.params.id);
      const { title, description, progress, isCompleted } = req.body;
      const [existing] = await db.select().from(longTermGoals)
        .where(and(eq(longTermGoals.id, id), eq(longTermGoals.userId, userId)));
      if (!existing) {
        return res.status(404).json({ message: "Goal not found" });
      }
      const now = new Date();
      const setFields: Record<string, any> = { updatedAt: now };
      if (title) setFields.title = encrypt(title.trim());
      if (description !== undefined) setFields.description = description ? encrypt(description.trim()) : null;
      if (progress !== undefined) setFields.progress = Math.max(0, Math.min(100, Number(progress)));
      if (isCompleted !== undefined) {
        setFields.isCompleted = isCompleted;
        if (isCompleted && !existing.isCompleted) setFields.completedAt = now;
        if (!isCompleted) { setFields.completedAt = null; }
      }
      const [updated] = await db.update(longTermGoals)
        .set(setFields)
        .where(eq(longTermGoals.id, id))
        .returning();
      res.json({
        ...updated,
        title: title?.trim() || decrypt(existing.title),
        description: description !== undefined
          ? (description?.trim() || null)
          : (existing.description ? decrypt(existing.description) : null),
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to update goal" });
    }
  });

  app.delete("/api/long-term-goals/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      const id = parseInt(req.params.id);
      await db.update(longTermGoals)
        .set({ isActive: false })
        .where(and(eq(longTermGoals.id, id), eq(longTermGoals.userId, userId)));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete goal" });
    }
  });

  function getUserId(req: any): number {
    const userId = (req.session as any)?.userId;
    if (!userId) {
      throw new Error("Not authenticated");
    }
    return userId;
  }

  app.get("/api/dates-with-data", async (req, res) => {
    try {
      const userId = getUserId(req);
      const dates = await storage.getDatesWithData(userId);
      res.json(dates);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch dates with data" });
    }
  });

  // All Daily Scores (for trends page)
  app.get("/api/daily-scores", async (req, res) => {
    try {
      const userId = getUserId(req);
      const scores = await storage.getDailyScoresByUser(userId);
      res.json(scores);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch daily scores" });
    }
  });

  // Journal Entries
  app.get("/api/journal-entries", async (req, res) => {
    try {
      const userId = getUserId(req);
      const entries = await storage.getJournalEntriesByUser(userId);
      res.json(entries);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch journal entries" });
    }
  });

  app.get("/api/journal-entries/:date", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { date } = req.params;
      const entry = await storage.getJournalEntryByDate(userId, date);
      res.json(entry || null);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch journal entry" });
    }
  });

  app.post("/api/journal-entries", async (req, res) => {
    try {
      const userId = getUserId(req);
      const validatedData = insertJournalEntrySchema.parse({ ...req.body, userId });
      
      // Check if entry exists for this date
      const existingEntry = await storage.getJournalEntryByDate(userId, validatedData.date);
      
      if (existingEntry) {
        const updatedEntry = await storage.updateJournalEntry(existingEntry.id, {
          content: validatedData.content,
          isVoiceEntry: validatedData.isVoiceEntry,
        });
        updateUserStreak(userId, validatedData.date).then(() => checkActivityPointFreeze(userId)).catch(() => {});
        res.json(updatedEntry);
      } else {
        const entry = await storage.createJournalEntry(validatedData);
        updateUserStreak(userId, validatedData.date).then(() => checkActivityPointFreeze(userId)).catch(() => {});
        res.json(entry);
      }
    } catch (error) {
      res.status(400).json({ message: "Failed to save journal entry" });
    }
  });

  // Daily Scores
  app.get("/api/daily-scores/:date", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { date } = req.params;
      const scores = await storage.getDailyScoresByUserAndDate(userId, date);
      res.json(scores);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch daily scores" });
    }
  });

  app.get("/api/metric-history/:metricName", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { metricName } = req.params;
      const days = parseInt(req.query.days as string) || 14;
      const history = await storage.getMetricHistory(userId, metricName, days);
      res.json(history);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch metric history" });
    }
  });

  app.post("/api/daily-scores", async (req, res) => {
    try {
      const userId = getUserId(req);
      const validatedData = insertDailyScoreSchema.parse({ ...req.body, userId });

      // Capture streak BEFORE saving so we can detect when milestones are first crossed
      const streakBefore = await storage.getUserStreak(userId);
      const streakBeforeVal = streakBefore?.currentStreak ?? 0;
      
      const score = await storage.updateDailyScore(
        userId, 
        validatedData.date, 
        validatedData.metricName, 
        validatedData.value
      );
      
      // Update streak based on score inputs (only for user inputs, not auto-synced)
      if (!validatedData.isAutoSynced) {
        await updateUserStreak(userId, validatedData.date);
        await checkActivityPointFreeze(userId).catch(() => {});

        // ── Milestone notifications (fire-and-forget, non-blocking) ──────────
        setImmediate(async () => {
          try {
            const subs = await storage.getPushSubscriptions(userId);
            if (subs.length === 0) return;

            const allScores = await storage.getDailyScoresByUser(userId);
            const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
            const dataDays = new Set(
              allScores.filter(s => s.date >= ninetyDaysAgo && s.value > 0).map(s => s.date)
            ).size;

            const sendMilestoneNotif = async (title: string, body: string) => {
              const apnsSub = subs.filter(s => !!s.apnsToken).pop();
              if (apnsSub?.apnsToken) {
                await sendApnsNotification(apnsSub.apnsToken, { title, body, url: "/", tag: `milestone-${userId}-${Date.now()}` });
              } else {
                const webSub = subs.find(s => s.p256dh && s.auth);
                if (webSub) {
                  await sendPushNotification({ endpoint: webSub.endpoint, keys: { p256dh: webSub.p256dh!, auth: webSub.auth! } }, { title, body, url: "/", tag: `milestone-${userId}-${Date.now()}` });
                }
              }
            };

            // Pattern Analysis first unlock: just crossed 5 days of data
            if (dataDays === 5) {
              const existingPatterns = await storage.getActivePerformancePatterns(userId);
              if (existingPatterns.length === 0) {
                // Auto-trigger the first scan
                const { generatePerformancePatterns } = await import("./weekly-report");
                await generatePerformancePatterns(userId);
                await sendMilestoneNotif(
                  "📊 First Pattern Scan Ready",
                  "You've logged enough data for your first Data Pattern Analysis. Tap to see what the numbers reveal."
                );
              }
            }

            // Mission Intelligence unlock: streak just hit 7 for the first time
            const streakAfter = await storage.getUserStreak(userId);
            const longestStreak = streakAfter?.longestStreak ?? 0;
            if (streakBeforeVal < 7 && (streakAfter?.currentStreak ?? 0) >= 7 && longestStreak <= 7) {
              await sendMilestoneNotif(
                "🎯 Mission Intelligence Unlocked",
                "7-day streak achieved. Long-term trajectory analysis is now active — tap to run your first assessment."
              );
            }
          } catch (e) {
            console.error("[Milestone notif] Error:", e);
          }
        });
      }
      
      res.json(score);
    } catch (error) {
      res.status(400).json({ message: "Failed to save daily score" });
    }
  });

  // User Metrics
  app.get("/api/user-metrics", async (req, res) => {
    try {
      const userId = getUserId(req);
      const metrics = await storage.getUserMetrics(userId);
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch user metrics" });
    }
  });

  app.post("/api/user-metrics", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { name, color, maxValue } = req.body;

      const existing = (await storage.getUserMetrics(userId)).find(
        m => m.name.toLowerCase() === (name || "").toLowerCase()
      );
      if (existing) {
        const reactivated = await storage.updateUserMetric(existing.id, { isActive: true, color: color || existing.color });
        return res.json(reactivated);
      }

      const validatedData = insertUserMetricSchema.parse({ ...req.body, userId });
      const metric = await storage.createUserMetric(validatedData);
      res.json(metric);
    } catch (error) {
      res.status(400).json({ message: "Failed to create user metric" });
    }
  });

  app.put("/api/user-metrics/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      const metricId = parseInt(id);
      const { name, color } = req.body;

      const existingMetrics = await storage.getUserMetrics(userId);
      const existingMetric = existingMetrics.find(m => m.id === metricId);
      if (!existingMetric) {
        return res.status(404).json({ message: "Metric not found" });
      }

      const updates: any = {};
      if (color) updates.color = color;

      if (name && name !== existingMetric.name) {
        updates.name = name;
        const { eq: eqOp, and: andOp } = await import("drizzle-orm");
        const { db } = await import("./db");
        const { dailyScores } = await import("@shared/schema");
        await db.update(dailyScores)
          .set({ metricName: name })
          .where(andOp(eqOp(dailyScores.userId, userId), eqOp(dailyScores.metricName, existingMetric.name)));
      }

      const metric = await storage.updateUserMetric(metricId, updates);
      res.json(metric);
    } catch (error) {
      res.status(400).json({ message: "Failed to update user metric" });
    }
  });

  app.delete("/api/user-metrics/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      await storage.deleteUserMetric(parseInt(id), userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete metric" });
    }
  });

  // Goal Templates
  app.get("/api/goal-templates", async (req, res) => {
    try {
      const userId = getUserId(req);
      const templates = await storage.getGoalTemplates(userId);
      res.json(templates);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch goal templates" });
    }
  });

  app.post("/api/goal-templates", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { title, date: requestedDate } = req.body;
      if (!title) return res.status(400).json({ message: "Title is required" });
      const existing = await storage.getGoalTemplates(userId);
      const template = await storage.createGoalTemplate({
        userId,
        title,
        sortOrder: existing.length,
        isActive: true,
      });

      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      // Only create a daily instance for the date the user was viewing when they
      // added the goal — never silently add it to today if a different date was sent.
      const targetDate = (requestedDate && typeof requestedDate === "string") ? requestedDate : todayStr;
      const dateGoals = await storage.getDailyGoals(userId, targetDate);
      const alreadyExists = dateGoals.some(g => g.goalTemplateId === template.id);
      if (!alreadyExists) {
        await storage.createDailyGoal({
          userId,
          date: targetDate,
          goalTemplateId: template.id,
          title: template.title,
          completed: false,
        });
      }

      res.json(template);
    } catch (error) {
      res.status(500).json({ message: "Failed to create goal template" });
    }
  });

  app.put("/api/goal-templates/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      const { title } = req.body;
      if (!title || typeof title !== "string" || !title.trim()) {
        return res.status(400).json({ message: "Title is required" });
      }
      const updated = await storage.updateGoalTemplate(parseInt(id), userId, { title: title.trim() });
      if (!updated) return res.status(404).json({ message: "Goal template not found" });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update goal template" });
    }
  });

  app.delete("/api/goal-templates/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      await storage.deleteGoalTemplate(parseInt(id), userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete goal template" });
    }
  });

  // Daily Goals
  app.get("/api/daily-goals/:date", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { date } = req.params;
      res.set("Cache-Control", "no-store");
      const goals = await storage.ensureDailyGoals(userId, date);
      res.json(goals);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch daily goals" });
    }
  });

  app.post("/api/daily-goals/:id/toggle", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      const updated = await storage.toggleDailyGoal(parseInt(id), userId);
      if (!updated) return res.status(404).json({ message: "Goal not found" });
      const today = new Date().toISOString().split("T")[0];
      if (updated.date === today) {
        updateUserStreak(userId, today).then(() => checkActivityPointFreeze(userId)).catch(() => {});
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to toggle goal" });
    }
  });

  app.get("/api/daily-goals-range", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) return res.status(400).json({ message: "startDate and endDate required" });
      const goals = await storage.getGoalsForDateRange(userId, startDate as string, endDate as string);
      res.json(goals);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch goals range" });
    }
  });

  // Journal Attachments
  app.get("/api/journal-attachments/:entryId", async (req, res) => {
    try {
      const { entryId } = req.params;
      const attachments = await storage.getAttachmentsByEntry(parseInt(entryId));
      res.json(attachments);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch attachments" });
    }
  });

  app.post("/api/journal-attachments", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { journalEntryId, objectPath, filename, contentType, size } = req.body;
      if (!journalEntryId || !objectPath || !filename) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      const attachment = await storage.createAttachment({
        userId,
        journalEntryId,
        objectPath,
        filename,
        contentType: contentType || "application/octet-stream",
        size: size || 0,
      });
      res.json(attachment);
    } catch (error) {
      res.status(500).json({ message: "Failed to save attachment" });
    }
  });

  app.delete("/api/journal-attachments/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      await storage.deleteAttachment(parseInt(id), userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete attachment" });
    }
  });

  // Mood Check-ins
  app.post("/api/mood-checkins", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { value, label } = req.body;
      if (value === undefined || value < 0 || value > 100) {
        return res.status(400).json({ message: "Value must be between 0 and 100" });
      }
      const today = new Date().toISOString().split('T')[0];
      const checkin = await storage.createMoodCheckin({
        userId,
        date: today,
        value,
        label: label || null,
      });
      updateUserStreak(userId, today).then(() => checkActivityPointFreeze(userId)).catch(() => {});
      res.json(checkin);
    } catch (error) {
      res.status(500).json({ message: "Failed to save mood check-in" });
    }
  });

  app.get("/api/mood-checkins/:date", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { date } = req.params;
      const checkins = await storage.getMoodCheckinsByDate(userId, date);
      res.json(checkins);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch mood check-ins" });
    }
  });

  app.get("/api/mood-checkins-range", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) return res.status(400).json({ message: "startDate and endDate required" });
      const checkins = await storage.getMoodCheckinsForDateRange(userId, startDate as string, endDate as string);
      res.json(checkins);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch mood check-ins" });
    }
  });

  // Streaks
  app.get("/api/streak", async (req, res) => {
    try {
      const userId = getUserId(req);
      const [streak, recentActiveDays, allScores, recentFreezeEvents] = await Promise.all([
        storage.getUserStreak(userId),
        storage.getRecentActiveDays(userId),
        storage.getDailyScoresByUser(userId),
        storage.getStreakFreezeEvents(userId, 5),
      ]);
      const base = streak || { currentStreak: 0, longestStreak: 0, lastEntryDate: null };
      const everUnlocked = (base.longestStreak ?? 0) >= 7;
      const insightsUnlocked = everUnlocked && recentActiveDays >= 5;
      // Count distinct days with any logged score in the last 90 days
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const dataDays = new Set(
        allScores.filter(s => s.date >= ninetyDaysAgo && s.value > 0).map(s => s.date)
      ).size;
      res.json({ ...base, recentActiveDays, insightsUnlocked, dataDays, recentFreezeEvents });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch streak" });
    }
  });

  // Streak Freeze status
  app.get("/api/streak-freezes", async (req, res) => {
    try {
      const userId = getUserId(req);
      const [streak, events, user] = await Promise.all([
        storage.getUserStreak(userId),
        storage.getStreakFreezeEvents(userId, 10),
        storage.getUser(userId),
      ]);
      // Use user-local date (same basis as streakHelper) to avoid badge
      // mis-timing around timezone boundaries
      const today = todayInTz(user?.timezone);
      const yesterdayMs = new Date(today + "T12:00:00Z").getTime() - 86_400_000;
      const yesterdayStr = new Date(yesterdayMs).toISOString().split("T")[0];
      const freezeUsedDate = streak?.freezeUsedDate ?? null;
      const streakWasProtected =
        freezeUsedDate === today || freezeUsedDate === yesterdayStr;
      res.json({
        freezeBalance: streak?.streakFreezes ?? 0,
        recentEvents: events.slice(0, 5),
        streakWasProtected,
        freezeUsedDate,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch freeze status" });
    }
  });

  // AI Insights
  app.get("/api/ai-insights", async (req, res) => {
    try {
      const userId = getUserId(req);
      const insights = await storage.getActiveAIInsights(userId);
      res.json(insights);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch AI insights" });
    }
  });

  app.post("/api/tts", async (req, res) => {
    try {
      getUserId(req);
      const { text, voice = "fable" } = req.body;
      if (!text || typeof text !== "string") return res.status(400).json({ message: "text required" });
      const truncated = text.slice(0, 4096);
      // Use tts-1 via the direct OpenAI key — much faster than gpt-audio
      const directKey = process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
      const mp3Res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${directKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "tts-1", voice, input: truncated }),
      });
      if (!mp3Res.ok) {
        const errText = await mp3Res.text();
        throw new Error(`TTS API error ${mp3Res.status}: ${errText.slice(0, 200)}`);
      }
      const arrayBuf = await mp3Res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      res.set("Content-Type", "audio/mpeg");
      res.set("Content-Length", String(buffer.length));
      res.set("Cache-Control", "no-store");
      res.send(buffer);
    } catch (e: any) {
      console.error("[TTS] Error:", e?.message);
      res.status(500).json({ message: "TTS failed" });
    }
  });

  // Voice note transcription — accepts raw audio binary, returns Whisper transcript
  app.post(
    "/api/voice-note/transcribe",
    aiLimiter,
    express.raw({ type: "*/*", limit: "20mb" }),
    async (req, res) => {
      try {
        getUserId(req);
        const mimeType = (req.headers["x-mime-type"] as string) || "audio/webm";
        const buffer = req.body as Buffer;
        if (!Buffer.isBuffer(buffer) || buffer.length < 100) {
          return res.status(400).json({ message: "No audio data received" });
        }
        const ext = mimeType.includes("mp4") ? "mp4"
          : mimeType.includes("ogg") ? "ogg"
          : "webm";
        const file = new File([buffer], `voice-note.${ext}`, { type: mimeType });
        const transcription = await whisperOpenai.audio.transcriptions.create({
          file,
          model: "whisper-1",
          language: "en",
        });
        res.json({ text: transcription.text });
      } catch (err: any) {
        console.error("[VoiceNote] Transcribe error:", err?.message);
        res.status(500).json({ message: "Transcription failed" });
      }
    }
  );

  app.post("/api/ai-insights/generate", async (req, res) => {
    try {
      const userId = getUserId(req);
      
      const [streak, recentActiveDays] = await Promise.all([
        storage.getUserStreak(userId),
        storage.getRecentActiveDays(userId),
      ]);

      const everUnlocked = (streak?.longestStreak ?? 0) >= 7;
      if (!everUnlocked) {
        return res.json({ insight: null, needsStreak: true, currentStreak: streak?.currentStreak || 0 });
      }
      if (recentActiveDays < 5) {
        return res.json({ insight: null, needsDataRichness: true, recentActiveDays });
      }
      
      // Fetch previous insights before generating, so we can avoid repeating them
      const previousInsights = await storage.getActiveAIInsights(userId);

      // Deactivate all old insights — we'll show only the freshly generated one
      await Promise.all(previousInsights.map(i => storage.deactivateAIInsight(i.id)));

      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      // 90-day window for long-range trajectory analysis
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const [allScores, moodCheckins, goals, infiniteGoalRows, longTermGoalRows] = await Promise.all([
        storage.getDailyScoresByUser(userId),
        storage.getMoodCheckinsForDateRange(userId, ninetyDaysAgo, todayStr),
        storage.getGoalsForDateRange(userId, ninetyDaysAgo, todayStr),
        db.select().from(infiniteGoals).where(eq(infiniteGoals.userId, userId)).orderBy(desc(infiniteGoals.updatedAt)).limit(1),
        db.select().from(longTermGoals).where(and(eq(longTermGoals.userId, userId), eq(longTermGoals.isActive, true))),
      ]);

      const recentScores = allScores.filter(s => s.date >= ninetyDaysAgo);

      // Exclude zeros — a score of 0 almost always means no input was logged, not a
      // deliberate zero. Only include scores that were actually entered by the user.
      const scoresByDate: Record<string, Record<string, number>> = {};
      recentScores.filter(s => s.value > 0).forEach(score => {
        if (!scoresByDate[score.date]) scoresByDate[score.date] = {};
        scoresByDate[score.date][score.metricName] = score.value;
      });

      const moodByDate: Record<string, number[]> = {};
      moodCheckins.forEach(m => {
        if (!moodByDate[m.date]) moodByDate[m.date] = [];
        moodByDate[m.date].push(m.value);
      });

      const goalsByDate: Record<string, { total: number; completed: number }> = {};
      goals.forEach(g => {
        if (!goalsByDate[g.date]) goalsByDate[g.date] = { total: 0, completed: 0 };
        goalsByDate[g.date].total++;
        if (g.completed) goalsByDate[g.date].completed++;
      });

      // Decrypt and extract goal text
      const infiniteGoalText = infiniteGoalRows[0]
        ? (() => { try { return decrypt(infiniteGoalRows[0].goal); } catch { return infiniteGoalRows[0].goal; } })()
        : null;
      const longTermGoalTexts = longTermGoalRows.map(g => {
        try { return decrypt(g.goal); } catch { return g.goal; }
      });

      // Build a 90-day score trend: group by 30-day buckets for trajectory view
      const buckets = [
        { label: "Days 61–90 ago", start: ninetyDaysAgo, end: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] },
        { label: "Days 31–60 ago", start: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], end: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] },
        { label: "Last 30 days",   start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], end: todayStr },
      ];

      const metricNames = [...new Set(recentScores.filter(s => s.value > 0).map(s => s.metricName))];

      const trendTable = metricNames.map(metric => {
        const bucketAverages = buckets.map(b => {
          const vals = recentScores.filter(s => s.metricName === metric && s.date >= b.start && s.date <= b.end && s.value > 0).map(s => s.value);
          if (vals.length === 0) return null;
          return Math.round(vals.reduce((a, v) => a + v, 0) / vals.length);
        });
        const parts = buckets.map((b, i) => bucketAverages[i] !== null ? `${b.label}: avg ${bucketAverages[i]}` : null).filter(Boolean);
        return parts.length > 0 ? `${metric}: ${parts.join(" → ")}` : null;
      }).filter(Boolean).join("\n");

      const goalCompletionRate = goals.length > 0
        ? Math.round((goals.filter(g => g.completed).length / goals.length) * 100)
        : null;

      const moodTrend = (() => {
        const recentMoods = moodCheckins.filter(m => m.date >= new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
        const olderMoods = moodCheckins.filter(m => m.date < new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
        if (recentMoods.length === 0) return null;
        const recentAvg = Math.round(recentMoods.reduce((a, m) => a + m.value, 0) / recentMoods.length);
        const olderAvg = olderMoods.length > 0 ? Math.round(olderMoods.reduce((a, m) => a + m.value, 0) / olderMoods.length) : null;
        return olderAvg !== null ? `${olderAvg} (older) → ${recentAvg} (last 30 days)` : `${recentAvg} avg (last 30 days)`;
      })();

      // Convert YYYY-MM-DD dates to relative human-friendly labels
      const relativeDate = (dateStr: string): string => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const target = new Date(dateStr + "T00:00:00");
        const diffDays = Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));
        const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        if (diffDays === 0) return "today";
        if (diffDays === 1) return "yesterday";
        if (diffDays <= 6) return `last ${weekdays[target.getDay()]}`;
        if (diffDays <= 13) return `${weekdays[target.getDay()]} last week`;
        return `${weekdays[target.getDay()]} (${target.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})`;
      };

      const prevInsightContext = previousInsights.length > 0
        ? `\nPREVIOUS ANALYSES (DO NOT REPEAT these — generate something fresh):\n${previousInsights.slice(0, 3).map(i => `- ${i.insight}`).join('\n')}\n`
        : '';

      const prompt = `You are a long-range performance strategist working with a driver who is pursuing a meaningful life mission. Your role is NOT to give short-term tips — it is to assess whether this driver's 90-day performance trajectory is genuinely pointing toward their stated goals, and to give them an honest strategic read on where they stand.${prevInsightContext}

DRIVER'S INFINITE GOAL (their overarching life mission — cannot be fully achieved, only pursued):
${infiniteGoalText ?? "Not yet set."}

LONG-TERM TARGETS (medium-term goals they are actively working toward):
${longTermGoalTexts.length > 0 ? longTermGoalTexts.map((g, i) => `${i + 1}. ${g}`).join("\n") : "None set yet."}

90-DAY PERFORMANCE SCORE TRAJECTORY (0–100 scale, grouped by period):
${trendTable || "Insufficient data across this period."}

GOAL COMPLETION RATE (last 90 days): ${goalCompletionRate !== null ? `${goalCompletionRate}%` : "No goal data."}

MOOD TREND (0–100 scale): ${moodTrend ?? "No mood data."}

CURRENT STREAK: ${streak?.currentStreak || 0} days

TASK: Write a strategic trajectory assessment — not a tip, not a weekly summary. Look at this driver's actual 90-day arc and tell them honestly whether their scores and behaviours are building the kind of compounding progress that leads to their long-term targets and infinite goal, or whether there is a drift they should be aware of.

Rules:
- Be specific: reference actual metric names and numbers from the trajectory data
- If a metric is trending up, say by how much and what that means over time
- If there is a gap between their stated goals and their actual data pattern, name it directly — no softening
- Do NOT give week-by-week tactical advice (that's the Race Report's job)
- Do NOT describe correlations between metrics (that's Data Pattern Analysis's job)
- This is the long view: 90 days, goal alignment, trajectory momentum

Write 3–5 concise sentences in an F1 engineer's voice: direct, data-grounded, forward-looking. Second person ("you", "your"). Suggest 2–3 tags.

Respond in JSON: { "insight": "your trajectory analysis here", "tags": ["tag1", "tag2"] }`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      });

      const aiResponse = JSON.parse(response.choices[0].message.content || "{}");
      
      if (aiResponse.insight) {
        const insight = await storage.createAIInsight({
          userId,
          insight: aiResponse.insight,
          tags: aiResponse.tags || [],
          isActive: true,
        });
        
        res.json(insight);
      } else {
        res.json({ insight: null });
      }
    } catch (error) {
      console.error("AI insight generation error:", error);
      res.status(500).json({ message: "Failed to generate AI insight" });
    }
  });

  // Health Integration (Apple Health via Capacitor)
  app.get("/api/health/status", async (req, res) => {
    res.json({ provider: "apple_health", available: true });
  });

  app.post("/api/health/sync", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { date, metrics } = req.body;

      if (!date) return res.status(400).json({ message: "Date is required" });

      // Metric color defaults for known health metrics
      const METRIC_DEFAULTS: Record<string, { color: string; maxValue: number }> = {
        "Steps":              { color: "#10B981", maxValue: 20000 },
        "Active Energy":      { color: "#F59E0B", maxValue: 800 },
        "Exercise Minutes":   { color: "#3B82F6", maxValue: 60 },
        "Flights Climbed":    { color: "#84CC16", maxValue: 20 },
        "Walking Distance":   { color: "#0EA5E9", maxValue: 10 },
        "Sleep Duration":     { color: "#4F46E5", maxValue: 10 },
        "Sleep Score":        { color: "#7C3AED", maxValue: 100 },
        "Heart Rate":         { color: "#EF4444", maxValue: 200 },
        "Resting Heart Rate": { color: "#E11D48", maxValue: 100 },
        "HRV":                { color: "#8B5CF6", maxValue: 120 },
        "Blood Oxygen":       { color: "#38BDF8", maxValue: 100 },
        "Body Weight":        { color: "#EC4899", maxValue: 200 },
        "Body Fat %":         { color: "#F97316", maxValue: 50 },
        "Mindful Minutes":    { color: "#14B8A6", maxValue: 60 },
        "Respiratory Rate":   { color: "#64748B", maxValue: 30 },
      };

      const incomingMetrics: Array<{ name: string; value: number }> = metrics || [];
      // Metric names that were attempted by the client but filtered out (e.g. Sleep Quality
      // discarded because sleep duration < 3 h). Any previously auto-synced value for these
      // metrics on this date should be removed so stale data doesn't persist.
      const clearedMetricNames: string[] = req.body.clearedMetricNames || [];

      const existingMetrics = await storage.getUserMetrics(userId);
      const existingByName = new Map(existingMetrics.filter(m => m.isActive).map(m => [m.name, m]));

      // Clear stale auto-synced scores for metrics the client explicitly filtered out
      if (clearedMetricNames.length > 0) {
        await Promise.all(clearedMetricNames.map(name =>
          storage.clearAutoSyncedScore(userId, date, name)
        ));
      }

      if (incomingMetrics.length === 0) {
        return res.json({ success: true, updatedScores: [] });
      }

      const updatedScores = [];

      for (const { name, value } of incomingMetrics) {
        if (!existingByName.has(name)) {
          const defaults = METRIC_DEFAULTS[name] ?? { color: "#6366F1", maxValue: 100 };
          await storage.createUserMetric({ userId, name, color: defaults.color, maxValue: defaults.maxValue, isDefault: false, isActive: true });
        }
        const score = await storage.updateDailyScore(userId, date, name, value, true);
        updatedScores.push(score);
      }

      res.json({ success: true, updatedScores });
    } catch (error) {
      console.error("Health sync error:", error);
      res.status(500).json({ message: "Failed to sync health data", error: String(error) });
    }
  });

  app.delete("/api/ai-insights/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deactivateAIInsight(parseInt(id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to deactivate insight" });
    }
  });

  // ─── Weekly Race Report ─────────────────────────────────────────────────────

  app.get("/api/weekly-report/latest", async (req, res) => {
    try {
      const userId = getUserId(req);
      const report = await storage.getLatestWeeklyReport(userId);
      if (!report) return res.json(null);
      res.json({ ...report, content: decrypt(report.content) });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch weekly report" });
    }
  });

  app.post("/api/weekly-report/generate", aiLimiter, async (req, res) => {
    try {
      const userId = getUserId(req);
      const report = await generateWeeklyReport(userId);
      if (!report) return res.json({ skipped: true, reason: "Not enough data" });
      res.json({ ...report, content: decrypt(report.content) });
    } catch (error) {
      console.error("[Weekly Report] Error:", error);
      res.status(500).json({ message: "Failed to generate weekly report" });
    }
  });

  // ─── Performance Patterns ────────────────────────────────────────────────────

  app.get("/api/performance-patterns", async (req, res) => {
    try {
      const userId = getUserId(req);
      const patterns = await storage.getActivePerformancePatterns(userId);
      res.json(patterns);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch patterns" });
    }
  });

  app.post("/api/performance-patterns/generate", aiLimiter, async (req, res) => {
    try {
      const userId = getUserId(req);
      const patterns = await generatePerformancePatterns(userId);
      res.json(patterns);
    } catch (error) {
      console.error("[Patterns] Error:", error);
      res.status(500).json({ message: "Failed to generate patterns" });
    }
  });

  // VAPID Public Key endpoint
  app.get("/api/push/vapid-public-key", (_req, res) => {
    const key = getVapidPublicKey();
    if (!key) {
      return res.status(503).json({ message: "Push notifications not configured" });
    }
    res.json({ publicKey: key });
  });

  // Push Notification Subscription Routes
  app.post("/api/push/subscribe", async (req, res) => {
    try {
      const userId = getUserId(req);
      const subscription = req.body;

      // Validate subscription format
      if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
        return res.status(400).json({ message: "Invalid subscription format" });
      }

      const savedSubscription = await storage.createPushSubscription({
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth
      });

      res.json({ success: true, subscription: savedSubscription });
    } catch (error) {
      console.error("Push subscription error:", error);
      res.status(500).json({ message: "Failed to save push subscription" });
    }
  });

  app.delete("/api/push/unsubscribe", async (req, res) => {
    try {
      const { endpoint } = req.body;
      
      if (!endpoint) {
        return res.status(400).json({ message: "Endpoint required" });
      }

      await storage.deletePushSubscription(endpoint);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete subscription" });
    }
  });

  // APNs device token registration (native iOS app)
  app.post("/api/push/register-apns", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { deviceToken } = req.body;

      if (!deviceToken || typeof deviceToken !== 'string') {
        return res.status(400).json({ message: "deviceToken required" });
      }

      const saved = await storage.saveApnsToken(userId, deviceToken);
      res.json({ success: true, id: saved.id });
    } catch (error) {
      console.error("APNs token registration error:", error);
      res.status(500).json({ message: "Failed to register APNs token" });
    }
  });

  // Unregister APNs device token
  app.delete("/api/push/unregister-apns", async (req, res) => {
    try {
      const { deviceToken } = req.body;
      if (!deviceToken) {
        return res.status(400).json({ message: "deviceToken required" });
      }
      await storage.deleteApnsToken(deviceToken);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to unregister APNs token" });
    }
  });

  // Register Android FCM token
  app.post("/api/push/register-fcm", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Not authenticated" });
      const { deviceToken } = req.body;
      if (!deviceToken || typeof deviceToken !== "string") {
        return res.status(400).json({ message: "deviceToken required" });
      }
      const saved = await storage.saveFcmToken(userId, deviceToken);
      res.json({ success: true, id: saved.id });
    } catch (error) {
      console.error("[FCM] Token registration error:", error);
      res.status(500).json({ message: "Failed to register FCM token" });
    }
  });

  // Unregister Android FCM token
  app.delete("/api/push/unregister-fcm", async (req, res) => {
    try {
      const { deviceToken } = req.body;
      if (!deviceToken) return res.status(400).json({ message: "deviceToken required" });
      await storage.deleteFcmToken(deviceToken);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to unregister FCM token" });
    }
  });

  // Clear the app icon badge by sending a silent background push with badge=0
  app.post("/api/push/clear-badge", async (req, res) => {
    try {
      const userId = getUserId(req);
      const subs = await storage.getPushSubscriptions(userId);
      const apnsSubs = subs.filter(s => s.apnsToken);
      if (apnsSubs.length > 0) {
        await Promise.all(apnsSubs.map(s => sendSilentBadgeClear(s.apnsToken!)));
      }
      res.json({ success: true, devices: apnsSubs.length });
    } catch (error) {
      res.status(500).json({ message: "Failed to clear badge" });
    }
  });

  // Check APNs config status
  app.get("/api/push/apns-status", (_req, res) => {
    res.json({ configured: isApnsConfigured() });
  });

  // Save APNs credentials to DB (admin, user 1 only)
  app.post("/api/admin/apns-credentials", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (userId !== 1) return res.status(403).json({ message: "Forbidden" });
      const { keyId, teamId, authKey } = req.body;
      if (!keyId || !teamId || !authKey) {
        return res.status(400).json({ message: "keyId, teamId, and authKey are required" });
      }
      await Promise.all([
        storage.setServerConfig("apns_key_id", String(keyId).trim()),
        storage.setServerConfig("apns_team_id", String(teamId).trim()),
        storage.setServerConfig("apns_auth_key", String(authKey).trim()),
      ]);
      clearApnsCache();
      console.log(`[APNs] Credentials updated via UI by user ${userId}`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to save credentials" });
    }
  });

  // Read APNs credentials from DB (masked)
  app.get("/api/admin/apns-credentials", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (userId !== 1) return res.status(403).json({ message: "Forbidden" });
      const [keyId, teamId, authKey] = await Promise.all([
        storage.getServerConfig("apns_key_id"),
        storage.getServerConfig("apns_team_id"),
        storage.getServerConfig("apns_auth_key"),
      ]);
      res.json({
        keyId: keyId || "",
        teamId: teamId || "",
        hasAuthKey: !!authKey,
        authKeyLength: authKey?.length ?? 0,
      });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to read credentials" });
    }
  });

  // Check if user has a registered push subscription
  app.get("/api/push/status", async (req, res) => {
    try {
      const userId = getUserId(req);
      const users = await storage.getAllUsersForReminder("");
      const user = users.find(u => u.id === userId);
      const subs = user?.subscriptions ?? [];
      res.json({
        registered: subs.length > 0,
        count: subs.length,
        hasApns: subs.some(s => !!s.apnsToken),
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to check push status" });
    }
  });

  // Send a test push notification to the current user
  app.post("/api/push/test", async (req, res) => {
    try {
      const userId = getUserId(req);
      const subs = await storage.getPushSubscriptions(userId);
      if (subs.length === 0) {
        return res.status(404).json({ message: "No registered device found. Toggle notifications off and on to register." });
      }
      const { sendApnsNotification } = await import("./apns");

      const apnsSubs = subs.filter(s => !!s.apnsToken);
      const payload = {
        title: "🏁 Test Notification",
        body: "DBrief App notifications are working correctly!",
        url: "/",
        tag: `test-${userId}-${Date.now()}`,
      };

      if (apnsSubs.length > 0) {
        // Send to the most recently registered APNs token (highest ID = last in sorted list)
        const target = apnsSubs[apnsSubs.length - 1];
        console.log(`[Push Test] Sending APNs test to token ${target.apnsToken?.slice(0, 10)}… (${apnsSubs.length} APNs subs total)`);
        const ok = await sendApnsNotification(target.apnsToken!, payload);
        if (!ok) {
          return res.status(502).json({ message: "Notification sent to Apple but delivery failed. Check APNs credentials or device token." });
        }
        return res.json({ success: true, via: "apns", tokens: apnsSubs.length });
      }

      // No APNs — try web push
      const { sendPushNotification } = await import("./notifications");
      const webSubs = subs.filter(s => !s.apnsToken && s.p256dh && s.auth);
      if (webSubs.length === 0) {
        return res.status(404).json({ message: "No registered device found. Toggle notifications off and on to register." });
      }
      let sent = 0;
      for (const sub of webSubs) {
        const ok = await sendPushNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        if (ok) sent++;
      }
      res.json({ success: sent > 0, via: "web-push", sent, total: webSubs.length });
    } catch (error: any) {
      console.error('[Push Test] Error:', error?.message);
      res.status(500).json({ message: error?.message || "Failed to send test notification" });
    }
  });

  // User Settings Routes
  app.get("/api/user/settings", async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({
        notificationsEnabled: user.notificationsEnabled,
        moodRemindersEnabled: user.moodRemindersEnabled ?? true,
        reminderTime: user.reminderTime,
        reminderTime2: user.reminderTime2,
        timezone: user.timezone,
        healthMetricsEnabled: user.healthMetricsEnabled ?? ["sleep", "readiness", "activity"],
        goalPreference: user.goalPreference || "morning",
        displayName: user.displayName ?? "",
        driverHandle: user.driverHandle ?? "",
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch user settings" });
    }
  });

  app.patch("/api/user/settings", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { notificationsEnabled, moodRemindersEnabled, reminderTime, reminderTime2, timezone, healthMetricsEnabled, goalPreference, displayName, driverHandle } = req.body;

      let cleanHandle: string | null | undefined;
      if (driverHandle !== undefined) {
        if (driverHandle === "" || driverHandle === null) {
          cleanHandle = null;
        } else {
          const h = driverHandle.toString().trim().toLowerCase().replace(/^@/, "");
          if (!/^[a-z0-9_]{3,20}$/.test(h)) {
            return res.status(400).json({ message: "Callsign must be 3-20 characters: letters, numbers, underscores only" });
          }
          const available = await storage.isHandleAvailable(h, userId);
          if (!available) return res.status(409).json({ message: "That callsign is already taken" });
          cleanHandle = h;
        }
      }

      const updatedUser = await storage.updateUserSettings(userId, {
        ...(notificationsEnabled !== undefined && { notificationsEnabled }),
        ...(moodRemindersEnabled !== undefined && { moodRemindersEnabled }),
        ...(reminderTime !== undefined && { reminderTime }),
        ...(reminderTime2 !== undefined && { reminderTime2 }),
        ...(timezone !== undefined && { timezone }),
        ...(healthMetricsEnabled !== undefined && { healthMetricsEnabled }),
        ...(goalPreference !== undefined && { goalPreference }),
        ...(displayName !== undefined && { displayName: displayName.trim() || null }),
        ...(cleanHandle !== undefined && { driverHandle: cleanHandle }),
      });

      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({
        notificationsEnabled: updatedUser.notificationsEnabled,
        moodRemindersEnabled: updatedUser.moodRemindersEnabled ?? true,
        reminderTime: updatedUser.reminderTime,
        reminderTime2: updatedUser.reminderTime2,
        timezone: updatedUser.timezone,
        healthMetricsEnabled: updatedUser.healthMetricsEnabled ?? ["sleep", "readiness", "activity"],
        driverHandle: updatedUser.driverHandle ?? null,
      });
    } catch (error) {
      console.error("Settings update error:", error);
      res.status(500).json({ message: "Failed to update settings" });
    }
  });


  // ─── Habit routes ─────────────────────────────────────────────────────────

  app.post("/api/habits/suggest-stacking", aiLimiter, async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    const { anchor, habitName } = req.body;
    if (!habitName?.trim()) return res.status(400).json({ message: "Habit name required" });
    const userPrompt = anchor?.trim()
      ? `Write one implementation intention sentence for the habit "${habitName}" anchored after "${anchor}".
Format: "After ${anchor}, I will [verb phrase]."
Rules:
- Use the anchor phrase "${anchor}" exactly as written
- Convert the habit name to a clean, natural English verb phrase (e.g. "cold shower" → "take a cold shower", "meditation" → "meditate", "100 pushups" → "do 100 pushups", "no phone" → "avoid my phone")
- Return ONLY the sentence, no quotes, no explanation`
      : `Write one implementation intention sentence for the habit "${habitName}".
Format: "I will [verb phrase]."
Convert the habit to a natural English verb phrase. Return ONLY the sentence, no quotes.`;
    try {
      const aiResp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: userPrompt }],
        max_tokens: 60,
        temperature: 0.2,
      });
      const sentence = aiResp.choices[0]?.message?.content?.trim() ?? "";
      res.json({ sentence });
    } catch (err) {
      console.error("suggest-stacking error:", err);
      res.status(500).json({ message: "Generation failed" });
    }
  });

  app.get("/api/habits", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
    try {
      const habitsWithStatus = await storage.getHabitWithTodayStatus(userId, date);
      res.json(habitsWithStatus);
    } catch (error) {
      console.error("Get habits error:", error);
      res.status(500).json({ message: "Failed to get habits" });
    }
  });

  app.post("/api/habits", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    const parsed = insertHabitSchema.safeParse({ ...req.body, userId });
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
    try {
      const habit = await storage.createHabit(parsed.data);
      res.json(habit);
    } catch (error) {
      console.error("Create habit error:", error);
      res.status(500).json({ message: "Failed to create habit" });
    }
  });

  app.patch("/api/habits/:id", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    const id = parseInt(req.params.id);
    try {
      const updated = await storage.updateHabit(id, userId, req.body);
      if (!updated) return res.status(404).json({ message: "Habit not found" });
      res.json(updated);
    } catch (error) {
      console.error("Update habit error:", error);
      res.status(500).json({ message: "Failed to update habit" });
    }
  });

  app.delete("/api/habits/:id", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    const id = parseInt(req.params.id);
    try {
      const allHabits = await storage.getHabits(userId);
      const target = allHabits.find(h => h.id === id);
      if (target && target.name.toLowerCase() === "make someone smile") {
        return res.status(403).json({ message: "This foundational habit cannot be removed." });
      }
      await storage.archiveHabit(id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Archive habit error:", error);
      res.status(500).json({ message: "Failed to delete habit" });
    }
  });

  app.post("/api/habits/:id/toggle", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    const habitId = parseInt(req.params.id);
    const date = req.body.date || new Date().toISOString().split('T')[0];
    try {
      const result = await storage.toggleHabitCompletion(habitId, userId, date);
      // Update streak whenever a habit is toggled for today — this ensures
      // users who log habits but not metric scores still build their streak.
      // updateUserStreak is idempotent: only acts if entryDate === today and
      // skips silently if the streak was already updated for today.
      updateUserStreak(userId, date).then(() => checkActivityPointFreeze(userId)).catch(e => console.error("Streak/freeze update (habit) error:", e));
      res.json(result);
    } catch (error) {
      console.error("Toggle habit error:", error);
      res.status(500).json({ message: "Failed to toggle habit" });
    }
  });

  app.get("/api/habits/:id/logs", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    const habitId = parseInt(req.params.id);
    const endDate = (req.query.end as string) || new Date().toISOString().split('T')[0];
    const startDate = req.query.start as string || (() => {
      const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().split('T')[0];
    })();
    try {
      const logs = await storage.getHabitLogsForRange(habitId, userId, startDate, endDate);
      res.json(logs);
    } catch (error) {
      console.error("Get habit logs error:", error);
      res.status(500).json({ message: "Failed to get habit logs" });
    }
  });

  // ── User Connections (Squad / Accountability Pairs) ──────────────────────────

  app.get("/api/users/check-handle", async (req, res) => {
    try {
      const handle = String(req.query.handle ?? "").trim().toLowerCase().replace(/^@/, "");
      if (!handle || !/^[a-z0-9_]{3,20}$/.test(handle)) {
        return res.json({ available: false, error: "Handle must be 3-20 characters: letters, numbers, underscores only" });
      }
      const userId = (req.session as any)?.userId;
      const available = await storage.isHandleAvailable(handle, userId);
      res.json({ available });
    } catch (error) {
      res.status(500).json({ message: "Check failed" });
    }
  });

  app.get("/api/users/search", async (req, res) => {
    try {
      const userId = getUserId(req);
      const q = String(req.query.q ?? "").trim();
      if (q.length < 2) return res.json([]);
      const results = await storage.searchUsers(q, userId);
      res.json(results.map(u => ({ id: u.id, driverHandle: u.driverHandle, displayName: u.displayName })));
    } catch (error) {
      res.status(500).json({ message: "Search failed" });
    }
  });

  app.get("/api/connections", async (req, res) => {
    try {
      const userId = getUserId(req);
      const connections = await storage.getConnectionsByUser(userId);
      res.json(connections);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch connections" });
    }
  });

  app.get("/api/connections/stats", async (req, res) => {
    try {
      const userId = getUserId(req);
      const stats = await storage.getAllConnectionStats(userId);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch connection stats" });
    }
  });

  app.get("/api/squad/leaderboard", async (req, res) => {
    try {
      const userId = getUserId(req);
      const sortBy = (["streak", "consistency", "score"].includes(req.query.sortBy as string)
        ? req.query.sortBy : "streak") as "streak" | "consistency" | "score";
      const board = await storage.getLeaderboard(userId, sortBy);
      res.json(board);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch leaderboard" });
    }
  });

  app.post("/api/connections/request", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { handle } = req.body;
      if (!handle) return res.status(400).json({ message: "Handle is required" });

      const cleanHandle = handle.toString().trim().toLowerCase().replace(/^@/, "");
      const target = await storage.getUserByHandle(cleanHandle);
      if (!target) return res.status(404).json({ message: "Driver not found" });
      if (target.id === userId) return res.status(400).json({ message: "You can't connect with yourself" });

      // Check if connection already exists
      const existing = await storage.getConnectionsByUser(userId);
      const already = existing.find(c =>
        (c.requesterId === userId && c.receiverId === target.id) ||
        (c.requesterId === target.id && c.receiverId === userId)
      );
      if (already) {
        const msg = already.status === "accepted" ? "Already connected" :
                    already.status === "pending" ? "Request already sent" : "Request previously declined";
        return res.status(409).json({ message: msg, status: already.status });
      }

      const connection = await storage.sendConnectionRequest(userId, target.id);

      // Notify the receiver
      const myUser = await storage.getUser(userId);
      const senderName = myUser?.displayName || myUser?.username || "Someone";
      await notifyUser(target.id, {
        title: "New Connection Request",
        body: `${senderName} wants to connect with you on DBrief App`,
        url: "/squad?tab=crew",
        tag: `conn-request-${connection.id}`,
      });

      res.json(connection);
    } catch (error) {
      res.status(500).json({ message: "Failed to send connection request" });
    }
  });

  app.post("/api/connections/:id/accept", async (req, res) => {
    try {
      const userId = getUserId(req);
      const connectionId = Number(req.params.id);
      const conn = await storage.getConnectionById(connectionId);
      if (!conn || conn.receiverId !== userId) {
        return res.status(403).json({ message: "Not authorised to accept this request" });
      }
      const updated = await storage.acceptConnection(connectionId, userId);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to accept connection" });
    }
  });

  app.post("/api/connections/:id/decline", async (req, res) => {
    try {
      const userId = getUserId(req);
      const connectionId = Number(req.params.id);
      const conn = await storage.getConnectionById(connectionId);
      if (!conn || conn.receiverId !== userId) {
        return res.status(403).json({ message: "Not authorised" });
      }
      await storage.declineConnection(connectionId, userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to decline connection" });
    }
  });

  app.delete("/api/connections/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      const connectionId = Number(req.params.id);
      await storage.removeConnection(connectionId, userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to remove connection" });
    }
  });

  // ── Connection nudge ──────────────────────────────────────────────────────
  // In-memory cooldown: only one nudge per connection per hour
  const nudgeCooldowns = new Map<number, number>();

  app.post("/api/connections/:id/nudge", async (req, res) => {
    try {
      const userId = getUserId(req);
      const connectionId = Number(req.params.id);

      const conn = await storage.getConnectionById(connectionId);
      if (!conn) return res.status(404).json({ message: "Connection not found" });
      if (conn.requesterId !== userId) {
        return res.status(403).json({ message: "Only the sender can nudge" });
      }
      if (conn.status !== "pending") {
        return res.status(400).json({ message: "Connection is no longer pending" });
      }

      // Rate-limit: 1 nudge per hour per connection
      const last = nudgeCooldowns.get(connectionId) ?? 0;
      const cooldownMs = 60 * 60 * 1000;
      const remaining = cooldownMs - (Date.now() - last);
      if (remaining > 0) {
        const mins = Math.ceil(remaining / 60000);
        return res.status(429).json({ message: `You can nudge again in ${mins} min${mins !== 1 ? "s" : ""}` });
      }

      nudgeCooldowns.set(connectionId, Date.now());

      const myUser = await storage.getUser(userId);
      const senderName = myUser?.displayName || myUser?.username || "Someone";
      await notifyUser(conn.receiverId, {
        title: "Crew Request Reminder",
        body: `${senderName} is still waiting for you to join their crew on DBrief App`,
        url: "/squad?tab=crew",
        tag: `conn-nudge-${connectionId}`,
      });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to send nudge" });
    }
  });

  // ── Challenge routes ──────────────────────────────────────────────────────

  // List challenges for current user
  app.get("/api/challenges", async (req, res) => {
    try {
      const userId = getUserId(req);
      // Client passes its local date as ?date=YYYY-MM-DD so "today" is always correct
      // regardless of the stored timezone (handles travel / timezone changes immediately).
      const clientDate = typeof req.query.date === "string" ? req.query.date : undefined;
      const challenges = await storage.getChallengesForUser(userId, clientDate);
      res.json(challenges);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch challenges" });
    }
  });

  // Create a new challenge
  app.post("/api/challenges", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { title, description, type, habitName, habitEmoji, metricName, visibility, startDate, endDate, frequency, inviteeUsernames, creatorCommitment, creatorReminderTime } = req.body;
      if (!title || !type || !startDate || !endDate) {
        return res.status(400).json({ message: "title, type, startDate, endDate are required" });
      }
      if (!["habit", "score"].includes(type)) {
        return res.status(400).json({ message: "type must be habit or score" });
      }
      // Org-scoped challenges may only be created via the corporate admin route
      if (visibility === "org") {
        return res.status(400).json({ message: "visibility 'org' is only available through corporate admin routes" });
      }
      if (type === "habit" && !habitName) {
        return res.status(400).json({ message: "habitName is required for habit challenges" });
      }
      if (type === "score" && !metricName) {
        return res.status(400).json({ message: "metricName is required for score challenges" });
      }

      const challenge = await storage.createChallenge(userId, {
        creatorId: userId,
        title,
        description: description ?? null,
        type,
        habitName: habitName ?? null,
        habitEmoji: habitEmoji ?? null,
        metricName: metricName ?? null,
        visibility: visibility ?? "invite_only",
        frequency: frequency ?? "daily",
        startDate,
        endDate,
      }, creatorCommitment ?? undefined, creatorReminderTime ?? undefined);

      if (visibility === "open") {
        // Auto-invite every accepted connection
        const conns = await storage.getConnectionsByUser(userId);
        for (const conn of conns.filter(c => c.status === "accepted")) {
          const targetId = conn.requesterId === userId ? conn.receiverId : conn.requesterId;
          await storage.inviteToChallenge(challenge.id, targetId, userId);
          await notifyUser(targetId, {
            title: "New Challenge Invite",
            body: "You've been invited to a DBrief App challenge",
            url: "/squad?tab=challenges",
            tag: `challenge-invite-${challenge.id}-${targetId}`,
          });
        }
      } else if (Array.isArray(inviteeUsernames) && inviteeUsernames.length > 0) {
        // invite_only — invite the explicitly chosen users server-side so it's atomic
        console.log(`[Challenge] Creating invite-only challenge ${challenge.id}, inviting: ${inviteeUsernames.join(", ")}`);
        for (const username of inviteeUsernames) {
          const target = await storage.getUserByUsername(username as string);
          if (!target) {
            console.warn(`[Challenge] Invitee not found: ${username}`);
            continue;
          }
          await storage.inviteToChallenge(challenge.id, target.id, userId);
          await notifyUser(target.id, {
            title: "New Challenge Invite",
            body: "You've been invited to a DBrief App challenge",
            url: "/squad?tab=challenges",
            tag: `challenge-invite-${challenge.id}-${target.id}`,
          });
          console.log(`[Challenge] Invited user ${target.id} (${username}) to challenge ${challenge.id}`);
        }
      }

      res.json(challenge);
    } catch (error) {
      console.error("Failed to create challenge:", error);
      res.status(500).json({ message: "Failed to create challenge" });
    }
  });

  // Get leaderboard for a challenge
  app.get("/api/challenges/:id/leaderboard", async (req, res) => {
    try {
      const userId = getUserId(req);
      const challengeId = parseInt(req.params.id);

      // Org-scoped challenges: only active members of the owning org may view.
      // Guard is skipped entirely when CORPORATE_TIER_ENABLED is off so that
      // the org_challenges table is never queried in non-corporate environments.
      if (CORPORATE_ENABLED) {
        const challenge = await storage.getChallengeById(challengeId);
        if (challenge?.visibility === "org") {
          const orgChalRows = await db
            .select({ orgId: orgChallenges.orgId })
            .from(orgChallenges)
            .where(eq(orgChallenges.challengeId, challengeId));
          if (orgChalRows.length > 0) {
            const owningOrgId = orgChalRows[0].orgId;
            const membership = await storage.getOrgMembershipByUser(userId);
            const isOrgAdmin = (await storage.getOrganisationByAdmin(userId))?.id === owningOrgId;
            if (!isOrgAdmin && (!membership || membership.orgId !== owningOrgId)) {
              return res.status(403).json({ message: "This leaderboard is restricted to organisation members" });
            }
          }
        }
      }

      const board = await storage.getChallengeLeaderboard(challengeId, userId);
      res.json(board);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch challenge leaderboard" });
    }
  });

  // Join a challenge (optionally with a personal commitment for habit challenges)
  app.post("/api/challenges/:id/join", async (req, res) => {
    try {
      const userId = getUserId(req);
      const challengeId = parseInt(req.params.id);
      const { commitment, reminderTime } = req.body;
      const challenge = await storage.getChallengeById(challengeId);
      if (!challenge) return res.status(404).json({ message: "This challenge no longer exists" });

      // Org-scoped challenges: only active members of the owning org may join.
      // Skipped entirely when CORPORATE_TIER_ENABLED is off to avoid querying
      // corporate tables in non-corporate environments.
      if (CORPORATE_ENABLED && challenge.visibility === "org") {
        const orgChalRows = await db
          .select({ orgId: orgChallenges.orgId })
          .from(orgChallenges)
          .where(eq(orgChallenges.challengeId, challengeId));
        if (orgChalRows.length > 0) {
          const owningOrgId = orgChalRows[0].orgId;
          const membership = await storage.getOrgMembershipByUser(userId);
          const isOrgAdmin = (await storage.getOrganisationByAdmin(userId))?.id === owningOrgId;
          if (!isOrgAdmin && (!membership || membership.orgId !== owningOrgId)) {
            return res.status(403).json({ message: "This challenge is restricted to organisation members" });
          }
        }
      }

      await storage.joinChallenge(challengeId, userId, commitment ?? undefined, reminderTime ?? undefined);

      // For score challenges, auto-install the metric in the user's daily scores panel
      let metricInstalled = false;
      if (challenge.type === "score" && challenge.metricName) {
        const existingMetrics = await storage.getUserMetrics(userId);
        const alreadyExists = existingMetrics.some(
          m => m.name.toLowerCase() === challenge.metricName!.toLowerCase() && m.isActive
        );
        if (!alreadyExists) {
          const COLORS = ["#4F46E5","#10B981","#F59E0B","#EC4899","#8B5CF6","#EF4444","#06B6D4","#84CC16","#F97316","#6366F1"];
          const usedColors = new Set(existingMetrics.map(m => m.color));
          const color = COLORS.find(c => !usedColors.has(c)) || COLORS[existingMetrics.length % COLORS.length];
          await storage.createUserMetric({ userId, name: challenge.metricName, color, maxValue: 100, isDefault: false, isActive: true });
          metricInstalled = true;
        }
      }

      res.json({ success: true, metricInstalled, metricName: challenge.metricName });
    } catch (error) {
      res.status(500).json({ message: "Failed to join challenge" });
    }
  });

  // Decline a challenge invitation
  app.post("/api/challenges/:id/decline", async (req, res) => {
    try {
      const userId = getUserId(req);
      const challengeId = parseInt(req.params.id);
      await storage.declineChallenge(challengeId, userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to decline challenge" });
    }
  });

  // Leave a challenge
  app.post("/api/challenges/:id/leave", async (req, res) => {
    try {
      const userId = getUserId(req);
      const challengeId = parseInt(req.params.id);
      await storage.leaveChallenge(challengeId, userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to leave challenge" });
    }
  });

  // Delete a challenge (creator only)
  app.delete("/api/challenges/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      const challengeId = parseInt(req.params.id);
      await storage.deleteChallenge(challengeId, userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete challenge" });
    }
  });

  // Edit a challenge (creator only — title and/or end date)
  app.patch("/api/challenges/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      const challengeId = parseInt(req.params.id);
      const { title, endDate } = req.body;
      if (!title && !endDate) return res.status(400).json({ message: "Nothing to update" });
      const updated = await storage.updateChallenge(challengeId, userId, {
        ...(title ? { title: String(title).trim() } : {}),
        ...(endDate ? { endDate: String(endDate) } : {}),
      });
      if (!updated) return res.status(403).json({ message: "Not found or not authorised" });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update challenge" });
    }
  });

  // Update participant's personal reminder time for a challenge
  app.patch("/api/challenges/:id/reminder", async (req, res) => {
    try {
      const userId = getUserId(req);
      const challengeId = parseInt(req.params.id);
      const { reminderTime } = req.body; // "HH:MM" string or null to disable
      await storage.updateChallengeParticipantReminder(challengeId, userId, reminderTime ?? null);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to update reminder" });
    }
  });

  // Log today's entry for a challenge
  app.post("/api/challenges/:id/log", async (req, res) => {
    try {
      const userId = getUserId(req);
      const challengeId = parseInt(req.params.id);
      const { date, value } = req.body;
      if (value === undefined || value === null) {
        return res.status(400).json({ message: "value is required" });
      }
      const today = new Date().toISOString().split("T")[0];
      const logDate = date ?? today;
      await storage.logChallengeEntry(challengeId, userId, logDate, value);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to log challenge entry" });
    }
  });

  // List pending (invited but not yet responded) users for a challenge — creator only
  app.get("/api/challenges/:id/invited", async (req, res) => {
    try {
      const userId = getUserId(req);
      const challengeId = parseInt(req.params.id);
      const challenge = await storage.getChallengeById(challengeId);
      if (!challenge) return res.status(404).json({ message: "Challenge not found" });
      if (challenge.creatorId !== userId) return res.status(403).json({ message: "Forbidden" });

      const rows = await db
        .select({
          userId: challengeParticipants.userId,
          status: challengeParticipants.status,
        })
        .from(challengeParticipants)
        .where(
          and(
            eq(challengeParticipants.challengeId, challengeId),
            eq(challengeParticipants.status, "invited"),
          )
        );

      const result = await Promise.all(
        rows.map(async (r) => {
          const u = await storage.getUser(r.userId);
          return { userId: r.userId, username: u?.username ?? "", displayName: u?.displayName ?? null };
        })
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch pending invites" });
    }
  });

  // Invite a connection to a challenge
  app.post("/api/challenges/:id/invite", async (req, res) => {
    try {
      const userId = getUserId(req);
      const challengeId = parseInt(req.params.id);
      const { username } = req.body;
      if (!username) return res.status(400).json({ message: "username required" });
      const target = await storage.getUserByUsername(username);
      if (!target) return res.status(404).json({ message: "User not found" });

      // Org-scoped challenges cannot be used to invite arbitrary users.
      // Skipped entirely when CORPORATE_TIER_ENABLED is off.
      if (CORPORATE_ENABLED) {
        const inviteChallenge = await storage.getChallengeById(challengeId);
        if (inviteChallenge?.visibility === "org") {
          const orgChalRows = await db
            .select({ orgId: orgChallenges.orgId })
            .from(orgChallenges)
            .where(eq(orgChallenges.challengeId, challengeId));
          if (orgChalRows.length > 0) {
            const owningOrgId = orgChalRows[0].orgId;
            const targetMembership = await storage.getOrgMembershipByUser(target.id);
            const isTargetAdmin = (await storage.getOrganisationByAdmin(target.id))?.id === owningOrgId;
            if (!isTargetAdmin && (!targetMembership || targetMembership.orgId !== owningOrgId)) {
              return res.status(403).json({ message: "You can only invite organisation members to this challenge" });
            }
          }
        }
      }

      try {
        await storage.inviteToChallenge(challengeId, target.id, userId);
      } catch (inviteErr: any) {
        // Distinguish between auth failure and other errors
        if (inviteErr?.message === "Inviter is not a joined participant") {
          return res.status(403).json({ message: "You must be a participant to invite others" });
        }
        throw inviteErr;
      }

      // Notify the invitee
      const [inviter] = await Promise.all([
        storage.getUser(userId),
      ]);
      const inviterName = inviter?.displayName || inviter?.username || "Someone";
      await notifyUser(target.id, {
        title: "New Challenge Invite",
        body: "You've been invited to a DBrief App challenge",
        url: "/squad?tab=challenges",
        tag: `challenge-invite-${challengeId}-${target.id}`,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Failed to invite user:", error);
      res.status(500).json({ message: "Failed to invite user" });
    }
  });

  registerChatRoutes(app);
  registerDebriefRoutes(app);
  registerSubscriptionRoutes(app);
  registerCorporateRoutes(app);
  registerRealtimeVoiceWS(httpServer);

  return httpServer;
}
