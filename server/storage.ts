import { 
  users, journalEntries, dailyScores, userMetrics, streaks, aiInsights, pushSubscriptions,
  goalTemplates, dailyGoals, journalAttachments, moodCheckins, debriefs,
  type User, type InsertUser, type JournalEntry, type InsertJournalEntry,
  type DailyScore, type InsertDailyScore, type UserMetric, type InsertUserMetric,
  type Streak, type InsertStreak, type AIInsight, type InsertAIInsight,
  type PushSubscription, type InsertPushSubscription,
  type GoalTemplate, type InsertGoalTemplate, type DailyGoal, type InsertDailyGoal,
  type JournalAttachment, type InsertJournalAttachment, type MoodCheckin, type InsertMoodCheckin
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import { encrypt, decrypt } from "./encryption";

export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserSettings(userId: number, settings: Partial<Pick<User, 'notificationsEnabled' | 'reminderTime' | 'reminderTime2' | 'timezone' | 'healthMetricsEnabled' | 'hasCompletedOnboarding' | 'journalPreference'>>): Promise<User | undefined>;

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
  deleteUserMetric(id: number, userId: number): Promise<void>;

  // Streak methods
  getUserStreak(userId: number): Promise<Streak | undefined>;
  createStreak(streak: InsertStreak): Promise<Streak>;
  updateStreak(userId: number, streak: Partial<InsertStreak>): Promise<Streak | undefined>;

  // AI insights methods
  getActiveAIInsights(userId: number): Promise<AIInsight[]>;
  createAIInsight(insight: InsertAIInsight): Promise<AIInsight>;
  deactivateAIInsight(id: number): Promise<void>;

  // Goal template methods
  getGoalTemplates(userId: number): Promise<GoalTemplate[]>;
  createGoalTemplate(template: InsertGoalTemplate): Promise<GoalTemplate>;
  updateGoalTemplate(id: number, userId: number, updates: Partial<InsertGoalTemplate>): Promise<GoalTemplate | undefined>;
  deleteGoalTemplate(id: number, userId: number): Promise<void>;

  // Daily goals methods
  getDailyGoals(userId: number, date: string): Promise<DailyGoal[]>;
  createDailyGoal(goal: InsertDailyGoal): Promise<DailyGoal>;
  getGoalsForDateRange(userId: number, startDate: string, endDate: string): Promise<DailyGoal[]>;
  ensureDailyGoals(userId: number, date: string): Promise<DailyGoal[]>;
  toggleDailyGoal(id: number, userId: number): Promise<DailyGoal | undefined>;

  // Journal attachment methods
  getAttachmentsByEntry(journalEntryId: number): Promise<JournalAttachment[]>;
  createAttachment(attachment: InsertJournalAttachment): Promise<JournalAttachment>;
  deleteAttachment(id: number, userId: number): Promise<void>;

  // Mood check-in methods
  createMoodCheckin(checkin: InsertMoodCheckin): Promise<MoodCheckin>;
  getMoodCheckinsByDate(userId: number, date: string): Promise<MoodCheckin[]>;
  getMoodCheckinsForDateRange(userId: number, startDate: string, endDate: string): Promise<MoodCheckin[]>;

  // Calendar data methods
  getDatesWithData(userId: number): Promise<string[]>;

  // Push subscription methods
  getPushSubscriptions(userId: number): Promise<PushSubscription[]>;
  createPushSubscription(subscription: InsertPushSubscription): Promise<PushSubscription>;
  deletePushSubscription(endpoint: string): Promise<void>;
  getAllUsersForReminder(time: string): Promise<Array<User & { subscriptions: PushSubscription[] }>>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User> = new Map();
  private journalEntries: Map<number, JournalEntry> = new Map();
  private dailyScores: Map<number, DailyScore> = new Map();
  private userMetrics: Map<number, UserMetric> = new Map();
  private streaks: Map<number, Streak> = new Map();
  private aiInsights: Map<number, AIInsight> = new Map();
  private pushSubscriptions: Map<number, PushSubscription> = new Map();

  private currentUserId = 1;
  private currentJournalEntryId = 1;
  private currentDailyScoreId = 1;
  private currentUserMetricId = 1;
  private currentStreakId = 1;
  private currentAIInsightId = 1;
  private currentPushSubscriptionId = 1;

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
      notificationsEnabled: true,
      reminderTime: "21:00",
      timezone: "UTC",
    };
    this.users.set(1, defaultUser);
    this.currentUserId = 2;

    // Create default metrics with health tracking
    const defaultMetrics: UserMetric[] = [
      { id: 1, userId: 1, name: "Happiness", color: "#10B981", maxValue: 100, isDefault: true, isActive: true },
      { id: 2, userId: 1, name: "Productivity", color: "#4F46E5", maxValue: 100, isDefault: true, isActive: true },
      { id: 3, userId: 1, name: "Energy", color: "#F59E0B", maxValue: 100, isDefault: true, isActive: true },
      { id: 4, userId: 1, name: "Nutrition", color: "#EC4899", maxValue: 100, isDefault: true, isActive: true },
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
    const user: User = { 
      ...insertUser, 
      id,
      notificationsEnabled: true,
      reminderTime: "21:00",
      timezone: "UTC",
    };
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

  async deleteUserMetric(id: number, _userId: number): Promise<void> {
    const metric = this.userMetrics.get(id);
    if (metric) {
      metric.isActive = false;
      this.userMetrics.set(id, metric);
    }
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

  async updateUserSettings(userId: number, settings: Partial<Pick<User, 'notificationsEnabled' | 'reminderTime' | 'reminderTime2' | 'timezone' | 'healthMetricsEnabled' | 'hasCompletedOnboarding' | 'journalPreference'>>): Promise<User | undefined> {
    const user = this.users.get(userId);
    if (user) {
      Object.assign(user, settings);
      this.users.set(userId, user);
      return user;
    }
    return undefined;
  }

  async getPushSubscriptions(userId: number): Promise<PushSubscription[]> {
    return Array.from(this.pushSubscriptions.values()).filter(sub => sub.userId === userId);
  }

  async createPushSubscription(subscription: InsertPushSubscription): Promise<PushSubscription> {
    const existing = Array.from(this.pushSubscriptions.values()).find(
      sub => sub.endpoint === subscription.endpoint
    );
    
    if (existing) {
      return existing;
    }

    const newSubscription: PushSubscription = {
      ...subscription,
      id: this.currentPushSubscriptionId++,
      createdAt: new Date(),
    };
    this.pushSubscriptions.set(newSubscription.id, newSubscription);
    return newSubscription;
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    const subscription = Array.from(this.pushSubscriptions.entries()).find(
      ([_, sub]) => sub.endpoint === endpoint
    );
    if (subscription) {
      this.pushSubscriptions.delete(subscription[0]);
    }
  }

  async getAllUsersForReminder(time: string): Promise<Array<User & { subscriptions: PushSubscription[] }>> {
    const usersWithReminders: Array<User & { subscriptions: PushSubscription[] }> = [];
    
    for (const user of Array.from(this.users.values())) {
      if (user.notificationsEnabled) {
        const subscriptions = await this.getPushSubscriptions(user.id);
        if (subscriptions.length > 0) {
          usersWithReminders.push({ ...user, subscriptions });
        }
      }
    }
    
    return usersWithReminders;
  }

  async getGoalTemplates(_userId: number): Promise<GoalTemplate[]> { return []; }
  async createGoalTemplate(t: InsertGoalTemplate): Promise<GoalTemplate> { return { ...t, id: 0, sortOrder: t.sortOrder ?? 0, isActive: t.isActive ?? true } as GoalTemplate; }
  async updateGoalTemplate(_id: number, _userId: number, _updates: Partial<InsertGoalTemplate>): Promise<GoalTemplate | undefined> { return undefined; }
  async deleteGoalTemplate(_id: number, _userId: number): Promise<void> {}
  async getDailyGoals(_userId: number, _date: string): Promise<DailyGoal[]> { return []; }
  async createDailyGoal(goal: InsertDailyGoal): Promise<DailyGoal> { return { ...goal, id: 0, completed: goal.completed ?? false } as DailyGoal; }
  async getGoalsForDateRange(_userId: number, _startDate: string, _endDate: string): Promise<DailyGoal[]> { return []; }
  async ensureDailyGoals(_userId: number, _date: string): Promise<DailyGoal[]> { return []; }
  async toggleDailyGoal(_id: number, _userId: number): Promise<DailyGoal | undefined> { return undefined; }

  async getAttachmentsByEntry(_journalEntryId: number): Promise<JournalAttachment[]> { return []; }
  async createAttachment(a: InsertJournalAttachment): Promise<JournalAttachment> { return { ...a, id: 0, createdAt: new Date() } as JournalAttachment; }
  async deleteAttachment(_id: number, _userId: number): Promise<void> {}

  async createMoodCheckin(c: InsertMoodCheckin): Promise<MoodCheckin> { return { ...c, id: 0, createdAt: new Date(), label: c.label ?? null } as MoodCheckin; }
  async getMoodCheckinsByDate(_userId: number, _date: string): Promise<MoodCheckin[]> { return []; }
  async getMoodCheckinsForDateRange(_userId: number, _startDate: string, _endDate: string): Promise<MoodCheckin[]> { return []; }
  async getDatesWithData(_userId: number): Promise<string[]> { return []; }
}

// Database implementation
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
    if (entry) entry.content = decrypt(entry.content);
    return entry || undefined;
  }

  async getJournalEntriesByUser(userId: number): Promise<JournalEntry[]> {
    const entries = await db.select().from(journalEntries)
      .where(eq(journalEntries.userId, userId))
      .orderBy(desc(journalEntries.date));
    return entries.map(e => ({ ...e, content: decrypt(e.content) }));
  }

  async getJournalEntryByDate(userId: number, date: string): Promise<JournalEntry | undefined> {
    const [entry] = await db.select().from(journalEntries)
      .where(and(eq(journalEntries.userId, userId), eq(journalEntries.date, date)));
    if (entry) entry.content = decrypt(entry.content);
    return entry || undefined;
  }

  async createJournalEntry(entry: InsertJournalEntry): Promise<JournalEntry> {
    const encrypted = { ...entry, content: encrypt(entry.content) };
    const [created] = await db.insert(journalEntries).values(encrypted).returning();
    created.content = decrypt(created.content);
    return created;
  }

  async updateJournalEntry(id: number, updates: Partial<InsertJournalEntry>): Promise<JournalEntry | undefined> {
    const encryptedUpdates = updates.content
      ? { ...updates, content: encrypt(updates.content) }
      : updates;
    const [updated] = await db.update(journalEntries)
      .set(encryptedUpdates)
      .where(eq(journalEntries.id, id))
      .returning();
    if (updated) updated.content = decrypt(updated.content);
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

  async updateDailyScore(userId: number, date: string, metricName: string, value: number, isAutoSynced: boolean = false): Promise<DailyScore | undefined> {
    const [updated] = await db.update(dailyScores)
      .set({ value, isAutoSynced })
      .where(and(
        eq(dailyScores.userId, userId),
        eq(dailyScores.date, date),
        eq(dailyScores.metricName, metricName)
      ))
      .returning();
    
    if (updated) return updated;

    return await this.createDailyScore({ userId, date, metricName, value, isAutoSynced });
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

  async deleteUserMetric(id: number, userId: number): Promise<void> {
    await db.update(userMetrics)
      .set({ isActive: false })
      .where(and(eq(userMetrics.id, id), eq(userMetrics.userId, userId)));
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

  async updateUserSettings(userId: number, settings: Partial<Pick<User, 'notificationsEnabled' | 'reminderTime' | 'reminderTime2' | 'timezone' | 'healthMetricsEnabled' | 'hasCompletedOnboarding' | 'journalPreference'>>): Promise<User | undefined> {
    const [updated] = await db.update(users)
      .set(settings)
      .where(eq(users.id, userId))
      .returning();
    return updated || undefined;
  }

  async getPushSubscriptions(userId: number): Promise<PushSubscription[]> {
    return await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  }

  async createPushSubscription(subscription: InsertPushSubscription): Promise<PushSubscription> {
    const [existing] = await db.select().from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, subscription.endpoint));
    
    if (existing) {
      return existing;
    }

    const [created] = await db.insert(pushSubscriptions).values(subscription).returning();
    return created;
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  }

  async getGoalTemplates(userId: number): Promise<GoalTemplate[]> {
    return await db.select().from(goalTemplates)
      .where(and(eq(goalTemplates.userId, userId), eq(goalTemplates.isActive, true)))
      .orderBy(goalTemplates.sortOrder);
  }

  async createGoalTemplate(template: InsertGoalTemplate): Promise<GoalTemplate> {
    const [created] = await db.insert(goalTemplates).values(template).returning();
    return created;
  }

  async updateGoalTemplate(id: number, userId: number, updates: Partial<InsertGoalTemplate>): Promise<GoalTemplate | undefined> {
    const [updated] = await db.update(goalTemplates)
      .set(updates)
      .where(and(eq(goalTemplates.id, id), eq(goalTemplates.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteGoalTemplate(id: number, userId: number): Promise<void> {
    await db.update(goalTemplates)
      .set({ isActive: false })
      .where(and(eq(goalTemplates.id, id), eq(goalTemplates.userId, userId)));
    await db.delete(dailyGoals)
      .where(and(
        eq(dailyGoals.userId, userId),
        eq(dailyGoals.goalTemplateId, id),
      ));
  }

  async getDailyGoals(userId: number, date: string): Promise<DailyGoal[]> {
    const { asc } = await import("drizzle-orm");
    const goals = await db.select().from(dailyGoals)
      .where(and(eq(dailyGoals.userId, userId), eq(dailyGoals.date, date)))
      .orderBy(asc(dailyGoals.id));
    const seen = new Set<number>();
    return goals.filter(g => {
      if (seen.has(g.goalTemplateId)) return false;
      seen.add(g.goalTemplateId);
      return true;
    });
  }

  async createDailyGoal(goal: InsertDailyGoal): Promise<DailyGoal> {
    const [created] = await db.insert(dailyGoals).values(goal).returning();
    return created;
  }

  async getGoalsForDateRange(userId: number, startDate: string, endDate: string): Promise<DailyGoal[]> {
    const { gte, lte } = await import("drizzle-orm");
    return await db.select().from(dailyGoals)
      .where(and(
        eq(dailyGoals.userId, userId),
        gte(dailyGoals.date, startDate),
        lte(dailyGoals.date, endDate)
      ));
  }

  async ensureDailyGoals(userId: number, date: string): Promise<DailyGoal[]> {
    const existing = await this.getDailyGoals(userId, date);

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (date < todayStr) return existing;

    const templates = await this.getGoalTemplates(userId);
    const recurringTemplates = templates.filter(t => t.recurring);
    if (recurringTemplates.length === 0) return existing;

    const existingTemplateIds = new Set(existing.map(g => g.goalTemplateId));
    const missingTemplates = recurringTemplates.filter(t => !existingTemplateIds.has(t.id));
    if (missingTemplates.length === 0) return existing;

    const newGoals: DailyGoal[] = [];
    for (const template of missingTemplates) {
      const [goal] = await db.insert(dailyGoals).values({
        userId,
        date,
        goalTemplateId: template.id,
        title: template.title,
        completed: false,
      }).returning();
      newGoals.push(goal);
    }
    return [...existing, ...newGoals];
  }

  async toggleDailyGoal(id: number, userId: number): Promise<DailyGoal | undefined> {
    const [existing] = await db.select().from(dailyGoals)
      .where(and(eq(dailyGoals.id, id), eq(dailyGoals.userId, userId)));
    if (!existing) return undefined;
    const [updated] = await db.update(dailyGoals)
      .set({ completed: !existing.completed })
      .where(and(eq(dailyGoals.id, id), eq(dailyGoals.userId, userId)))
      .returning();
    return updated;
  }

  async getAttachmentsByEntry(journalEntryId: number): Promise<JournalAttachment[]> {
    return await db.select().from(journalAttachments)
      .where(eq(journalAttachments.journalEntryId, journalEntryId));
  }

  async createAttachment(attachment: InsertJournalAttachment): Promise<JournalAttachment> {
    const [created] = await db.insert(journalAttachments).values(attachment).returning();
    return created;
  }

  async deleteAttachment(id: number, userId: number): Promise<void> {
    await db.delete(journalAttachments)
      .where(and(eq(journalAttachments.id, id), eq(journalAttachments.userId, userId)));
  }

  async createMoodCheckin(checkin: InsertMoodCheckin): Promise<MoodCheckin> {
    const [created] = await db.insert(moodCheckins).values(checkin).returning();
    return created;
  }

  async getMoodCheckinsByDate(userId: number, date: string): Promise<MoodCheckin[]> {
    return await db.select().from(moodCheckins)
      .where(and(eq(moodCheckins.userId, userId), eq(moodCheckins.date, date)));
  }

  async getMoodCheckinsForDateRange(userId: number, startDate: string, endDate: string): Promise<MoodCheckin[]> {
    const { gte, lte } = await import("drizzle-orm");
    return await db.select().from(moodCheckins)
      .where(and(
        eq(moodCheckins.userId, userId),
        gte(moodCheckins.date, startDate),
        lte(moodCheckins.date, endDate)
      ));
  }

  async getDatesWithData(userId: number): Promise<string[]> {
    const journalDates = await db.selectDistinct({ date: journalEntries.date })
      .from(journalEntries)
      .where(eq(journalEntries.userId, userId));
    const scoreDates = await db.selectDistinct({ date: dailyScores.date })
      .from(dailyScores)
      .where(eq(dailyScores.userId, userId));
    const moodDates = await db.selectDistinct({ date: moodCheckins.date })
      .from(moodCheckins)
      .where(eq(moodCheckins.userId, userId));
    const debriefDates = await db.selectDistinct({ date: debriefs.date })
      .from(debriefs)
      .where(eq(debriefs.userId, userId));

    const allDates = new Set<string>();
    for (const r of journalDates) allDates.add(r.date);
    for (const r of scoreDates) allDates.add(r.date);
    for (const r of moodDates) allDates.add(r.date);
    for (const r of debriefDates) allDates.add(r.date);
    return Array.from(allDates);
  }

  async getAllUsersForReminder(time: string): Promise<Array<User & { subscriptions: PushSubscription[] }>> {
    const usersWithNotifs = await db.select().from(users)
      .where(eq(users.notificationsEnabled, true));
    
    const usersWithSubscriptions: Array<User & { subscriptions: PushSubscription[] }> = [];
    
    for (const user of usersWithNotifs) {
      const subs = await this.getPushSubscriptions(user.id);
      if (subs.length > 0) {
        usersWithSubscriptions.push({ ...user, subscriptions: subs });
      }
    }
    
    return usersWithSubscriptions;
  }
}

export const storage = new DatabaseStorage();