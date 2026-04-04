import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertJournalEntrySchema, insertDailyScoreSchema, 
  insertUserMetricSchema, insertAIInsightSchema,
  insertPushSubscriptionSchema, insertHabitSchema,
  infiniteGoals, longTermGoals,
} from "@shared/schema";
import OpenAI from "openai";
import type { HealthData } from "./oura";
import { sendPushNotification, getVapidPublicKey } from "./notifications";
import { sendApnsNotification, sendSilentBadgeClear, isApnsConfigured, clearApnsCache } from "./apns";
import bcrypt from "bcrypt";
import { OAuth2Client } from "google-auth-library";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { registerChatRoutes } from "./replit_integrations/chat/routes";
import { registerDebriefRoutes } from "./debrief-routes";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import { encrypt, decrypt } from "./encryption";

const openai = new OpenAI({ 
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  registerObjectStorageRoutes(app);

  // Authentication
  app.post("/api/auth/register", async (req, res) => {
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

  app.post("/api/auth/login", async (req, res) => {
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

      const googleClient = new OAuth2Client(clientId);
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId });
      const payload = ticket.getPayload();
      if (!payload?.email) return res.status(400).json({ message: "No email in Google token" });

      const email = payload.email.toLowerCase();
      let user = await storage.getUserByUsername(email);

      if (!user) {
        // Create new account — store a random unusable password (Google users authenticate via token)
        const randomPw = await bcrypt.hash(Math.random().toString(36), 10);
        user = await storage.createUser({ username: email, password: randomPw });
        await storage.createStreak({ userId: user.id, currentStreak: 0, longestStreak: 0, lastEntryDate: null });
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
      res.json({
        id: user.id,
        username: user.username,
        displayName: user.displayName ?? null,
        hasCompletedOnboarding: user.hasCompletedOnboarding ?? false,
        journalPreference: user.journalPreference ?? "evening",
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get user" });
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

  app.post("/api/onboarding/complete", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { journalPreference, goalPreference, userProfile, displayName } = req.body;
      const pref = journalPreference === "morning" ? "morning" : "evening";
      const goalPref = goalPreference === "evening" ? "evening" : "morning";
      const updatedUser = await storage.updateUserSettings(userId, {
        hasCompletedOnboarding: true,
        journalPreference: pref,
        goalPreference: goalPref,
        ...(userProfile && { userProfile }),
        ...(displayName && { displayName: displayName.trim() }),
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
        // Update existing entry
        const updatedEntry = await storage.updateJournalEntry(existingEntry.id, {
          content: validatedData.content,
          isVoiceEntry: validatedData.isVoiceEntry,
        });
        
        // Removed streak update from journal entries - now tracked by score inputs
        
        res.json(updatedEntry);
      } else {
        // Create new entry
        const entry = await storage.createJournalEntry(validatedData);
        
        // Removed streak update from journal entries - now tracked by score inputs
        
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
      
      const score = await storage.updateDailyScore(
        userId, 
        validatedData.date, 
        validatedData.metricName, 
        validatedData.value
      );
      
      // Update streak based on score inputs (only for user inputs, not auto-synced)
      if (!validatedData.isAutoSynced) {
        await updateUserStreak(userId, validatedData.date);
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
      const [streak, recentActiveDays] = await Promise.all([
        storage.getUserStreak(userId),
        storage.getRecentActiveDays(userId),
      ]);
      const base = streak || { currentStreak: 0, longestStreak: 0, lastEntryDate: null };
      // Insights unlock rules:
      //   Phase 1 — initial unlock: longestStreak must reach 7 (one-time gate)
      //   Phase 2 — ongoing access: recentActiveDays >= 5 (allows 1 missed day)
      const everUnlocked = (base.longestStreak ?? 0) >= 7;
      const insightsUnlocked = everUnlocked && recentActiveDays >= 5;
      res.json({ ...base, recentActiveDays, insightsUnlocked });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch streak" });
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
      const { text, voice = "nova" } = req.body;
      if (!text || typeof text !== "string") return res.status(400).json({ message: "text required" });
      const truncated = text.slice(0, 4096);
      const mp3 = await openai.audio.speech.create({
        model: "tts-1",
        voice: voice as any,
        input: truncated,
        response_format: "mp3",
      });
      const buffer = Buffer.from(await mp3.arrayBuffer());
      res.set("Content-Type", "audio/mpeg");
      res.set("Content-Length", String(buffer.length));
      res.set("Cache-Control", "no-store");
      res.send(buffer);
    } catch (e: any) {
      console.error("[TTS] Error:", e?.message);
      res.status(500).json({ message: "TTS failed" });
    }
  });

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
      
      const entries = await storage.getJournalEntriesByUser(userId);
      const scores = await storage.getDailyScoresByUser(userId);
      
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const recentEntries = entries.filter(e => e.date >= fourteenDaysAgo);
      const recentScores = scores.filter(s => s.date >= fourteenDaysAgo);

      // Exclude zeros — a score of 0 almost always means no input was logged, not a
      // deliberate zero. Only include scores that were actually entered by the user.
      const scoresByDate: Record<string, Record<string, number>> = {};
      recentScores.filter(s => s.value > 0).forEach(score => {
        if (!scoresByDate[score.date]) scoresByDate[score.date] = {};
        scoresByDate[score.date][score.metricName] = score.value;
      });

      const moodCheckins = await storage.getMoodCheckinsForDateRange(userId, fourteenDaysAgo, todayStr);
      const moodByDate: Record<string, number[]> = {};
      moodCheckins.forEach(m => {
        if (!moodByDate[m.date]) moodByDate[m.date] = [];
        moodByDate[m.date].push(m.value);
      });

      const goals = await storage.getGoalsForDateRange(userId, fourteenDaysAgo, todayStr);
      const goalsByDate: Record<string, { total: number; completed: number }> = {};
      goals.forEach(g => {
        if (!goalsByDate[g.date]) goalsByDate[g.date] = { total: 0, completed: 0 };
        goalsByDate[g.date].total++;
        if (g.completed) goalsByDate[g.date].completed++;
      });

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

      const prompt = `You are an experienced performance analyst. Analyze the user's daily tracking data below. All scores are on a 0-100 scale.

IMPORTANT: Only scores that were explicitly logged by the user are included below. A missing score for a date means the user did not log it that day — do NOT assume it was zero or poor performance. Only analyse dates and metrics that have actual data.

JOURNAL ENTRIES (last 14 days):
${recentEntries.length > 0 ? recentEntries.map(entry => `${relativeDate(entry.date)}: ${entry.content}`).join('\n') : 'No journal entries yet.'}

DAILY SCORES BY DATE (0-100 scale, only days with logged data):
${Object.entries(scoresByDate).map(([date, s]) => 
  `${relativeDate(date)}: ${Object.entries(s).map(([name, val]) => `${name}=${val}`).join(', ')}`
).join('\n') || 'No scores logged yet.'}

MOOD CHECK-INS BY DATE (0-100 scale, daily averages):
${Object.entries(moodByDate).map(([date, vals]) => 
  `${relativeDate(date)}: avg=${Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)} (${vals.length} check-ins)`
).join('\n') || 'No mood check-ins yet.'}

GOALS COMPLETION BY DATE:
${Object.entries(goalsByDate).map(([date, g]) => 
  `${relativeDate(date)}: ${g.completed}/${g.total} completed (${Math.round(g.completed / g.total * 100)}%)`
).join('\n') || 'No goals data yet.'}

STREAK: ${streak?.currentStreak || 0} days (longest: ${streak?.longestStreak || 0})

As a data analyst and wellbeing coach, provide ONE deep, actionable insight. Focus on:
1. Cross-metric correlations (e.g., how sleep quality relates to mood, productivity, or goal completion)
2. Patterns in journal sentiment that correlate with score fluctuations
3. Goal completion trends and their relationship to overall wellbeing
4. One specific, practical recommendation they can implement immediately
5. Acknowledge their streak commitment warmly

IMPORTANT DATE LANGUAGE: When referencing when something happened, always use conversational relative references like "yesterday", "last Tuesday", "on Friday" — NEVER use numerical date formats like "2026-03-20" or "March 20". Write as if speaking to someone naturally.

Keep the insight specific to THEIR data. 2-4 sentences. Suggest 2-3 tags.

Respond in JSON: { "insight": "your insight here", "tags": ["tag1", "tag2", "tag3"] }`;

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
        "Sleep Quality":      { color: "#7C3AED", maxValue: 100 },
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

      if (incomingMetrics.length === 0) {
        return res.json({ success: true, updatedScores: [] });
      }

      const existingMetrics = await storage.getUserMetrics(userId);
      const existingByName = new Map(existingMetrics.filter(m => m.isActive).map(m => [m.name, m]));

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
      const users = await storage.getAllUsersForReminder("");
      const user = users.find(u => u.id === userId);
      const subs = user?.subscriptions ?? [];
      if (subs.length === 0) {
        return res.status(404).json({ message: "No registered device found. Toggle notifications off and on to register." });
      }
      const { dispatchToUser } = await import("./notifications");
      await dispatchToUser(subs, {
        title: "🏁 Test Notification",
        body: "DBrief notifications are working correctly!",
        url: "/",
        tag: `test-${userId}-${Date.now()}`,
      });
      res.json({ success: true, sent: subs.length });
    } catch (error: any) {
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
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch user settings" });
    }
  });

  app.patch("/api/user/settings", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { notificationsEnabled, moodRemindersEnabled, reminderTime, reminderTime2, timezone, healthMetricsEnabled, goalPreference, displayName } = req.body;

      const updatedUser = await storage.updateUserSettings(userId, {
        ...(notificationsEnabled !== undefined && { notificationsEnabled }),
        ...(moodRemindersEnabled !== undefined && { moodRemindersEnabled }),
        ...(reminderTime !== undefined && { reminderTime }),
        ...(reminderTime2 !== undefined && { reminderTime2 }),
        ...(timezone !== undefined && { timezone }),
        ...(healthMetricsEnabled !== undefined && { healthMetricsEnabled }),
        ...(goalPreference !== undefined && { goalPreference }),
        ...(displayName !== undefined && { displayName: displayName.trim() || null }),
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
        healthMetricsEnabled: updatedUser.healthMetricsEnabled ?? ["sleep", "readiness", "activity"]
      });
    } catch (error) {
      console.error("Settings update error:", error);
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  // Test notification endpoint (for debugging)
  app.post("/api/push/test", async (req, res) => {
    try {
      const userId = getUserId(req);
      const subscriptions = await storage.getPushSubscriptions(userId);

      if (subscriptions.length === 0) {
        return res.status(404).json({ message: "No push subscriptions found" });
      }

      const results = await Promise.all(
        subscriptions.map(sub => 
          sendPushNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth }
            },
            {
              title: '🧪 Test Notification',
              body: 'This is a test notification from DBrief!',
              url: '/'
            }
          )
        )
      );

      const successCount = results.filter(Boolean).length;
      res.json({ 
        success: true, 
        sent: successCount, 
        total: subscriptions.length 
      });
    } catch (error) {
      console.error("Test notification error:", error);
      res.status(500).json({ message: "Failed to send test notification" });
    }
  });

  async function updateUserStreak(userId: number, entryDate: string) {
    try {
      let streak = await storage.getUserStreak(userId);
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      if (!streak) {
        // Create new streak
        await storage.createStreak({
          userId,
          currentStreak: 1,
          longestStreak: 1,
          lastEntryDate: entryDate,
        });
        return;
      }

      if (entryDate === today) {
        // Entry for today
        if (streak.lastEntryDate === yesterdayStr) {
          // Continuing streak
          const newCurrentStreak = (streak.currentStreak ?? 0) + 1;
          await storage.updateStreak(userId, {
            currentStreak: newCurrentStreak,
            longestStreak: Math.max(streak.longestStreak ?? 0, newCurrentStreak),
            lastEntryDate: entryDate,
          });
        } else if (streak.lastEntryDate !== today) {
          // Starting new streak
          await storage.updateStreak(userId, {
            currentStreak: 1,
            lastEntryDate: entryDate,
          });
        }
      }
    } catch (error) {
      console.error("Failed to update streak:", error);
    }
  }

  // ─── Habit routes ─────────────────────────────────────────────────────────

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

  registerChatRoutes(app);
  registerDebriefRoutes(app);

  return httpServer;
}
