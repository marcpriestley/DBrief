import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertJournalEntrySchema, insertDailyScoreSchema, 
  insertUserMetricSchema, insertAIInsightSchema 
} from "@shared/schema";
import OpenAI from "openai";
import { getOuraDataForDate } from "./oura";

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_ENV_VAR || "default_key" 
});

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // Journal Entries
  app.get("/api/journal-entries", async (req, res) => {
    try {
      const userId = 1; // Using default user for demo
      const entries = await storage.getJournalEntriesByUser(userId);
      res.json(entries);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch journal entries" });
    }
  });

  app.get("/api/journal-entries/:date", async (req, res) => {
    try {
      const userId = 1;
      const { date } = req.params;
      const entry = await storage.getJournalEntryByDate(userId, date);
      res.json(entry || null);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch journal entry" });
    }
  });

  app.post("/api/journal-entries", async (req, res) => {
    try {
      const userId = 1;
      const validatedData = insertJournalEntrySchema.parse({ ...req.body, userId });
      
      // Check if entry exists for this date
      const existingEntry = await storage.getJournalEntryByDate(userId, validatedData.date);
      
      if (existingEntry) {
        // Update existing entry
        const updatedEntry = await storage.updateJournalEntry(existingEntry.id, {
          content: validatedData.content,
          isVoiceEntry: validatedData.isVoiceEntry,
        });
        
        // Update streak
        await updateUserStreak(userId, validatedData.date);
        
        res.json(updatedEntry);
      } else {
        // Create new entry
        const entry = await storage.createJournalEntry(validatedData);
        
        // Update streak
        await updateUserStreak(userId, validatedData.date);
        
        res.json(entry);
      }
    } catch (error) {
      res.status(400).json({ message: "Failed to save journal entry" });
    }
  });

  // Daily Scores
  app.get("/api/daily-scores/:date", async (req, res) => {
    try {
      const userId = 1;
      const { date } = req.params;
      const scores = await storage.getDailyScoresByUserAndDate(userId, date);
      res.json(scores);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch daily scores" });
    }
  });

  app.get("/api/metric-history/:metricName", async (req, res) => {
    try {
      const userId = 1;
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
      const userId = 1;
      const validatedData = insertDailyScoreSchema.parse({ ...req.body, userId });
      
      const score = await storage.updateDailyScore(
        userId, 
        validatedData.date, 
        validatedData.metricName, 
        validatedData.value
      );
      
      res.json(score);
    } catch (error) {
      res.status(400).json({ message: "Failed to save daily score" });
    }
  });

  // User Metrics
  app.get("/api/user-metrics", async (req, res) => {
    try {
      const userId = 1;
      const metrics = await storage.getUserMetrics(userId);
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch user metrics" });
    }
  });

  app.post("/api/user-metrics", async (req, res) => {
    try {
      const userId = 1;
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

  // Streaks
  app.get("/api/streak", async (req, res) => {
    try {
      const userId = 1;
      const streak = await storage.getUserStreak(userId);
      res.json(streak || { currentStreak: 0, longestStreak: 0 });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch streak" });
    }
  });

  // AI Insights
  app.get("/api/ai-insights", async (req, res) => {
    try {
      const userId = 1;
      const insights = await storage.getActiveAIInsights(userId);
      res.json(insights);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch AI insights" });
    }
  });

  app.post("/api/ai-insights/generate", async (req, res) => {
    try {
      const userId = 1;
      
      // Get recent journal entries and scores
      const entries = await storage.getJournalEntriesByUser(userId);
      const scores = await storage.getDailyScoresByUser(userId);
      
      if (entries.length === 0) {
        return res.json({ insight: null });
      }

      // Prepare data for AI analysis
      const recentEntries = entries.slice(0, 7); // Last 7 entries
      const recentScores = scores.filter(score => {
        const scoreDate = new Date(score.date);
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        return scoreDate >= weekAgo;
      });

      const prompt = `
        Analyze the following journal entries and daily scores to find meaningful patterns and correlations.
        
        Journal Entries:
        ${recentEntries.map(entry => `${entry.date}: ${entry.content}`).join('\n')}
        
        Daily Scores:
        ${recentScores.map(score => `${score.date} - ${score.metricName}: ${score.value}`).join('\n')}
        
        Provide a single, actionable insight about patterns you notice. Focus on correlations between journal content and scores.
        Keep it encouraging and actionable. Also suggest 2-3 relevant tags.
        
        Respond in JSON format: { "insight": "your insight here", "tags": ["tag1", "tag2", "tag3"] }
      `;

      // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
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
      const userId = 1;
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
