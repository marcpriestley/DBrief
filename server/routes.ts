import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertJournalEntrySchema, insertDailyScoreSchema, 
  insertUserMetricSchema, insertAIInsightSchema,
  insertPushSubscriptionSchema
} from "@shared/schema";
import OpenAI from "openai";
import { getOuraDataForDate } from "./oura";
import { sendPushNotification } from "./notifications";
import bcrypt from "bcrypt";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_ENV_VAR || "default_key" 
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
      
      // Initialize default metrics for new user
      const defaultMetrics = [
        { userId: user.id, name: "Happiness", color: "#10B981", maxValue: 100, isDefault: true, isActive: true },
        { userId: user.id, name: "Productivity", color: "#4F46E5", maxValue: 100, isDefault: true, isActive: true },
        { userId: user.id, name: "Energy", color: "#F59E0B", maxValue: 100, isDefault: true, isActive: true },
        { userId: user.id, name: "Nutrition", color: "#EC4899", maxValue: 100, isDefault: true, isActive: true },
        { userId: user.id, name: "Sleep Quality", color: "#8B5CF6", maxValue: 100, isDefault: false, isActive: true },
        { userId: user.id, name: "Readiness", color: "#EF4444", maxValue: 100, isDefault: false, isActive: true },
      ];
      for (const metric of defaultMetrics) {
        await storage.createUserMetric(metric);
      }
      
      // Initialize streak
      await storage.createStreak({ userId: user.id, currentStreak: 0, longestStreak: 0, lastEntryDate: null });
      
      // Initialize default goal template - "Make my bed" is always the first default
      await storage.createGoalTemplate({ userId: user.id, title: "Make my bed", sortOrder: 0, isActive: true });
      
      (req.session as any).userId = user.id;
      res.json({ id: user.id, username: user.username });
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
      res.json({ id: user.id, username: user.username });
    } catch (error) {
      res.status(500).json({ message: "Failed to sign in" });
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
      res.json({ id: user.id, username: user.username });
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

  function getUserId(req: any): number {
    const userId = (req.session as any)?.userId;
    if (!userId) {
      throw new Error("Not authenticated");
    }
    return userId;
  }

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
      const validatedData = insertUserMetricSchema.parse({ ...req.body, userId });
      const metric = await storage.createUserMetric(validatedData);
      res.json(metric);
    } catch (error) {
      res.status(400).json({ message: "Failed to create user metric" });
    }
  });

  app.put("/api/user-metrics/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const metric = await storage.updateUserMetric(parseInt(id), updates);
      
      if (!metric) {
        return res.status(404).json({ message: "Metric not found" });
      }
      
      res.json(metric);
    } catch (error) {
      res.status(400).json({ message: "Failed to update user metric" });
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
      const { title } = req.body;
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
      const todayGoals = await storage.getDailyGoals(userId, todayStr);
      if (todayGoals.length > 0) {
        const alreadyExists = todayGoals.some(g => g.goalTemplateId === template.id);
        if (!alreadyExists) {
          await storage.createDailyGoal({
            userId,
            date: todayStr,
            goalTemplateId: template.id,
            title: template.title,
            completed: false,
          });
        }
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
      const streak = await storage.getUserStreak(userId);
      res.json(streak || { currentStreak: 0, longestStreak: 0 });
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

  app.post("/api/ai-insights/generate", async (req, res) => {
    try {
      const userId = getUserId(req);
      
      const entries = await storage.getJournalEntriesByUser(userId);
      const scores = await storage.getDailyScoresByUser(userId);
      const streak = await storage.getUserStreak(userId);
      
      if (entries.length === 0 && scores.length === 0) {
        return res.json({ insight: null });
      }

      const recentEntries = entries.slice(0, 14);
      const recentScores = scores.filter(score => {
        const scoreDate = new Date(score.date);
        const twoWeeksAgo = new Date();
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
        return scoreDate >= twoWeeksAgo;
      });

      const scoresByDate: Record<string, Record<string, number>> = {};
      recentScores.forEach(score => {
        if (!scoresByDate[score.date]) scoresByDate[score.date] = {};
        scoresByDate[score.date][score.metricName] = score.value;
      });

      const prompt = `
You are a personal wellness coach analyzing a user's daily tracking data. All scores are on a 0-100 scale.

JOURNAL ENTRIES (last 14 days):
${recentEntries.length > 0 ? recentEntries.map(entry => `${entry.date}: ${entry.content}`).join('\n') : 'No journal entries yet.'}

DAILY SCORES BY DATE (0-100 scale):
${Object.entries(scoresByDate).map(([date, scores]) => 
  `${date}: ${Object.entries(scores).map(([name, val]) => `${name}=${val}`).join(', ')}`
).join('\n') || 'No scores yet.'}

STREAK: ${streak?.currentStreak || 0} days (longest: ${streak?.longestStreak || 0})

Analyze this data to provide ONE actionable insight that will help the user improve their habits and outcomes. Focus on:
1. Correlations between different metrics (e.g., sleep affecting productivity)
2. Patterns in journal entries that relate to score changes
3. Specific, practical suggestions they can implement tomorrow
4. Encouragement based on their streak and progress

Keep the insight warm, specific, and actionable (2-3 sentences). Suggest 2-3 relevant tags.

Respond in JSON: { "insight": "your insight here", "tags": ["tag1", "tag2", "tag3"] }
      `;

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

  // Oura Integration
  app.post("/api/oura/sync/:date", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { date } = req.params;
      
      const ouraData = await getOuraDataForDate(date);
      
      const updatedScores = [];
      
      if (ouraData.sleepScore !== undefined) {
        const sleepScore = await storage.updateDailyScore(userId, date, "Sleep Quality", ouraData.sleepScore, true);
        updatedScores.push(sleepScore);
      }
      
      if (ouraData.readinessScore !== undefined) {
        const readiness = await storage.updateDailyScore(userId, date, "Readiness", ouraData.readinessScore, true);
        updatedScores.push(readiness);
      }
      
      res.json({ success: true, data: ouraData, updatedScores });
    } catch (error) {
      console.error("Oura sync error:", error);
      res.status(500).json({ message: "Failed to sync Oura data", error: String(error) });
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
        reminderTime: user.reminderTime,
        timezone: user.timezone
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch user settings" });
    }
  });

  app.patch("/api/user/settings", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { notificationsEnabled, reminderTime, timezone } = req.body;

      const updatedUser = await storage.updateUserSettings(userId, {
        ...(notificationsEnabled !== undefined && { notificationsEnabled }),
        ...(reminderTime !== undefined && { reminderTime }),
        ...(timezone !== undefined && { timezone })
      });

      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({
        notificationsEnabled: updatedUser.notificationsEnabled,
        reminderTime: updatedUser.reminderTime,
        timezone: updatedUser.timezone
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

  return httpServer;
}
