import { 
  users, journalEntries, dailyScores, userMetrics, streaks, aiInsights,
  type User, type InsertUser, type JournalEntry, type InsertJournalEntry,
  type DailyScore, type InsertDailyScore, type UserMetric, type InsertUserMetric,
  type Streak, type InsertStreak, type AIInsight, type InsertAIInsight
} from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";

export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Journal entry methods
  getJournalEntry(id: number): Promise<JournalEntry | undefined>;
  getJournalEntriesByUser(userId: number): Promise<JournalEntry[]>;
  getJournalEntryByDate(userId: number, date: string): Promise<JournalEntry | undefined>;
  createJournalEntry(entry: InsertJournalEntry): Promise<JournalEntry>;
  updateJournalEntry(id: number, entry: Partial<InsertJournalEntry>): Promise<JournalEntry | undefined>;

  // Daily scores methods
  getDailyScoresByUserAndDate(userId: number, date: string): Promise<DailyScore[]>;
  getDailyScoresByUser(userId: number): Promise<DailyScore[]>;
  getMetricHistory(userId: number, metricName: string, days: number): Promise<DailyScore[]>;
  createDailyScore(score: InsertDailyScore): Promise<DailyScore>;
  updateDailyScore(userId: number, date: string, metricName: string, value: number, isAutoSynced?: boolean): Promise<DailyScore | undefined>;

  // User metrics methods
  getUserMetrics(userId: number): Promise<UserMetric[]>;
  createUserMetric(metric: InsertUserMetric): Promise<UserMetric>;
  updateUserMetric(id: number, metric: Partial<InsertUserMetric>): Promise<UserMetric | undefined>;

  // Streak methods
  getUserStreak(userId: number): Promise<Streak | undefined>;
  createStreak(streak: InsertStreak): Promise<Streak>;
  updateStreak(userId: number, streak: Partial<InsertStreak>): Promise<Streak | undefined>;

  // AI insights methods
  getActiveAIInsights(userId: number): Promise<AIInsight[]>;
  createAIInsight(insight: InsertAIInsight): Promise<AIInsight>;
  deactivateAIInsight(id: number): Promise<void>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User> = new Map();
  private journalEntries: Map<number, JournalEntry> = new Map();
  private dailyScores: Map<number, DailyScore> = new Map();
  private userMetrics: Map<number, UserMetric> = new Map();
  private streaks: Map<number, Streak> = new Map();
  private aiInsights: Map<number, AIInsight> = new Map();

  private currentUserId = 1;
  private currentJournalEntryId = 1;
  private currentDailyScoreId = 1;
  private currentUserMetricId = 1;
  private currentStreakId = 1;
  private currentAIInsightId = 1;

  constructor() {
    this.initializeDefaultData();
  }

  private initializeDefaultData() {
    const today = new Date();
    
    // Create default user
    const defaultUser: User = {
      id: 1,
      username: "demo",
      password: "demo123",
    };
    this.users.set(1, defaultUser);
    this.currentUserId = 2;

    // Create default metrics with health tracking
    const defaultMetrics: UserMetric[] = [
      { id: 1, userId: 1, name: "Happiness", color: "#10B981", maxValue: 10, isDefault: true, isActive: true },
      { id: 2, userId: 1, name: "Productivity", color: "#4F46E5", maxValue: 10, isDefault: true, isActive: true },
      { id: 3, userId: 1, name: "Energy", color: "#F59E0B", maxValue: 10, isDefault: true, isActive: true },
      { id: 4, userId: 1, name: "Nutrition", color: "#EC4899", maxValue: 10, isDefault: true, isActive: true },
      { id: 5, userId: 1, name: "Sleep Quality", color: "#8B5CF6", maxValue: 100, isDefault: false, isActive: true },
      { id: 6, userId: 1, name: "Readiness", color: "#EF4444", maxValue: 100, isDefault: false, isActive: true },
    ];

    defaultMetrics.forEach(metric => {
      this.userMetrics.set(metric.id, metric);
    });
    this.currentUserMetricId = 7;

    // No sample journal entries - users start with blank slate
    this.currentJournalEntryId = 1;

    // No sample scores for today - manual metrics remain blank until user inputs
    // Oura metrics will auto-sync when app opens
    // Keep one day of historical data for testing calendar long-press
    const yesterdayStr = new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const sampleScores: DailyScore[] = [
      // Yesterday's scores for testing calendar long-press
      { id: 1, userId: 1, date: yesterdayStr, metricName: "Happiness", value: 7, isAutoSynced: false },
      { id: 2, userId: 1, date: yesterdayStr, metricName: "Productivity", value: 8, isAutoSynced: false },
      { id: 3, userId: 1, date: yesterdayStr, metricName: "Energy", value: 6, isAutoSynced: false },
      { id: 4, userId: 1, date: yesterdayStr, metricName: "Nutrition", value: 8, isAutoSynced: false },
      { id: 5, userId: 1, date: yesterdayStr, metricName: "Sleep Quality", value: 82, isAutoSynced: true },
      { id: 6, userId: 1, date: yesterdayStr, metricName: "Readiness", value: 78, isAutoSynced: true },
    ];

    sampleScores.forEach(score => {
      this.dailyScores.set(score.id, score);
    });
    this.currentDailyScoreId = 7;

    // Create default streak starting at 0
    const defaultStreak: Streak = {
      id: 1,
      userId: 1,
      currentStreak: 0,
      longestStreak: 0,
      lastEntryDate: null,
    };
    this.streaks.set(1, defaultStreak);
    this.currentStreakId = 2;
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.username === username);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async getJournalEntry(id: number): Promise<JournalEntry | undefined> {
    return this.journalEntries.get(id);
  }

  async getJournalEntriesByUser(userId: number): Promise<JournalEntry[]> {
    return Array.from(this.journalEntries.values()).filter(entry => entry.userId === userId);
  }

  async getJournalEntryByDate(userId: number, date: string): Promise<JournalEntry | undefined> {
    return Array.from(this.journalEntries.values()).find(entry => 
      entry.userId === userId && entry.date === date
    );
  }

  async createJournalEntry(insertEntry: InsertJournalEntry): Promise<JournalEntry> {
    const id = this.currentJournalEntryId++;
    const entry: JournalEntry = {
      ...insertEntry,
      id,
      isVoiceEntry: insertEntry.isVoiceEntry ?? false,
      createdAt: new Date(),
    };
    this.journalEntries.set(id, entry);
    return entry;
  }

  async updateJournalEntry(id: number, updates: Partial<InsertJournalEntry>): Promise<JournalEntry | undefined> {
    const entry = this.journalEntries.get(id);
    if (entry) {
      const updated = { ...entry, ...updates };
      this.journalEntries.set(id, updated);
      return updated;
    }
    return undefined;
  }

  async getDailyScoresByUserAndDate(userId: number, date: string): Promise<DailyScore[]> {
    return Array.from(this.dailyScores.values()).filter(score => 
      score.userId === userId && score.date === date
    );
  }

  async getDailyScoresByUser(userId: number): Promise<DailyScore[]> {
    return Array.from(this.dailyScores.values()).filter(score => score.userId === userId);
  }

  async getMetricHistory(userId: number, metricName: string, days: number): Promise<DailyScore[]> {
    // Validate and cap days to prevent unbounded scans
    const validDays = Math.max(1, Math.min(90, days));
    
    // Calculate date floor (inclusive range)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - (validDays - 1));
    const dateFloor = startDate.toISOString().split('T')[0];
    
    // Filter and sort
    return Array.from(this.dailyScores.values())
      .filter(score => 
        score.userId === userId && 
        score.metricName === metricName && 
        score.date >= dateFloor
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async createDailyScore(insertScore: InsertDailyScore): Promise<DailyScore> {
    const id = this.currentDailyScoreId++;
    const score: DailyScore = { 
      ...insertScore, 
      id,
      isAutoSynced: insertScore.isAutoSynced ?? false,
    };
    this.dailyScores.set(id, score);
    return score;
  }

  async updateDailyScore(userId: number, date: string, metricName: string, value: number, isAutoSynced: boolean = false): Promise<DailyScore | undefined> {
    const existingScore = Array.from(this.dailyScores.values()).find(score =>
      score.userId === userId && score.date === date && score.metricName === metricName
    );

    if (existingScore) {
      existingScore.value = value;
      existingScore.isAutoSynced = isAutoSynced;
      this.dailyScores.set(existingScore.id, existingScore);
      return existingScore;
    } else {
      return await this.createDailyScore({ userId, date, metricName, value, isAutoSynced });
    }
  }

  async getUserMetrics(userId: number): Promise<UserMetric[]> {
    return Array.from(this.userMetrics.values()).filter(metric => metric.userId === userId);
  }

  async createUserMetric(insertMetric: InsertUserMetric): Promise<UserMetric> {
    const id = this.currentUserMetricId++;
    const metric: UserMetric = { 
      ...insertMetric, 
      id,
      maxValue: insertMetric.maxValue ?? 100,
      isDefault: insertMetric.isDefault ?? false,
      isActive: insertMetric.isActive ?? true,
    };
    this.userMetrics.set(id, metric);
    return metric;
  }

  async updateUserMetric(id: number, updates: Partial<InsertUserMetric>): Promise<UserMetric | undefined> {
    const metric = this.userMetrics.get(id);
    if (metric) {
      const updated = { ...metric, ...updates };
      this.userMetrics.set(id, updated);
      return updated;
    }
    return undefined;
  }

  async getUserStreak(userId: number): Promise<Streak | undefined> {
    return Array.from(this.streaks.values()).find(streak => streak.userId === userId);
  }

  async createStreak(insertStreak: InsertStreak): Promise<Streak> {
    const id = this.currentStreakId++;
    const streak: Streak = { 
      ...insertStreak, 
      id,
      currentStreak: insertStreak.currentStreak ?? 0,
      longestStreak: insertStreak.longestStreak ?? 0,
      lastEntryDate: insertStreak.lastEntryDate ?? null,
    };
    this.streaks.set(id, streak);
    return streak;
  }

  async updateStreak(userId: number, updates: Partial<InsertStreak>): Promise<Streak | undefined> {
    const streak = Array.from(this.streaks.values()).find(s => s.userId === userId);
    if (streak) {
      const updated = { ...streak, ...updates };
      this.streaks.set(streak.id, updated);
      return updated;
    }
    return undefined;
  }

  async getActiveAIInsights(userId: number): Promise<AIInsight[]> {
    return Array.from(this.aiInsights.values()).filter(insight => 
      insight.userId === userId && insight.isActive
    );
  }

  async createAIInsight(insertInsight: InsertAIInsight): Promise<AIInsight> {
    const id = this.currentAIInsightId++;
    const insight: AIInsight = {
      ...insertInsight,
      id,
      isActive: insertInsight.isActive ?? true,
      tags: insertInsight.tags ?? null,
      createdAt: new Date(),
    };
    this.aiInsights.set(id, insight);
    return insight;
  }

  async deactivateAIInsight(id: number): Promise<void> {
    const insight = this.aiInsights.get(id);
    if (insight) {
      insight.isActive = false;
      this.aiInsights.set(id, insight);
    }
  }
}

// Database implementation remains the same but we'll use MemStorage for now
export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getJournalEntry(id: number): Promise<JournalEntry | undefined> {
    const [entry] = await db.select().from(journalEntries).where(eq(journalEntries.id, id));
    return entry || undefined;
  }

  async getJournalEntriesByUser(userId: number): Promise<JournalEntry[]> {
    return await db.select().from(journalEntries).where(eq(journalEntries.userId, userId));
  }

  async getJournalEntryByDate(userId: number, date: string): Promise<JournalEntry | undefined> {
    const [entry] = await db.select().from(journalEntries)
      .where(and(eq(journalEntries.userId, userId), eq(journalEntries.date, date)));
    return entry || undefined;
  }

  async createJournalEntry(entry: InsertJournalEntry): Promise<JournalEntry> {
    const [created] = await db.insert(journalEntries).values(entry).returning();
    return created;
  }

  async updateJournalEntry(id: number, updates: Partial<InsertJournalEntry>): Promise<JournalEntry | undefined> {
    const [updated] = await db.update(journalEntries)
      .set(updates)
      .where(eq(journalEntries.id, id))
      .returning();
    return updated || undefined;
  }

  async getDailyScoresByUserAndDate(userId: number, date: string): Promise<DailyScore[]> {
    return await db.select().from(dailyScores)
      .where(and(eq(dailyScores.userId, userId), eq(dailyScores.date, date)));
  }

  async getDailyScoresByUser(userId: number): Promise<DailyScore[]> {
    return await db.select().from(dailyScores).where(eq(dailyScores.userId, userId));
  }

  async getMetricHistory(userId: number, metricName: string, days: number): Promise<DailyScore[]> {
    const { gte } = await import("drizzle-orm");
    
    // Validate and cap days to prevent unbounded scans
    const validDays = Math.max(1, Math.min(90, days));
    
    // Calculate date floor (inclusive range)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - (validDays - 1));
    const dateFloor = startDate.toISOString().split('T')[0];
    
    // Query with indexed filtering and ordering
    return await db.select().from(dailyScores)
      .where(and(
        eq(dailyScores.userId, userId),
        eq(dailyScores.metricName, metricName),
        gte(dailyScores.date, dateFloor)
      ))
      .orderBy(dailyScores.date)
      .limit(validDays);
  }

  async createDailyScore(score: InsertDailyScore): Promise<DailyScore> {
    const [created] = await db.insert(dailyScores).values(score).returning();
    return created;
  }

  async updateDailyScore(userId: number, date: string, metricName: string, value: number): Promise<DailyScore | undefined> {
    const [updated] = await db.update(dailyScores)
      .set({ value })
      .where(and(
        eq(dailyScores.userId, userId),
        eq(dailyScores.date, date),
        eq(dailyScores.metricName, metricName)
      ))
      .returning();
    
    if (updated) return updated;

    // If no existing score, create a new one
    return await this.createDailyScore({ userId, date, metricName, value });
  }

  async getUserMetrics(userId: number): Promise<UserMetric[]> {
    return await db.select().from(userMetrics).where(eq(userMetrics.userId, userId));
  }

  async createUserMetric(metric: InsertUserMetric): Promise<UserMetric> {
    const [created] = await db.insert(userMetrics).values(metric).returning();
    return created;
  }

  async updateUserMetric(id: number, updates: Partial<InsertUserMetric>): Promise<UserMetric | undefined> {
    const [updated] = await db.update(userMetrics)
      .set(updates)
      .where(eq(userMetrics.id, id))
      .returning();
    return updated || undefined;
  }

  async getUserStreak(userId: number): Promise<Streak | undefined> {
    const [streak] = await db.select().from(streaks).where(eq(streaks.userId, userId));
    return streak || undefined;
  }

  async createStreak(streak: InsertStreak): Promise<Streak> {
    const [created] = await db.insert(streaks).values(streak).returning();
    return created;
  }

  async updateStreak(userId: number, updates: Partial<InsertStreak>): Promise<Streak | undefined> {
    const [updated] = await db.update(streaks)
      .set(updates)
      .where(eq(streaks.userId, userId))
      .returning();
    return updated || undefined;
  }

  async getActiveAIInsights(userId: number): Promise<AIInsight[]> {
    return await db.select().from(aiInsights)
      .where(and(eq(aiInsights.userId, userId), eq(aiInsights.isActive, true)));
  }

  async createAIInsight(insight: InsertAIInsight): Promise<AIInsight> {
    const [created] = await db.insert(aiInsights).values(insight).returning();
    return created;
  }

  async deactivateAIInsight(id: number): Promise<void> {
    await db.update(aiInsights)
      .set({ isActive: false })
      .where(eq(aiInsights.id, id));
  }
}

export const storage = new MemStorage();